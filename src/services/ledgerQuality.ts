import type { LedgerReportRow, LedgerReportSummary } from './ledgerReport';
import { toCents } from './ledgerReport';

/**
 * Reconciliations an operator can act on before a statement leaves the lab.
 *
 * These are deliberately evidence-based: every issue names the posting and the
 * two values that disagree. The ledger never silently corrects a posting — it
 * surfaces the exception so the source document can be fixed.
 */
export type LedgerIssueSeverity = 'error' | 'warning';

export interface LedgerIssue {
  id: string;
  severity: LedgerIssueSeverity;
  code:
    | 'procedure-mismatch'
    | 'invoice-total-mismatch'
    | 'over-settled'
    | 'missing-case'
    | 'zero-posting'
    | 'negative-posting'
    | 'opening-balance-review';
  title: string;
  detail: string;
  voucherNumber: string;
  date: string;
  rowId?: string;
}

/** The invoice fields quality checks need; keeps this usable from tests. */
export interface LedgerQualityInvoice {
  id: string;
  invoice_number: string;
  final_amount: number;
  amount_paid?: number;
  credit_notes_total?: number;
  status_v2?: string;
}

const money = (n: number): string =>
  `PKR ${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const invoiceForRow = (row: LedgerReportRow, invoices: LedgerQualityInvoice[]) =>
  invoices.find(
    (inv) => inv.id === row.referenceId || inv.invoice_number === row.voucherNumber,
  );

export function findLedgerIssues(
  rows: LedgerReportRow[],
  invoices: LedgerQualityInvoice[] = [],
  openingReview: NonNullable<LedgerReportSummary['openingBalanceReview']> = [],
): LedgerIssue[] {
  const issues: LedgerIssue[] = [];
  const add = (issue: LedgerIssue) => {
    if (!issues.some((existing) => existing.id === issue.id)) issues.push(issue);
  };

  for (const row of rows) {
    const common = {
      voucherNumber: row.voucherNumber || '—',
      date: row.dateLabel || row.date,
      rowId: row.id,
    };

    if (row.clinicalMismatch) {
      add({
        ...common,
        id: `${row.id}:procedure-mismatch`,
        severity: 'warning',
        code: 'procedure-mismatch',
        title: 'Procedure differs from the case record',
        detail: `Invoice says ${row.procedure || '—'}; case says ${row.caseProcedure || '—'}.`,
      });
    }

    if (row.type === 'invoice') {
      if (!row.caseNumber) {
        add({
          ...common,
          id: `${row.id}:missing-case`,
          severity: 'warning',
          code: 'missing-case',
          title: 'Invoice has no case reference',
          detail: 'The posting cannot be tied to a job, so its procedure and teeth cannot be verified.',
        });
      }

      const invoice = invoiceForRow(row, invoices);
      if (invoice && invoice.status_v2 !== 'voided') {
        const debit = toCents(row.debit);
        const total = toCents(invoice.final_amount);
        if (Math.abs(debit - total) > 1) {
          add({
            ...common,
            id: `${row.id}:invoice-total-mismatch`,
            severity: 'error',
            code: 'invoice-total-mismatch',
            title: 'Invoice posting does not match the invoice total',
            detail: `Ledger debit ${money(row.debit)}; invoice ${invoice.invoice_number} total ${money(invoice.final_amount)}.`,
          });
        }

        const settled = toCents((invoice.amount_paid || 0) + (invoice.credit_notes_total || 0));
        if (settled > total + 1) {
          add({
            ...common,
            id: `${row.id}:over-settled`,
            severity: 'error',
            code: 'over-settled',
            title: 'Invoice is settled beyond its total',
            detail: `Settled ${money((invoice.amount_paid || 0) + (invoice.credit_notes_total || 0))}; invoice total ${money(invoice.final_amount)}.`,
          });
        }
      }
    }

    if (row.debit < 0 || row.credit < 0) {
      add({
        ...common,
        id: `${row.id}:negative-posting`,
        severity: 'error',
        code: 'negative-posting',
        title: 'Posting carries a negative amount',
        detail: `Debit ${money(row.debit)}; credit ${money(row.credit)}. Use the opposite side instead.`,
      });
    } else if (toCents(row.debit) === 0 && toCents(row.credit) === 0) {
      add({
        ...common,
        id: `${row.id}:zero-posting`,
        severity: 'warning',
        code: 'zero-posting',
        title: 'Posting has no value',
        detail: 'Both debit and credit are zero, so the row does not move the account.',
      });
    }
  }

  for (const review of openingReview) {
    add({
      id: `opening:${review.voucherNumber}`,
      severity: 'warning',
      code: 'opening-balance-review',
      title: 'Opening-balance posting needs review',
      detail: `${review.typeLabel} ${money(review.amount)} is a period transaction, not the brought-forward balance.`,
      voucherNumber: review.voucherNumber,
      date: '',
    });
  }

  return issues.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    return (a.date || '').localeCompare(b.date || '') || a.voucherNumber.localeCompare(b.voucherNumber);
  });
}