import type {
  Invoice,
  AdvancePayment,
  AccountAdjustment,
  PaymentRecord,
  JournalEntry,
  ReconciliationItem,
} from '../../types';
import { formatPKR } from '../../services/financeDomain';
import {
  buildPaymentJournal,
  buildAdvanceDepositJournal,
  buildApplyAdvanceJournal,
  buildAdjustmentJournal,
  buildReversalJournal,
} from '../../services/financeDomain';
import {
  prepareTransaction,
  applyPaymentToInvoice,
  prepareAdvanceDeposit,
  availableAdvanceCredit,
  allocateAdvancesFifo,
  buildAdvanceAllocationPayment,
  applyAdvanceToInvoice,
  buildCreditNoteAdjustment,
  applyCreditNoteToInvoice,
  reverseCreditNoteOnInvoice,
  applyPaymentReversalToInvoice,
  markReversal,
  buildReversalAuditEvent,
  buildReconciliationUpdate,
} from '../../services/transactionDomain';
import { buildPaymentReceivedNotification, buildAdvanceDepositV2Notification } from '../../services/notificationDomain';

/**
 * V2 cashier command flows (audit F2 continuation) — recordTransaction,
 * advance deposit, advance credit, credit note, reversal and reconciliation.
 * The business rules live in services/transactionDomain.ts (pure) and the
 * journal builders in financeDomain; this hook only sequences state updates
 * in the same order the inline AppContext implementations used.
 */
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
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const paymentId = `pay-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const prepared = prepareTransaction({
      command,
      invoices,
      existingPaymentCount: allPayments.length,
      advanceCount: advancePayments.length,
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
    setJournalEntries((prev) => [journal, ...prev]);

    // 4. Audit event
    setAuditEvents((prev) => [prepared.auditEvent, ...prev]);

    // 5. Reconciliation item for bank/cheque
    if (prepared.reconciliationItem) {
      setReconciliationItems((prev) => [prepared.reconciliationItem as ReconciliationItem, ...prev]);
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
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const advanceId = `adv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const prepared = prepareAdvanceDeposit({
      command,
      advanceCount: advancePayments.length,
      existingPaymentCount: allPayments.length,
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
      setReconciliationItems((prev) => [prepared.reconciliationItem as ReconciliationItem, ...prev]);
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

    const remainingDue = Math.max(0, inv.final_amount - (inv.amount_paid || 0) - (inv.credit_notes_total || 0));
    if (remainingDue <= 0) return false;

    const totalAvailable = availableAdvanceCredit(advancePayments, command.clinicId);
    if (totalAvailable <= 0) return false;

    const toApply = Math.min(command.amount, remainingDue, totalAvailable);
    if (toApply <= 0) return false;

    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
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
    date?: string;
  }): AccountAdjustment => {
    const lab = labs.find((l) => l.id === command.clinicId);
    const labName = lab ? lab.name : 'Dental Clinic';
    const inv = invoices.find((i) => i.id === command.invoiceId);
    const adjustmentId = `adj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const prepared = buildCreditNoteAdjustment({
      command,
      invoice: inv,
      adjustmentCount: accountAdjustments.length,
      labName,
      actor: actorName || 'Manager',
      adjustmentId,
    });

    // Update target invoice
    if (inv) {
      setInvoices((prev) => prev.map((item) => (item.id === inv.id ? applyCreditNoteToInvoice(item, command.amount) : item)));
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
      amount: command.amount,
      notes: command.reasonText || `Credit note issued on ${inv?.invoice_number || 'invoice'}`,
    });

    // Audit event
    setAuditEvents((prev) => [prepared.auditEvent, ...prev]);

    return prepared.adjustment;
  };

  const reverseTransactionV2 = (command: {
    referenceType: 'payment' | 'advance_payment' | 'adjustment';
    referenceId: string;
    reason: string;
  }): boolean => {
    if (!command.reason.trim()) return false;
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const actor = actorName || 'Supervisor';

    if (command.referenceType === 'payment') {
      let targetPayment: PaymentRecord | null = null;
      for (const inv of invoices) {
        const p = (inv.payments || []).find((pay) => pay.id === command.referenceId || pay.payment_number === command.referenceId);
        if (p) {
          targetPayment = p;
          break;
        }
      }
      if (!targetPayment) return false;

      // Mark payment reversed on invoices and adjust amount_paid
      setInvoices((prev) =>
        prev.map((inv) => {
          const match = (inv.payments || []).find((p) => p.id === command.referenceId || p.payment_number === command.referenceId);
          if (!match || match.is_reversed) return inv;

          const updatedPayments = (inv.payments || []).map((p) =>
            p.id === match.id ? markReversal(p, command.reason, actor, nowStr) : p,
          );
          return applyPaymentReversalToInvoice(inv, command.referenceId, updatedPayments);
        }),
      );

      // Compensating journal
      const origJournal = journalEntries.find(
        (j) => j.reference_id === targetPayment?.id || j.reference_number === targetPayment?.payment_number,
      );
      if (origJournal) {
        const revJournal = buildReversalJournal(origJournal, command.reason, actor);
        setJournalEntries((prev) => [revJournal, ...prev]);
      }

      setAuditEvents((prev) => [
        buildReversalAuditEvent({
          entityType: 'payment',
          entityId: targetPayment.id,
          entityRef: targetPayment.payment_number || 'PAY',
          amount: targetPayment.amount,
          reason: command.reason,
          actor,
          kind: 'payment',
        }),
        ...prev,
      ]);

      return true;
    } else if (command.referenceType === 'advance_payment') {
      const adv = advancePayments.find((a) => a.id === command.referenceId || a.payment_number === command.referenceId);
      if (!adv || adv.is_reversed) return false;

      setAdvancePayments((prev) =>
        prev.map((a) => (a.id === adv.id ? markReversal(a, command.reason, actor, nowStr, { remaining_amount: 0 }) : a)),
      );

      const origJournal = journalEntries.find(
        (j) => j.reference_id === adv.id || j.reference_number === adv.payment_number,
      );
      if (origJournal) {
        const revJournal = buildReversalJournal(origJournal, command.reason, actor);
        setJournalEntries((prev) => [revJournal, ...prev]);
      }

      setAuditEvents((prev) => [
        buildReversalAuditEvent({
          entityType: 'advance_payment',
          entityId: adv.id,
          entityRef: adv.payment_number,
          amount: adv.amount,
          reason: command.reason,
          actor,
          kind: 'advance',
        }),
        ...prev,
      ]);

      return true;
    } else if (command.referenceType === 'adjustment') {
      const adj = accountAdjustments.find((a) => a.id === command.referenceId || a.adjustment_number === command.referenceId);
      if (!adj || adj.is_reversed) return false;

      // Restore invoice credit if it was a credit note
      if (adj.invoice_id) {
        setInvoices((prev) => prev.map((item) => (item.id === adj.invoice_id ? reverseCreditNoteOnInvoice(item, adj.amount) : item)));
      }

      setAccountAdjustments((prev) => prev.map((a) => (a.id === adj.id ? markReversal(a, command.reason, actor, nowStr) : a)));

      const origJournal = journalEntries.find(
        (j) => j.reference_id === adj.id || j.reference_number === adj.adjustment_number,
      );
      if (origJournal) {
        const revJournal = buildReversalJournal(origJournal, command.reason, actor);
        setJournalEntries((prev) => [revJournal, ...prev]);
      }

      setAuditEvents((prev) => [
        buildReversalAuditEvent({
          entityType: 'adjustment',
          entityId: adj.id,
          entityRef: adj.adjustment_number,
          amount: adj.amount,
          reason: command.reason,
          actor,
          kind: 'adjustment',
        }),
        ...prev,
      ]);

      return true;
    }

    return false;
  };

  const reconcileItemV2 = (id: string, matchNotes?: string) => {
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
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
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
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
    reverseTransactionV2,
    reconcileItemV2,
    flagReconciliationExceptionV2,
  };
}
