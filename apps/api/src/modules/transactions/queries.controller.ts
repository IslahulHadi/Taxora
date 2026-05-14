import { Controller, Get, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { TenantGuard } from '../../tenant/tenant.guard.js';
import { TenantContextInterceptor } from '../../tenant/tenant.interceptor.js';
import { requireTenantId } from '../../tenant/tenant.context.js';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { withTenant } from '../../infrastructure/persistence/prisma.js';

/**
 * Read-side endpoints used by the customer-facing UI:
 *
 *   GET /v1/me/templates       transaction templates available to this tenant
 *   GET /v1/me/accounts        Chart of Accounts
 *   GET /v1/me/journals        recently-posted journals (with lines)
 *   GET /v1/me/deadlines       upcoming compliance deadlines
 *   GET /v1/me/templates/:code template definition (used for input forms)
 *
 * All endpoints are tenant-scoped: TenantGuard verifies JWT, TenantContext-
 * Interceptor opens an ALS frame, and `withTenant()` issues queries with
 * `SET LOCAL app.tenant_id` so RLS is enforced at the DB.
 */
@Controller('v1/me')
@UseGuards(TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class MeQueriesController {
  private readonly prisma = new PrismaClient();

  @Get('templates')
  async templates(): Promise<TemplateSummary[]> {
    const tenantId = requireTenantId();
    const rows = await this.prisma.transactionTemplate.findMany({
      where: { OR: [{ tenantId }, { tenantId: null }] },
      orderBy: [{ tenantId: 'desc' }, { effectiveFrom: 'desc' }],
    });
    // De-dup by code: keep the highest-priority row (tenant-specific > global, then latest effectiveFrom).
    const seen = new Set<string>();
    const out: TemplateSummary[] = [];
    for (const r of rows) {
      if (seen.has(r.code)) continue;
      seen.add(r.code);
      out.push({
        code: r.code,
        version: r.version,
        effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
        scope: r.tenantId ? 'tenant' : 'global',
      });
    }
    return out;
  }

  @Get('templates/:code')
  async template(@Param('code') code: string): Promise<TemplateDetail> {
    const tenantId = requireTenantId();
    const row = await this.prisma.transactionTemplate.findFirst({
      where: { code, OR: [{ tenantId }, { tenantId: null }] },
      orderBy: [{ tenantId: 'desc' }, { effectiveFrom: 'desc' }],
    });
    if (!row) {
      const { DomainException } = await import('../../common/errors.js');
      const { HttpStatus } = await import('@nestjs/common');
      throw new DomainException(
        'TEMPLATE_NOT_FOUND',
        `Template '${code}' not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      code: row.code,
      version: row.version,
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      scope: row.tenantId ? 'tenant' : 'global',
      definition: row.definition as TemplateDetail['definition'],
    };
  }

  @Get('accounts')
  async accounts(): Promise<AccountSummary[]> {
    const tenantId = requireTenantId();
    return withTenant(tenantId, (tx) =>
      tx.account.findMany({
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          normalSide: true,
          taxPurpose: true,
        },
        orderBy: { code: 'asc' },
      }),
    );
  }

  @Get('journals')
  async journals(
    @Query(new ZodValidationPipe(z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }).strict()))
    q: { limit: number },
  ): Promise<JournalSummary[]> {
    const tenantId = requireTenantId();
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.journal.findMany({
        orderBy: { postedAt: 'desc' },
        take: q.limit,
        include: {
          lines: { include: { account: { select: { code: true, name: true } } } },
        },
      });
      return rows.map((j) => ({
        id: j.id,
        postedAt: j.postedAt.toISOString(),
        referenceType: j.referenceType,
        templateCode: j.templateCode,
        memo: j.memo,
        status: j.status,
        lines: j.lines.map((l) => ({
          accountCode: l.account.code,
          accountName: l.account.name,
          side: l.side as 'DEBIT' | 'CREDIT',
          amount: (l.amount as Prisma.Decimal).toFixed(0),
        })),
      }));
    });
  }

  @Get('deadlines')
  async deadlines(): Promise<DeadlineSummary[]> {
    const tenantId = requireTenantId();
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.complianceDeadline.findMany({
        where: { status: 'PENDING' },
        orderBy: { dueDate: 'asc' },
        take: 30,
      });
      return rows.map((d) => ({
        id: d.id,
        kind: d.kind,
        dueDate: d.dueDate.toISOString().slice(0, 10),
        amount: d.amount ? (d.amount as Prisma.Decimal).toFixed(0) : null,
        status: d.status,
      }));
    });
  }
}

// ─── response shapes (kept inline; PR will move to packages/contracts) ──────

export interface TemplateSummary {
  code: string;
  version: number;
  effectiveFrom: string;
  scope: 'tenant' | 'global';
}

export interface TemplateDetail extends TemplateSummary {
  definition: {
    inputs: Array<{ name: string; kind: string; required?: boolean }>;
    computations: Array<{ name: string; expr: string }>;
    journal: Array<{ side: 'DEBIT' | 'CREDIT'; account: string; amount: string; if?: string; description?: string }>;
    artifacts?: Array<{ type: string; fields: Record<string, string>; if?: string }>;
    obligations?: Array<{ kind: string; dueDay: number; amount?: string; if?: string }>;
  };
}

export interface AccountSummary {
  id: string;
  code: string;
  name: string;
  type: string;
  normalSide: string;
  taxPurpose: string | null;
}

export interface JournalSummary {
  id: string;
  postedAt: string;
  referenceType: string;
  templateCode: string | null;
  memo: string | null;
  status: string;
  lines: Array<{
    accountCode: string;
    accountName: string;
    side: 'DEBIT' | 'CREDIT';
    amount: string;
  }>;
}

export interface DeadlineSummary {
  id: string;
  kind: string;
  dueDate: string;
  amount: string | null;
  status: string;
}
