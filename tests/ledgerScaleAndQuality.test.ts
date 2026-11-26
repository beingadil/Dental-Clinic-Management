import { describe, expect, it } from 'vitest';
import { settlementAsOf } from '../src/services/ledgerSettlement';
import { findLedgerIssues } from '../src/services/ledgerQuality';
import { buildLedgerCsvRows } from '../src/services/ledgerCsv';
import { buildLedgerReportPdf } from '../src/lib/ledgerPdf';
import { buildLedgerReportPdfAsync } from '../src/lib/ledgerPdfAsync';
import { buildLedgerXlsx } from '../src/services/ledgerXlsx';
import { strFromU8, unzipSync } from 'fflate';
import type { LedgerReportRow, LedgerReportSummary } from '../src/services/ledgerReport';

const row = (over: Partial<LedgerReportRow> = {}): LedgerReportRow => ({
  id: 'led-1',
  date: '2026-10-03',
  dateLabel: '03-Oct-2026',
  type: 'invoice',
  typeLabel: 'Invoice',
  voucherNumber: 'INV-0042',
  caseNumber: 'DS-2001',
  narration: 'INV-0042 | Case DS-2001 | Invoice for Zirconia Crown',
  bodyNarration: 'Invoice for Zirconia Crown',
  debit: 30000,
  credit: 0,
  balance: 30000,
  ...over,
});

const summary: LedgerReportSummary = {
  openingBalance: 0,
  totalDebits: 30000,
  totalCredits: 0,
  closingBalance: 30000,
  transactionCount: 1,
};

describe('settlement as of a ledger row date', () => {
  it('ignores a payment posted after the row', () => {
    const result = settlementAsOf(
      {
        final_amount: 30000,
        amount_paid: 30000,
        credit_notes_total: 0,
        payments: [{ payment_date: '2026-11-05', amount: 30000 }],
      },
      '2026-10-20',
    );
    expect(result.status).toBe('unpaid');
    expect(result.balance).toBe(30000);
  });

  it('counts only credits dated on or before the row', () => {
    const result = settlementAsOf(
      { final_amount: 30000, amount_paid: 0, credit_notes_total: 10000 },
      '2026-10-20',
      [
        { amount: 10000, clinicLevel: false, adjustment: { date: '2026-10-10' } },
        { amount: 5000, clinicLevel: false, adjustment: { date: '2026-11-10' } },
      ],
    );
    expect(result.status).toBe('partial');
    expect(result.balance).toBe(20000);
  });
});

describe('data-quality exceptions', () => {
  it('finds procedure, missing-case, total and opening-balance issues', () => {
    const issues = findLedgerIssues(
      [
        row({ clinicalMismatch: true, procedure: 'Zirconia Crown', caseProcedure: 'Night Guard' }),
        row({ id: 'led-2', voucherNumber: 'INV-0043', caseNumber: undefined, debit: 20000, balance: 50000 }),
      ],
      [{ id: 'inv-1', invoice_number: 'INV-0042', final_amount: 28000 }],
      [{ voucherNumber: 'DR-0003', typeLabel: 'Debit Adjustment', amount: 5000 }],
    );
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['procedure-mismatch', 'missing-case', 'invoice-total-mismatch', 'opening-balance-review']),
    );
  });

  it('reports no exception for a consistent invoice', () => {
    expect(findLedgerIssues([row()], [{ id: 'inv-1', invoice_number: 'INV-0042', final_amount: 30000 }])).toEqual([]);
  });
});

describe('ledger CSV', () => {
  it('keeps money numeric and writes totals after the rows', () => {
    const rows = buildLedgerCsvRows([row()], summary, {
      clinicLabel: 'Cases Clinic',
      periodLabel: 'All Time',
      accountLabel: '1100 · Accounts Receivable',
      generatedOn: '2026-10-20',
      settlementByRow: { 'led-1': 'Unpaid - PKR 30,000.00 outstanding' },
    });
    expect(rows).toContainEqual([
      'TOTAL PERIOD ACTIVITY', '', '', '', '', 30000, 0, 30000,
    ]);
    expect(rows).toContainEqual([
      '03-Oct-2026', 'INV-0042', 'DS-2001', 'Invoice', 'Invoice for Zirconia Crown',
      30000, 0, 30000, 'Unpaid - PKR 30,000.00 outstanding', '', '', '', '', '', '', '', '',
    ]);
  });
});

describe('ledger Excel workbook', () => {
  it('writes a real zipped OOXML workbook with transactions and summary', () => {
    const meta = {
      clinicLabel: 'Cases Clinic',
      periodLabel: 'All Time',
      accountLabel: '1100 · Accounts Receivable',
      generatedOn: '2026-10-20',
      settlementByRow: { 'led-1': 'Unpaid - PKR 30,000.00 outstanding' },
    };
    const bytes = buildLedgerXlsx([row()], summary, meta);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);

    const zip = unzipSync(bytes);
    expect(Object.keys(zip)).toEqual(expect.arrayContaining([
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
      'xl/styles.xml',
      'docProps/core.xml',
    ]));
    const ledger = strFromU8(zip['xl/worksheets/sheet1.xml']);
    expect(ledger).toContain('INV-0042');
    expect(ledger).toContain('TOTAL PERIOD ACTIVITY');
    expect(ledger).toContain('<v>30000</v>');
    expect(ledger).toContain('Unpaid - PKR 30,000.00 outstanding');
    const summarySheet = strFromU8(zip['xl/worksheets/sheet2.xml']);
    expect(summarySheet).toContain('Cases Clinic');
    expect(summarySheet).toContain('Closing balance');
    expect(strFromU8(zip['xl/workbook.xml'])).toContain('name="Ledger"');
  });
});

describe('PDF accessibility metadata', () => {
  it('declares a title, language, display-title preference and document info', () => {
    const result = buildLedgerReportPdf([row()], summary, {
      labName: 'Dental Lab',
      clinicLabel: 'Cases Clinic',
      periodLabel: 'All Time',
      accountName: 'Accounts Receivable',
      accountCode: '1100',
      generatedOn: '2026-10-20',
    });
    expect(result.pdf).toContain('/Lang (en-US)');
    expect(result.pdf).toContain('/DisplayDocTitle true');
    expect(result.pdf).toContain('/Tabs /S');
    expect(result.pdf).toContain('/Title (General Ledger - Cases Clinic - All Time)');
    expect(result.pdf).toContain('/Info');
    expect(result.pdf).not.toContain('OPENING-BALANCE REVIEW');
  });

  it('still builds through the async path when no Worker is available', async () => {
    const result = await buildLedgerReportPdfAsync([row()], summary, {
      labName: 'Dental Lab',
      clinicLabel: 'Cases Clinic',
      periodLabel: 'All Time',
      generatedOn: '2026-10-20',
    });
    expect(result.pageCount).toBe(1);
    expect(result.pdf).toContain('/Info');
  });
});