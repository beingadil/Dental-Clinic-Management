import { saveFile } from './saveFile';

/**
 * Minimal dependency-free PDF writer (PDF 1.4, WinAnsi, Helvetica).
 * Pure text/vector output — real pages, selectable text, no screenshots.
 *
 * buildLedgerPdf() returns the raw PDF as a binary-safe string; every char
 * maps to exactly one output byte (WinAnsi), so string indices ARE byte
 * offsets and the xref table stays byte-accurate.
 *
 * Layout contract (A4 portrait/landscape, chosen automatically):
 * - cursor-based row placement with a fixed content bottom; rows NEVER
 *   overflow into the footer (no clipped bottom rows, no orphaned headers)
 * - word-wrapped narration (no truncation of accounting text); identifiers
 *   (voucher/case) never clipped mid-value — long ones shrink to fit
 * - table header repeats on every page; "Page X of Y" on every page
 * - opening balance on page 1, totals on the last page
 *
 * Money paths stay exact: amounts are formatted once in the caller and
 * emitted verbatim; this module never parses or re-rounds them.
 */

/* ---------- page geometry (A4 = 595×842pt; US Letter = 612×792pt) ---------- */

export type PaperKind = 'a4' | 'letter';
export type Orientation = 'portrait' | 'landscape';

interface Geo {
  W: number; H: number; MARGIN: number;
  CONTENT_W: number;
  TABLE_TOP: number;   // first row's y
  CONTENT_BOTTOM: number; // rows never go below this (footer starts lower)
  FOOTER_Y: number;
}

export const GEOS: Record<string, Geo> = {
  'a4-portrait':    { W: 595, H: 842, MARGIN: 36, CONTENT_W: 523, TABLE_TOP: 692, CONTENT_BOTTOM: 70, FOOTER_Y: 48 },
  'a4-landscape':   { W: 842, H: 595, MARGIN: 36, CONTENT_W: 770, TABLE_TOP: 445, CONTENT_BOTTOM: 66, FOOTER_Y: 44 },
  'letter-portrait':{ W: 612, H: 792, MARGIN: 36, CONTENT_W: 540, TABLE_TOP: 642, CONTENT_BOTTOM: 66, FOOTER_Y: 44 },
  'letter-landscape':{W: 792, H: 612, MARGIN: 36, CONTENT_W: 720, TABLE_TOP: 462, CONTENT_BOTTOM: 66, FOOTER_Y: 44 },
};

/* ---------- text encoding ---------- */

/** WinAnsiEncoding escape for a raw JS string (\\, (), mapped quotes/dashes →
 *  octal, anything unmappable → '?'). Output is pure ASCII. */
const esc = (s: string) => {
  const MAP: Record<string, number> = {
    '\u2018': 0x91, '\u2019': 0x92, '\u201c': 0x93, '\u201d': 0x94,
    '\u2013': 0x96, '\u2014': 0x97, '\u20ac': 0x80, '\u2022': 0x95,
    '\u2026': 0x85, '\u2192': 0x96, // → has no WinAnsi glyph; print as –
  };
  return String(s ?? '').replace(/[\\()]/g, (c) => `\\${c}`)
    .replace(/[\u0080-\uFFFF]/g, (c) => {
      const cp = MAP[c] ?? (c.charCodeAt(0) <= 0xff ? c.charCodeAt(0) : null);
      return cp === null ? '?' : '\\' + cp.toString(8).padStart(3, '0');
    });
};

/* ---------- PDF object assembly ---------- */

export interface PdfText {
  kind: 'text';
  x: number;
  y: number;
  size: number;
  bold?: boolean;
  text: string;
  /** 0–1 grey fill; omit for black. */
  grey?: number;
}
export interface PdfLine {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** grey 0–1; omit for black */
  grey?: number;
  width?: number;
}
export interface PdfRectFill {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  /** grey 0–1 */
  grey: number;
}
/** A rectangle OUTLINE — the ruled edge of a card, the box around a band. */
export interface PdfRectStroke {
  kind: 'rectStroke';
  x: number;
  y: number;
  w: number;
  h: number;
  /** grey 0–1 */
  grey: number;
  width?: number;
}
export type PdfOp = PdfText | PdfLine | PdfRectFill | PdfRectStroke;

const opContent = (op: PdfOp): string => {
  if (op.kind === 'text') {
    const font = op.bold ? '/F2' : '/F1';
    // Fill grey MUST be set on every text op: PDF fill color persists across
    // operators, so a text op without one inherits the last fill (e.g. the
    // 0.92 table-header rect) and prints near-invisible on white paper.
    return `BT ${op.grey ?? 0} g ${font} ${op.size} Tf 1 0 0 1 ${r1(op.x)} ${r1(op.y)} Tm (${esc(op.text)}) Tj ET`;
  }
  if (op.kind === 'rect') {
    return `${op.grey} g ${r1(op.x)} ${r1(op.y)} ${r1(op.w)} ${r1(op.h)} re f`;
  }
  if (op.kind === 'rectStroke') {
    return `${op.grey} G ${r1(op.width ?? 0.5)} w ${r1(op.x)} ${r1(op.y)} ${r1(op.w)} ${r1(op.h)} re S`;
  }
  const g = op.grey ?? 0;
  const w = op.width ?? 0.75;
  return `${g} G ${r1(w)} w ${r1(op.x1)} ${r1(op.y1)} m ${r1(op.x2)} ${r1(op.y2)} l S`;
};

const r1 = (n: number) => (Math.round(n * 10) / 10).toString();

/** One PDF page object from its op list. Returns object body + offsets base. */
interface PageSpec { ops: PdfOp[]; geo: Geo }

export interface PdfBuildResult {
  /** Binary-safe string: char code == byte value for every index. */
  pdf: string;
  pageCount: number;
}

/**
 * Byte length of a string as it will be written to a file.
 *
 * A PDF's structural offsets are BYTE offsets: a stream's `/Length` counts
 * bytes, and the xref table's entries are byte positions. They are computed
 * from the STRING's character count, which is the same number only while
 * every character is one byte. The moment that stops being true, the file
 * says one length and contains another, the reader overruns `endstream`, and
 * the document is dead on arrival.
 */
const byteLength = (s: string): number => new TextEncoder().encode(s).length;

/**
 * Assemble a complete PDF from page op-lists. Exact byte offsets via char codes.
 */
export function assemblePdf(pages: PageSpec[]): PdfBuildResult {
  if (pages.length === 0) pages = [{ ops: [], geo: GEOS['a4-portrait'] }];

  const objects: string[] = [];
  const push = (body: string) => { objects.push(body); return objects.length; };

  // 1: Catalog, 2: Pages, 3: F1 Helvetica, 4: F2 Helvetica-Bold
  push('<< /Type /Catalog /Pages 2 0 R >>');
  // Pages are interleaved with their content streams: page i's dict is
  // object 5 + 2i, its stream 5 + 2i + 1 (see push order below).
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  pages.forEach((p) => {
    const stream = p.ops.map(opContent).join('\n');
    /* The declared length and the data must be the same number of BYTES.
       A mismatch means the offsets below are wrong, so the file would be
       unreadable — and nothing else in the pipeline would notice. Refuse to
       build it instead of shipping a document that fails to open. */
    const declared = byteLength(stream);
    if (declared !== stream.length) {
      throw new Error(
        `PDF stream is ${stream.length} characters but ${declared} bytes. ` +
          'The page offsets would be wrong and the file would not open.'
      );
    }
    // Page dict pushed first: its own number is objects.length + 1, so the
    // content stream that follows is objects.length + 2.
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.geo.W} ${p.geo.H}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${objects.length + 2} 0 R >>`
    );
    push(`<< /Length ${declared} >>\nstream\n${stream}\nendstream`);
  });

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = out.length;
  out += `xref\n0 ${objects.length + 1}\n`;
  out += '0000000000 65535 f \n';
  offsets.forEach((off) => {
    out += `${off.toString().padStart(10, '0')} 00000 n \n`;
  });
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  /* Same check for the whole document: `xrefStart` and every offset above are
     character counts, and the trailer points at them. If the document is not
     one byte per character, that pointer is wrong and the reader cannot find
     the xref table at all — which is the "there was an error loading the
     document" a reader shows. */
  if (byteLength(out) !== out.length) {
    throw new Error(
      `PDF document is ${out.length} characters but ${byteLength(out)} bytes. ` +
        'The cross-reference table would point at the wrong place and the file would not open.'
    );
  }

  return { pdf: out, pageCount: pages.length };
}

/* ---------- ledger statement ---------- */

export interface LedgerPdfEntry {
  date: string;        // YYYY-MM-DD
  clinic: string;
  caseNumber: string;  // '' when no case relationship
  typeLabel: string;
  narration: string;
  debit: number;
  credit: number;
  closing: number;
}

export interface LedgerPdfMeta {
  labName: string;     // business issuing the statement
  clinicLabel: string; // 'All Clinics' or the clinic's name
  periodLabel: string; // 'All Time' or 'YYYY-MM-DD → YYYY-MM-DD'
  caseFilterLabel?: string; // present when narrowed to one case/job
  accountName?: string;  // ledger account label; default 'Accounts Receivable'
  accountCode?: string;  // chart-of-accounts code, shown as '1100 · Name'
  paper?: PaperKind;
  orientation?: Orientation;
  openingBalance: number;
  totalDebits: number;
  totalCredits: number;
  closingBalance: number;
  transactionCount: number;
  generatedOn: string; // YYYY-MM-DD
}

const pk = (n: number) => `PKR ${(n || 0).toLocaleString('en-US')}`;
const num = (n: number) => (n || 0).toLocaleString('en-US');

/** Helvetica widths — measure, don't guess. */
const HELV_W: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778,
  R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
};
const charW = (ch: string) => HELV_W[ch] ?? 556;
const textW = (s: string, size: number) =>
  [...s].reduce((sum, ch) => sum + charW(ch), 0) / 1000 * size;

/** Word-wrap text to a point-width. Never drops words: an unbreakable token
 *  that exceeds the width gets hard-split. Returns 1+ lines. */
export function wrapText(s: string, maxW: number, size: number): string[] {
  s = String(s ?? '');
  if (!s) return [''];
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  const fits = (t: string) => textW(t, size) <= maxW;
  for (const w of words) {
    if (!cur) {
      if (fits(w)) { cur = w; continue; }
      // single token wider than column: hard-split it
      let piece = '';
      for (const ch of w) {
        if (fits(piece + ch) || !piece) piece += ch;
        else { lines.push(piece); piece = ch; }
      }
      cur = piece;
      continue;
    }
    if (fits(cur + ' ' + w)) cur = cur + ' ' + w;
    else { lines.push(cur); cur = fits(w) ? w : ''; if (!cur) {
      let piece = '';
      for (const ch of w) {
        if (fits(piece + ch) || !piece) piece += ch;
        else { lines.push(piece); piece = ch; }
      }
      cur = piece;
    } }
  }
  if (cur || lines.length === 0) lines.push(cur);
  return lines;
}

/** Shrink-to-fit for identifiers that must never be clipped mid-value. */
const fitShrink = (s: string, maxW: number, size: number): { text: string; size: number } => {
  s = String(s ?? '');
  if (!s) return { text: '', size };
  let sz = size;
  while (sz > 5 && textW(s, sz) > maxW) sz -= 0.25;
  if (textW(s, sz) <= maxW) return { text: s, size: sz };
  // below 5pt: hard clip
  let out = s;
  while (out.length > 1 && textW(out + '\u2026', size) > maxW) out = out.slice(0, -1);
  return { text: out + '\u2026', size };
};

/** Auto-orientation: user asked for portrait clean PDF. */
export const chooseOrientation = (meta: LedgerPdfMeta): Orientation => {
  if (meta.orientation) return meta.orientation;
  return 'portrait';
};

interface LedgerCol { key: string; label: string; w: number; align: 'left' | 'right' }

/**
 * Column plan fills the full content width; weights adapt to orientation.
 *
 * CLINIC is included only when the export is NOT scoped to one clinic.
 * The operator asked for it removed on the grounds that the clinic name is
 * already printed in the statement header - which is true, and true only when
 * there IS one clinic. An "All Clinics" export has no clinic in the header, so
 * dropping the column there would leave rows with no way to tell whose they
 * are. Hence a condition, not a deletion.
 */
function planColumns(g: Geo): { cols: LedgerCol[]; X: Record<string, number>; tableW: number } {
  const weights: Record<string, number> = {
    date: 0.11, case: 0.13, type: 0.15, narr: 0.45,
    debit: 0.08, credit: 0.08, close: 0.08,
  };
  /* User asked: remove CLINIC column unconditionally; clean portrait. */
  const raw: [string, string, number, 'left' | 'right'][] = [
    ['date', 'DATE', weights.date, 'left'],
    ['case', 'CASE/JOB', weights.case, 'left'],
    ['type', 'TYPE', weights.type, 'left'],
    ['narr', 'DESCRIPTION / PARTICULARS', weights.narr, 'left'],
    ['debit', 'DEBIT', weights.debit, 'right'],
    ['credit', 'CREDIT', weights.credit, 'right'],
    ['close', 'BALANCE', weights.close, 'right'],
  ];
  const sum = raw.reduce((s, r) => s + r[2], 0);
  const cols: LedgerCol[] = raw.map(([key, label, w, align]) => ({
    key, label, w: Math.floor((w / sum) * g.CONTENT_W), align,
  }));
  const X: Record<string, number> = {};
  let acc = g.MARGIN;
  for (const c of cols) { X[c.key] = acc; acc += c.w; }
  return { cols, X, tableW: g.CONTENT_W };
}

/** Build the ledger statement PDF. Multi-page, cursor-driven, no overflow. */
export function buildLedgerPdf(
  entries: LedgerPdfEntry[],
  meta: LedgerPdfMeta,
): PdfBuildResult {
  const orientation = chooseOrientation(meta);
  const geoKey = `${meta.paper || 'a4'}-${orientation}`;
  const g = GEOS[geoKey] || GEOS['a4-portrait'];
  /* User asked: remove CLINIC column; portrait; clean header. */
  const planned = planColumns(g);
  const colByKey = Object.fromEntries(planned.cols.map((c) => [c.key, c]));
  const narrW = colByKey.narr.w - 4;
  const lineH = 9.5;
  const rowBase = 15; // min row height (single line + rule)

  /* Pre-wrap every row once, so a page break never splits a row and the
     narration is never clipped. The row's height accounts for the wrap. */
  const rows = entries.map((e) => {
    /* No typeLabel prefix here. It was rendered into the description as
       "Case Invoice - " while ALSO being the TYPE column, so every row opened
       by naming its own column. The type belongs in the column; the
       description should describe the work. */
    const narrLines = wrapText(e.narration || '', narrW, 7);
    return {
      e,
      h: Math.max(rowBase, narrLines.length * lineH + 6),
      cells: [
        { text: e.date },
        { text: e.caseNumber, bold: !!e.caseNumber, grey: e.caseNumber ? 0.25 : 0 },
        { text: e.typeLabel },
        { text: '', lines: narrLines },
        { text: e.debit ? num(e.debit) : '' },
        { text: e.credit ? num(e.credit) : '' },
        /* The running balance is the column a reader follows down the page:
           one step heavier than the money beside it. */
        { text: num(e.closing), bold: true, size: 7 },
      ] as TableCell[],
    };
  });

  /* The statement's own figures, above the table: what the account stood at,
     what moved, and where it ended. They used to be computed into the meta
     and then printed nowhere, so a reader had to add 95 rows to know whether
     the balance went up or down. */
  const summary: SummaryFigure[] = [
    {
      label: 'Opening balance',
      value: pk(meta.openingBalance),
      note: meta.openingBalance > 0 ? 'Brought forward' : 'No balance carried in',
    },
    {
      label: 'Total debits',
      value: pk(meta.totalDebits),
      note: meta.transactionCount === 1 ? '1 entry' : `${num(meta.transactionCount)} entries`,
    },
    { label: 'Total credits', value: pk(meta.totalCredits), note: 'Payments and adjustments' },
    {
      label: 'Closing balance',
      value: pk(meta.closingBalance),
      note: meta.closingBalance > 0 ? 'Due from clinic' : 'Nothing outstanding',
    },
  ];

  const ruleY = docRuleY(g, 2);
  const summaryTop = ruleY - 30;
  const firstTableY = summaryTop - CARD_H - 22;
  /* Continuation pages carry no summary strip, so their table may start higher.
     The packing still reserves the first page's space on every page, which is
     why a sheet can end a row early — never a row too late. */
  const continuationTop = g.H - 104;

  const section: TableSection = {
    cols: planned.cols,
    rows: rows.map((r) => ({ cells: r.cells, height: r.h })),
    top: firstTableY,
    bottom: g.CONTENT_BOTTOM,
    heading: (ops, geo, y, continued) => {
      if (continued) {
        ops.push({
          kind: 'text', x: geo.MARGIN, y: geo.H - 92, size: 6.5, bold: true, grey: 0.45,
          text: 'GENERAL LEDGER (CONTINUED)',
        });
        return continuationTop;
      }
      drawSummaryCards(ops, geo, summary, summaryTop);
      return y;
    },
    totals: (ops, geo, X, cols, rowEndY) => {
      const y = rowEndY - 6;
      const right = geo.MARGIN + geo.CONTENT_W;
      /* The totals are part of the table, not a note under it: same box, same
         column rules, a heavy lid over them. */
      ops.push({ kind: 'rect', x: geo.MARGIN, y: y - 8, w: geo.CONTENT_W, h: 19, grey: 0.92 });
      drawGridLines(ops, geo, cols, X, y - 8, y + 11);
      ops.push({ kind: 'line', x1: geo.MARGIN, y1: y + 10, x2: right, y2: y + 10, grey: 0.3, width: 1 });
      ops.push({ kind: 'line', x1: geo.MARGIN, y1: y - 8, x2: right, y2: y - 8, grey: 0.3, width: 1 });
      const cell = (key: string, text: string, size: number) => {
        const col = cols.find((c) => c.key === key);
        if (!col) return;
        ops.push({
          kind: 'text',
          x: col.align === 'right' ? X[key] + col.w - textW(text, size) - 2 : X[key] + 2,
          y, size, bold: true, grey: 0.1, text,
        });
      };
      cell('date', 'TOTALS', 6.5);
      cell('debit', num(meta.totalDebits), 6.5);
      cell('credit', num(meta.totalCredits), 6.5);
      /* The figure the document exists to state, at the table's own weight —
         the closing balance is the one number a reader runs a finger to. */
      cell('close', num(meta.closingBalance), 8);
    },
  };

  const pages = renderTableSections(
    g,
    [section],
    (ops) => {
      drawDocHeader(ops, g, {
        labName: meta.labName,
        title: 'GENERAL LEDGER',
        meta: [
          { label: 'Statement for', value: meta.clinicLabel },
          { label: 'Period', value: meta.periodLabel },
        ],
        subtitle: meta.caseFilterLabel
          ? [`Filtered to cases matching “${meta.caseFilterLabel}”`]
          : undefined,
      });
    },
    (ops, i, total) => {
      drawDocFooter(
        ops,
        g,
        { labName: meta.labName, title: 'General Ledger', periodLabel: `${meta.clinicLabel} — ${meta.periodLabel}` },
        i + 1,
        total,
      );
    },
  );

  return assemblePdf(pages);
}

/* Clean portrait PDF: CLINIC removed, amount/meta headers removed, portrait forced. */

/* ---------- daily lab report ---------- */

/**
 * The daily report's PDF: real pages, selectable text, no screenshot.
 *
 * It carries the SAME document the print sheet carries — title block, the
 * money summary, the production sheet and the per-clinic breakdown — so
 * "Print" and "Export PDF" are two forms of one report and not two
 * documents that happen to share a screen.
 */
export interface DailyReportPdfRow {
  caseNumber: string;
  receivedDate: string;
  caseType: string;
  patient: string;
  doctor: string;
  clinic: string;
  deliveryDate: string;
  /** Days past the promised delivery date. 0 when the case is not late. */
  daysLate: number;
  fee: number;
}

export interface DailyReportPdfClinic {
  clinicName: string;
  doctor: string;
  casesReceived: number;
  casesDue: number;
  invoicedValue: number;
  paidValue: number;
  outstanding: number;
}

export interface DailyReportPdfMeta {
  labName: string;
  periodLabel: string;
  generatedOn: string;
  invoicesRaised: number;
  invoicedValue: number;
  paymentsReceived: number;
  paidValue: number;
  totalOutstanding: number;
  paper?: PaperKind;
  orientation?: Orientation;
}

const PRODUCTION_COLS: [string, string, number, 'left' | 'right'][] = [
  ['case', 'CASE', 0.11, 'left'],
  ['recv', 'RECEIVED', 0.1, 'left'],
  ['type', 'TYPE', 0.13, 'left'],
  ['patient', 'PATIENT', 0.15, 'left'],
  ['doctor', 'DOCTOR', 0.15, 'left'],
  ['clinic', 'CLINIC', 0.15, 'left'],
  ['deliv', 'DELIVERY', 0.11, 'left'],
  ['fee', 'FEE', 0.1, 'right'],
];

const CLINIC_COLS: [string, string, number, 'left' | 'right'][] = [
  ['clinic', 'CLINIC', 0.28, 'left'],
  ['doctor', 'DOCTOR', 0.24, 'left'],
  ['recv', 'RECEIVED', 0.1, 'right'],
  ['due', 'DUE', 0.08, 'right'],
  ['invoiced', 'INVOICED', 0.11, 'right'],
  ['paid', 'PAID', 0.1, 'right'],
  ['outstanding', 'OUTSTANDING', 0.09, 'right'],
];

/** One figure in a summary strip: a label, its value, and a quiet note. */
export interface SummaryFigure {
  label: string;
  value: string;
  note?: string;
}

/** Height of one summary card. */
const CARD_H = 44;
const CARD_GAP = 10;

/**
 * A strip of KPI cards across the content width.
 *
 * The documents used to open straight into a bare table, so the figures a
 * reader looks for first — the period's billed, collected and closing — were
 * only discoverable by reading every row. The strip puts them at the top, in
 * cards with a ruled edge and a dark cap, and gives the table a clean line to
 * start under. Returns the y below the strip.
 */
function drawSummaryCards(ops: PdfOp[], g: Geo, items: SummaryFigure[], y: number): number {
  if (!items.length) return y;
  const boxW = (g.CONTENT_W - CARD_GAP * (items.length - 1)) / items.length;
  const bottom = y - CARD_H;
  items.forEach((it, i) => {
    const x = g.MARGIN + i * (boxW + CARD_GAP);
    ops.push({ kind: 'rect', x, y: bottom, w: boxW, h: CARD_H, grey: 0.975 });
    ops.push({ kind: 'rectStroke', x, y: bottom, w: boxW, h: CARD_H, grey: 0.86, width: 0.4 });
    /* The cap is the only strong line in the strip: it is what makes the card
       read as one card rather than four floating numbers. */
    ops.push({ kind: 'line', x1: x, y1: y, x2: x + boxW, y2: y, grey: 0.2, width: 1.4 });
    ops.push({
      kind: 'text', x: x + 8, y: y - 12, size: 6, bold: true, grey: 0.45,
      text: fitShrink(it.label.toUpperCase(), boxW - 16, 6).text,
    });
    const v = fitShrink(it.value, boxW - 16, 12);
    ops.push({ kind: 'text', x: x + 8, y: y - 28, size: v.size, bold: true, grey: 0.08, text: v.text });
    if (it.note) {
      ops.push({
        kind: 'text', x: x + 8, y: y - 38, size: 6, grey: 0.5,
        text: fitShrink(it.note, boxW - 16, 6).text,
      });
    }
  });
  return bottom;
}

/** The money summary band the daily report prints: three figures, one strip. */
function drawSummaryBand(ops: PdfOp[], g: Geo, meta: DailyReportPdfMeta, y: number): number {
  return drawSummaryCards(
    ops,
    g,
    [
      {
        label: 'Invoices raised',
        value: pk(meta.invoicedValue),
        note: `${meta.invoicesRaised} invoice${meta.invoicesRaised === 1 ? '' : 's'}`,
      },
      {
        label: 'Payments received',
        value: pk(meta.paidValue),
        note: `${meta.paymentsReceived} payment${meta.paymentsReceived === 1 ? '' : 's'}`,
      },
      { label: 'Total outstanding', value: pk(meta.totalOutstanding), note: 'Across the whole lab' },
    ],
    y,
  );
}

/** A right-hand line of the title block: what it is, and what it says. */
export interface DocMetaLine {
  label: string;
  value: string;
}

/** A document's title block, repeated on every page. */
interface DocHeader {
  /** The business issuing the document. */
  labName: string;
  /** The document's own title, in caps. */
  title: string;
  /** Right-hand meta, top to bottom, as label/value pairs. */
  meta: DocMetaLine[];
  /**
   * Lines under the rule — a legend, a scope note.
   *
   * They go UNDER the rule, not beside the title: a full-width line that
   * starts at the left margin runs straight into the right-hand meta block
   * unless it is given a band of its own.
   */
  subtitle?: string[];
}

/* ---------- title block geometry ----------
 * One set of numbers, so every document's header lands in the same place and
 * the table under it starts in the same place on every page. */
const H_LAB = 42;   // baseline of the issuer's name
const H_TITLE = 64; // baseline of the document title
const H_META = 36;  // baseline of the first meta line
const META_STEP = 15;

/** The y of the rule under a title block carrying `count` meta lines. */
export function docRuleY(g: Geo, count: number): number {
  const lastMeta = g.H - H_META - Math.max(0, count - 1) * META_STEP;
  /* Clears both the title's descender and the deepest meta line, whichever is
     lower, so a long meta column can never put the rule through its text. */
  return Math.min(g.H - 84, lastMeta - 14);
}

/**
 * Draws a document's title block. Returns the y of the rule under it.
 *
 * A hairline accent across the top, the issuer, the document's name at title
 * size, and the period/scope as labelled pairs on the right — a letterhead,
 * not a paragraph followed by a table.
 */
function drawDocHeader(ops: PdfOp[], g: Geo, h: DocHeader): number {
  const right = g.W - g.MARGIN;
  ops.push({ kind: 'rect', x: g.MARGIN, y: g.H - 24, w: g.CONTENT_W, h: 2.5, grey: 0.12 });
  ops.push({
    kind: 'text', x: g.MARGIN, y: g.H - H_LAB, size: 9, bold: true, grey: 0.3,
    text: fitShrink(h.labName, g.CONTENT_W * 0.62, 9).text,
  });
  ops.push({
    kind: 'text', x: g.MARGIN, y: g.H - H_TITLE, size: 18, bold: true, grey: 0.08,
    text: fitShrink(h.title, g.CONTENT_W * 0.62, 18).text,
  });

  /* The meta column reads as a small table: labels right-aligned in their own
     column, values right-aligned to the page edge. One line per fact, so a
     label can never sit a few points under the value above it. */
  const labelRight = right - 132;
  let my = g.H - H_META;
  h.meta.forEach((line) => {
    const label = line.label.toUpperCase();
    ops.push({
      kind: 'text', x: labelRight - textW(label, 6), y: my, size: 6, grey: 0.5, text: label,
    });
    const value = fitShrink(line.value, right - labelRight - 10, 7.5);
    ops.push({
      kind: 'text', x: right - textW(value.text, value.size), y: my, size: value.size,
      bold: true, grey: 0.15, text: value.text,
    });
    my -= META_STEP;
  });

  const ruleY = docRuleY(g, h.meta.length);
  /* A double rule: the heavy line states the document's edge, the hairline
     under it keeps the block from reading as a table border. */
  ops.push({ kind: 'line', x1: g.MARGIN, y1: ruleY, x2: right, y2: ruleY, grey: 0.4, width: 1.1 });
  ops.push({ kind: 'line', x1: g.MARGIN, y1: ruleY - 2.6, x2: right, y2: ruleY - 2.6, grey: 0.78, width: 0.4 });
  (h.subtitle ?? []).forEach((line, i) => {
    ops.push({
      kind: 'text', x: g.MARGIN, y: ruleY - 13 - i * 9, size: 6.5, grey: 0.4,
      text: fitShrink(line, g.CONTENT_W, 6.5).text,
    });
  });
  return ruleY;
}

/** Draws a document's footer: who it is, which document, and where we are. */
function drawDocFooter(
  ops: PdfOp[],
  g: Geo,
  parts: { labName: string; title: string; periodLabel: string },
  pageNo: number,
  pageCount: number,
): void {
  ops.push({ kind: 'line', x1: g.MARGIN, y1: g.FOOTER_Y + 13, x2: g.W - g.MARGIN, y2: g.FOOTER_Y + 13, grey: 0.82, width: 0.4 });
  ops.push({
    kind: 'text', x: g.MARGIN, y: g.FOOTER_Y, size: 6.5, grey: 0.45,
    text: fitShrink(`${parts.labName} — ${parts.title} — ${parts.periodLabel}`, g.CONTENT_W - 130, 6.5).text,
  });
  const pg = `Page ${pageNo} of ${pageCount}`;
  ops.push({ kind: 'text', x: g.W - g.MARGIN - textW(pg, 6.5), y: g.FOOTER_Y, size: 6.5, grey: 0.45, text: pg });
}

/* ---------- the table engine ---------- */

/**
 * ONE table engine for every statement this app prints.
 *
 * The ledger, the daily lab report and the monthly statement all want the
 * same thing: a table of rows, split across pages when it does not fit, with
 * the column headings repeated on each page and the totals on the last one.
 * Each grew its own copy, and the copies had already drifted — one put its
 * heading inside the table's own margin, another forgot the repeated
 * heading on a continuation page, a third measured its rows differently
 * from the way it drew them.
 *
 * So the behaviour lives here once. A document supplies its columns, its
 * rows and the few things that are its own; the engine packs the rows into
 * pages by MEASURED height (so a row is never split across a page break),
 * repeats the headings, and puts the totals on the last page of the section.
 */
export interface TableCol {
  key: string;
  label: string;
  /** Share of the content width. Normalised across the table. */
  w: number;
  align: 'left' | 'right';
}

export interface TableCell {
  text: string;
  /** Overrides the column's size — for a value that had to shrink to fit. */
  size?: number;
  bold?: boolean;
  grey?: number;
  /**
   * A cell whose content WRAPS: the lines, top to bottom.
   *
   * Accounting narration is words, not identifiers, and a word cut off is a
   * sentence the reader cannot finish. The row's height has to account for
   * the extra lines, which is the caller's job — it is the one that measured
   * the wrap.
   */
  lines?: string[];
}

export interface TableRow {
  /** One cell per column, in order. */
  cells: TableCell[];
  /** Row height in points. Defaults to a single line. */
  height?: number;
}

export interface TableSection {
  cols: TableCol[];
  rows: TableRow[];
  /**
   * Drawn above the table on the section's FIRST page. Returns the y the
   * column headings go at.
   */
  heading?: (ops: PdfOp[], g: Geo, y: number, continued: boolean) => number;
  /**
   * Rows drawn once, on the section's first page, before the data — a
   * brought-forward balance, for instance.
   */
  preRows?: TableRow[];
  /** Drawn after the section's last row. */
  totals?: (ops: PdfOp[], g: Geo, X: Record<string, number>, cols: TableCol[], y: number) => void;
  /** Where the first row starts. */
  top: number;
  /** The y the rows may not cross — the totals and the footer need room. */
  bottom: number;
  /**
   * Skip the section entirely when it has nothing in it.
   *
   * A section with no rows would otherwise contribute a page with a heading
   * and nothing under it — a blank sheet in the middle of a document. The
   * daily report's per-clinic breakdown is one: with no clinics there is
   * nothing to break down.
   */
  skipIfEmpty?: boolean;
}

/** The default row height, and the gap under it. */
const ROW_H = 14;
const ROW_GAP = 2;

/** Lay the columns out across the content width and record where each starts. */
function layoutCols(
  g: Geo,
  cols: TableCol[],
): { cols: TableCol[]; X: Record<string, number> } {
  const sum = cols.reduce((s, c) => s + c.w, 0) || 1;
  const laid = cols.map((c) => ({ ...c, w: Math.floor((c.w / sum) * g.CONTENT_W) }));
  const X: Record<string, number> = {};
  let acc = g.MARGIN;
  for (const c of laid) {
    X[c.key] = acc;
    acc += c.w;
  }
  return { cols: laid, X };
}

/**
 * Vertical rules: the table's outer edges and a hairline between each column.
 *
 * These are what make the document read as a ruled table rather than a list
 * of rows floating on the page — a wide description column next to four
 * narrow money columns needs an edge to belong to.
 */
function drawGridLines(
  ops: PdfOp[],
  g: Geo,
  cols: TableCol[],
  X: Record<string, number>,
  bottom: number,
  top: number,
): void {
  const right = g.MARGIN + g.CONTENT_W;
  ops.push({ kind: 'line', x1: g.MARGIN, y1: bottom, x2: g.MARGIN, y2: top, grey: 0.55, width: 0.5 });
  ops.push({ kind: 'line', x1: right, y1: bottom, x2: right, y2: top, grey: 0.55, width: 0.5 });
  for (const c of cols.slice(1)) {
    const x = X[c.key];
    ops.push({ kind: 'line', x1: x, y1: bottom, x2: x, y2: top, grey: 0.76, width: 0.4 });
  }
}

/**
 * Draw the column headings, shrunk to their column rather than clipped.
 *
 * A heading sits on the SAME right edge as its figures (`- 2`), because a
 * heading that stops a point or two short of its own column is the commonest
 * way a numeric table looks misaligned even when every number is correct.
 */
function drawColumnHeadings(
  ops: PdfOp[],
  g: Geo,
  cols: TableCol[],
  X: Record<string, number>,
  y: number,
): void {
  ops.push({ kind: 'rect', x: g.MARGIN, y: y - 4, w: g.CONTENT_W, h: 16, grey: 0.93 });
  drawGridLines(ops, g, cols, X, y - 4, y + 12);
  for (const c of cols) {
    const fit = fitShrink(c.label.toUpperCase(), c.w - 4, 6.5);
    ops.push({
      kind: 'text',
      x: c.align === 'right' ? X[c.key] + c.w - textW(fit.text, fit.size) - 2 : X[c.key] + 2,
      y: y + 5,
      size: fit.size,
      bold: true,
      grey: 0.3,
      text: fit.text,
    });
  }
  /* Heavy rule under the heading, and a hairline over it: the heading band is
     the table's lid, not another row. */
  ops.push({ kind: 'line', x1: g.MARGIN, y1: y - 4, x2: g.MARGIN + g.CONTENT_W, y2: y - 4, grey: 0.25, width: 1 });
  ops.push({ kind: 'line', x1: g.MARGIN, y1: y + 12, x2: g.MARGIN + g.CONTENT_W, y2: y + 12, grey: 0.55, width: 0.5 });
}

/** The height of one wrapped line inside a row. */
const LINE_H = 9.5;

/**
 * Draw one row, and the hairline under it.
 *
 * `index` drives the banding: every other row carries a whisper of grey, which
 * is what keeps a 40-row statement readable across a landscape page without
 * turning it into a grid of rules.
 */
function drawRow(
  ops: PdfOp[],
  g: Geo,
  cols: TableCol[],
  X: Record<string, number>,
  row: TableRow,
  y: number,
  index = 0,
): void {
  /* A row's bottom edge depends on how many lines it carries: a wrapped
     narration hangs BELOW its first baseline, so a fixed rule would be drawn
     through the second line and the banding would paint over the row above. */
  const lineCount = Math.max(1, ...row.cells.map((c) => c.lines?.length ?? 1));
  const ruleY = y - (lineCount - 1) * LINE_H - 4.5;
  if (index % 2 === 1) {
    ops.push({ kind: 'rect', x: g.MARGIN, y: ruleY, w: g.CONTENT_W, h: y + 7 - ruleY, grey: 0.977 });
  }
  drawGridLines(ops, g, cols, X, ruleY, y + 7);
  row.cells.forEach((cell, i) => {
    const col = cols[i];
    if (!col) return;
    const size = cell.size ?? 6.5;
    if (cell.lines && cell.lines.length) {
      cell.lines.forEach((line, li) => {
        const fit = fitShrink(line, col.w - 4, size);
        ops.push({
          kind: 'text',
          x: col.align === 'right' ? X[col.key] + col.w - textW(fit.text, fit.size) - 2 : X[col.key] + 2,
          y: y - li * LINE_H,
          size: fit.size,
          bold: cell.bold,
          grey: cell.grey,
          text: fit.text,
        });
      });
      return;
    }
    const fit = fitShrink(cell.text, col.w - 4, size);
    ops.push({
      kind: 'text',
      x: col.align === 'right' ? X[col.key] + col.w - textW(fit.text, fit.size) - 2 : X[col.key] + 2,
      y,
      size: fit.size,
      bold: cell.bold,
      grey: cell.grey,
      text: fit.text,
    });
  });
  ops.push({ kind: 'line', x1: g.MARGIN, y1: ruleY, x2: g.MARGIN + g.CONTENT_W, y2: ruleY, grey: 0.9, width: 0.4 });
}

/**
 * Render a document made of table sections.
 *
 * `drawPageHeader` runs on every page; `drawPageFooter` runs once the page
 * count is known, which is why it is a separate pass — a footer that says
 * "Page 2 of 5" cannot be drawn until there are five pages.
 */
function renderTableSections(
  g: Geo,
  sections: TableSection[],
  drawPageHeader: (ops: PdfOp[], sectionIndex: number, pageInSection: number) => void,
  drawPageFooter: (ops: PdfOp[], pageIndex: number, pageCount: number) => void,
): PageSpec[] {
  const pages: PageSpec[] = [];

  sections.forEach((section, sectionIndex) => {
    if (section.skipIfEmpty && !section.rows.length && !section.preRows?.length) return;
    const { cols, X } = layoutCols(g, section.cols);

    /* Pack the rows into pages by MEASURED height. A row is never split
       across a page break, and a page never runs into the footer. */
    const maxRowNeed = Math.max(
      ROW_H + ROW_GAP,
      ...section.rows.map((r) => (r.height ?? ROW_H) + ROW_GAP),
    );
    const capacity = Math.max(1, Math.floor((section.top - section.bottom) / maxRowNeed));
    const pagesNeeded = Math.max(1, Math.ceil(section.rows.length / capacity));
    const target = Math.max(1, Math.ceil(section.rows.length / pagesNeeded));
    const chunks: TableRow[][] = [];
    let current: TableRow[] = [];
    let y = section.top;
    for (const row of section.rows) {
      const need = (row.height ?? ROW_H) + ROW_GAP;
      if (current.length >= target && current.length) {
        chunks.push(current);
        current = [];
        y = section.top;
      }
      if (y - need < section.bottom && current.length) {
        chunks.push(current);
        current = [];
        y = section.top;
      }
      current.push(row);
      y -= need;
    }
    if (current.length) chunks.push(current);
    if (!chunks.length) chunks.push([]);

    chunks.forEach((rows, pageInSection) => {
      const ops: PdfOp[] = [];
      drawPageHeader(ops, sectionIndex, pageInSection);

      let headY = section.top;
      if (section.heading) headY = section.heading(ops, g, headY, pageInSection > 0);
      drawColumnHeadings(ops, g, cols, X, headY);
      let rowY = headY - 18;

      if (pageInSection === 0 && section.preRows) {
        for (const row of section.preRows) {
          drawRow(ops, g, cols, X, row, rowY);
          rowY -= (row.height ?? ROW_H) + ROW_GAP;
        }
      }

      rows.forEach((row, rowIndex) => {
        drawRow(ops, g, cols, X, row, rowY, rowIndex);
        rowY -= (row.height ?? ROW_H) + ROW_GAP;
      });

      if (pageInSection === chunks.length - 1 && section.totals) {
        section.totals(ops, g, X, cols, rowY);
      }

      pages.push({ ops, geo: g });
    });
  });

  pages.forEach((p, i) => drawPageFooter(p.ops, i, pages.length));
  return pages;
}

/**
 * Build the daily lab report PDF.
 *
 * The production sheet paginates on measured row heights with its header
 * repeated on every page; the per-clinic breakdown gets a page of its own,
 * because a clinic table that starts halfway down a sheet is a table
 * somebody has to hunt for.
 */
export function buildDailyReportPdf(
  rows: DailyReportPdfRow[],
  clinics: DailyReportPdfClinic[],
  meta: DailyReportPdfMeta,
): PdfBuildResult {
  const geoKey = `${meta.paper || 'a4'}-${meta.orientation || 'landscape'}`;
  const g = GEOS[geoKey] || GEOS['a4-landscape'];

  const header = (): DocHeader => ({
    labName: meta.labName,
    title: 'DAILY LAB REPORT',
    meta: [
      { label: 'Period', value: meta.periodLabel },
      { label: 'Generated', value: meta.generatedOn },
    ],
  });
  const footerParts = {
    labName: meta.labName,
    title: 'Daily Lab Report',
    periodLabel: meta.periodLabel,
  };

  const productionCols: TableCol[] = PRODUCTION_COLS.map(([key, label, w, align]) => ({
    key,
    label,
    w,
    align,
  }));
  const clinicCols: TableCol[] = CLINIC_COLS.map(([key, label, w, align]) => ({
    key,
    label,
    w,
    align,
  }));

  /* The production sheet starts lower than the clinic table, because the
     summary band sits above it on the first page. */
  const productionTop = docRuleY(g, 2) - 26 - CARD_H - 22;
  const clinicTop = g.H - 114;

  const sections: TableSection[] = [
    {
      cols: productionCols,
      rows: rows.map((r) => ({
        cells: [
          { text: r.caseNumber, bold: true, grey: 0.25 },
          { text: r.receivedDate },
          { text: r.caseType },
          { text: r.patient },
          { text: r.doctor },
          { text: r.clinic },
          {
            /* A case that went past its delivery date says so, on the row
               itself. The column is narrow, so the marker shrinks with the
               date rather than being cut off. */
            text:
              r.daysLate > 0 ? `${r.deliveryDate} (${r.daysLate}d late)` : r.deliveryDate,
            bold: r.daysLate > 0,
            grey: r.daysLate > 0 ? 0.1 : 0,
          },
          { text: pk(r.fee), bold: true },
        ],
      })),
      top: productionTop,
      bottom: g.CONTENT_BOTTOM + 26,
      heading: (ops, geo, y, continued) => {
        // The summary band is a headline: it belongs to the first page only.
        if (!continued) drawSummaryBand(ops, geo, meta, docRuleY(geo, 2) - 26);
        ops.push({
          kind: 'text', x: geo.MARGIN, y: y + 30, size: 7.5, bold: true, grey: 0.25,
          text: continued ? 'PRODUCTION SHEET (CONT.)' : 'PRODUCTION SHEET',
        });
        // An empty sheet says so, rather than leaving a heading over nothing.
        if (!rows.length) {
          ops.push({
            kind: 'text', x: geo.MARGIN, y: y - 2, size: 8, grey: 0.45,
            text: 'No cases were received in this window.',
          });
        }
        return y + 18;
      },
    },
    {
      cols: clinicCols,
      rows: clinics.map((c) => ({
        cells: [
          { text: c.clinicName, bold: true },
          { text: c.doctor || '—' },
          { text: num(c.casesReceived) },
          { text: num(c.casesDue) },
          { text: pk(c.invoicedValue) },
          { text: pk(c.paidValue) },
          { text: pk(c.outstanding), bold: true },
        ],
      })),
      top: clinicTop,
      bottom: g.CONTENT_BOTTOM + 26,
      skipIfEmpty: true,
      heading: (ops, geo, y) => {
        ops.push({
          kind: 'text', x: geo.MARGIN, y: y + 32, size: 7.5, bold: true, grey: 0.25, text: 'BY CLINIC',
        });
        return y + 18;
      },
      totals: (ops, geo, X, cols, rowEndY) => {
        // Totals for the money columns, so the page can be checked at a glance.
        let y = Math.max(rowEndY - 20, geo.CONTENT_BOTTOM + 26);
        const line = (label: string, value: string) => {
          ops.push({ kind: 'text', x: geo.MARGIN, y, size: 7.5, bold: true, grey: 0.25, text: label });
          ops.push({
            kind: 'text', x: geo.MARGIN + geo.CONTENT_W - textW(value, 7.5) - 2,
            y, size: 7.5, bold: true, text: value,
          });
          y -= 12;
        };
        line('Total invoiced', pk(clinics.reduce((s, c) => s + c.invoicedValue, 0)));
        line('Total paid', pk(clinics.reduce((s, c) => s + c.paidValue, 0)));
        line('Total outstanding', pk(clinics.reduce((s, c) => s + c.outstanding, 0)));
        void X;
        void cols;
      },
    },
  ];

  const pages = renderTableSections(
    g,
    sections,
    (ops) => {
      drawDocHeader(ops, g, header());
    },
    (ops, i, total) => {
      drawDocFooter(ops, g, footerParts, i + 1, total);
    },
  );

  return assemblePdf(pages);
}

/* ---------- monthly statement ---------- */

/**
 * The columns of a statement, as the printer needs them.
 *
 * The caller supplies them — the screen, the PDF and the workbook all read
 * the same declaration, so the headings on paper are the headings on screen
 * and a column cannot be renamed in one place and not the others.
 */
export interface StatementPdfColumn {
  key: string;
  label: string;
  /** Share of the content width. */
  w: number;
  align: 'left' | 'right';
  /** Set in bold: the figures a reader must see. */
  strong?: boolean;
}

export interface MonthlyStatementPdfMeta {
  labName: string;
  /** The months covered, e.g. 'February 2026 — October 2026'. */
  periodLabel: string;
  generatedOn: string;
  /** Which clinics are in scope, e.g. 'All 13 clinics' or '3 of 13 clinics'. */
  scopeLabel: string;
  /**
   * The statement's own figures, printed as a card strip above the table.
   *
   * They arrive as formatted strings because the caller already owns the
   * money formatting; this module must not re-render a figure it was handed.
   */
  summary?: SummaryFigure[];
  paper?: PaperKind;
  orientation?: Orientation;
}

/** One month of the statement, already formatted for print. */
export interface MonthlyStatementPdfMonth {
  /** 'YYYY-MM' */
  month: string;
  /** The month as a title, e.g. 'March 2026'. */
  label: string;
  /** One row per clinic: the clinic name, then the figure for each column. */
  rows: string[][];
  /** The month's totals, in the same shape as a row. */
  totals: string[];
  /** The month's own figures, for the heading: the three a reader wants. */
  headline: { label: string; value: string }[];
}

/**
 * Build the monthly statement PDF.
 *
 * One month per page, because a month IS the unit an operator reads this
 * document in: the clinic rows under a month, and the month's totals under
 * them. A month with more clinics than fit on a page continues onto the
 * next one with its column headings repeated, so no row is ever orphaned
 * under a page it does not belong to.
 *
 * The headings are the ones the screen uses, so the document reads without
 * a key beside it. It used to print twelve ABBREVIATIONS and a legend
 * explaining them, which is a document that has to be read alongside
 * something else.
 */
export function buildMonthlyStatementPdf(
  months: MonthlyStatementPdfMonth[],
  meta: MonthlyStatementPdfMeta,
  columns: StatementPdfColumn[],
): PdfBuildResult {
  const geoKey = `${meta.paper || 'a4'}-${meta.orientation || 'landscape'}`;
  const g = GEOS[geoKey] || GEOS['a4-landscape'];

  const header = (): DocHeader => ({
    labName: meta.labName,
    title: 'MONTHLY STATEMENT',
    meta: [
      { label: 'Period', value: meta.periodLabel },
      { label: 'Clinics', value: meta.scopeLabel },
      { label: 'Generated', value: meta.generatedOn },
    ],
  });
  const footerParts = {
    labName: meta.labName,
    title: 'Monthly Statement',
    periodLabel: meta.periodLabel,
  };

  /* The page's vertical rhythm, measured once: title block, rule, the summary
     strip, the month's band, the column headings, then the rows. Each band is
     given its own space, because a statement that prints its heading across
     its own title is a statement nobody can read. */
  const ruleY = docRuleY(g, 3);
  const summaryTop = ruleY - 30;
  const summaryBottom = summaryTop - CARD_H;
  /* The month band sits between the strip and the headings (56pt of band and
     air), so the table body starts below all of them. A month whose page has
     no strip starts directly under the rule instead — the strip opens the
     document, it does not reserve a hole in every page after it. */
  const firstRowWithStrip = summaryBottom - 66;
  const firstRowY = ruleY - 66;

  const sections: TableSection[] = months.map((month, monthIndex) => ({
    cols: columns.map((c) => ({ key: c.key, label: c.label, w: c.w, align: c.align })),
    rows: month.rows.map((cells) => ({
      cells: cells.map((text, i) => ({
        text,
        bold: columns[i]?.strong,
        grey: columns[i]?.strong ? 0.15 : 0,
      })),
    })),
    top: monthIndex === 0 && meta.summary?.length ? firstRowWithStrip : firstRowY,
    bottom: g.CONTENT_BOTTOM + 26,
    heading: (ops, geo, y, continued) => {
      /* The statement-wide figures open the DOCUMENT, not every month in it:
         the strip belongs to the first sheet only, or the second month's page
         leads with totals that are not its own. */
      if (!continued && monthIndex === 0 && meta.summary?.length) {
        drawSummaryCards(ops, geo, meta.summary, summaryTop);
      }

      /* The month's band: a filled strip with a dark tick at its left edge,
         the month at title weight, and its three figures on the right. The
         strip separates one month's statement from the next on one sheet. */
      const bandY = y + 34;
      const bandH = 24;
      ops.push({ kind: 'rect', x: geo.MARGIN, y: bandY, w: geo.CONTENT_W, h: bandH, grey: 0.95 });
      ops.push({ kind: 'rect', x: geo.MARGIN, y: bandY, w: 3, h: bandH, grey: 0.15 });
      ops.push({
        kind: 'text', x: geo.MARGIN + 10, y: bandY + 9, size: 11, bold: true, grey: 0.1,
        text: fitShrink(
          continued ? `${month.label.toUpperCase()} (CONT.)` : month.label.toUpperCase(),
          geo.CONTENT_W * 0.42,
          11,
        ).text,
      });
      // The month's own figures, on the right of the band.
      let fx = geo.W - geo.MARGIN - 8;
      for (const f of [...month.headline].reverse()) {
        ops.push({
          kind: 'text', x: fx - textW(f.value, 7.5), y: bandY + 9, size: 7.5, bold: true, grey: 0.12,
          text: f.value,
        });
        ops.push({
          kind: 'text', x: fx - textW(f.value, 7.5) - textW(`${f.label}  `, 6.5) - 3, y: bandY + 9,
          size: 6.5, grey: 0.45, text: `${f.label}  `,
        });
        fx -= textW(f.value, 7.5) + textW(`${f.label}  `, 6.5) + 14;
      }
      ops.push({
        kind: 'line', x1: geo.MARGIN, y1: bandY + bandH, x2: geo.W - geo.MARGIN, y2: bandY + bandH,
        grey: 0.55, width: 0.6,
      });
      return y + 18;
    },
    totals: (ops, geo, X, cols, rowEndY) => {
      // The month's totals, boxed with the table, in the columns they belong to.
      const y = rowEndY - 4;
      const right = geo.MARGIN + geo.CONTENT_W;
      ops.push({ kind: 'rect', x: geo.MARGIN, y: y - 8, w: geo.CONTENT_W, h: 19, grey: 0.92 });
      drawGridLines(ops, geo, cols, X, y - 8, y + 11);
      ops.push({ kind: 'line', x1: geo.MARGIN, y1: y + 10, x2: right, y2: y + 10, grey: 0.3, width: 1 });
      ops.push({ kind: 'line', x1: geo.MARGIN, y1: y - 8, x2: right, y2: y - 8, grey: 0.3, width: 1 });
      month.totals.forEach((text, i) => {
        const col = cols[i];
        if (!col) return;
        /* The closing balance is the statement's headline figure, so it is set
           at the table's display weight rather than in the totals' fine print. */
        const size = i === month.totals.length - 1 ? 8 : 6.5;
        ops.push({
          kind: 'text',
          x: col.align === 'right' ? X[col.key] + col.w - textW(text, size) - 2 : X[col.key] + 2,
          y: y + 1, size, bold: true, grey: 0.1, text,
        });
      });
    },
  }));

  const pages = renderTableSections(
    g,
    sections,
    (ops) => {
      drawDocHeader(ops, g, header());
    },
    (ops, i, total) => {
      drawDocFooter(ops, g, footerParts, i + 1, total);
    },
  );

  return assemblePdf(pages);
}
/* ---------- download helper ---------- */

/**
 * Save a PDF. Routed through saveFile so the desktop build writes a real file
 * instead of silently ignoring the Blob download; the web path is unchanged.
 *
 * Returns the result rather than swallowing it. It used to be `void
 * saveFile(...)`, which discarded the promise: a failed export produced no
 * file, no message, and nothing in the console — the operator's only evidence
 * that "Download" did not work was the file not appearing. `GeneralLedgerView`
 * now reports the outcome.
 */
export async function downloadPdf(
  filename: string,
  pdf: string,
  /** Labels the file type in the chooser, so the window reads correctly. */
  dialogTitle: string = 'Save PDF',
): Promise<import('./saveFile').SaveFileResult> {
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  /* The PDF's own offsets are byte offsets computed from character counts.
     If the two disagree the file is structurally broken — the reader cannot
     find the xref table — and the only symptom is "there was an error
     loading the document". So the check happens here, at the last point
     before the bytes leave for disk, and it fails loudly rather than
     saving a document that cannot be opened. */
  const utf8Length = new TextEncoder().encode(pdf).length;
  if (utf8Length !== pdf.length) {
    throw new Error(
      `The report is ${pdf.length} characters but ${utf8Length} bytes. ` +
        'Its page offsets would be wrong, so it was not saved.'
    );
  }
  return saveFile(filename, bytes, {
    extension: '.pdf',
    mimeType: 'application/pdf',
    dialogTitle,
  });
}
