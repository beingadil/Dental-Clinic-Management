import {
  formatPKR,
  roundMoney,
  invoiceBalanceDue,
  buildPaymentJournal,
  buildAdvanceDepositJournal,
  buildApplyAdvanceJournal,
  buildAdjustmentJournal,
} from '../../services/financeDomain';
import type {
  Invoice,
  AdvancePayment,
  AccountAdjustment,
  PaymentAllocation,
  PaymentRecord,
  JournalEntry,
  PaymentAttachment,
  ReconciliationItem,
} from '../../types';
import { getNowStamp } from '../../utils/dateUtils';
import {
  buildAuditEvent,
  prepareTransaction,
  applyPaymentToInvoice,
  prepareAdvanceDeposit,
  availableAdvanceCredit,
  allocateAdvancesFifo,
  buildAdvanceAllocationPayment,
  applyAdvanceToInvoice,
  buildCreditNoteAdjustment,
  applyCreditNoteToInvoice,
  recomputeInvoiceFromPayments,
  buildReconciliationUpdate,
} from '../../services/transactionDomain';
import { buildPaymentReceivedNotification, buildAdvanceDepositV2Notification } from '../../services/notificationDomain';

/**
 * V2 cashier command flows (audit F2 continuation) — recordTransaction,
 * advance deposit, advance credit, credit note, payment-entry correction and
 * reconciliation. The business rules live in services/transactionDomain.ts
 * (pure) and the journal builders in financeDomain; this hook only sequences
 * state updates in the same order the inline AppContext implementations used.
 */

/**
 * The receipt a stored payment number belongs to: `PAY-2026-0007-2` is the
 * second slice of `PAY-2026-0007`, and a base number is returned unchanged.
 *
 * One cash receipt paid across several invoices is stored as one payment row
 * per invoice (see prepareTransaction), so "this entry" and "this receipt" are
 * only the same thing for the common single-invoice case — every correction
 * below has to decide which one it means.
 */
const receiptNumberOf = (paymentNumber?: string): string => {
  const parts = (paymentNumber || '').split('-');
  return parts.length > 3 ? parts.slice(0, -1).join('-') : (paymentNumber || '');
};
export function useTransactionCommands(deps: {
  labs: { id: string; name: string }[];
  invoices: Invoice[];
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  advancePayments: AdvancePayment[];
  setAdvancePayments: React.Dispatch<React.SetStateAction<AdvancePayment[]>>;
  accountAdjustments: AccountAdjustment[];
  setAccountAdjustments: React.Dispatch<React.SetStateAction<AccountAdjustment[]>>;
  journalEntries: JournalEntry[];
  setJournalEntries: React.Dispatch<React.SetStateAction<JournalEntry[]>>;
  auditEvents: unknown;
  setAuditEvents: React.Dispatch<React.SetStateAction<any[]>>;
  reconciliationItems: ReconciliationItem[];
  setReconciliationItems: React.Dispatch<React.SetStateAction<ReconciliationItem[]>>;
  allPayments: PaymentRecord[];
  actorName: string;
  pushNotifications: (n: any) => void;
  genId: (prefix: string) => string;
  saveVoucherToSystem: (v: any) => unknown;
}) {
  const {
    labs, invoices, setInvoices, advancePayments, setAdvancePayments,
    accountAdjustments, setAccountAdjustments, journalEntries, setJournalEntries,
    auditEvents: _auditEvents, setAuditEvents, reconciliationItems: _reconciliationItems,
    setReconciliationItems, allPayments, actorName, pushNotifications, genId,
    saveVoucherToSystem,
  } = deps;

  /* Max-scan inputs for document numbering. Row counts were wrong twice over:
     deletePayment lowers allPayments.length, and one multi-invoice payment is
     counted once per slice — both re-issued numbers that already existed and
     aborted the whole SQLite sync. */
  const numberingInputs = {
    existingPaymentNumbers: allPayments.map((p) => p.payment_number || ''),
    existingAdvanceNumbers: advancePayments.map((a) => a.payment_number || ''),
    existingReceiptNumbers: [
      ...allPayments.map((p) => p.receipt_number || ''),
      ...advancePayments.map((a) => a.receipt_number || ''),
    ],
  };

  const recordTransactionV2 = (command: {
    clinicId: string;
    amount: number;
    method: 'cash' | 'bank' | 'cheque' | 'advance';
    date: string;
    referenceNumber?: string;
    notes?: string;
    attachments?: any[];
    allocations: { invoiceId: string; amount: number }[];
    saveRemainingAsAdvance?: boolean;
    isVerified?: boolean;
  }): { payment: PaymentRecord; receiptNumber: string; journal: JournalEntry } => {
    const lab = labs.find((l) => l.id === command.clinicId);
    const labName = lab ? lab.name : 'Dental Clinic';
    const nowStr = getNowStamp();
    const paymentId = `pay-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const prepared = prepareTransaction({
      command,
      invoices,
      ...numberingInputs,
      labName,
      actor: actorName || 'Cashier',
      paymentId,
    });

    // 1. Update Invoices
    setInvoices((prev) =>
      prev.map((inv) => {
        const slice = prepared.invoiceSlices.find((s) => s.invoiceId === inv.id);
        if (!slice) return inv;
        const newPaid = (inv.amount_paid || 0) + slice.amount;
        return applyPaymentToInvoice(inv, { ...slice.payment, invoice_id: inv.id }, newPaid);
      }),
    );

    // 2. Unapplied cash becomes clinic credit ONLY when explicitly requested.
    if (prepared.remainderAdvance) {
      setAdvancePayments((prev) => [prepared.remainderAdvance!, ...prev]);
    }

    // 3. Balanced journal entry — case context from the first allocated invoice
    // (relational; a multi-invoice payment keeps its primary case reference).
    const journalCaseRef = prepared.allocations[0]
      ? (() => { const inv = invoices.find((i) => i.id === prepared.allocations[0].invoice_id); return inv ? { case_id: inv.case_id, case_number: inv.case_number } : undefined; })()
      : undefined;
    const journal = buildPaymentJournal(
      prepared.payment,
      prepared.allocations,
      prepared.unappliedAmount,
      actorName || 'Cashier',
      journalCaseRef,
    );
    prepared.payment.journal_id = journal.id;
    // SyncCore stores one payments row per invoice-nested slice: stamp the
    // journal on every slice so drawer/reversal lookups resolve them (F7).
    prepared.invoiceSlices.forEach((s) => { s.payment.journal_id = journal.id; });
    setJournalEntries((prev) => [journal, ...prev]);

    // 4. Audit event
    setAuditEvents((prev) => [prepared.auditEvent, ...prev]);

    // 5. Reconciliation item for bank/cheque
    if (prepared.reconciliationItem) {
      const item = prepared.reconciliationItem as ReconciliationItem;
      setReconciliationItems((prev) => [item, ...prev]);

      /* The cashier's "Mark as verified / settled immediately" tick.
       *
       * `isVerified` was accepted on this command for its whole life and never
       * read: the reconciliation item was created and then left at `unmatched`
       * forever, so the Bank Statement Reconciliation panel showed every bank
       * and cheque payment as unreconciled no matter what the cashier asserted,
       * and the reconciliation report was permanently empty.
       *
       * Verified at POST time rather than as a separate step afterwards,
       * because that is what the checkbox says ("settled immediately") and
       * because a cashier confirming a deposit slip at the counter is the only
       * moment anyone has the slip in front of them. An UNticked box leaves the
       * item `unmatched`, which is the honest state for a payment that still
       * has to be checked against the statement.
       */
      if (command.isVerified) {
        setReconciliationItems((prev) =>
          prev.map((r) => (r.id === item.id ? { ...r, ...buildReconciliationUpdate(r, 'Verified at point of entry', actorName || 'Staff', nowStr) } : r)),
        );
        setAuditEvents((prev) => [
          {
            id: `aud-${Date.now()}`,
            timestamp: nowStr,
            actor: actorName || 'Staff',
            action: 'RECONCILIATION_VERIFIED',
            entity_type: 'reconciliation',
            entity_id: item.id,
            entity_ref: item.reference_number || item.id,
            notes: `Reconciliation verified at payment entry for ${item.payment_id}.`,
          },
          ...prev,
        ]);
      }
    }

    // 6. In-app notification
    pushNotifications(
      buildPaymentReceivedNotification({
        id: genId('notif'),
        labId: command.clinicId,
        labName,
        amount: command.amount,
        method: command.method,
        receiptNum: prepared.receiptNumber,
        formatAmount: formatPKR,
        at: nowStr,
      }),
    );

    // Voucher trail
    const firstAllocInvoice = prepared.allocations[0]
      ? invoices.find((i) => i.id === prepared.allocations[0].invoice_id)
      : undefined;
    saveVoucherToSystem({
      voucher_number: prepared.paymentNumber,
      voucher_type: 'invoice',
      case_id: firstAllocInvoice?.case_id || '',
      case_number: firstAllocInvoice?.case_number || '',
      lab_name: labName,
      doctor_name: firstAllocInvoice?.doctor_name || '',
      patient_name: firstAllocInvoice?.patient_name || '',
      case_type_name: firstAllocInvoice?.case_type_name || '',
      amount: command.amount,
      notes: command.notes || `${command.method} payment received from ${labName}`,
    });

    return { payment: prepared.payment, receiptNumber: prepared.receiptNumber, journal };
  };

  const recordAdvanceDepositV2 = (command: {
    clinicId: string;
    amount: number;
    method: 'cash' | 'bank' | 'cheque';
    date?: string;
    referenceNumber?: string;
    notes?: string;
    attachments?: any[];
    isVerified?: boolean;
  }): { advance: AdvancePayment; receiptNumber: string; journal: JournalEntry } => {
    const lab = labs.find((l) => l.id === command.clinicId);
    const labName = lab ? lab.name : 'Dental Clinic';
    const nowStr = getNowStamp();
    const advanceId = `adv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const prepared = prepareAdvanceDeposit({
      command,
      ...numberingInputs,
      labName,
      actor: actorName || 'Cashier',
      advanceId,
    });

    const journal = buildAdvanceDepositJournal(prepared.advance, actorName || 'Cashier');
    prepared.advance.journal_id = journal.id;

    setAdvancePayments((prev) => [prepared.advance, ...prev]);
    setJournalEntries((prev) => [journal, ...prev]);
    setAuditEvents((prev) => [prepared.auditEvent, ...prev]);

    if (prepared.reconciliationItem) {
      const item = prepared.reconciliationItem as ReconciliationItem;
      setReconciliationItems((prev) => [item, ...prev]);

      // Same reasoning as recordTransactionV2: `isVerified` was accepted and
      // never read here either, so an advance deposit paid by bank or cheque
      // also sat permanently unreconciled.
      if (command.isVerified) {
        setReconciliationItems((prev) =>
          prev.map((r) => (r.id === item.id ? { ...r, ...buildReconciliationUpdate(r, 'Verified at point of entry', actorName || 'Cashier', nowStr) } : r)),
        );
        setAuditEvents((prev) => [
          {
            id: `aud-${Date.now()}`,
            timestamp: nowStr,
            actor: actorName || 'Cashier',
            action: 'RECONCILIATION_VERIFIED',
            entity_type: 'reconciliation',
            entity_id: item.id,
            entity_ref: item.reference_number || item.id,
            notes: `Reconciliation verified at advance-deposit entry for ${item.payment_id}.`,
          },
          ...prev,
        ]);
      }
    }

    pushNotifications(
      buildAdvanceDepositV2Notification({
        id: genId('notif'),
        labId: command.clinicId,
        labName,
        amount: command.amount,
        advNum: prepared.advance.payment_number,
        receiptNum: prepared.receiptNumber,
        formatAmount: formatPKR,
        at: nowStr,
      }),
    );

    return { advance: prepared.advance, receiptNumber: prepared.receiptNumber, journal };
  };

  const applyAdvanceCreditV2 = (command: {
    clinicId: string;
    invoiceId: string;
    amount: number;
    notes?: string;
  }): boolean => {
    if (command.amount <= 0 || isNaN(command.amount)) return false;
    const inv = invoices.find((i) => i.id === command.invoiceId);
    if (!inv) return false;

    const remainingDue = invoiceBalanceDue(inv);
    if (remainingDue <= 0) return false;

    const totalAvailable = availableAdvanceCredit(advancePayments, command.clinicId);
    if (totalAvailable <= 0) return false;

    const toApply = Math.min(command.amount, remainingDue, totalAvailable);
    if (toApply <= 0) return false;

    const nowStr = getNowStamp();
    const actor = actorName || 'Staff';

    // FIFO deduction across the clinic's available advances.
    const { advances: allocatedAdvances, usedRefs } = allocateAdvancesFifo(advancePayments, command.clinicId, toApply);
    setAdvancePayments(allocatedAdvances);

    // Invoice update
    const slice = buildAdvanceAllocationPayment({
      invoice: inv,
      amount: toApply,
      usedAdvanceRefs: usedRefs,
      notes: command.notes,
      actor,
      nowStr,
    });
    setInvoices((prev) => prev.map((item) => (item.id === inv.id ? applyAdvanceToInvoice(item, toApply, slice) : item)));

    // Double-entry journal
    const journal = buildApplyAdvanceJournal(usedRefs.join(', '), inv, toApply, actor);
    setJournalEntries((prev) => [journal, ...prev]);

    // Audit event
    setAuditEvents((prev) => [
      {
        id: `aud-${Date.now()}`,
        timestamp: nowStr,
        actor,
        action: 'ADVANCE_CREDIT_APPLIED',
        entity_type: 'invoice',
        entity_id: inv.id,
        entity_ref: inv.invoice_number,
        notes: `Applied ${formatPKR(toApply)} from advance (${usedRefs.join(', ')}) to invoice ${inv.invoice_number}.`,
      },
      ...prev,
    ]);

    return true;
  };

  const issueCreditNoteV2 = (command: {
    clinicId: string;
    invoiceId: string;
    amount: number;
    reasonCode: string;
    reasonText: string;
    approvedBy?: string;
    referenceNumber?: string;
    notes?: string;
    attachments?: PaymentAttachment[];
    date?: string;
  }): AccountAdjustment => {
    const lab = labs.find((l) => l.id === command.clinicId);
    const labName = lab ? lab.name : 'Dental Clinic';
    const inv = invoices.find((i) => i.id === command.invoiceId);

    /* A credit note can never exceed what the clinic still owes.
     *
     * There was no cap here, so a cashier could credit more than the invoice
     * was worth. That drove `final_amount - credit_notes_total` negative, and
     * `applyCreditNoteToInvoice` then force-set the invoice to `paid`. Because
     * every open-invoice list filters on `due > 0`, the invoice vanished from
     * the cashier's own queue — the money went out, the case closed itself, and
     * nothing on screen said either had happened.
     *
     * The cap is `min(requested, still owed)`, matching `applyAdvanceCreditV2`
     * directly above, so the two money paths behave the same way. The CLAMPED
     * amount is what gets written to the adjustment, the invoice, the journal
     * and the voucher — clamping only the invoice would leave the three other
     * records disagreeing about how much was credited. */
    const cappedAmount = inv ? Math.min(command.amount, invoiceBalanceDue(inv)) : command.amount;
    if (cappedAmount <= 0 || isNaN(cappedAmount)) {
      throw new Error('This invoice has nothing left to credit.');
    }
    const amount = cappedAmount;
    const effectiveCommand = { ...command, amount };

    const adjustmentId = `adj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const prepared = buildCreditNoteAdjustment({
      command: effectiveCommand,
      invoice: inv,
      existingAdjustmentNumbers: accountAdjustments.map((a) => a.adjustment_number),
      labName,
      actor: actorName || 'Manager',
      adjustmentId,
    });

    // Update target invoice
    if (inv) {
      setInvoices((prev) => prev.map((item) => (item.id === inv.id ? applyCreditNoteToInvoice(item, amount) : item)));
    }

    // Journal — carry the invoice's case into the adjustment + journal
    const journal = buildAdjustmentJournal(
      { ...prepared.adjustment, case_id: inv?.case_id, case_number: inv?.case_number },
      actorName || 'Manager'
    );
    prepared.adjustment.journal_id = journal.id;
    if (inv?.case_id) { prepared.adjustment.case_id = inv.case_id; prepared.adjustment.case_number = inv?.case_number; }

    setAccountAdjustments((prev) => [prepared.adjustment, ...prev]);
    setJournalEntries((prev) => [journal, ...prev]);

    // Voucher trail for credit notes
    saveVoucherToSystem({
      voucher_number: prepared.adjustment.credit_note_number || prepared.adjustment.adjustment_number,
      voucher_type: 'invoice',
      case_id: inv?.case_id || '',
      case_number: inv?.case_number || '',
      lab_name: labName,
      doctor_name: inv?.doctor_name || '',
      patient_name: inv?.patient_name || '',
      case_type_name: inv?.case_type_name || '',
      amount: amount,
      notes: command.reasonText || `Credit note issued on ${inv?.invoice_number || 'invoice'}`,
    });

    // Audit event
    setAuditEvents((prev) => [prepared.auditEvent, ...prev]);

    return prepared.adjustment;
  };

  /**
   * Delete a payment entry.
   *
   * Receipt-level, deliberately: one cash receipt that paid across several
   * invoices is stored as one row per invoice, so deleting a single row would
   * leave the rest of a receipt whose journal no longer matches it. Deleting
   * any row therefore deletes the whole receipt — its rows, its journal and its
   * reconciliation items — and every invoice it touched recomputes its paid
   * total from the payments that remain. The invoice itself is never touched;
   * voiding one is a separate action on the invoice table.
   */
  const deletePaymentV2 = (paymentId: string): boolean => {
    let target: PaymentRecord | null = null;
    for (const inv of invoices) {
      const found = (inv.payments || []).find((p) => p.id === paymentId || p.payment_number === paymentId);
      if (found) {
        target = found;
        break;
      }
    }
    if (!target) return false;

    const deleted = target;
    const receiptNumber = receiptNumberOf(deleted.payment_number);
    /* Every stored row of this receipt: the same base number, whichever slice
       the operator was looking at when they pressed Delete. */
    const isReceiptRow = (p: Pick<PaymentRecord, 'id' | 'payment_number'>): boolean =>
      p.id === deleted.id || (!!p.payment_number && receiptNumberOf(p.payment_number) === receiptNumber);

    const actor = actorName || 'Cashier';

    setInvoices((prev) =>
      prev.map((inv) => {
        const payments = inv.payments || [];
        if (!payments.some(isReceiptRow)) return inv;
        return recomputeInvoiceFromPayments(inv, payments.filter((p) => !isReceiptRow(p)));
      }),
    );

    // The receipt's journal goes with it: a payment that no longer exists must
    // not keep debiting cash on the general ledger.
    setJournalEntries((prev) => prev.filter((j) => j.id !== deleted.journal_id && j.reference_number !== receiptNumber));

    /* A stale bank-reconciliation item would keep asking the operator to match
       cash that was deleted. Matched on the receipt's numbers — a reconciliation
       row stores the payment it was built from, not this slice's id. */
    const receiptRefs = new Set(
      [deleted.id, deleted.payment_number, deleted.receipt_number, deleted.reference_number, receiptNumber].filter(
        (ref): ref is string => !!ref,
      ),
    );
    setReconciliationItems((prev) => prev.filter((r) => !receiptRefs.has(r.payment_id) && !receiptRefs.has(r.reference_number)));

    setAuditEvents((prev) => [
      buildAuditEvent({
        actor,
        action: 'PAYMENT_DELETED',
        entity_type: 'payment',
        entity_id: deleted.id,
        entity_ref: receiptNumber,
        old_state: { amount: deleted.amount, method: deleted.payment_method, date: deleted.payment_date },
        notes: `Deleted payment ${receiptNumber} (${formatPKR(deleted.amount)}) from ${deleted.lab_name || 'clinic'}. Balances were recomputed from the payments that remain.`,
      }),
      ...prev,
    ]);

    return true;
  };

  /**
   * Change the amount of one payment entry.
   *
   * Only the amount moves: the invoice recomputes its paid total from the rows
   * that remain, and the receipt's journal is rebuilt from those rows, so the
   * register and the ledger cannot disagree. Refused when the new amount is not
   * a positive number, or when it would take the invoice past settled — the
   * excess belongs in an advance deposit, which is a different document.
   */
  const updatePaymentAmountV2 = (paymentId: string, amount: number): boolean => {
    const next = roundMoney(amount);
    if (!Number.isFinite(next) || next <= 0) return false;

    let target: PaymentRecord | null = null;
    let host: Invoice | null = null;
    for (const inv of invoices) {
      const found = (inv.payments || []).find((p) => p.id === paymentId || p.payment_number === paymentId);
      if (found) {
        target = found;
        host = inv;
        break;
      }
    }
    if (!target || !host) return false;

    const edited = target;
    const invoice = host;
    if (next === roundMoney(edited.amount)) return true;

    const settledByOthers = (invoice.payments || [])
      .filter((p) => p.id !== edited.id && !p.is_reversed)
      .reduce((sum, p) => sum + p.amount, 0);
    const invoiceCeiling = Math.max(0, invoice.final_amount - (invoice.credit_notes_total || 0));
    if (next + settledByOthers > invoiceCeiling + 0.001) return false;

    const nowStr = getNowStamp();
    const actor = actorName || 'Cashier';
    const receiptNumber = receiptNumberOf(edited.payment_number);

    setInvoices((prev) =>
      prev.map((inv) => {
        const payments = inv.payments || [];
        if (!payments.some((p) => p.id === edited.id)) return inv;
        return recomputeInvoiceFromPayments(
          inv,
          payments.map((p) => (p.id === edited.id ? { ...p, amount: next } : p)),
        );
      }),
    );

    const journal = journalEntries.find((j) => j.id === edited.journal_id);
    if (journal) {
      const liveRows = invoices
        .flatMap((inv) => inv.payments || [])
        .filter((p) => !p.is_reversed && receiptNumberOf(p.payment_number) === receiptNumber)
        .map((p) => (p.id === edited.id ? { ...p, amount: next } : p));
      const unapplied = Math.max(0, roundMoney(edited.unapplied_amount || 0));
      const allocations: PaymentAllocation[] = liveRows.map((p) => {
        const prior = (edited.allocations || []).find((a) => a.invoice_id === p.invoice_id);
        return {
          id: prior?.id ?? `alloc-${p.id}`,
          source_type: 'payment',
          source_id: edited.id,
          source_ref: edited.payment_number || receiptNumber,
          invoice_id: p.invoice_id || '',
          invoice_number: p.invoice_number || 'INV',
          amount: p.amount,
          allocated_at: prior?.allocated_at ?? p.created_at ?? nowStr,
          allocated_by: prior?.allocated_by ?? p.recorded_by ?? actor,
          notes: prior?.notes,
        };
      });
      const total = roundMoney(liveRows.reduce((sum, p) => sum + p.amount, 0) + unapplied);
      const rebuilt = buildPaymentJournal({ ...edited, amount: total }, allocations, unapplied, actor);
      setJournalEntries((prev) =>
        prev.map((j) => (j.id === journal.id ? { ...rebuilt, id: journal.id, journal_number: journal.journal_number } : j)),
      );
    }

    setAuditEvents((prev) => [
      buildAuditEvent({
        actor,
        action: 'PAYMENT_AMOUNT_CHANGED',
        entity_type: 'payment',
        entity_id: edited.id,
        entity_ref: edited.payment_number || receiptNumber,
        old_state: { amount: edited.amount },
        new_state: { amount: next },
        notes: `Payment ${edited.payment_number || receiptNumber} changed from ${formatPKR(edited.amount)} to ${formatPKR(next)}.`,
      }),
      ...prev,
    ]);

    return true;
  };

  const reconcileItemV2 = (id: string, matchNotes?: string) => {
    const nowStr = getNowStamp();
    const actor = actorName || 'Auditor';

    setReconciliationItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...buildReconciliationUpdate(item, matchNotes, actor, nowStr) } : item)),
    );

    setAuditEvents((prev) => [
      {
        id: `aud-${Date.now()}`,
        timestamp: nowStr,
        actor,
        action: 'RECONCILIATION_VERIFIED',
        entity_type: 'reconciliation',
        entity_id: id,
        entity_ref: id,
        notes: `Reconciliation verified for item ${id}. ${matchNotes || ''}`,
      },
      ...prev,
    ]);
  };

  const flagReconciliationExceptionV2 = (id: string, reason: string) => {
    const nowStr = getNowStamp();
    const actor = actorName || 'Auditor';

    setReconciliationItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: 'exception', exception_reason: reason } : item)),
    );

    setAuditEvents((prev) => [
      {
        id: `aud-${Date.now()}`,
        timestamp: nowStr,
        actor,
        action: 'RECONCILIATION_EXCEPTION',
        entity_type: 'reconciliation',
        entity_id: id,
        entity_ref: id,
        reason,
        notes: `Reconciliation flagged as exception: ${reason}`,
      },
      ...prev,
    ]);
  };

  return {
    recordTransactionV2,
    recordAdvanceDepositV2,
    applyAdvanceCreditV2,
    issueCreditNoteV2,
    deletePaymentV2,
    updatePaymentAmountV2,
    reconcileItemV2,
    flagReconciliationExceptionV2,
  };
}
