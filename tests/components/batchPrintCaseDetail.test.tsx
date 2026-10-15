// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

const { CASE, INVOICE, LAB, TODAY } = vi.hoisted(() => {
  // The modal opens on the Today period, so the fixture invoice is dated today.
  const now = new Date();
  const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const kase = {
    id: 'case-1',
    case_number: 'DS-2001',
    patient_name: 'Ali Raza',
    lab_id: 'lab-1',
    lab_name: 'Cases Clinic',
    case_type_id: 'ct-1',
    case_type_name: 'Zirconia Crown',
    units_count: 3,
    doctor_name: 'Dr. Tariq Mahmood',
    selected_teeth: [21, 11],
    shade: 'A2',
    material: 'Zirconia',
    delivery_date: '2026-12-20',
    received_date: '2026-10-03',
    priority: 'normal',
    price: 30000,
    discount: 0,
    final_price: 30000,
    status: 'received',
    created_at: '2026-10-01 09:00',
    updated_at: '2026-10-01 09:00',
    history: [],
  };
  return {
    CASE: kase,
    TODAY,
    LAB: { id: 'lab-1', name: 'Cases Clinic', doctor_name: 'Tariq Mahmood' },
    // Unpaid, so it survives the modal's "balance due > 0" filter, and dated
    // today so it survives the default Today period.
    INVOICE: {
      id: 'inv-1',
      invoice_number: 'INV-0042',
      case_id: 'case-1',
      case_number: 'DS-2001',
      lab_id: 'lab-1',
      lab_name: 'Cases Clinic',
      case_type_name: 'Zirconia Crown',
      doctor_name: 'Tariq Mahmood',
      patient_name: 'Ali Raza',
      amount: 30000,
      discount: 0,
      final_amount: 30000,
      amount_paid: 10000,
      payment_status: 'partial',
      issue_date: null, // set by the test to today
      due_date: '',
      created_at: '',
      payments: [],
    },
  };
});

// Print settings read SQLite through the settings repo; the layout under test
// is the shipped default, so the store is stubbed out entirely.
vi.mock('../../src/services/printSettings', () => ({
  loadPrintSettings: () => ({
    paper: 'a4',
    margin: 'normal',
    fontSize: 'normal',
    showLogo: true,
    logoPosition: 'left',
    jobSlipStyle: 'full',
  }),
  loadDocumentSections: (_kind: string, fallback: string[]) => [...fallback],
}));

// Mutable so a test can swap the case list to exercise the fallback path,
// where an invoice names a case that is no longer in the store.
const store = vi.hoisted(() => ({ cases: [] as unknown[] }));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [LAB],
    invoices: [{ ...INVOICE, issue_date: TODAY, created_at: TODAY }],
    cases: store.cases,
    brandingSettings: {
      appName: 'DENTAL SOLUTIONS',
      tagline: '',
      phone: '',
      email: '',
      address: '',
    },
    saveVoucherToSystem: () => {},
  }),
}));

import { BatchInvoicePrintModal } from '../../src/components/billing/BatchInvoicePrintModal';
import { SEP } from '../../src/components/print/printRenderer';

/* The inline-join separator, as an escape rather than a pasted literal.
   A shell round-trip corrupted that literal once and the suite then failed
   with a message pointing at the renderer instead of the test. Keep this in
   step with SEP in printRenderer.tsx. */


afterEach(cleanup);

describe('BatchInvoicePrintModal case detail', () => {
  beforeEach(() => {
    store.cases = [CASE];
  });

  it('prints the case identity on the summary sheet', () => {
    render(<BatchInvoicePrintModal onClose={() => {}} />);

    // The statement table resolves the invoice to its case: the number shows
    // twice on screen, once in the selection list and once on the sheet.
    expect(screen.getAllByText('INV-0042')).toHaveLength(2);
    // CHANGED (compact invoice): the case block is no longer a bordered
    // two-column <dl> of labelled pairs ("PATIENT Ali Raza / PROCEDURE
    // Zirconia Crown / TEETH #11, #21"). It is ONE inline line whose values are
    // joined with a middot, so there are no label nodes on the sheet at all —
    // the whole joined string is a single text node and the assertion moves
    // from the labels to the values. Same facts, minus the box: patient,
    // product, and the unit count that replaced the tooth list.
    // SEP below is the escape the renderer uses for its inline join, so this
    // assertion tracks the code instead of duplicating a literal middle dot
    // that a shell round-trip can silently corrupt (it already did once).
    expect(screen.getByText(`Ali Raza${SEP}Zirconia Crown${SEP}2 units`)).toBeTruthy();
    // The tooth list and the promised day are both off a billing row.
    expect(screen.queryByText('#11, #21')).toBeNull();
    expect(screen.queryByText('Dec 20, 2026')).toBeNull();
    // …and with the labels gone, so are the label strings themselves.
    expect(screen.queryByText('Patient')).toBeNull();
    expect(screen.queryByText('Procedure')).toBeNull();
    expect(screen.queryByText('Teeth')).toBeNull();
    expect(screen.queryByText('Delivery Date')).toBeNull();
  });

  it(
    'leads the row with the Date column instead of burying the date in the case block',
  () => {
    render(<BatchInvoicePrintModal onClose={() => {}} />);

    // The date a clinic reconciles against is the day the lab took the job in,
    // so it owns the first column, ahead of the invoice number. It used to
    // print the invoice's issue date there and repeat the received date as a
    // row in the case block, putting two different clocks on one line.
    //
    // Scoped to the printed sheet: the on-screen picker now labels its column
    // `Date` too, which is correct — but it makes a page-wide query ambiguous,
    // and the test is about what comes out of the printer.
    const sheet = document.querySelector('.print-doc-page') as HTMLElement;
    expect(within(sheet).getByText('Date')).toBeTruthy();
    expect(screen.getByText('Oct 3, 2026')).toBeTruthy();

    // …and the block must not repeat it, nor carry a shade the column area
    // already speaks for.
    expect(screen.queryByText('Received Date')).toBeNull();
    expect(screen.queryByText('Shade')).toBeNull();
  });

  it('names the patient and procedure in the selection list', () => {
    render(<BatchInvoicePrintModal onClose={() => {}} />);

    // The operator sees what they are about to print without opening a case.
    expect(screen.getByText('Ali Raza · Zirconia Crown')).toBeTruthy();
  });

  it('falls back to the bare case number when the case is gone', () => {
    // printRenderer.tsx claims omitting `cases` "degrades to the bare case
    // number rather than breaking". An invoice can outlive its case — the
    // store is edited in place — so that claim needs to hold, not just be
    // plausible: the sheet must still print the invoice and its numbers.
    store.cases = [];
    render(<BatchInvoicePrintModal onClose={() => {}} />);

    // The case number still appears on both the picker row and the sheet.
    expect(screen.getAllByText('DS-2001')).toHaveLength(2);
    // The money columns are untouched by the missing join.
    expect(screen.getAllByText('PKR 30,000').length).toBeGreaterThan(0);
    // And the detail block is simply absent, not half-rendered.
    expect(screen.queryByText('Ali Raza')).toBeNull();
    expect(screen.queryByText('Patient')).toBeNull();
  });
});