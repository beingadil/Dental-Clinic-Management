import type {
  AccountAdjustment,
  AdvancePayment,
  DentalLab,
  Invoice,
} from '../types';
import { roundMoney } from './financeDomain';
import { isAdvanceAppliedPayment } from './monthlyStatement';
import { getTodayStr } from '../utils/dateUtils';

/**
 * The clinic's account position around one invoice.
 *
 * An invoice is not just its own line: a clinic that has left an advance
 * deposit with us is in credit before the invoice is raised, and the invoice
 * has to say so or the printed closing balance reads as if the deposit never
 * existed. The same applies the other way round — a clinic carrying unpaid
 * earlier invoices does not owe only today's work.
 *
 * The arithmetic follows the ledger's sign convention:
 *   positive = the clinic owes us (Dr), negative = we owe the clinic (Cr).
 *
 * Advance deposits are the one place a naive "invoice amount − paid" walk
 * double-counts. In the ledger a deposit posts as a credit when it is received
 * and an application to an invoice is a 0/0 memo; the deposit has already
 * moved the balance. So the opening balance carries the deposit, while
 * `cashPaid` deliberately excludes advance allocations. Applying the wallet to
 * this invoice therefore changes neither `openingBalance` nor `closingBalance`.
 */
export interface InvoiceAccountPosition {
  /** Balance brought forward before this invoice. Negative = credit. */
  openingBalance: number;
  /** Unallocated advance held at the start of the invoice day, shown as "we owe". */
  advanceDeposit: number;
  /** Advance credit applied to this invoice (a memo — already in opening). */
  advanceApplied: number;
  /** Net amount of this invoice. */
  invoiceAmount: number;
  /** Cash / bank / cheque received against this invoice (not advance allocations). */
  cashPaid: number;
  /** Credit notes applied to this invoice. */
  creditNotes: number;
  /** Opening + this invoice − cash paid − credit notes + invoice debit adjustments. */
  closingBalance: number;
}

export interface InvoiceAccountInput {
  invoice: Invoice;
  invoices?: Invoice[] | null;
  advancePayments?: AdvancePayment[] | null;
  accountAdjustments?: AccountAdjustment[] | null;
  labs?: Pick<DentalLab, 'id' | 'opening_balance' | 'opening_balance_type'>[] | null;
}

const dayOf = (value?: string): string => {
  const match = (value || '').trim().match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
};

/** Stored business dates are day-granular; compare them as ISO day keys. */
const onOrBefore = (value: string | undefined, limit: string): boolean => {
  const day = dayOf(value);
  return day !== '' && day <= limit;
};

/**
 * Build the invoice's opening/closing position from the same documents the
 * ledger posts. Grouped in one pure function so the print sheet, its tests and
 * any future screen read one definition instead of re-deriving the balance
 * with a slightly different walk.
 */
export const buildInvoiceAccountPosition = ({
  invoice,
  invoices,
  advancePayments,
  accountAdjustments,
  labs,
}: InvoiceAccountInput): InvoiceAccountPosition => {
  /* Booking day, not the printed issue date. `issue_date` is rewritten from a
     case's delivery date, so using it here would pull later invoices and
     advances into this invoice's opening balance. The ledger posts invoices at
     `created_at`; the account position has to use the same day. */
  const invoiceDay = dayOf(invoice.created_at) || dayOf(invoice.issue_date) || getTodayStr();

  const lab = (labs || []).find((item) => item.id === invoice.lab_id);
  const openingLab = lab?.opening_balance || 0;
  let opening = lab?.opening_balance_type === 'credit' ? -openingLab : openingLab;

  let priorCashPaid = 0;
  let priorAdvances = 0;
  let priorCredits = 0;
  let priorDebits = 0;
  let advanceApplied = 0;
  let advanceAppliedBeforeDay = 0;
  let tiedCredits = 0;
  let tiedDebits = 0;

  (invoices || []).forEach((other) => {
    if (other.lab_id !== invoice.lab_id) return;
    const isThis = other.id === invoice.id;

    if (!isThis) {
      if (!onOrBefore(other.created_at || other.issue_date, invoiceDay)) return;
      opening += other.final_amount || 0;
    }

    (other.payments || []).forEach((payment) => {
      const paymentDay = dayOf(payment.payment_date || other.created_at || other.issue_date);

      if (isAdvanceAppliedPayment(payment)) {
        if (isThis) advanceApplied += payment.amount || 0;
        // Same-day applications stay out of the wallet-at-issue subtraction:
        // the deposit was held when the invoice was raised. Earlier
        // applications already consumed their share of the wallet.
        if (paymentDay !== '' && paymentDay < invoiceDay) {
          advanceAppliedBeforeDay += payment.amount || 0;
        }
        return;
      }

      // An advance allocation is a memo, not cash: its deposit already posted
      // the credit, so subtracting it here would count the same money twice.
      if (isThis) return;
      if (!onOrBefore(payment.payment_date || other.created_at || other.issue_date, invoiceDay)) return;
      priorCashPaid += payment.amount || 0;
    });
  });

  (advancePayments || []).forEach((advance) => {
    if (advance.lab_id !== invoice.lab_id) return;
    if (!onOrBefore(advance.payment_date || advance.created_at, invoiceDay)) return;
    priorAdvances += advance.amount || 0;
  });

  (accountAdjustments || []).forEach((adjustment) => {
    if (adjustment.lab_id !== invoice.lab_id) return;

    if (adjustment.invoice_id === invoice.id) {
      if (adjustment.type === 'credit_note') tiedCredits += adjustment.amount || 0;
      else tiedDebits += adjustment.amount || 0;
      return;
    }

    if (!onOrBefore(adjustment.date || adjustment.created_at, invoiceDay)) return;
    if (adjustment.type === 'credit_note') priorCredits += adjustment.amount || 0;
    else priorDebits += adjustment.amount || 0;
  });

  opening = roundMoney(opening - priorCashPaid - priorAdvances - priorCredits + priorDebits);

  const invoiceAmount = roundMoney(invoice.final_amount || 0);
  /* The stored paid total is the invoice's truth; only the advance slice is
     removed, because that slice settled through the deposit already carried in
     the opening balance. */
  const cashPaid = roundMoney(Math.max(0, (invoice.amount_paid || 0) - advanceApplied));
  const creditNotes = roundMoney(invoice.credit_notes_total || tiedCredits);
  const closingBalance = roundMoney(
    opening + invoiceAmount - cashPaid - creditNotes + tiedDebits,
  );

  const walletAtIssue = roundMoney(priorAdvances - advanceAppliedBeforeDay);
  /* Only the net credit that is actually an advance deposit is labelled as
     such. A clinic can also be in credit from its own opening balance; that is
     still a credit opening, just not an advance. */
  const advanceDeposit = opening < 0
    ? roundMoney(Math.min(-opening, Math.max(0, walletAtIssue)))
    : 0;

  return {
    openingBalance: opening,
    advanceDeposit,
    advanceApplied: roundMoney(advanceApplied),
    invoiceAmount,
    cashPaid,
    creditNotes,
    closingBalance,
  };
};

export interface StatementAccountInput {
  /** The invoices included in the statement (the whole run, not one page). */
  invoices: Invoice[] | null;
  /** Clinic account balance after all invoices, payments, advances and adjustments. */
  netBalance: number;
  /** Unallocated advance wallet held for the clinic. */
  advanceBalance: number;
}

/**
 * The clinic's account position for a batch statement.
 *
 * A statement covers several invoices, so its "opening balance" is derived by
 * removing the selected invoices' own contribution (amount − paid − credit notes)
 * from the clinic's current balance. That keeps the closing line equal to the
 * clinic's true account balance while still showing what was brought forward.
 *
 * The same advance-deposit rule as a single invoice applies: the deposit is
 * already inside the opening balance, so `cashPaid` keeps the advance allocations
 * it already carries and the deposit is shown as a memo rather than subtracted a
 * second time.
 */
export const buildStatementAccountPosition = ({
  invoices,
  netBalance,
  advanceBalance,
}: StatementAccountInput): InvoiceAccountPosition => {
  const rows = invoices || [];

  const invoiceAmount = roundMoney(rows.reduce((sum, inv) => sum + (inv.final_amount || 0), 0));
  const cashPaid = roundMoney(rows.reduce((sum, inv) => sum + (inv.amount_paid || 0), 0));
  const creditNotes = roundMoney(rows.reduce((sum, inv) => sum + (inv.credit_notes_total || 0), 0));
  const advanceApplied = roundMoney(
    rows.reduce((sum, inv) => {
      return (
        sum +
        (inv.payments || [])
          .filter(isAdvanceAppliedPayment)
          .reduce((paymentSum, payment) => paymentSum + (payment.amount || 0), 0)
      );
    }, 0),
  );

  const openingBalance = roundMoney(netBalance - invoiceAmount + cashPaid + creditNotes);
  const closingBalance = roundMoney(netBalance);
  const advanceDeposit =
    openingBalance < 0
      ? roundMoney(Math.min(-openingBalance, Math.max(0, advanceBalance)))
      : 0;

  return {
    openingBalance,
    advanceDeposit,
    advanceApplied,
    invoiceAmount,
    cashPaid,
    creditNotes,
    closingBalance,
  };
};
