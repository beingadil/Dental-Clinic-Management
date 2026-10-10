import { describe, it, expect } from 'vitest';
import {
  paginateStatementInvoices,
  sheetBudgetPx,
  rowHeightPx,
  fontScale,
  ROW_PX_BARE,
  BALANCE_BLOCK_PX,
} from '../../src/services/statementPagination';
import type { Invoice, DentalCase } from '../../src/types';

const invoice = (id: string, over: Partial<Invoice> = {}): Invoice =>
  ({
    id,
    invoice_number: `INV-${id}`,
    final_amount: 1000,
    amount_paid: 0,
    payment_status: 'unpaid',
    ...over,
  }) as Invoice;

/**
 * A case whose detail block renders the full six-pair grid.
 *
 * The field is `selected_teeth`, the ARRAY the formatter reads. This fixture
 * used to carry a `teeth` STRING that no reader looks at, which made the
 * "detail-heavy" row only as tall as a case with no charting at all — and
 * charting becomes meaningful the moment `caseDetailLines` shortens the
 * uncharted case to two rows. Chart it for real so this row stays the tall one
 * the paging assertions below are about.
 */
const detailedCase = (id: string): DentalCase =>
  ({
    id,
    case_number: `C-${id}`,
    patient_name: 'Jane Doe',
    case_type_name: 'Zirconia Bridge',
    shade: 'A2',
    selected_teeth: [21, 11],
    received_date: 'Oct 5, 2026',
    delivery_date: 'Oct 15, 2026',
  }) as unknown as DentalCase;

/** A case with no detail lines at all. */
const bareCase = (id: string): DentalCase =>
  ({ id, case_number: `C-${id}`, patient_name: '', case_type_name: '', shade: '' }) as unknown as DentalCase;

describe('rowHeightPx', () => {
  it('gives a row with no linked case the bare height', () => {
    expect(rowHeightPx(invoice('a'), [])).toBe(ROW_PX_BARE);
  });

  it('falls back to the bare height when the linked case has no detail lines', () => {
    expect(rowHeightPx(invoice('a', { case_id: 'c1' }), [bareCase('c1')])).toBe(ROW_PX_BARE);
  });

  it('adds grid lines for a case that carries detail', () => {
    const bare = rowHeightPx(invoice('a'), []);
    const tall = rowHeightPx(invoice('a', { case_id: 'c1' }), [detailedCase('c1')]);
    expect(tall).toBeGreaterThan(bare);
  });
});

describe('sheetBudgetPx', () => {
  it('gives letter less room than a4', () => {
    expect(sheetBudgetPx({ paper: 'letter' })).toBeLessThan(sheetBudgetPx({ paper: 'a4' }));
  });

  it('lets compact text fit more and large text less', () => {
    expect(sheetBudgetPx({ fontSize: 'compact' })).toBeGreaterThan(sheetBudgetPx({ fontSize: 'normal' }));
    expect(sheetBudgetPx({ fontSize: 'large' })).toBeLessThan(sheetBudgetPx({ fontSize: 'normal' }));
  });

  it('charges the continued line and the balance block on the final sheet', () => {
    const plain = sheetBudgetPx({ paper: 'a4' }, {});
    const continued = sheetBudgetPx({ paper: 'a4' }, { continued: true });
    const final = sheetBudgetPx({ paper: 'a4' }, { continued: true, withBalance: true });
    expect(plain - continued).toBeGreaterThan(0);
    expect(continued - final).toBe(BALANCE_BLOCK_PX);
  });

  it('defaults unknown paper and font to a4/normal', () => {
    expect(sheetBudgetPx(undefined, {})).toBe(sheetBudgetPx({ paper: 'a4', fontSize: 'normal' }, {}));
    expect(fontScale(undefined)).toBe(1);
  });
});

describe('paginateStatementInvoices', () => {
  const fits = (pages: ReturnType<typeof paginateStatementInvoices>, settings: Parameters<typeof sheetBudgetPx>[0]) =>
    pages.every((page, i) => {
      const budget = sheetBudgetPx(settings, {
        continued: i > 0,
        withBalance: i === pages.length - 1,
      });
      const height = page.rows.reduce((s, inv) => s + rowHeightPx(inv, []), 0);
      return height <= budget;
    });

  it('keeps every invoice in the run', () => {
    const invoices = Array.from({ length: 30 }, (_, i) => invoice(String(i)));
    const pages = paginateStatementInvoices(invoices, [], { paper: 'a4', fontSize: 'normal' });
    expect(pages.flatMap((p) => p.rows).map((i) => i.id)).toEqual(invoices.map((i) => i.id));
  });

  it('splits a detail-heavy batch into more sheets than a bare one', () => {
    const cases = [detailedCase('c1')];
    const invoices = Array.from({ length: 20 }, (_, i) => invoice(String(i), { case_id: 'c1' }));
    const detailed = paginateStatementInvoices(invoices, cases, { paper: 'a4', fontSize: 'normal' });
    const bare = paginateStatementInvoices(invoices, [], { paper: 'a4', fontSize: 'normal' });
    expect(detailed.length).toBeGreaterThan(bare.length);
  });

  it('respects the letter budget', () => {
    const invoices = Array.from({ length: 26 }, (_, i) => invoice(String(i)));
    const a4 = paginateStatementInvoices(invoices, [], { paper: 'a4', fontSize: 'normal' });
    const letter = paginateStatementInvoices(invoices, [], { paper: 'letter', fontSize: 'normal' });
    expect(letter.length).toBeGreaterThanOrEqual(a4.length);
  });

  it('numbers the sheets consecutively', () => {
    const invoices = Array.from({ length: 40 }, (_, i) => invoice(String(i)));
    const pages = paginateStatementInvoices(invoices, [], { paper: 'a4', fontSize: 'normal' });
    expect(pages.map((p) => p.pageNumber)).toEqual(pages.map((_, i) => i + 1));
  });

  it('never lets a sheet exceed its pixel budget, totals sheet included', () => {
    // The regression: 8 detail-heavy rows fit the table budget but not the
    // budget left on the sheet that also carries the balance block. That
    // sheet used to render past the bottom of the paper.
    const cases = [detailedCase('c1')];
    const invoices = Array.from({ length: 8 }, (_, i) => invoice(String(i), { case_id: 'c1' }));
    const settings = { paper: 'a4' as const, fontSize: 'normal' as const };
    const pages = paginateStatementInvoices(invoices, cases, settings);

    expect(fits(pages, settings)).toBe(true);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap((p) => p.rows).map((i) => i.id)).toEqual(invoices.map((i) => i.id));
  });

  it('keeps every sheet inside budget for a long detail-heavy run', () => {
    const cases = [detailedCase('c1')];
    const invoices = Array.from({ length: 40 }, (_, i) => invoice(String(i), { case_id: 'c1' }));
    const settings = { paper: 'a4' as const, fontSize: 'normal' as const };
    const pages = paginateStatementInvoices(invoices, cases, settings);

    expect(fits(pages, settings)).toBe(true);
    expect(pages.flatMap((p) => p.rows).map((i) => i.id)).toEqual(invoices.map((i) => i.id));
  });

  it('spreads rows evenly instead of filling the first sheet and orphaning the rest', () => {
    const cases = [detailedCase('c1')];
    const invoices = Array.from({ length: 14 }, (_, i) => invoice(String(i), { case_id: 'c1' }));
    const pages = paginateStatementInvoices(invoices, cases, { paper: 'a4', fontSize: 'normal' });

    expect(pages.length).toBeGreaterThan(1);
    const counts = pages.map((p) => p.rows.length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('does not add a sheet just to make room for the totals', () => {
    const settings = { paper: 'a4' as const, fontSize: 'normal' as const };
    // As many bare rows as the totals sheet can hold, and no more.
    const rowsOnTotalsSheet = Math.floor(
      sheetBudgetPx(settings, { withBalance: true }) / ROW_PX_BARE,
    );
    const invoices = Array.from({ length: rowsOnTotalsSheet }, (_, i) => invoice(String(i)));
    // A single sheet of bare rows plus the totals still fits one page.
    expect(paginateStatementInvoices(invoices, [], settings)).toHaveLength(1);
    // One more row does need a second sheet.
    expect(
      paginateStatementInvoices([...invoices, invoice('extra')], [], settings),
    ).toHaveLength(2);
  });

  it('gives an oversized row its own page instead of dropping it', () => {
    const invoices = [invoice('a'), invoice('big', { case_id: 'c1' }), invoice('b')];
    const cases = [detailedCase('c1')];
    const pages = paginateStatementInvoices(invoices, cases, { paper: 'a4', fontSize: 'normal' });
    expect(pages.flatMap((p) => p.rows).map((i) => i.id)).toEqual(['a', 'big', 'b']);
  });

  it('returns no pages for an empty selection', () => {
    expect(paginateStatementInvoices([], [], { paper: 'a4' })).toEqual([]);
  });
});