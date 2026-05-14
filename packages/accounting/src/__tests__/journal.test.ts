import { describe, it, expect } from 'vitest';
import { Money } from '@taxora/tax-rules';
import { assertBalanced, reverse, UnbalancedJournalError, type JournalDraft } from '../journal.js';

const tenantId = '00000000-0000-0000-0000-000000000001';
const fp = '00000000-0000-0000-0000-000000000002';

const sampleSale = (): JournalDraft => ({
  tenantId,
  fiscalPeriodId: fp,
  postedAt: new Date('2025-06-15T10:00:00Z'),
  referenceType: 'INVOICE',
  referenceId: 'inv-1',
  memo: 'Penjualan jasa konsultasi',
  lines: [
    { accountId: 'acct-piutang',      side: 'DEBIT',  amount: Money.fromRupiah('1120000') },
    { accountId: 'acct-pendapatan',   side: 'CREDIT', amount: Money.fromRupiah('1000000') },
    { accountId: 'acct-ppn-keluaran', side: 'CREDIT', amount: Money.fromRupiah('120000')  },
  ],
});

describe('Journal', () => {
  it('accepts balanced sale: 1.000.000 + PPN 12%', () => {
    expect(() => assertBalanced(sampleSale())).not.toThrow();
  });

  it('rejects unbalanced journal', () => {
    const bad = sampleSale();
    bad.lines[2]!.amount = Money.fromRupiah('100000'); // wrong PPN
    expect(() => assertBalanced(bad)).toThrow(UnbalancedJournalError);
  });

  it('rejects journals with < 2 lines', () => {
    const bad: JournalDraft = { ...sampleSale(), lines: [sampleSale().lines[0]!] };
    expect(() => assertBalanced(bad)).toThrow(/at least 2/);
  });

  it('rejects non-positive line amounts', () => {
    const bad = sampleSale();
    bad.lines[0]!.amount = Money.zero();
    expect(() => assertBalanced(bad)).toThrow(/must be > 0/);
  });

  it('reverse() flips sides and remains balanced', () => {
    const original = sampleSale();
    const rev = reverse(original, { postedAt: new Date('2025-06-16T10:00:00Z') });
    expect(rev.referenceType).toBe('REVERSAL');
    expect(rev.lines[0]!.side).toBe('CREDIT');
    expect(rev.lines[1]!.side).toBe('DEBIT');
    expect(() => assertBalanced(rev)).not.toThrow();
  });
});
