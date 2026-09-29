import { describe, it, expect } from 'vitest';
import { assemblePdf, buildLedgerPdf, LedgerPdfEntry, LedgerPdfMeta, GEOS } from '../../src/lib/pdf';

/** Byte-accurate string: every char is one byte (WinAnsi output). */
const toBytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

describe('assemblePdf', () => {
  it('emits a valid PDF envelope with correct xref byte offsets', () => {
    const { pdf } = assemblePdf([
      { ops: [{ kind: 'text', x: 40, y: 700, size: 12, text: 'Hello (test) \\page' }], geo: GEOS['a4-portrait'] },
      { ops: [{ kind: 'text', x: 40, y: 700, size: 12, bold: true, text: 'Page two — dash' }], geo: GEOS['a4-portrait'] },
    ]);
    const bytes = toBytes(pdf);

    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);

    // startxref points at the xref keyword in the BYTE stream
    const sx = /startxref\n(\d+)\n%%EOF$/.exec(pdf.trimEnd());
    expect(sx).toBeTruthy();
    const startxref = Number(sx![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');

    // xref subsection header length varies, so locate it, skip the 20-byte
    // free entry, then object 1's offset must hit "1 0 obj" exactly.
    const sub = /xref\n0 \d+\n/.exec(pdf.slice(startxref))!;
    const entryBase = startxref + sub.index + sub[0].length + 20; // + free entry
    const firstOff = Number(pdf.slice(entryBase, entryBase + 10));
    expect(pdf.slice(firstOff, firstOff + 7)).toBe('1 0 obj');

    // /Length of a stream equals its byte length (or is an over-declared
    // margin: pdf.js stops at endstream, viewers pad with whitespace)
    const lenMatch = /\/Length (\d+) >>\nstream\n/.exec(pdf);
    expect(lenMatch).toBeTruthy();
    const len = Number(lenMatch![1]);
    const streamStart = lenMatch!.index + lenMatch![0].length;
    const endTag = pdf.slice(streamStart + len, streamStart + len + 10);
    expect(['\nendstream', '\r\nendstr']).toContain(endTag);

    expect(bytes.length).toBe(pdf.length);
  });

  it('parenthesises and backslashes are escaped inside literal strings', () => {
    const { pdf } = assemblePdf([{ ops: [{ kind: 'text', x: 0, y: 0, size: 10, text: 'a(b)c\\d' }], geo: GEOS['a4-portrait'] }]);
    expect(pdf).toContain('(a\\(b\\)c\\\\d)');
  });
});

const meta: LedgerPdfMeta = {
  labName: 'Bright Smile Dental Lab',
  clinicLabel: 'All Clinics',
  periodLabel: '2026-09-01 → 2026-09-30',
  openingBalance: 14500000,
  totalDebits: 14500000.5,
  totalCredits: 1200000,
  closingBalance: 13300000.5,
  transactionCount: 95,
  generatedOn: '2026-09-28',
};

const entries: LedgerPdfEntry[] = Array.from({ length: 95 }, (_, i) => ({
  date: '2026-09-15',
  clinic: i % 2 ? 'Clinic B' : 'Clinic A',
  caseNumber: i % 3 === 0 ? 'DS-202' : '',
  typeLabel: i % 3 === 0 ? 'Case Invoice' : 'Cash Payment',
  narration: `Case Invoice #INV-${1000 + i} • Zirconia crown`,
  debit: i % 3 === 0 ? 25000 : 0,
  credit: i % 3 === 0 ? 0 : 25000,
  closing: 13300000.5 + (i % 3 === 0 ? 25000 : -25000) * (i + 1),
}));

describe('buildLedgerPdf', () => {
  it('produces a parseable multi-page PDF with ledger content', () => {
    const { pdf, pageCount } = buildLedgerPdf(entries, meta);
    expect(pageCount).toBeGreaterThanOrEqual(3); // height-based pagination, 95 rows
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);

    // Letterhead + columns present
    expect(pdf).toContain('Bright Smile Dental Lab');
    expect(pdf).toContain('GENERAL LEDGER');
    expect(pdf).toContain('(Account: Accounts Receivable)');
    expect(pdf).toContain('(CLINIC)');
    expect(pdf).toContain('(DESCRIPTION / PARTICULARS)');
    expect(pdf).toContain('(Page 1 of');
    expect(pdf).toContain(`(Page ${pageCount} of ${pageCount})`);
    // Opening balance brought forward on page 1 (parens escaped in stream)
    expect(pdf).toContain('(Opening Balance \\(b/f\\))');
    expect(pdf).toContain('14,500,000');
    // Footer totals: money strings verbatim (no re-rounding drift)
    expect(pdf).toContain('(PKR 14,500,000.5)');
    expect(pdf).toContain('(PKR 13,300,000.5)');
    // Closing balance classification line (parens escaped in stream)
    expect(pdf).toContain('Balance Dr \\(receivable\\)');
  });

  it('empty ledger still yields one valid page', () => {
    const { pdf, pageCount } = buildLedgerPdf([], meta);
    expect(pageCount).toBe(1);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('(Page 1 of 1)');
  });

  it('renders canonical account label + code, and an As-of line for all-time periods', () => {
    const { pdf } = buildLedgerPdf(entries.slice(0, 2), {
      ...meta,
      periodLabel: 'All Time',
      accountName: 'Accounts Receivable (Dental Clinics)',
      accountCode: '1100',
    });
    // '·' and the name's parens are WinAnsi-escaped in the stream; assert ASCII fragments
    expect(pdf).toContain('(Account: 1100 ');
    expect(pdf).toContain('Accounts Receivable \\(Dental Clinics\\))');
    expect(pdf).toContain('(As of: 2026-09-28)');

    // Dated periods must NOT get an As-of line
    const dated = buildLedgerPdf(entries.slice(0, 2), {
      ...meta,
      accountName: 'Accounts Receivable (Dental Clinics)',
      accountCode: '1100',
    });
    expect(dated.pdf).not.toContain('(As of:');
  });

  it('defaults to plain Accounts Receivable when no account override is given', () => {
    const { pdf } = buildLedgerPdf(entries.slice(0, 1), meta);
    expect(pdf).toContain('(Account: Accounts Receivable)');
    expect(pdf).not.toContain('1100 \u00b7');
  });
});

/* ---------- structural integrity (ported from .freebuff/pdfxref.mjs) ----------
   These fail loudly if the PDF envelope regresses: byte/char drift, wrong xref
   offsets, over/under-declared stream lengths, or page-tree references that
   point at content streams instead of page dicts (the multi-page blank-page
   bug class). */

describe('pdf structural integrity', () => {
  const parse = (pdf: string) => {
    const sx = /startxref\n(\d+)\n%%EOF$/.exec(pdf.trimEnd());
    expect(sx).toBeTruthy();
    const startxref = Number(sx![1]);
    const sub = /xref\n0 (\d+)\n/.exec(pdf.slice(startxref));
    expect(sub).toBeTruthy();
    const count = Number(sub![1]);
    const base = startxref + sub!.index + sub![0].length;
    const offsets: number[] = [NaN]; // object numbers are 1-based
    for (let i = 1; i < count; i++) {
      offsets.push(Number(pdf.slice(base + i * 20, base + i * 20 + 10)));
    }
    return { count, offsets };
  };

  it('every xref offset points exactly at its object header (binary-safe string)', () => {
    const { pdf } = buildLedgerPdf(entries, meta); // 8-page sample, many streams
    const bytes = Uint8Array.from(pdf, (c) => c.charCodeAt(0) & 0xff);
    expect(bytes.length).toBe(pdf.length); // char == byte invariant

    const { count, offsets } = parse(pdf);
    for (let i = 1; i < count; i++) {
      const tag = `${i} 0 obj`;
      const slice = pdf.slice(offsets[i], offsets[i] + tag.length);
      if (slice !== tag) throw new Error(`xref entry ${i} -> ${slice}`);
    }
  });

  it('every content stream /Length matches its byte length exactly', () => {
    const { pdf } = buildLedgerPdf(entries, meta);
    const re = /\/Length (\d+) >>\nstream\n/g;
    let m, streams = 0;
    while ((m = re.exec(pdf))) {
      streams++;
      const start = m.index + m[0].length;
      const actual = pdf.indexOf('\nendstream', start) - start;
      if (m[1] !== String(actual)) throw new Error(`stream ${streams}: declared ${m[1]}, actual ${actual}`);
    }
    expect(streams).toBeGreaterThanOrEqual(3); // really multi-page
  });

  it('page-tree Kids reference page dicts, never content streams', () => {
    const { pdf, pageCount } = buildLedgerPdf(entries, meta);
    const { offsets } = parse(pdf);
    const kids = /\/Kids \[([^\]]+)\]/.exec(pdf)!;
    const refs = [...kids[1].matchAll(/(\d+) 0 R/g)].map((x) => Number(x[1]));
    expect(refs).toHaveLength(pageCount);
    // Interleaved layout: page dict i is object 5 + 2i; stream is 5 + 2i + 1.
    refs.forEach((objNum, i) => expect(objNum).toBe(5 + i * 2));
    refs.forEach((objNum) => {
      const head = pdf.slice(offsets[objNum], offsets[objNum] + 30);
      if (!head.startsWith(`${objNum} 0 obj\n<< /Type /Page`)) {
        throw new Error(`kid ${objNum} is not a page dict: ${head.slice(0, 20)}`);
      }
    });
  });

  it('assemblePdf on raw pages passes the same structural checks', () => {
    const { pdf } = assemblePdf([
      { ops: [{ kind: 'text', x: 40, y: 700, size: 12, text: 'one (x)' }], geo: GEOS['a4-portrait'] },
      { ops: [], geo: GEOS['a4-landscape'] },
      { ops: [], geo: GEOS['letter-portrait'] },
    ]);
    const bytes = Uint8Array.from(pdf, (c) => c.charCodeAt(0) & 0xff);
    expect(bytes.length).toBe(pdf.length);
    const { count, offsets } = parse(pdf);
    for (let i = 1; i < count; i++) {
      const tag = `${i} 0 obj`;
      expect(pdf.slice(offsets[i], offsets[i] + tag.length)).toBe(tag);
    }
    const re = /\/Length (\d+) >>\nstream\n/g;
    let m;
    while ((m = re.exec(pdf))) {
      const start = m.index + m[0].length;
      expect(String(pdf.indexOf('\nendstream', start) - start)).toBe(m[1]);
    }
  });
});
