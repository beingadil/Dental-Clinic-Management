import { describe, it, expect } from 'vitest';
import {
  paginateStatementInvoices,
  sheetBudgetPx,
  rowHeightPx,
  fontScale,
  ROW_PX_BARE,
  DETAIL_LINE_PX,
  BALANCE_BLOCK_PX,
  balanceBlockPx,
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
 * A case whose detail block renders every row `caseDetailLines` can emit.
 *
 * The field is `selected_teeth`, the ARRAY the formatter reads. This fixture
 * used to carry a `teeth` STRING that no reader looks at, which made the
 * "detail-heavy" row only as tall as a case with no charting at all — and
 * charting becomes meaningful the moment `caseDetailLines` shortens the
 * uncharted case to a single row. Chart it for real so this row stays the
 * tall one the paging assertions below are about.
 *
 * Seven rows now, not six: the compact-invoice change added `Units`, and this
 * case charts two teeth, so it is the tallest row the paginator can see.
 * `rowHeightPx` still prices a row as a two-column grid, so seven rows cost
 * ceil(7 / 2) = 4 grid lines.
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

/**
 * The emptiest case the store can hold: no patient, no product, no shade, no
 * charting and no dates.
 *
 * It is NOT a zero-detail case any more. `Units` is emitted whenever
 * `billableUnits` > 0, and that helper floors at 1 for uncharted work, so a
 * linked case always has at least the one row to print.
 */
const bareCase = (id: string): DentalCase =>
  ({ id, case_number: `C-${id}`, patient_name: '', case_type_name: '', shade: '' }) as unknown as DentalCase;

describe('rowHeightPx', () => {
  it('gives a row with no linked case the bare height', () => {
    expect(rowHeightPx(invoice('a'), [])).toBe(ROW_PX_BARE);
  });

  it('charges a case with nothing to print under the number as a bare row', () => {
    // `bareCase` has no patient, no procedure and no charting, so the cell
    // prints its case number and nothing else. The statement's omit list drops
    // `Units` (it is a column), which is what made the old expectation of a
    // detail line wrong for THIS document — an empty cell costs no detail line.
    expect(rowHeightPx(invoice('a', { case_id: 'c1' }), [bareCase('c1')])).toBe(ROW_PX_BARE);
  });

  it('charges a linked case one detail line for its first line of text', () => {
    // Written relative to the constants so the measured heights stay visible.
    expect(rowHeightPx(invoice('a', { case_id: 'c1' }), [detailedCase('c1')])).toBe(
      ROW_PX_BARE + DETAIL_LINE_PX,
    );
  });

  it('prices a fact-heavy case the same as a one-fact case', () => {
    // The regression this guarded: the old grid model charged ceil(n / 2)
    // lines, so a case with more facts cost more height and pushed a run onto
    // extra pages even though the printed cell was the same single line. What
    // may change the price now is the LENGTH of that line (it wraps), never the
    // number of facts on it.
    const oneFact = { id: 'c1', case_number: 'C-1', patient_name: 'Jane Doe' } as unknown as DentalCase;
    const tall = rowHeightPx(invoice('a', { case_id: 'c1' }), [detailedCase('c1')]);
    expect(tall).toBe(rowHeightPx(invoice('a', { case_id: 'c1' }), [oneFact]));
    // And still more than an invoice with no resolvable case at all.
    expect(tall).toBeGreaterThan(rowHeightPx(invoice('a'), []));
  });

  it('charges an extra line for a detail long enough to wrap', () => {
    // A full-arch tooth list does not fit the Case cell on one line, and the
    // old model had no allowance for the second — which is how a sheet that
    // "fits" ended up printing past the bottom of the paper.
    const fullArch = {
      id: 'c1',
      case_number: 'C-1',
      patient_name: 'Muhammad Abdul Rehman Khan',
      case_type_name: 'Full Arch Zirconia Rehabilitation',
      selected_teeth: [11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27],
    } as unknown as DentalCase;
    const oneLine = rowHeightPx(invoice('a', { case_id: 'c1' }), [detailedCase('c1')]);
    const wrapped = rowHeightPx(invoice('a', { case_id: 'c1' }), [fullArch]);
    expect(wrapped).toBeGreaterThan(oneLine);
    expect(wrapped).toBe(ROW_PX_BARE + DETAIL_LINE_PX * 2);
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
  const fits = (
    pages: ReturnType<typeof paginateStatementInvoices>,
    settings: Parameters<typeof sheetBudgetPx>[0],
    // The cases the pages were built against. Pricing the check from `[]`
    // measured every row as a bare one, so a run of detail rows was asserted
    // against a budget it had actually been split to fit, not the one it
    // prints into.
    cases: DentalCase[] = [],
  ) =>
    pages.every((page, i) => {
      const budget = sheetBudgetPx(settings, {
        continued: i > 0,
        withBalance: i === pages.length - 1,
      });
      const height = page.rows.reduce((s, inv) => s + rowHeightPx(inv, cases), 0);
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

    expect(fits(pages, settings, cases)).toBe(true);
    // CHANGED (compact invoice): eight detail-heavy rows are 33px each now,
    // where the old grid model priced them at 124px and split them over two
    // sheets. They fit one. The invariant this guards — every row lands inside
    // its own sheet's budget — is unchanged and still asserted by `fits`; the
    // multi-page path is covered by the longer runs below, which genuinely
    // exceed one sheet. Losing the `> 1` assertion here is the point of the
    // change, not a weakening: eight rows on one sheet is the desired result.
    expect(pages.flatMap((p) => p.rows).map((i) => i.id)).toEqual(invoices.map((i) => i.id));
  });

  it('keeps every sheet inside budget for a long detail-heavy run', () => {
    const cases = [detailedCase('c1')];
    const invoices = Array.from({ length: 40 }, (_, i) => invoice(String(i), { case_id: 'c1' }));
    const settings = { paper: 'a4' as const, fontSize: 'normal' as const };
    const pages = paginateStatementInvoices(invoices, cases, settings);

    expect(fits(pages, settings, cases)).toBe(true);
    expect(pages.flatMap((p) => p.rows).map((i) => i.id)).toEqual(invoices.map((i) => i.id));
  });

  it('fills each sheet to its budget before spilling onto the next', () => {
    // The operator's report: "there is so much space left and it still takes
    // invoices to the next page". Pages used to be split evenly, so a run that
    // needed a second sheet for its totals alone printed two half-empty pages.
    const cases = [detailedCase('c1')];
    const invoices = Array.from({ length: 24 }, (_, i) => invoice(String(i), { case_id: 'c1' }));
    const settings = { paper: 'a4' as const, fontSize: 'normal' as const };
    const pages = paginateStatementInvoices(invoices, cases, settings);

    expect(pages.length).toBeGreaterThan(1);
    const first = pages[0].rows.reduce((s, inv) => s + rowHeightPx(inv, cases), 0);
    const firstBudget = sheetBudgetPx(settings, {
      withBalance: pages.length === 1,
      balancePx: balanceBlockPx(null),
    });
    // Not "within a row of full": the first sheet is at least 90% spent.
    expect(first).toBeGreaterThan(firstBudget * 0.9);
  });

  it('does not leave a single row alone on the last sheet', () => {
    // 23 detail rows fill one sheet 22 deep; the 23rd would print above the
    // totals on an otherwise empty page, so one row is moved down with it.
    const cases = [detailedCase('c1')];
    const invoices = Array.from({ length: 23 }, (_, i) => invoice(String(i), { case_id: 'c1' }));
    const pages = paginateStatementInvoices(invoices, cases, { paper: 'a4', fontSize: 'normal' });

    expect(pages.length).toBe(2);
    expect(pages[1].rows.length).toBeGreaterThanOrEqual(2);
    expect(pages.flatMap((p) => p.rows).map((i) => i.id)).toEqual(invoices.map((i) => i.id));
  });

  it('does not add a sheet just to make room for the totals', () => {
    const settings = { paper: 'a4' as const, fontSize: 'normal' as const };
    // As many bare rows as the totals sheet can hold, and no more. The block is
    // priced for the position the paginator is given, which is none here.
    const rowsOnTotalsSheet = Math.floor(
      sheetBudgetPx(settings, { withBalance: true, balancePx: balanceBlockPx(null) }) / ROW_PX_BARE,
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