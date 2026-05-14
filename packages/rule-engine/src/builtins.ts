/**
 * Built-in functions exposed to template expressions.
 *
 * These are the ONLY way templates can read tax rates, accounts, or peraturan-
 * derived values. Arbitrary code is not possible. New builtins should be small,
 * pure, and have a single responsibility.
 */

import { Money as M, calcPpn, calcPph23, type PpnTreatment } from '@taxora/tax-rules';
import type { ExecutionContext, RuntimeValue } from './types.js';
import { EvaluationError } from './types.js';
import {
  RBool, RMoney, RNumber, RObject, RRate, RString, RDate,
  asBoolean, asMoney, asNumber, asString,
} from './runtime.js';

export type BuiltinFn = (args: RuntimeValue[], ctx: ExecutionContext) => RuntimeValue;

/**
 * Coerce a runtime value to Date, accepting native Date or ISO string.
 */
function asDate(v: RuntimeValue, ctxLabel: string): Date {
  if (v.kind === 'date') return v.value;
  if (v.kind === 'string') {
    const d = new Date(v.value);
    if (Number.isNaN(d.getTime())) throw new EvaluationError(`invalid date "${v.value}"`, ctxLabel);
    return d;
  }
  throw new EvaluationError(`expected date, got ${v.kind}`, ctxLabel);
}

function arity(name: string, args: RuntimeValue[], n: number) {
  if (args.length !== n) {
    throw new EvaluationError(`${name}() expects ${n} args, got ${args.length}`);
  }
}

/**
 * The default builtin set. Tenants/admins can extend by passing extras to the engine.
 */
export const DEFAULT_BUILTINS: Record<string, BuiltinFn> = {
  /** rate(num, den) → constructs an exact rational rate. */
  rate(args) {
    arity('rate', args, 2);
    const num = asNumber(args[0]!, 'rate.num');
    const den = asNumber(args[1]!, 'rate.den');
    if (den === 0) throw new EvaluationError('rate denominator cannot be zero');
    return RRate(num, den);
  },

  /** money(rupiah) → constructs Money from a number. */
  money(args) {
    arity('money', args, 1);
    return RMoney(M.fromRupiah(asNumber(args[0]!, 'money.amount')));
  },

  /** ruleRate(code, asOfDate) → looks up a 'rate' shaped tax rule. */
  ruleRate(args, ctx) {
    arity('ruleRate', args, 2);
    const code = asString(args[0]!, 'ruleRate.code');
    const date = asDate(args[1]!, 'ruleRate.date');
    const payload = ctx.registry.lookup<{ rate: { num: number; den: number } }>(code, date);
    return RRate(payload.rate.num, payload.rate.den);
  },

  /** ppn(harga, treatment, asOfDate) → returns money (PPN amount). Uses tax-rules calcPpn. */
  ppn(args, ctx) {
    arity('ppn', args, 3);
    const harga = asMoney(args[0]!, 'ppn.harga');
    const treatment = asString(args[1]!, 'ppn.treatment') as PpnTreatment;
    const date = asDate(args[2]!, 'ppn.date');
    const result = calcPpn({ hargaJual: harga, treatment, date, registry: ctx.registry });
    return RObject({
      dpp: RMoney(result.dpp),
      ppn: RMoney(result.ppn),
    });
  },

  /** pph23(dpp, kodeObjekPajak, vendorHasNpwp, asOfDate) → returns object {amount, rate}. */
  pph23(args, ctx) {
    arity('pph23', args, 4);
    const dpp = asMoney(args[0]!, 'pph23.dpp');
    const kode = asString(args[1]!, 'pph23.kode');
    const hasNpwp = asBoolean(args[2]!, 'pph23.hasNpwp');
    const date = asDate(args[3]!, 'pph23.date');
    const result = calcPph23({ dpp, kodeObjekPajak: kode, vendorHasNpwp: hasNpwp, date, registry: ctx.registry });
    return RObject({
      amount: RMoney(result.amount),
      rate:   RRate(result.rate.num, result.rate.den),
      doubled: RBool(result.effectiveRateDoubledForNoNpwp),
    });
  },

  /** account(taxPurpose) → returns the tenant's account id with that tax_purpose. */
  account(args, ctx) {
    arity('account', args, 1);
    const purpose = asString(args[0]!, 'account.purpose');
    const id = ctx.resolveAccountByTaxPurpose(purpose);
    if (!id) throw new EvaluationError(`no account with tax_purpose='${purpose}' for this tenant; add it via Chart of Accounts`);
    return RString(id);
  },

  /** accountByCode(code) → resolves by CoA code, e.g. '1.1.01.001'. */
  accountByCode(args, ctx) {
    arity('accountByCode', args, 1);
    const code = asString(args[0]!, 'accountByCode.code');
    const id = ctx.resolveAccountByCode(code);
    if (!id) throw new EvaluationError(`no account with code='${code}' for this tenant`);
    return RString(id);
  },

  /** expenseAccount(kodeObjekPajak) → expense account assignable for that PPh-23 kode. */
  expenseAccount(args, ctx) {
    arity('expenseAccount', args, 1);
    const kode = asString(args[0]!, 'expenseAccount.kode');
    const id = ctx.resolveExpenseAccountForKodeObjek(kode);
    if (!id) throw new EvaluationError(`no expense account mapped for kode_objek_pajak='${kode}'`);
    return RString(id);
  },

  /**
   * dueDate(refDate, dayOfNextMonth) → returns Date for that day of the month
   * AFTER refDate's month. e.g. dueDate('2025-06-15', 10) → 2025-07-10.
   * Used for setoran/pelaporan deadlines.
   */
  dueDate(args) {
    arity('dueDate', args, 2);
    const ref = asDate(args[0]!, 'dueDate.ref');
    const day = asNumber(args[1]!, 'dueDate.day');
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new EvaluationError(`dueDay must be integer 1..31, got ${day}`);
    }
    // Use UTC to keep date math timezone-stable.
    const y = ref.getUTCFullYear();
    const m = ref.getUTCMonth() + 1; // next month index
    const result = new Date(Date.UTC(y, m, Math.min(day, daysInMonth(y, m))));
    return RDate(result);
  },

  /** today() → Date (UTC midnight today). Avoid in expressions; prefer passing dates as inputs. */
  today() {
    const t = new Date();
    return RDate(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())));
  },

  /** min(a, b) — number or money. */
  min(args) {
    arity('min', args, 2);
    const a = args[0]!; const b = args[1]!;
    if (a.kind === 'money' && b.kind === 'money') {
      return a.value.amount <= b.value.amount ? a : b;
    }
    return RNumber(Math.min(asNumber(a, 'min.a'), asNumber(b, 'min.b')));
  },

  /** max(a, b) — number or money. */
  max(args) {
    arity('max', args, 2);
    const a = args[0]!; const b = args[1]!;
    if (a.kind === 'money' && b.kind === 'money') {
      return a.value.amount >= b.value.amount ? a : b;
    }
    return RNumber(Math.max(asNumber(a, 'max.a'), asNumber(b, 'max.b')));
  },
};

function daysInMonth(year: number, monthIndex0: number) {
  // monthIndex0: 0..11 in JS Date semantics (here we already passed month+1)
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}
