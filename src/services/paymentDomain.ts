import type { Invoice, PaymentRecord, PaymentAllocation, SavedVoucher, JournalEntry, AppNotification } from '../types';
import { buildPaymentJournal } from './financeDomain';

/**
 * Payment domain — the single home for payment-posting business rules that
 * used to live inline in AppContext call sites (audit finding F3: three
 * near-identical record-payment flows). Pure functions only: no React, no DB.
 */

/** Authoritative payment-status derivation from amounts (used by every write path). */
export const deriveSimpleStatus = (
  amountPaid: number,
  finalAmount: number,
): 'unpaid' | 'partial' | 'paid' => (amountPaid >= finalAmount ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid');

/** Recompute an invoice's paid total + status from its payment list. */
export const deriveInvoicePaidState = (inv: Invoice): { amount_paid: number; payment_status: Invoice['payment_status'] } => {
  const amount_paid = (inv.payments || []).reduce((sum, p) => sum + p.amount, 0);
  return { amount_paid, payment_status: deriveSimpleStatus(amount_paid, inv.final_amount) };
};

export interface BuildPaymentSideEffectsInput {
  payment: PaymentRecord;
  invoice: Invoice;
  actor: string;
}

/** The standard single-invoice allocation shape (shared by every entry point). */
export const buildInvoiceAllocation = ({ payment, invoice, actor }: BuildPaymentSideEffectsInput): PaymentAllocation => ({
  id: `alloc-${payment.id}`,
  source_type: 'payment',
  source_id: payment.id,
  source_ref: payment.payment_number || '',
  invoice_id: invoice.id,
  invoice_number: invoice.invoice_number,
  amount: payment.amount,
  allocated_at: payment.created_at || new Date().toISOString(),
  allocated_by: actor,
});

/**
 * Build the standard posting side effects for one invoice payment: the
 * balanced journal (cash/bank debit vs A/R credit) and the auto-logged
 * voucher. Mutation contract: the caller stamps `payment.journal_id` with
 * `journal.id` (same as the invoice-issuance pairing).
 */
export const buildPaymentSideEffects = (input: BuildPaymentSideEffectsInput): { journal: JournalEntry; voucher: Omit<SavedVoucher, 'id' | 'created_at' | 'saved_by'> } => {
  const { payment, invoice, actor } = input;
  const journal = buildPaymentJournal(payment, [buildInvoiceAllocation(input)], 0, actor);

  const voucher = {
    voucher_number: payment.payment_number || '',
    voucher_type: 'invoice' as const,
    case_id: invoice.case_id || '',
    case_number: invoice.case_number || '',
    lab_name: invoice.lab_name,
    doctor_name: invoice.doctor_name || '',
    patient_name: invoice.patient_name || '',
    case_type_name: invoice.case_type_name,
    amount: payment.amount,
    notes: payment.notes || `Payment ${payment.payment_method}${payment.reference_number ? ` · ref ${payment.reference_number}` : ''} on ${invoice.invoice_number}`,
  };

  return { journal, voucher };
};

/** Paid-in-full notification (shared wording across all payment entry points). */
export const buildPaidInFullNotification = (payment: PaymentRecord, invoice: Invoice): AppNotification => ({
  id: `notif-paid-${invoice.id}-${payment.id}`,
  type: 'system',
  title: `Invoice ${invoice.invoice_number} Paid in Full`,
  message: `Payment of PKR ${Math.round(payment.amount).toLocaleString()} received for ${invoice.lab_name}. Invoice is fully settled.`,
  invoice_id: invoice.id,
  lab_id: invoice.lab_id,
  is_read: false,
  is_archived: false,
  created_at: new Date().toISOString().replace('T', ' ').substring(0, 16),
});
