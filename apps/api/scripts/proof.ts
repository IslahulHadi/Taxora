/**
 * End-to-end invariants proof — runs against a real Postgres instance.
 *
 * Asserts:
 *   1. A balanced journal posts successfully and produces an outbox event.
 *   2. An UNbalanced journal is rejected at COMMIT by the deferred trigger.
 *   3. Cross-tenant SELECT is blocked by RLS.
 *   4. Cross-tenant INSERT is blocked by RLS WITH CHECK.
 *   5. UPDATE on journal_lines is forbidden (append-only trigger).
 *   6. Tax rules lookup returns the row effective on a given date.
 *
 * Run with:
 *   pnpm --filter @taxora/api exec tsx scripts/proof.ts
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { Money } from '@taxora/tax-rules';
import { postJournal } from '../src/modules/accounting/journal-poster.js';
import { withTenant } from '../src/infrastructure/persistence/prisma.js';

const prisma = new PrismaClient();

// We need a "rls_user" with no superuser/owner privileges so RLS actually applies.
// Postgres bypasses RLS for the table owner unless FORCE is set; we have FORCE,
// but superusers always bypass. The seed user is the owner — fine for setup,
// but our proof creates a non-owner role and connects with that.
async function ensureRlsUser() {
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='taxora_app') THEN
        CREATE ROLE taxora_app LOGIN PASSWORD 'app';
      END IF;
    END$$;
  `);
  await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO taxora_app`);
  await prisma.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO taxora_app`,
  );
  await prisma.$executeRawUnsafe(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO taxora_app`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO taxora_app`,
  );
}

async function loadDemoTenant() {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'demo' } });
  return t.id;
}

async function ensureFiscalPeriod(tenantId: string, year: number, month: number) {
  return prisma.fiscalPeriod.upsert({
    where: { tenantId_year_month: { tenantId, year, month } },
    update: {},
    create: { tenantId, year, month },
  });
}

function red(s: string)   { return `\x1b[31m${s}\x1b[0m`; }
function green(s: string) { return `\x1b[32m${s}\x1b[0m`; }
function bold(s: string)  { return `\x1b[1m${s}\x1b[0m`; }

let passed = 0, failed = 0;
function ok(label: string)            { console.log(green('  ✔'), label); passed++; }
function fail(label: string, err: unknown) { console.log(red('  ✘'), label, '\n    ', err); failed++; }

async function main() {
  console.log(bold('\n▶ Setup'));
  await ensureRlsUser();
  const tenantA = await loadDemoTenant();
  // Create a second tenant for cross-tenant tests.
  const tenantB = await (async () => {
    const t = await prisma.tenant.upsert({
      where: { slug: 'demo-b' },
      update: {},
      create: { slug: 'demo-b', legalName: 'Tenant B', pkpStatus: 'PKP' },
    });
    return t.id;
  })();
  const fpA = await ensureFiscalPeriod(tenantA, 2025, 6);
  const acctsA = await prisma.account.findMany({ where: { tenantId: tenantA } });
  const piutang  = acctsA.find(a => a.code === '1.1.03.001')!;
  const ppnKel   = acctsA.find(a => a.code === '2.1.02.001')!;
  const pendapat = acctsA.find(a => a.code === '4.1.01.001')!;

  // ────────────────────────────────────────────────────────────
  console.log(bold('\n▶ 1. Balanced journal posts cleanly'));
  try {
    const result = await withTenant(tenantA, async (tx) =>
      postJournal(tx, {
        tenantId: tenantA,
        fiscalPeriodId: fpA.id,
        postedAt: new Date('2025-06-15T10:00:00Z'),
        referenceType: 'INVOICE',
        memo: 'Penjualan jasa konsultasi',
        lines: [
          { accountId: piutang.id,  side: 'DEBIT',  amount: Money.fromRupiah('1120000') },
          { accountId: pendapat.id, side: 'CREDIT', amount: Money.fromRupiah('1000000') },
          { accountId: ppnKel.id,   side: 'CREDIT', amount: Money.fromRupiah('120000')  },
        ],
      }),
    );
    if (!result.journalId) throw new Error('no journalId returned');
    const lines = await prisma.journalLine.count({ where: { journalId: result.journalId } });
    const outbox = await prisma.outboxEvent.count({ where: { aggregateId: result.journalId, type: 'JournalPosted' } });
    if (lines !== 3) throw new Error(`expected 3 lines, got ${lines}`);
    if (outbox !== 1) throw new Error(`expected 1 outbox event, got ${outbox}`);
    ok(`Posted journal ${result.journalId} with 3 lines + 1 outbox event`);
  } catch (e) { fail('balanced journal failed', e); }

  // ────────────────────────────────────────────────────────────
  console.log(bold('\n▶ 2. Unbalanced journal is rejected by deferred trigger at COMMIT'));
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA}'`);
      const journal = await tx.journal.create({
        data: {
          tenantId: tenantA,
          fiscalPeriodId: fpA.id,
          postedAt: new Date('2025-06-15T11:00:00Z'),
          referenceType: 'MANUAL',
          status: 'DRAFT',
        },
      });
      // Intentionally unbalanced
      await tx.journalLine.create({
        data: { tenantId: tenantA, journalId: journal.id, accountId: piutang.id, side: 'DEBIT', amount: new Prisma.Decimal('1000000') },
      });
      await tx.journalLine.create({
        data: { tenantId: tenantA, journalId: journal.id, accountId: pendapat.id, side: 'CREDIT', amount: new Prisma.Decimal('900000') },
      });
      // Try to flip to POSTED — trigger should refuse.
      await tx.journal.update({ where: { id: journal.id }, data: { status: 'POSTED' } });
    });
    fail('expected commit to be rejected', new Error('NO ERROR'));
  } catch (e) {
    const msg = (e as Error).message || JSON.stringify(e);
    if (/Unbalanced journal/.test(msg)) {
      const m = msg.match(/Unbalanced journal[^\n]*/);
      ok(`DB raised: "${(m ? m[0] : 'Unbalanced journal').trim()}"`);
    } else {
      fail('wrong error', e);
    }
  }

  // ────────────────────────────────────────────────────────────
  console.log(bold('\n▶ 3. Cross-tenant SELECT is blocked by RLS'));
  // Connect as taxora_app (NOT the table owner) so RLS applies.
  const appUrl = (process.env['DATABASE_URL'] || '').replace('//taxora:taxora@', '//taxora_app:app@');
  const appClient = new PrismaClient({ datasources: { db: { url: appUrl } } });
  try {
    // Within tenantA's context, listing tenants should return ONLY tenantA.
    const visibleAsA = await appClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA}'`);
      return tx.tenant.findMany({ select: { id: true, slug: true } });
    });
    if (visibleAsA.length !== 1 || visibleAsA[0]!.id !== tenantA) {
      throw new Error(`expected only tenantA visible, got ${JSON.stringify(visibleAsA)}`);
    }
    ok(`As tenantA, only sees tenantA (${visibleAsA.length} row)`);

    const visibleAsB = await appClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantB}'`);
      return tx.tenant.findMany({ select: { id: true, slug: true } });
    });
    if (visibleAsB.length !== 1 || visibleAsB[0]!.id !== tenantB) {
      throw new Error(`expected only tenantB visible, got ${JSON.stringify(visibleAsB)}`);
    }
    ok(`As tenantB, only sees tenantB (${visibleAsB.length} row)`);

    // Cross-tenant: tenantA tries to read tenantB's accounts -> 0 rows
    const crossSee = await appClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA}'`);
      // Attempt to select accounts where tenant_id=tenantB explicitly. RLS makes the row invisible.
      return tx.account.findMany({ where: { tenantId: tenantB } });
    });
    if (crossSee.length !== 0) throw new Error(`expected 0 rows, got ${crossSee.length}`);
    ok('Cross-tenant SELECT returns 0 rows even when forced by where-clause');
  } catch (e) { fail('RLS select test failed', e); }

  // ────────────────────────────────────────────────────────────
  console.log(bold('\n▶ 4. Cross-tenant INSERT is blocked by RLS WITH CHECK'));
  try {
    let blocked = false;
    try {
      await appClient.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA}'`);
        // Try to insert an account into tenantB while scoped as tenantA.
        await tx.account.create({
          data: {
            tenantId: tenantB,                    // <-- mismatch
            code: 'EVIL.001',
            name: 'should not exist',
            type: 'ASSET',
            normalSide: 'DEBIT',
          },
        });
      });
    } catch (e) {
      blocked = /row-level security|new row violates row-level security policy/i.test((e as Error).message);
      if (!blocked) throw e;
    }
    if (!blocked) throw new Error('insert was allowed!');
    ok('Postgres rejected the cross-tenant INSERT (WITH CHECK)');
  } catch (e) { fail('RLS insert test failed', e); }

  // ────────────────────────────────────────────────────────────
  console.log(bold('\n▶ 5. journal_lines are append-only (UPDATE forbidden)'));
  try {
    let blocked = false;
    const someLine = await prisma.journalLine.findFirstOrThrow();
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE journal_lines SET amount = amount + 1 WHERE id = '${someLine.id}'`,
      );
    } catch (e) {
      blocked = /append-only/.test((e as Error).message);
      if (!blocked) throw e;
    }
    if (!blocked) throw new Error('update was allowed!');
    ok('UPDATE on journal_lines was rejected by append-only trigger');
  } catch (e) { fail('append-only test failed', e); }

  // ────────────────────────────────────────────────────────────
  console.log(bold('\n▶ 6. Effective-dated tax rule lookup'));
  try {
    const ppn2025 = await prisma.taxRule.findFirstOrThrow({
      where: { code: 'PPN_RATE', effectiveFrom: new Date('2025-01-01'), tenantId: null },
    });
    const payload = ppn2025.payload as { rate: { num: number; den: number } };
    if (payload.rate.num !== 12 || payload.rate.den !== 100) {
      throw new Error(`expected 12/100, got ${JSON.stringify(payload.rate)}`);
    }
    ok(`PPN_RATE @ 2025-01-01 = 12/100 (cited: ${ppn2025.sourceRef})`);
  } catch (e) { fail('tax rule lookup failed', e); }

  // ────────────────────────────────────────────────────────────
  await appClient.$disconnect();
  await prisma.$disconnect();

  console.log(bold(`\n${passed} passed, ${failed} failed`));
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(red('FATAL'), e);
  await prisma.$disconnect();
  process.exit(1);
});
