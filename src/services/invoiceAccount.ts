import type {
  AccountAdjustment,
  AdvancePayment,
  DentalLab,
  Invoice,
  PaymentRecord,
} from '../types';
import { roundMoney } from './financeDomain';
import { isAdvanceAppliedPayment } from './monthlyStatement';
import { getTodayStr } from '../utils/dateUtils';

/**
 * The clinic's account position around one invoice, or for a statement period.
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
 * Two rules keep the printed statement reconcilable:
 *
 *  1. The opening balance is dated, never derived. It is every posting strictly
 *     before the period start, so a receipt banked inside the period can never
 *     be pulled backwards and printed as "opening credit". The old batch code
 *     built the opening by removing the selected invoices from TODAY'S net
 *     balance, which moved the closing correctly but invented an opening.
 *
 *  2. A receipt is posted once, when it is received. An advance deposit posts
 *     a credit when it is banked; applying it to an invoice is a 0/0 memo. So
 *     the receipt belongs in "Advance received this period" and the application
 *     is shown as a note that changes no figure.
 */
export interface InvoiceAccountPosition {
  /** Balance brought forward: every posting strictly before the period start. */
  openingBalance: number;
  /**
   * Advance already held at the period start and included INSIDE
   * `openingBalance`. Printed as a child line so the reader can see the deposit
   * without adding it a second time.
   */
  advanceDeposit: number;
  /** Advance credit applied to these invoices in the period (a 0/0 memo). */
  advanceApplied: number;
  /** Invoices raised in the period (or this invoice on a single invoice). */
  invoiceAmount: number;
  /** Cash / bank / cheque received in the period, excluding advance allocations. */
  cashPaid: number;
  /** Advance deposits received in the period. */
  advanceReceived: number;
  /** Credit notes posted in the period. */
  creditNotes: number;
  /** Debit adjustments / refunds posted in the period. */
  debitNotes: number;
  /** Opening + invoices − receipts − advances − credit notes + debit notes. */
  closingBalance: number;
  /**
   * Advance still unallocated at the period end. It is money held on account:
   * the balance may already be reduced by it (when it was received in the
   * period) but the invoices it could settle still show as unpaid.
   */
  unallocatedAdvance: number;
  /** The window this position was measured over; null for a single invoice. */
  period?: { from: string; to: string } | null;
}

export interface InvoiceAccountInput {
  invoice: Invoice;
  invoices?: Invoice[] | null;
  advancePayments?: AdvancePayment[] | null;
  accountAdjustments?: AccountAdjustment[] | null;
  labs?: Pick<DentalLab, 'id' | 'opening_balance' | 'opening_balance_type' | 'created_at'>[] | null;
}

export interface StatementAccountInput {
  /** The clinic the statement is for. */
  labId: string;
  /**
   * Every invoice the clinic has, not only the rows printed. The statement's
   * movement lines cover the whole period; the table is the detail the
   * operator chose to print.
   */
  invoices?: Invoice[] | null;
  /**
   * When set, only these invoices count toward the printed "bill" (invoice
   * amount) line; the rest of the account position still covers the whole
   * period. Omit to count every invoice in the period.
   */
  selectedInvoiceIds?: string[] | null;
  advancePayments?: AdvancePayment[] | null;
  accountAdjustments?: AccountAdjustment[] | null;
  labs?: Pick<DentalLab, 'id' | 'opening_balance' | 'opening_balance_type' | 'created_at'>[] | null;
  /** 'YYYY-MM-DD'. Empty means unbounded on that side. */
  period: { from: string; to: string };
}

// ─────────────────────────────────────────────────────────────── day helpers

const dayOf = (value?: string): string => {
  const match = (value || '').trim().match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
};

const invoiceDayOf = (invoice: Invoice): string =>
  dayOf(invoice.created_at) || dayOf(invoice.issue_date) || getTodayStr();

const paymentDayOf = (payment: PaymentRecord, invoice: Invoice): string =>
  dayOf(payment.payment_date) || invoiceDayOf(invoice);

const advanceDayOf = (advance: AdvancePayment): string =>
  dayOf(advance.payment_date) || dayOf(advance.created_at) || getTodayStr();

const adjustmentDayOf = (adjustment: AccountAdjustment): string =>
  dayOf(adjustment.date) || dayOf(adjustment.created_at) || getTodayStr();

type LabPick = Pick<DentalLab, 'id' | 'opening_balance' | 'opening_balance_type' | 'created_at'>;

type Posting = {
  day: string;
  /** The ledger effect: debit increases what the clinic owes, credit reduces it. */
  debit: number;
  credit: number;
  type: 'opening' | 'invoice' | 'payment' | 'advance' | 'credit_note' | 'debit_note';
  invoiceId?: string;
  advanceId?: string;
};

/** Advance-allocation payments are 0/0 memos in the ledger. */
const isAllocation = (payment: PaymentRecord): boolean => isAdvanceAppliedPayment(payment);

/**
 * Every posting that can move a clinic's receivable, in the same shape and with
 * the same business dates as `buildLedgerEntries`.
 *
 * Kept local rather than calling the engine because the statement also needs
 * the *components* of each period movement (invoices, receipts, deposits,
 * notes) and a historical unallocated-advance figure — the engine publishes a
 * running balance, not that breakdown. The day rules are the engine's own:
 * invoices post at `created_at` (not the rewritten issue date), deposits and
 * payments at their business date, and an opening balance at the clinic's
 * creation so it lands before every invoice.
 */
const buildPostings = (input: {
  labId: string;
  invoices?: Invoice[] | null;
  advancePayments?: AdvancePayment[] | null;
  accountAdjustments?: AccountAdjustment[] | null;
  lab?: LabPick | null;
}): Posting[] => {
  const { labId, invoices, advancePayments, accountAdjustments, lab } = input;
  const postings: Posting[] = [];

  const opening = lab?.opening_balance || 0;
  if (opening > 0) {
    postings.push({
      /* A clinic's opening balance is money carried in BEFORE the system, so
         it belongs in every period's brought-forward figure. Dating it at
         `created_at` (as the ledger engine does) would make a statement that
         covers the clinic's first month print it as an unexplained movement
         with no line to show it. */
      day: '0000-01-01',
      debit: lab?.opening_balance_type === 'credit' ? 0 : opening,
      credit: lab?.opening_balance_type === 'credit' ? opening : 0,
      type: 'opening',
    });
  }

  (invoices || []).forEach((invoice) => {
    if (invoice.lab_id !== labId) return;
    postings.push({
      day: invoiceDayOf(invoice),
      debit: invoice.final_amount || 0,
      credit: 0,
      type: 'invoice',
      invoiceId: invoice.id,
    });
    (invoice.payments || []).forEach((payment) => {
      if (isAllocation(payment)) return; // the deposit already posted the credit
      postings.push({
        day: paymentDayOf(payment, invoice),
        debit: 0,
        credit: payment.amount || 0,
        type: 'payment',
        invoiceId: invoice.id,
      });
    });
  });

  (advancePayments || []).forEach((advance) => {
    if (advance.lab_id !== labId) return;
    postings.push({
      day: advanceDayOf(advance),
      debit: 0,
      credit: advance.amount || 0,
      type: 'advance',
      advanceId: advance.id,
    });
  });

  (accountAdjustments || []).forEach((adjustment) => {
    if (adjustment.lab_id !== labId) return;
    const isCredit = adjustment.type === 'credit_note';
    postings.push({
      day: adjustmentDayOf(adjustment),
      debit: isCredit ? 0 : adjustment.amount || 0,
      credit: isCredit ? adjustment.amount || 0 : 0,
      type: isCredit ? 'credit_note' : 'debit_note',
      invoiceId: adjustment.invoice_id,
    });
  });

  return postings;
};

const effectOf = (posting: Posting): number => (posting.debit || 0) - (posting.credit || 0);

const sumPostings = (postings: Posting[], keep: (posting: Posting) => boolean): number =>
  roundMoney(postings.reduce((sum, posting) => (keep(posting) ? sum + effectOf(posting) : sum), 0));

const sumType = (
  postings: Posting[],
  type: Posting['type'],
  keep: (posting: Posting) => boolean = () => true,
): number =>
  roundMoney(
    postings.reduce(
      (sum, posting) =>
        posting.type === type && keep(posting) ? sum + (posting.debit || posting.credit || 0) : sum,
      0,
    ),
  );

/** Every advance application dated before (or up to) a day, across all invoices. */
const advanceApplications = (
  invoices: Invoice[] | null | undefined,
  keep: (day: string, payment: PaymentRecord) => boolean,
): number => {
  let total = 0;
  (invoices || []).forEach((invoice) => {
    (invoice.payments || []).forEach((payment) => {
      if (!isAllocation(payment)) return;
      if (keep(paymentDayOf(payment, invoice), payment)) total += payment.amount || 0;
    });
  });
  return roundMoney(total);
};

/** Unallocated advance held at a date: deposits received − applications made. */
const advanceWallet = (input: {
  labId: string;
  invoices?: Invoice[] | null;
  advancePayments?: AdvancePayment[] | null;
  /** Include every posting up to and including this day; '' = no upper bound. */
  through?: string;
  /** Only postings strictly before this day; '' = no lower bound. */
  before?: string;
}): number => {
  const { labId, invoices, advancePayments, through = '', before = '' } = input;
  let received = 0;
  (advancePayments || []).forEach((advance) => {
    if (advance.lab_id !== labId) return;
    const day = advanceDayOf(advance);
    if (before && day >= before) return;
    if (through && day > through) return;
    received += advance.amount || 0;
  });
  const applied = advanceApplications(invoices, (day) => {
    if (before && day >= before) return false;
    if (through && day > through) return false;
    return true;
  });
  return Math.max(0, roundMoney(received - applied));
};

const labOf = (labs: LabPick[] | null | undefined, labId: string): LabPick | null =>
  (labs || []).find((lab) => lab.id === labId) || null;

// ───────────────────────────────────────────────────────── single invoice

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
  const invoiceDay = invoiceDayOf(invoice);
  const postings = buildPostings({
    labId: invoice.lab_id,
    invoices,
    advancePayments,
    accountAdjustments,
    lab: labOf(labs, invoice.lab_id),
  });

  /* Opening = everything posted before the invoice day. Other invoices and
     notes dated on the same day are treated as already on the account (we
     cannot order two papers raised the same day), but RECEIPTS on the day are
     not: they are this period's money and are printed on their own line. That
     distinction is the bug the old block had — a same-day deposit was netted
     into the opening, so the sheet claimed the clinic was in credit before the
     invoice existed. */
  const sameDayCharges = roundMoney(
    postings.reduce((sum, posting) => {
      if (posting.day !== invoiceDay) return sum;
      if (posting.invoiceId === invoice.id) return sum;
      if (posting.type !== 'invoice' && posting.type !== 'credit_note' && posting.type !== 'debit_note') {
        return sum;
      }
      return sum + effectOf(posting);
    }, 0),
  );
  const opening = roundMoney(
    sumPostings(postings, (posting) => posting.day < invoiceDay) + sameDayCharges,
  );

  const invoiceAmount = roundMoney(invoice.final_amount || 0);

  /* Advance allocations to this invoice are memos: the deposit already posted
     the credit. The stored paid total is the invoice's truth, so only the
     advance slice is removed from cash. */
  const advanceApplied = advanceApplications(
    [invoice],
    () => true,
  );
  const cashPaid = roundMoney(Math.max(0, (invoice.amount_paid || 0) - advanceApplied));

  /* Deposits banked on the invoice day are receipts of this period, not
     opening credit. Deposits dated after the invoice are left out, matching
     the invoice's own as-at day. */
  const advanceReceived = sumType(
    postings,
    'advance',
    (posting) => posting.day === invoiceDay,
  );

  const tiedCredits = sumType(postings, 'credit_note', (posting) => posting.invoiceId === invoice.id);
  const tiedDebits = sumType(postings, 'debit_note', (posting) => posting.invoiceId === invoice.id);
  const creditNotes = roundMoney(invoice.credit_notes_total || tiedCredits);

  const closingBalance = roundMoney(
    opening + invoiceAmount - cashPaid - advanceReceived - creditNotes + tiedDebits,
  );

  /* Only the credit that is actually an advance deposit is labelled as such.
     A clinic can also be in credit from its own opening balance; that is still
     a credit opening, just not an advance. */
  const walletAtStart = advanceWallet({
    labId: invoice.lab_id,
    invoices,
    advancePayments,
    before: invoiceDay,
  });
  const advanceDeposit =
    opening < 0 ? roundMoney(Math.min(-opening, walletAtStart)) : 0;

  /* What is still in the wallet right now. `remaining_amount` is the stored,
     authoritative figure; fall back to the dated walk only for clinics whose
     advance rows predate that column. */
  const clinicAdvances = (advancePayments || []).filter(
    (advance) => advance.lab_id === invoice.lab_id,
  );
  const storedWallet = roundMoney(
    clinicAdvances.reduce(
      (sum, advance) =>
        sum +
        (typeof advance.remaining_amount === 'number'
          ? advance.remaining_amount
          : Math.max(0, (advance.amount || 0) - (advance.allocated_amount || 0))),
      0,
    ),
  );

  return {
    openingBalance: opening,
    advanceDeposit,
    advanceApplied: roundMoney(advanceApplied),
    invoiceAmount,
    cashPaid,
    advanceReceived,
    creditNotes,
    debitNotes: tiedDebits,
    closingBalance,
    unallocatedAdvance: Math.max(
      0,
      roundMoney(
        clinicAdvances.length > 0
          ? storedWallet
          : advanceWallet({
              labId: invoice.lab_id,
              invoices,
              advancePayments,
            }),
      ),
    ),
    period: { from: invoiceDay, to: invoiceDay },
  };
};

// ───────────────────────────────────────────────────── statement period

/**
 * The clinic's account position for a statement period.
 *
 * `openingBalance` is the ledger balance strictly before `from`; every movement
 * line is a posting inside `[from, to]`; `closingBalance` is their sum, which is
 * the same balance the General Ledger shows at `to`. Selecting or omitting rows
 * from the printed table never changes these figures — a statement is a
 * position, and the rows are the detail the operator chose to show.
 */
export const buildStatementAccountPosition = ({
  labId,
  invoices,
  selectedInvoiceIds,
  advancePayments,
  accountAdjustments,
  labs,
  period,
}: StatementAccountInput): InvoiceAccountPosition => {
  const from = dayOf(period?.from);
  const to = dayOf(period?.to);

  const selectedSet =
    selectedInvoiceIds && selectedInvoiceIds.length > 0
      ? new Set(selectedInvoiceIds)
      : null;

  const postings = buildPostings({
    labId,
    invoices,
    advancePayments,
    accountAdjustments,
    lab: labOf(labs, labId),
  });

  const inPeriod = (posting: Posting) =>
    (!from || posting.day >= from) && (!to || posting.day <= to);

  const openingBalance = sumPostings(postings, (posting) => !from || posting.day < from);
  const closingBalance = sumPostings(postings, (posting) => !to || posting.day <= to);

  const invoiceAmount = sumType(
    postings,
    'invoice',
    (posting) =>
      inPeriod(posting) &&
      (selectedSet === null || selectedSet.has(posting.invoiceId || '')),
  );
  const cashPaid = sumType(postings, 'payment', inPeriod);
  const advanceReceived = sumType(postings, 'advance', inPeriod);
  const creditNotes = sumType(postings, 'credit_note', inPeriod);
  const debitNotes = sumType(postings, 'debit_note', inPeriod);

  /* Applications are 0/0 memos, but the reader still needs to know how much of
     the period's invoices was settled from an earlier deposit. */
  const advanceApplied = advanceApplications(
    selectedSet
      ? (invoices || []).filter((inv) => selectedSet.has(inv.id))
      : invoices,
    (day) => {
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    },
  );

  const walletAtStart = from
    ? advanceWallet({ labId, invoices, advancePayments, before: from })
    : 0;
  const advanceDeposit =
    openingBalance < 0
      ? roundMoney(Math.min(-openingBalance, walletAtStart))
      : 0;

  const unallocatedAdvance = advanceWallet({
    labId,
    invoices,
    advancePayments,
    through: to || '',
  });

  return {
    openingBalance,
    advanceDeposit,
    advanceApplied,
    invoiceAmount,
    cashPaid,
    advanceReceived,
    creditNotes,
    debitNotes,
    closingBalance,
    unallocatedAdvance,
    period: { from, to },
  };
};
