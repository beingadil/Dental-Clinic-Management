import type { Invoice, PaymentRecord } from '../types';
import { round2 } from './ledgerReport';

export type SettlementStatus = 'paid' | 'partial' | 'unpaid';

export interface SettlementAsOf {
  status: SettlementStatus;
  /** Outstanding after payments and credits dated on or before the row date. */
  balance: number;
  paid: number;
  credited: number;
  /** Date of the last payment that was already posted on the row date. */
  paidOn?: string;
}

export interface SettlementCredit {
  amount: number;
  clinicLevel: boolean;
  adjustment: { date?: string; created_at?: string };
}

const day = (value?: string): string => String(value || '').slice(0, 10);

/**
 * Invoice settlement as it stood on a ledger row's business date.
 *
 * Reading today's `amount_paid` into a historical invoice row makes the row
 * claim an invoice was settled before the receipt that settled it existed. So
 * payments and attributed credits are filtered to `asOf` and re-summed.
 *
 * Legacy invoices without payment records fall back to their stored totals;
 * there is no dated evidence to replay, and pretending they are unpaid would
 * be a worse statement than the one the books already carry.
 */
export function settlementAsOf(
  invoice: Pick<Invoice, 'final_amount' | 'amount_paid' | 'credit_notes_total'> & {
    payments?: Pick<PaymentRecord, 'amount' | 'payment_date'>[];
  },
  asOf: string,
  credits: SettlementCredit[] = [],
): SettlementAsOf {
  const cutoff = day(asOf);
  const payments = invoice.payments || [];
  const datedPayments = payments.filter((payment) => {
    const paidOn = day(payment.payment_date);
    return !paidOn || !cutoff || paidOn <= cutoff;
  });
  const paid = payments.length
    ? round2(datedPayments.reduce((sum, payment) => sum + (payment.amount || 0), 0))
    : round2(invoice.amount_paid || 0);

  const datedCredits = credits.filter((credit) => {
    if (credit.clinicLevel) return false;
    const creditedOn = day(credit.adjustment.date || credit.adjustment.created_at);
    return !creditedOn || !cutoff || creditedOn <= cutoff;
  });
  const credited = credits.length
    ? round2(datedCredits.reduce((sum, credit) => sum + (credit.amount || 0), 0))
    : round2(invoice.credit_notes_total || 0);

  const balance = round2((invoice.final_amount || 0) - paid - credited);
  const status: SettlementStatus = balance <= 0 ? 'paid' : paid > 0 || credited > 0 ? 'partial' : 'unpaid';
  const paidOn = balance <= 0
    ? datedPayments
        .map((payment) => day(payment.payment_date))
        .filter(Boolean)
        .sort()
        .pop()
    : undefined;

  return { status, balance, paid, credited, paidOn };
}