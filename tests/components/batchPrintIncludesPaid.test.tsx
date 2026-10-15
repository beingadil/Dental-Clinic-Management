// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';

/* Two behaviours the operator asked for explicitly.

   1. A FULLY PAID invoice must show. The batch used to filter on `due > 0`,
      so the settled invoices — the ones proving the clinic paid — were exactly
      the ones a month-end statement could not show. It now prints everything in
      the chosen date range, paid ones included.

   2. A second page appears ONLY when the rows overflow the first. A fortnightly
      run that fits must not be padded onto a second sheet, because a clinic
      reading "Page 1 of 2" for seven invoices reads it as a billing problem. */

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

/* A small store: one invoice in each settlement state, so the filter change is
   observable. Sized to fit a single sheet on purpose — requirement 2 needs a
   run that does NOT overflow. */
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

/** Load the store with one invoice per settlement state, then open the modal. */
const renderMixed = (invoices = [mkInvoice(0, 0), mkInvoice(1, 4000), mkInvoice(2, 10000)]) => {
  store.invoices = invoices;
  store.cases = invoices.map((inv) => mkCase(Number(inv.id.split('-')[1])));
  return render(<BatchInvoicePrintModal onClose={() => {}} />);
};

/** Printed sheets only — the on-screen selection table is not one. */
const sheets = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.print-doc-page')) as HTMLElement[];

/*
 * Every cell of every printed row, in document order.
 *
 * Found by CONTENT, not by column index. The statement leads with Date, so
 * `td:first-child` is the date — a position-based lookup returned nothing
 * and the paging assertions went red for a reason unrelated to paging.
 * Column order is a presentation choice the operator makes ("put Date before
 * Invoice" was one); a test that breaks when a column moves is testing
 * layout, not behaviour.
 */
const rowCells = (root: ParentNode) =>
  Array.from(root.querySelectorAll('tbody tr')).map((tr) =>
    Array.from(tr.querySelectorAll('td')).map((c) => c.textContent!.trim()),
  );

/** Invoice numbers actually printed, across every sheet, in order. */
const printedNumbers = (container: HTMLElement) =>
  sheets(container).flatMap(rowCells).flat().filter((t) => /^INV-/.test(t));

describe('Batch print includes every settlement state', () => {
  it('lists a fully paid invoice alongside the unpaid one', () => {
    const { container } = renderMixed();

    // INV-2002 is settled. Under the old `due > 0` filter it never appeared.
    expect(printedNumbers(container)).toContain('INV-2002');
  });

  it('lists a partly paid invoice', () => {
    const { container } = renderMixed();
    expect(printedNumbers(container)).toContain('INV-2001');
  });

  it('offers all three for selection on screen, not just the unpaid ones', () => {
    const { container } = renderMixed();
    // Scoped to the on-screen picker, which is the FIRST table on the page.
    // The printed preview repeats every invoice number, so an unscoped
    // query matches twice and the failure reads as a bug in the modal.
    const picker = container.querySelector('table') as HTMLElement;
    for (const number of ['INV-2000', 'INV-2001', 'INV-2002']) {
      expect(within(picker).getByText(number)).toBeTruthy();
    }
  });

  it('labels each row from its balance, not from the stored payment_status', () => {
    const { container } = renderMixed();
    const page = sheets(container)[0];

    // Status is derived so a credit-noted invoice cannot print "Paid" beside a
    // non-zero Balance. Full / Partial / Unpaid, and no raw lowercase status.
    expect(within(page).getByText('Full')).toBeTruthy();
    expect(within(page).getByText('Partial')).toBeTruthy();
    expect(within(page).getByText('Unpaid')).toBeTruthy();
  });

  it('ignores a stored payment_status that disagrees with the money, in both directions', () => {
    // The label is derived from the balance, never read off `payment_status`.
    // Both stored values here are wrong on purpose, which is the only way to
    // see the derivation at work:
    //   settled  — paid in full but stored "unpaid"
    //   partly   — some money in but stored "paid"
    const settled = { ...mkInvoice(3, 10000), payment_status: 'unpaid' };
    const partly = { ...mkInvoice(4, 4000), payment_status: 'paid' };
    const { container } = renderMixed([settled, partly]);
    const page = sheets(container)[0];

    expect(within(page).getByText('Full')).toBeTruthy();
    expect(within(page).getByText('Partial')).toBeTruthy();
    // And the raw lowercase stored words are nowhere on the sheet.
    expect(page.textContent).not.toContain('unpaid');
  });

  it(
    'subtracts a credit note from the balance it labels',
  () => {
    // 10,000 billed, 4,000 received, 4,000 credited => 2,000 outstanding.
    // Balance and Status come off that one number, so the row reads 2,000 /
    // Partial. If the label were derived from `amount_paid` alone it would say
    // "Full" over a non-zero balance and the sheet would contradict itself.
    const credited = { ...mkInvoice(5, 4000), credit_notes_total: 4000 };
    const { container } = renderMixed([credited]);
    const page = sheets(container)[0];

    // Scoped to the row's own cells. The balance summary under the table prints
    // the same figure — one invoice means one outstanding total — so a page-wide
    // query matches twice and fails as "multiple elements", which says nothing
    // about whether the ROW is right.
    const row = page.querySelector('tbody tr') as HTMLElement;
    expect(within(row).getByText('PKR 2,000')).toBeTruthy();
    expect(within(row).getByText('Partial')).toBeTruthy();
  });
});

describe('A second page appears only when the rows overflow', () => {
  it('prints a short run on a single sheet', () => {
    const { container } = renderMixed();
    expect(sheets(container)).toHaveLength(1);
  });

  it('stamps no page marker at all on a run that fits', () => {
    // The marker is gated on `pageCount > 1` precisely so a document that fits
    // on one sheet is not stamped as if it had been split. A clinic reading
    // "Page 1 of 2" over seven invoices reads that as a billing problem, which
    // is the whole reason the sheet budget was corrected in the first place.
    const { container } = renderMixed();

    expect(container.textContent).not.toMatch(/Page \d+ of \d+/);
  });

  it('prints every row of that single run — none dropped to make it fit', () => {
    const { container } = renderMixed();
    expect(printedNumbers(container)).toEqual(['INV-2000', 'INV-2001', 'INV-2002']);
  });

  it('adds a sheet once the rows genuinely overflow', () => {
    const many = Array.from({ length: 40 }, (_, i) => mkInvoice(i, i % 3 === 0 ? 10000 : 0));
    const { container } = renderMixed(many);

    expect(sheets(container).length).toBeGreaterThan(1);
    // Overflow must move rows, never drop them.
    expect(printedNumbers(container)).toEqual(many.map((inv) => inv.invoice_number));
    // And the sheets number themselves, so a spilled run stays auditable.
    expect(container.textContent).toMatch(/Page \d+ of \d+/);
  });
});
