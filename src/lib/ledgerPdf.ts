/**
 * Dedicated professional General Ledger PDF.
 *
 * A separate document, NOT a printed screenshot of the React table. Input is
 * the SAME normalized `LedgerReportRow[]` + summary used by the preview, so
 * the two can never disagree on transactions, vouchers, balances or narration.
 *
 * Layout contract:
 *   - A4 PORTRAIT, fixed width; 10mm margins; 190mm usable table width.
 *   - Fixed explicit column widths (mm→pt): Date 20, Voucher/Case 30,
 *     Description 71, Debit 22, Credit 22, Balance 25.
 *   - Repeated table header on EVERY page; compact header on continuation
 *     pages; footer and correct page numbering on every page.
 *   - Every cell wraps within its own column. A long voucher, case number,
 *     narration or tooth list is never clipped and never widens the table.
 *   - Rows never split across pages. The table frame ends at the last row,
 *     rather than drawing an empty full-height grid.
 *   - NO page subtotals. Grand total exactly once, immediately after the last
 *     transaction; account summary kept with it and moved as one block.
 */
import { assemblePdf, GEOS, wrapText } from './pdf';
import type { PdfOp, PdfBuildResult } from './pdf';
import type { LedgerReportRow, LedgerReportSummary } from '../services/ledgerReport';

const MM = 72 / 25.4;
const mm = (v: number) => v * MM;

const NAVY = { rgb: [0.106, 0.188, 0.275] as [number, number, number] };
const HAIRLINE = { grey: 0.55 };

/* Fixed column layout, mm; sum = 273. */
const COLS = [
  { key: 'date', label: 'DATE', w: 20 },
  { key: 'ref', label: 'VOUCHER / CASE', w: 30 },
  { key: 'narr', label: 'DESCRIPTION', w: 71 },
  { key: 'debit', label: 'DEBIT', w: 22, right: true },
  { key: 'credit', label: 'CREDIT', w: 22, right: true },
  { key: 'balance', label: 'BALANCE', w: 25, right: true },
] as const;

const pk = (n: number) => (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pkr = (n: number) => `PKR ${pk(n)}`;

export interface LedgerPdfMeta {
  labName: string;
  clinicLabel: string;
  periodLabel: string;
  accountName?: string;
  accountCode?: string;
  caseFilterLabel?: string;
  generatedOn: string;
}

const textW = (s: string, size: number): number => {
  let w = 0;
  for (const ch of s) {
    if (ch === ' ') w += 0.278;
    else if (ch === '.' || ch === ',' || ch === ':' || ch === ';') w += 0.278;
    else if (ch === '-' || ch === '–' || ch === '—') w += 0.333;
    else w += 0.556;
  }
  return w * size;
};

/** Reduce a single-line value until it fits; never truncate it. */
const fitSize = (text: string, maxW: number, preferred: number, minimum = 4.8): number => {
  if (textW(text, preferred) <= maxW) return preferred;
  for (let size = preferred; size >= minimum; size -= 0.2) {
    if (textW(text, size) <= maxW) return size;
  }
  return minimum;
};

const PAGE = GEOS['a4-portrait'];
const MARGIN = mm(10);
const CONTENT_W = mm(190);
const W = PAGE.W;
const H = PAGE.H;
const RIGHT = W - MARGIN;

const ROW_LINE_H = 9;
const ROW_PAD_Y = 3.5;
const ROW_MIN_H = 13.5;
const HEADER_H = 16;
const FOOTER_Y = mm(12);
const CONTENT_BOTTOM = FOOTER_Y + 14;
const FIRST_TABLE_TOP = H - mm(48);
const CONT_TABLE_TOP = H - mm(26);

const SIZE = 7.2;
const DATE_SIZE = 6.8;
const REF_SIZE = 6.6;
const HEAD_SIZE = 7;
const NAVY_TITLE = 14;

const xs = (() => {
  const out: Record<string, { x: number; w: number; right?: boolean }> = {};
  let acc = MARGIN;
  for (const c of COLS) {
    out[c.key] = { x: acc, w: mm(c.w), right: 'right' in c ? c.right : false };
    acc += mm(c.w);
  }
  return out;
})();

const rightAligned = (key: string, text: string, size: number) =>
  xs[key].x + xs[key].w - textW(text, size) - mm(1.5);

const drawLetterhead = (ops: PdfOp[], meta: LedgerPdfMeta, generatedOn: string) => {
  ops.push({ kind: 'rect', x: MARGIN, y: H - mm(10), w: CONTENT_W, h: 1.6, grey: 0.12, ...NAVY });
  ops.push({ kind: 'text', x: MARGIN, y: H - mm(18), size: 9, bold: true, grey: 0.2, ...NAVY, text: meta.labName.slice(0, 60) });
  ops.push({ kind: 'text', x: MARGIN, y: H - mm(28), size: NAVY_TITLE, bold: true, grey: 0.06, ...NAVY, text: 'GENERAL LEDGER' });
  ops.push({
    kind: 'text',
    x: MARGIN,
    y: H - mm(33.5),
    size: 6.5,
    grey: 0.45,
    text: meta.accountName
      ? `Account statement and transaction details · ${meta.accountCode ? `${meta.accountCode} · ` : ''}${meta.accountName}`
      : 'Account statement and transaction details',
  });

  const boxW = mm(95);
  const boxX = RIGHT - boxW;
  const lines: [string, string][] = [
    ['STATEMENT FOR', meta.clinicLabel],
    ['ACCOUNT', meta.accountName || 'Accounts Receivable'],
    ['REPORT PERIOD', meta.periodLabel + (meta.caseFilterLabel ? ` · filtered: ${meta.caseFilterLabel}` : '')],
    ['CURRENCY', 'PKR'],
    ['GENERATED', generatedOn],
  ];
  const rowH = 11;
  const boxTop = H - mm(10);
  ops.push({ kind: 'rectStroke', x: boxX, y: boxTop - lines.length * rowH - 3, w: boxW, h: lines.length * rowH + 3, width: 0.6, ...HAIRLINE });
  lines.forEach(([k, v], i) => {
    const y = boxTop - (i + 1) * rowH + 2;
    ops.push({ kind: 'text', x: boxX + mm(2), y, size: 6, bold: true, grey: 0.4, text: k });
    const valueW = boxW - mm(23);
    const valueSize = fitSize(v, valueW, 6.2, 4.6);
    ops.push({ kind: 'text', x: boxX + mm(22), y, size: valueSize, grey: 0.15, text: v });
    if (i < lines.length - 1) ops.push({ kind: 'line', x1: boxX, y1: y - 2.5, x2: boxX + boxW, y2: y - 2.5, ...HAIRLINE, width: 0.4 });
  });

  ops.push({ kind: 'line', x1: MARGIN, y1: H - mm(40), x2: RIGHT, y2: H - mm(40), ...NAVY, width: 0.9 });
};

const drawCompactHeader = (ops: PdfOp[], meta: LedgerPdfMeta) => {
  ops.push({ kind: 'rect', x: MARGIN, y: H - mm(8), w: CONTENT_W, h: 1.4, grey: 0.12, ...NAVY });
  ops.push({ kind: 'text', x: MARGIN, y: H - mm(15), size: 8, bold: true, grey: 0.08, ...NAVY, text: 'GENERAL LEDGER' });
  const mid = `${meta.clinicLabel} · ${meta.accountName || 'Accounts Receivable'} · ${meta.periodLabel}`;
  const midW = CONTENT_W - mm(48);
  const midSize = fitSize(mid, midW, 6, 4.6);
  ops.push({ kind: 'text', x: MARGIN + mm(38), y: H - mm(15), size: midSize, grey: 0.4, text: mid });
  ops.push({ kind: 'line', x1: MARGIN, y1: H - mm(22), x2: RIGHT, y2: H - mm(22), ...HAIRLINE, width: 0.5 });
};

const drawTableHeader = (ops: PdfOp[], yTop: number) => {
  ops.push({ kind: 'rect', x: MARGIN, y: yTop - HEADER_H, w: CONTENT_W, h: HEADER_H, grey: 0.93 });
  for (const c of COLS) {
    const col = xs[c.key];
    const maxW = col.w - mm(3);
    const size = fitSize(c.label, maxW, HEAD_SIZE, 4.8);
    const tx = col.x + (col.w - textW(c.label, size)) / 2;
    ops.push({ kind: 'text', x: tx, y: yTop - HEADER_H + 5, size, bold: true, grey: 0.2, text: c.label });
  }
  ops.push({ kind: 'line', x1: MARGIN, y1: yTop, x2: RIGHT, y2: yTop, ...HAIRLINE, width: 0.45 });
  ops.push({ kind: 'line', x1: MARGIN, y1: yTop - HEADER_H, x2: RIGHT, y2: yTop - HEADER_H, ...NAVY, width: 0.7 });
  for (const c of COLS.slice(1)) {
    ops.push({ kind: 'line', x1: xs[c.key].x, y1: yTop, x2: xs[c.key].x, y2: yTop - HEADER_H, ...HAIRLINE, width: 0.4 });
  }
};

/** Frame the table only down to the last row, never an empty full-page grid. */
const drawTableFrame = (ops: PdfOp[], top: number, bottom: number) => {
  if (bottom >= top) return;
  ops.push({ kind: 'line', x1: MARGIN, y1: top, x2: MARGIN, y2: bottom, ...HAIRLINE, width: 0.4 });
  ops.push({ kind: 'line', x1: RIGHT, y1: top, x2: RIGHT, y2: bottom, ...HAIRLINE, width: 0.4 });
  for (const c of COLS.slice(1)) {
    ops.push({ kind: 'line', x1: xs[c.key].x, y1: top, x2: xs[c.key].x, y2: bottom, ...HAIRLINE, width: 0.35 });
  }
};

const drawFooter = (ops: PdfOp[], meta: LedgerPdfMeta, page: number, totalPages: number) => {
  ops.push({ kind: 'line', x1: MARGIN, y1: FOOTER_Y + 8, x2: RIGHT, y2: FOOTER_Y + 8, ...HAIRLINE, width: 0.5 });
  ops.push({ kind: 'text', x: MARGIN, y: FOOTER_Y, size: 6, grey: 0.5, text: `${meta.labName} · General Ledger · ${meta.clinicLabel}` });
  const pageText = `Page ${page} of ${totalPages}`;
  ops.push({ kind: 'text', x: RIGHT - textW(pageText, 6.5), y: FOOTER_Y, size: 6.5, bold: true, grey: 0.4, text: pageText });
};

interface LaidRow {
  date: string[];
  ref: string[];
  narration: string[];
  debit: string;
  credit: string;
  balance: string;
  h: number;
}

const layoutRow = (r: LedgerReportRow): LaidRow => {
  const date = wrapText(r.dateLabel || r.date || '', xs.date.w - mm(3), DATE_SIZE);
  /* One reference cell: voucher first, then its case on the next line. The two
     identifiers stay separate and intact, never concatenated into one number. */
  const ref = [
    ...wrapText(r.voucherNumber || '—', xs.ref.w - mm(3), REF_SIZE),
    ...(r.caseNumber ? wrapText(`Case ${r.caseNumber}`, xs.ref.w - mm(3), REF_SIZE) : []),
  ];
  const narration = wrapText(r.bodyNarration || r.narration || '', xs.narr.w - mm(3), SIZE);
  const lineCount = Math.max(date.length, ref.length, narration.length);
  return {
    date,
    ref,
    narration,
    debit: r.debit ? pk(r.debit) : '—',
    credit: r.credit ? pk(r.credit) : '—',
    balance: pk(r.balance),
    h: Math.max(ROW_MIN_H, lineCount * ROW_LINE_H + ROW_PAD_Y),
  };
};

type Page = {
  ops: PdfOp[];
  top: number;
  frameTop: number;
  frameBottom: number;
  hasTable: boolean;
};

export interface LedgerPagePlan {
  /** Rows that would appear on each page if pages were filled top to bottom. */
  pageRows: number[];
  /** True when the natural last page is too short and rows are spread evenly. */
  rebalance: boolean;
  /** Row cap used while drawing; Infinity means natural filling. */
  rowsPerPage: number;
}

export interface LedgerPaginationOptions {
  firstTop?: number;
  contTop?: number;
  bottom?: number;
  summaryNeed?: number;
}

/**
 * Decide page breaks from the measured row heights. Natural filling is the
 * default; only a final page with three rows or fewer is rebalanced, because
 * that is the case that reads as an orphaned fragment rather than a statement.
 */
export function planLedgerPagination(
  rowHeights: number[],
  options: LedgerPaginationOptions = {},
): LedgerPagePlan {
  const firstTop = options.firstTop ?? FIRST_TABLE_TOP - HEADER_H;
  const contTop = options.contTop ?? CONT_TABLE_TOP - HEADER_H;
  const bottom = options.bottom ?? CONTENT_BOTTOM;
  const summaryNeed = options.summaryNeed ?? 0;

  if (!rowHeights.length) return { pageRows: [0], rebalance: false, rowsPerPage: Number.POSITIVE_INFINITY };

  const pageRows: number[] = [];
  let rows = 0;
  let y = firstTop;
  for (let i = 0; i < rowHeights.length; i++) {
    const reserve = i === rowHeights.length - 1 ? summaryNeed : 0;
    if (y - rowHeights[i] < bottom + reserve) {
      pageRows.push(rows);
      rows = 0;
      y = contTop;
    }
    y -= rowHeights[i];
    rows++;
  }
  pageRows.push(rows);
  if (y - summaryNeed < bottom) pageRows.push(0);

  const lastPageRows = pageRows[pageRows.length - 1] || 0;
  const rebalance = pageRows.length > 1 && lastPageRows <= 3;
  return {
    pageRows,
    rebalance,
    rowsPerPage: rebalance
      ? Math.max(1, Math.ceil(rowHeights.length / pageRows.length))
      : Number.POSITIVE_INFINITY,
  };
}

/** Build the professional A4-portrait General Ledger PDF. */
export function buildLedgerReportPdf(
  rows: LedgerReportRow[],
  summary: LedgerReportSummary,
  meta: LedgerPdfMeta,
): PdfBuildResult {
  const laid = rows.map(layoutRow);
  const verifyLine = `Verification: opening ${pkr(summary.openingBalance)} + debits ${pkr(summary.totalDebits)} - credits ${pkr(summary.totalCredits)} = closing ${pkr(summary.closingBalance)}.`;

  const summaryH = 16 + 4 * 11 + 8 + 10;
  const totalsH = 24;
  const summaryBlockH = totalsH + summaryH + 10;

  const plan = planLedgerPagination(laid.map((r) => r.h), { summaryNeed: summaryBlockH });
  const rowsPerPage = plan.rowsPerPage;

  const pages: Page[] = [];
  let page: Page;

  const openPage = (isFirst: boolean, withTable: boolean) => {
    const ops: PdfOp[] = [];
    if (isFirst) drawLetterhead(ops, meta, meta.generatedOn);
    else drawCompactHeader(ops, meta);
    const top = isFirst ? FIRST_TABLE_TOP : CONT_TABLE_TOP;
    let cursor = top;
    if (withTable) {
      drawTableHeader(ops, top);
      cursor = top - HEADER_H;
    }
    const p: Page = { ops, top: cursor, frameTop: cursor, frameBottom: cursor, hasTable: withTable };
    pages.push(p);
    return p;
  };

  page = openPage(true, true);
  let cursorY = page.top;
  let rowsOnPage = 0;

  if (!laid.length) {
    page.ops.push({ kind: 'text', x: MARGIN + mm(1.5), y: cursorY - 14, size: 8, grey: 0.4, text: 'No transactions in this period.' });
    cursorY -= 26;
  }

  for (let i = 0; i < laid.length; i++) {
    const r = laid[i];
    /* The last transaction must stay with the totals and summary block. */
    const reserve = i === laid.length - 1 ? summaryBlockH : 0;
    const pageIsFull = rowsOnPage >= rowsPerPage && i < laid.length - 1;
    if (pageIsFull || cursorY - r.h < CONTENT_BOTTOM + reserve) {
      page = openPage(false, true);
      cursorY = page.top;
      rowsOnPage = 0;
    }
    const yTop = cursorY;
    const yBottom = yTop - r.h;
    page.ops.push({ kind: 'line', x1: MARGIN, y1: yBottom, x2: RIGHT, y2: yBottom, ...HAIRLINE, width: 0.35 });

    const drawLines = (key: string, lines: string[], size = SIZE, bold = false, grey = 0.15) => {
      lines.forEach((line, li) => {
        page.ops.push({
          kind: 'text',
          x: xs[key].x + mm(1.5),
          y: yTop - ROW_PAD_Y / 2 - size - li * ROW_LINE_H + 2,
          size,
          bold,
          grey,
          text: line,
        });
      });
    };

    drawLines('date', r.date, DATE_SIZE, false, 0.2);
    drawLines('ref', r.ref, REF_SIZE, true, 0.12);
    drawLines('narr', r.narration, SIZE, false, 0.15);

    const moneyBaseline = yTop - ROW_PAD_Y / 2 - SIZE + 2;
    const debitSize = fitSize(r.debit, xs.debit.w - mm(3), SIZE, 5.2);
    const creditSize = fitSize(r.credit, xs.credit.w - mm(3), SIZE, 5.2);
    const balanceSize = fitSize(r.balance, xs.balance.w - mm(3), SIZE + 0.2, 5.2);
    page.ops.push({ kind: 'text', x: rightAligned('debit', r.debit, debitSize), y: moneyBaseline, size: debitSize, grey: 0.15, text: r.debit });
    page.ops.push({ kind: 'text', x: rightAligned('credit', r.credit, creditSize), y: moneyBaseline, size: creditSize, grey: 0.15, text: r.credit });
    page.ops.push({ kind: 'text', x: rightAligned('balance', r.balance, balanceSize), y: moneyBaseline, size: balanceSize, bold: true, grey: 0.1, text: r.balance });

    cursorY = yBottom;
    page.frameBottom = yBottom;
    rowsOnPage++;
  }

  /* ---- grand total + account summary, exactly once, kept together ---- */
  if (cursorY - summaryBlockH < CONTENT_BOTTOM) {
    page = openPage(false, false);
    cursorY = page.top;
  }

  let ty = cursorY - 6;
  page.ops.push({ kind: 'line', x1: MARGIN, y1: ty + 2, x2: RIGHT, y2: ty + 2, ...NAVY, width: 1.1 });
  const count = summary.transactionCount;
  page.ops.push({
    kind: 'text',
    x: MARGIN + mm(1.5),
    y: ty - 9,
    size: SIZE,
    bold: true,
    grey: 0.1,
    text: `TOTAL (${count} TRANSACTION${count === 1 ? '' : 'S'})`,
  });
  page.ops.push({ kind: 'text', x: rightAligned('debit', pk(summary.totalDebits), SIZE), y: ty - 9, size: SIZE, bold: true, grey: 0.1, text: pk(summary.totalDebits) });
  page.ops.push({ kind: 'text', x: rightAligned('credit', pk(summary.totalCredits), SIZE), y: ty - 9, size: SIZE, bold: true, grey: 0.1, text: pk(summary.totalCredits) });
  page.ops.push({ kind: 'text', x: rightAligned('balance', pk(summary.closingBalance), SIZE + 0.4), y: ty - 9, size: SIZE + 0.4, bold: true, grey: 0.05, text: pk(summary.closingBalance) });
  page.ops.push({ kind: 'line', x1: MARGIN, y1: ty - 13, x2: RIGHT, y2: ty - 13, ...NAVY, width: 0.8 });

  const boxW = mm(95);
  const boxX = RIGHT - boxW;
  const boxTop = ty - 24;
  const figs: [string, string][] = [
    ['OPENING BALANCE', pkr(summary.openingBalance)],
    ['TOTAL DEBITS', pkr(summary.totalDebits)],
    ['TOTAL CREDITS', pkr(summary.totalCredits)],
    ['CLOSING BALANCE', pkr(summary.closingBalance)],
  ];
  const fh = 11;
  const boxH = figs.length * fh + 18;
  page.ops.push({ kind: 'rectStroke', x: boxX, y: boxTop - boxH, w: boxW, h: boxH, width: 0.6, ...HAIRLINE });
  page.ops.push({ kind: 'text', x: boxX + mm(2), y: boxTop - 10, size: 6.5, bold: true, grey: 0.3, ...NAVY, text: `ACCOUNT SUMMARY · ${meta.accountName || 'Accounts Receivable'}` });
  figs.forEach(([k, v], i) => {
    const y = boxTop - 18 - i * fh;
    const vSize = fitSize(v, boxW - mm(45), 7, 5.2);
    page.ops.push({ kind: 'text', x: boxX + mm(2), y, size: 6.5, grey: 0.35, text: k });
    page.ops.push({ kind: 'text', x: boxX + boxW - mm(2) - textW(v, vSize), y, size: vSize, bold: i === 3, grey: 0.1, text: v });
  });

  const ry = boxTop - boxH - 8;
  page.ops.push({ kind: 'text', x: MARGIN + mm(1.5), y: ry, size: 6, grey: 0.42, text: verifyLine });

  /* Frames end at the last transaction row on each page. */
  for (const p of pages) {
    if (p.hasTable) drawTableFrame(p.ops, p.frameTop, p.frameBottom);
  }

  const totalPages = pages.length;
  const pageSpecs = pages.map((p, i) => {
    const ops = p.ops.slice();
    drawFooter(ops, meta, i + 1, totalPages);
    return { ops, geo: { ...PAGE, W, H } };
  });

  return assemblePdf(pageSpecs, {
    title: `General Ledger - ${meta.clinicLabel} - ${meta.periodLabel}`,
    author: meta.labName,
    subject: `Accounts receivable statement for ${meta.clinicLabel}`,
    keywords: `general ledger, accounts receivable, ${meta.accountCode || ''}, ${meta.clinicLabel}`,
    creator: 'Dental Solutions',
    producer: 'Dental Solutions PDF Engine',
    created: meta.generatedOn,
  });
}
