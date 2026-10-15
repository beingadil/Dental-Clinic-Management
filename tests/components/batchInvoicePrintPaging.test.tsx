// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import type { DentalCase, Invoice } from '../../src/types';



/* A batch of unpaid invoices used to print as ONE sheet, whatever its length.
   Past a dozen rows the table ran off the bottom of the paper and the browser
   sliced it mid-row, so the clinic got a statement with an orphaned line and
   no totals. These tests pin the shipped behaviour: the selection is split
   across as many sheets as it needs, every invoice appears exactly once, and
   the balance block lands on the final sheet only — otherwise adding up the
   printed pages double-counts the run. */

const { LAB, COUNT, TODAY } = vi.hoisted(() => {
  const now = new Date();
  // The modal opens on the Today period and filters the batch by issue_date, so
  // the fixture invoices have to be dated today. Hard-coding a date here made
  // this file pass for exactly one day and go red the next, with every sheet
  // empty because the period excluded all 40 rows.
  const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  return {
    // Enough for several sheets: each row carries a case detail block, so it
    // weighs 3 units against a 26-unit a4 budget.
    COUNT: 40,
    TODAY,
    LAB: { id: 'lab-1', name: 'Cases Clinic', doctor_name: 'Tariq Mahmood' },
  };
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

vi.mock('../../src/context/AppContext', () => {
  // One detail-carrying case per invoice: 3 detail lines each.
  const cases = Array.from({ length: COUNT }, (_, i) => ({
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
    received_date: '2026-10-01',
    delivery_date: '2026-11-01',
    status: 'received',
    history: [],
  }));
  const invoices = cases.map((c, i) => ({
    id: `inv-${i}`,
    invoice_number: `INV-${2000 + i}`,
    case_id: c.id,
    case_number: c.case_number,
    lab_id: 'lab-1',
    lab_name: 'Cases Clinic',
    case_type_name: 'Zirconia Crown',
    doctor_name: 'Tariq Mahmood',
    patient_name: c.patient_name,
    amount: 10000,
    discount: 0,
    final_amount: 10000,
    amount_paid: 0,
    payment_status: 'unpaid',
    issue_date: TODAY,
    due_date: '2026-11-10',
    created_at: TODAY,
    payments: [],
  }));return {
      useApp: () => ({
        labs: [LAB],
        invoices,
        cases,
      brandingSettings: {
        appName: 'DENTAL SOLUTIONS',
        tagline: '',
        phone: '',
        email: '',
        address: '',
      },
      saveVoucherToSystem: () => {},
    }),
  };
});

import { BatchInvoicePrintModal } from '../../src/components/billing/BatchInvoicePrintModal';
import { sheetBudgetPx, rowHeightPx } from '../../src/services/statementPagination';

afterEach(cleanup);

const renderModal = () => render(<BatchInvoicePrintModal onClose={() => {}} />);

/**
 * The same fixture the mocked context hands the modal, rebuilt here so the test
 * can measure a printed row. Kept in step by the shared COUNT below.
 */
const cases = () =>
  Array.from({ length: COUNT }, (_, i) => ({
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
    received_date: '2026-10-01',
    delivery_date: '2026-11-01',
    status: 'received',
    history: [],
  })) as unknown as DentalCase[];

const invoices = () =>
  cases().map((c, i) => ({
    id: `inv-${i}`,
    invoice_number: `INV-${2000 + i}`,
    case_id: c.id,
    case_number: c.case_number,
    lab_id: 'lab-1',
    final_amount: 10000,
    amount_paid: 0,
    payment_status: 'unpaid',
  })) as unknown as Invoice[];

const invoiceByNumber = new Map(invoices().map((inv) => [inv.invoice_number, inv]));

/*
 * Every cell of every printed row, in document order.
 *
 * Found by CONTENT, not by column index: the statement leads with Date, so
 * `td:first-child` is the date. Column order is a presentation choice the
 * operator makes, and a paging test that breaks when a column moves is
 * testing layout rather than paging.
 */
const rowCells = (root: ParentNode) =>
  Array.from(root.querySelectorAll('tbody tr')).map((tr) =>
    Array.from(tr.querySelectorAll('td')).map((c) => c.textContent!.trim()),
  );

/** The printed sheets, excluding the operator's on-screen selection table. */
const sheets = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.print-doc-page')) as HTMLElement[];

describe('BatchInvoicePrintModal sheet splitting', () => {
  it('spreads a long batch over sheets that each stay inside the paper budget', () => {
    const { container } = renderModal();
    const pages = sheets(container);

    expect(pages.length).toBeGreaterThan(1);

    // The invariant, not a magic count: every sheet's rows, plus the chrome
    // the sheet carries, must fit the printable height of the paper. The final
    // sheet also pays for the totals block. Padding a sheet past its budget is
    // exactly the bug this guards.
    const settings = { paper: 'a4' as const, fontSize: 'normal' as const };
    const allCases = cases();
    pages.forEach((p, i) => {
      const budget = sheetBudgetPx(settings, {
        continued: i > 0,
        withBalance: i === pages.length - 1,
      });
      const printed = rowCells(p).flat().filter((t) => /^INV-/.test(t));
      const height = printed.reduce(
        (sum, number) => sum + rowHeightPx(invoiceByNumber.get(number)!, allCases),
        0,
      );
      expect(height).toBeLessThanOrEqual(budget);
    });
  });

  it('prints every selected invoice exactly once, in order, across the sheets', () => {
    const { container } = renderModal();
    // Scoped to invoice-number cells: the balance block below the table is
    // laid out with `td`s too, and would otherwise be counted as rows.
    const printed = sheets(container).flatMap(rowCells).flat().filter((t) => /^INV-/.test(t));

    expect(printed).toEqual(Array.from({ length: COUNT }, (_, i) => `INV-${2000 + i}`));
  });

  it('keeps the balance block on the final sheet only', () => {
    const { container } = renderModal();
    const pages = sheets(container);
    const withTotals = pages.filter((p) => within(p as HTMLElement).queryByText('Total Billed'));

    expect(withTotals).toHaveLength(1);
    expect(withTotals[0]).toBe(pages[pages.length - 1]);
  });

  it('states the totals for the whole run, not just the last sheet', () => {
    const { container } = renderModal();
    const last = sheets(container).slice(-1)[0];

    // 40 invoices x PKR 10,000, none paid. The figure appears once per
    // "Total Billed" / "Outstanding" line, so both must agree.
    const totals = within(last as HTMLElement).getAllByText(/400,000/);
    expect(totals.length).toBe(2);
    expect(within(last as HTMLElement).getByText('Outstanding')).toBeTruthy();
  });

  it('numbers the sheets so a spilled batch stays auditable', () => {
    const { container } = renderModal();
    const pages = sheets(container);

    pages.forEach((p, i) => {
      expect(p.textContent).toContain(`Page ${i + 1} of ${pages.length}`);
    });
  });
});