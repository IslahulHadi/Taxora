/**
 * Seed script — populates global rules, then a demo tenant with default CoA.
 * Idempotent: safe to re-run.
 *
 * Run with:
 *   pnpm --filter @taxora/api prisma:seed
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_COA_SMB } from '@taxora/accounting';

const prisma = new PrismaClient();

async function main() {
  console.log('▶ seeding global tax rules…');
  await seedGlobalTaxRules();

  console.log('▶ seeding global transaction templates…');
  await seedGlobalTemplates();

  console.log('▶ seeding demo tenant…');
  const tenant = await upsertDemoTenant();

  console.log('▶ seeding default Chart of Accounts for demo tenant…');
  await seedDefaultCoa(tenant.id);

  console.log(`✔ done. Demo tenant id = ${tenant.id}`);
}

async function seedGlobalTaxRules() {
  const rules = [
    // PPN rates (effective-dated)
    {
      code: 'PPN_RATE',
      effectiveFrom: new Date('2022-04-01'),
      effectiveTo:   new Date('2025-01-01'),
      payload: { rate: { num: 11, den: 100 } },
      sourceRef: 'UU HPP transisi',
    },
    {
      code: 'PPN_RATE',
      effectiveFrom: new Date('2025-01-01'),
      payload: { rate: { num: 12, den: 100 } },
      sourceRef: 'UU HPP / PMK 131/2024',
    },
    {
      code: 'PPN_DPP_NILAI_LAIN_GENERAL',
      effectiveFrom: new Date('2025-01-01'),
      payload: { numerator: 11, denominator: 12 },
      sourceRef: 'PMK 131/2024',
    },
    // PPh 23 — subset of kode objek pajak
    {
      code: 'PPH23_TARIF',
      effectiveFrom: new Date('2009-01-01'),
      payload: {
        '24-001-01': { num: 15, den: 100 }, // dividen
        '24-002-01': { num: 15, den: 100 }, // bunga
        '24-003-01': { num: 15, den: 100 }, // royalti
        '24-004-01': { num: 15, den: 100 }, // hadiah
        '24-100-01': { num: 2,  den: 100 }, // sewa selain T/B
        '24-104-01': { num: 2,  den: 100 }, // jasa lain (PMK 141/2015)
      },
      sourceRef: 'UU PPh ps. 23 + PMK 141/2015',
    },
    // PPh 4(2) — sewa T/B
    {
      code: 'PPH4_2_SEWA_TANAH_BANGUNAN',
      effectiveFrom: new Date('2002-05-01'),
      payload: { rate: { num: 10, den: 100 } },
      sourceRef: 'PP 34/2017',
    },
    // PPh Final UMKM (PP 55/2022)
    {
      code: 'PPH_FINAL_UMKM',
      effectiveFrom: new Date('2022-12-20'),
      payload: { rate: { num: 5, den: 1000 }, omzetThreshold: 4_800_000_000 },
      sourceRef: 'PP 55/2022',
    },
    // PTKP
    {
      code: 'PTKP',
      effectiveFrom: new Date('2016-01-01'),
      payload: {
        TK0: 54_000_000,
        K0:  58_500_000,
        tambahanKawin:      4_500_000,
        tambahanTanggungan: 4_500_000,
        maxTanggungan: 3,
      },
      sourceRef: 'PMK 101/PMK.010/2016',
    },
  ];

  for (const r of rules) {
    // Idempotent: (code, effectiveFrom, tenant_id IS NULL) uniquely identifies a global rule.
    const existing = await prisma.taxRule.findFirst({
      where: { code: r.code, effectiveFrom: r.effectiveFrom, tenantId: null },
    });
    if (existing) {
      await prisma.taxRule.update({ where: { id: existing.id }, data: { payload: r.payload, sourceRef: r.sourceRef ?? null, effectiveTo: r.effectiveTo ?? null } });
    } else {
      await prisma.taxRule.create({
        data: {
          code: r.code,
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo ?? null,
          payload: r.payload,
          sourceRef: r.sourceRef,
          tenantId: null,
        },
      });
    }
  }
}

async function seedGlobalTemplates() {
  // Templates use the @taxora/rule-engine expression language. See
  // packages/rule-engine/src/__tests__/engine.test.ts for the canonical
  // shape; these are the same templates, persisted to the DB.
  const templates = [
    {
      code: 'PAY_VENDOR_JASA_PPH23',
      version: 1,
      effectiveFrom: new Date('2025-01-01'),
      definition: {
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
      },
    },
    {
      code: 'ISSUE_INVOICE_PPN',
      version: 1,
      effectiveFrom: new Date('2025-01-01'),
      definition: {
        inputs: [
          { name: 'subtotal',  kind: 'money',  required: true },
          { name: 'treatment', kind: 'string', required: true },
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
      },
    },
  ];

  for (const t of templates) {
    const existing = await prisma.transactionTemplate.findFirst({
      where: { code: t.code, version: t.version, tenantId: null },
    });
    if (existing) {
      await prisma.transactionTemplate.update({
        where: { id: existing.id },
        data: { definition: t.definition, effectiveFrom: t.effectiveFrom },
      });
    } else {
      await prisma.transactionTemplate.create({
        data: { code: t.code, version: t.version, effectiveFrom: t.effectiveFrom, definition: t.definition, tenantId: null },
      });
    }
  }
}

async function upsertDemoTenant() {
  return prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      slug: 'demo',
      legalName: 'Taxora Demo Tenant',
      pkpStatus: 'PKP',
      tier: 'standard',
      settings: { onboardingComplete: false },
    },
  });
}

async function seedDefaultCoa(tenantId: string) {
  for (const a of DEFAULT_COA_SMB) {
    const existing = await prisma.account.findFirst({
      where: { tenantId, code: a.code },
    });
    if (existing) continue;
    await prisma.account.create({
      data: {
        tenantId,
        code: a.code,
        name: a.name,
        type: a.type,
        normalSide: a.normalSide,
        isTaxAccount: !!a.taxPurpose,
        taxPurpose: a.taxPurpose ?? null,
      },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
