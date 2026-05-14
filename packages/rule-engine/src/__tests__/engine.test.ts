import { describe, it, expect } from 'vitest';
import { Money as M, TaxRuleRegistry } from '@taxora/tax-rules';
import { execute } from '../engine.js';
import type { ExecutionContext, TransactionTemplate } from '../types.js';
import { EvaluationError } from '../types.js';

// Canonical accounts from default Indonesian SMB CoA seed.
const ACC = {
  KAS:                '00000000-0000-0000-0000-00000000a002', // 1.1.02.001 Bank
  PIUTANG:            '00000000-0000-0000-0000-00000000a003', // 1.1.03.001 Piutang
  PPN_MASUKAN:        '00000000-0000-0000-0000-00000000a004', // 1.1.04.001
  HUTANG_PPN:         '00000000-0000-0000-0000-00000000a102', // 2.1.02.001
  HUTANG_PPH23:       '00000000-0000-0000-0000-00000000a104', // 2.1.04.001
  PENDAPATAN_JASA:    '00000000-0000-0000-0000-00000000a401', // 4.1.01.001
  BEBAN_JASA_PROF:    '00000000-0000-0000-0000-00000000a503', // 5.1.03.001
};

function makeRegistry(): TaxRuleRegistry {
  const r = new TaxRuleRegistry();
  r.add({
    code: 'PPN_RATE', effectiveFrom: new Date('2025-01-01'),
    payload: { rate: { num: 12, den: 100 } }, sourceRef: 'UU HPP',
  });
  r.add({
    code: 'PPN_DPP_NILAI_LAIN_GENERAL', effectiveFrom: new Date('2025-01-01'),
    payload: { numerator: 11, denominator: 12 }, sourceRef: 'PMK 131/2024',
  });
  r.add({
    code: 'PPH23_TARIF', effectiveFrom: new Date('2009-01-01'),
    payload: {
      '24-104-01': { num: 2, den: 100 }, // jasa lain
      '24-003-01': { num: 15, den: 100 }, // royalti
    },
  });
  return r;
}

function makeContext(): ExecutionContext {
  const purpose: Record<string, string> = {
    PPN_MASUKAN:    ACC.PPN_MASUKAN,
    PPN_KELUARAN:   ACC.HUTANG_PPN,
    PPH23_PAYABLE:  ACC.HUTANG_PPH23,
  };
  const byCode: Record<string, string> = {
    '1.1.02.001': ACC.KAS,
    '1.1.03.001': ACC.PIUTANG,
    '4.1.01.001': ACC.PENDAPATAN_JASA,
    '5.1.03.001': ACC.BEBAN_JASA_PROF,
  };
  return {
    tenantId: '00000000-0000-0000-0000-000000000001',
    registry: makeRegistry(),
    resolveAccountByTaxPurpose: (p) => purpose[p],
    resolveAccountByCode: (c) => byCode[c],
    resolveExpenseAccountForKodeObjek: (kode) => {
      // Demo mapping: jasa-lain & royalti both go to Beban Jasa Profesional.
      if (kode.startsWith('24-')) return ACC.BEBAN_JASA_PROF;
      return undefined;
    },
    resolveParty: () => undefined,
  };
}

// ─── Canonical templates ─────────────────────────────────────────────────────

const TPL_PAY_VENDOR_JASA_PPH23: TransactionTemplate = {
  code: 'PAY_VENDOR_JASA_PPH23',
  version: 1,
  effectiveFrom: '2025-01-01',
  inputs: [
    { name: 'amountBruto',    kind: 'money',   required: true },
    { name: 'isPpn',          kind: 'boolean', required: true },
    { name: 'kodeObjekPajak', kind: 'string',  required: true },
    { name: 'vendorHasNpwp',  kind: 'boolean', required: true },
    { name: 'paymentDate',    kind: 'date',    required: true },
  ],
  computations: [
    { name: 'dpp',       expr: 'amountBruto' },
    { name: 'ppnAmt',    expr: 'isPpn ? dpp * ruleRate("PPN_RATE", paymentDate) : money(0)' },
    { name: 'wht',       expr: 'pph23(dpp, kodeObjekPajak, vendorHasNpwp, paymentDate)' },
    { name: 'pph23Amt',  expr: 'wht.amount' },
    { name: 'netToPay',  expr: 'dpp + ppnAmt - pph23Amt' },
  ],
  journal: [
    { side: 'DEBIT',  account: 'expenseAccount(kodeObjekPajak)', amount: 'dpp' },
    { side: 'DEBIT',  account: 'account("PPN_MASUKAN")',          amount: 'ppnAmt',   if: 'isPpn' },
    { side: 'CREDIT', account: 'account("PPH23_PAYABLE")',        amount: 'pph23Amt' },
    { side: 'CREDIT', account: 'accountByCode("1.1.02.001")',     amount: 'netToPay' },
  ],
  artifacts: [
    {
      type: 'BUKTI_POTONG_PPH23',
      fields: {
        dpp:   'dpp',
        rate:  'wht.rate',
        amount:'pph23Amt',
        kodeObjekPajak: 'kodeObjekPajak',
      },
    },
  ],
  obligations: [
    { kind: 'SETOR_PPH23', dueDay: 10, amount: 'pph23Amt' },
    { kind: 'LAPOR_PPH23', dueDay: 20 },
  ],
};

const TPL_ISSUE_INVOICE_PPN: TransactionTemplate = {
  code: 'ISSUE_INVOICE_PPN',
  version: 1,
  effectiveFrom: '2025-01-01',
  inputs: [
    { name: 'subtotal',  kind: 'money',  required: true },
    { name: 'treatment', kind: 'string', required: true }, // PpnTreatment
    { name: 'issueDate', kind: 'date',   required: true },
  ],
  computations: [
    { name: 'calc',  expr: 'ppn(subtotal, treatment, issueDate)' },
    { name: 'dpp',   expr: 'calc.dpp' },
    { name: 'ppnAmt',expr: 'calc.ppn' },
    { name: 'total', expr: 'dpp + ppnAmt' },
  ],
  journal: [
    { side: 'DEBIT',  account: 'accountByCode("1.1.03.001")',  amount: 'total' },
    { side: 'CREDIT', account: 'accountByCode("4.1.01.001")',  amount: 'dpp' },
    { side: 'CREDIT', account: 'account("PPN_KELUARAN")',       amount: 'ppnAmt', if: 'treatment != "NON_PPN"' },
  ],
  artifacts: [
    { type: 'FAKTUR_PAJAK', if: 'treatment != "NON_PPN"', fields: { dpp: 'dpp', ppn: 'ppnAmt' } },
  ],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('engine — PAY_VENDOR_JASA_PPH23', () => {
  const ctx = makeContext();

  it('jasa lain Rp10.000.000 + PPN, vendor ber-NPWP', () => {
    const result = execute(TPL_PAY_VENDOR_JASA_PPH23, {
      amountBruto: M.fromRupiah('10000000'),
      isPpn: true,
      kodeObjekPajak: '24-104-01',
      vendorHasNpwp: true,
      paymentDate: new Date('2025-06-15'),
    }, ctx);

    // Computed values for audit:
    //   dpp     = 10.000.000
    //   ppn     = 12% * 10.000.000 = 1.200.000
    //   pph23   =  2% * 10.000.000 =   200.000
    //   netPay  = 11.000.000

    expect(result.computed['dpp']?.kind).toBe('money');
    expect(M.toRupiah((result.computed['ppnAmt']     as { value: M.Money }).value)).toBe('1200000');
    expect(M.toRupiah((result.computed['pph23Amt']   as { value: M.Money }).value)).toBe('200000');
    expect(M.toRupiah((result.computed['netToPay']   as { value: M.Money }).value)).toBe('11000000');

    // Journal: 4 lines, balanced.
    expect(result.journal.lines).toHaveLength(4);
    const sum = (side: 'DEBIT' | 'CREDIT') =>
      result.journal.lines.filter((l) => l.side === side).reduce((a, l) => M.add(a, l.amount), M.zero());
    expect(M.toRupiah(sum('DEBIT'))).toBe('11200000');  // beban + PPN masukan
    expect(M.toRupiah(sum('CREDIT'))).toBe('11200000'); // hutang PPh23 + Bank

    // Artifact: bukti potong PPh 23 with the right fields.
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]!.type).toBe('BUKTI_POTONG_PPH23');
    expect(result.artifacts[0]!.fields['kodeObjekPajak']).toBe('24-104-01');

    // Obligations: setor 10/07/2025, lapor 20/07/2025.
    expect(result.obligations).toHaveLength(2);
    expect(result.obligations[0]!.kind).toBe('SETOR_PPH23');
    expect(result.obligations[0]!.dueDate.toISOString().slice(0, 10)).toBe('2025-07-10');
    expect(result.obligations[1]!.kind).toBe('LAPOR_PPH23');
    expect(result.obligations[1]!.dueDate.toISOString().slice(0, 10)).toBe('2025-07-20');
  });

  it('vendor TANPA NPWP: PPh 23 efektif 4% (tarif 100% lebih tinggi)', () => {
    const result = execute(TPL_PAY_VENDOR_JASA_PPH23, {
      amountBruto: M.fromRupiah('10000000'),
      isPpn: false,
      kodeObjekPajak: '24-104-01',
      vendorHasNpwp: false,
      paymentDate: new Date('2025-06-15'),
    }, ctx);
    expect(M.toRupiah((result.computed['pph23Amt'] as { value: M.Money }).value)).toBe('400000');
    expect(result.journal.lines).toHaveLength(3); // no PPN line
  });

  it('rejects when amountBruto is missing', () => {
    expect(() => execute(TPL_PAY_VENDOR_JASA_PPH23, {
      isPpn: true, kodeObjekPajak: '24-104-01', vendorHasNpwp: true, paymentDate: new Date('2025-06-15'),
    }, ctx)).toThrow(/required input 'amountBruto'/);
  });

  it('rejects when kodeObjekPajak is unknown (no silent default)', () => {
    expect(() => execute(TPL_PAY_VENDOR_JASA_PPH23, {
      amountBruto: M.fromRupiah('1000000'),
      isPpn: false,
      kodeObjekPajak: '99-999-99',
      vendorHasNpwp: true,
      paymentDate: new Date('2025-06-15'),
    }, ctx)).toThrow(/PPh23 tarif tidak ditemukan/);
  });

  it('rejects when expense account mapping is missing', () => {
    const incompleteCtx: ExecutionContext = {
      ...ctx,
      resolveExpenseAccountForKodeObjek: () => undefined,
    };
    expect(() => execute(TPL_PAY_VENDOR_JASA_PPH23, {
      amountBruto: M.fromRupiah('1000000'),
      isPpn: false,
      kodeObjekPajak: '24-104-01',
      vendorHasNpwp: true,
      paymentDate: new Date('2025-06-15'),
    }, incompleteCtx)).toThrow(/no expense account mapped/);
  });
});

describe('engine — ISSUE_INVOICE_PPN', () => {
  const ctx = makeContext();

  it('NORMAL @ 2025: 12% PPN, balanced 3-line journal', () => {
    const r = execute(TPL_ISSUE_INVOICE_PPN, {
      subtotal: M.fromRupiah('1000000'),
      treatment: 'NORMAL',
      issueDate: new Date('2025-06-15'),
    }, ctx);
    expect(M.toRupiah((r.computed['dpp']    as { value: M.Money }).value)).toBe('1000000');
    expect(M.toRupiah((r.computed['ppnAmt'] as { value: M.Money }).value)).toBe('120000');
    expect(M.toRupiah((r.computed['total']  as { value: M.Money }).value)).toBe('1120000');
    expect(r.journal.lines).toHaveLength(3);
    expect(r.artifacts).toHaveLength(1);
  });

  it('NILAI_LAIN_GENERAL @ 2025: efektif 11% via 11/12 × harga', () => {
    const r = execute(TPL_ISSUE_INVOICE_PPN, {
      subtotal: M.fromRupiah('1200000'),
      treatment: 'NILAI_LAIN_GENERAL',
      issueDate: new Date('2025-06-15'),
    }, ctx);
    expect(M.toRupiah((r.computed['dpp']    as { value: M.Money }).value)).toBe('1100000');
    expect(M.toRupiah((r.computed['ppnAmt'] as { value: M.Money }).value)).toBe('132000');
  });

  it('NON_PPN: omits PPN line and FakturPajak artifact', () => {
    const r = execute(TPL_ISSUE_INVOICE_PPN, {
      subtotal: M.fromRupiah('500000'),
      treatment: 'NON_PPN',
      issueDate: new Date('2025-06-15'),
    }, ctx);
    expect(r.journal.lines).toHaveLength(2); // piutang + pendapatan, no ppn line
    expect(r.artifacts).toHaveLength(0);
  });
});

describe('engine — safety invariants', () => {
  const ctx = makeContext();

  it('refuses to produce an unbalanced journal even if template authoring is wrong', () => {
    const broken: TransactionTemplate = {
      code: 'BROKEN', version: 1, effectiveFrom: '2025-01-01',
      inputs: [],
      computations: [
        { name: 'a', expr: 'money(100)' },
        { name: 'b', expr: 'money(99)'  },
      ],
      journal: [
        { side: 'DEBIT',  account: 'accountByCode("1.1.02.001")', amount: 'a' },
        { side: 'CREDIT', account: 'accountByCode("1.1.02.001")', amount: 'b' },
      ],
    };
    expect(() => execute(broken, {}, ctx)).toThrow(/unbalanced journal/);
  });

  it('refuses non-uuid account expressions', () => {
    const tpl: TransactionTemplate = {
      code: 'NOT_UUID', version: 1, effectiveFrom: '2025-01-01',
      inputs: [],
      computations: [{ name: 'a', expr: 'money(100)' }],
      journal: [
        { side: 'DEBIT',  account: '"not-a-uuid"',                 amount: 'a' },
        { side: 'CREDIT', account: 'accountByCode("1.1.02.001")', amount: 'a' },
      ],
    };
    expect(() => execute(tpl, {}, ctx)).toThrow(/must resolve to a uuid/);
  });

  it('refuses non-positive amounts (use if: ... instead)', () => {
    const tpl: TransactionTemplate = {
      code: 'ZERO', version: 1, effectiveFrom: '2025-01-01',
      inputs: [],
      computations: [{ name: 'z', expr: 'money(0)' }],
      journal: [
        { side: 'DEBIT',  account: 'accountByCode("1.1.02.001")', amount: 'z' },
        { side: 'CREDIT', account: 'accountByCode("1.1.02.001")', amount: 'z' },
      ],
    };
    expect(() => execute(tpl, {}, ctx)).toThrow(/amount must be > 0/);
  });

  it('throws EvaluationError (not generic Error) for typed failures', () => {
    expect(() => execute(TPL_PAY_VENDOR_JASA_PPH23, {
      amountBruto: 'not a money',
      isPpn: true, kodeObjekPajak: '24-104-01', vendorHasNpwp: true,
      paymentDate: new Date('2025-06-15'),
    } as never, ctx)).toThrow(EvaluationError);
  });
});
