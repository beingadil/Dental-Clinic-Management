// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/*
 * The General Ledger preview now carries each invoice's settlement state.
 *
 * A ledger row records that money was DEBITED. It never said whether the
 * invoice was later settled, so an operator reconciling a clinic could not
 * tell — from this pane — whether the invoice in front of them was still owed.
 * The badge answers that, and it is derived from the BALANCE rather than from
 * `payment_status`, because the stored status drifts once a credit note lands.
 */

const LAB = { id: 'lab-1', name: 'Cases Clinic' };

const CASE = {
  id: 'case-1',
  case_number: 'DS-2001',
  patient_name: 'Ali Raza',
  case_type_name: 'Zirconia Crown',
  lab_id: 'lab-1',
  lab_name: 'Cases Clinic',
  selected_teeth: [21],
  units_count: 1,
  shade: 'A2',
  received_date: '2026-10-03',
  status: 'received',
};

const mkInvoice = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  invoice_number: 'INV-0042',
  case_id: 'case-1',
  case_number: 'DS-2001',
  lab_id: 'lab-1',
  lab_name: 'Cases Clinic',
  case_type_name: 'Zirconia Crown',
  patient_name: 'Ali Raza',
  amount: 30000,
  discount: 0,
  final_amount: 30000,
  amount_paid: 0,
  credit_notes_total: 0,
  payment_status: 'unpaid',
  issue_date: '2026-10-03',
  due_date: '2026-10-17',
  created_at: '2026-10-03T00:00:00Z',
  payments: [],
  ...over,
});

const mkEntry = (over: Record<string, unknown> = {}) => ({
  id: 'led-1',
  date: '2026-10-03',
  lab_id: 'lab-1',
  lab_name: 'Cases Clinic',
  entry_type: 'invoice',
  reference_id: 'inv-1',
  reference_number: 'INV-0042',
  case_id: 'case-1',
  case_number: 'DS-2001',
  description: 'Invoice for Zirconia Crown',
  debit: 30000,
  credit: 0,
  running_balance: 30000,
  ...over,
});

const store = vi.hoisted(() => ({ invoices: [] as unknown[], entries: [] as unknown[] }));

vi.mock('../../src/services/pdf', () => ({
  buildLedgerPdf: () => ({ pdf: new Uint8Array([1, 2, 3]) }),
  downloadPdf: () => Promise.resolve({ status: 'saved', path: 'x.pdf', bytes: 3 }),
}));

vi.mock('../../src/services/printSettings', () => ({
  loadPrintSettings: () => ({
    paper: 'a4', margin: 'normal', fontSize: 'normal',
    showLogo: true, logoPosition: 'left', jobSlipStyle: 'full',
  }),
  loadDocumentSections: (_k: string, fallback: string[]) => [...fallback],
}));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [LAB],
    cases: [CASE],
    invoices: store.invoices,
    brandingSettings: { appName: 'DENTAL SOLUTIONS', lab_name: 'DENTAL SOLUTIONS' },
    getLedgerEntries: () => store.entries,
    setSelectedCaseForModal: () => {},
  }),
}));

import { GeneralLedgerView } from '../../src/components/billing/GeneralLedgerView';

afterEach(cleanup);

/**
 * The ledger shows nothing until a clinic is chosen and Preview is opened, so
 * every test drives the same three clicks the operator does.
 */
const renderLedger = (invoices: unknown[], entries: unknown[]) => {
  store.invoices = invoices;
  store.entries = entries;
  const r = render(<GeneralLedgerView />);
  fireEvent.click(screen.getByText(/select clinic/i));
  fireEvent.click(screen.getByText('Cases Clinic'));
  fireEvent.click(screen.getByRole('button', { name: 'All Time' }));
  fireEvent.click(screen.getByRole('button', { name: /preview/i }));
  return r;
};

describe('General Ledger preview: invoice settlement badge', () => {
  it('marks an unpaid invoice Unpaid', () => {
    renderLedger([mkInvoice()], [mkEntry()]);
    expect(screen.getByText('Unpaid')).toBeTruthy();
  });

  it('marks a partly paid invoice Partial', () => {
    renderLedger([mkInvoice({ amount_paid: 10000 })], [mkEntry()]);
    expect(screen.getByText('Partial')).toBeTruthy();
    expect(screen.queryByText('Unpaid')).toBeNull();
  });

  it('marks a settled invoice Paid', () => {
    renderLedger([mkInvoice({ amount_paid: 30000, payment_status: 'paid' })], [mkEntry()]);
    expect(screen.getByText('Paid')).toBeTruthy();
    expect(screen.queryByText('Partial')).toBeNull();
  });

  it('ignores a stored status that disagrees with the money', () => {
    // Paid in full, but the stored status was never updated. The balance wins,
    // or the pane tells the operator an invoice is owed when it is not.
    renderLedger([mkInvoice({ amount_paid: 30000, payment_status: 'unpaid' })], [mkEntry()]);
    expect(screen.getByText('Paid')).toBeTruthy();
  });

  it('nets a credit note off the balance it labels', () => {
    // 10,000 billed, 4,000 credited, nothing received => 6,000 still owed.
    renderLedger([mkInvoice({ credit_notes_total: 4000 })], [mkEntry()]);
    expect(screen.getByText('Unpaid')).toBeTruthy();
    expect(screen.getByTitle(/Outstanding/)).toBeTruthy();
  });

  it('says nothing on a payment row', () => {
    // A payment IS the act of settling; labelling it "Paid" would be circular
    // and would also double-count against the invoice badge above it.
    renderLedger(
      [mkInvoice({ amount_paid: 30000 })],
      [mkEntry({ id: 'led-2', entry_type: 'payment', reference_id: 'pay-1', reference_number: 'PAY-1', debit: 0, credit: 30000 })],
    );
    expect(screen.queryByText('Paid')).toBeNull();
  });

  it('says nothing when the invoice is no longer in the store', () => {
    // A judgement is impossible; asserting "Unpaid" would be a guess.
    renderLedger([], [mkEntry()]);
    expect(screen.queryByText('Unpaid')).toBeNull();
    expect(screen.queryByText('Paid')).toBeNull();
    expect(screen.queryByText('Partial')).toBeNull();
  });
});
