import { Invoice, DentalCase } from '../types';
import { caseDetailLines, findCaseForInvoice } from './ledgerCaseDetail';

/**
 * Pagination for the batch account statement.
 *
 * The batch print used to emit ONE sheet listing every selected invoice. With
 * more than a handful of rows — or with a few rows that each carry the full
 * case detail block (patient, procedure, teeth, shade, received/delivery date)
 * — the table ran past the bottom of the paper and the browser sliced it
 * mid-row, so the clinic received a statement with an orphaned row and no
 * totals block.
 *
 * We cannot measure the sheet before it renders, but the sheet's geometry is
 * fixed and measurable from the stylesheet, so the budget is expressed in CSS
 * pixels at 96dpi and the constants below are measured against the rendered
 * document (see `tests/services/statementPagination.test.ts`, which pins them).
 * A pixel budget is used rather than "lines per page" because the two failure
 * modes are both dimensional: the detail block adds ~64px to a single row, and
 * the totals block costs ~84px on whichever sheet carries it.
 */

/** Usable sheet height per paper at 96dpi, after the 12mm print margin. */
const PAGE_HEIGHT_PX: Record<string, number> = {
  a4: 1032, // (297mm − 24mm) at 96dpi
  letter: 965, // (279.4mm − 24mm) at 96dpi
};

/** `.print-preview-page` padding as print.css overrides it (0.75rem/1rem). */
const PAGE_PADDING_PX = 28;

/**
 * Everything on a sheet that is not an invoice row: clinic header, title,
 * statement-for grid, period line, table head, table margin, footer — plus the
 * page padding. Measured against the rendered statement at full width.
 */
const SHEET_CHROME_PX = 370;

/** The extra "Period (continued)" line that sheets after the first carry. */
const CONTINUED_LINE_PX = 29;

/**
 * The totals block (Total Billed / Total Paid / Outstanding) and its margin.
 * It prints on the final sheet only, so that sheet holds less table.
 */
export const BALANCE_BLOCK_PX = 84;

/** A row with no detail block and a single-line date: one text line + padding. */
export const ROW_PX_BARE = 34;

/** One line of the detail block's two-column grid, plus its padding and border. */
const DETAIL_GRID_LINE_PX = 20;
const DETAIL_BLOCK_CHROME_PX = 10;

/** The zoom applied by `.print-fs-*`; a zoomed-out sheet fits more rows. */
const FONT_SCALE: Record<string, number> = {
  compact: 0.9,
  normal: 1,
  large: 1.08,
};

/**
 * Rendered height of one invoice row, in CSS pixels at 100% zoom.
 *
 * The detail block is a two-column grid, so `n` pairs cost ceil(n / 2) lines.
 */
export const rowHeightPx = (inv: Invoice, cases: DentalCase[]): number => {
  const linked = findCaseForInvoice(inv, cases);
  const pairs = linked ? caseDetailLines(linked).length : 0;
  if (pairs === 0) return ROW_PX_BARE;
  const gridLines = Math.ceil(pairs / 2);
  return ROW_PX_BARE + gridLines * DETAIL_GRID_LINE_PX + DETAIL_BLOCK_CHROME_PX;
};

/** Zoom factor for a font-scale setting. */
export const fontScale = (fontSize?: string): number => FONT_SCALE[fontSize || 'normal'] ?? 1;

/**
 * Row-height budget for one sheet, in pixels at 100% zoom.
 *
 * `continued` charges the extra period line, `withBalance` charges the totals
 * block. A continued sheet that also carries the totals pays both.
 */
export const sheetBudgetPx = (
  printSettings?: { paper?: 'a4' | 'letter'; fontSize?: 'compact' | 'normal' | 'large' },
  opts?: { continued?: boolean; withBalance?: boolean },
): number => {
  const paper = printSettings?.paper || 'a4';
  const height = PAGE_HEIGHT_PX[paper] ?? PAGE_HEIGHT_PX.a4;
  let budget = height - PAGE_PADDING_PX - SHEET_CHROME_PX;
  if (opts?.continued) budget -= CONTINUED_LINE_PX;
  if (opts?.withBalance) budget -= BALANCE_BLOCK_PX;
  return Math.floor(budget / fontScale(printSettings?.fontSize));
};

/** One printed sheet: its rows plus the 1-based sheet number. */
export interface StatementPage<T> {
  rows: T[];
  pageNumber: number;
}

/**
 * Greedily fill `pageCount` sheets as evenly as the budgets allow.
 *
 * Evenness matters on paper: a run of 7 rows split 6/1 wastes a sheet's worth
 * of paper and reads badly. Each page takes rows while it is under its share
 * of the run and within its pixel budget, and always keeps at least one row
 * back for each page still to come. A row taller than a whole sheet is given
 * its own page rather than looped on — the browser clips that one row instead
 * of the batch silently dropping an invoice.
 */
const splitEvenly = <T>(
  rows: T[],
  weightOf: (row: T) => number,
  budgets: number[],
): StatementPage<T>[] => {
  const weights = rows.map((row) => Math.max(1, weightOf(row)));
  const total = weights.reduce((s, w) => s + w, 0);
  const pages: StatementPage<T>[] = [];
  let index = 0;
  let used = 0;

  for (let p = 0; p < budgets.length && index < rows.length; p++) {
    const budget = budgets[p];
    const pagesLeft = budgets.length - p - 1;
    const share = Math.ceil((total - used) / (pagesLeft + 1));
    const pageRows: T[] = [];
    let pageWeight = 0;

    while (index < rows.length && rows.length - index > pagesLeft) {
      const w = weights[index];
      // Leave room for the remaining pages. With none left there is nothing to
      // reserve, so the only limit on this sheet is its own budget.
      const wouldLeaveEnough =
        pagesLeft === 0 || total - used - pageWeight - w <= pagesLeft * budget;
      if (pageRows.length > 0 && (pageWeight + w > budget || !wouldLeaveEnough)) break;
      if (pageRows.length === 0 && pageWeight + w > budget && pagesLeft === 0) break;
      pageRows.push(rows[index]);
      pageWeight += w;
      index += 1;
      if (pageWeight >= share && pageRows.length > 0) break;
    }

    if (pageRows.length === 0 && index < rows.length) {
      // Oversized row: it gets the page to itself and clips on paper.
      pageRows.push(rows[index]);
      index += 1;
    }
    used += pageWeight;
    pages.push({ rows: pageRows, pageNumber: p + 1 });
  }

  return pages;
};

/**
 * Split the batch's selected invoices into printable sheets, using the live
 * print settings so the sheet count matches the paper the operator chose.
 *
 * Sheet count is the smallest that fits the run: each candidate count is laid
 * out and accepted only when every row lands inside its sheet's pixel budget,
 * the final sheet included. Rows are spread evenly across the sheets so a run
 * that needs two pages does not print seven rows on one and one on the other.
 */
export const paginateStatementInvoices = (
  invoices: Invoice[],
  cases: DentalCase[],
  printSettings?: { paper?: 'a4' | 'letter'; fontSize?: 'compact' | 'normal' | 'large' },
): StatementPage<Invoice>[] => {
  if (invoices.length === 0) return [];
  const weightOf = (inv: Invoice) => rowHeightPx(inv, cases);

  for (let pageCount = 1; pageCount <= invoices.length; pageCount++) {
    const budgets = Array.from({ length: pageCount }, (_, p) =>
      sheetBudgetPx(printSettings, {
        continued: p > 0,
        withBalance: p === pageCount - 1,
      })
    );
    const pages = splitEvenly(invoices, weightOf, budgets);
    const fits = pages.reduce((s, p) => s + p.rows.length, 0) === invoices.length &&
      pages.every((p, i) => p.rows.reduce((s, inv) => s + weightOf(inv), 0) <= budgets[i]);
    if (fits) return pages;
  }

  // Unreachable: one sheet per invoice always places every row. Kept so the
  // function returns something rather than undefined on a pathological run.
  return invoices.map((inv, i) => ({ rows: [inv], pageNumber: i + 1 }));
};