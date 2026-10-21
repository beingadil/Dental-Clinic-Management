import { describe, it, expect } from 'vitest';
import { buildDailyReportPdf, buildLedgerPdf, downloadPdf } from '../../src/lib/pdf';

/**
 * The PDF writer's own contract.
 *
 * A PDF is a graph of byte offsets: every stream declares its `/Length`, the
 * xref table lists where each object starts, and the trailer points at the
 * xref table. Those are all BYTE offsets, but they are computed from the
 * JavaScript string's CHARACTER count — which is the same number only while
 * every character is one byte.
 *
 * When the two disagree the reader is told the stream is longer than it is,
 * overruns the `endstream` marker, and refuses the file: "there was an error
 * loading the document". The writer cannot tell, because the offsets it
 * computed are internally consistent — they are consistent about a document
 * that is not the one on disk.
 *
 * So these tests read the bytes back the way a reader does and check them
 * against what the file actually contains. That is the check that was missing,
 * and it is the one that has to be in CI rather than in an operator's hands.
 */

/** Decode a PDF string the way the file is written: one char, one byte. */
const toBytes = (pdf: string): Uint8Array => {
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
};

interface PdfProblem {
  what: string;
  detail: string;
}

/** Read a PDF the way a reader does and report every structural fault. */
function inspect(pdf: string): PdfProblem[] {
  const problems: PdfProblem[] = [];
  const bytes = toBytes(pdf);
  const s = String.fromCharCode(...Array.from(bytes));

  if (!s.startsWith('%PDF-1.4')) {
    problems.push({ what: 'header', detail: `starts with "${s.slice(0, 8)}"` });
  }
  if (!s.trimEnd().endsWith('%%EOF')) {
    problems.push({ what: 'trailer', detail: 'no %%EOF at the end' });
  }

  // The xref table must be where startxref says it is.
  const m = s.match(/startxref\s+(\d+)\s*%%EOF\s*$/);
  if (!m) {
    problems.push({ what: 'startxref', detail: 'no startxref before %%EOF' });
    return problems;
  }
  const xrefStart = Number(m[1]);
  if (s.slice(xrefStart, xrefStart + 4) !== 'xref') {
    problems.push({
      what: 'startxref',
      detail: `points at ${xrefStart} ("${s.slice(xrefStart, xrefStart + 12)}"), not at the xref table`,
    });
    return problems;
  }

  // Every xref entry must point at its own object.
  const entries = [...s.slice(xrefStart).matchAll(/^(\d{10}) (\d{5}) ([nf])\s*$/gm)];
  entries.forEach((e, i) => {
    if (e[3] !== 'n') return;
    const off = Number(e[1]);
    const want = `${i} 0 obj`;
    if (s.slice(off, off + want.length) !== want) {
      problems.push({
        what: `xref[${i}]`,
        detail: `points at ${off} ("${s.slice(off, off + 20).replace(/\n/g, '\\n')}")`,
      });
    }
  });

  // Every stream's declared length must equal the bytes actually present.
  const re = /<< \/Length (\d+) >>\nstream\n/g;
  let sm;
  while ((sm = re.exec(s))) {
    const declared = Number(sm[1]);
    const start = sm.index + sm[0].length;
    const end = s.indexOf('\nendstream', start);
    if (end < 0) {
      problems.push({ what: 'stream', detail: 'no endstream marker' });
      continue;
    }
    if (declared !== end - start) {
      problems.push({
        what: 'stream /Length',
        detail: `declares ${declared} but carries ${end - start} bytes`,
      });
    }
  }

  return problems;
}

const META = {
  labName: 'Dental Lab',
  periodLabel: '2026-10-20 → 2026-10-20',
  generatedOn: '2026-10-20',
  invoicesRaised: 1,
  invoicedValue: 28000,
  paymentsReceived: 0,
  paidValue: 0,
  totalOutstanding: 28000,
};

const row = (over: Record<string, unknown> = {}) => ({
  caseNumber: 'DS-0001',
  receivedDate: '2026-10-20',
  caseType: 'PFM Crown',
  patient: 'Hadia Rahman',
  doctor: 'Dr Haroon',
  clinic: 'Rahat Dental',
  deliveryDate: '2026-10-25',
  daysLate: 0,
  fee: 28000,
  ...over,
});

describe('the PDF writer', () => {
  it('produces a file whose offsets all point where they claim to', () => {
    const { pdf } = buildDailyReportPdf([row()], [], META);
    expect(inspect(pdf)).toEqual([]);
  });

  it('produces the same for a report long enough to need several pages', () => {
    const rows = Array.from({ length: 90 }, (_, i) => row({ caseNumber: `DS-${1000 + i}` }));
    const { pdf, pageCount } = buildDailyReportPdf(rows, [], META);
    expect(pageCount).toBeGreaterThan(1);
    expect(inspect(pdf)).toEqual([]);
  });

  it('produces the same for names a lab in Karachi or Lahore actually has', () => {
    // Latin-1 letters, Urdu, Arabic-Indic digits, curly quotes, dashes, a
    // currency sign and a stray newline — all of which must survive as
    // escaped ASCII without shifting a single byte offset.
    const { pdf } = buildDailyReportPdf(
      [
        row({
          patient: 'José Álvarez',
          doctor: 'Dr Şahin',
          clinic: 'Rahat — Dental “Centre”',
          caseType: 'Zirconia £100 €50',
        }),
        row({ patient: 'عبد الرحیم', doctor: 'ڈاکٹر احمد' }),
        row({ patient: 'Line\nBreak', clinic: '١٢٣ Clinic' }),
      ],
      [],
      META
    );
    expect(inspect(pdf)).toEqual([]);
  });

  it('is byte-for-byte what the file on disk will contain', () => {
    const { pdf } = buildDailyReportPdf([row()], [], META);
    const bytes = toBytes(pdf);
    expect(bytes.length).toBe(pdf.length);
    // A character outside Latin-1 would make the string length and the byte
    // count disagree, and every offset in the file would be wrong.
    expect(new TextEncoder().encode(pdf).length).toBe(pdf.length);
  });

  it('holds the ledger statement to the same contract', () => {
    const { pdf } = buildLedgerPdf(
      [{ date: '2026-10-20', clinic: 'Rahat', caseNumber: 'DS-1', typeLabel: 'Invoice', narration: 'Payment received', debit: 0, credit: 100, closing: 100 }],
      {
        labName: 'Dental Lab',
        clinicLabel: 'Rahat',
        periodLabel: '2026-10-20 → 2026-10-20',
        openingBalance: 0,
        totalDebits: 0,
        totalCredits: 100,
        closingBalance: 100,
        transactionCount: 1,
        generatedOn: '2026-10-20',
      }
    );
    expect(inspect(pdf)).toEqual([]);
  });
});

describe('saving a PDF', () => {
  it('refuses to hand over a document whose offsets would be wrong', async () => {
    /* A document that is one byte-per-character is the only kind that can be
       saved. Anything else is refused HERE, at the last point before the
       bytes reach the disk, rather than saved and found broken by the
       operator. */
    const broken = '%PDF-1.4\n1 0 obj\n<< /Length 3 >>\nstream\nün\nendstream\nendobj\n';
    await expect(downloadPdf('broken.pdf', broken, 'PDF document')).rejects.toThrow(/bytes/);
  });
});
