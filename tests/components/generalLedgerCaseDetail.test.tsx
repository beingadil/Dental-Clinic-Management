// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/* Returns a real result shape. The production `downloadPdf` is awaited now and
   its outcome inspected, so a mock returning undefined made the success path
   look like a failure and fired the error alert. */
const downloadPdf = vi.fn((_name: unknown, _bytes: unknown) =>
  Promise.resolve({ status: 'saved' as const, path: 'ledger.pdf', bytes: 8 }),
);
const buildLedgerReportPdf = vi.fn((_rows: unknown, _summary: unknown, _meta: unknown) => ({ pdf: new Uint8Array([1]) }));
// Intercept the PDF builder itself so we can assert on the exact narration
// rows that reach the printed document, not just that a file was downloaded.
vi.mock('../../src/lib/ledgerPdf', () => ({
  buildLedgerReportPdf: (rows: unknown, summary: unknown, meta: unknown) => buildLedgerReportPdf(rows, summary, meta),
}));
vi.mock('../../src/lib/pdf', () => ({
  downloadPdf: (name: unknown, bytes: unknown) => downloadPdf(name, bytes),
}));

const { CASE, LEDGER, ADJUSTMENT } = vi.hoisted(() => {
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
    {
      id: 'l3',
      date: '2026-10-07',
      entry_type: 'credit_note',
      reference_id: 'adj-1',
      reference_number: 'CR-0001',
      description: 'Credit Note: goodwill',
      debit: 0,
      credit: 500,
      running_balance: 24500,
    },
  ];
  const adjustment = {
    id: 'adj-1',
    adjustment_number: 'CR-0001',
    type: 'credit_note' as const,
    amount: 500,
    reason: 'goodwill',
    date: '2026-10-07',
    lab_id: 'lab-1',
    lab_name: 'Cases Clinic',
  };
  return { CASE: kase, LEDGER: ledger, ADJUSTMENT: adjustment };
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
    accountAdjustments: [ADJUSTMENT],
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
  buildLedgerReportPdf.mockClear();
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
  fireEvent.click(screen.getByRole('button', { name: /^today$/i }));
  fireEvent.click(screen.getByRole('button', { name: 'All Time' }));
  // Rows mount only once the user asks to preview the ledger.
  fireEvent.click(screen.getByRole('button', { name: /preview/i }));
};

describe('GeneralLedgerView invoice narration', () => {
  it('shows the complete invoice facts in the detail box only', () => {
    renderLedger();

    expect(screen.queryByText(/Invoice for Zirconia Crown/)).toBeNull();
    expect(screen.getByText('Patient')).toBeTruthy();
    expect(screen.getByText('Ali Raza')).toBeTruthy();
    expect(screen.getByText('Teeth')).toBeTruthy();
    expect(screen.getByText('#11, #21')).toBeTruthy();
    expect(screen.getByText('Shade')).toBeTruthy();
    expect(screen.getByText('A2')).toBeTruthy();
    expect(screen.getByText('Received')).toBeTruthy();
    expect(screen.getByText('Oct 3, 2026')).toBeTruthy();
    expect(screen.getByText('Delivery')).toBeTruthy();
    expect(screen.getByText('Dec 20, 2026')).toBeTruthy();
    expect(screen.getByText('2 units')).toBeTruthy();
  });

  it('does not repeat the case facts in the narration line above the box', () => {
    renderLedger();

    expect(screen.queryByText(/INV-0042 \| Case DS-2001/)).toBeNull();
    expect(screen.queryByText(/Invoice for Zirconia Crown/)).toBeNull();
    expect(screen.queryByText(/Patient: Ali Raza/)).toBeNull();
    expect(screen.queryByText(/Teeth: #11, #21/)).toBeNull();
    expect(screen.queryByText(/Doctor:/)).toBeNull();
    expect(screen.queryByText(/Material:/)).toBeNull();
  });

  it('renders the detail box once, on the invoice row only', () => {
    renderLedger();

    expect(screen.getAllByText('Procedure')).toHaveLength(1);
    expect(screen.getAllByText('Patient')).toHaveLength(1);
    expect(screen.queryByText(/Invoice for Zirconia Crown/)).toBeNull();
    expect(screen.getAllByText('PAY-0007')).toHaveLength(1);
    expect(screen.getByText(/Bank Receipt/)).toBeTruthy();
  });

  it('opens a credit/debit adjustment from its ledger voucher', () => {
    renderLedger();

    fireEvent.click(screen.getByRole('button', { name: 'Open adjustment CR-0001' }));
    expect(screen.getByText('Edit Adjustment')).toBeTruthy();
  });

  it('puts the case identity in the printed PDF narration', () => {
    renderLedger();
    fireEvent.click(screen.getByText('Export PDF'));

    expect(buildLedgerReportPdf).toHaveBeenCalledTimes(1);
    const entries = buildLedgerReportPdf.mock.calls[0][0] as {
      caseNumber: string;
      narration: string;
      bodyNarration?: string;
    }[];

    const invoice = entries.find((e) => e.caseNumber === 'DS-2001');

    /* The narration keeps every fact that is not already a column, and keeps
       the voucher/case relationship explicit for audit. */
    expect(invoice?.bodyNarration).toContain('Zirconia Crown');
    expect(invoice?.bodyNarration).toContain('Patient: Ali Raza');
    expect(invoice?.bodyNarration).toContain('Teeth: #11, #21');
    expect(invoice?.bodyNarration).toContain('Shade: A2');

    // Voucher and case have their own combined column; they do not repeat in
    // the printed description.
    expect(invoice?.bodyNarration).not.toContain('INV-0042');
    expect(invoice?.bodyNarration).not.toContain('Case DS-2001');

    // Dates and the case header are columns; they do not repeat in narration.
    expect(invoice?.bodyNarration).not.toContain('Received Date');
    expect(invoice?.bodyNarration).not.toContain('Oct 3, 2026');
    expect(invoice?.bodyNarration).not.toContain('Delivery Date');
    expect(invoice?.bodyNarration).not.toContain('Dec 20, 2026');
    expect(invoice?.bodyNarration).not.toContain('Procedure:');
    expect(invoice?.bodyNarration).not.toContain('Doctor:');
    expect(invoice?.bodyNarration).not.toContain('Material:');

    // Units repeats what the tooth list already counts. It survives only on an
    // uncharted case, where it is the only quantity on the page.
    expect(invoice?.bodyNarration).not.toContain('Units:');

    // The payment row carries no case detail.
    const payment = entries.find((e) => !e.caseNumber);
    expect(payment?.narration).not.toContain('Procedure:');

    expect(downloadPdf).toHaveBeenCalledTimes(1);
  });
});