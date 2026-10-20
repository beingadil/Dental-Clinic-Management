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

/** Auto-orientation: many/wide columns → landscape. */
export const chooseOrientation = (meta: LedgerPdfMeta): Orientation => {
  if (meta.orientation) return meta.orientation;
  return meta.caseFilterLabel ? 'portrait' : 'landscape';
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
function planColumns(g: Geo, opts: { scopedToClinic: boolean }): { cols: LedgerCol[]; X: Record<string, number>; tableW: number } {
  const weights: Record<string, number> = {
    date: 0.085, clinic: 0.135, case: 0.105, type: 0.115, narr: 0.35,
    debit: 0.07, credit: 0.07, close: 0.07,
  };
  const raw: [string, string, number, 'left' | 'right'][] = [
    ['date', 'DATE', weights.date, 'left'],
    // Spreading a spread loses the tuple type, so the extra column is built
    // separately and concatenated.
    ...(opts.scopedToClinic
      ? []
      : ([['clinic', 'CLINIC', weights.clinic, 'left']] as [string, string, number, 'left'][])),
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
  /* A single-clinic export names it in the header, so the column is dropped.
     An "All Clinics" export has no clinic in the header and keeps it. */
  const scopedToClinic = !/^all\s+clinics$/i.test((meta.clinicLabel || '').trim());
  const { cols, X } = planColumns(g, { scopedToClinic });
  const colByKey = Object.fromEntries(cols.map((c) => [c.key, c]));
  const narrW = colByKey.narr.w - 4;
  const headH = 15;
  const lineH = 9.5;          // wrapped-line height inside a row
  const rowBase = 15;         // min row height (single line + rule)

  // Pre-wrap every row once so page breaks never split a row.
  const rows = entries.map((e) => {
    /* No typeLabel prefix here. It was rendered into the description as
       "Case Invoice - " while ALSO being the TYPE column, so every row opened
       by naming its own column. The type belongs in the column; the
       description should describe the work. */
    const narr = e.narration || '';
    const narrLines = wrapText(narr, narrW, 7);
    const ids: Record<string, { text: string; size: number }> = {
      date: fitShrink(e.date, colByKey.date.w - 4, 7),
      // Absent when the column is not planned; guarded again at draw time.
      ...(colByKey.clinic ? { clinic: fitShrink(e.clinic, colByKey.clinic.w - 4, 7) } : {}),
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
      if (colByKey.clinic && ids.clinic) {
    ops.push({ kind: 'text', x: X.clinic + 2, y, size: ids.clinic.size, text: ids.clinic.text });
  };
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

interface ReportCol { key: string; label: string; w: number; align: 'left' | 'right' }

function planReportCols(
  g: Geo,
  raw: [string, string, number, 'left' | 'right'][],
): { cols: ReportCol[]; X: Record<string, number> } {
  const sum = raw.reduce((s, r) => s + r[2], 0);
  const cols: ReportCol[] = raw.map(([key, label, w, align]) => ({
    key, label, w: Math.floor((w / sum) * g.CONTENT_W), align,
  }));
  const X: Record<string, number> = {};
  let acc = g.MARGIN;
  for (const c of cols) { X[c.key] = acc; acc += c.w; }
  return { cols, X };
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

/** A label + value, drawn right-aligned inside a column. */
function pushRight(ops: PdfOp[], x: number, w: number, y: number, text: string, size: number, bold = false, grey = 0) {
  ops.push({ kind: 'text', x: x + w - textW(text, size) - 2, y, size, bold, grey, text });
}

/** The money summary band: three figures across the content width. */
function drawSummaryBand(ops: PdfOp[], g: Geo, meta: DailyReportPdfMeta, y: number): number {
  const items: { label: string; value: string; note?: string }[] = [
    {
      label: 'INVOICES RAISED',
      value: pk(meta.invoicedValue),
      note: `${meta.invoicesRaised} invoice${meta.invoicesRaised === 1 ? '' : 's'}`,
    },
    {
      label: 'PAYMENTS RECEIVED',
      value: pk(meta.paidValue),
      note: `${meta.paymentsReceived} payment${meta.paymentsReceived === 1 ? '' : 's'}`,
    },
    { label: 'TOTAL OUTSTANDING', value: pk(meta.totalOutstanding), note: 'Across the whole lab' },
  ];
  const gap = 10;
  const boxW = (g.CONTENT_W - gap * (items.length - 1)) / items.length;
  items.forEach((it, i) => {
    const x = g.MARGIN + i * (boxW + gap);
    ops.push({ kind: 'rect', x, y: y - 30, w: boxW, h: 34, grey: 0.95 });
    ops.push({ kind: 'text', x: x + 6, y: y - 4, size: 6, bold: true, grey: 0.4, text: it.label });
    ops.push({ kind: 'text', x: x + 6, y: y - 16, size: 10, bold: true, text: fitShrink(it.value, boxW - 12, 10).text });
    if (it.note) {
      ops.push({ kind: 'text', x: x + 6, y: y - 26, size: 6, grey: 0.45, text: fitShrink(it.note, boxW - 12, 6).text });
    }
  });
  return y - 30;
}

/** A document's title block, repeated on every page. */
interface DocHeader {
  /** The business issuing the document. */
  labName: string;
  /** The document's own title, in caps. */
  title: string;
  /** Right-hand meta lines, top to bottom. */
  meta: string[];
  /**
   * Lines under the rule — a legend, a scope note.
   *
   * They go UNDER the rule, not beside the title: a full-width line that
   * starts at the left margin runs straight into the right-hand meta block
   * unless it is given a band of its own.
   */
  subtitle?: string[];
}

/** Draws a document's title block. Returns the y of the rule under it. */
function drawDocHeader(ops: PdfOp[], g: Geo, h: DocHeader): number {
  const right = g.W - g.MARGIN;
  ops.push({ kind: 'text', x: g.MARGIN, y: g.H - 42, size: 13, bold: true, text: fitShrink(h.labName, g.CONTENT_W * 0.5, 13).text });
  ops.push({ kind: 'text', x: g.MARGIN, y: g.H - 56, size: 10.5, bold: true, grey: 0.15, text: h.title });
  let my = g.H - 42;
  h.meta.forEach((line) => {
    ops.push({ kind: 'text', x: right - textW(line, 7.5), y: my, size: 7.5, grey: 0.35, text: line });
    my -= 12;
  });
  /* The rule clears the meta block. Two meta lines fit above the rule; a
     third one has to push the rule down, or the rule is drawn through the
     text. */
  const ruleY = g.H - 64 - Math.max(0, h.meta.length - 2) * 12;
  ops.push({ kind: 'line', x1: g.MARGIN, y1: ruleY, x2: right, y2: ruleY, grey: 0.6, width: 0.9 });
  (h.subtitle ?? []).forEach((line, i) => {
    ops.push({
      kind: 'text', x: g.MARGIN, y: ruleY - 10 - i * 9, size: 6.5, grey: 0.4,
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
  ops.push({ kind: 'line', x1: g.MARGIN, y1: g.FOOTER_Y + 12, x2: g.W - g.MARGIN, y2: g.FOOTER_Y + 12, grey: 0.8, width: 0.5 });
  ops.push({
    kind: 'text', x: g.MARGIN, y: g.FOOTER_Y, size: 6.5, grey: 0.45,
    text: fitShrink(`${parts.labName} — ${parts.title} — ${parts.periodLabel}`, g.CONTENT_W - 130, 6.5).text,
  });
  const pg = `Page ${pageNo} of ${pageCount}`;
  ops.push({ kind: 'text', x: g.W - g.MARGIN - textW(pg, 6.5), y: g.FOOTER_Y, size: 6.5, grey: 0.45, text: pg });
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
  const { cols, X } = planReportCols(g, PRODUCTION_COLS);
  const colByKey = Object.fromEntries(cols.map((c) => [c.key, c]));

  const headH = 15;
  const rowH = 14;
  const contentBottom = g.CONTENT_BOTTOM;

  /* The first row's baseline on a given page. Page 1 carries the summary
     band above its table, so it starts lower than the pages that follow.
     The vertical rhythm is the report's own, not the ledger's: the ledger
     carries a tall right-hand meta block, so its table starts low, while
     this report has two meta lines and its content belongs just under the
     rule. A page that opens with 80pt of nothing reads as a mistake. */
  const firstRowY = (pageIndex: number) => (pageIndex === 0 ? g.H - 150 : g.H - 96);

  // Measure every row first, so a page break never splits one.
  const measured = rows.map((r) => {
    const delivery = r.daysLate > 0 ? `${r.deliveryDate} (${r.daysLate}d late)` : r.deliveryDate;
    return {
      r,
      ids: {
        case: fitShrink(r.caseNumber, colByKey.case.w - 4, 7),
        recv: fitShrink(r.receivedDate, colByKey.recv.w - 4, 7),
        type: fitShrink(r.caseType, colByKey.type.w - 4, 7),
        patient: fitShrink(r.patient, colByKey.patient.w - 4, 7),
        doctor: fitShrink(r.doctor, colByKey.doctor.w - 4, 7),
        clinic: fitShrink(r.clinic, colByKey.clinic.w - 4, 7),
        delivery: fitShrink(delivery, colByKey.deliv.w - 4, 7),
      },
    };
  });

  // --- paginate the production sheet ---
  type Chunk = { rows: typeof measured };
  const chunks: Chunk[] = [];
  let cur: Chunk = { rows: [] };
  let y = firstRowY(0);
  measured.forEach((m) => {
    const needed = rowH + 2;
    if (y - needed < contentBottom && cur.rows.length) {
      chunks.push(cur);
      cur = { rows: [] };
      y = firstRowY(chunks.length);
    }
    cur.rows.push(m);
    y -= needed;
  });
  if (cur.rows.length) chunks.push(cur);
  if (chunks.length === 0) chunks.push({ rows: [] });

  // The clinic breakdown is always its own page.
  const clinicPages = clinics.length > 0 ? 1 : 0;
  const pageCount = chunks.length + clinicPages;

  const pages: PageSpec[] = [];

  const header = (): DocHeader => ({
    labName: meta.labName,
    title: 'DAILY LAB REPORT',
    meta: [meta.generatedOn, `Period: ${meta.periodLabel}`],
  });
  const footerParts = {
    labName: meta.labName,
    title: 'Daily Lab Report',
    periodLabel: meta.periodLabel,
  };

  chunks.forEach((chunk, p) => {
    const ops: PdfOp[] = [];
    drawDocHeader(ops, g, header());
    const rowY0 = firstRowY(p);
    let rowY = rowY0;

    // The summary band sits on the first page only, in the space between the
    // rule and the table. The figures are a headline; repeating them on
    // every page would be noise.
    if (p === 0) {
      drawSummaryBand(ops, g, meta, g.H - 76);
      ops.push({
        kind: 'text', x: g.MARGIN, y: rowY0 + 30, size: 7.5, bold: true, grey: 0.25,
        text: 'PRODUCTION SHEET',
      });
    }

    drawTableHeader(ops, g, cols as unknown as LedgerCol[], X, rowY0 + 18);
    rowY -= headH + 3;

    for (const m of chunk.rows) {
      const { r, ids } = m;
      ops.push({ kind: 'text', x: X.case + 2, y: rowY, size: ids.case.size, bold: true, grey: 0.25, text: ids.case.text });
      ops.push({ kind: 'text', x: X.recv + 2, y: rowY, size: ids.recv.size, text: ids.recv.text });
      ops.push({ kind: 'text', x: X.type + 2, y: rowY, size: ids.type.size, text: ids.type.text });
      ops.push({ kind: 'text', x: X.patient + 2, y: rowY, size: ids.patient.size, text: ids.patient.text });
      ops.push({ kind: 'text', x: X.doctor + 2, y: rowY, size: ids.doctor.size, text: ids.doctor.text });
      ops.push({ kind: 'text', x: X.clinic + 2, y: rowY, size: ids.clinic.size, text: ids.clinic.text });
      ops.push({
        kind: 'text', x: X.deliv + 2, y: rowY, size: ids.delivery.size,
        bold: r.daysLate > 0, grey: r.daysLate > 0 ? 0.1 : 0, text: ids.delivery.text,
      });
      pushRight(ops, X.fee, colByKey.fee.w, rowY, pk(r.fee), 7, true);
      ops.push({ kind: 'line', x1: g.MARGIN, y1: rowY - 4.5, x2: g.MARGIN + g.CONTENT_W, y2: rowY - 4.5, grey: 0.9, width: 0.4 });
      rowY -= rowH;
    }

    if (chunk.rows.length === 0) {
      ops.push({ kind: 'text', x: g.MARGIN, y: rowY, size: 8, grey: 0.45, text: 'No cases were received in this window.' });
    } else {
      ops.push({
        kind: 'text', x: g.MARGIN, y: rowY + 4, size: 7, grey: 0.45,
        text: `${chunk.rows.length} case${chunk.rows.length === 1 ? '' : 's'} on this sheet`,
      });
    }

    drawDocFooter(ops, g, footerParts, p + 1, pageCount);
    pages.push({ ops, geo: g });
  });

  // ----- the per-clinic breakdown, on its own page -----
  if (clinics.length > 0) {
    const ops: PdfOp[] = [];
    drawDocHeader(ops, g, header());

    ops.push({
      kind: 'text', x: g.MARGIN, y: g.H - 82, size: 7.5, bold: true, grey: 0.25, text: 'BY CLINIC',
    });

    const cCols = planReportCols(g, CLINIC_COLS);
    const tableHeaderY = g.H - 96;
    drawTableHeader(ops, g, cCols.cols as unknown as LedgerCol[], cCols.X, tableHeaderY);
    let rowY = tableHeaderY - headH - 3;

    for (const c of clinics) {
      const name = fitShrink(c.clinicName, cCols.cols[0].w - 4, 7);
      const doc = fitShrink(c.doctor || '—', cCols.cols[1].w - 4, 7);
      ops.push({ kind: 'text', x: cCols.X.clinic + 2, y: rowY, size: name.size, bold: true, text: name.text });
      ops.push({ kind: 'text', x: cCols.X.doctor + 2, y: rowY, size: doc.size, text: doc.text });
      pushRight(ops, cCols.X.recv, cCols.cols[2].w, rowY, num(c.casesReceived), 7);
      pushRight(ops, cCols.X.due, cCols.cols[3].w, rowY, num(c.casesDue), 7);
      pushRight(ops, cCols.X.invoiced, cCols.cols[4].w, rowY, pk(c.invoicedValue), 7);
      pushRight(ops, cCols.X.paid, cCols.cols[5].w, rowY, pk(c.paidValue), 7);
      pushRight(ops, cCols.X.outstanding, cCols.cols[6].w, rowY, pk(c.outstanding), 7, true);
      ops.push({ kind: 'line', x1: g.MARGIN, y1: rowY - 4.5, x2: g.MARGIN + g.CONTENT_W, y2: rowY - 4.5, grey: 0.9, width: 0.4 });
      rowY -= rowH;
    }

    // Totals for the money columns, so the page can be checked at a glance.
    rowY -= 12;
    const tot = (label: string, value: string) => {
      ops.push({ kind: 'text', x: g.MARGIN, y: rowY, size: 7.5, bold: true, grey: 0.25, text: label });
      ops.push({
        kind: 'text', x: g.MARGIN + g.CONTENT_W - textW(value, 7.5) - 2,
        y: rowY, size: 7.5, bold: true, text: value,
      });
      rowY -= 12;
    };
    tot('Total invoiced', pk(clinics.reduce((s, c) => s + c.invoicedValue, 0)));
    tot('Total paid', pk(clinics.reduce((s, c) => s + c.paidValue, 0)));
    tot('Total outstanding', pk(clinics.reduce((s, c) => s + c.outstanding, 0)));

    drawDocFooter(ops, g, footerParts, pageCount, pageCount);
    pages.push({ ops, geo: g });
  }

  return assemblePdf(pages);
}

/* ---------- monthly statement ---------- */

/** One clinic's row in a month, as the PDF wants it. */
export interface MonthlyStatementPdfRow {
  clinicName: string;
  casesBilled: number;
  billed: number;
  collected: number;
  advanceReceived: number;
  advanceApplied: number;
  creditNotes: number;
  debitAdjustments: number;
  openingBalance: number;
  closingBalance: number;
  advanceCredit: number;
  remaining: number;
}

export interface MonthlyStatementPdfMonth {
  /** 'YYYY-MM' */
  month: string;
  /** The month as a title, e.g. 'March 2026'. */
  label: string;
  rows: MonthlyStatementPdfRow[];
  /** The month's totals, in the same shape as a row with no clinic. */
  totals: {
    casesBilled: number;
    billed: number;
    collected: number;
    advanceReceived: number;
    advanceApplied: number;
    creditNotes: number;
    debitAdjustments: number;
    openingBalance: number;
    closingBalance: number;
    advanceCredit: number;
    remaining: number;
  };
}

export interface MonthlyStatementPdfMeta {
  labName: string;
  /** The months covered, e.g. 'February 2026 — October 2026'. */
  periodLabel: string;
  generatedOn: string;
  /** Which clinics are in scope, e.g. 'All 13 clinics' or '3 of 13 clinics'. */
  scopeLabel: string;
  paper?: PaperKind;
  orientation?: Orientation;
}

/* The column plan. The labels are short because a statement table carries
   twelve money columns and the headings have to fit in narrow columns without
   being truncated — the full names live in the legend under the title. */
const MONTHLY_COLS: [string, string, number, 'left' | 'right'][] = [
  ['clinic', 'CLINIC', 0.155, 'left'],
  ['cases', 'CASES', 0.045, 'right'],
  ['billed', 'BILLED', 0.095, 'right'],
  ['collected', 'COLLECTED', 0.095, 'right'],
  ['advIn', 'ADV IN', 0.075, 'right'],
  ['advUsed', 'ADV USED', 0.075, 'right'],
  ['credits', 'CREDITS', 0.075, 'right'],
  ['debits', 'DEBITS', 0.075, 'right'],
  ['opening', 'OPENING', 0.085, 'right'],
  ['closing', 'CLOSING', 0.085, 'right'],
  ['advCr', 'ADV CR', 0.075, 'right'],
  ['due', 'DUE', 0.085, 'right'],
];

/** The legend: what each short column heading means, in words. */
const MONTHLY_LEGEND = [
  'BILLED = charges raised in the month  ·  COLLECTED = settlements received in the month  ·  ' +
    'ADV IN / ADV USED = advance deposits banked / spent against invoices  ·  CREDITS = credit notes',
  'DEBITS = debit adjustments  ·  OPENING / CLOSING = balance brought forward / carried forward  ·  ' +
    'ADV CR = unallocated advance wallet  ·  DUE = still owing',
];

/**
 * Build the monthly statement PDF.
 *
 * One month per page, because a month IS the unit an operator reads this
 * document in: the clinic rows under a month, and the month's totals under
 * them. A month with more clinics than fit on a page continues onto the next
 * one with its table header repeated, so no row is ever orphaned under a
 * page it does not belong to.
 */
export function buildMonthlyStatementPdf(
  months: MonthlyStatementPdfMonth[],
  meta: MonthlyStatementPdfMeta,
): PdfBuildResult {
  const geoKey = `${meta.paper || 'a4'}-${meta.orientation || 'landscape'}`;
  const g = GEOS[geoKey] || GEOS['a4-landscape'];
  const { cols, X } = planReportCols(g, MONTHLY_COLS);
  const colByKey = Object.fromEntries(cols.map((c) => [c.key, c]));

  const headH = 15;
  const rowH = 13;
  const header = (): DocHeader => ({
    labName: meta.labName,
    title: 'MONTHLY STATEMENT',
    meta: [meta.generatedOn, `Period: ${meta.periodLabel}`, `Clinics: ${meta.scopeLabel}`],
    subtitle: MONTHLY_LEGEND,
  });
  const footerParts = {
    labName: meta.labName,
    title: 'Monthly Statement',
    periodLabel: meta.periodLabel,
  };

  const pages: PageSpec[] = [];

  /* The page's vertical rhythm, measured once.
     The title block ends in a rule; the legend sits under it; the month's
     heading and its figures come next; then the table header; then the rows.
     Each band is given its own space, because a statement that prints its
     legend across its own title is a statement nobody can read. */
  const ruleY = g.H - 64 - 12; // three meta lines, so the rule sits one lower
  const legendBottom = ruleY - 10 - (MONTHLY_LEGEND.length - 1) * 9;
  const headY = legendBottom - 20;
  const tableHeaderY = headY - 24;
  const firstRowY = tableHeaderY - headH - 4;

  months.forEach((month) => {
    /* The month heading and its table travel together: a month that runs on
       to a second page repeats both, with "(cont.)" on the heading so the
       reader knows it is the same month. */
    const chunks: MonthlyStatementPdfRow[][] = [];
    let cur: MonthlyStatementPdfRow[] = [];
    // Rows are measured, not counted: the month heading, the legend band and
    // the month's totals all have to fit above the footer.
    let y = firstRowY;
    month.rows.forEach((r) => {
      if (y - (rowH + 2) < g.CONTENT_BOTTOM + 26 && cur.length) {
        chunks.push(cur);
        cur = [];
        y = firstRowY;
      }
      cur.push(r);
      y -= rowH + 2;
    });
    if (cur.length) chunks.push(cur);
    if (chunks.length === 0) chunks.push([]);

    chunks.forEach((rows, ci) => {
      const ops: PdfOp[] = [];
      drawDocHeader(ops, g, header());

      const isLast = ci === chunks.length - 1;
      // The month heading: the name on the left, the month's own figures on
      // the right, so a page reads as a statement of one month at a glance.
      ops.push({
        kind: 'text', x: g.MARGIN, y: headY, size: 9, bold: true, grey: 0.1,
        text: ci === 0 ? month.label.toUpperCase() : `${month.label.toUpperCase()} (CONT.)`,
      });
      const figures: [string, string][] = [
        ['Billed', pk(month.totals.billed)],
        ['Collected', pk(month.totals.collected)],
        ['Due', pk(month.totals.remaining)],
      ];
      let fx = g.W - g.MARGIN;
      figures.reverse().forEach(([label, value]) => {
        ops.push({ kind: 'text', x: fx - textW(value, 7.5), y: headY, size: 7.5, bold: true, text: value });
        ops.push({ kind: 'text', x: fx - textW(value, 7.5) - textW(`${label}  `, 6.5) - 3, y: headY, size: 6.5, grey: 0.4, text: `${label}  ` });
        fx -= textW(value, 7.5) + textW(`${label}  `, 6.5) + 14;
      });
      ops.push({ kind: 'line', x1: g.MARGIN, y1: headY - 6, x2: g.W - g.MARGIN, y2: headY - 6, grey: 0.75, width: 0.6 });

      drawTableHeader(ops, g, cols as unknown as LedgerCol[], X, tableHeaderY);
      let rowY = firstRowY;

      for (const r of rows) {
        const name = fitShrink(r.clinicName, colByKey.clinic.w - 4, 6.5);
        ops.push({ kind: 'text', x: X.clinic + 2, y: rowY, size: name.size, bold: true, text: name.text });
        pushRight(ops, X.cases, colByKey.cases.w, rowY, num(r.casesBilled), 6.5);
        pushRight(ops, X.billed, colByKey.billed.w, rowY, pk(r.billed), 6.5, true);
        pushRight(ops, X.collected, colByKey.collected.w, rowY, pk(r.collected), 6.5);
        pushRight(ops, X.advIn, colByKey.advIn.w, rowY, pk(r.advanceReceived), 6.5);
        pushRight(ops, X.advUsed, colByKey.advUsed.w, rowY, pk(r.advanceApplied), 6.5);
        pushRight(ops, X.credits, colByKey.credits.w, rowY, pk(r.creditNotes), 6.5);
        pushRight(ops, X.debits, colByKey.debits.w, rowY, pk(r.debitAdjustments), 6.5);
        pushRight(ops, X.opening, colByKey.opening.w, rowY, pk(r.openingBalance), 6.5);
        pushRight(ops, X.closing, colByKey.closing.w, rowY, pk(r.closingBalance), 6.5, true);
        pushRight(ops, X.advCr, colByKey.advCr.w, rowY, pk(r.advanceCredit), 6.5);
        pushRight(ops, X.due, colByKey.due.w, rowY, pk(r.remaining), 6.5, true);
        ops.push({ kind: 'line', x1: g.MARGIN, y1: rowY - 4, x2: g.MARGIN + g.CONTENT_W, y2: rowY - 4, grey: 0.9, width: 0.4 });
        rowY -= rowH + 2;
      }

      // The month's totals, under a rule, on the last page of that month.
      if (isLast) {
        rowY -= 4;
        ops.push({ kind: 'rect', x: g.MARGIN, y: rowY - 5, w: g.CONTENT_W, h: 14, grey: 0.92 });
        ops.push({ kind: 'text', x: X.clinic + 2, y: rowY + 4, size: 6.5, bold: true, text: 'MONTH TOTAL' });
        const t = month.totals;
        pushRight(ops, X.cases, colByKey.cases.w, rowY + 4, num(t.casesBilled), 6.5, true);
        pushRight(ops, X.billed, colByKey.billed.w, rowY + 4, pk(t.billed), 6.5, true);
        pushRight(ops, X.collected, colByKey.collected.w, rowY + 4, pk(t.collected), 6.5, true);
        pushRight(ops, X.advIn, colByKey.advIn.w, rowY + 4, pk(t.advanceReceived), 6.5, true);
        pushRight(ops, X.advUsed, colByKey.advUsed.w, rowY + 4, pk(t.advanceApplied), 6.5, true);
        pushRight(ops, X.credits, colByKey.credits.w, rowY + 4, pk(t.creditNotes), 6.5, true);
        pushRight(ops, X.debits, colByKey.debits.w, rowY + 4, pk(t.debitAdjustments), 6.5, true);
        pushRight(ops, X.opening, colByKey.opening.w, rowY + 4, pk(t.openingBalance), 6.5, true);
        pushRight(ops, X.closing, colByKey.closing.w, rowY + 4, pk(t.closingBalance), 6.5, true);
        pushRight(ops, X.advCr, colByKey.advCr.w, rowY + 4, pk(t.advanceCredit), 6.5, true);
        pushRight(ops, X.due, colByKey.due.w, rowY + 4, pk(t.remaining), 6.5, true);
      }

      pages.push({ ops, geo: g });
    });
  });

  if (pages.length === 0) {
    /* An empty statement still gets a page, saying so, rather than a file the
       reader opens to find nothing in it. */
    const ops: PdfOp[] = [];
    drawDocHeader(ops, g, header());
    ops.push({
      kind: 'text', x: g.MARGIN, y: g.TABLE_TOP, size: 9, grey: 0.4,
      text: 'No billing activity in this period.',
    });
    pages.push({ ops, geo: g });
  }

  // The page numbers are only knowable once the pages exist.
  const total = pages.length;
  pages.forEach((p, i) => {
    drawDocFooter(p.ops, g, footerParts, i + 1, total);
  });

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
