/**
 * Runtime arithmetic and coercion rules for the rule engine.
 *
 * Money is sacred: we never lose precision and never coerce to JS number
 * for monetary computation. Mixed `money * number` becomes mulRate(money, n/1).
 */

import { Money as M } from '@taxora/tax-rules';
import type { RuntimeValue } from './types.js';
import { EvaluationError } from './types.js';

// ── constructors ────────────────────────────────────────────────────────────

export const RNumber  = (value: number): RuntimeValue          => ({ kind: 'number',  value });
export const RString  = (value: string): RuntimeValue          => ({ kind: 'string',  value });
export const RBool    = (value: boolean): RuntimeValue         => ({ kind: 'boolean', value });
export const RMoney   = (value: M.Money): RuntimeValue         => ({ kind: 'money',   value });
export const RDate    = (value: Date): RuntimeValue            => ({ kind: 'date',    value });
export const RRate    = (num: number, den: number): RuntimeValue => ({ kind: 'rate', value: { num, den } });
export const RObject  = (value: Record<string, RuntimeValue>): RuntimeValue => ({ kind: 'object', value });
export const RNull: RuntimeValue = { kind: 'null' };

// ── unwrapping ──────────────────────────────────────────────────────────────

export function asNumber(v: RuntimeValue, ctx?: string): number {
  if (v.kind === 'number') return v.value;
  if (v.kind === 'boolean') return v.value ? 1 : 0;
  throw new EvaluationError(`expected number, got ${v.kind}`, ctx);
}

export function asMoney(v: RuntimeValue, ctx?: string): M.Money {
  if (v.kind === 'money')  return v.value;
  if (v.kind === 'number') return M.fromRupiah(v.value);
  throw new EvaluationError(`expected money, got ${v.kind}`, ctx);
}

export function asBoolean(v: RuntimeValue, ctx?: string): boolean {
  if (v.kind === 'boolean') return v.value;
  if (v.kind === 'null')    return false;
  if (v.kind === 'number')  return v.value !== 0;
  if (v.kind === 'string')  return v.value !== '';
  if (v.kind === 'money')   return !M.isZero(v.value);
  throw new EvaluationError(`expected boolean, got ${v.kind}`, ctx);
}

export function asString(v: RuntimeValue, ctx?: string): string {
  if (v.kind === 'string') return v.value;
  if (v.kind === 'number') return String(v.value);
  if (v.kind === 'boolean') return v.value ? 'true' : 'false';
  if (v.kind === 'money')  return M.toRupiah(v.value);
  if (v.kind === 'null')   return '';
  throw new EvaluationError(`expected string, got ${v.kind}`, ctx);
}

// ── arithmetic dispatcher ───────────────────────────────────────────────────

export function add(a: RuntimeValue, b: RuntimeValue): RuntimeValue {
  if (a.kind === 'money' && b.kind === 'money')   return RMoney(M.add(a.value, b.value));
  if (a.kind === 'money' && b.kind === 'number')  return RMoney(M.add(a.value, M.fromRupiah(b.value)));
  if (a.kind === 'number' && b.kind === 'money')  return RMoney(M.add(M.fromRupiah(a.value), b.value));
  if (a.kind === 'number' && b.kind === 'number') return RNumber(a.value + b.value);
  if (a.kind === 'string' || b.kind === 'string') return RString(asString(a) + asString(b));
  throw new EvaluationError(`cannot add ${a.kind} + ${b.kind}`);
}

export function sub(a: RuntimeValue, b: RuntimeValue): RuntimeValue {
  if (a.kind === 'money' && b.kind === 'money')   return RMoney(M.sub(a.value, b.value));
  if (a.kind === 'money' && b.kind === 'number')  return RMoney(M.sub(a.value, M.fromRupiah(b.value)));
  if (a.kind === 'number' && b.kind === 'money')  return RMoney(M.sub(M.fromRupiah(a.value), b.value));
  if (a.kind === 'number' && b.kind === 'number') return RNumber(a.value - b.value);
  throw new EvaluationError(`cannot subtract ${a.kind} - ${b.kind}`);
}

export function mul(a: RuntimeValue, b: RuntimeValue): RuntimeValue {
  // money * rate (the canonical PPN/PPh path)
  if (a.kind === 'money' && b.kind === 'rate')    return RMoney(M.mulRate(a.value, b.value));
  if (a.kind === 'rate'  && b.kind === 'money')   return RMoney(M.mulRate(b.value, a.value));

  // money * number → treat number as rate {n/1}
  if (a.kind === 'money' && b.kind === 'number')  return RMoney(M.mulRate(a.value, asRationalFromNumber(b.value)));
  if (a.kind === 'number' && b.kind === 'money')  return RMoney(M.mulRate(b.value, asRationalFromNumber(a.value)));

  // number * number
  if (a.kind === 'number' && b.kind === 'number') return RNumber(a.value * b.value);

  // rate * rate → rate (compose, useful for "PPN * 11/12")
  if (a.kind === 'rate' && b.kind === 'rate') {
    return RRate(a.value.num * b.value.num, a.value.den * b.value.den);
  }
  // number * rate → rate
  if (a.kind === 'number' && b.kind === 'rate')   return RRate(a.value * b.value.num, b.value.den);
  if (a.kind === 'rate'   && b.kind === 'number') return RRate(a.value.num * b.value, a.value.den);

  throw new EvaluationError(`cannot multiply ${a.kind} * ${b.kind}`);
}

export function div(a: RuntimeValue, b: RuntimeValue): RuntimeValue {
  // money / number → money
  if (a.kind === 'money'  && b.kind === 'number') {
    if (b.value === 0) throw new EvaluationError('division by zero');
    return RMoney(M.mulRate(a.value, { num: 1, den: b.value }));
  }
  // money / money → number ratio (proportion)
  if (a.kind === 'money' && b.kind === 'money') {
    if (b.value.amount === 0n) throw new EvaluationError('division by zero');
    return RNumber(Number(a.value.amount) / Number(b.value.amount));
  }
  if (a.kind === 'number' && b.kind === 'number') {
    if (b.value === 0) throw new EvaluationError('division by zero');
    return RNumber(a.value / b.value);
  }
  // number / number forming a rate is handled implicitly via Number/Number; for
  // explicit rate construction prefer the rate(...) builtin (added in builtins.ts).
  throw new EvaluationError(`cannot divide ${a.kind} / ${b.kind}`);
}

// ── comparisons ─────────────────────────────────────────────────────────────

export function eq(a: RuntimeValue, b: RuntimeValue): boolean {
  if (a.kind !== b.kind) {
    // allow numeric == money via cross-coerce
    if (a.kind === 'money' && b.kind === 'number') return a.value.amount === M.fromRupiah(b.value).amount;
    if (a.kind === 'number' && b.kind === 'money') return b.value.amount === M.fromRupiah(a.value).amount;
    if (a.kind === 'null' || b.kind === 'null')    return a.kind === b.kind;
    return false;
  }
  switch (a.kind) {
    case 'number':  return a.value === (b as typeof a).value;
    case 'string':  return a.value === (b as typeof a).value;
    case 'boolean': return a.value === (b as typeof a).value;
    case 'money':   return M.eq(a.value, (b as typeof a).value);
    case 'date':    return a.value.getTime() === (b as typeof a).value.getTime();
    case 'rate': {
      const r = (b as typeof a).value;
      // cross-multiply to compare without floating point
      return a.value.num * r.den === r.num * a.value.den;
    }
    case 'null':    return true;
    default:        return false;
  }
}

export function cmp(a: RuntimeValue, b: RuntimeValue): number {
  if (a.kind === 'money' && b.kind === 'money') {
    return a.value.amount < b.value.amount ? -1 : a.value.amount > b.value.amount ? 1 : 0;
  }
  if (a.kind === 'number' && b.kind === 'number') {
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  }
  if (a.kind === 'money' && b.kind === 'number') {
    const bm = M.fromRupiah(b.value);
    return a.value.amount < bm.amount ? -1 : a.value.amount > bm.amount ? 1 : 0;
  }
  if (a.kind === 'number' && b.kind === 'money') {
    const am = M.fromRupiah(a.value);
    return am.amount < b.value.amount ? -1 : am.amount > b.value.amount ? 1 : 0;
  }
  if (a.kind === 'string' && b.kind === 'string') {
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  }
  if (a.kind === 'date' && b.kind === 'date') {
    return a.value.getTime() - b.value.getTime();
  }
  throw new EvaluationError(`cannot compare ${a.kind} and ${b.kind}`);
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a JS number to a rational suitable for mulRate.
 * For integer values this is trivial. For decimals like 0.12, we scale by the
 * minimum power of 10 needed to make num integral — preserving exactness within
 * IEEE-754 limits. Anything that loses precision is rejected loudly.
 */
function asRationalFromNumber(n: number): { num: number; den: number } {
  if (!Number.isFinite(n)) throw new EvaluationError(`non-finite number: ${n}`);
  if (Number.isInteger(n)) return { num: n, den: 1 };
  const s = n.toString();
  const dot = s.indexOf('.');
  if (dot < 0 || /e/i.test(s)) {
    throw new EvaluationError(`cannot use ${n} as exact rate; pass rate(num, den) instead`);
  }
  const decimals = s.length - dot - 1;
  const den = 10 ** decimals;
  const num = Math.round(n * den);
  return { num, den };
}

export { asRationalFromNumber };
