/**
 * Top-level engine: turns a TransactionTemplate + Inputs + Context
 * into a fully-resolved ExecutionResult.
 *
 * Pipeline:
 *   1. Validate inputs against template's input spec.
 *   2. Seed scope with inputs (typed) + ctx-derived 'now'.
 *   3. Resolve each computation in order. Each binding is added to scope.
 *   4. Evaluate journal lines. Discard any whose `if` is falsy.
 *      Resolve account expressions to account ids, amounts to Money.
 *      Refuse if any line's amount is non-positive or money currency mismatches.
 *   5. Verify debit total == credit total. Refuse otherwise.
 *      (Defense-in-depth duplicates @taxora/accounting/assertBalanced.)
 *   6. Resolve artifacts and obligations.
 *   7. Return an ExecutionResult containing the entire audit trail.
 */

import { Money as M } from '@taxora/tax-rules';
import type {
  ExecutionContext, ExecutionResult, Inputs, RuntimeValue,
  TransactionTemplate, ExecutedJournalLine, ExecutedArtifact, ExecutedObligation,
  ArtifactFieldValue,
} from './types.js';
import { EvaluationError } from './types.js';
import { parse } from './parser.js';
import { evaluate, type Scope } from './evaluator.js';
import {
  RBool, RDate, RMoney, RNumber, RObject, RString, RNull,
  asBoolean, asMoney, asString,
} from './runtime.js';
import { DEFAULT_BUILTINS, type BuiltinFn } from './builtins.js';

export interface ExecuteOptions {
  /** Override / extend the default builtins (e.g. for testing). */
  builtins?: Record<string, BuiltinFn>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function execute(
  template: TransactionTemplate,
  inputs: Inputs,
  context: ExecutionContext,
  opts: ExecuteOptions = {},
): ExecutionResult {
  // 1. Validate inputs.
  const vars: Record<string, RuntimeValue> = {};
  for (const spec of template.inputs) {
    const raw = inputs[spec.name];
    if (raw === undefined || raw === null) {
      if (spec.required === false) { vars[spec.name] = RNull; continue; }
      throw new EvaluationError(`required input '${spec.name}' is missing`, `template:${template.code}`);
    }
    vars[spec.name] = coerceInput(raw, spec.kind, `${template.code}.${spec.name}`);
  }

  // 2. Build scope.
  const builtins = { ...DEFAULT_BUILTINS, ...(opts.builtins ?? {}) };
  const scope: Scope = { vars, builtins, context };

  // 3. Computations (sequential; later ones may reference earlier).
  for (const c of template.computations) {
    const ast = parse(c.expr);
    const v = evaluate(ast, scope, `template:${template.code}.compute:${c.name}`);
    if (c.name in scope.vars && !template.inputs.find((i) => i.name === c.name)) {
      throw new EvaluationError(`duplicate computation name '${c.name}'`, `template:${template.code}`);
    }
    scope.vars[c.name] = v;
  }

  // 4. Journal lines.
  const lines: ExecutedJournalLine[] = [];
  let debit  = M.zero();
  let credit = M.zero();
  for (let idx = 0; idx < template.journal.length; idx++) {
    const tpl = template.journal[idx]!;
    const path = `template:${template.code}.journal[${idx}]`;
    if (tpl.if) {
      const cond = evaluate(parse(tpl.if), scope, `${path}.if`);
      if (!asBoolean(cond, `${path}.if`)) continue;
    }
    const accountVal = evaluate(parse(tpl.account), scope, `${path}.account`);
    const accountId = asString(accountVal, `${path}.account`);
    if (!UUID_RE.test(accountId)) {
      throw new EvaluationError(
        `account expression must resolve to a uuid; got '${accountId}'. ` +
        `Use account('TAX_PURPOSE') or accountByCode('1.x.y.z') in the template.`,
        `${path}.account`,
      );
    }
    const amountVal = evaluate(parse(tpl.amount), scope, `${path}.amount`);
    const amount = asMoney(amountVal, `${path}.amount`);
    if (amount.amount <= 0n) {
      throw new EvaluationError(
        `journal line amount must be > 0 (got ${M.toRupiah(amount)}). ` +
        `Wrap with an 'if' clause when the line is conditional.`,
        path,
      );
    }
    const line: ExecutedJournalLine = { side: tpl.side, accountId, amount };
    if (tpl.description) {
      line.description = asString(evaluate(parse(tpl.description), scope, `${path}.description`), `${path}.description`);
    }
    lines.push(line);
    if (tpl.side === 'DEBIT') debit  = M.add(debit, amount);
    else                      credit = M.add(credit, amount);
  }

  if (lines.length < 2) {
    throw new EvaluationError(
      `template '${template.code}' produced only ${lines.length} line(s); a journal needs ≥ 2`,
      `template:${template.code}`,
    );
  }
  if (!M.eq(debit, credit)) {
    throw new EvaluationError(
      `template '${template.code}' produced unbalanced journal: ` +
      `debit=${M.toRupiah(debit)} credit=${M.toRupiah(credit)} delta=${M.toRupiah(M.sub(debit, credit))}`,
      `template:${template.code}`,
    );
  }

  // 5. Artifacts.
  const artifacts: ExecutedArtifact[] = [];
  for (let idx = 0; idx < (template.artifacts ?? []).length; idx++) {
    const tpl = template.artifacts![idx]!;
    const path = `template:${template.code}.artifact[${idx}]`;
    if (tpl.if) {
      const cond = evaluate(parse(tpl.if), scope, `${path}.if`);
      if (!asBoolean(cond, `${path}.if`)) continue;
    }
    const fields: Record<string, ArtifactFieldValue> = {};
    for (const [k, expr] of Object.entries(tpl.fields)) {
      const v = evaluate(parse(expr), scope, `${path}.fields.${k}`);
      fields[k] = runtimeToPlain(v);
    }
    artifacts.push({ type: tpl.type, fields });
  }

  // 6. Obligations.
  const obligations: ExecutedObligation[] = [];
  for (let idx = 0; idx < (template.obligations ?? []).length; idx++) {
    const tpl = template.obligations![idx]!;
    const path = `template:${template.code}.obligation[${idx}]`;
    if (tpl.if) {
      const cond = evaluate(parse(tpl.if), scope, `${path}.if`);
      if (!asBoolean(cond, `${path}.if`)) continue;
    }
    // Anchor: prefer 'paymentDate' or 'issueDate' if the template declared it; else today.
    const anchor =
      (scope.vars['paymentDate']?.kind === 'date' && scope.vars['paymentDate'].value) ||
      (scope.vars['issueDate']?.kind === 'date' && scope.vars['issueDate'].value) ||
      new Date();
    const due = builtins['dueDate']!([RDate(anchor), RNumber(tpl.dueDay)], context);
    if (due.kind !== 'date') throw new EvaluationError(`dueDate did not return a date`, path);
    const obligation: ExecutedObligation = { kind: tpl.kind, dueDate: due.value };
    if (tpl.amount) {
      obligation.amount = asMoney(evaluate(parse(tpl.amount), scope, `${path}.amount`), `${path}.amount`);
    }
    obligations.push(obligation);
  }

  // 7. Build result.
  return {
    templateCode: template.code,
    templateVersion: template.version,
    journal: {
      memo: undefined,
      referenceType: 'TEMPLATE',
      lines,
    },
    artifacts,
    obligations,
    computed: scope.vars,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function coerceInput(raw: unknown, kind: 'string' | 'number' | 'money' | 'boolean' | 'date' | 'uuid', path: string): RuntimeValue {
  switch (kind) {
    case 'string':
      if (typeof raw === 'string') return RString(raw);
      throw new EvaluationError(`expected string, got ${typeof raw}`, path);
    case 'uuid':
      if (typeof raw === 'string' && UUID_RE.test(raw)) return RString(raw);
      throw new EvaluationError(`expected uuid string, got ${String(raw)}`, path);
    case 'number':
      if (typeof raw === 'number' && Number.isFinite(raw)) return RNumber(raw);
      if (typeof raw === 'bigint') return RNumber(Number(raw));
      throw new EvaluationError(`expected number, got ${typeof raw}`, path);
    case 'boolean':
      if (typeof raw === 'boolean') return RBool(raw);
      throw new EvaluationError(`expected boolean, got ${typeof raw}`, path);
    case 'date':
      if (raw instanceof Date) return RDate(raw);
      if (typeof raw === 'string') {
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) throw new EvaluationError(`invalid date '${raw}'`, path);
        return RDate(d);
      }
      throw new EvaluationError(`expected date, got ${typeof raw}`, path);
    case 'money':
      if (typeof raw === 'object' && raw !== null && 'amount' in raw && 'currency' in raw) {
        return RMoney(raw as M.Money);
      }
      try {
        if (typeof raw === 'number') return RMoney(M.fromRupiah(raw));
        if (typeof raw === 'string') return RMoney(M.fromRupiah(raw));
      } catch (e) {
        throw new EvaluationError(`expected money, got invalid value: ${(e as Error).message}`, path);
      }
      throw new EvaluationError(`expected money, got ${typeof raw}`, path);
  }
}

function runtimeToPlain(v: RuntimeValue): ArtifactFieldValue {
  switch (v.kind) {
    case 'null':    return null;
    case 'number':  return v.value;
    case 'string':  return v.value;
    case 'boolean': return v.value;
    case 'money':   return v.value;
    case 'date':    return v.value;
    case 'rate':    return v.value;
    case 'object':  return v.value as Record<string, unknown>;
  }
}
