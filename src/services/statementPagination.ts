import { Invoice, DentalCase } from '../types';
import type { InvoiceAccountPosition } from './invoiceAccount';
import {
  caseDetailInlineText,
  findCaseForInvoice,
  STATEMENT_DETAIL_OMIT,
} from './ledgerCaseDetail';

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

/** Usable sheet height per paper at 96dpi, after the page margins. */
const PAGE_MM: Record<string, number> = {
  a4: 297,
  letter: 279.4,
};

/** Page margins offered in Settings → Print & Documents. */
export const PRINT_MARGIN_MM: Record<string, number> = {
  narrow: 8,
  normal: 12,
  wide: 18,
};

const MM_TO_PX = 96 / 25.4;

/**
 * The chosen paper margin in CSS pixels.
 *
 * Exported because the preview has to reserve the SAME box the printer will
 * use. The preview used to render the table 51px wider than paper at the
 * normal margin, so rows wrapped less there than on paper and the row budget
 * below was measured against a document that never printed.
 */
export const pageMarginPx = (margin?: string): number =>
  Math.round((PRINT_MARGIN_MM[margin || 'normal'] ?? PRINT_MARGIN_MM.normal) * MM_TO_PX);

/** Height of the paper's printable area for the chosen paper + margin. */
const pageHeightPx = (paper?: string, margin?: string): number => {
  const height = PAGE_MM[paper || 'a4'] ?? PAGE_MM.a4;
  const edge = PRINT_MARGIN_MM[margin || 'normal'] ?? PRINT_MARGIN_MM.normal;
  return Math.round((height - edge * 2) * MM_TO_PX);
};

/** `.print-preview-page` padding as print.css overrides it (0.75rem/1rem). */
const PAGE_PADDING_PX = 24;

/**
 * Everything on a sheet that is not an invoice row: brand header, title, the
 * statement-for grid, the period line, the table head, the table's bottom
 * margin, the footer — the padding above is counted separately.
 *
 * MEASURED at the real PRINT geometry (671px content width at A4/12mm):
 * a full first sheet renders 1014px with 24px of padding and 689px of rows,
 * so its chrome is 301px. This constant carried 297 after adding the footer,
 * which left only 4px of slack on a continued sheet — enough for one wrapped
 * date to push the footer onto its own page. 310 keeps ~9px of headroom
 * without costing a row (see the sheet-count assertions in the tests).
 */
const SHEET_CHROME_PX = 310;

/** The extra "Period (continued)" line that sheets after the first carry. */
const CONTINUED_LINE_PX = 27;

/**
 * The totals block measured on the sheet: heading + margin + four lines
 * (Opening, Cases Amount, Paid, Closing).
 *
 * One line per optional fact is added by `balanceBlockPx`, so a statement with
 * neither an advance deposit nor a credit note does not pay for the worst case.
 * The old constant was 84 — the heading and margin alone — so any statement
 * carrying an advance deposit overran its own sheet and the browser pushed the
 * closing rows onto a fresh page.
 */
const BALANCE_BASE_PX = 173;

/** One optional line of the block (Advance Deposit, Credit Notes). */
const BALANCE_ROW_PX = 25;

/** The "settled from the advance deposit" note under the block. */
const BALANCE_NOTE_PX = 20;

/**
 * The bank transfer block on the closing sheet: heading + the up-to-three
 * bank lines + box padding + bottom margin + border, exactly as the invoice
 * block prints. Its lines come from the same branding record the invoice
 * prints; the block is charged only when it prints (closing sheet, section
 * enabled, bank name saved) — an unpriced block pushes closing rows onto a
 * fresh sheet the way the unpriced totals block once did.
 *
 * MEASURED on the rendered sheet at 100% zoom: 90px box with all four lines
 * (border, padding, 10px heading, name·title, A/C, IBAN) + its 16px bottom
 * margin = 106px. The charger counts the worst common shape; a statement
 * with fewer bank fields prints a shorter block and keeps the headroom.
 */
export const BANK_BLOCK_PX = 106;

/**
 * The totals block at its worst: every optional line present.
 *
 * Exported because the sheet budget has to have a default for callers that do
 * not know the account position, and a default has to be the safe end of the
 * range.
 */
export const BALANCE_BLOCK_PX =
  BALANCE_BASE_PX + BALANCE_ROW_PX * 2 + BALANCE_NOTE_PX;

/**
 * Rendered height of the totals block for a clinic's position.
 *
 * `null` means the sheet prints the fallback three-line summary instead of the
 * account block, which is measured smaller but is reserved generously: it is
 * the sheet that carries the closing figure, and a spilled total reads as a
 * statement that lost its balance.
 */
export const balanceBlockPx = (
  position?: InvoiceAccountPosition | null,
): number => {
  if (!position) return BALANCE_BASE_PX;
  let height = BALANCE_BASE_PX;
  if (position.advanceDeposit > 0) height += BALANCE_ROW_PX;
  if (position.creditNotes > 0) height += BALANCE_ROW_PX;
  if (position.advanceApplied > 0) height += BALANCE_NOTE_PX;
  return height;
};

/**
 * A row with no detail line and a single-line date: one text line + padding.
 *
 * MEASURED at the print content width with the statement's `py-0.5` cells:
 * 25.5px, rounded up. It was 21, which underpriced every bare row on a
 * statement whose Date column had to wrap.
 */
export const ROW_PX_BARE = 26;

/**
 * The detail line under the case number, per printed line of it.
 *
 * Measured at 12px (9px type, `leading-tight`) for each line the cell wraps
 * to. It was a flat 11px for the FIRST line only, with no allowance for the
 * second — and a long tooth list genuinely wraps.
 */
export const DETAIL_LINE_PX = 12;

/**
 * Characters that fit on one line of the Case cell.
 *
 * The statement table is now `table-layout: fixed` with the Case column at
 * 35% of the printable width: 236px at A4/12mm, less 18px of cell padding,
 * with the 9px detail type setting at ~3.96px per character — ~55 characters.
 * 54 is used so a line that wraps at the wide margin (626px table, ~50
 * characters) is still charged its second line. The old 96 was measured on a
 * 762px table that no printer ever produced, so long details printed a line
 * taller than the paginator had paid for.
 */
const DETAIL_CHARS_PER_LINE = 54;

/**
 * Ceiling on the detail allowance.
 *
 * A pathological tooth list that wraps past three lines is priced at three: the
 * row still prints every line, and the sheet keeps a known bound instead of a
 * single runaway row stealing the rest of the paper.
 */
const MAX_DETAIL_LINES = 3;

/** The zoom applied by `.print-fs-*`; a zoomed-out sheet fits more rows. */
const FONT_SCALE: Record<string, number> = {
  compact: 0.9,
  normal: 1,
  large: 1.08,
};

/**
 * Rendered height of one invoice row, in CSS pixels at 100% zoom.
 *
 * The cell's text comes from `caseDetailInlineText` with STATEMENT_DETAIL_OMIT —
 * the SAME two calls the statement renderer makes — so the paginator prices the
 * string that prints. They were silently divergent: the renderer suppressed
 * Shade, Received Date, Units and Delivery Date while this priced
 * INVOICE_DETAIL_OMIT, which suppresses Teeth instead of Units. The statement
 * prints a tooth list, so the paginator was pricing a shorter line than the one
 * that reached the paper — and a longer line wraps.
 */
export const rowHeightPx = (inv: Invoice, cases: DentalCase[]): number => {
  const linked = findCaseForInvoice(inv, cases);
  if (!linked) return ROW_PX_BARE;
  const text = caseDetailInlineText(linked, { omit: STATEMENT_DETAIL_OMIT });
  if (!text) return ROW_PX_BARE;
  const lines = Math.min(
    MAX_DETAIL_LINES,
    Math.max(1, Math.ceil(text.length / DETAIL_CHARS_PER_LINE)),
  );
  return ROW_PX_BARE + DETAIL_LINE_PX * lines;
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
  printSettings?: {
    paper?: 'a4' | 'letter';
    margin?: 'narrow' | 'normal' | 'wide';
    fontSize?: 'compact' | 'normal' | 'large';
  },
  opts?: {
    /** Sheets after the first restate the period: one extra line. */
    continued?: boolean;
    withBalance?: boolean;
    /** Exact height of the totals block, from `balanceBlockPx`. */
    balancePx?: number;
    /** The bank transfer block prints on this sheet too (closing page only). */
    withBank?: boolean;
  },
): number => {
  const height = pageHeightPx(printSettings?.paper, printSettings?.margin);
  let budget = height - PAGE_PADDING_PX - SHEET_CHROME_PX;
  if (opts?.continued) budget -= CONTINUED_LINE_PX;
  if (opts?.withBalance) budget -= opts.balancePx ?? BALANCE_BLOCK_PX;
  if (opts?.withBank) budget -= BANK_BLOCK_PX;
  return Math.floor(budget / fontScale(printSettings?.fontSize));
};

/** One printed sheet: its rows plus the 1-based sheet number. */
export interface StatementPage<T> {
  rows: T[];
  pageNumber: number;
}

/**
 * The fewest rows a final sheet may hold before rows are moved down to it.
 *
 * One row sitting above an otherwise empty sheet, with the totals block under
 * it, reads as a printing failure. Two is the smallest tail that looks
 * deliberate. Only ever costs the previous sheet one row of fill.
 */
const MIN_TAIL_ROWS = 2;

/**
 * Fill `pageCount` sheets to their own budgets, in order.
 *
 * This replaced an even split. Evenness was chosen so a run of 7 rows would not
 * print 6 on one sheet and 1 on the next — but it achieved that by capping every
 * sheet at `total / pages`, so a run that needed a second sheet for its totals
 * block alone printed two half-empty pages: the operator's report was "there is
 * so much space left and it still takes invoices to the next page". Paging now
 * behaves the way paper does: each sheet is filled to its budget, and only the
 * overflow continues.
 *
 * The one deliberate exception is the anti-orphan rule below: a final sheet
 * with a single row gives one row back, so the tail reads as a page rather than
 * as a stray line plus totals. A row taller than a whole sheet is given its own
 * page rather than looped on — the browser clips that one row instead of the
 * batch silently dropping an invoice.
 */
const fillSheets = <T>(
  rows: T[],
  weightOf: (row: T) => number,
  budgets: number[],
): StatementPage<T>[] => {
  const weights = rows.map((row) => Math.max(1, weightOf(row)));
  const pages: StatementPage<T>[] = [];
  let index = 0;

  for (let p = 0; p < budgets.length && index < rows.length; p++) {
    const budget = budgets[p];
    const pagesLeft = budgets.length - p - 1;
    const pageRows: T[] = [];
    let pageWeight = 0;

    while (index < rows.length && rows.length - index > pagesLeft) {
      const w = weights[index];
      if (pageRows.length > 0 && pageWeight + w > budget) break;
      pageRows.push(rows[index]);
      pageWeight += w;
      index += 1;
    }

    if (pageRows.length === 0 && index < rows.length) {
      // Oversized row: it gets the page to itself and clips on paper.
      pageRows.push(rows[index]);
      index += 1;
    }

    pages.push({ rows: pageRows, pageNumber: p + 1 });
  }

  // Anti-orphan: move rows down off the previous sheet while the final sheet is
  // still too thin, and only where they still fit its (smaller) budget.
  const last = pages[pages.length - 1];
  if (last && pages.length > 1) {
    let prev = pages[pages.length - 2];
    let lastWeight = last.rows.reduce((s, r) => s + weightOf(r), 0);
    const lastBudget = budgets[budgets.length - 1];
    while (
      last.rows.length < MIN_TAIL_ROWS &&
      prev.rows.length > 1 &&
      lastWeight + weightOf(prev.rows[prev.rows.length - 1]) <= lastBudget
    ) {
      const moved = prev.rows.pop()!;
      last.rows.unshift(moved);
      lastWeight += weightOf(moved);
    }
  }

  return pages;
};

/**
 * Split the batch's selected invoices into printable sheets, using the live
 * print settings so the sheet count matches the paper the operator chose.
 *
 * Sheet count is the smallest that fits the run: each candidate count is laid
 * out and accepted only when every row lands inside its sheet's pixel budget,
 * the final sheet included. Each sheet is filled to its own budget, so a run
 * that spills leaves the minimum paper behind rather than halving itself.
 */
export const paginateStatementInvoices = (
  invoices: Invoice[],
  cases: DentalCase[],
  printSettings?: {
    paper?: 'a4' | 'letter';
    margin?: 'narrow' | 'normal' | 'wide';
    fontSize?: 'compact' | 'normal' | 'large';
  },
  /**
   * The clinic's account position, when the caller has one. It only exists to
   * size the totals block exactly: the block grows a line for an advance
   * deposit and for credit notes, and reserving the worst case for every run
   * costs a statement with neither two rows of table on its last sheet.
   */
  accountPosition?: InvoiceAccountPosition | null,
  /**
   * The bank transfer block prints on the closing sheet (section on and bank
   * details saved). Charged only on that sheet, exactly like the totals
   * block, so the budget never pays for a block that does not print.
   */
  withBank = false,
): StatementPage<Invoice>[] => {
  if (invoices.length === 0) return [];
  const weightOf = (inv: Invoice) => rowHeightPx(inv, cases);
  const balancePx = balanceBlockPx(accountPosition);

  for (let pageCount = 1; pageCount <= invoices.length; pageCount++) {
    const budgets = Array.from({ length: pageCount }, (_, p) =>
      sheetBudgetPx(printSettings, {
        continued: p > 0,
        withBalance: p === pageCount - 1,
        balancePx,
        withBank: withBank && p === pageCount - 1,
      })
    );
    const pages = fillSheets(invoices, weightOf, budgets);
    const fits = pages.reduce((s, p) => s + p.rows.length, 0) === invoices.length &&
      pages.every((p, i) => p.rows.reduce((s, inv) => s + weightOf(inv), 0) <= budgets[i]);
    if (fits) return pages;
  }

  // Unreachable: one sheet per invoice always places every row. Kept so the
  // function returns something rather than undefined on a pathological run.
  return invoices.map((inv, i) => ({ rows: [inv], pageNumber: i + 1 }));
};