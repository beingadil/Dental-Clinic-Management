import type {
  DentalCase,
  Invoice,
  AdvancePayment,
  AccountAdjustment,
  PaymentRecord,
  PaymentAttachment,
  LedgerEntry,
  LedgerEntryType,
  LabFinancialSummary,
} from '../types';

/**
 * Ledger domain — pure financial views extracted from AppContext (audit
 * follow-up to F2): document-number generators, the per-clinic financial
 * summary, the flat payment collection, and the double-entry ledger engine.
 * Pure functions only: no React, no state, no DB. Same arithmetic, ordering
 * and id conventions as the inline implementations they replace.
 */

// ─────────────────────────────────────────────── document number generators

const maxMatch = (values: (string | undefined)[], pattern: RegExp): number => {
  let max = 0;
  for (const value of values) {
    const match = (value || '').match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > max) max = num;
    }
  }
  return max;
};

/**
 * Highest sequence number across BOTH legacy (PAY-0009) and year-formatted
 * (PAY-2026-0009) document numbers. Slice/healed copies (PAY-2026-0009-2,
 * PAY-0012-1, …-D2) contribute their BASE sequence, so a split receipt's base
 * number is never re-issued. Counting rows instead of scanning is what made
 * the generator re-mint numbers that already existed and abort the whole sync.
 */
export const maxDocumentSeq = (numbers: (string | undefined)[], prefix: string): number => {
  // Year form first: PAY-0012-1 would otherwise read as year "0012" with
  // sequence 1 instead of base sequence 12 plus a slice suffix.
  const yearForm = new RegExp(`^${prefix}-\\d{4}-(\\d{4,})(?:-D?\\d+)?$`);
  const legacyForm = new RegExp(`^${prefix}-(\\d+)(?:-D?\\d+)?$`);
  let max = 0;
  for (const value of numbers) {
    const trimmed = (value || '').trim();
    const match = trimmed.match(yearForm) || trimmed.match(legacyForm);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > max) max = num;
    }
  }
  return max;
};

type MaybeNumbered = { case_number?: string; invoice_number?: string; payment_number?: string; adjustment_number?: string } | null | undefined;

/** Next case number DS-0001, based on the existing case list. */
export const nextCaseNumber = (cases: DentalCase[]): string => {
  const maxNum = maxMatch((cases || []).map((c) => (c as MaybeNumbered)?.case_number), /DS-(\d+)/);
  return `DS-${String(maxNum + 1).padStart(4, '0')}`;
};

/** Next invoice number INV-0001. `retiredNumbers` keeps voided invoice numbers
 *  retired, so a deleted invoice's number is never re-issued (audit F13). */
export const nextInvoiceNumber = (invoices: Invoice[], retiredNumbers: (string | undefined)[] = []): string => {
  const live = (invoices || []).map((i) => (i as MaybeNumbered)?.invoice_number);
  const maxNum = maxDocumentSeq([...live, ...retiredNumbers], 'INV');
  return `INV-${String(maxNum + 1).padStart(4, '0')}`;
};

/**
 * Next payment number PAY-0001, scanning the payments nested in invoices.
 * Mixed formats are handled: a year-formatted PAY-2026-0009 counts as sequence
 * 9 (the old /PAY-(\d+)/ read it as 2026 and handed out out-of-range numbers).
 */
export const nextPaymentNumber = (invoices: Invoice[]): string => {
  const flat: string[] = [];
  (invoices || []).forEach((inv) => (inv.payments || []).forEach((p) => flat.push(p.payment_number || '')));
  return `PAY-${String(maxDocumentSeq(flat, 'PAY') + 1).padStart(4, '0')}`;
};

/** Next advance number ADV-0001. */
export const nextAdvanceNumber = (advances: AdvancePayment[]): string => {
  const maxNum = maxMatch((advances || []).map((a) => a?.payment_number), /ADV-(\d+)/);
  return `ADV-${String(maxNum + 1).padStart(4, '0')}`;
};

/** Next adjustment number CR-0001 / DR-0001 / REF-0001, counted per type. */
export const nextAdjustmentNumber = (
  adjustments: AccountAdjustment[],
  type: 'credit_note' | 'debit_adjustment' | 'refund',
): string => {
  const prefix = type === 'credit_note' ? 'CR' : (type === 'debit_adjustment' ? 'DR' : 'REF');
  const maxNum = maxMatch(
    (adjustments || []).filter((a) => a.type === type).map((a) => a?.adjustment_number),
    new RegExp(`${prefix}-(\\d+)`),
  );
  return `${prefix}-${String(maxNum + 1).padStart(4, '0')}`;
};

// ────────────────────────────────────────────────────── payment collection

/**
 * Derived collection of all individual payment transactions across all
 * invoices, with invoice-level fields backfilled and newest-first ordering.
 */
export const collectAllPayments = (invoices: Invoice[]): PaymentRecord[] => {
  const list: PaymentRecord[] = [];
  (invoices || []).forEach((inv) => {
    (inv.payments || []).forEach((p, idx) => {
      list.push({
        ...p,
        payment_number: p.payment_number || `PAY-${String(idx + 1).padStart(4, '0')}`,
        invoice_number: p.invoice_number || inv.invoice_number,
        case_id: p.case_id || inv.case_id,
        case_number: p.case_number || inv.case_number,
        lab_id: p.lab_id || inv.lab_id,
        lab_name: p.lab_name || inv.lab_name,
        attachments: p.attachments || []
      });
    });
  });
  return list.sort((a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime());
};

// ─────────────────────────────────────────────────────── financial summary

/** Derived financial summary for one clinic/lab. */
export const buildLabFinancialSummary = (input: {
  labId: string;
  invoices: Invoice[];
  advancePayments: AdvancePayment[];
  accountAdjustments: AccountAdjustment[];
}): LabFinancialSummary => {
  const { labId, invoices, advancePayments, accountAdjustments } = input;

  const labInvs = (invoices || []).filter((i) => i.lab_id === labId);
  const total_invoiced = labInvs.reduce((sum, inv) => sum + inv.final_amount, 0);
  const total_paid = labInvs.reduce((sum, inv) => sum + (inv.amount_paid || 0), 0);

  const clinicAdvances = (advancePayments || []).filter((a) => a.lab_id === labId);
  const total_advance_received = clinicAdvances.reduce((sum, a) => sum + a.amount, 0);
  const advance_balance = clinicAdvances.reduce((sum, a) => sum + a.remaining_amount, 0);

  const clinicAdjs = (accountAdjustments || []).filter((a) => a.lab_id === labId);
  const total_credit_notes = clinicAdjs.filter((a) => a.type === 'credit_note').reduce((sum, a) => sum + a.amount, 0);
  const total_debit_adjustments = clinicAdjs.filter((a) => a.type === 'debit_adjustment' || a.type === 'refund').reduce((sum, a) => sum + a.amount, 0);

  const unpaidInvoiceAmount = Math.max(0, total_invoiced - total_paid);
  const net_balance = unpaidInvoiceAmount + total_debit_adjustments - advance_balance - total_credit_notes;
  const outstanding_balance = Math.max(0, net_balance);

  let payments_count = 0;
  labInvs.forEach((inv) => {
    payments_count += (inv.payments || []).length;
  });

  return {
    total_invoiced,
    total_paid,
    total_advance_received,
    advance_balance,
    total_credit_notes,
    total_debit_adjustments,
    outstanding_balance,
    net_balance,
    invoices_count: labInvs.length,
    unpaid_invoices_count: labInvs.filter((i) => i.payment_status === 'unpaid').length,
    partial_invoices_count: labInvs.filter((i) => i.payment_status === 'partial').length,
    paid_invoices_count: labInvs.filter((i) => i.payment_status === 'paid').length,
    payments_count,
    advance_count: clinicAdvances.length
  };
};

// ─────────────────────────────────────────────── double-entry ledger engine

/**
 * Builds the comprehensive double-entry ledger: invoices post debits,
 * payments/advances/credit notes post credits, entries are ordered by true
 * posting instant, and a running outstanding balance is calculated oldest to
 * newest. Returns entries newest-first for the UI.
 */
export const buildLedgerEntries = (input: {
  invoices: Invoice[];
  advancePayments: AdvancePayment[];
  accountAdjustments: AccountAdjustment[];
  filterLabId?: string;
}): LedgerEntry[] => {
  const { invoices, advancePayments, accountAdjustments, filterLabId } = input;
  try {
    type RawEvent = {
      date: string;
      timestamp: number;
      lab_id: string;
      lab_name: string;
      entry_type: LedgerEntryType;
      reference_id: string;
      reference_number: string;
      case_id?: string;
      case_number?: string;
      doctor_name?: string;
      description: string;
      debit: number;
      credit: number;
      payment_method?: PaymentRecord['payment_method'];
      attachments_count?: number;
      attachments?: PaymentAttachment[];
      notes?: string;
      recorded_by?: string;
    };

    const rawEvents: RawEvent[] = [];
    const targetInvoices = filterLabId ? (invoices || []).filter((i) => i.lab_id === filterLabId) : (invoices || []);
    const targetAdvances = filterLabId ? (advancePayments || []).filter((a) => a.lab_id === filterLabId) : (advancePayments || []);
    const targetAdjustments = filterLabId ? (accountAdjustments || []).filter((a) => a.lab_id === filterLabId) : (accountAdjustments || []);

    // 1. Invoices -> Debit (Increases Outstanding Receivable)
    targetInvoices.forEach((inv) => {
      const invDate = inv.created_at || new Date().toISOString().slice(0, 10);
      const parsedTime = new Date(invDate).getTime();
      const invTime = isNaN(parsedTime) ? Date.now() : parsedTime;
      const invNum = inv.invoice_number || 'INV';
      const finalAmt = typeof inv.final_amount === 'number' ? inv.final_amount : (typeof inv.amount === 'number' ? inv.amount : 0);

      rawEvents.push({
        date: invDate,
        timestamp: invTime,
        lab_id: inv.lab_id || '',
        lab_name: inv.lab_name || 'Clinic',
        entry_type: 'invoice',
        reference_id: inv.id,
        reference_number: invNum,
        case_id: inv.case_id,
        case_number: inv.case_number,
        doctor_name: inv.doctor_name,
        description: `Invoice for ${inv.case_type_name || 'Restoration'} (${inv.case_number || 'Case'})`,
        debit: finalAmt,
        credit: 0,
        notes: (inv.discount || 0) > 0 ? `Subtotal PKR ${(inv.amount || 0).toLocaleString()} - Discount PKR ${(inv.discount || 0).toLocaleString()}` : undefined
      });

      // 2. Payments for this Invoice -> Credit (if direct) or Allocation Memo (if advance)
      (inv.payments || []).forEach((p, pIdx) => {
        const isAdvanceAlloc = p.payment_method === 'advance' || p.payment_type === 'advance_allocation';
        const pDate = p.payment_date || invDate;
        const pParsedTime = new Date(pDate).getTime();
        const pBaseTime = isNaN(pParsedTime) ? invTime : pParsedTime;
        const methodStr = String(p.payment_method || 'bank').toUpperCase();

        rawEvents.push({
          date: pDate,
          // Offset timestamp slightly to ensure payments occurring on same date sort after invoice creation
          timestamp: pBaseTime + (pIdx + 1) * 1000,
          lab_id: p.lab_id || inv.lab_id || '',
          lab_name: p.lab_name || inv.lab_name || 'Clinic',
          entry_type: isAdvanceAlloc ? 'advance_allocation' : 'payment',
          reference_id: p.id || `pay-${pIdx}`,
          reference_number: p.payment_number || `PAY-${invNum.replace('INV-', '')}-${pIdx + 1}`,
          case_id: p.case_id || inv.case_id,
          case_number: p.case_number || inv.case_number,
          doctor_name: inv.doctor_name,
          description: isAdvanceAlloc
            ? `Advance credit applied to ${invNum} (Ref: ${p.reference_number || 'Advance'})`
            : `Payment received for ${invNum} via ${methodStr}`,
          // If payment was paid from advance, the advance deposit already credited the ledger, so allocation is debit 0, credit 0
          debit: 0,
          credit: isAdvanceAlloc ? 0 : (p.amount || 0),
          payment_method: p.payment_method,
          attachments_count: (p.attachments || []).length,
          attachments: p.attachments || [],
          notes: p.notes || (p.reference_number ? `Ref: ${p.reference_number}` : undefined),
          recorded_by: p.recorded_by
        });
      });
    });

    // 3. Advance Payments / Deposits received from Clinic -> Credit (Decreases Outstanding Receivable / Creates credit surplus)
    targetAdvances.forEach((adv, advIdx) => {
      const advDate = adv.payment_date || adv.created_at || new Date().toISOString().slice(0, 10);
      // Business date first: a backdated deposit must file at its payment
      // date, never at the later record/sync created_at.
      const parsedTime = new Date(advDate).getTime();
      const advTime = isNaN(parsedTime) ? Date.now() : parsedTime;
      const methodStr = String(adv.payment_method || 'cash').toUpperCase();
      const advAmt = adv.amount || 0;
      const remAmt = adv.remaining_amount !== undefined ? adv.remaining_amount : advAmt;
      const availPct = advAmt > 0 ? Math.round((remAmt / advAmt) * 100) : 0;

      rawEvents.push({
        date: advDate,
        timestamp: advTime + (advIdx + 1) * 500,
        lab_id: adv.lab_id || '',
        lab_name: adv.lab_name || 'Clinic',
        entry_type: 'advance_payment',
        reference_id: adv.id,
        reference_number: adv.payment_number || `ADV-${advIdx + 1}`,
        description: `Advance payment deposit received via ${methodStr}${remAmt < advAmt ? ` (${availPct}% available)` : ' (Unallocated)'}`,
        debit: 0,
        credit: advAmt,
        payment_method: adv.payment_method,
        attachments_count: (adv.attachments || []).length,
        attachments: adv.attachments || [],
        notes: adv.notes || (adv.reference_number ? `Ref: ${adv.reference_number}` : undefined),
        recorded_by: adv.recorded_by
      });
    });

    // 4. Account Adjustments (Credit notes, Debit surcharges, Refunds)
    targetAdjustments.forEach((adj, adjIdx) => {
      const isCreditNote = adj.type === 'credit_note';
      const isDebit = adj.type === 'debit_adjustment';
      const adjDate = adj.date || adj.created_at || new Date().toISOString().slice(0, 10);
      // Business date first: credit notes file at their adjustment date.
      const parsedTime = new Date(adjDate).getTime();
      const adjTime = isNaN(parsedTime) ? Date.now() : parsedTime;
      const adjAmt = adj.amount || 0;

      rawEvents.push({
        date: adjDate,
        timestamp: adjTime + (adjIdx + 1) * 300,
        lab_id: adj.lab_id || '',
        lab_name: adj.lab_name || 'Clinic',
        entry_type: adj.type,
        reference_id: adj.id,
        reference_number: adj.adjustment_number || `ADJ-${adjIdx + 1}`,
        description: isCreditNote
          ? `Credit Note: ${adj.reason || 'Discount'}`
          : isDebit
          ? `Debit Adjustment: ${adj.reason || 'Surcharge'}`
          : `Refund to Clinic: ${adj.reason || 'Refund'}`,
        debit: isCreditNote ? 0 : adjAmt,
        credit: isCreditNote ? adjAmt : 0,
        attachments_count: (adj.attachments || []).length,
        attachments: adj.attachments || [],
        notes: (adj.reason || '') + (adj.reference_number ? ` | Ref: ${adj.reference_number}` : ''),
        recorded_by: adj.recorded_by
      });
    });

    // Chronological sort: oldest to newest for calculating running balance
    rawEvents.sort((a, b) => {
      const timeA = typeof a.timestamp === 'number' && !isNaN(a.timestamp) ? a.timestamp : 0;
      const timeB = typeof b.timestamp === 'number' && !isNaN(b.timestamp) ? b.timestamp : 0;
      return timeA - timeB;
    });

    let runningBalance = 0;
    const ledger = rawEvents.map((evt, idx) => {
      runningBalance = runningBalance + evt.debit - evt.credit;
      return {
        id: `ledg-${idx}-${evt.reference_id}`,
        date: evt.date,
        lab_id: evt.lab_id,
        lab_name: evt.lab_name,
        entry_type: evt.entry_type,
        reference_id: evt.reference_id,
        reference_number: evt.reference_number,
        case_id: evt.case_id,
        case_number: evt.case_number,
        doctor_name: evt.doctor_name,
        description: evt.description,
        debit: evt.debit,
        credit: evt.credit,
        running_balance: runningBalance,
        posted_at: new Date(evt.timestamp).toISOString(),
        payment_method: evt.payment_method,
        attachments_count: evt.attachments_count,
        attachments: evt.attachments,
        notes: evt.notes,
        recorded_by: evt.recorded_by
      };
    });

    // Return entries in reverse-chronological order (newest first) for UI, while keeping the accurately calculated running_balance
    return ledger.reverse();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error generating ledger entries:', err);
    return [];
  }
};
