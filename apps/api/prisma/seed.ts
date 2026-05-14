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
  const templates = [
    {
      code: 'PAY_VENDOR_JASA_PPH23',
      version: 1,
      effectiveFrom: new Date('2025-01-01'),
      definition: {
        inputs: ['amountBruto', 'isPpn', 'kodeObjekPajak', 'vendorId', 'paymentDate'],
        computations: [
          { name: 'dpp',       expr: 'amountBruto' },
          { name: 'ppn',       expr: 'isPpn ? dpp * rule(\'PPN_RATE\', paymentDate) : 0' },
          { name: 'pph23Rate', expr: 'rule(\'PPH23_TARIF\', kodeObjekPajak, paymentDate, vendor.npwp)' },
          { name: 'pph23',     expr: 'dpp * pph23Rate' },
          { name: 'netToPay',  expr: 'dpp + ppn - pph23' },
        ],
        journal: [
          { side: 'DEBIT',  account: 'expense_for(kodeObjekPajak)', amount: 'dpp' },
          { side: 'DEBIT',  account: 'PPN_MASUKAN',                  amount: 'ppn',   if: 'isPpn' },
          { side: 'CREDIT', account: 'PPH23_PAYABLE',                amount: 'pph23' },
          { side: 'CREDIT', account: 'KAS_BANK',                     amount: 'netToPay' },
        ],
        artifacts:    [{ type: 'BUKTI_POTONG_PPH23', from: 'withholdingFromComputation' }],
        obligations:  [
          { type: 'SETOR_PPH23', dueDay: 10, amount: 'pph23' },
          { type: 'LAPOR_PPH23', dueDay: 20, linkedTo: 'SETOR_PPH23' },
        ],
      },
    },
    {
      code: 'ISSUE_INVOICE_PPN',
      version: 1,
      effectiveFrom: new Date('2025-01-01'),
      definition: {
        inputs: ['subtotal', 'customerId', 'issueDate', 'treatment'],
        computations: [
          { name: 'dpp', expr: "treatment == 'NILAI_LAIN_GENERAL' ? subtotal * rule('PPN_DPP_NILAI_LAIN_GENERAL', issueDate) : subtotal" },
          { name: 'ppn', expr: "treatment == 'NON_PPN' ? 0 : dpp * rule('PPN_RATE', issueDate)" },
          { name: 'total', expr: 'dpp + ppn' },
        ],
        journal: [
          { side: 'DEBIT',  account: 'PIUTANG_USAHA',  amount: 'total' },
          { side: 'CREDIT', account: 'PENDAPATAN',     amount: 'dpp' },
          { side: 'CREDIT', account: 'PPN_KELUARAN',   amount: 'ppn',  if: "treatment != 'NON_PPN'" },
        ],
        artifacts: [{ type: 'FAKTUR_PAJAK', kind: 'KELUARAN', if: "treatment != 'NON_PPN'" }],
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
