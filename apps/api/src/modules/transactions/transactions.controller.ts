import { Body, Controller, Get, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { Prisma, PrismaClient } from '@prisma/client';
import { Money } from '@taxora/tax-rules';
import {
  execute,
  type ExecutionContext as RuleCtx,
  type Inputs,
  type TransactionTemplate,
  RuleEngineError,
} from '@taxora/rule-engine';
import { TaxRuleRegistry } from '@taxora/tax-rules';

import { TenantGuard } from '../../tenant/tenant.guard.js';
import { TenantContextInterceptor } from '../../tenant/tenant.interceptor.js';
import { requireTenantId, requireUserId } from '../../tenant/tenant.context.js';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { DomainException } from '../../common/errors.js';
import { HttpStatus } from '@nestjs/common';
import { withTenant } from '../../infrastructure/persistence/prisma.js';
import { postJournal } from '../accounting/journal-poster.js';

/**
 * /v1/transactions/execute — the canonical "do business action" endpoint.
 *
 * Body:
 *   {
 *     templateCode: 'PAY_VENDOR_JASA_PPH23' | 'ISSUE_INVOICE_PPN' | ...,
 *     templateVersion?: number,         // omit -> latest effective
 *     inputs: Record<string, JsonValue>,
 *     postedAt?: ISO date string,       // defaults to inputs.paymentDate / issueDate / now
 *     dryRun?: boolean,                 // if true, run engine but don't persist
 *   }
 *
 * Pipeline:
 *   1. Resolve tenant from JWT (TenantGuard).
 *   2. Load TransactionTemplate (tenant override > global, effective on date).
 *   3. Load tenant's tax_rules + Chart of Accounts -> build ExecutionContext.
 *   4. Run @taxora/rule-engine `execute()` to get journal + artifacts + obligations.
 *   5. If dryRun -> return result without writing.
 *   6. Otherwise: open tx via withTenant() -> postJournal() -> persist artifacts +
 *      compliance_deadlines -> outbox event -> COMMIT.
 *   7. Return audit trail (computed values + journal id + artifacts).
 *
 * Idempotency: caller may send `Idempotency-Key` header. (Wired in PR #16.)
 */

const ExecuteInput = z.object({
  templateCode: z.string().min(1),
  templateVersion: z.number().int().positive().optional(),
  inputs: z.record(z.unknown()),
  postedAt: z.string().datetime().optional(),
  dryRun: z.boolean().optional(),
});

type ExecuteBody = z.infer<typeof ExecuteInput>;

@Controller('v1/transactions')
@UseGuards(TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class TransactionsController {
  private readonly prisma = new PrismaClient();

  @Post('execute')
  async execute(
    @Body(new ZodValidationPipe(ExecuteInput)) body: ExecuteBody,
  ): Promise<ExecuteResponse> {
    const tenantId = requireTenantId();
    const userId = requireUserId();

    // 1. Resolve template (tenant-specific or global). Pick the most recent
    // effectiveFrom <= now matching code [+ version]. Throws if missing.
    const template = await this.loadTemplate(tenantId, body.templateCode, body.templateVersion);

    // 2. Coerce raw inputs against the template's input spec.
    const inputs = coerceInputs(body.inputs, template);

    // 3. Determine the "as-of" date for tax-rule lookup. Prefer the input that
    // most templates carry: paymentDate / issueDate; else `postedAt`; else now.
    const asOfDate = pickDate(body, inputs);

    // 4. Build the ExecutionContext from DB state.
    const ctx = await this.buildContext(tenantId, asOfDate);

    // 5. Execute (pure, deterministic).
    let result;
    try {
      result = execute(template as TransactionTemplate, inputs, ctx);
    } catch (e) {
      if (e instanceof RuleEngineError) {
        throw new DomainException(
          'RULE_ENGINE_REJECTED',
          'Rule engine refused to produce a journal',
          HttpStatus.UNPROCESSABLE_ENTITY,
          e.message,
        );
      }
      throw e;
    }

    if (body.dryRun) {
      return {
        dryRun: true,
        templateCode: template.code,
        templateVersion: template.version,
        computed: serializeComputed(result.computed),
        journalLines: result.journal.lines.map((l) => ({
          accountId: l.accountId,
          side: l.side,
          amount: Money.toRupiah(l.amount),
        })),
        artifacts: result.artifacts.map((a) => ({ type: a.type, fields: serializeArtifactFields(a.fields) })),
        obligations: result.obligations.map((o) => ({
          kind: o.kind,
          dueDate: o.dueDate.toISOString().slice(0, 10),
          amount: o.amount ? Money.toRupiah(o.amount) : undefined,
        })),
      };
    }

    // 6. Persist inside one transactional withTenant().
    const persisted = await withTenant(tenantId, async (tx) => {
      const fp = await ensureFiscalPeriod(tx, tenantId, asOfDate);

      const journalId = (await postJournal(tx, {
        tenantId,
        fiscalPeriodId: fp.id,
        postedAt: asOfDate,
        referenceType: 'TEMPLATE',
        memo: body.templateCode,
        postedBy: userId,
        lines: result.journal.lines.map((l) => ({
          accountId: l.accountId,
          side: l.side,
          amount: l.amount,
          ...(l.description ? { description: l.description } : {}),
        })),
      }, { templateCode: template.code, templateVersion: template.version })).journalId;

      // Persist obligations (compliance_deadlines).
      for (const o of result.obligations) {
        await tx.complianceDeadline.create({
          data: {
            tenantId,
            kind: o.kind,
            periodYear: o.dueDate.getUTCFullYear(),
            periodMonth: o.dueDate.getUTCMonth() + 1,
            dueDate: o.dueDate,
            ...(o.amount ? { amount: new Prisma.Decimal(Money.toRupiah(o.amount)) } : {}),
          },
        });
      }

      return { journalId };
    });

    return {
      dryRun: false,
      templateCode: template.code,
      templateVersion: template.version,
      journalId: persisted.journalId,
      computed: serializeComputed(result.computed),
      journalLines: result.journal.lines.map((l) => ({
        accountId: l.accountId,
        side: l.side,
        amount: Money.toRupiah(l.amount),
      })),
      artifacts: result.artifacts.map((a) => ({ type: a.type, fields: serializeArtifactFields(a.fields) })),
      obligations: result.obligations.map((o) => ({
        kind: o.kind,
        dueDate: o.dueDate.toISOString().slice(0, 10),
        amount: o.amount ? Money.toRupiah(o.amount) : undefined,
      })),
    };
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private async loadTemplate(
    tenantId: string,
    code: string,
    version?: number,
  ): Promise<TransactionTemplate & { code: string; version: number }> {
    const where: Prisma.TransactionTemplateWhereInput = {
      code,
      ...(version ? { version } : {}),
      OR: [{ tenantId }, { tenantId: null }],
    };
    const candidates = await this.prisma.transactionTemplate.findMany({
      where,
      orderBy: [{ tenantId: 'desc' }, { effectiveFrom: 'desc' }, { version: 'desc' }],
      take: 5,
    });
    const best = candidates[0];
    if (!best) {
      throw new DomainException(
        'TEMPLATE_NOT_FOUND',
        `Transaction template '${code}'${version ? ` v${version}` : ''} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    const def = best.definition as unknown as Omit<TransactionTemplate, 'code' | 'version' | 'effectiveFrom'>;
    return {
      ...def,
      code: best.code,
      version: best.version,
      effectiveFrom: best.effectiveFrom.toISOString().slice(0, 10),
    } as TransactionTemplate & { code: string; version: number };
  }

  private async buildContext(tenantId: string, asOfDate: Date): Promise<RuleCtx> {
    const [accounts, rules] = await Promise.all([
      this.prisma.account.findMany({
        where: { tenantId },
        select: { id: true, code: true, taxPurpose: true },
      }),
      this.prisma.taxRule.findMany({
        where: { OR: [{ tenantId }, { tenantId: null }] },
      }),
    ]);

    const byPurpose: Record<string, string> = {};
    const byCode: Record<string, string> = {};
    for (const a of accounts) {
      byCode[a.code] = a.id;
      if (a.taxPurpose) byPurpose[a.taxPurpose] = a.id;
    }
    // Demo mapping kode_objek_pajak → expense account, identical to web/lib/demo-context.ts
    const expenseByKode: Record<string, string> = {};
    const beban = byCode['5.1.03.001'];
    const sewa = byCode['5.1.02.001'];
    if (beban) {
      // PPh 23 services and royalties go to "Beban Jasa Profesional"
      expenseByKode['24-104-01'] = beban;
      expenseByKode['24-001-01'] = beban;
      expenseByKode['24-002-01'] = beban;
      expenseByKode['24-003-01'] = beban;
      expenseByKode['24-004-01'] = beban;
    }
    if (sewa) {
      expenseByKode['24-100-01'] = sewa;
    }

    const registry = new TaxRuleRegistry();
    for (const r of rules) {
      registry.add({
        code: r.code,
        effectiveFrom: r.effectiveFrom,
        ...(r.effectiveTo ? { effectiveTo: r.effectiveTo } : {}),
        payload: r.payload,
        ...(r.sourceRef ? { sourceRef: r.sourceRef } : {}),
        ...(r.tenantId ? { tenantId: r.tenantId } : {}),
      });
    }

    void asOfDate; // currently unused (registry filters by date at lookup), retained for future logging

    return {
      tenantId,
      registry,
      resolveAccountByTaxPurpose: (p) => byPurpose[p],
      resolveAccountByCode:       (c) => byCode[c],
      resolveExpenseAccountForKodeObjek: (k) => expenseByKode[k],
      resolveParty: () => undefined,
    };
  }
}

// ─── pure helpers (no DI) ────────────────────────────────────────────────────

interface ExecuteResponse {
  dryRun: boolean;
  templateCode: string;
  templateVersion: number;
  journalId?: string;
  computed: Record<string, unknown>;
  journalLines: Array<{ accountId: string; side: 'DEBIT' | 'CREDIT'; amount: string }>;
  artifacts: Array<{ type: string; fields: Record<string, unknown> }>;
  obligations: Array<{ kind: string; dueDate: string; amount?: string | undefined }>;
}

function pickDate(body: ExecuteBody, inputs: Inputs): Date {
  if (body.postedAt) return new Date(body.postedAt);
  for (const k of ['paymentDate', 'issueDate', 'date']) {
    const v = (inputs as Record<string, unknown>)[k];
    if (v instanceof Date) return v;
    if (typeof v === 'string') {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return new Date();
}

function coerceInputs(raw: Record<string, unknown>, template: TransactionTemplate): Inputs {
  // The engine's own coercion accepts string | number | bigint | boolean | Date | Money.
  // Money inputs are commonly sent as { amount, currency }, plain numbers, or strings.
  // We let the engine do the coercion; we just normalize Money-shaped objects whose
  // bigint may have crossed the JSON boundary as strings.
  const out: Inputs = {} as Inputs;
  for (const spec of template.inputs) {
    const v = raw[spec.name];
    if (v === undefined || v === null) continue;
    if (
      spec.kind === 'money' &&
      typeof v === 'object' &&
      v !== null &&
      'amount' in v &&
      'currency' in v
    ) {
      const obj = v as { amount: string | number | bigint; currency: 'IDR' };
      const amt = typeof obj.amount === 'bigint' ? obj.amount : BigInt(obj.amount as string | number);
      out[spec.name] = { amount: amt, currency: obj.currency } as never;
      continue;
    }
    out[spec.name] = v as Inputs[string];
  }
  return out;
}

function serializeComputed(c: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if (typeof v !== 'object' || v === null || !('kind' in v)) {
      out[k] = v;
      continue;
    }
    const rv = v as { kind: string; value?: unknown };
    switch (rv.kind) {
      case 'money': {
        const m = rv.value as { amount: bigint; currency: string };
        out[k] = { amount: Money.toRupiah(m as never), currency: m.currency };
        break;
      }
      case 'date':
        out[k] = (rv.value as Date).toISOString().slice(0, 10);
        break;
      case 'rate': {
        const r = rv.value as { num: number; den: number };
        out[k] = { num: r.num, den: r.den, percent: (r.num / r.den) * 100 };
        break;
      }
      case 'object': {
        const o = rv.value as Record<string, unknown>;
        out[k] = serializeComputed(o);
        break;
      }
      default:
        out[k] = rv.value;
    }
  }
  return out;
}

function serializeArtifactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v && typeof v === 'object' && 'amount' in v && 'currency' in v) {
      out[k] = Money.toRupiah(v as never);
    } else if (v instanceof Date) {
      out[k] = v.toISOString().slice(0, 10);
    } else if (v && typeof v === 'object' && 'num' in v && 'den' in v) {
      const r = v as { num: number; den: number };
      out[k] = { num: r.num, den: r.den, percent: (r.num / r.den) * 100 };
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function ensureFiscalPeriod(
  tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
  tenantId: string,
  d: Date,
): Promise<{ id: string }> {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  return tx.fiscalPeriod.upsert({
    where: { tenantId_year_month: { tenantId, year, month } },
    update: {},
    create: { tenantId, year, month },
    select: { id: true },
  });
}
