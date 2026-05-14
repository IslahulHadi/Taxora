/**
 * Money — fixed-point decimal arithmetic, scale 4.
 * We never use `number` for money. All operations operate on bigint scaled by 10_000.
 */
export const MONEY_SCALE = 4n;
const SCALE_FACTOR = 10000n;

export interface Money {
  readonly amount: bigint; // scaled by 10_000 (4 decimals)
  readonly currency: 'IDR';
}

export const zero = (currency: 'IDR' = 'IDR'): Money => ({ amount: 0n, currency });

export const fromRupiah = (rupiah: number | string, currency: 'IDR' = 'IDR'): Money => {
  const s = typeof rupiah === 'number' ? rupiah.toFixed(4) : rupiah;
  if (!/^-?\d+(\.\d{1,4})?$/.test(s)) {
    throw new Error(`Invalid money string: ${s}`);
  }
  const parts = s.split('.');
  const whole = parts[0] ?? '0';
  const frac = parts[1] ?? '';
  const padded = (frac + '0000').slice(0, 4);
  const sign = whole.startsWith('-') ? -1n : 1n;
  const wholeAbs = whole.replace('-', '');
  const amount = sign * (BigInt(wholeAbs) * SCALE_FACTOR + BigInt(padded));
  return { amount, currency };
};

export const toRupiah = (m: Money): string => {
  const sign = m.amount < 0n ? '-' : '';
  const abs = m.amount < 0n ? -m.amount : m.amount;
  const whole = abs / SCALE_FACTOR;
  const frac = (abs % SCALE_FACTOR).toString().padStart(4, '0').replace(/0+$/, '');
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
};

export const add = (a: Money, b: Money): Money => {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
};

export const sub = (a: Money, b: Money): Money => {
  assertSameCurrency(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
};

/**
 * Multiply by a rational rate without floating point.
 * `rate` is given as { num, den }, e.g. PPN 12% = { num: 12, den: 100 }.
 * Banker's rounding (half-to-even) at scale 4.
 */
export const mulRate = (m: Money, rate: { num: bigint | number; den: bigint | number }): Money => {
  const num = BigInt(rate.num);
  const den = BigInt(rate.den);
  if (den === 0n) throw new Error('Rate denominator is zero');
  const product = m.amount * num;
  const q = product / den;
  const r = product % den;
  // half-to-even rounding
  const twiceR = (r < 0n ? -r : r) * 2n;
  let rounded = q;
  if (twiceR > (den < 0n ? -den : den)) {
    rounded += product < 0n ? -1n : 1n;
  } else if (twiceR === (den < 0n ? -den : den)) {
    if (q % 2n !== 0n) rounded += product < 0n ? -1n : 1n;
  }
  return { amount: rounded, currency: m.currency };
};

export const eq = (a: Money, b: Money): boolean =>
  a.currency === b.currency && a.amount === b.amount;

export const isZero = (m: Money): boolean => m.amount === 0n;

const assertSameCurrency = (a: Money, b: Money) => {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
};
