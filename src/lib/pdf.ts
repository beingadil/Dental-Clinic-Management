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
export type PdfOp = PdfText | PdfLine | PdfRectFill;

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

/** Assemble a complete PDF from page op-lists. Exact byte offsets via char codes. */
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
    // Page dict pushed first: its own number is objects.length + 1, so the
    // content stream that follows is objects.length + 2.
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.geo.W} ${p.geo.H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${objects.length + 2} 0 R >>`
    );
    push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
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

/** Auto-orientation: many/wide columns → landscape. */
export const chooseOrientation = (meta: LedgerPdfMeta): Orientation => {
  if (meta.orientation) return meta.orientation;
  return meta.caseFilterLabel ? 'portrait' : 'landscape';
};

interface LedgerCol { key: string; label: string; w: number; align: 'left' | 'right' }

/** Column plan fills the full content width; weights adapt to orientation. */
function planColumns(g: Geo): { cols: LedgerCol[]; X: Record<string, number>; tableW: number } {
  const weights: Record<string, number> = {
    date: 0.085, clinic: 0.135, case: 0.105, type: 0.115, narr: 0.35,
    debit: 0.07, credit: 0.07, close: 0.07,
  };
  const raw: [string, string, number, 'left' | 'right'][] = [
    ['date', 'DATE', weights.date, 'left'],
    ['clinic', 'CLINIC', weights.clinic, 'left'],
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

const LHS_KEYS = ['date', 'clinic', 'case', 'type', 'narr'];

function drawTableHeader(
  ops: PdfOp[], g: Geo, cols: LedgerCol[], X: Record<string, number>, y: number,
): void {
  ops.push({ kind: 'rect', x: g.MARGIN, y: y - 4, w: g.CONTENT_W, h: 15, grey: 0.93 });
  for (const c of cols) {
    const label = c.align === 'right'
      ? c.label
      : c.label;
    ops.push({
      kind: 'text',
      x: c.align === 'right' ? X[c.key] + c.w - textW(label, 6.5) : X[c.key] + 2,
      y: y + 5, size: 6.5, bold: true, text: label,
    });
  }
  ops.push({ kind: 'line', x1: g.MARGIN, y1: y - 4, x2: g.MARGIN + g.CONTENT_W, y2: y - 4, grey: 0.35 });
  ops.push({ kind: 'line', x1: g.MARGIN, y1: y - 11, x2: g.MARGIN + g.CONTENT_W, y2: y - 11, grey: 0.35 });
}

function drawFooter(ops: PdfOp[], g: Geo, meta: LedgerPdfMeta, pageNo: number, pageCount: number): void {
  ops.push({ kind: 'line', x1: g.MARGIN, y1: g.FOOTER_Y + 12, x2: g.W - g.MARGIN, y2: g.FOOTER_Y + 12, grey: 0.8, width: 0.5 });
  ops.push({
    kind: 'text', x: g.MARGIN, y: g.FOOTER_Y, size: 6.5, grey: 0.45,
    text: fitShrink(`${meta.labName} — General Ledger — ${meta.clinicLabel} — ${meta.periodLabel}`, g.CONTENT_W - 130, 6.5).text,
  });
  const pg = `Page ${pageNo} of ${pageCount}`;
  ops.push({ kind: 'text', x: g.W - g.MARGIN - textW(pg, 6.5), y: g.FOOTER_Y, size: 6.5, grey: 0.45, text: pg });
}

/** Build the ledger statement PDF. Multi-page, cursor-driven, no overflow. */
export function buildLedgerPdf(
  entries: LedgerPdfEntry[],
  meta: LedgerPdfMeta,
): PdfBuildResult {
  const orientation = chooseOrientation(meta);
  const geoKey = `${meta.paper || 'a4'}-${orientation}`;
  const g = GEOS[geoKey] || GEOS['a4-portrait'];
  const { cols, X } = planColumns(g);
  const colByKey = Object.fromEntries(cols.map((c) => [c.key, c]));
  const narrW = colByKey.narr.w - 4;
  const headH = 15;
  const lineH = 9.5;          // wrapped-line height inside a row
  const rowBase = 15;         // min row height (single line + rule)

  // Pre-wrap every row once so page breaks never split a row.
  const rows = entries.map((e) => {
    const narr = `${e.typeLabel ? `${e.typeLabel} — ` : ''}${e.narration}`;
    const narrLines = wrapText(narr, narrW, 7);
    const ids: Record<string, { text: string; size: number }> = {
      date: fitShrink(e.date, colByKey.date.w - 4, 7),
      clinic: fitShrink(e.clinic, colByKey.clinic.w - 4, 7),
      case: fitShrink(e.caseNumber, colByKey.case.w - 4, 7),
      type: fitShrink(e.typeLabel, colByKey.type.w - 4, 7),
    };
    return { e, narrLines, ids, h: Math.max(rowBase, narrLines.length * lineH + 6) };
  });

  // --- paginate: pack rows into pages by measured height ---
  type Chunk = { startIdx: number; endIdx: number; rows: typeof rows; startWithHeader: boolean };
  const chunks: Chunk[] = [];
  let cur: Chunk = { startIdx: 0, endIdx: 0, rows: [], startWithHeader: true };
  let y = g.TABLE_TOP;
  const pushChunk = () => { if (cur.rows.length) chunks.push(cur); };

  rows.forEach((r, i) => {
    const needed = r.h + 2;
    if (y - needed < g.CONTENT_BOTTOM && cur.rows.length) {
      pushChunk();
      cur = { startIdx: i, endIdx: i, rows: [], startWithHeader: true };
      y = g.TABLE_TOP;
    }
    cur.rows.push(r);
    cur.endIdx = i + 1;
    y -= needed;
  });
  pushChunk();
  if (chunks.length === 0) chunks.push({ startIdx: 0, endIdx: 0, rows: [], startWithHeader: true });
  const pageCount = chunks.length;

  const pages: PageSpec[] = [];

  chunks.forEach((chunk, p) => {
    const ops: PdfOp[] = [];
    const isLast = p === pageCount - 1;

    // ----- header -----
    ops.push({ kind: 'text', x: g.MARGIN, y: g.H - 42, size: 13, bold: true, text: fitShrink(meta.labName, g.CONTENT_W * 0.5, 13).text });
    ops.push({ kind: 'text', x: g.MARGIN, y: g.H - 56, size: 10.5, bold: true, grey: 0.15, text: 'GENERAL LEDGER' });
    // Right-aligned meta block
    const right = g.W - g.MARGIN;
    const metaLine = (label: string, val: string, yy: number) => {
      ops.push({ kind: 'text', x: right - textW(`${label}: ${val}`, 7.5), y: yy, size: 7.5, grey: 0.35, text: `${label}: ${val}` });
    };
    let my = g.H - 42;
    ops.push({ kind: 'text', x: right - textW(meta.generatedOn, 7.5), y: my, size: 7.5, grey: 0.35, text: meta.generatedOn });
    my -= 12;
    const acctLabel = `${meta.accountCode ? `${meta.accountCode} \u00b7 ` : ''}${meta.accountName || 'Accounts Receivable'}`;
    metaLine('Account', acctLabel, my); my -= 12;
    metaLine('Period', meta.periodLabel, my); my -= 12;
    metaLine('Clinic', meta.clinicLabel, my);
    if (meta.caseFilterLabel) { my -= 12; metaLine('Case/Job', meta.caseFilterLabel, my); }
    if (meta.periodLabel === 'All Time') { my -= 12; metaLine('As of', meta.generatedOn, my); }
    // opening balance hint on the header, right under meta
    if (p === 0 && (meta.openingBalance !== 0 || meta.periodLabel !== 'All Time')) {
      my -= 12;
      metaLine('Opening', pk(meta.openingBalance), my);
    }

    // rule under the header — sits below the deepest right-meta line
    ops.push({ kind: 'line', x1: g.MARGIN, y1: my - 6, x2: g.W - g.MARGIN, y2: my - 6, grey: 0.6, width: 0.9 });

    // ----- table header -----
    let y = g.TABLE_TOP;
    drawTableHeader(ops, g, cols, X, y);
    y -= headH + 3;

    // opening balance row on page 1 (statement convention: brought forward)
    if (p === 0 && (meta.openingBalance !== 0 || meta.periodLabel !== 'All Time')) {
      const ob = num(meta.openingBalance);
      ops.push({ kind: 'text', x: X.date + 2, y, size: 7, bold: true, grey: 0.35, text: 'Opening Balance (b/f)' });
      ops.push({ kind: 'text', x: X.close + colByKey.close.w - textW(ob, 7), y, size: 7, bold: true, grey: 0.35, text: ob });
      ops.push({ kind: 'line', x1: g.MARGIN, y1: y - 5, x2: g.MARGIN + g.CONTENT_W, y2: y - 5, grey: 0.85, width: 0.5 });
      y -= rowBase;
    }

    // ----- rows -----
    for (const r of chunk.rows) {
      const { e, narrLines, ids } = r;
      ops.push({ kind: 'text', x: X.date + 2, y, size: ids.date.size, text: ids.date.text });
      ops.push({ kind: 'text', x: X.clinic + 2, y, size: ids.clinic.size, text: ids.clinic.text });
      if (e.caseNumber) {
        const cs = ids.case;
        ops.push({ kind: 'text', x: X.case + 2, y, size: cs.size, bold: true, grey: 0.25, text: cs.text });
      }
      ops.push({ kind: 'text', x: X.type + 2, y, size: ids.type.size, text: ids.type.text });
      narrLines.forEach((ln, li) => {
        ops.push({ kind: 'text', x: X.narr + 2, y: y - li * lineH, size: 7, text: ln });
      });
      const d = e.debit ? num(e.debit) : '';
      const c = e.credit ? num(e.credit) : '';
      const b = num(e.closing);
      if (d) ops.push({ kind: 'text', x: X.debit + colByKey.debit.w - textW(d, 7) - 2, y, size: 7, text: d });
      if (c) ops.push({ kind: 'text', x: X.credit + colByKey.credit.w - textW(c, 7) - 2, y, size: 7, text: c });
      ops.push({ kind: 'text', x: X.close + colByKey.close.w - textW(b, 7) - 2, y, size: 7, bold: true, text: b });
      ops.push({ kind: 'line', x1: g.MARGIN, y1: y - (r.h - rowBase) - 4.5, x2: g.MARGIN + g.CONTENT_W, y2: y - (r.h - rowBase) - 4.5, grey: 0.9, width: 0.4 });
      y -= r.h;
    }

    // ----- totals block (last page) -----
    if (isLast) {
      y -= 10;
      if (y < g.CONTENT_BOTTOM + 20) y = g.CONTENT_BOTTOM + 20;
      const boxW = 250;
      const boxX = g.MARGIN + g.CONTENT_W - boxW;
      ops.push({ kind: 'line', x1: boxX, y1: y + 10, x2: g.MARGIN + g.CONTENT_W, y2: y + 10, grey: 0.35 });
      const line = (label: string, val: string, bold = false, grey = 0) => {
        ops.push({ kind: 'text', x: boxX, y, size: 8, bold, grey, text: label });
        ops.push({ kind: 'text', x: g.MARGIN + g.CONTENT_W - textW(val, 8) - 2, y, size: 8, bold, grey, text: val });
      };
      line('Total Debits', pk(meta.totalDebits)); y -= 13;
      line('Total Credits', pk(meta.totalCredits)); y -= 13;
      line('Closing Balance', pk(meta.closingBalance), true); y -= 13;
      line('Transactions', String(meta.transactionCount ?? 0));
      y -= 16;
      ops.push({ kind: 'text', x: g.MARGIN, y, size: 7, grey: 0.45, text: closingDrCr(meta.closingBalance) });
    }

    drawFooter(ops, g, meta, p + 1, pageCount);
    pages.push({ ops, geo: g });
  });

  return assemblePdf(pages);
}

const closingDrCr = (n: number) =>
  n > 0 ? 'Balance Dr (receivable)' : n < 0 ? 'Balance Cr (advance held)' : 'Fully settled';

/* ---------- download helper ---------- */

export function downloadPdf(filename: string, pdf: string) {
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
