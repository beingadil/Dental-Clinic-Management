import type { Invoice, PaymentRecord, PaymentAllocation, SavedVoucher, JournalEntry } from '../types';
import { buildPaymentJournal } from './financeDomain';
import { getNowStamp } from '../utils/dateUtils';

/**
 * Payment domain — the single home for payment-posting business rules that
 * used to live inline in AppContext call sites (audit finding F3: three
 * near-identical record-payment flows). Pure functions only: no React, no DB.
 */

/** Authoritative payment-status derivation is inlined in each write path and
 *  was duplicated here; see the note above. */
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
  allocated_at: payment.created_at || getNowStamp(),
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
  const journal = buildPaymentJournal(payment, [buildInvoiceAllocation(input)], 0, actor, {
    case_id: invoice.case_id,
    case_number: invoice.case_number,
  });

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
