// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { DentalCase, Invoice } from '../../src/types';

const { CASE, INVOICE } = vi.hoisted(() => {
  // Typed so a test can hand the drawer a case whose dates are NULL, the way
  // rows created before the received-date migration actually look.
  const kase: DentalCase = {
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
  const invoice = {
    id: 'inv-1',
    invoice_number: 'INV-0042',
    case_id: 'case-1',
    case_number: 'DS-2001',
    lab_id: 'lab-1',
    lab_name: 'Cases Clinic',
    case_type_name: 'Zirconia Crown',
    doctor_name: 'Dr. Tariq Mahmood',
    patient_name: 'Ali Raza',
    amount: 30000,
    discount: 0,
    final_amount: 30000,
    amount_paid: 0,
    payment_status: 'unpaid',
    due_date: '2026-11-05',
    created_at: '2026-10-05 09:00',
    payments: [],
  } as unknown as Invoice;
  return { CASE: kase, INVOICE: invoice };
});

// Swappable so a test can point the drawer at a case with no dates at all.
// The factory only closes over the name; the value is read at render time.
let activeCase = CASE;

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    cases: [activeCase],
    accountAdjustments: [],
    journalEntries: [],
    advancePayments: [],
    applyAdvanceCreditV2: () => true,
  }),
}));

import { InvoiceDetailDrawer } from '../../src/components/billing/InvoiceDetailDrawer';
import { caseDetailLines } from '../../src/services/ledgerCaseDetail';

beforeEach(() => {
  activeCase = CASE;
});

afterEach(() => cleanup());

const noop = () => {};

const renderDrawer = (invoice: Invoice = INVOICE) =>
  render(
    <InvoiceDetailDrawer
      isOpen
      onClose={noop}
      invoice={invoice}
      onOpenPaymentModal={noop}
      onOpenCreditNoteModal={noop}
      onOpenJournalModal={noop}
      onPrintInvoice={noop}
      onViewReceipt={noop}
      onReversePayment={noop}
    />,
  );

/** Scopes queries to the Clinical Case Information card. The drawer header and
 *  the bill-to card repeat the patient and the procedure, so a bare getByText
 *  on those values would pass even if the case block lost them. */
const caseBlock = () => {
  const heading = screen.getByText('Clinical Case Information');
  const card = heading.closest<HTMLElement>('div.p-4');
  if (!card) throw new Error('case detail card not found');
  return within(card);
};

/** The card's label/value grid itself, excluding the header's title and the
 *  case-number badge, so a row-by-row comparison sees only the detail rows. */
const caseGrid = () => {
  const heading = screen.getByText('Clinical Case Information');
  const card = heading.closest<HTMLElement>('div.p-4');
  const grid = card?.querySelector<HTMLElement>('.grid');
  if (!grid) throw new Error('case detail grid not found');
  return grid;
};

describe('InvoiceDetailDrawer case detail', () => {
  it('shows patient, teeth, procedure, shade and both dates', () => {
    renderDrawer();
    const block = caseBlock();

    expect(block.getByText('Patient')).toBeTruthy();
    expect(block.getByText('Ali Raza')).toBeTruthy();
    expect(block.getByText('Teeth')).toBeTruthy();
    expect(block.getByText('#11, #21')).toBeTruthy();
    expect(block.getByText('Procedure')).toBeTruthy();
    expect(block.getByText('Zirconia Crown')).toBeTruthy();
    expect(block.getByText('Shade')).toBeTruthy();
    expect(block.getByText('A2')).toBeTruthy();
    expect(block.getByText('Received Date')).toBeTruthy();
    expect(block.getByText('Oct 3, 2026')).toBeTruthy();
    // The promised day gets its own row, never folded into the received one.
    expect(block.getByText('Delivery Date')).toBeTruthy();
    expect(block.getByText('Dec 20, 2026')).toBeTruthy();
  });

  /* The drift guard: this drawer must render the shared formatter's rows, not a
   * hand-copied list. Adding or renaming a row in ledgerCaseDetail therefore
   * fails here until the drawer renders it. */
  it('renders exactly the rows the shared case formatter produces', () => {
    renderDrawer();
    const block = caseBlock();

    const expected = caseDetailLines(CASE);
    expect(expected.length).toBeGreaterThan(0);
    expect(
      Array.from(caseGrid().querySelectorAll('span'))
        .map((el) => el.textContent?.trim())
        .filter((t): t is string => !!t),
    ).toEqual(expected.flatMap((l) => [l.label, l.value]));
  });

  it('falls back to the registration day when the case has no received date', () => {
    activeCase = { ...CASE, received_date: null };
    renderDrawer();

    expect(caseBlock().getByText('Received Date')).toBeTruthy();
    expect(caseBlock().getByText('Oct 1, 2026')).toBeTruthy();
  });

  it('drops the received-date row, but keeps the promised one, when no day was entered', () => {
    activeCase = { ...CASE, received_date: null, created_at: '' };
    renderDrawer();

    const block = caseBlock();
    // No received date and no registration day: the row goes rather than
    // printing a placeholder, exactly as the ledger's block behaves.
    expect(block.queryByText('Received Date')).toBeNull();
    // The promise is independent of the received date and still stands.
    expect(block.getByText('Delivery Date')).toBeTruthy();
    expect(block.getByText('Dec 20, 2026')).toBeTruthy();
  });

  it('drops the delivery-date row when the case was never promised a day', () => {
    activeCase = { ...CASE, delivery_date: '' };
    renderDrawer();

    const block = caseBlock();
    expect(block.getByText('Received Date')).toBeTruthy();
    expect(block.getByText('Oct 3, 2026')).toBeTruthy();
    expect(block.queryByText('Delivery Date')).toBeNull();
  });

  it('drops doctor, units and status from the case block', () => {
    renderDrawer();
    const block = caseBlock();

    expect(block.queryByText('Doctor / Surgeon')).toBeNull();
    expect(block.queryByText('Dr. Tariq Mahmood')).toBeNull();
    expect(block.queryByText('Units / Teeth')).toBeNull();
    expect(block.queryByText('Case Type')).toBeNull();
    expect(block.queryByText('Shade Guide')).toBeNull();
    expect(block.queryByText('Status')).toBeNull();
  });

  it('renders the case block only when the invoice links a case', () => {
    renderDrawer({ ...INVOICE, case_id: 'gone', case_number: '' });

    expect(screen.queryByText('Clinical Case Information')).toBeNull();
    expect(screen.queryByText('Teeth')).toBeNull();
    expect(screen.queryByText('Received Date')).toBeNull();
  });
});