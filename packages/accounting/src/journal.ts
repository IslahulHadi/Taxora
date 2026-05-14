import { Money } from '@taxora/tax-rules';

export type Side = 'DEBIT' | 'CREDIT';

export interface JournalLineDraft {
  accountId: string;
  side: Side;
  amount: Money.Money;
  description?: string | undefined;
  taxArtifactType?: string | undefined;
  taxArtifactId?: string | undefined;
}

export interface JournalDraft {
  tenantId: string;
  postedAt: Date;
  fiscalPeriodId: string;
  referenceType: string;     // 'INVOICE' | 'BILL' | 'PAYMENT' | 'PAYROLL' | 'MANUAL' | 'REVERSAL'
  referenceId?: string | undefined;
  memo?: string | undefined;
  postedBy?: string | undefined;
  lines: JournalLineDraft[];
}

export class UnbalancedJournalError extends Error {
  constructor(public readonly debit: Money.Money, public readonly credit: Money.Money) {
    super(
      `Unbalanced journal: debit=${Money.toRupiah(debit)} credit=${Money.toRupiah(credit)} delta=${Money.toRupiah(
        Money.sub(debit, credit),
      )}`,
    );
    this.name = 'UnbalancedJournalError';
  }
}

/**
 * Sum the debit and credit sides of a journal draft.
 * NEVER mutates input. Returns Money values.
 */
export function totals(draft: JournalDraft): { debit: Money.Money; credit: Money.Money } {
  let debit = Money.zero();
  let credit = Money.zero();
  for (const l of draft.lines) {
    if (l.amount.amount <= 0n) {
      throw new Error(`Journal line amount must be > 0 for account ${l.accountId}`);
    }
    if (l.side === 'DEBIT') debit = Money.add(debit, l.amount);
    else credit = Money.add(credit, l.amount);
  }
  return { debit, credit };
}

/**
 * The unbreakable invariant of double-entry bookkeeping.
 * Throws UnbalancedJournalError on any mismatch.
 *
 * IMPORTANT: this runs BEFORE any persistence. The DB also enforces it
 * via a deferred constraint trigger. Two layers of defense.
 */
export function assertBalanced(draft: JournalDraft): void {
  if (draft.lines.length < 2) {
    throw new Error('Journal must have at least 2 lines (one debit, one credit).');
  }
  const { debit, credit } = totals(draft);
  if (!Money.eq(debit, credit)) {
    throw new UnbalancedJournalError(debit, credit);
  }
}

/**
 * Build a reversal of a posted journal: every line gets the opposite side, same amount.
 * Used for void/cancel flows. Never mutate the original — always create a paired entry.
 */
export function reverse(
  original: JournalDraft,
  opts: { postedAt: Date; memo?: string },
): JournalDraft {
  return {
    ...original,
    postedAt: opts.postedAt,
    memo: opts.memo ?? `Reversal of ${original.referenceType}:${original.referenceId ?? ''}`,
    referenceType: 'REVERSAL',
    referenceId: original.referenceId,
    lines: original.lines.map((l) => ({
      ...l,
      side: l.side === 'DEBIT' ? 'CREDIT' : 'DEBIT',
    })),
  };
}
