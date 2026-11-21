// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

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
}));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [LAB],
    cases: [CASE],
    invoices: store.invoices,
    brandingSettings: { appName: 'DENTAL SOLUTIONS', lab_name: 'DENTAL SOLUTIONS' },
    getLedgerEntries: () => store.entries,
    setSelectedCaseForModal: () => {},
    user: { id: 'u1', name: 'Tester', role: 'Super Admin' },
  }),
}));

import { GeneralLedgerView } from '../../src/components/billing/GeneralLedgerView';

afterEach(cleanup);

const renderLedger = (invoices: unknown[], entries: unknown[]) => {
  store.invoices = invoices;
  store.entries = entries;
  const r = render(<GeneralLedgerView />);
  fireEvent.click(screen.getByText(/select clinic/i));
  fireEvent.click(screen.getByText('Cases Clinic'));
  fireEvent.click(screen.getByRole('button', { name: /^today$/i }));
  fireEvent.click(screen.getByRole('button', { name: 'All Time' }));
  fireEvent.click(screen.getByRole('button', { name: /preview/i }));
  return r;
};

describe('General Ledger: one row per payment voucher', () => {
  it('collapses a receipt split across two invoices into one row', () => {
    const invA = {
      id: 'inv-a', invoice_number: 'INV-A', case_id: 'case-1', case_number: 'DS-2001',
      lab_id: 'lab-1', lab_name: 'Cases Clinic', case_type_name: 'Zirconia Crown',
      patient_name: 'Ali Raza', amount: 75000, discount: 0, final_amount: 75000,
      amount_paid: 75000, credit_notes_total: 0, payment_status: 'paid',
      issue_date: '2026-10-03', due_date: '2026-10-17', created_at: '2026-10-03T00:00:00Z',
      payments: [{ id: 'pay-a', payment_number: 'PAY-1-1', payment_date: '2026-10-03', amount: 75000, payment_method: 'bank', lab_id: 'lab-1', lab_name: 'Cases Clinic' }],
    };
    const invB = {
      id: 'inv-b', invoice_number: 'INV-B', case_id: 'case-1', case_number: 'DS-2001',
      lab_id: 'lab-1', lab_name: 'Cases Clinic', case_type_name: 'Zirconia Crown',
      patient_name: 'Ali Raza', amount: 75000, discount: 0, final_amount: 75000,
      amount_paid: 75000, credit_notes_total: 0, payment_status: 'paid',
      issue_date: '2026-10-03', due_date: '2026-10-17', created_at: '2026-10-03T00:00:00Z',
      payments: [{ id: 'pay-b', payment_number: 'PAY-1-2', payment_date: '2026-10-03', amount: 75000, payment_method: 'bank', lab_id: 'lab-1', lab_name: 'Cases Clinic' }],
    };
    const entryA = {
      id: 'led-a', date: '2026-10-03', lab_id: 'lab-1', lab_name: 'Cases Clinic',
      entry_type: 'payment', reference_id: 'pay-a', reference_number: 'PAY-1-1',
      case_id: 'case-1', case_number: 'DS-2001', description: 'Payment received for INV-A via BANK',
      debit: 0, credit: 75000, running_balance: 0, posted_at: '2026-10-03T10:00:01.000Z',
      payment_method: 'bank',
    };
    const entryB = {
      id: 'led-b', date: '2026-10-03', lab_id: 'lab-1', lab_name: 'Cases Clinic',
      entry_type: 'payment', reference_id: 'pay-b', reference_number: 'PAY-1-2',
      case_id: 'case-1', case_number: 'DS-2001', description: 'Payment received for INV-B via BANK',
      debit: 0, credit: 75000, running_balance: 0, posted_at: '2026-10-03T10:00:02.000Z',
      payment_method: 'bank',
    };
    const invoiceEntries = [
      {
        id: 'led-inv-a', date: '2026-10-03', lab_id: 'lab-1', lab_name: 'Cases Clinic',
        entry_type: 'invoice', reference_id: 'inv-a', reference_number: 'INV-A',
        case_id: 'case-1', case_number: 'DS-2001', description: 'Invoice for Zirconia Crown',
        debit: 75000, credit: 0, running_balance: 0, posted_at: '2026-10-03T09:00:00.000Z',
      },
      {
        id: 'led-inv-b', date: '2026-10-03', lab_id: 'lab-1', lab_name: 'Cases Clinic',
        entry_type: 'invoice', reference_id: 'inv-b', reference_number: 'INV-B',
        case_id: 'case-1', case_number: 'DS-2001', description: 'Invoice for Zirconia Crown',
        debit: 75000, credit: 0, running_balance: 0, posted_at: '2026-10-03T09:00:01.000Z',
      },
    ];

    renderLedger([invA, invB], [...invoiceEntries, entryA, entryB]);

    // One collapsed voucher row: the chip shows the base number, not the slices.
    expect(screen.getAllByText('PAY-1')).toHaveLength(1);
    // The narration lists every invoice the receipt adjusted.
    expect(screen.getByText(/Applied to 2 invoices/i)).toBeTruthy();
    expect(screen.getByText(/INV-A · PKR 75,000/i)).toBeTruthy();
    expect(screen.getByText(/INV-B · PKR 75,000/i)).toBeTruthy();
    // One credit of 150,000, not two of 75,000.
    expect(screen.getAllByText(/PKR 150,000/).length).toBeGreaterThanOrEqual(1);
  });
});
