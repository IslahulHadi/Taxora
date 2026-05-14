import { mulRate, type Money } from './money.js';
import type { TaxRuleRegistry } from './registry.js';

/**
 * PPh 23 — withholding on jasa, sewa (selain tanah/bangunan), royalti, dividen, bunga, hadiah.
 *
 * Tarif:
 *   - 15%  : dividen, bunga, royalti, hadiah dan penghargaan
 *   - 2%   : sewa harta selain tanah/bangunan, jasa lainnya (PMK 141/2015)
 *   - +100% (jadi 30% atau 4%) jika rekanan tidak ber-NPWP (UU PPh ps. 23 ayat 1a)
 */

export interface Pph23TarifPayload {
  // Map kodeObjekPajak -> base rate { num, den }
  [kodeObjekPajak: string]: { num: number; den: number };
}

export interface Pph23Input {
  dpp: Money;
  kodeObjekPajak: string; // e.g. '24-104-01' (jasa lain), '24-100-01' (sewa selain T/B)
  vendorHasNpwp: boolean;
  date: Date;
  registry: TaxRuleRegistry;
}

export interface Pph23Result {
  rate: { num: number; den: number };
  amount: Money;
  effectiveRateDoubledForNoNpwp: boolean;
}

export function calcPph23(input: Pph23Input): Pph23Result {
  const tarif = input.registry.lookup<Pph23TarifPayload>('PPH23_TARIF', input.date);
  const base = tarif[input.kodeObjekPajak];
  if (!base) {
    throw new Error(
      `PPh23 tarif tidak ditemukan untuk kode objek '${input.kodeObjekPajak}' pada ${input.date
        .toISOString()
        .slice(0, 10)}. ` + `Tambahkan rule 'PPH23_TARIF' atau periksa kode objek pajak.`,
    );
  }
  const rate = input.vendorHasNpwp ? base : { num: base.num * 2, den: base.den };
  const amount = mulRate(input.dpp, rate);
  return { rate, amount, effectiveRateDoubledForNoNpwp: !input.vendorHasNpwp };
}
