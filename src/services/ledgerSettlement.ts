import type { Invoice, PaymentRecord } from '../types';
import { invoiceBalanceDue } from './financeDomain';

export type SettlementStatus = 'paid' | 'partial' | 'unpaid';

export interface InvoiceSettlement {
  status: SettlementStatus;
  /** `invoiceBalanceDue` — the same number the invoice table and the printed invoice read. */
  balance: number;
  /** Money received, as the invoice records it. */
  paid: number;
  /** Credit notes applied to the invoice. */
  credited: number;
  /** Date of the latest receipt, when the invoice is settled. */
  paidOn?: string;
}

const day = (value?: string): string => String(value || '').slice(0, 10);

/** The newest date among the receipts against an invoice. */
const latestPaymentDay = (
  payments: Pick<PaymentRecord, 'payment_date'>[],
): string | undefined =>
  payments
    .map((payment) => day(payment.payment_date))
    .filter(Boolean)
    .sort()
    .pop();

/**
 * Invoice settlement for a General Ledger row.
 *
 * THE SAME RULE AS EVERY OTHER SURFACE, by construction: the balance is
 * `invoiceBalanceDue` (total minus received minus credit notes, clamped at
 * zero) and the status mirrors the printed invoice — settled, partly received,
 * or unpaid. A private arithmetic here would let the ledger call an invoice
 * Paid on a rule the invoice table does not use, so the two rows an operator
 * checks side by side could disagree.
 *
 * The stored `payment_status` is still not read: it drifts after a credit note
 * or a corrected payment, while the balance does not.
 */
export function settlementOf(
  invoice: Pick<Invoice, 'final_amount' | 'amount_paid' | 'credit_notes_total'> & {
    payments?: Pick<PaymentRecord, 'payment_date'>[];
  },
): InvoiceSettlement {
  const balance = invoiceBalanceDue(invoice);
  const paid = invoice.amount_paid || 0;
  const credited = invoice.credit_notes_total || 0;
  const status: SettlementStatus = balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  const paidOn = balance <= 0 ? latestPaymentDay(invoice.payments || []) : undefined;

  return { status, balance, paid, credited, paidOn };
}
