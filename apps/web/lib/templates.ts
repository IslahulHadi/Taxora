/**
 * The same TransactionTemplates that apps/api/prisma/seed.ts persists to
 * the database, copied here so the web playground can run them entirely
 * client-side without an API. When the API ships, we'll fetch these from
 * /v1/transaction-templates and the UI won't change.
 */

import type { TransactionTemplate } from '@taxora/rule-engine';

export const TPL_PAY_VENDOR_JASA_PPH23: TransactionTemplate = {
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
    { name: 'dpp',      expr: 'amountBruto' },
    { name: 'ppnAmt',   expr: 'isPpn ? dpp * ruleRate("PPN_RATE", paymentDate) : money(0)' },
    { name: 'wht',      expr: 'pph23(dpp, kodeObjekPajak, vendorHasNpwp, paymentDate)' },
    { name: 'pph23Amt', expr: 'wht.amount' },
    { name: 'netToPay', expr: 'dpp + ppnAmt - pph23Amt' },
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
        dpp:            'dpp',
        rate:           'wht.rate',
        amount:         'pph23Amt',
        kodeObjekPajak: 'kodeObjekPajak',
      },
    },
  ],
  obligations: [
    { kind: 'SETOR_PPH23', dueDay: 10, amount: 'pph23Amt' },
    { kind: 'LAPOR_PPH23', dueDay: 20 },
  ],
};

export const TPL_ISSUE_INVOICE_PPN: TransactionTemplate = {
  code: 'ISSUE_INVOICE_PPN',
  version: 1,
  effectiveFrom: '2025-01-01',
  inputs: [
    { name: 'subtotal',  kind: 'money',  required: true },
    { name: 'treatment', kind: 'string', required: true }, // 'NORMAL' | 'NILAI_LAIN_GENERAL' | 'NON_PPN'
    { name: 'issueDate', kind: 'date',   required: true },
  ],
  computations: [
    { name: 'calc',   expr: 'ppn(subtotal, treatment, issueDate)' },
    { name: 'dpp',    expr: 'calc.dpp' },
    { name: 'ppnAmt', expr: 'calc.ppn' },
    { name: 'total',  expr: 'dpp + ppnAmt' },
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
