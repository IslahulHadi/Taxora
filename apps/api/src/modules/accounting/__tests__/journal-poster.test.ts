import { describe, it, expect, vi } from 'vitest';
import { Money } from '@taxora/tax-rules';
import { postJournal } from '../journal-poster.js';
import { UnbalancedJournalError } from '@taxora/accounting';

/**
 * Pure unit test for postJournal — verifies the *application* invariant
 * (assertBalanced) fires before any DB call, with a no-op tx mock.
 *
 * The DB-level invariant proof is in scripts/proof.ts (runs against real PG).
 */

const tenantId = '00000000-0000-0000-0000-000000000001';
const fp       = '00000000-0000-0000-0000-000000000002';

const fakeTx = () => {
  const journalCreate = vi.fn().mockResolvedValue({ id: 'j1' });
  const journalUpdate = vi.fn().mockResolvedValue({ id: 'j1', status: 'POSTED' });
  const lineCreate    = vi.fn().mockImplementation(({ data }: { data: { accountId: string } }) =>
    Promise.resolve({ id: `l-${data.accountId}` }),
  );
  const outboxCreate  = vi.fn().mockResolvedValue({});
  return {
    journal:     { create: journalCreate, update: journalUpdate },
    journalLine: { create: lineCreate },
    outboxEvent: { create: outboxCreate },
    _spies: { journalCreate, journalUpdate, lineCreate, outboxCreate },
  };
};

describe('postJournal', () => {
  it('rejects unbalanced drafts before any DB write', async () => {
    const tx = fakeTx();
    await expect(
      postJournal(tx as never, {
        tenantId,
        fiscalPeriodId: fp,
        postedAt: new Date('2025-06-15T10:00:00Z'),
        referenceType: 'INVOICE',
        lines: [
          { accountId: 'a', side: 'DEBIT',  amount: Money.fromRupiah('100') },
          { accountId: 'b', side: 'CREDIT', amount: Money.fromRupiah('99')  },
        ],
      }),
    ).rejects.toBeInstanceOf(UnbalancedJournalError);
    expect(tx._spies.journalCreate).not.toHaveBeenCalled();
    expect(tx._spies.lineCreate).not.toHaveBeenCalled();
  });

  it('posts a balanced journal: header (DRAFT) -> lines -> status POSTED -> outbox', async () => {
    const tx = fakeTx();
    const result = await postJournal(tx as never, {
      tenantId,
      fiscalPeriodId: fp,
      postedAt: new Date('2025-06-15T10:00:00Z'),
      referenceType: 'INVOICE',
      lines: [
        { accountId: 'a', side: 'DEBIT',  amount: Money.fromRupiah('1120000') },
        { accountId: 'b', side: 'CREDIT', amount: Money.fromRupiah('1000000') },
        { accountId: 'c', side: 'CREDIT', amount: Money.fromRupiah('120000')  },
      ],
    });
    expect(tx._spies.journalCreate).toHaveBeenCalledOnce();
    expect(tx._spies.journalCreate.mock.calls[0]![0].data.status).toBe('DRAFT');
    expect(tx._spies.lineCreate).toHaveBeenCalledTimes(3);
    expect(tx._spies.journalUpdate).toHaveBeenCalledOnce();
    expect(tx._spies.journalUpdate.mock.calls[0]![0].data.status).toBe('POSTED');
    expect(tx._spies.outboxCreate).toHaveBeenCalledOnce();
    expect(result.lineIds).toHaveLength(3);
  });
});
