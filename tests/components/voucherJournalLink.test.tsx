// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

const downloadCSV = vi.fn();
vi.mock('../../src/services/csvExport', () => ({
  downloadCSV: (...args: unknown[]) => downloadCSV(...args),
}));

/* The voucher row id and the journal's reference are DIFFERENT strings by
   design: a voucher is logged under a `vouch-…` uuid, while the journal it
   traces to is keyed by `reference_number` = `payment.payment_number`, which
   is the same string the voucher shows as its `voucher_number`. The Journal
   button used to pass the uuid, so JournalEntryModal's
   `journalEntries.find(...)` never matched and its `if (!journal) return null`
   guard swallowed the click — the inspector looked broken. This test pins
   the correct identifier so it cannot regress. */
const { SAVED_VOUCHERS, JOURNAL_ENTRIES } = vi.hoisted(() => {
  /* The voucher's date is TODAY, not a literal. The voucher list opens scoped to
     the current day, so a fixture pinned to a fixed date silently filtered
     itself out of its own list — this test passed on the day it was written and
     failed every day after, which is the worst possible failure mode for a test.

     TODAY has to be the LOCAL calendar day, not the UTC day. The voucher list
     is scoped by `todayISO()` (the operator's local day, see
     src/utils/dateUtils.ts) and the fixture has to land inside that same
     window. `new Date().toISOString().slice(0, 10)` is the UTC day, and
     between 00:00 and 05:00 in PKT the two differ by one — so the fixture was
     stamped YESTERDAY and the list rendered empty, exactly like the production
     bug this module documents. That is why the suite failed at 00:30 local and
     passed at 19:30 local: same code, same day, different clock. The fix is
     the same rule the product follows — use the shared local-day helper
     instead of re-deriving the day from `toISOString()`.

     Computed inside the factory because vi.hoisted runs before module scope —
     which is also why the local-date arithmetic is inlined here rather than
     imported: an import is not available inside a hoisted factory. It is the
     same rule as `getDateStr()` in src/utils/dateUtils.ts, written out. */
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return {
  SAVED_VOUCHERS: [
    {
      id: 'vouch-TESTUUID',
      voucher_number: 'PAY-2026-0002',
      voucher_type: 'invoice',
      case_id: 'case-1',
      case_number: 'DS-0018',
      lab_name: 'Cedar Point Dental Care',
      doctor_name: 'Dr. Ayesha Siddiqui',
      patient_name: 'Test Patient',
      case_type_name: 'Acrylic Denture',
      amount: 5000,
      notes: '',
      created_at: `${today} 15:34`,
      saved_by: 'adil',
    },
  ],
  JOURNAL_ENTRIES: [
    {
      id: 'jrn-TEST',
      journal_number: 'JRN-PAY-20260002',
      date: today,
      event_type: 'payment_received',
      reference_type: 'payment',
      reference_id: 'pay-TEST',
      reference_number: 'PAY-2026-0002',
      lab_id: 'lab-1',
      lab_name: 'Cedar Point Dental Care',
      case_id: 'case-1',
      case_number: 'DS-0018',
      description: 'Payment received',
      lines: [
        { id: 'jl-1', account_code: '1100', account_name: 'Cash & Bank Clearing', account_type: 'asset', debit: 5000, credit: 0 },
        { id: 'jl-2', account_code: '1200', account_name: 'Accounts Receivable', account_type: 'asset', debit: 0, credit: 5000 },
      ],
      created_at: `${today} 15:34`,
      created_by: 'adil',
    },
  ],
  };
});

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    invoices: [],
    cases: [],
    savedVouchers: SAVED_VOUCHERS,
    deleteSavedVoucher: () => {},
    advancePayments: [],
    accountAdjustments: [],
    journalEntries: JOURNAL_ENTRIES,
  }),
}));

import { BillingReportsView } from '../../src/components/billing/BillingReportsView';

afterEach(() => {
  cleanup();
  downloadCSV.mockClear();
});

describe('voucher → journal inspector link', () => {
  it('passes the voucher number, not the row id', () => {
    const onOpenJournalModal = vi.fn();
    render(
      <BillingReportsView
        onPrintInvoice={() => {}}
        onViewCaseSlip={() => {}}
        onOpenJournalModal={onOpenJournalModal}
      />,
    );

    fireEvent.click(screen.getByText('Archived Slips & Vouchers'));

    const row = within(screen.getByRole('table'))
      .getByText('PAY-2026-0002')
      .closest('tr') as HTMLElement;

    fireEvent.click(within(row).getByText('Journal'));

    expect(onOpenJournalModal).toHaveBeenCalledTimes(1);
    expect(onOpenJournalModal).toHaveBeenCalledWith('PAY-2026-0002');
    expect(onOpenJournalModal).not.toHaveBeenCalledWith('vouch-TESTUUID');
  });

  it('hides the Journal button entirely when no inspector is wired', () => {
    render(<BillingReportsView onPrintInvoice={() => {}} onViewCaseSlip={() => {}} />);
    fireEvent.click(screen.getByText('Archived Slips & Vouchers'));
    expect(screen.queryByText('Journal')).toBeNull();
  });
});
