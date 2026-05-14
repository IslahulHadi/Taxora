import { TaxRuleRegistry } from '../registry.js';

/**
 * Minimal seed for tests / dev. Production seed is loaded from DB
 * (`tax_rules` table), maintained as effective-dated migrations.
 *
 * Sources:
 *   - PPN_RATE 12% from 2025-01-01 (UU HPP)
 *   - PPN DPP Nilai Lain general 11/12 from 2025-01-01 (PMK 131/2024)
 *   - PPh 23 tariffs from UU PPh ps. 23 + PMK 141/2015 (subset for demo)
 *   - PPh 21 TER A excerpt from PMK 168/2023 Lampiran (truncated for brevity)
 *
 * NOTE: Partial set, suitable only for unit tests and local dev.
 */
export function seedRegistry(): TaxRuleRegistry {
  const r = new TaxRuleRegistry();

  // PPN
  r.add({
    code: 'PPN_RATE',
    effectiveFrom: new Date('2025-01-01'),
    payload: { rate: { num: 12, den: 100 } },
    sourceRef: 'UU HPP / PMK 131/2024',
  });
  r.add({
    code: 'PPN_RATE',
    effectiveFrom: new Date('2022-04-01'),
    effectiveTo: new Date('2025-01-01'),
    payload: { rate: { num: 11, den: 100 } },
    sourceRef: 'UU HPP transisi',
  });
  r.add({
    code: 'PPN_DPP_NILAI_LAIN_GENERAL',
    effectiveFrom: new Date('2025-01-01'),
    payload: { numerator: 11, denominator: 12 },
    sourceRef: 'PMK 131/2024',
  });

  // PPh 23 (subset)
  r.add({
    code: 'PPH23_TARIF',
    effectiveFrom: new Date('2009-01-01'),
    payload: {
      // 15%
      '24-001-01': { num: 15, den: 100 }, // dividen
      '24-002-01': { num: 15, den: 100 }, // bunga
      '24-003-01': { num: 15, den: 100 }, // royalti
      '24-004-01': { num: 15, den: 100 }, // hadiah
      // 2%
      '24-100-01': { num: 2, den: 100 },  // sewa selain T/B
      '24-104-01': { num: 2, den: 100 },  // jasa lain (PMK 141/2015)
    },
    sourceRef: 'UU PPh ps. 23 + PMK 141/2015',
  });

  // PPh 21 TER A (excerpt — production set has 30+ brackets per category)
  r.add({
    code: 'PPH21_TER_A',
    effectiveFrom: new Date('2024-01-01'),
    payload: {
      brackets: [
        { upTo: 5_400_000,  rate: { num: 0,    den: 10000 } },
        { upTo: 5_650_000,  rate: { num: 25,   den: 10000 } },
        { upTo: 5_950_000,  rate: { num: 50,   den: 10000 } },
        { upTo: 6_300_000,  rate: { num: 75,   den: 10000 } },
        { upTo: 6_750_000,  rate: { num: 100,  den: 10000 } },
        { upTo: 7_500_000,  rate: { num: 125,  den: 10000 } },
        { upTo: 8_550_000,  rate: { num: 150,  den: 10000 } },
        { upTo: 9_650_000,  rate: { num: 175,  den: 10000 } },
        { upTo: 10_050_000, rate: { num: 200,  den: 10000 } },
        { upTo: 10_350_000, rate: { num: 225,  den: 10000 } },
        { upTo: 10_700_000, rate: { num: 250,  den: 10000 } },
        { upTo: 11_050_000, rate: { num: 300,  den: 10000 } },
        { upTo: 11_600_000, rate: { num: 350,  den: 10000 } },
        { upTo: 12_500_000, rate: { num: 400,  den: 10000 } },
        { upTo: 13_750_000, rate: { num: 500,  den: 10000 } },
        { upTo: 15_100_000, rate: { num: 600,  den: 10000 } },
        { upTo: 16_950_000, rate: { num: 700,  den: 10000 } },
        { upTo: 19_750_000, rate: { num: 800,  den: 10000 } },
        { upTo: 24_150_000, rate: { num: 900,  den: 10000 } },
        { upTo: 26_450_000, rate: { num: 1000, den: 10000 } },
        // open bracket (production has more steps; truncated for unit-test seed)
        { upTo: Number.MAX_SAFE_INTEGER, rate: { num: 3400, den: 10000 } },
      ],
    },
    sourceRef: 'PMK 168/2023 Lampiran (excerpt)',
  });

  return r;
}
