import { describe, it, expect } from 'vitest';
import { buildLedgerReportPdf, planLedgerPagination } from '../src/lib/ledgerPdf';
import type { LedgerReportRow, LedgerReportSummary } from '../src/services/ledgerReport';

const row = (overrides: Partial<LedgerReportRow> = {}): LedgerReportRow => ({
  id: 'x', date: '2026-01-01', dateLabel: '01-Jan-2026', type: 'invoice', typeLabel: 'Invoice', voucherNumber: 'INV-0001',
  relatedInvoiceNumber: undefined, caseNumber: 'DS-0001', clinicId: 'c1', clinicName: 'Clinic',
  patientName: 'Farzana Yaseen', patientId: 'p1', procedure: 'Zirconia', teeth: '#11,#12',
  shade: 'A2', units: 1, receivedDate: '2026-01-01', deliveryDate: '2026-01-15',
  narration: 'INV-0001 | Case DS-0001 | Invoice for Zirconia | Patient: Farzana Yaseen | Teeth: #11,#12,#13,#14,#15,#21,#22,#23,#24,#25 | Shade: A2',
  bodyNarration: 'Invoice for Zirconia | Patient: Farzana Yaseen | Teeth: #11,#12,#13,#14,#15,#21,#22,#23,#24,#25 | Shade: A2',
  debit: 3000, credit: 0, balance: 3000, ...overrides,
});

const meta = {
  labName: 'Dental Solutions Pro', clinicLabel: 'Test Clinic', periodLabel: 'All Time',
  accountName: 'Accounts Receivable', accountCode: '1100', generatedOn: '2026-11-26',
};

const summary: LedgerReportSummary = {
  openingBalance: 0, totalDebits: 3000, totalCredits: 3000, closingBalance: 0, transactionCount: 3,
};

describe('buildLedgerReportPdf', () => {
  it('produces a valid PDF header with >=1 page', () => {
    const rows = [row(), row({ id: 'p1', type: 'payment', typeLabel: 'Payment Received', voucherNumber: 'PAY-2026-0005', relatedInvoiceNumber: 'INV-0001', debit: 0, credit: 2000, balance: 1000 }), row({ id: 'p2', type: 'payment', typeLabel: 'Payment Received', voucherNumber: 'PAY-2026-0006', relatedInvoiceNumber: 'INV-0001', debit: 0, credit: 1000, balance: 0 })];
    const { pdf, pageCount } = buildLedgerReportPdf(rows, summary, meta);
    expect(pdf.startsWith('%PDF')).toBe(true);
    expect(pageCount).toBeGreaterThan(0);
  });

  it('contains voucher numbers and case numbers as separate text', () => {
    const rows = [row({ voucherNumber: 'PAY-2026-0050', caseNumber: 'DS-0001' }), row({ voucherNumber: 'PAY-2026-0050', caseNumber: 'DS-0002', id: 'p2' })];
    const { pdf } = buildLedgerReportPdf(rows, summary, meta);
    expect(pdf).toContain('PAY-2026-0050');
    expect(pdf).toContain('DS-0001');
    expect(pdf).toContain('DS-0002');
  });

  it('contains closing balance and grand total once', () => {
    const { pdf } = buildLedgerReportPdf([row(), row({ id: 'p1', type: 'payment', debit: 0, credit: 1000, balance: 2000 })], summary, meta);
    expect(pdf).toContain('3,000.00');
    expect(pdf).toContain('CLOSING BALANCE');
  });

  it('handles a long narration without an empty trailing page', () => {
    const long = 'INV-0092 | Case DS-0092 | Invoice for Zirconia Crown Full Contour Layered Crown | Patient: A Patient With A Very Long Name Here | Teeth: #11,#12,#13,#14,#15,#16,#17,#18,#21,#22,#23,#24,#25,#26,#27,#28,#31,#32,#33,#34,#35,#36,#37,#38,#41,#42,#43,#44,#45,#46,#47,#48 | Shade: A2';
    const rows = [row({ narration: long }), ...Array.from({ length: 60 }, (_, i) => row({ id: `r${i}`, narration: `entry ${i}`, debit: 100, balance: 100 * (i + 1) }))];
    const { pageCount } = buildLedgerReportPdf(rows, { ...summary, totalDebits: 7000, closingBalance: 7000 }, meta);
    expect(pageCount).toBeGreaterThan(0);
    // page count should be sane: ~61 rows / ~40 per page => 2-3 pages, not dozens
    expect(pageCount).toBeLessThan(20);
  });

  it('fills the 49-row statement into two portrait pages with the summary last', () => {
    const rows = Array.from({ length: 49 }, (_, i) => row({
      id: `r${i}`,
      voucherNumber: i % 3 === 0 ? 'INV-0054' : `PAY-2026-${String(i).padStart(4, '0')}`,
      caseNumber: i % 3 === 0 ? 'DS-0027' : 'DS-0092',
      type: i % 3 === 0 ? 'invoice' : 'payment',
      typeLabel: i % 3 === 0 ? 'Invoice' : 'Cash Receipt',
      debit: i % 3 === 0 ? 1000 : 0,
      credit: i % 3 === 0 ? 0 : 1000,
      balance: 1000,
    }));
    const { pdf, pageCount } = buildLedgerReportPdf(rows, {
      openingBalance: 0, totalDebits: 17000, totalCredits: 32000, closingBalance: -15000,
      transactionCount: 49,
      openingBalanceReview: [{ voucherNumber: 'DR-0003', typeLabel: 'Debit Adjustment', amount: 40000 }],
    }, meta);
    expect(pageCount).toBe(2);
    expect(pdf.match(/\/MediaBox \[0 0 595 842\]/g)).toHaveLength(2);
    expect(pdf.split('49 TRANSACTIONS')).toHaveLength(2);
    expect(pdf).toContain('INV-0054');
    expect(pdf).toContain('PAY-2026-0001');
    expect(pdf).toContain('DS-0027');
    expect(pdf).toContain('DS-0092');
    const pageStreams = Array.from(pdf.matchAll(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)).map((m) => m[2]);
    expect(pageStreams).toHaveLength(2);
    expect(pageStreams[0]).not.toContain('49 TRANSACTIONS');
    expect(pageStreams[1]).toContain('49 TRANSACTIONS');
    expect(pageStreams[1]).toContain('ACCOUNT SUMMARY');
    expect(pdf).not.toContain('OPENING-BALANCE REVIEW');
    expect(pdf).not.toContain('\u2026');
  });

  it('rebalances only when the natural last page has three rows or fewer', () => {
    const heights = Array(49).fill(20);

    const natural = planLedgerPagination(heights, {
      firstTop: 590, contTop: 590, bottom: 0, summaryNeed: 40,
    });
    expect(natural.pageRows).toEqual([29, 20]);
    expect(natural.rebalance).toBe(false);
    expect(natural.rowsPerPage).toBe(Number.POSITIVE_INFINITY);

    const orphaned = planLedgerPagination(heights, {
      firstTop: 460, contTop: 460, bottom: 0, summaryNeed: 40,
    });
    expect(orphaned.pageRows).toEqual([23, 23, 3]);
    expect(orphaned.rebalance).toBe(true);
    expect(orphaned.rowsPerPage).toBe(17);
  });
});
