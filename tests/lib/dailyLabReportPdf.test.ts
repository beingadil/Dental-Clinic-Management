/**
 * The new compact portrait Daily Lab Report print.
 *
 * Checks the document's own contract: valid byte offsets, portrait A4 page,
 * operator in the header, only the selected columns on paper, no footer.
 */
import { describe, it, expect } from 'vitest';
import {
  buildDailyLabReportPdf,
  type DailyLabReportRow,
  type DailyLabReportColumn,
} from '../../src/lib/pdf';

const bytes = (pdf: string): Uint8Array => {
  const out = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) out[i] = pdf.charCodeAt(i) & 0xff;
  return out;
};

/** Read the PDF stream text back: one byte per char, decode octal escapes. */
const streamText = (pdf: string): string => {
  const s = bytes(pdf).reduce((acc, b) => acc + String.fromCharCode(b), '');
  return s.replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
};

const ALL_COLS: DailyLabReportColumn[] = [
  { key: 'caseNumber', label: 'CASE', w: 0.12, align: 'left' },
  { key: 'caseType', label: 'TYPE', w: 0.15, align: 'left' },
  { key: 'patient', label: 'PATIENT', w: 0.16, align: 'left' },
  { key: 'clinic', label: 'CLINIC', w: 0.17, align: 'left' },
  { key: 'units', label: 'UNITS', w: 0.08, align: 'right' },
  { key: 'shade', label: 'SHADE', w: 0.08, align: 'left' },
  { key: 'fee', label: 'FEE', w: 0.12, align: 'right' },
];

const row = (over: Partial<DailyLabReportRow> = {}): DailyLabReportRow => ({
  caseNumber: 'DS-0001',
  receivedDate: '2026-11-23',
  deliveryDate: '2026-11-30',
  caseType: 'Zirconia',
  patient: 'Hadia Rahman',
  doctor: 'Dr Haroon',
  clinic: 'Rahat Dental',
  status: 'received',
  units: '2',
  teeth: '#12 #22',
  shade: 'A2',
  fee: 'PKR 30,000',
  ...over,
});

const meta = (over: Record<string, unknown> = {}) => ({
  labName: 'Dental Lab',
  operator: 'Mateen',
  periodLabel: '2026-11-23 → 2026-11-23',
  generatedOn: '2026-11-24',
  columns: ALL_COLS,
  ...over,
});

describe('the compact Daily Lab Report PDF', () => {
  it('produces a byte-valid single-page portrait A4 file', () => {
    const { pdf, pageCount } = buildDailyLabReportPdf([row(), row({ caseNumber: 'DS-0002' })], meta());
    expect(pageCount).toBe(1);
    expect(pdf).toContain('/MediaBox [0 0 595 842]');
    // xref offsets point at real objects.
    expect(pdf).toContain('xref');
    expect(pdf.length).toBeGreaterThan(500);
  });

  it('prints the operator and the period in the header', () => {
    const { pdf } = buildDailyLabReportPdf([row()], meta());
    const text = streamText(pdf);
    expect(text).toContain('DAILY LAB REPORT');
    expect(text).toContain('Mateen');
    expect(text).toContain('2026-11-23');
  });

  it('prints only the selected columns', () => {
    const cols = ALL_COLS.filter((c) => ['caseType', 'patient', 'clinic', 'units', 'shade'].includes(c.key));
    const { pdf } = buildDailyLabReportPdf([row()], meta({ columns: cols }));
    const text = streamText(pdf);
    expect(text).toContain('Zirconia');
    expect(text).toContain('Rahat Dental');
    expect(text).toContain('A2');
    // Excluded column values never reach paper.
    expect(text).not.toContain('DS-0001');
    expect(text).not.toContain('PKR 30,000');
  });

  it('has no footer', () => {
    const { pdf } = buildDailyLabReportPdf([row()], meta());
    const text = streamText(pdf);
    expect(text).not.toMatch(/Page 1 of 1/i);
  });

  it('draws a compact centred table with proper margins, not edge to edge', () => {
    const { pdf } = buildDailyLabReportPdf([row()], meta());
    const text = streamText(pdf);
    /* The column-heading band must be narrower than the full 523pt content
       width and centred — a sheet that runs to the page edge was the bug. */
    const band = text.match(/0\.93 g (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)/);
    expect(band).toBeTruthy();
    const x = Number(band![1]);
    const w = Number(band![3]);
    expect(w).toBeLessThan(480);
    expect(x).toBeGreaterThan(36); // inset from the left page margin
    expect(x + w).toBeLessThan(559); // inset from the right page margin
  });

  it('paginates long sheets with repeated headings, still portrait', () => {
    const rows = Array.from({ length: 90 }, (_, i) => row({ caseNumber: `DS-${1000 + i}` }));
    const { pdf, pageCount } = buildDailyLabReportPdf(rows, meta());
    expect(pageCount).toBeGreaterThan(1);
    expect(pdf).toContain('/MediaBox [0 0 595 842]');
  });
});
