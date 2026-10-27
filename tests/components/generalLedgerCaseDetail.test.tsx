// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/* Returns a real result shape. The production `downloadPdf` is awaited now and
   its outcome inspected, so a mock returning undefined made the success path
   look like a failure and fired the error alert. */
const downloadPdf = vi.fn((_name: unknown, _bytes: unknown) =>
  Promise.resolve({ status: 'saved' as const, path: 'ledger.pdf', bytes: 8 }),
);
const buildLedgerPdf = vi.fn((_entries: unknown, _meta: unknown) => ({ pdf: new Uint8Array([1]) }));
// Intercept the PDF builder itself so we can assert on the exact narration
// rows that reach the printed document, not just that a file was downloaded.
vi.mock('../../src/lib/pdf', () => ({
  buildLedgerPdf: (entries: unknown, meta: unknown) => buildLedgerPdf(entries, meta),
  downloadPdf: (name: unknown, bytes: unknown) => downloadPdf(name, bytes),
}));

const { CASE, LEDGER } = vi.hoisted(() => {
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
  const ledger = [
    {
      id: 'l1',
      date: '2026-10-05',
      entry_type: 'invoice',
      reference_number: 'INV-0042',
      description: 'Zirconia Crown',
      doctor_name: 'Dr. Tariq Mahmood',
      lab_name: 'Cases Clinic',
      case_id: 'case-1',
      case_number: 'DS-2001',
      debit: 30000,
      credit: 0,
      running_balance: 30000,
      payment_method: undefined,
    },
    {
      id: 'l2',
      date: '2026-10-06',
      entry_type: 'payment',
      reference_number: 'PAY-0007',
      description: 'Bank transfer',
      doctor_name: undefined,
      lab_name: 'Cases Clinic',
      payment_method: 'bank',
      debit: 0,
      credit: 5000,
      running_balance: 25000,
    },
  ];
  return { CASE: kase, LEDGER: ledger };
});

// The general ledger needs a clinic picked before it renders rows; the stub
// supplies one lab and its ledger so the test drives the real dropdown.
/* The invoice the ledger bills. The preview derives a Paid / Partial /
   Unpaid badge per invoice row from the live invoice list, so the mock has
   to supply it. 30,000 with 10,000 received leaves 20,000 outstanding, so
   the badge reads 'Partial'. */
const INVOICE = {
  id: 'inv-0042',
  invoice_number: 'INV-0042',
  case_id: 'case-2001',
  case_number: 'DS-2001',
  lab_id: 'lab-1',
  lab_name: 'Cases Clinic',
  case_type_name: 'Zirconia Crown',
  doctor_name: 'Dr. Ali',
  patient_name: 'Ali Raza',
  amount: 30000,
  discount: 0,
  final_amount: 30000,
  amount_paid: 10000,
  credit_notes_total: 0,
  payment_status: 'partial',
  issue_date: '2026-10-03',
  due_date: '2026-10-17',
  created_at: '2026-10-03T00:00:00Z',
  payments: [],
};

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [{ id: 'lab-1', name: 'Cases Clinic' }],
    cases: [CASE],
    invoices: [INVOICE],
    brandingSettings: { appName: 'DENTAL SOLUTIONS', lab_name: 'DENTAL SOLUTIONS' },
    getLedgerEntries: () => LEDGER,
    setSelectedCaseForModal: () => {},
    user: { id: 'u1', name: 'Tester', role: 'Super Admin' },
  }),
}));

import { GeneralLedgerView } from '../../src/components/billing/GeneralLedgerView';

afterEach(() => {
  cleanup();
  downloadPdf.mockClear();
  buildLedgerPdf.mockClear();
});

/** Picks "Cases Clinic" in the header dropdown so the ledger rows mount. */
const renderLedger = () => {
  render(<GeneralLedgerView />);
  // The clinic picker is a click-to-open div, not a button.
  fireEvent.click(screen.getByText(/select clinic/i));
  fireEvent.click(screen.getByText('Cases Clinic'));
  // The ledger opens on the Today preset; widen it so the fixture dates show.
  // The standalone Quick Dates pills are gone; the presets live inside the
  // shared picker's own popover now, which is the path an operator takes.
  fireEvent.click(screen.getByTitle(/filter by date range|select date/i));
  fireEvent.click(screen.getByRole('button', { name: 'All Time' }));
  // Rows mount only once the user asks to preview the ledger.
  fireEvent.click(screen.getByRole('button', { name: /preview/i }));
};

describe('GeneralLedgerView case detail', () => {
  it('shows the case identity and both dates on the invoice row', () => {
    renderLedger();

    expect(screen.getByText('Patient')).toBeTruthy();
    expect(screen.getByText('Ali Raza')).toBeTruthy();
    expect(screen.getByText('Procedure')).toBeTruthy();
    expect(screen.getByText('Zirconia Crown')).toBeTruthy();
    expect(screen.getByText('Teeth')).toBeTruthy();
    expect(screen.getByText('#11, #21')).toBeTruthy();
    expect(screen.getByText('Shade')).toBeTruthy();
    expect(screen.getByText('A2')).toBeTruthy();
    expect(screen.getByText('Received Date')).toBeTruthy();
    expect(screen.getByText('Oct 3, 2026')).toBeTruthy();
    // The promised day is its own row, so it can never be read as the
    // day the job already reached the bench.
    expect(screen.getByText('Delivery Date')).toBeTruthy();
    expect(screen.getByText('Dec 20, 2026')).toBeTruthy();
  });

  it('leaves doctor and material to the case record, and states the unit count', () => {
    renderLedger();

    expect(screen.queryByText('Doctor')).toBeNull();
    expect(screen.queryByText('Material')).toBeNull();
    expect(screen.queryByText('Dr. Tariq Mahmood')).toBeNull();

    // CHANGED (compact invoice): this test used to assert `Units` was ABSENT
    // — "units belong to the case record, not the money line". A printed
    // invoice now prints the count instead of the tooth list, so the ledger
    // block carries it too. The fixture charts two teeth, so it reads "2 units".
    expect(screen.getByText('Units')).toBeTruthy();
    expect(screen.getByText('2 units')).toBeTruthy();
  });

  it('renders the detail block once, on the invoice row only', () => {
    renderLedger();
    // The doctor sub-line the block used to replace stays gone.
    expect(screen.queryByText(/^Doctor: /)).toBeNull();
    // Only the invoice row has a detail block.
    expect(screen.getAllByText('Procedure')).toHaveLength(1);
  });

  it('puts the case identity in the printed PDF narration', () => {
    renderLedger();
    fireEvent.click(screen.getByText('Export PDF'));

    expect(buildLedgerPdf).toHaveBeenCalledTimes(1);
    const entries = buildLedgerPdf.mock.calls[0][0] as {
      caseNumber: string;
      narration: string;
    }[];

    const invoice = entries.find((e) => e.caseNumber === 'DS-2001');

    /* CHANGED (ledger print compaction).
     *
     * The printed line used to open "Case Invoice - INV-0042  Invoice for
     * Zirconia Crown (DS-2001) - Patient: Ali Raza - ... - Received Date: Oct 3,
     * 2026 - Delivery Date: Dec 20, 2026". Four of those facts were already
     * columns on the same row, and Received Date contradicted the Date column
     * directly above it.
     *
     * What the description now says is what the columns do not:
     *   Zirconia Crown - Patient: Ali Raza - Teeth: #11, #21 - Shade: A2
     */
    expect(invoice?.narration).toContain('Zirconia Crown');
    expect(invoice?.narration).toContain('Patient: Ali Raza');
    expect(invoice?.narration).toContain('Teeth: #11, #21');
    expect(invoice?.narration).toContain('Shade: A2');

    // Already a column, or already said by the heading.
    expect(invoice?.narration).not.toContain('INV-0042');
    expect(invoice?.narration).not.toContain('DS-2001');
    expect(invoice?.narration).not.toContain('Received Date');
    expect(invoice?.narration).not.toContain('Oct 3, 2026');
    expect(invoice?.narration).not.toContain('Delivery Date');
    expect(invoice?.narration).not.toContain('Dec 20, 2026');
    expect(invoice?.narration).not.toContain('Procedure:');
    expect(invoice?.narration).not.toContain('Doctor:');
    expect(invoice?.narration).not.toContain('Material:');

    // Units repeats what the tooth list already counts. It survives only on an
    // uncharted case, where it is the only quantity on the page.
    expect(invoice?.narration).not.toContain('Units:');

    // The payment row carries no case detail.
    const payment = entries.find((e) => !e.caseNumber);
    expect(payment?.narration).not.toContain('Procedure:');

    expect(downloadPdf).toHaveBeenCalledTimes(1);
  });
});