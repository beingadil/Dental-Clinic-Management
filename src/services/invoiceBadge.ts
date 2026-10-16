import type { Invoice } from '../types';
import { invoiceBalanceDue } from './financeDomain';
import { invoiceStatus } from '../components/print/printRenderer';

/**
 * What the Invoices table shows under Status, decided in one place.
 *
 * Two properties this exists to guarantee:
 *
 *   1. Settlement is read from the MONEY, never from `invoice.payment_status`.
 *      The stored status drifts — a credit note or a hand-edited payment moves
 *      the balance without rewriting it — so a badge keyed off it can claim an
 *      invoice is unpaid while the balance says otherwise. `invoiceStatus` is
 *      the same derivation the printed statement uses, which is what keeps the
 *      screen and the paper from disagreeing.
 *
 *   2. "Overdue" and "not yet due" must stay visually distinct. Overdue is the
 *      only state that gets the danger treatment. An unpaid invoice inside its
 *      terms is normal business, and painting it rose buried the rows the
 *      operator actually has to chase.
 */

export type InvoiceBadgeTone = 'paid' | 'overdue' | 'partial' | 'pending';

export interface InvoiceBadge {
  tone: InvoiceBadgeTone;
  /** Word on the pill. */
  label: 'Paid' | 'Overdue' | 'Partial' | 'Pending';
  /** The line under the pill: a second fact, never a restatement of the label. */
  detail: string;
  /** True only when the operator is being asked to chase this row. */
  needsAttention: boolean;
}

/** Local-midnight difference in whole days; positive means days remaining. */
function daysUntilDue(dueDate: string, today: Date): number {
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const from = new Date(today);
  from.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - from.getTime()) / 86_400_000);
}

export function invoiceBadge(inv: Invoice, today: Date = new Date()): InvoiceBadge {
  const balance = invoiceBalanceDue(inv);
  const amountPaid = inv.amount_paid || 0;

  /* Settled wins over every other reading, including a stale due date that has
     since passed — money first. */
  if (invoiceStatus(balance, amountPaid).label === 'Full') {
    return { tone: 'paid', label: 'Paid', detail: 'Paid in Full', needsAttention: false };
  }

  // Within a partially-paid invoice, overdue means the balance is late, not the
  // original invoice: the operator is chasing a remainder, so say so.
  const overdue = inv.due_date ? daysUntilDue(inv.due_date, today) < 0 : false;
  if (overdue) {
    const late = Math.abs(daysUntilDue(inv.due_date!, today));
    const detail = late === 1 ? '1 day overdue' : `${late} days overdue`;
    return { tone: 'overdue', label: 'Overdue', detail, needsAttention: true };
  }

  if (amountPaid > 0) {
    return {
      tone: 'partial',
      label: 'Partial',
      detail: `${amountPaid.toLocaleString('en-PK')} paid`,
      needsAttention: false,
    };
  }

  let detail = 'Pending';
  if (inv.due_date) {
    const diffDays = daysUntilDue(inv.due_date, today);
    if (diffDays === 0) detail = 'Due Today';
    else if (diffDays === 1) detail = 'Due Tomorrow';
    else if (diffDays > 1) detail = `Due in ${diffDays}d`;
  }
  return { tone: 'pending', label: 'Pending', detail, needsAttention: false };
}