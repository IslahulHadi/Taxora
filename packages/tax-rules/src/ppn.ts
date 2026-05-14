import { mulRate, sub, type Money, zero } from './money.js';
import type { TaxRuleRegistry } from './registry.js';

export type PpnTreatment =
  | 'NORMAL'              // PPN dipungut atas DPP = harga jual
  | 'NILAI_LAIN_GENERAL'  // DPP = 11/12 × harga jual (PMK 131/2024)
  | 'DTP'                 // PPN ditanggung pemerintah; tetap dihitung tapi tidak dibayar pembeli
  | 'NON_PPN';            // bukan BKP/JKP atau PKP yang membebaskan

export interface PpnRatePayload {
  rate: { num: number; den: number }; // e.g. { num: 12, den: 100 }
}

export interface PpnDppNilaiLainPayload {
  numerator: number;   // 11
  denominator: number; // 12
}

export interface PpnInput {
  hargaJual: Money;
  treatment: PpnTreatment;
  date: Date;
  registry: TaxRuleRegistry;
}

export interface PpnResult {
  dpp: Money;
  ppn: Money;
}

export function calcPpn(input: PpnInput): PpnResult {
  const { hargaJual, treatment, date, registry } = input;

  if (treatment === 'NON_PPN') {
    return { dpp: hargaJual, ppn: zero(hargaJual.currency) };
  }

  const rateRule = registry.lookup<PpnRatePayload>('PPN_RATE', date);

  if (treatment === 'NILAI_LAIN_GENERAL') {
    const nl = registry.lookup<PpnDppNilaiLainPayload>('PPN_DPP_NILAI_LAIN_GENERAL', date);
    const dpp = mulRate(hargaJual, { num: nl.numerator, den: nl.denominator });
    const ppn = mulRate(dpp, rateRule.rate);
    return { dpp, ppn };
  }

  // NORMAL or DTP: harga is treated as DPP
  const ppn = mulRate(hargaJual, rateRule.rate);
  return { dpp: hargaJual, ppn };
}

/**
 * Reconcile PPN Masukan vs Keluaran for a period.
 * Returns positive if Kurang Bayar (must setor), negative if Lebih Bayar.
 */
export function reconcilePpn(input: { keluaran: Money; masukanCreditable: Money }): Money {
  return sub(input.keluaran, input.masukanCreditable);
}
