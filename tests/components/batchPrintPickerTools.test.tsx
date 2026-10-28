// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

/* The batch picker is a selection surface, not a report. These guard the
   behaviours an operator needs at month end:

   1. Same-day invoices follow entry order (invoice number), never the store's
      newest-first order — otherwise the printed statement reads backwards.
   2. Search / status filter narrow what is SHOWN without silently changing the
      selection; the footer always reports the true run.
   3. The header checkbox acts on the visible rows (standard table behaviour).
   4. The paper preview starts collapsed, but its sheets stay in the DOM so the
      print stylesheet still prints the batch. */

const { LAB, TODAY } = vi.hoisted(() => {
  const now = new Date();
  const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  return { TODAY, LAB: { id: 'lab-1', name: 'Cases Clinic', doctor_name: 'Tariq Mahmood' } };
});

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

const store = vi.hoisted(() => ({ invoices: [] as unknown[], cases: [] as unknown[] }));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [LAB],
    invoices: store.invoices,
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

afterEach(cleanup);

const mkCase = (i: number) => ({
  id: `case-${i}`,
  case_number: `DS-${1000 + i}`,
  patient_name: `Patient ${i}`,
  lab_id: 'lab-1',
  lab_name: 'Cases Clinic',
  case_type_name: 'Zirconia Crown',
  doctor_name: 'Tariq Mahmood',
  selected_teeth: [21],
  shade: 'A2',
  material: 'Zirconia',
  received_date: TODAY,
  delivery_date: '2026-11-01',
  status: 'received',
  history: [],
});

const mkInvoice = (i: number, amountPaid: number) => ({
  id: `inv-${i}`,
  invoice_number: `INV-${2000 + i}`,
  case_id: `case-${i}`,
  case_number: `DS-${1000 + i}`,
  lab_id: 'lab-1',
  lab_name: 'Cases Clinic',
  case_type_name: 'Zirconia Crown',
  doctor_name: 'Tariq Mahmood',
  patient_name: `Patient ${i}`,
  amount: 10000,
  discount: 0,
  final_amount: 10000,
  amount_paid: amountPaid,
  payment_status: amountPaid >= 10000 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid',
  issue_date: TODAY,
  due_date: '2026-11-10',
  created_at: TODAY,
  payments: [],
});

const renderBatch = (
  invoices = [
    /* Deliberately newest-first, the order the store hands them over. */
    mkInvoice(2, 10000),
    mkInvoice(1, 4000),
    mkInvoice(0, 0),
  ],
) => {
  store.invoices = invoices;
  store.cases = invoices.map((inv) => mkCase(Number(inv.id.split('-')[1])));
  const r = render(<BatchInvoicePrintModal onClose={() => {}} />);
  const table = r.container.querySelector('table') as HTMLTableElement;
  return { ...r, table };
};

/** Rows of the on-screen picker only (the printed statement has tables too). */
const pickerRows = (table: HTMLTableElement) =>
  Array.from(table.querySelectorAll('tbody tr')) as HTMLTableRowElement[];

const rowFor = (table: HTMLTableElement, invoiceNumber: string) =>
  pickerRows(table).find((tr) => within(tr).queryByText(invoiceNumber))!;

describe('batch print picker', () => {
  it('lists same-day invoices in entry order, oldest number first', () => {
    const { table } = renderBatch();
    const numbers = pickerRows(table).map(
      (tr) => tr.querySelector('td.font-mono')?.textContent,
    );
    expect(numbers).toEqual(['INV-2000', 'INV-2001', 'INV-2002']);
  });

  it('labels each row with the money state, so a paid invoice is not a mystery', () => {
    const { table } = renderBatch();
    expect(within(rowFor(table, 'INV-2000')).getByText('Unpaid')).toBeTruthy();
    expect(within(rowFor(table, 'INV-2001')).getByText('Partial')).toBeTruthy();
    expect(within(rowFor(table, 'INV-2002')).getByText('Paid')).toBeTruthy();
    expect(screen.getByText('3 of 3 invoices selected')).toBeTruthy();
  });

  it('search narrows the rows without changing what is selected', () => {
    const { table } = renderBatch();
    fireEvent.change(screen.getByLabelText('Search invoices in this batch'), {
      target: { value: 'Patient 1' },
    });

    expect(pickerRows(table)).toHaveLength(1);
    expect(within(table).getByText('INV-2001')).toBeTruthy();
    // Still the whole run: the hidden rows are part of the batch.
    expect(screen.getByText('3 of 3 invoices selected')).toBeTruthy();
  });

  it('status filter keeps only the matching money state', () => {
    const { table } = renderBatch();
    fireEvent.click(screen.getByRole('button', { name: 'Paid' }));

    expect(pickerRows(table)).toHaveLength(1);
    expect(within(table).getByText('INV-2002')).toBeTruthy();
    expect(screen.getByText('1 of 3 shown')).toBeTruthy();
  });

  it('clicking anywhere on a row toggles it, and the header selects the visible set', () => {
    const { table } = renderBatch();

    fireEvent.click(rowFor(table, 'INV-2000'));
    expect(screen.getByText('2 of 3 invoices selected')).toBeTruthy();

    // The header checkbox is the first one in the DOM (thead before tbody).
    const headerCheckbox = () => screen.getAllByRole('checkbox')[0];

    // All visible (the search is empty) -> header checkbox selects them again.
    fireEvent.click(headerCheckbox());
    expect(screen.getByText('3 of 3 invoices selected')).toBeTruthy();

    // Narrow to one row, deselect it, then clear the filter: only that one
    // invoice stays out of the run.
    fireEvent.change(screen.getByLabelText('Search invoices in this batch'), {
      target: { value: 'Patient 2' },
    });
    fireEvent.click(headerCheckbox());
    fireEvent.change(screen.getByLabelText('Search invoices in this batch'), {
      target: { value: '' },
    });

    expect(screen.getByText('2 of 3 invoices selected')).toBeTruthy();
    expect((within(rowFor(table, 'INV-2002')).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('clear selection starts over from nothing', () => {
    renderBatch();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText('0 of 3 invoices selected')).toBeTruthy();
    expect(screen.getByText('Nothing selected to print.')).toBeTruthy();
  });

  it('starts with the paper preview collapsed but keeps the sheets printable', () => {
    const { container } = renderBatch();
    const preview = container.querySelector('#batch-print-preview') as HTMLElement;

    expect(preview.classList.contains('hidden')).toBe(true);
    // The print contract: sheets exist even while hidden on screen.
    expect(container.querySelectorAll('.print-doc-page').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /preview statement/i }));
    expect(preview.classList.contains('hidden')).toBe(false);
    expect(screen.getByRole('button', { name: /hide preview/i })).toBeTruthy();
  });
});
