import { mulRate, type Money, zero } from './money.js';
import type { TaxRuleRegistry } from './registry.js';

/**
 * PPh 21 — Tarif Efektif Rata-rata (TER), PMK 168/2023.
 *
 * Categories (based on PTKP):
 *   - A: TK/0, TK/1, K/0
 *   - B: TK/2, TK/3, K/1, K/2
 *   - C: K/3
 *
 * Monthly: PPh21 = bruto_bulanan * TER_rate(category, bracket).
 * Annual (Desember): full Pasal 17 progressive on PKP, then subtract Jan..Nov withheld.
 */

export type TerCategory = 'A' | 'B' | 'C';

export interface TerBracket {
  upTo: number;            // upper bound inclusive, in rupiah (NOT scaled). null = open.
  rate: { num: number; den: number };
}

export interface TerPayload {
  brackets: TerBracket[];  // sorted ascending by upTo
}

export interface MonthlyPph21Input {
  bruto: Money;
  category: TerCategory;
  date: Date;
  hasNpwp: boolean;        // jika tidak ber-NPWP/NIK valid: tarif 20% lebih tinggi
  registry: TaxRuleRegistry;
}

export interface MonthlyPph21Result {
  rate: { num: number; den: number };
  amount: Money;
  bracketUpTo: number | null;
  doubledForNoNpwp: boolean;
}

const TER_CODE: Record<TerCategory, string> = {
  A: 'PPH21_TER_A',
  B: 'PPH21_TER_B',
  C: 'PPH21_TER_C',
};

/**
 * Find the TER bracket for `bruto`. Returns the first bracket whose upTo >= bruto;
 * an open bracket is represented by upTo === Number.POSITIVE_INFINITY.
 */
export function findTerBracket(bruto: Money, payload: TerPayload): TerBracket {
  // bruto.amount is scaled by 10_000; bracket.upTo is in plain rupiah.
  const brutoRupiah = Number(bruto.amount / 10000n);
  for (const b of payload.brackets) {
    const upper = b.upTo === null ? Number.POSITIVE_INFINITY : b.upTo;
    if (brutoRupiah <= upper) return b;
  }
  // Defensive: should never happen if registry is well-formed (last bracket is open).
  throw new Error(`No TER bracket covers bruto=${brutoRupiah}. Check rule registry.`);
}

export function calcMonthlyPph21Ter(input: MonthlyPph21Input): MonthlyPph21Result {
  const code = TER_CODE[input.category];
  const payload = input.registry.lookup<TerPayload>(code, input.date);
  if (input.bruto.amount <= 0n) {
    return {
      rate: { num: 0, den: 1 },
      amount: zero(input.bruto.currency),
      bracketUpTo: null,
      doubledForNoNpwp: false,
    };
  }
  const bracket = findTerBracket(input.bruto, payload);
  const rate = input.hasNpwp
    ? bracket.rate
    : { num: bracket.rate.num * 12, den: bracket.rate.den * 10 }; // +20%
  const amount = mulRate(input.bruto, rate);
  return {
    rate,
    amount,
    bracketUpTo: bracket.upTo,
    doubledForNoNpwp: !input.hasNpwp,
  };
}
