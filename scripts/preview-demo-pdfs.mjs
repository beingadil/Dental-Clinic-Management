/**
 * Dev-only: build the two billing PDFs from demo data and render their pages
 * as SVG in one HTML file, so the documents can be looked at without a PDF
 * viewer.
 *
 *   node scripts/preview-demo-pdfs.mjs
 *   -> preview/general-ledger.pdf
 *   -> preview/monthly-statement.pdf
 *   -> preview/index.html
 *
 * Nothing here ships: it is a viewing aid, and the PDF bytes it writes are the
 * real ones `buildLedgerPdf` / `buildMonthlyStatementPdf` produce.
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'pdf-preview');
const OUT_DIR = path.join(ROOT, 'preview');

mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const bundle = path.join(CACHE, 'pdf.mjs');
await build({
  entryPoints: [path.join(ROOT, 'src', 'lib', 'pdf.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: bundle,
  logLevel: 'silent',
});

const { buildLedgerPdf, buildMonthlyStatementPdf } = await import(pathToFileURL(bundle).href);

/* ---------- demo data (the same shape the seeded demo install produces) ---------- */

const LAB = 'Dental Solution';

const LEDGER_META = {
  labName: LAB,
  clinicLabel: 'Arif Dental Clinic',
  periodLabel: 'All Time',
  openingBalance: 0,
  totalDebits: 76000,
  totalCredits: 0,
  closingBalance: 76000,
  transactionCount: 9,
  generatedOn: '2026-11-03',
};

const LEDGER_ENTRIES = [
  ['2026-10-05', 'DS-0003', 'Case Invoice', 'Invoice for Zirconia · Patient: 3289 · Teeth: #16 · Shade: A2', 5000, 0, 5000],
  ['2026-10-05', 'DS-0002', 'Case Invoice', 'Invoice for Zirconia · Patient: 3138 · Teeth: #12, #13, #15 · Shade: A2', 15000, 0, 20000],
  ['2026-10-06', 'DS-0035', 'Case Invoice', 'Invoice for Zirconia · Patient: 3173 · Teeth: #35, #36, #45, #46 · Shade: A2', 20000, 0, 40000],
  ['2026-10-06', 'DS-0034', 'Case Invoice', 'Invoice for Zirconia · Patient: 3172 · Teeth: #45 · Shade: A2', 5000, 0, 45000],
  ['2026-10-06', 'DS-0033', 'Case Invoice', 'Invoice for Zirconia · Patient: 3171 · Teeth: #36 · Shade: A2', 5000, 0, 50000],
  ['2026-10-08', 'DS-0077', 'Case Invoice', 'Invoice for Zirconia · Patient: 3216 · Teeth: #11, #21 · Shade: A3', 10000, 0, 60000],
  ['2026-10-10', 'DS-0068', 'Case Invoice', 'Invoice for Zirconia · Patient: 3200 · Teeth: #46 · Shade: A3', 5000, 0, 65000],
  ['2026-10-14', 'DS-0133', 'Case Invoice', 'Invoice for Denture · Patient: 3273 · Teeth: #31, #32, #41, #42 · Shade: A2', 6000, 0, 71000],
  ['2026-10-14', 'DS-0132', 'Case Invoice', 'Invoice for Zirconia · Patient: 3272 · Teeth: #15 · Shade: A2', 5000, 0, 76000],
].map(([date, caseNumber, typeLabel, narration, debit, credit, closing]) => ({
  date,
  clinic: 'Arif Dental Clinic',
  caseNumber,
  typeLabel,
  narration,
  debit,
  credit,
  closing,
}));

const STATEMENT_COLUMNS = [
  { key: 'clinic', label: 'Dental Clinic', w: 0.155, align: 'left', strong: false },
  { key: 'cases', label: 'Cases Billed', w: 0.05, align: 'right', strong: false },
  { key: 'billed', label: 'Billed (Dr)', w: 0.095, align: 'right', strong: true },
  { key: 'collected', label: 'Collected (Cr)', w: 0.095, align: 'right', strong: false },
  { key: 'closing', label: 'Closing Balance', w: 0.095, align: 'right', strong: true },
];

const pk = (n) => `PKR ${n.toLocaleString('en-US')}`;
const drCr = (n) => (n > 0 ? ' Dr' : n < 0 ? ' Cr' : '');

const month = (label, rows) => {
  const total = (key) => rows.reduce((s, r) => s + r[key], 0);
  const billed = total('billed');
  const collected = total('collected');
  const closing = rows.reduce((max, r) => Math.max(max, r.closing), 0);
  return {
    month: label === 'October 2026' ? '2026-10' : '2026-09',
    label,
    rows: rows.map((r) => [r.clinic, String(r.cases), pk(r.billed), pk(r.collected), `${pk(r.closing)}${drCr(r.closing)}`]),
    totals: [
      'MONTH TOTAL',
      String(total('cases')),
      pk(billed),
      pk(collected),
      `${pk(closing)}${drCr(closing)}`,
    ],
    headline: [
      { label: 'Billed', value: pk(billed) },
      { label: 'Collected', value: pk(collected) },
      { label: 'Closing', value: `${pk(closing)}${drCr(closing)}` },
    ],
  };
};

const SEPTEMBER = [
  { clinic: 'Whitefield Dental Studio', cases: 14, billed: 182000, collected: 150000, closing: 32000 },
  { clinic: 'Northgate Family Dentistry', cases: 9, billed: 96000, collected: 96000, closing: 0 },
  { clinic: 'Riverside Smile Centre', cases: 11, billed: 134000, collected: 100000, closing: 34000 },
  { clinic: 'Cedar Point Dental Care', cases: 4, billed: 48000, collected: 20000, closing: 28000 },
  { clinic: 'Central Prosthodontics', cases: 7, billed: 91000, collected: 91000, closing: 0 },
];

const OCTOBER = [
  { clinic: 'Whitefield Dental Studio', cases: 18, billed: 246000, collected: 210000, closing: 68000 },
  { clinic: 'Northgate Family Dentistry', cases: 6, billed: 72000, collected: 60000, closing: 12000 },
  { clinic: 'Riverside Smile Centre', cases: 13, billed: 168000, collected: 160000, closing: 42000 },
  { clinic: 'Cedar Point Dental Care', cases: 8, billed: 104000, collected: 88000, closing: 44000 },
  { clinic: 'Central Prosthodontics', cases: 5, billed: 65000, collected: 65000, closing: 0 },
];

const monthlyPdf = buildMonthlyStatementPdf(
  [month('October 2026', OCTOBER), month('September 2026', SEPTEMBER)],
  {
    labName: LAB,
    periodLabel: 'September 2026 — October 2026',
    generatedOn: '2026-11-03',
    scopeLabel: 'All 5 clinics',
    summary: [
      { label: 'Billed', value: pk(1586000), note: '2 months in scope' },
      { label: 'Collected', value: pk(1349000), note: 'Payments, advances and notes' },
      { label: 'Closing balance', value: 'PKR 166,000 Dr', note: 'As at the newest month' },
      { label: 'Clinics', value: '5', note: 'In the reporting window' },
    ],
  },
  STATEMENT_COLUMNS,
);

const ledgerPdf = buildLedgerPdf(LEDGER_ENTRIES, LEDGER_META);

writeFileSync(path.join(OUT_DIR, 'general-ledger.pdf'), Buffer.from(ledgerPdf.pdf, 'latin1'));
writeFileSync(path.join(OUT_DIR, 'monthly-statement.pdf'), Buffer.from(monthlyPdf.pdf, 'latin1'));

/* ---------- PDF -> SVG, so the documents can be seen here ---------- */

/* WinAnsi high-range bytes carry typography (em dash, bullet, curly quotes).
   The PDF is right either way; the preview has to decode them or they print as
   tofu boxes in the browser. */
const WINANSI = {
  0x80: '\u20ac', 0x82: '\u201a', 0x83: '\u0192', 0x84: '\u201e', 0x85: '\u2026',
  0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02c6', 0x89: '\u2030', 0x8a: '\u0160',
  0x8b: '\u2039', 0x8c: '\u0152', 0x8e: '\u017d', 0x91: '\u2018', 0x92: '\u2019',
  0x93: '\u201c', 0x94: '\u201d', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
  0x98: '\u02dc', 0x99: '\u2122', 0x9a: '\u0161', 0x9b: '\u203a', 0x9c: '\u0153',
  0x9e: '\u017e', 0x9f: '\u0178',
};
const decodeByte = (code) => WINANSI[code] ?? String.fromCharCode(code);

const unescapePdfText = (s) =>
  s
    .replace(/\\([0-7]{3})/g, (_, o) => decodeByte(parseInt(o, 8)))
    .replace(/\\(.)/g, '$1');

const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const grey = (g) => {
  const v = Math.round(Math.max(0, Math.min(1, Number(g))) * 255);
  return `rgb(${v},${v},${v})`;
};

function pagesToSvg(pdf, scale) {
  const pages = [];
  const pageRe = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\][\s\S]*?\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g;
  let m;
  while ((m = pageRe.exec(pdf))) {
    const W = Number(m[1]);
    const H = Number(m[2]);
    const body = m[4];
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}" viewBox="0 0 ${W} ${H}">`];
    parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
    for (const line of body.split('\n')) {
      let r;
      if ((r = /^BT ([\d.]+) g (\/F1|\/F2) ([\d.]+) Tf 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm \((.*)\) Tj ET$/.exec(line))) {
        const [, g, font, size, x, y, text] = r;
        parts.push(
          `<text x="${x}" y="${(H - Number(y)).toFixed(2)}" font-family="Helvetica, Arial, sans-serif" ` +
            `font-size="${size}" font-weight="${font === '/F2' ? 700 : 400}" fill="${grey(g)}">${escXml(unescapePdfText(text))}</text>`
        );
      } else if ((r = /^([\d.]+) g ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re f$/.exec(line))) {
        const [, g, x, y, w, h] = r;
        parts.push(`<rect x="${x}" y="${(H - Number(y) - Number(h)).toFixed(2)}" width="${w}" height="${h}" fill="${grey(g)}"/>`);
      } else if ((r = /^([\d.]+) G ([\d.]+) w ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re S$/.exec(line))) {
        const [, g, sw, x, y, w, h] = r;
        parts.push(
          `<rect x="${x}" y="${(H - Number(y) - Number(h)).toFixed(2)}" width="${w}" height="${h}" fill="none" ` +
            `stroke="${grey(g)}" stroke-width="${sw}"/>`
        );
      } else if ((r = /^([\d.]+) G ([\d.]+) w ([\d.-]+) ([\d.-]+) m ([\d.-]+) ([\d.-]+) l S$/.exec(line))) {
        const [, g, sw, x1, y1, x2, y2] = r;
        parts.push(
          `<line x1="${x1}" y1="${(H - Number(y1)).toFixed(2)}" x2="${x2}" y2="${(H - Number(y2)).toFixed(2)}" ` +
            `stroke="${grey(g)}" stroke-width="${sw}"/>`
        );
      }
    }
    parts.push('</svg>');
    pages.push({ W, H, svg: parts.join('\n') });
  }
  return pages;
}

const SCALE = 1.15;
const sections = [
  { title: 'General Ledger', file: 'general-ledger.pdf', pdf: ledgerPdf.pdf },
  { title: 'Monthly Statement', file: 'monthly-statement.pdf', pdf: monthlyPdf.pdf },
];

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Billing PDF preview</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #eef1f5; font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #0f172a; }
  header { padding: 22px 28px 6px; }
  header h1 { margin: 0; font-size: 17px; letter-spacing: .01em; }
  header p { margin: 6px 0 0; font-size: 12px; color: #55637a; }
  section { padding: 20px 28px 8px; }
  section h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .12em; color: #64748b; margin: 0 0 12px; }
  .page { background: #fff; box-shadow: 0 10px 30px -12px rgba(15,23,42,.35); border-radius: 3px; margin: 0 0 22px; width: max-content; overflow: hidden; }
  .page svg { display: block; }
  .meta { font-size: 11px; color: #64748b; margin: 0 0 6px; }
  a { color: #1d4ed8; }
</style></head>
<body>
<header>
  <h1>Billing documents — rendered from the real PDF bytes</h1>
  <p>Demo data only. <a href="general-ledger.pdf">General ledger PDF</a> · <a href="monthly-statement.pdf">Monthly statement PDF</a></p>
</header>
${sections
  .map((s) => {
    const pages = pagesToSvg(s.pdf, SCALE);
    return `<section><h2>${s.title} — ${pages.length} page${pages.length === 1 ? '' : 's'}</h2>${pages
      .map((p, i) => `<p class="meta">Page ${i + 1} · ${p.W} × ${p.H} pt</p><div class="page">${p.svg}</div>`)
      .join('')}</section>`;
  })
  .join('')}
</body></html>`;

writeFileSync(path.join(OUT_DIR, 'index.html'), html);
console.log(`Wrote ${path.join(OUT_DIR, 'index.html')}`);
