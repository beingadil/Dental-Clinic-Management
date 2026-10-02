import type {
  Invoice,
  AdvancePayment,
  PaymentRecord,
  PaymentAllocation,
  PaymentAttachment,
  AccountAdjustment,
  AuditEvent,
} from '../types';
import { deriveInvoiceStatus, formatPKR } from './financeDomain';
import { maxDocumentSeq } from './ledgerDomain';
import { getNowStamp } from '../utils/dateUtils';

/**
 * Transaction domain — pure builders for the V2 cashier command flows
 * extracted from AppContext (audit F2 continuation). The hook wires them to
 * state; every rule about *what* a posted transaction looks like lives here.
 * No React, no state, no DB.
 */

/** The one shape for audit events posted by the transaction flows. */
export const buildAuditEvent = (
  event: Omit<AuditEvent, 'id' | 'timestamp'>,
  identity?: { id?: string; at?: string },
): AuditEvent => ({
  id: identity?.id ?? `aud-${Date.now()}`,
  timestamp: identity?.at ?? getNowStamp(),
  ...event,
});

const nowStamp = (): string => getNowStamp();
const todayPart = (nowStr: string): string => nowStr.split(' ')[0];

/** Status a fresh payment takes, given the cashier's verification flag. */
export const derivePaymentStatusV2 = (
  isVerified: boolean | undefined,
  method: 'cash' | 'bank' | 'cheque' | 'advance',
): 'reconciled' | 'posted' | 'pending_verification' =>
  isVerified ? 'reconciled' : method === 'cash' ? 'posted' : 'pending_verification';

// ─────────────────────────────────────────────── record transaction (V2)

export interface PreparedTransaction {
  payment: PaymentRecord;
  /** Per-invoice payment slices to prepend inside the invoice updater. */
  invoiceSlices: { invoiceId: string; amount: number; payment: PaymentRecord }[];
  allocations: PaymentAllocation[];
  unappliedAmount: number;
  totalAllocated: number;
  paymentNumber: string;
  receiptNumber: string;
  /** Remainder advance to persist when the caller asked to save it. */
  remainderAdvance: AdvancePayment | null;
  /** Reconciliation item when the method was bank/cheque, else null. */
  reconciliationItem: {
    id: string;
    payment_id: string;
    reference_number: string;
    method: string;
    amount: number;
    date: string;
    lab_id: string;
    lab_name: string;
    invoice_id?: string;
    invoice_number?: string;
    status: 'verified' | 'suggested_match';
    notes: string;
    proof_url?: string;
    verified_at?: string;
    verified_by?: string;
  } | null;
  auditEvent: AuditEvent;
}

/**
 * Builds every record a `recordTransactionV2` command must persist. Throws on
 * the over-allocation invariant (a payment can never be allocated beyond what
 * was received) — callers surface that error to the UI.
 */
export const prepareTransaction = (input: {
  command: {
    clinicId: string;
    amount: number;
    method: 'cash' | 'bank' | 'cheque' | 'advance';
    date: string;
    referenceNumber?: string;
    notes?: string;
    attachments?: PaymentAttachment[];
    allocations: { invoiceId: string; amount: number }[];
    saveRemainingAsAdvance?: boolean;
    isVerified?: boolean;
  };
  invoices: Invoice[];
  /** Every existing payment number — the PAY- sequence continues past the max, never a count. */
  existingPaymentNumbers: string[];
  /** Every existing advance number (the unapplied remainder may become one). */
  existingAdvanceNumbers: string[];
  /** Every existing receipt number (payments + advances) so REC- stays monotonic. */
  existingReceiptNumbers: string[];
  labName: string;
  actor: string;
  paymentId: string;
}): PreparedTransaction => {
  const { command, invoices, existingPaymentNumbers, existingAdvanceNumbers, existingReceiptNumbers, labName, actor, paymentId } = input;
  const nowStr = nowStamp();
  const currentYear = new Date().getFullYear();
  /* Max-scan, not count: deletions, reversals and legacy 4-digit numbers must
     never let the sequence hand out a number that already exists (a single
     duplicate aborts the whole SQLite sync transaction). */
  const seq = maxDocumentSeq(existingPaymentNumbers, 'PAY') + 1;
  const paymentNumber = `PAY-${currentYear}-${String(seq).padStart(4, '0')}`;
  const receiptNumber = `REC-${currentYear}-${String(maxDocumentSeq(existingReceiptNumbers, 'REC') + 1).padStart(4, '0')}`;

  const totalAllocated = command.allocations.reduce((sum, a) => sum + a.amount, 0);

  /* Money invariant: a payment can never be allocated beyond what was
     actually received. Callers validate first (the record modal blocks it
     and explains why); this is the last-line guard. */
  if (totalAllocated > command.amount + 0.001) {
    throw new Error(
      `Payment allocation error: PKR ${totalAllocated.toLocaleString()} allocated from a payment of PKR ${command.amount.toLocaleString()}.`
    );
  }

  const unappliedAmount = Math.max(0, command.amount - totalAllocated);

  const allocations: PaymentAllocation[] = command.allocations.map((alloc, idx) => {
    const targetInv = invoices.find((i) => i.id === alloc.invoiceId);
    return {
      id: `alloc-${Date.now()}-${idx}`,
      source_type: 'payment',
      source_id: paymentId,
      source_ref: paymentNumber,
      invoice_id: alloc.invoiceId,
      invoice_number: targetInv?.invoice_number || 'INV',
      amount: alloc.amount,
      allocated_at: nowStr,
      allocated_by: actor,
      notes: command.notes
    };
  });

  const primaryInvoice = command.allocations.length > 0
    ? invoices.find((i) => i.id === command.allocations[0].invoiceId)
    : null;

  const payment: PaymentRecord = {
    id: paymentId,
    payment_number: paymentNumber,
    receipt_number: receiptNumber,
    invoice_id: primaryInvoice?.id || '',
    invoice_number: primaryInvoice?.invoice_number || (allocations.length > 1 ? 'Multi-Invoice' : 'Advance/Unapplied'),
    case_id: primaryInvoice?.case_id,
    case_number: primaryInvoice?.case_number,
    lab_id: command.clinicId,
    lab_name: labName,
    amount: command.amount,
    payment_method: command.method,
    payment_date: command.date || nowStr.split(' ')[0],
    reference_number: command.referenceNumber,
    notes: command.notes,
    recorded_by: actor,
    created_at: nowStr,
    attachments: command.attachments || [],
    payment_type: command.allocations.length > 0 ? 'invoice_payment' : 'advance_payment',
    status: derivePaymentStatusV2(command.isVerified, command.method),
    allocations,
    unapplied_amount: unappliedAmount
  };

  /* One cash receipt can hit several invoices; every stored slice needs its own
     payments.payment_number or the UNIQUE index aborts the whole sync
     transaction. The canonical number stays on the payment (and on a
     single-invoice slice); extra slices get a deterministic -1/-2 suffix. */
  const invoiceSlices = command.allocations.map((alloc, idx) => {
    const inv = invoices.find((i) => i.id === alloc.invoiceId);
    return {
      invoiceId: alloc.invoiceId,
      amount: alloc.amount,
      payment: {
        ...payment,
        id: `pay-slice-${Date.now()}-${alloc.invoiceId}`,
        payment_number: command.allocations.length > 1 ? `${paymentNumber}-${idx + 1}` : paymentNumber,
        invoice_id: alloc.invoiceId,
        invoice_number: inv?.invoice_number,
        amount: alloc.amount
      }
    };
  });

  // Unapplied cash becomes clinic credit ONLY when the caller explicitly
  // asked for it. Never inferred: an unapplied remainder must not turn a
  // partial payment into an advance deposit behind the cashier's back.
  const remainderAdvance: AdvancePayment | null =
    unappliedAmount > 0 && command.saveRemainingAsAdvance === true
      ? {
          id: `adv-rem-${Date.now()}`,
          payment_number: `ADV-${currentYear}-${String(maxDocumentSeq(existingAdvanceNumbers, 'ADV') + 1).padStart(4, '0')}`,
          receipt_number: receiptNumber,
          lab_id: command.clinicId,
          lab_name: labName,
          amount: unappliedAmount,
          allocated_amount: 0,
          remaining_amount: unappliedAmount,
          payment_method: command.method === 'advance' ? 'bank' : command.method,
          payment_date: command.date || nowStr.split(' ')[0],
          reference_number: command.referenceNumber || paymentNumber,
          notes: `Unapplied remainder from payment ${paymentNumber}`,
          recorded_by: actor,
          created_at: nowStr,
          status: 'available'
        }
      : null;

  const reconciliationItem =
    command.method === 'bank' || command.method === 'cheque'
      ? {
          id: `rec-${Date.now()}`,
          payment_id: paymentId,
          reference_number: command.referenceNumber || paymentNumber,
          method: command.method,
          amount: command.amount,
          date: command.date || nowStr.split(' ')[0],
          lab_id: command.clinicId,
          lab_name: labName,
          invoice_id: primaryInvoice?.id,
          invoice_number: primaryInvoice?.invoice_number,
          status: (command.isVerified ? 'verified' : 'suggested_match') as 'verified' | 'suggested_match',
          notes: `Payment ${paymentNumber} recorded via ${command.method.toUpperCase()}`,
          proof_url: command.attachments && command.attachments[0] ? command.attachments[0].file_url : undefined,
          verified_at: command.isVerified ? nowStr : undefined,
          verified_by: command.isVerified ? actor : undefined
        }
      : null;

  const auditEvent = buildAuditEvent({
    actor,
    action: 'PAYMENT_COLLECTED',
    entity_type: 'payment',
    entity_id: paymentId,
    entity_ref: paymentNumber,
    notes: `Collected ${formatPKR(command.amount)} from ${labName} via ${command.method.toUpperCase()}. Allocated: ${formatPKR(totalAllocated)}, Unapplied Credit: ${formatPKR(unappliedAmount)}.`
  });

  return {
    payment,
    invoiceSlices,
    allocations,
    unappliedAmount,
    totalAllocated,
    paymentNumber,
    receiptNumber,
    remainderAdvance,
    reconciliationItem,
    auditEvent
  };
};

/** The invoice-side update for one allocated payment slice. */
export const applyPaymentToInvoice = (
  inv: Invoice,
  slice: PaymentRecord,
  newPaid: number,
): Invoice => {
  const newStatus = deriveInvoiceStatus(inv.final_amount, newPaid, inv.due_date, inv.credit_notes_total || 0);
  return {
    ...inv,
    amount_paid: newPaid,
    payment_status: newPaid >= inv.final_amount ? 'paid' : 'partial',
    status_v2: newStatus,
    payments: [slice, ...(inv.payments || [])]
  };
};

// ────────────────────────────────────────────── advance deposit (V2)

export const prepareAdvanceDeposit = (input: {
  command: {
    clinicId: string;
    amount: number;
    method: 'cash' | 'bank' | 'cheque';
    date?: string;
    referenceNumber?: string;
    notes?: string;
    attachments?: PaymentAttachment[];
    isVerified?: boolean;
  };
  existingAdvanceNumbers: string[];
  existingReceiptNumbers: string[];
  labName: string;
  actor: string;
  advanceId: string;
}): { advance: AdvancePayment; receiptNumber: string; reconciliationItem: PreparedTransaction['reconciliationItem']; auditEvent: AuditEvent } => {
  const { command, existingAdvanceNumbers, existingReceiptNumbers, labName, actor, advanceId } = input;
  const nowStr = nowStamp();
  const currentYear = new Date().getFullYear();
  const seq = maxDocumentSeq(existingAdvanceNumbers, 'ADV') + 1;
  const advNum = `ADV-${currentYear}-${String(seq).padStart(4, '0')}`;
  const receiptNumber = `REC-${currentYear}-${String(maxDocumentSeq(existingReceiptNumbers, 'REC') + 1).padStart(4, '0')}`;

  const advance: AdvancePayment = {
    id: advanceId,
    payment_number: advNum,
    receipt_number: receiptNumber,
    lab_id: command.clinicId,
    lab_name: labName,
    amount: command.amount,
    allocated_amount: 0,
    remaining_amount: command.amount,
    payment_method: command.method,
    payment_date: command.date || nowStr.split(' ')[0],
    reference_number: command.referenceNumber,
    notes: command.notes,
    recorded_by: actor,
    created_at: nowStr,
    attachments: command.attachments || [],
    status: 'available'
  };

  const reconciliationItem =
    command.method === 'bank' || command.method === 'cheque'
      ? {
          id: `rec-${Date.now()}`,
          payment_id: advanceId,
          reference_number: command.referenceNumber || advNum,
          method: command.method,
          amount: command.amount,
          date: command.date || nowStr.split(' ')[0],
          lab_id: command.clinicId,
          lab_name: labName,
          status: (command.isVerified ? 'verified' : 'suggested_match') as 'verified' | 'suggested_match',
          notes: `Advance deposit ${advNum} received via ${command.method.toUpperCase()}`,
          proof_url: command.attachments && command.attachments[0] ? command.attachments[0].file_url : undefined,
          verified_at: command.isVerified ? nowStr : undefined,
          verified_by: command.isVerified ? actor : undefined
        }
      : null;

  const auditEvent = buildAuditEvent({
    actor,
    action: 'ADVANCE_DEPOSIT_RECORDED',
    entity_type: 'advance_payment',
    entity_id: advanceId,
    entity_ref: advNum,
    notes: `Recorded advance deposit of ${formatPKR(command.amount)} from ${labName} via ${command.method.toUpperCase()}. Available in clinic credit wallet.`
  });

  return { advance, receiptNumber, reconciliationItem, auditEvent };
};

// ────────────────────────────────────────────── advance credit (V2)

export const buildAdvanceAllocationPayment = (input: {
  invoice: Invoice;
  amount: number;
  usedAdvanceRefs: string[];
  notes?: string;
  actor: string;
  nowStr: string;
}): PaymentRecord => {
  const { invoice, amount, usedAdvanceRefs, notes, actor, nowStr } = input;
  return {
    id: `pay-adv-${Date.now()}`,
    payment_number: `PAY-ADV-${Date.now().toString(36).toUpperCase()}`,
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    case_id: invoice.case_id,
    case_number: invoice.case_number,
    lab_id: invoice.lab_id,
    lab_name: invoice.lab_name,
    amount,
    payment_method: 'advance',
    payment_date: nowStr.split(' ')[0],
    reference_number: usedAdvanceRefs.join(', '),
    notes: notes ? `${notes} (Applied from: ${usedAdvanceRefs.join(', ')})` : `Applied from advance deposit ${usedAdvanceRefs.join(', ')}`,
    recorded_by: actor,
    created_at: nowStr,
    payment_type: 'advance_allocation',
    status: 'posted'
  };
};

/** FIFO deduction across a clinic's available advances. Pure: returns the next advance list + refs used. */
export const allocateAdvancesFifo = (
  advances: AdvancePayment[],
  clinicId: string,
  needed: number,
): { advances: AdvancePayment[]; usedRefs: string[]; applied: number } => {
  let unallocatedNeeded = needed;
  const usedRefs: string[] = [];
  const next = advances.map((adv) => {
    if (adv.lab_id !== clinicId || adv.remaining_amount <= 0 || unallocatedNeeded <= 0 || adv.is_reversed) {
      return adv;
    }
    const take = Math.min(adv.remaining_amount, unallocatedNeeded);
    unallocatedNeeded -= take;
    usedRefs.push(adv.payment_number);

    const newRemaining = adv.remaining_amount - take;
    const newStatus = newRemaining <= 0 ? 'fully_allocated' : 'partially_allocated';

    return {
      ...adv,
      allocated_amount: adv.allocated_amount + take,
      remaining_amount: newRemaining,
      status: newStatus as AdvancePayment['status']
    };
  });
  return { advances: next, usedRefs, applied: needed - Math.max(0, unallocatedNeeded) };
};

/** Invoice update when advance credit is applied to it. */
export const applyAdvanceToInvoice = (inv: Invoice, toApply: number, slice: PaymentRecord): Invoice => {
  const newPaid = (inv.amount_paid || 0) + toApply;
  const newStatus = deriveInvoiceStatus(inv.final_amount, newPaid, inv.due_date, inv.credit_notes_total || 0);
  return {
    ...inv,
    amount_paid: newPaid,
    payment_status: newPaid >= inv.final_amount ? 'paid' : 'partial',
    status_v2: newStatus,
    payments: [slice, ...(inv.payments || [])]
  };
};

/** How much advance credit a clinic can still spend. */
export const availableAdvanceCredit = (advances: AdvancePayment[], clinicId: string): number =>
  advances
    .filter((a) => a.lab_id === clinicId && a.remaining_amount > 0 && !a.is_reversed)
    .reduce((sum, a) => sum + a.remaining_amount, 0);

// ────────────────────────────────────────────── credit note (V2)

export const buildCreditNoteAdjustment = (input: {
  command: {
    clinicId: string;
    invoiceId: string;
    amount: number;
    reasonCode: string;
    reasonText: string;
    approvedBy?: string;
    /** Business (adjustment) date — defaults to today when omitted. */
    date?: string;
  };
  invoice: Invoice | undefined;
  /** Every existing adjustment number — the CR- sequence continues past the max, never a count. */
  existingAdjustmentNumbers: string[];
  labName: string;
  actor: string;
  adjustmentId: string;
}): { adjustment: AccountAdjustment; auditEvent: AuditEvent } => {
  const { command, invoice, existingAdjustmentNumbers, labName, actor, adjustmentId } = input;
  const nowStr = nowStamp();
  const currentYear = new Date().getFullYear();
  const crNum = `CR-${currentYear}-${String(maxDocumentSeq(existingAdjustmentNumbers, 'CR') + 1).padStart(4, '0')}`;

  const adjustment: AccountAdjustment = {
    id: adjustmentId,
    adjustment_number: crNum,
    credit_note_number: crNum,
    lab_id: command.clinicId,
    lab_name: labName,
    type: command.reasonCode === 'bad_debt' ? 'write_off' : 'credit_note',
    amount: command.amount,
    reason: `[${command.reasonCode.toUpperCase()}] ${command.reasonText}`,
    date: command.date || nowStr.split(' ')[0],
    invoice_id: command.invoiceId,
    invoice_number: invoice?.invoice_number,
    recorded_by: actor,
    approved_by: command.approvedBy || (actor !== 'Manager' ? actor : 'Lab Director'),
    created_at: nowStr,
    status: 'posted'
  };

  const auditEvent = buildAuditEvent({
    actor,
    action: 'CREDIT_NOTE_ISSUED',
    entity_type: 'credit_note',
    entity_id: adjustmentId,
    entity_ref: crNum,
    reason: command.reasonText,
    notes: `Issued credit note ${crNum} of ${formatPKR(command.amount)} for invoice ${invoice?.invoice_number || 'N/A'}. Reason: ${command.reasonCode} - ${command.reasonText}`
  });

  return { adjustment, auditEvent };
};

/** Invoice update when a credit note lands on it. */
export const applyCreditNoteToInvoice = (inv: Invoice, amount: number): Invoice => {
  const newCr = (inv.credit_notes_total || 0) + amount;
  const newStatus = deriveInvoiceStatus(inv.final_amount, inv.amount_paid || 0, inv.due_date, newCr);
  return {
    ...inv,
    credit_notes_total: newCr,
    status_v2: newStatus,
    payment_status: (inv.amount_paid || 0) >= (inv.final_amount - newCr) ? 'paid' : inv.payment_status
  };
};

/** Invoice update when a credit note is reversed (credit restored). */
export const reverseCreditNoteOnInvoice = (inv: Invoice, amount: number): Invoice => {
  const newCr = Math.max(0, (inv.credit_notes_total || 0) - amount);
  const newStatus = deriveInvoiceStatus(inv.final_amount, inv.amount_paid || 0, inv.due_date, newCr);
  return {
    ...inv,
    credit_notes_total: newCr,
    status_v2: newStatus
  };
};

// ────────────────────────────────────────────── reversal (V2)

export const markReversal = <T extends { is_reversed?: boolean; status?: any; reversal_reason?: string; reversed_at?: string; reversed_by?: string }>(
  entity: T,
  reason: string,
  actor: string,
  at: string,
  extra: Partial<T> = {},
): T =>
  ({
    ...entity,
    is_reversed: true,
    status: 'reversed',
    reversal_reason: reason,
    reversed_at: at,
    reversed_by: actor,
    ...extra,
  } as T);

export const buildReversalAuditEvent = (input: {
  entityType: 'payment' | 'advance_payment' | 'adjustment';
  entityId: string;
  entityRef: string;
  amount: number;
  reason: string;
  actor: string;
  kind: 'payment' | 'advance' | 'adjustment';
}): AuditEvent =>
  buildAuditEvent({
    actor: input.actor,
    action: 'TRANSACTION_REVERSED',
    entity_type: input.entityType,
    entity_id: input.entityId,
    entity_ref: input.entityRef,
    reason: input.reason,
    notes: input.kind === 'payment'
      ? `Reversed payment ${input.entityRef} (${formatPKR(input.amount)}). Reason: ${input.reason}`
      : input.kind === 'advance'
        ? `Reversed advance deposit ${input.entityRef} (${formatPKR(input.amount)}). Reason: ${input.reason}`
        : `Reversed adjustment ${input.entityRef} (${formatPKR(input.amount)}). Reason: ${input.reason}`
  });

/** Invoice update when one of its payments is reversed (paid total recomputed from active payments). */
export const applyPaymentReversalToInvoice = (
  inv: Invoice,
  referenceId: string,
  updatedPayments: PaymentRecord[],
): Invoice => {
  const activePaid = updatedPayments
    .filter((p) => !p.is_reversed)
    .reduce((sum, p) => sum + p.amount, 0);
  const newStatus = deriveInvoiceStatus(inv.final_amount, activePaid, inv.due_date, inv.credit_notes_total || 0);
  return {
    ...inv,
    amount_paid: activePaid,
    payment_status: activePaid >= inv.final_amount ? 'paid' : (activePaid > 0 ? 'partial' : 'unpaid'),
    status_v2: newStatus,
    payments: updatedPayments
  };
};

// ────────────────────────────────────────────── reconciliation (V2)

export const buildReconciliationUpdate = (
  item: { notes?: string },
  matchNotes: string | undefined,
  actor: string,
  at: string,
): { status: 'verified'; verified_at: string; verified_by: string; notes: string } => ({
  status: 'verified',
  verified_at: at,
  verified_by: actor,
  notes: matchNotes ? `${item.notes || ''} | Reconciled: ${matchNotes}` : item.notes || ''
});
