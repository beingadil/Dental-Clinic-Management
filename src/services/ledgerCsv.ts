import type { LedgerReportRow, LedgerReportSummary } from './ledgerReport';
import { toCSV } from './csvExport';

export interface LedgerCsvMeta {
  clinicLabel: string;
  periodLabel: string;
  accountLabel: string;
  generatedOn: string;
  /** Settlement wording as of each row's date, keyed by row id. */
  settlementByRow?: Record<string, string>;
}

export const LEDGER_EXPORT_HEADERS = [
  'Date',
  'Voucher',
  'Case',
  'Type',
  'Description',
  'Debit (PKR)',
  'Credit (PKR)',
  'Balance (PKR)',
  'Settlement',
  'Procedure',
  'Patient',
  'Teeth',
  'Shade',
  'Received',
  'Delivery',
  'Payment method',
  'Allocations',
];

const csvCell = (value: string | number | null | undefined): string | number =>
  value === null || value === undefined ? '' : value;

export function ledgerExportRows(
  rows: LedgerReportRow[],
  settlementByRow: Record<string, string> = {},
): (string | number)[][] {
  return rows.map((row) => [
    row.dateLabel || row.date,
    row.voucherNumber,
    row.caseNumber || '',
    row.typeLabel,
    row.bodyNarration || row.narration || '',
    row.debit,
    row.credit,
    row.balance,
    settlementByRow[row.id] || '',
    row.procedure || '',
    row.patientName || '',
    row.teeth || '',
    row.shade || '',
    row.receivedDate || '',
    row.deliveryDate || '',
    row.paymentMethod || '',
    (row.allocations || [])
      .map((allocation) => `${allocation.invoiceNumber || ''} ${allocation.amount}`.trim())
      .join(' | '),
  ]);
}

/**
 * One spreadsheet-ready table. Money stays numeric (not formatted with a
 * currency prefix) so Excel can sum the debit/credit columns immediately.
 * Metadata sits above the header block, leaving the transaction table intact
 * for filtering and pivoting.
 */
export function buildLedgerCsvRows(
  rows: LedgerReportRow[],
  summary: LedgerReportSummary,
  meta: LedgerCsvMeta,
): (string | number)[][] {
  const body = ledgerExportRows(rows, meta.settlementByRow);

  return [
    ['General Ledger', meta.clinicLabel],
    ['Period', meta.periodLabel],
    ['Account', meta.accountLabel],
    ['Generated', meta.generatedOn],
    [],
    LEDGER_EXPORT_HEADERS,
    ...body,
    [],
    ['TOTAL PERIOD ACTIVITY', '', '', '', '', summary.totalDebits, summary.totalCredits, summary.closingBalance],
    ['TRANSACTIONS', summary.transactionCount],
    ['OPENING BALANCE', '', '', '', '', '', '', summary.openingBalance],
    ['CLOSING BALANCE', '', '', '', '', '', '', summary.closingBalance],
  ].map((row) => row.map(csvCell));
}

export function buildLedgerCsv(
  rows: LedgerReportRow[],
  summary: LedgerReportSummary,
  meta: LedgerCsvMeta,
): string {
  return toCSV(buildLedgerCsvRows(rows, summary, meta));
}