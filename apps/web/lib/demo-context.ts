/**
 * Demo ExecutionContext + TaxRuleRegistry for the playground.
 *
 * IMPORTANT: This is the SAME engine + same registry shape used by the
 * apps/api seed and the rule-engine's own unit tests. The playground
 * therefore exercises real production code paths — what you see here is
 * exactly what would happen when a real user posts a real transaction.
 */

import { TaxRuleRegistry } from '@taxora/tax-rules';
import type { ExecutionContext } from '@taxora/rule-engine';

// Stable demo uuids for the default Indonesian SMB Chart of Accounts.
// Mirrors packages/accounting/src/chart-of-accounts.ts.
export const DEMO_ACCOUNTS = {
  KAS:             '00000000-0000-0000-0000-00000000a001',
  BANK:            '00000000-0000-0000-0000-00000000a002', // 1.1.02.001
  PIUTANG:         '00000000-0000-0000-0000-00000000a003', // 1.1.03.001
  PPN_MASUKAN:     '00000000-0000-0000-0000-00000000a004',
  HUTANG_PPN:      '00000000-0000-0000-0000-00000000a102',
  HUTANG_PPH21:    '00000000-0000-0000-0000-00000000a103',
  HUTANG_PPH23:    '00000000-0000-0000-0000-00000000a104',
  HUTANG_PPH4_2:   '00000000-0000-0000-0000-00000000a105',
  PENDAPATAN_JASA: '00000000-0000-0000-0000-00000000a401', // 4.1.01.001
  BEBAN_GAJI:      '00000000-0000-0000-0000-00000000a501',
  BEBAN_SEWA:      '00000000-0000-0000-0000-00000000a502',
  BEBAN_JASA_PROF: '00000000-0000-0000-0000-00000000a503', // 5.1.03.001
} as const;

export const ACCOUNT_NAMES: Record<string, string> = {
  [DEMO_ACCOUNTS.KAS]:             'Kas',
  [DEMO_ACCOUNTS.BANK]:            'Bank',
  [DEMO_ACCOUNTS.PIUTANG]:         'Piutang Usaha',
  [DEMO_ACCOUNTS.PPN_MASUKAN]:     'PPN Masukan',
  [DEMO_ACCOUNTS.HUTANG_PPN]:      'Hutang PPN',
  [DEMO_ACCOUNTS.HUTANG_PPH21]:    'Hutang PPh 21',
  [DEMO_ACCOUNTS.HUTANG_PPH23]:    'Hutang PPh 23',
  [DEMO_ACCOUNTS.HUTANG_PPH4_2]:   'Hutang PPh 4(2)',
  [DEMO_ACCOUNTS.PENDAPATAN_JASA]: 'Pendapatan Jasa',
  [DEMO_ACCOUNTS.BEBAN_GAJI]:      'Beban Gaji',
  [DEMO_ACCOUNTS.BEBAN_SEWA]:      'Beban Sewa',
  [DEMO_ACCOUNTS.BEBAN_JASA_PROF]: 'Beban Jasa Profesional',
};

export function buildDemoRegistry(): TaxRuleRegistry {
  const r = new TaxRuleRegistry();

  // PPN — UU HPP transition 11% → 12% from 2025-01-01
  r.add({
    code: 'PPN_RATE',
    effectiveFrom: new Date('2022-04-01'),
    effectiveTo:   new Date('2025-01-01'),
    payload: { rate: { num: 11, den: 100 } },
    sourceRef: 'UU HPP transisi 2022-2024',
  });
  r.add({
    code: 'PPN_RATE',
    effectiveFrom: new Date('2025-01-01'),
    payload: { rate: { num: 12, den: 100 } },
    sourceRef: 'UU HPP / PMK 131/2024',
  });
  r.add({
    code: 'PPN_DPP_NILAI_LAIN_GENERAL',
    effectiveFrom: new Date('2025-01-01'),
    payload: { numerator: 11, denominator: 12 },
    sourceRef: 'PMK 131/2024',
  });

  // PPh 23 — subset of kode objek pajak
  r.add({
    code: 'PPH23_TARIF',
    effectiveFrom: new Date('2009-01-01'),
    payload: {
      '24-001-01': { num: 15, den: 100 }, // dividen
      '24-002-01': { num: 15, den: 100 }, // bunga
      '24-003-01': { num: 15, den: 100 }, // royalti
      '24-100-01': { num: 2,  den: 100 }, // sewa selain T/B
      '24-104-01': { num: 2,  den: 100 }, // jasa lain (PMK 141/2015)
    },
    sourceRef: 'UU PPh ps. 23 + PMK 141/2015',
  });

  return r;
}

export const KODE_OBJEK_PAJAK_OPTIONS = [
  { code: '24-104-01', label: 'Jasa lain (2%)',                expense: DEMO_ACCOUNTS.BEBAN_JASA_PROF },
  { code: '24-100-01', label: 'Sewa selain tanah/bangunan (2%)', expense: DEMO_ACCOUNTS.BEBAN_SEWA },
  { code: '24-003-01', label: 'Royalti (15%)',                 expense: DEMO_ACCOUNTS.BEBAN_JASA_PROF },
  { code: '24-002-01', label: 'Bunga (15%)',                   expense: DEMO_ACCOUNTS.BEBAN_JASA_PROF },
  { code: '24-001-01', label: 'Dividen (15%)',                 expense: DEMO_ACCOUNTS.BEBAN_JASA_PROF },
];

export function buildDemoContext(): ExecutionContext {
  const purpose: Record<string, string> = {
    PPN_MASUKAN:    DEMO_ACCOUNTS.PPN_MASUKAN,
    PPN_KELUARAN:   DEMO_ACCOUNTS.HUTANG_PPN,
    PPH21_PAYABLE:  DEMO_ACCOUNTS.HUTANG_PPH21,
    PPH23_PAYABLE:  DEMO_ACCOUNTS.HUTANG_PPH23,
    PPH4_2_PAYABLE: DEMO_ACCOUNTS.HUTANG_PPH4_2,
  };
  const byCode: Record<string, string> = {
    '1.1.01.001': DEMO_ACCOUNTS.KAS,
    '1.1.02.001': DEMO_ACCOUNTS.BANK,
    '1.1.03.001': DEMO_ACCOUNTS.PIUTANG,
    '4.1.01.001': DEMO_ACCOUNTS.PENDAPATAN_JASA,
    '5.1.03.001': DEMO_ACCOUNTS.BEBAN_JASA_PROF,
  };
  const expenseByKode: Record<string, string> =
    Object.fromEntries(KODE_OBJEK_PAJAK_OPTIONS.map((o) => [o.code, o.expense]));

  return {
    tenantId: '00000000-0000-0000-0000-000000000001',
    registry: buildDemoRegistry(),
    resolveAccountByTaxPurpose: (p) => purpose[p],
    resolveAccountByCode:       (c) => byCode[c],
    resolveExpenseAccountForKodeObjek: (k) => expenseByKode[k],
    resolveParty:               () => undefined,
  };
}
