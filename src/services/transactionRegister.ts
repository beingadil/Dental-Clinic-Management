import type { AccountAdjustment, AdvancePayment, Invoice, PaymentRecord } from '../types';
import { formatDoctorName } from '../utils/doctorName';

/**
 * The payments register's rows, and the rules that decide which of them the
 * operator sees.
 *
 * These used to live inside TransactionRegister, which read the whole store
 * through `useApp` and filtered its own rows with its own search box, its own
 * date range and its own clinic picker — a second filter band directly under
 * the first one, answering a question the invoice table's filters had already
 * asked. The register now renders whatever it is handed: the page owns the
 * filters, and one query drives both lists (see BillingView). Keeping the
 * derivation here rather than in the component is what lets the search, the
 * clinic filter and the CSV export be exercised without a DOM.
 */

export type UnifiedTransactionType = 'payment' | 'advance' | 'adjustment';

export interface UnifiedTransaction {
  id: string;
  sourceType: UnifiedTransactionType;
  txnNumber: string;
  date: string;
  labId: string;
  labName: string;
  category: string;
  detail: string;
  referenceNumber?: string;
  method?: string;
  amount: number;
  direction: 'inflow' | 'credit' | 'debit' | 'refund';
  recordedBy: string;
  hasAttachments: boolean;
  attachmentsCount: number;
  rawPayment?: PaymentRecord;
  rawAdvance?: AdvancePayment;
  rawAdjustment?: AccountAdjustment;
  invoiceId?: string;
  invoiceNumber?: string;
  caseNumber?: string;
  isReversed?: boolean;
  /**
   * Lower-cased haystack: everything that identifies this row, including the
   * fields of the invoice it settled.
   *
   * One search box now drives the invoice table AND this register, so a query
   * has to be answered consistently by both. Typing a patient's name must
   * return their invoices and the payments against them, or the register would
   * silently contradict the table above it. Hence the invoice's own fields ride
   * along on the payment row even where the row does not print them.
   */
  searchText: string;
}

export interface RegisterFilters {
  search: string;
  fromDate: string;
  toDate: string;
  /** 'all', or a clinic id — the page's clinic filter, applied to the register too. */
  clinicId: string;
}

/** Lower-cased, space-joined haystack; empty entries drop out so nothing matches on whitespace. */
const haystack = (parts: (string | number | undefined | null)[]): string =>
  parts
    .filter((part) => part !== undefined && part !== null && part !== '')
    .map(String)
    .join(' ')
    .toLowerCase();

/**
 * Map every stored money document onto one feed, newest first.
 *
 * A payment, an advance deposit and a credit note are three tables in the
 * database and three screens in the operator's head only until they are on one
 * list; this is the list.
 */
export const buildUnifiedTransactions = (input: {
  allPayments: PaymentRecord[];
  advancePayments: AdvancePayment[];
  accountAdjustments: AccountAdjustment[];
  invoices: Invoice[];
}): UnifiedTransaction[] => {
  const { allPayments, advancePayments, accountAdjustments, invoices } = input;
  const list: UnifiedTransaction[] = [];

  const invoiceOf = (invoiceId?: string, invoiceNumber?: string): Invoice | undefined =>
    invoices.find((i) => i.id === invoiceId || (!!invoiceNumber && i.invoice_number === invoiceNumber));

  // 1. Invoice payments — one stored row per invoice a receipt paid.
  allPayments.forEach((pay) => {
    const matchedInv = invoiceOf(pay.invoice_id, pay.invoice_number);
    const isAdvanceAlloc = pay.payment_method === 'advance';
    list.push({
      id: pay.id,
      sourceType: 'payment',
      txnNumber: pay.payment_number || 'PAY-RCPT',
      date: pay.payment_date,
      labId: pay.lab_id || matchedInv?.lab_id || '',
      labName: pay.lab_name || matchedInv?.lab_name || 'Dental Clinic',
      category: isAdvanceAlloc ? 'Advance Credit Settlement' : 'Invoice Payment',
      detail: `Invoice ${pay.invoice_number || matchedInv?.invoice_number || ''} ${matchedInv?.case_number ? `(Case #${matchedInv.case_number})` : ''}`,
      referenceNumber: pay.reference_number,
      method: pay.payment_method,
      amount: pay.amount,
      direction: 'inflow',
      recordedBy: pay.recorded_by || 'Staff',
      hasAttachments: !!pay.attachments && pay.attachments.length > 0,
      attachmentsCount: pay.attachments?.length || 0,
      rawPayment: pay,
      invoiceId: pay.invoice_id,
      invoiceNumber: pay.invoice_number || matchedInv?.invoice_number,
      caseNumber: matchedInv?.case_number,
      isReversed: pay.is_reversed,
      searchText: haystack([
        pay.payment_number,
        pay.receipt_number,
        pay.reference_number,
        pay.payment_method,
        pay.payment_date,
        pay.amount,
        pay.recorded_by,
        pay.notes,
        pay.lab_name,
        matchedInv?.lab_name,
        matchedInv?.invoice_number,
        matchedInv?.case_number,
        matchedInv?.patient_name,
        matchedInv?.doctor_name,
        formatDoctorName(matchedInv?.doctor_name, ''),
        matchedInv?.case_type_name,
      ]),
    });
  });

  // 2. Advance deposits — clinic-level money held on account, no invoice yet.
  advancePayments.forEach((adv) => {
    list.push({
      id: adv.id,
      sourceType: 'advance',
      txnNumber: adv.payment_number,
      date: adv.payment_date,
      labId: adv.lab_id,
      labName: adv.lab_name,
      category: 'Advance Deposit',
      detail: `Remaining Credit: PKR ${(adv.remaining_amount || 0).toLocaleString()}`,
      referenceNumber: adv.reference_number,
      method: adv.payment_method,
      amount: adv.amount,
      direction: 'inflow',
      recordedBy: adv.recorded_by || 'Staff',
      hasAttachments: !!adv.attachments && adv.attachments.length > 0,
      attachmentsCount: adv.attachments?.length || 0,
      rawAdvance: adv,
      isReversed: adv.is_reversed,
      searchText: haystack([
        adv.payment_number,
        adv.receipt_number,
        adv.reference_number,
        adv.payment_method,
        adv.payment_date,
        adv.amount,
        adv.remaining_amount,
        adv.recorded_by,
        adv.notes,
        adv.lab_name,
        'advance deposit',
      ]),
    });
  });

  // 3. Account adjustments — credit notes, surcharges and refunds.
  accountAdjustments.forEach((adj) => {
    const matchedInv = invoiceOf(adj.invoice_id, adj.invoice_number);
    let catLabel = 'Credit Note';
    let dir: 'credit' | 'debit' | 'refund' = 'credit';
    if (adj.type === 'debit_adjustment') {
      catLabel = 'Debit Surcharge';
      dir = 'debit';
    } else if (adj.type === 'refund') {
      catLabel = 'Customer Refund';
      dir = 'refund';
    }

    list.push({
      id: adj.id,
      sourceType: 'adjustment',
      txnNumber: adj.adjustment_number,
      date: adj.date,
      labId: adj.lab_id,
      labName: adj.lab_name,
      category: catLabel,
      detail: adj.reason,
      referenceNumber: adj.reference_number,
      method: 'Adjustment',
      amount: adj.amount,
      direction: dir,
      recordedBy: adj.recorded_by || 'Staff',
      hasAttachments: !!adj.attachments && adj.attachments.length > 0,
      attachmentsCount: adj.attachments?.length || 0,
      rawAdjustment: adj,
      invoiceId: adj.invoice_id,
      invoiceNumber: adj.invoice_number || matchedInv?.invoice_number,
      caseNumber: matchedInv?.case_number,
      isReversed: adj.is_reversed,
      searchText: haystack([
        adj.adjustment_number,
        adj.credit_note_number,
        adj.reference_number,
        adj.type,
        adj.reason,
        adj.date,
        adj.amount,
        adj.recorded_by,
        adj.lab_name,
        matchedInv?.invoice_number,
        matchedInv?.case_number,
        matchedInv?.patient_name,
        matchedInv?.doctor_name,
        formatDoctorName(matchedInv?.doctor_name, ''),
        matchedInv?.case_type_name,
      ]),
    });
  });

  // Newest first. Dates compare on the calendar day only, and the sort is
  // stable, so rows posted the same day keep their stored order.
  return list.sort((a, b) => b.date.slice(0, 10).localeCompare(a.date.slice(0, 10)));
};

/**
 * The page's filters, applied to the register.
 *
 * The date comparison is the same one the register has always used — `day <
 * from` / `day > to` on a `YYYY-MM-DD` slice, which works on the stored
 * `YYYY-MM-DD HH:mm` values too (tests/services/localDayRegression.test.ts pins
 * the local-day behaviour this depends on).
 */
export const filterUnifiedTransactions = (
  rows: UnifiedTransaction[],
  filters: RegisterFilters,
): UnifiedTransaction[] => {
  const query = filters.search.trim().toLowerCase();
  return rows.filter((txn) => {
    const day = txn.date.slice(0, 10);
    if (filters.fromDate && day < filters.fromDate) return false;
    if (filters.toDate && day > filters.toDate) return false;
    if (filters.clinicId !== 'all' && txn.labId !== filters.clinicId) return false;
    if (query && !txn.searchText.includes(query)) return false;
    return true;
  });
};

/**
 * The register as CSV rows, headers first.
 *
 * Quoting is left to services/csvExport (RFC-4180), which the hand-rolled
 * version here did not follow — and which also routes through the Tauri save
 * dialog, so the export actually writes a file in the desktop build instead of
 * being silently ignored.
 */
export const transactionCsvRows = (rows: UnifiedTransaction[]): (string | number)[][] => [
  ['Transaction #', 'Date', 'Dental Clinic', 'Type / Category', 'Detail / Notes', 'Method', 'Reference #', 'Amount (PKR)', 'Staff'],
  ...rows.map((txn) => [
    txn.txnNumber,
    txn.date,
    txn.labName,
    txn.category,
    txn.detail,
    txn.method || '',
    txn.referenceNumber || '',
    txn.amount,
    txn.recordedBy,
  ]),
];
