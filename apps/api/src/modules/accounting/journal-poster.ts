import { assertBalanced, type JournalDraft } from '@taxora/accounting';
import { Money } from '@taxora/tax-rules';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Posts a balanced journal into Postgres inside a single transaction,
 * along with its outbox event. Three layers of correctness:
 *
 *   1. Pre-flight in pure code: `assertBalanced(draft)`.
 *   2. DB CHECK: `journal_lines.amount > 0`.
 *   3. DB deferred trigger: sums lines at COMMIT, raises if not balanced.
 *
 * Idempotency: callers should provide (referenceType, referenceId) plus a
 * (templateCode, templateVersion); a unique partial index on
 * (tenant_id, reference_type, reference_id, template_version) will be added
 * once we wire the rule engine to enforce it.
 *
 * NOTE: this function expects the Prisma client `tx` to already be inside
 * a transaction with `SET LOCAL app.tenant_id = '<uuid>'` (use withTenant).
 */
export interface PostJournalResult {
  journalId: string;
  lineIds: string[];
}

type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export async function postJournal(
  tx: PrismaTx,
  draft: JournalDraft,
  opts: { templateCode?: string; templateVersion?: number } = {},
): Promise<PostJournalResult> {
  // 1. Pure pre-flight check. Cheap, deterministic, deeply tested.
  assertBalanced(draft);

  // 2. Insert journal header in DRAFT.
  const journal = await tx.journal.create({
    data: {
      tenantId: draft.tenantId,
      fiscalPeriodId: draft.fiscalPeriodId,
      postedAt: draft.postedAt,
      referenceType: draft.referenceType,
      referenceId: draft.referenceId ?? null,
      memo: draft.memo ?? null,
      postedBy: draft.postedBy ?? null,
      templateCode: opts.templateCode ?? null,
      templateVersion: opts.templateVersion ?? null,
      status: 'DRAFT',
    },
  });

  // 3. Insert lines. No DB-side balance check yet because status = DRAFT.
  const lineIds: string[] = [];
  for (const l of draft.lines) {
    const created = await tx.journalLine.create({
      data: {
        tenantId: draft.tenantId,
        journalId: journal.id,
        accountId: l.accountId,
        side: l.side,
        amount: new Prisma.Decimal(Money.toRupiah(l.amount)),
        description: l.description ?? null,
        taxArtifactType: l.taxArtifactType ?? null,
        taxArtifactId: l.taxArtifactId ?? null,
      },
    });
    lineIds.push(created.id);
  }

  // 4. Flip to POSTED. The DB trigger validates debit=credit synchronously,
  //    raising a clear error inside this statement so the driver surfaces it.
  await tx.journal.update({
    where: { id: journal.id },
    data: { status: 'POSTED' },
  });

  // 4. Outbox event — same TX as the journal. Dispatcher publishes after commit.
  await tx.outboxEvent.create({
    data: {
      tenantId: draft.tenantId,
      type: 'JournalPosted',
      aggregateId: journal.id,
      payload: {
        journalId: journal.id,
        referenceType: draft.referenceType,
        referenceId: draft.referenceId ?? null,
        postedAt: draft.postedAt.toISOString(),
        templateCode: opts.templateCode ?? null,
        templateVersion: opts.templateVersion ?? null,
      },
    },
  });

  return { journalId: journal.id, lineIds };
}
