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

/**
 * A document colour, as either a grey level or an RGB triple.
 *
 * Grey is enough for rules and table furniture; the report's section
 * headings need the one spot of navy that makes the page read as a prepared
 * document rather than a screen dump. `rgb` wins when both are present.
 */
export interface PdfColor {
  /** 0–1 grey fill/stroke; omit for black. */
  grey?: number;
  /** 0–1 RGB fill/stroke. */
  rgb?: [number, number, number];
}
export interface PdfText extends PdfColor {
  kind: 'text';
  x: number;
  y: number;
  size: number;
  bold?: boolean;
  text: string;
}
export interface PdfLine extends PdfColor {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width?: number;
}
export interface PdfRectFill extends PdfColor {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
}
/** A rectangle OUTLINE — the ruled edge of a box, the frame around a band. */
export interface PdfRectStroke extends PdfColor {
  kind: 'rectStroke';
  x: number;
  y: number;
  w: number;
  h: number;
  width?: number;
}
export type PdfOp = PdfText | PdfLine | PdfRectFill | PdfRectStroke;

/** `r g b rg` for a fill, `g g` for a grey. */
const fillColor = (op: PdfColor): string =>
  op.rgb
    ? `${r3(op.rgb[0])} ${r3(op.rgb[1])} ${r3(op.rgb[2])} rg`
    : `${op.grey ?? 0} g`;
/** `r g b RG` for a stroke, `g G` for a grey. */
const strokeColor = (op: PdfColor): string =>
  op.rgb
    ? `${r3(op.rgb[0])} ${r3(op.rgb[1])} ${r3(op.rgb[2])} RG`
    : `${op.grey ?? 0} G`;

const opContent = (op: PdfOp): string => {
  if (op.kind === 'text') {
    const font = op.bold ? '/F2' : '/F1';
    // Fill colour MUST be set on every text op: PDF fill colour persists
    // across operators, so a text op without one inherits the last fill (e.g.
    // the table header's grey band) and prints near-invisible on white paper.
    return `BT ${fillColor(op)} ${font} ${op.size} Tf 1 0 0 1 ${r1(op.x)} ${r1(op.y)} Tm (${esc(op.text)}) Tj ET`;
  }
  if (op.kind === 'rect') {
    return `${fillColor(op)} ${r1(op.x)} ${r1(op.y)} ${r1(op.w)} ${r1(op.h)} re f`;
  }
  if (op.kind === 'rectStroke') {
    return `${strokeColor(op)} ${r1(op.width ?? 0.5)} w ${r1(op.x)} ${r1(op.y)} ${r1(op.w)} ${r1(op.h)} re S`;
  }
  const w = op.width ?? 0.75;
  return `${strokeColor(op)} ${r1(w)} w ${r1(op.x1)} ${r1(op.y1)} m ${r1(op.x2)} ${r1(op.y2)} l S`;
};

const r1 = (n: number) => (Math.round(n * 10) / 10).toString();
/** RGB components need finer resolution than a grey level. */
const r3 = (n: number) => (Math.round(n * 1000) / 1000).toString();

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
  /** The account's classification (e.g. 'Accounts Receivable (Dental Clinics)'). */
  accountClass?: string;
  paper?: PaperKind;
  orientation?: Orientation;
  openingBalance: number;
  totalDebits: number;
  totalCredits: number;
  closingBalance: number;
  transactionCount: number;
  generatedOn: string; // YYYY-MM-DD
  /**
   * The statement's brought-forward opening position. When set (and > 0) a
   * BRIEF line above the table states it, so the Account Summary's
   * Opening Balance and the first row's closing balance read as one balance,
   * not two different figures.
   */
  openingRows?: Array<{ date: string; typeLabel?: string; amount: number }>;
}

const pk = (n: number) => `PKR ${(n || 0).toLocaleString('en-US')}`;
const num = (n: number) => (n || 0).toLocaleString('en-US');

/** A ledger balance always states its side: a negative balance is a credit,
 *  a positive one (or zero) a debit. The operator reads the column straight
 *  down without having to infer the side from a sign. */
const bal = (n: number): string => `${num(Math.abs(n))} ${n < 0 ? 'Cr' : 'Dr'}`;

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

/**
 * Auto-orientation, per document: a ledger statement is seven narrow columns
 * with long descriptions, so landscape is what gives the DESCRIPTION column
 * the width an accountant reads without horizontal scrolling — the daily
 * report is portrait, and the two are not forced onto one canvas because they
 * have different shapes (Part 8: "do not force both report types into the
 * same orientation").
 */
export const chooseOrientation = (meta: LedgerPdfMeta): Orientation => {
  if (meta.orientation) return meta.orientation;
  return 'landscape';
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
  /* Landscape gives the DESCRIPTION column ~355pt: enough width for the
     narration's facts on their own lines without small, unreadable type.
     The money columns are roomy but not wasteful — a figure like
     "1,000,000.00 Dr" at 7.5pt still fits at 59pt. */
  const weights: Record<string, number> = {
    date: 0.088, case: 0.116, type: 0.108, narr: 0.462,
    debit: 0.076, credit: 0.076, close: 0.074,
  };
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

/**
 * Build the General Ledger statement PDF.
 *
 * One document: letterhead (company, GENERAL LEDGER, account facts), then a
 * RULED DESCRIPTION column where each entry carries its heading plus its
 * secondary facts (patient, teeth, shade, procedure) as subordinate lines,
 * three money columns, then on the last page: the grand-total band, the
 * four-field Account Summary and the accounting disclaimer — under which the
 * footer carries the generation date and "Page N of M".
 */
export function buildLedgerPdf(
  entries: LedgerPdfEntry[],
  meta: LedgerPdfMeta,
): PdfBuildResult {
  const orientation = chooseOrientation(meta);
  const geoKey = `${meta.paper || 'a4'}-${orientation}`;
  const g = GEOS[geoKey] || GEOS['a4-portrait'];
  const planned = planColumns(g);

  /* Compose each entry: a heading plus its facts as subordinate lines. The
     row is pre-wrapped by the caller, so its height accounts for the wrap and
     a page break never splits a parent/facts pair (Part 5.3). */
  const ACCT_LINE_H = 9.2; // secondary facts
  const HEAD_H = 7.4;      // primary heading
  const factsOf = (e: LedgerPdfEntry): string[] =>
    String(e.narration || '')
      .split('\u2022')
      .map((p) => p.trim())
      .filter(Boolean);
  const rows = entries.map((e) => {
    const facts = factsOf(e);
    const heading = facts.shift() || (e.typeLabel ? `${e.typeLabel}` : '');
    const lines = [heading, ...facts].filter(Boolean);
    const h = Math.max(16, lines.length * ACCT_LINE_H + 6);
    const cells: TableCell[] = [
      { text: e.date, size: 7 },
      { text: e.caseNumber, bold: !!e.caseNumber, grey: e.caseNumber ? 0.3 : 0, size: 7 },
      { text: e.typeLabel, size: 7 },
      {
        text: '', lines, size: 6.6, grey: 0.42,
        lineStyles: lines.map((_, li) =>
          li === 0 ? { size: HEAD_H, bold: true, grey: 0.14 } : { size: ACCT_LINE_H, grey: 0.42 }),
      },
      { text: e.debit ? num(e.debit) : '\u2013', size: 7 },
      { text: e.credit ? num(e.credit) : '\u2013', size: 7 },
      { text: bal(e.closing), bold: true, size: 7 },
    ];
    return { e, h, debit: e.debit || 0, credit: e.credit || 0, cells };
  });

  const right = g.W - g.MARGIN;

  /* ── statement facts (letterhead) ──
     The account (clinic) is stated as the document's identity: on the right of
     the company heading as a two-column facts strip, and prominent enough that
     it reads as the statement is about THIS account, not "a ledger". */
  const drawStatementBand = (ops: PdfOp[]): void => {
    const lX = g.MARGIN + 8;
    const rX = right - 300;
    ops.push({ kind: 'line', x1: g.MARGIN + 30, y1: g.H - 22, x2: right - 30, y2: g.H - 22, grey: 0.25, width: 0.4 });
    ops.push({ kind: 'line', x1: rX, y1: g.H - 36, x2: rX, y2: g.H - 26, grey: 0.35, width: 0.4 });
    // Left: what the statement is FOR — statement for + account identity.
    ops.push({ kind: 'text', x: lX, y: g.H - 34, size: 5.8, bold: true, grey: 0.3, text: 'STATEMENT FOR' });
    ops.push({ kind: 'text', x: lX, y: g.H - 49, size: 13.5, bold: true, grey: 0.12, text: fitShrink(meta.clinicLabel || '', 300, 13.5).text });
    ops.push({ kind: 'text', x: lX + 2, y: g.H - 53, size: 7.2, grey: 0.35, text: fitShrink(`Account: ${[meta.accountCode ? `${meta.accountCode} \u00b7 ` : '', meta.accountName || 'Accounts Receivable'].join('')}`, 230, 7.2).text });
    // Right: report period + currency.
    ops.push({ kind: 'text', x: rX + 6, y: g.H - 36, size: 5.8, bold: true, grey: 0.3, text: 'REPORT PERIOD' });
    ops.push({ kind: 'text', x: rX, y: g.H - 43, size: 7.6, grey: 0.08, text: fitShrink(meta.periodLabel, 320, 7.6).text });
    ops.push({ kind: 'text', x: rX + 120, y: g.H - 36, size: 5.8, bold: true, grey: 0.3, text: 'CURRENCY' });
    ops.push({ kind: 'text', x: rX + 132, y: g.H - 43, size: 7.6, bold: true, grey: 0.08, text: fitShrink('PKR', 60, 7.6).text });
  };

  const ruleY = g.H - 62;
  const sectionLabelY = ruleY - 24;
  const tableHeadY = ruleY - 42;
  const firstRowY = tableHeadY - 18;

  const drawHeader = (ops: PdfOp[]): void => {
    const titleW = (right - g.MARGIN) * 0.42;
    ops.push({ kind: 'rect', x: g.MARGIN, y: g.H - 20, w: g.CONTENT_W, h: 2.5, grey: 0.12 });
    ops.push({ kind: 'text', x: g.MARGIN, y: g.H - 34, size: 9, bold: true, grey: 0.3, text: fitShrink(meta.labName, titleW, 9).text });
    ops.push({ kind: 'text', x: g.MARGIN, y: g.H - 58, size: 18, bold: true, grey: 0.08, text: fitShrink('GENERAL LEDGER', titleW, 18).text });
    ops.push({ kind: 'text', x: g.MARGIN, y: g.H - 74, size: 7, grey: 0.4, text: fitShrink(meta.caseFilterLabel ? `Filtered to cases matching "${meta.caseFilterLabel}"` : 'Account statement and transaction details', titleW, 7).text });
    drawStatementBand(ops);
    ops.push({ kind: 'line', x1: g.MARGIN, y1: ruleY, x2: right, y2: ruleY, grey: 0.35, width: 0.9 });
  };

  /* Continuation pages: a compact identity line — no repeated letterhead. */
  const compactTableHeadY = g.H - 60;
  const drawCompactHeader = (ops: PdfOp[]): void => {
    ops.push({ kind: 'line', x1: g.MARGIN, y1: g.H - 16, x2: right, y2: g.H - 16, grey: 0.25, width: 0.5 });
    ops.push({ kind: 'text', x: g.MARGIN, y: g.H - 30, size: 11, bold: true, grey: 0.1, text: fitShrink('GENERAL LEDGER', g.CONTENT_W - 230, 11).text });
    ops.push({ kind: 'text', x: g.MARGIN + 105, y: g.H - 30, size: 7.5, grey: 0.35, text: fitShrink(`${meta.labName}  ·  ${meta.accountName || 'Accounts Receivable'}  ·  ${meta.periodLabel}`, g.CONTENT_W - 110, 7.5).text });
  };

  /* ── one table section ── */
  const openedRows = (meta.openingRows || []).filter((r) => r.amount !== 0);
  const section: TableSection = {
    cols: planned.cols,
    rows: rows.map((r) => ({ cells: r.cells, height: r.h, debit: r.debit, credit: r.credit })),
    top: firstRowY,
    continuationTop: compactTableHeadY - 18,
    bottom: g.CONTENT_BOTTOM + 26,
    heading: (ops, geo, _y, continued) => {
      if (!continued) {
        ops.push({ kind: 'text', x: geo.MARGIN, y: sectionLabelY, size: 8, bold: true, grey: 0.2, text: 'TRANSACTION DETAILS' });
        return tableHeadY;
      }
      return compactTableHeadY;
    },
    /* Brought-forward line on the first page only. It is a balance, not a
       transaction: the caller folded the opening posting into
       meta.openingBalance, so the number shown here is where the table starts. */
    preRows: openedRows.length
      ? [{ cells: [
          { text: openedRows[0].date, size: 7 },
          { text: '', size: 7 },
          { text: openedRows[0].typeLabel || 'Opening balance', bold: true, size: 7 },
          { text: `Balance ${openedRows.map((r) => bal(r.amount)).join('; ')}`, size: 6.5 },
          { text: '\u2013', size: 7 },
          { text: '\u2013', size: 7 },
          { text: bal(openedRows.reduce((s, r) => s + r.amount, 0)), bold: true, size: 7 },
        ] }]
      : undefined,
    /* Per-page footer of the ACTUAL movements on that page — never another
       page's rows, and never a closing balance (that lives in the summary). */
    pageStrip: (ops, geo, X, cols, y, pageRows) => {
      let d = 0; let c = 0;
      pageRows.forEach((r) => { d += r.debit || 0; c += r.credit || 0; });
      const top = y;
      const bottom = y + 20;
      ops.push({ kind: 'rect', x: geo.MARGIN, y: bottom, w: geo.CONTENT_W, h: top - bottom, grey: 0.94 });
      ops.push({ kind: 'line', x1: geo.MARGIN, y1: top, x2: right, y2: top, grey: 0.5, width: 0.5 });
      ops.push({ kind: 'line', x1: geo.MARGIN, y1: bottom, x2: right, y2: bottom, grey: 0.5, width: 0.5 });
      const narrC = cols.find((col) => col.key === 'narr')!;
      ops.push({ kind: 'text', x: X[narrC.key] + 2, y: top + 1.5, size: 6.5, bold: true, grey: 0.15, text: 'PAGE TOTAL' });
      const dCol = cols.find((col) => col.key === 'debit')!;
      const cCol = cols.find((col) => col.key === 'credit')!;
      ops.push({ kind: 'text', x: X[dCol.key] + dCol.w - textW(num(d), 7) - 2, y: top + 1.5, size: 7, bold: true, grey: 0.15, text: num(d) });
      ops.push({ kind: 'text', x: X[cCol.key] + cCol.w - textW(num(c), 7) - 2, y: top + 1.5, size: 7, bold: true, grey: 0.15, text: num(c) });
    },
    /* The Grand Total band + Account Summary + accounting disclaimer: the
       financial conclusion of the statement. */
    totals: (ops, geo, X, cols, rowEndY, rowCount) => {
      const tY = rowEndY - 2;
      const bY = tY - 18;
      // ─ Grand total band ─
      ops.push({ kind: 'rect', x: geo.MARGIN, y: bY, w: geo.CONTENT_W, h: 18, grey: 0.92 });
      ops.push({ kind: 'line', x1: geo.MARGIN, y1: tY, x2: right, y2: tY, grey: 0.35, width: 0.5 });
      ops.push({ kind: 'line', x1: geo.MARGIN, y1: bY, x2: right, y2: bY, grey: 0.5, width: 0.4 });
      const narrC = cols.find((col) => col.key === 'narr')!;
      ops.push({ kind: 'text', x: geo.MARGIN + X[narrC.key] + 2, y: tY + 3, size: 6.8, bold: true, grey: 0.14, text: fitShrink(`TOTAL — ${rowCount} transactions`, cols[2].w - 20, 6.8).text });
      const dCol = cols.find((col) => col.key === 'debit')!;
      const cCol = cols.find((col) => col.key === 'credit')!;
      ops.push({ kind: 'text', x: X[dCol.key] + dCol.w - textW(num(meta.totalDebits), 7) - 2, y: tY + 3, size: 7, bold: true, grey: 0.12, text: num(meta.totalDebits) });
      ops.push({ kind: 'text', x: X[cCol.key] + cCol.w - textW(num(meta.totalCredits), 7) - 2, y: tY + 3, size: 7, bold: true, grey: 0.12, text: num(meta.totalCredits) });
      // ─ Account summary: four fields, compact table ─
      const shTop = tY - 27;
      const frmTop = shTop - 3;
      const frmBot = frmTop - 40;
      ops.push({ kind: 'text', x: geo.MARGIN, y: shTop, size: 6.5, bold: true, grey: 0.25, text: 'ACCOUNT SUMMARY' });
      const bandX = [geo.MARGIN, geo.MARGIN + geo.CONTENT_W / 4, geo.MARGIN + 2 * geo.CONTENT_W / 4, geo.MARGIN + 3 * geo.CONTENT_W / 4, right];
      const putLabel = (i: number, label: string, yBase: number) =>
        ops.push({ kind: 'text', x: bandX[i] + 2, y: yBase, size: 5.8, bold: true, grey: 0.3, text: fitShrink(label, bandX[i + 1] - bandX[i] - 10, 5.8).text });
      const putValue = (i: number, text: string, yBase: number) => {
        const f = fitShrink(text, bandX[i + 1] - bandX[i] - 10, 7);
        ops.push({ kind: 'text', x: bandX[i + 1] - textW(f.text, f.size) - 4, y: yBase, size: f.size, bold: true, grey: 0.1, text: f.text });
      };
      ops.push({ kind: 'rect', x: geo.MARGIN, y: frmBot, w: geo.CONTENT_W, h: 20, grey: 0.97 });
      putLabel(0, 'OPENING BALANCE', frmBot + 14);
      putLabel(1, 'TOTAL DEBITS', frmBot + 14);
      putLabel(2, 'TOTAL CREDITS', frmBot + 14);
      putLabel(3, 'CLOSING BALANCE', frmBot + 14);
      ops.push({ kind: 'line', x1: geo.MARGIN, y1: frmBot + 2, x2: right, y2: frmBot + 2, grey: 0.45, width: 0.5 });
      const yVals = frmBot + 8;
      putValue(0, meta.openingBalance ? bal(meta.openingBalance) : '—', yVals);
      putValue(1, num(meta.totalDebits), yVals);
      putValue(2, num(meta.totalCredits), yVals);
      putValue(3, bal(meta.closingBalance), yVals);
      // ─ Disclaimer ─
      ops.push({ kind: 'text', x: geo.MARGIN, y: frmBot - 8, size: 6.2, grey: 0.5, text: fitShrink('This is a computer-generated account statement. Please verify the entries against the clinic\'s records.', geo.CONTENT_W, 6.2).text });
    },
  };

  const pages = renderTableSections(
    g,
    [section],
    (ops, _sectionIndex, pageInSection) => {
      if (pageInSection === 0) drawHeader(ops);
      else drawCompactHeader(ops);
    },
    (ops, i, total) => {
      ops.push({ kind: 'line', x1: g.MARGIN, y1: g.FOOTER_Y + 13, x2: right, y2: g.FOOTER_Y + 13, grey: 0.7, width: 0.4 });
      ops.push({ kind: 'text', x: g.MARGIN, y: g.FOOTER_Y, size: 6.5, grey: 0.45, text: fitShrink(`${meta.labName} — General Ledger — ${meta.periodLabel}`, g.CONTENT_W - 220, 6.5).text });
      const pg = `Page ${i + 1} of ${total}`;
      ops.push({ kind: 'text', x: right - textW(pg, 6.5), y: g.FOOTER_Y, size: 6.5, grey: 0.45, text: pg });
      const gen = `Generated ${meta.generatedOn}`;
      ops.push({ kind: 'text', x: right - textW(pg, 6.5) - textW(gen, 6.5) - 12, y: g.FOOTER_Y, size: 6.5, grey: 0.45, text: gen });
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
  /** Teeth (FDI numbers) shown when the operator included teeth. */ teeth?: string;
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
  /**
   * The window's operational figures, printed as a compact table.
   *
   * They are counted by the report builder, not here: this module formats
   * figures, it does not decide what counts as an open or overdue case.
   */
  production: {
    casesReceived: number;
    unitsReceived: number;
    casesDue: number;
    openCases: number;
    overdueCases: number;
    clinics: number;
  };
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
  ['teeth', 'TEETH', 0.1, 'left'],
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

/* ---------- document summary tables ---------- */

/** The one spot of colour on the page: the navy of a section heading. */
const NAVY: [number, number, number] = [0.09, 0.15, 0.27];
const INK: [number, number, number] = [0.07, 0.08, 0.1];

/** Height of one data row in a summary table. */
const SUMMARY_ROW_H = 15;

/**
 * A section's title: navy caps over a hairline, with an optional right-hand
 * fact. This is the replacement for the card strip the daily report used to
 * open with — a heading a reader scans, not a dashboard tile.
 */
function drawSectionHeading(
  ops: PdfOp[],
  x: number,
  y: number,
  w: number,
  title: string,
  right?: string,
): void {
  const fit = fitShrink(title.toUpperCase(), w - (right ? 150 : 0), 8);
  ops.push({ kind: 'text', x, y, size: fit.size, bold: true, rgb: NAVY, text: fit.text });
  if (right) {
    const rf = fitShrink(right, 140, 6.5);
    ops.push({
      kind: 'text',
      x: x + w - textW(rf.text, rf.size),
      y: y + 0.5,
      size: rf.size,
      grey: 0.42,
      text: rf.text,
    });
  }
  ops.push({ kind: 'line', x1: x, y1: y - 6, x2: x + w, y2: y - 6, grey: 0.7, width: 0.5 });
}

interface SummaryColumn {
  label: string;
  /** Share of the block's width. */
  w: number;
  align: 'left' | 'right';
  /** Set the figures bold: the columns a reader must see. */
  strong?: boolean;
}

/**
 * A ruled summary table: column labels, figures and hairlines between rows.
 *
 * This is the document form of a figure block — no fill, no border, no card.
 * The figures live in their own right-aligned columns, so a table of them
 * reads straight down the page instead of as three boxes to compare.
 *
 * Returns the y of the bottom rule.
 */
function drawSummaryTable(
  ops: PdfOp[],
  x: number,
  top: number,
  width: number,
  columns: SummaryColumn[],
  rows: string[][],
  note?: string,
): number {
  const sum = columns.reduce((s, c) => s + c.w, 0) || 1;
  const widths = columns.map((c) => Math.floor((c.w / sum) * width));
  const xs: number[] = [];
  let acc = x;
  for (const w of widths) {
    xs.push(acc);
    acc += w;
  }

  columns.forEach((c, i) => {
    const fit = fitShrink(c.label.toUpperCase(), widths[i] - 8, 6);
    ops.push({
      kind: 'text',
      x: c.align === 'right' ? xs[i] + widths[i] - textW(fit.text, fit.size) - 6 : xs[i] + (i === 0 ? 0 : 8),
      y: top,
      size: fit.size,
      bold: true,
      grey: 0.45,
      text: fit.text,
    });
  });
  ops.push({ kind: 'line', x1: x, y1: top - 5, x2: x + width, y2: top - 5, grey: 0.5, width: 0.6 });

  let y = top - 20;
  rows.forEach((row) => {
    columns.forEach((c, i) => {
      const value = row[i] ?? '';
      const fit = fitShrink(value, widths[i] - 8, 7);
      const px = c.align === 'right'
        ? xs[i] + widths[i] - textW(fit.text, fit.size) - 6
        : xs[i] + (i === 0 ? 0 : 8);
      ops.push({
        kind: 'text',
        x: px,
        y,
        size: fit.size,
        bold: !!c.strong,
        ...(c.strong ? { rgb: INK } : { grey: 0.25 }),
        text: fit.text,
      });
    });
    ops.push({ kind: 'line', x1: x, y1: y - 5.5, x2: x + width, y2: y - 5.5, grey: 0.86, width: 0.35 });
    y -= SUMMARY_ROW_H;
  });

  const bottom = y + SUMMARY_ROW_H - 5.5;
  if (note) {
    const fit = fitShrink(note, width, 6);
    ops.push({ kind: 'text', x, y: bottom - 9, size: fit.size, grey: 0.5, text: fit.text });
  }
  return bottom;
}

/** The window's operational figures, as a compact table across the page. */
function drawProductionSummary(
  ops: PdfOp[],
  meta: DailyReportPdfMeta,
  x: number,
  y: number,
  w: number,
): number {
  drawSectionHeading(ops, x, y, w, 'Production summary');
  const p = meta.production;
  return drawSummaryTable(
    ops,
    x,
    y - 20,
    w,
    [
      { label: 'Measure', w: 0.2, align: 'left' },
      { label: 'Count', w: 0.13, align: 'right', strong: true },
      { label: 'Measure', w: 0.2, align: 'left' },
      { label: 'Count', w: 0.13, align: 'right', strong: true },
      { label: 'Measure', w: 0.2, align: 'left' },
      { label: 'Count', w: 0.14, align: 'right', strong: true },
    ],
    [
      ['Cases received', num(p.casesReceived), 'Units received', num(p.unitsReceived), 'Clinics', num(p.clinics)],
      ['Deliveries due', num(p.casesDue), 'Open cases', num(p.openCases), 'Overdue cases', num(p.overdueCases)],
    ],
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

/* ---------- ledger letterhead blocks ---------- */

/** Height of one statement-info row. */
/**
 * The account summary under a ledger's totals: four figures, a closing line,
 * and the note that says what the document is.
 *
 * This is the page's conclusion, not a headline: the reader arrives at it
 * after the transactions, which is the order an accountant checks them in.
 */

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
   * Optional styling of a wrapped cell's lines: [0] is the heading, the rest
   * are the subordinate facts. Used by documents whose lines are prose, not
   * identifiers — the ledger gives its narration lines a smaller size and
   * lighter ink than the leading line.
   */
  lineStyles?: Array<{ size?: number; bold?: boolean; grey?: number }>;
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
  /** Numeric debit/credit for per-page subtotal strips (ledger statements). */
  debit?: number;
  credit?: number;
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
  /**
   * Drawn after the section's last row on its last page.
   *
   * `rowCount` is the number of rows in the whole section, not the page — a
   * totals line that says "(32 transactions)" is describing the statement,
   * not the sheet it happens to sit on.
   */
  totals?: (
    ops: PdfOp[],
    g: Geo,
    X: Record<string, number>,
    cols: TableCol[],
    y: number,
    rowCount: number,
  ) => void;
  /**
   * Drawn after the rows on EVERY page — a per-page debit/credit subtotal
   * strip. Receives that page's rows so each sheet carries its own totals.
   */
  pageStrip?: (
    ops: PdfOp[],
    g: Geo,
    X: Record<string, number>,
    cols: TableCol[],
    y: number,
    pageRows: TableRow[],
  ) => void;
  /** Where the first row starts. */
  top: number;
  /**
   * Where rows start on pages AFTER the first.
   *
   * A section whose first page carries a summary block has less room for
   * rows than its continuation pages do. Without this, every continuation
   * page would reserve the summary's space again and print a third fewer
   * rows than it could. Defaults to `top`.
   */
  continuationTop?: number;
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
 * Vertical column rules for a whole table, drawn ONCE spanning the entire
 * table height (header + rows + strip). Consistent single-weight rules give a
 * clean accounting-table look — unlike per-row boxes, which read as a grid of
 * unrelated cells.
 */
function drawTableVerticals(
  ops: PdfOp[],
  g: Geo,
  cols: TableCol[],
  X: Record<string, number>,
  top: number,
  bottom: number,
): void {
  const right = g.MARGIN + g.CONTENT_W;
  ops.push({ kind: 'line', x1: g.MARGIN, y1: bottom, x2: g.MARGIN, y2: top, grey: 0.45, width: 0.6 });
  ops.push({ kind: 'line', x1: right, y1: bottom, x2: right, y2: top, grey: 0.45, width: 0.6 });
  for (const c of cols.slice(1)) {
    ops.push({ kind: 'line', x1: X[c.key], y1: bottom, x2: X[c.key], y2: top, grey: 0.85, width: 0.35 });
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
  /* One clean rule under the heading band — the table's lid. */
  ops.push({ kind: 'line', x1: g.MARGIN, y1: y - 4, x2: g.MARGIN + g.CONTENT_W, y2: y - 4, grey: 0.45, width: 0.7 });
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
  const lineCount = Math.max(1, ...row.cells.map((c) => c.lines?.length ?? 1));
  const ruleY = y - (lineCount - 1) * LINE_H - 4.5;
  /* Clean accounting table: a whisper of banding on alternate rows and ONE
     hairline under each row. Vertical rules are drawn once for the whole table
     (drawTableVerticals), not repeated per row — repeated per-row boxes are
     what make a statement look like a spreadsheet grid. */
  if (index % 2 === 1) {
    ops.push({ kind: 'rect', x: g.MARGIN, y: ruleY, w: g.CONTENT_W, h: y + 7 - ruleY, grey: 0.977 });
  }
  row.cells.forEach((cell, i) => {
    const col = cols[i];
    if (!col) return;
    const size = cell.size ?? 6.5;
    if (cell.lines && cell.lines.length) {
      cell.lines.forEach((line, li) => {
        const ls = cell.lineStyles?.[li];
        const lsize = ls?.size ?? size;
        const fit = fitShrink(line, col.w - 4, lsize);
        ops.push({
          kind: 'text',
          x: col.align === 'right' ? X[col.key] + col.w - textW(fit.text, fit.size) - 2 : X[col.key] + 2,
          y: y - li * LINE_H,
          size: fit.size,
          bold: ls?.bold ?? cell.bold,
          grey: ls?.grey ?? cell.grey,
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

    /* Pack rows into pages purely by MEASURED HEIGHT — fill each page to the
       footer before breaking. A row is never split and a page never runs into
       the footer. (The old even row-count split used the TALLEST row to pick a
       uniform count, so pages with short rows ended ~40% empty — the wasted
       space seen in multi-page ledgers.) */
    const nextTop = section.continuationTop ?? section.top;
    const chunks: TableRow[][] = [];
    let current: TableRow[] = [];
    let y = section.top;
    for (const row of section.rows) {
      const need = (row.height ?? ROW_H) + ROW_GAP;
      if (y - need < section.bottom && current.length) {
        chunks.push(current);
        current = [];
        y = nextTop;
      }
      current.push(row);
      y -= need;
    }
    if (current.length) chunks.push(current);
    if (!chunks.length) chunks.push([]);

    /* Reserve space on the last page for the totals row and the compact
       account summary + note (≈86 units). Intermediate pages fill to the
       footer; only the last page carries the reserve. Move whole rows from
       the last page to a fresh page until the reserve fits. */
    if (section.totals && chunks.length) {
      let lastChunk = chunks[chunks.length - 1];
      // Continuation pages start at continuationTop, not the first-page top.
      const chunkTop = (i: number) =>
        i === 0 ? section.top : (section.continuationTop ?? section.top);
      let lastY = chunkTop(chunks.length - 1);
      for (const row of lastChunk) lastY -= (row.height ?? ROW_H) + ROW_GAP;
      while (lastY < g.CONTENT_BOTTOM + 112 && lastChunk.length > 1) {
        const movedRow = lastChunk.pop()!;
        chunks.push([movedRow]);
        lastChunk = chunks[chunks.length - 1];
        lastY = chunkTop(chunks.length - 1);
        for (const row of lastChunk) lastY -= (row.height ?? ROW_H) + ROW_GAP;
      }
    }
    chunks.forEach((rows, pageInSection) => {
      const ops: PdfOp[] = [];
      drawPageHeader(ops, sectionIndex, pageInSection);

      let headY = pageInSection === 0 ? section.top : nextTop;
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

      /* Per-page subtotal strip on EVERY page, then a single clean table frame
         around the whole thing (header + rows + strip) — not a box per row. */
      let frameBottom = rowY;
      if (section.pageStrip) {
        section.pageStrip(ops, g, X, cols, frameBottom, rows);
        frameBottom -= 22; // strip height
      }
      drawTableVerticals(ops, g, cols, X, headY - 4, frameBottom);

      if (pageInSection === chunks.length - 1 && section.totals) {
        /* On the final page the grand totals sit just below the page strip. */
        const stripOffset = section.pageStrip ? 26 : 0;
        section.totals(ops, g, X, cols, rowY - stripOffset, section.rows.length);
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

  /* Page one carries the window's operational figures in one compact table
     under the title block. It is a ruled table, not a card strip — the
     production sheet underneath is the document's main event. Continuation
     pages start higher because they have no summary to clear. */
  const summaryTop = docRuleY(g, 2) - 28;
  /* Section rule -> table labels -> two rows -> bottom rule. */
  const summaryBottom = summaryTop - 20 - 20 - (2 - 1) * SUMMARY_ROW_H - 5.5;
  const productionTop = summaryBottom - 50;
  const productionContinuationTop = docRuleY(g, 2) - 48;
  const clinicTop = docRuleY(g, 2) - 56;

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
          { text: r.teeth || '' },
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
      continuationTop: productionContinuationTop,
      bottom: g.CONTENT_BOTTOM + 26,
      heading: (ops, geo, y, continued) => {
        /* The summary is the page's opening argument: first page only. */
        if (!continued) {
          drawProductionSummary(ops, meta, geo.MARGIN, docRuleY(geo, 2) - 28, geo.CONTENT_W);
        }
        const totalFee = rows.reduce((s, r) => s + (r.fee || 0), 0);
        drawSectionHeading(
          ops,
          geo.MARGIN,
          y + 22,
          geo.CONTENT_W,
          continued ? 'Production sheet (continued)' : 'Production sheet',
          `${num(rows.length)} case${rows.length === 1 ? '' : 's'} · ${pk(totalFee)}`,
        );
        // An empty sheet says so, rather than leaving a heading over nothing.
        if (!rows.length) {
          ops.push({
            kind: 'text', x: geo.MARGIN, y: y - 26, size: 8, grey: 0.45,
            text: 'No cases were received in this window.',
          });
        }
        return y;
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
        drawSectionHeading(ops, geo.MARGIN, y + 22, geo.CONTENT_W, 'By clinic');
        return y;
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


/* ---------- daily lab report — compact portrait print ---------- */

/**
 * The operator's column choice for the Daily Lab Report, in print order.
 * The screen's Values dropdown and the PDF read the SAME list, so what the
 * operator ticks on screen is exactly what gets printed.
 */
export interface DailyLabReportColumn {
  key: string;
  label: string;
  /** Share of the content width. */
  w: number;
  align: 'left' | 'right';
}

/** One case row on the printed Daily Lab Report. */
export interface DailyLabReportRow {
  caseNumber: string;
  receivedDate: string;
  deliveryDate: string;
  caseType: string;
  patient: string;
  doctor: string;
  clinic: string;
  status: string;
  /** Formatted units count — blank when the case has none. */
  units: string;
  /** Numeric units, for the TOTAL row. */
  unitsValue?: number;
  /** Formatted FDI teeth — blank when the case has none. */
  teeth: string;
  shade: string;
  /** Formatted PKR fee. */
  fee: string;
  /** Numeric PKR fee, for the TOTAL row. */
  feeValue?: number;
}

export interface DailyLabReportDocMeta {
  labName: string;
  /** The signed-in operator who prepared this sheet. */
  operator: string;
  /** The date window, e.g. '2026-11-23 → 2026-11-23'. */
  periodLabel: string;
  generatedOn: string;
  /** The columns to print, in order — taken from the Values dropdown. */
  columns: DailyLabReportColumn[];
}

/**
 * Compact, portrait A4 Daily Lab Report — one clean table, no summary strip,
 * no per-clinic section, no footer. A letterhead, a ruled section heading and
 * the case rows: the sheet a lab owner reads off the bench and files.
 *
 * Columns are the operator's selection (the Values dropdown), so a field they
 * excluded on screen never appears on paper. Rows paginate on measured height;
 * the column headings repeat on every page.
 */
export function buildDailyLabReportPdf(
  rows: DailyLabReportRow[],
  meta: DailyLabReportDocMeta,
): PdfBuildResult {
  const g = GEOS['a4-portrait'];

  /* A letterhead: top rule, clinic, the report name at display weight, a small
     subtitle, and the three identifying facts in a right-hand column. The
     production table underneath spans the FULL content width — the page's own
     12mm margins are what keep it off the edge, not a narrower table. */
  const header = (): DocHeader => ({
    labName: meta.labName,
    title: 'Daily Lab Report',
    subtitle: ['PRODUCTION REPORT'],
    meta: [
      { label: 'Period', value: meta.periodLabel },
      { label: 'Prepared by', value: meta.operator || '—' },
      { label: 'Generated', value: meta.generatedOn },
    ],
  });

  /* Column shares mirror the sheet's CSS: type 17, patient 13, clinic 35,
     units 9, shade 9, fee 17. layoutCols() normalises them to the page's
     content width, so an operator who ticks other fields still gets a table
     that fits. */
  const WEIGHT: Record<string, number> = {
    caseNumber: 10,
    receivedDate: 10,
    deliveryDate: 10,
    caseType: 17,
    patient: 13,
    doctor: 12,
    clinic: 35,
    status: 10,
    units: 9,
    teeth: 9,
    shade: 9,
    fee: 17,
  };
  const cols: TableCol[] = meta.columns.map((c) => ({
    key: c.key, label: c.label, w: WEIGHT[c.key] ?? 10, align: c.align,
  }));

  const columnCells = (r: DailyLabReportRow): TableCell[] =>
    meta.columns.map((c) => {
      const raw: Record<string, string> = {
        caseNumber: r.caseNumber,
        receivedDate: r.receivedDate,
        deliveryDate: r.deliveryDate,
        caseType: r.caseType,
        patient: r.patient,
        doctor: r.doctor,
        clinic: r.clinic,
        status: r.status,
        units: r.units,
        teeth: r.teeth,
        shade: r.shade,
        fee: r.fee,
      };
      const text = raw[c.key] ?? '';
      const strong = c.key === 'caseNumber' || c.key === 'fee';
      return { text, bold: strong, grey: strong ? 0.18 : 0.12 };
    });

  const totalUnits = rows.reduce((s, r) => s + (r.unitsValue ?? 0), 0);
  const totalFee = rows.reduce((s, r) => s + (r.feeValue ?? 0), 0);

  const sections: TableSection[] = [
    {
      cols,
      rows: rows.map((r) => ({ cells: columnCells(r) })),
      top: docRuleY(g, 3) - 54,
      continuationTop: docRuleY(g, 3) - 34,
      bottom: g.CONTENT_BOTTOM + 26,
      heading: (ops, geo, y, continued) => {
        drawSectionHeading(
          ops,
          geo.MARGIN,
          y + 16,
          geo.CONTENT_W,
          continued ? 'Production sheet (continued)' : 'Production sheet',
          `${num(rows.length)} case${rows.length === 1 ? '' : 's'}`,
        );
        if (!rows.length) {
          ops.push({
            kind: 'text', x: geo.MARGIN, y: y - 8, size: 8, grey: 0.45,
            text: 'No cases were received in this window.',
          });
        }
        return y;
      },
      /* The TOTAL row: a ruled band with the label, the summed units and the
         summed fee — the sheet's own footing, the last thing read before the
         report footer. */
      totals: (ops, geo, X, tcols, rowEndY) => {
        const y = rowEndY - 2;
        ops.push({ kind: 'rect', x: geo.MARGIN, y: y - 8, w: geo.CONTENT_W, h: 19, grey: 0.92 });
        drawGridLines(ops, geo, tcols, X, y - 8, y + 11);
        ops.push({ kind: 'line', x1: geo.MARGIN, y1: y - 8, x2: geo.MARGIN + geo.CONTENT_W, y2: y - 8, grey: 0.45, width: 1.1 });
        ops.push({ kind: 'line', x1: geo.MARGIN, y1: y + 11, x2: geo.MARGIN + geo.CONTENT_W, y2: y + 11, grey: 0.3, width: 1 });
        const first = tcols[0];
        ops.push({ kind: 'text', x: first ? X[first.key] + 2 : geo.MARGIN, y: y + 1, size: 7, bold: true, grey: 0.15, text: 'TOTAL' });
        const unitsCol = tcols.find((c) => c.key === 'units');
        if (unitsCol) {
          const t = num(totalUnits);
          ops.push({ kind: 'text', x: X[unitsCol.key] + unitsCol.w - textW(t, 7) - 2, y: y + 1, size: 7, bold: true, grey: 0.15, text: t });
        }
        const feeCol = tcols.find((c) => c.key === 'fee');
        if (feeCol) {
          const t = pk(totalFee);
          ops.push({ kind: 'text', x: X[feeCol.key] + feeCol.w - textW(t, 7) - 2, y: y + 1, size: 7, bold: true, grey: 0.15, text: t });
        }
      },
    },
  ];

  const pages = renderTableSections(
    g,
    sections,
    (ops) => { drawDocHeader(ops, g, header()); },
    (ops) => {
      const y = g.FOOTER_Y;
      ops.push({ kind: 'line', x1: g.MARGIN, y1: y + 12, x2: g.W - g.MARGIN, y2: y + 12, grey: 0.72, width: 0.4 });
      ops.push({ kind: 'text', x: g.MARGIN, y, size: 6, grey: 0.46, text: fitShrink(meta.labName, g.CONTENT_W * 0.5, 6).text });
      const right = `Daily Lab Report · ${meta.periodLabel}`;
      ops.push({ kind: 'text', x: g.W - g.MARGIN - textW(right, 6), y, size: 6, grey: 0.46, text: right });
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
