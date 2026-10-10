// @vitest-environment jsdom
/**
 * The journal inspector's balance banner.
 *
 * It used to print a hardcoded `Variance: PKR 0.00` and claim "Debits equal
 * Credits" whatever the lines said — so an unbalanced posting rendered as a
 * balanced one, which is the output telling an auditor the books are sound when
 * they are not. The banner reports the real difference now, and names which
 * side is heavier.
 *
 * The rule under test is financeDomain's own `assertJournalBalanced` — the same
 * one postJournal gates on — so this screen cannot disagree with what the
 * ledger was willing to accept.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({ journalEntries: [] }),
}));

import { JournalEntryModal } from '../../src/components/billing/JournalEntryModal';
import type { JournalEntry } from '../../src/types';

afterEach(cleanup);

interface Line {
  debit: number;
  credit: number;
}

const journal = (lines: Line[]): JournalEntry =>
  ({
    id: 'j1',
    journal_number: 'JE-0001',
    date: '2026-10-11',
    reference_number: 'INV-0020',
    lab_name: 'Ahmad Dental',
    created_by: 'ADIL',
    description: 'Test posting',
    event_type: 'invoice_created',
    created_at: '2026-10-11 09:00',
    lines: lines.map((l, i) => ({
      id: `l${i}`,
      account_name: 'Accounts Receivable',
      account_code: '1100',
      account_type: 'asset',
      ...l,
    })),
  }) as unknown as JournalEntry;

const show = (lines: Line[]) =>
  render(<JournalEntryModal isOpen onClose={vi.fn()} journal={journal(lines)} />);

describe('JournalEntryModal balance banner', () => {
  it('reports the real variance when debits exceed credits', () => {
    show([
      { debit: 5000, credit: 0 },
      { debit: 0, credit: 4760 },
    ]);

    expect(screen.getByText(/Entry does not balance/)).toBeTruthy();
    expect(screen.getByText(/debits exceed credits/)).toBeTruthy();
    expect(screen.getByText('Variance: PKR 240')).toBeTruthy();
  });

  it('names the other direction when credits are the heavier side', () => {
    show([
      { debit: 4000, credit: 0 },
      { debit: 0, credit: 5000 },
    ]);

    expect(screen.getByText(/credits exceed debits/)).toBeTruthy();
    // The magnitude, unsigned — the direction is already in the sentence.
    expect(screen.getByText('Variance: PKR 1,000')).toBeTruthy();
  });

  it('still confirms an entry that does balance', () => {
    show([
      { debit: 5000, credit: 0 },
      { debit: 0, credit: 5000 },
    ]);

    expect(screen.getByText(/Debits equal Credits/)).toBeTruthy();
    expect(screen.getByText('Variance: PKR 0')).toBeTruthy();
    expect(screen.queryByText(/does not balance/)).toBeNull();
  });

  it('never renders a difference of 1 as a zero variance', () => {
    // The regression stated as a property rather than as a string: the banner
    // must not round a real discrepancy down to the all-clear.
    show([{ debit: 1, credit: 0 }]);

    expect(screen.queryByText('Variance: PKR 0')).toBeNull();
    expect(screen.getByText('Variance: PKR 1')).toBeTruthy();
    expect(screen.getByText(/does not balance/)).toBeTruthy();
  });
});
