import { 
  Invoice, 
  PaymentRecord, 
  AdvancePayment, 
  AccountAdjustment, 
  JournalEntry, 
  JournalLine, 
  PaymentAllocation,
  InvoiceStatusV2
} from '../types';

export const ACCOUNT_CODES = {
  CASH_BANK: { code: '1010', name: 'Cash & Bank Clearing', type: 'asset' as const },
  ACCOUNTS_RECEIVABLE: { code: '1100', name: 'Accounts Receivable (Dental Clinics)', type: 'asset' as const },
  CUSTOMER_ADVANCES: { code: '2100', name: 'Clinic Advance Deposits (Unapplied Credit)', type: 'liability' as const },
  LAB_REVENUE: { code: '4010', name: 'Dental Prosthetics Revenue', type: 'revenue' as const },
  ADJUSTMENTS_WAIVERS: { code: '4090', name: 'Discounts, Waivers & Credit Notes', type: 'expense' as const },
  BAD_DEBT: { code: '6050', name: 'Bad Debt Write-Off', type: 'expense' as const },
  REFUND_CLEARING: { code: '2110', name: 'Refunds Payable', type: 'liability' as const }
};

export const formatPKR = (amount: number): string => {
  const safe = isNaN(amount) ? 0 : Math.round(amount);
  return `PKR ${safe.toLocaleString('en-US')}`;
};

export const generateId = (prefix: string): string => {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
};

export const generateCanonicalReference = (prefix: string, sequenceNum: number): string => {
  return `${prefix}-${new Date().getFullYear()}-${String(sequenceNum).padStart(4, '0')}`;
};

/**
 * Validate that journal lines strictly balance (Sum of Debits === Sum of Credits)
 */
export const assertJournalBalanced = (lines: JournalLine[]): boolean => {
  const totalDebits = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredits = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
  return Math.abs(totalDebits - totalCredits) < 0.01;
};

/**
 * Derive authoritative invoice status based on charges, payments, and credit notes
 */
export const deriveInvoiceStatus = (
  finalAmount: number,
  amountPaid: number,
  dueDate: string,
  creditNotes = 0,
  isDisputed = false,
  isVoided = false
): InvoiceStatusV2 => {
  if (isVoided) return 'voided';
  if (isDisputed) return 'disputed';

  const effectiveNet = Math.max(0, finalAmount - creditNotes);
  const balance = Math.max(0, effectiveNet - amountPaid);

  if (balance <= 0) return 'paid';
  if (amountPaid > 0) return 'partially_paid';

  // Check if overdue
  if (dueDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    if (due < today) return 'overdue';
  }

  return 'open';
};

/**
 * Aging Bucket Calculation
 */
export const getAgingBucket = (dueDate: string): { bucket: 'current' | '1-30' | '31-60' | '61-90' | '90+'; daysOverdue: number } => {
  if (!dueDate) return { bucket: 'current', daysOverdue: 0 };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);

  const diffMs = today.getTime() - due.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days <= 0) return { bucket: 'current', daysOverdue: 0 };
  if (days <= 30) return { bucket: '1-30', daysOverdue: days };
  if (days <= 60) return { bucket: '31-60', daysOverdue: days };
  if (days <= 90) return { bucket: '61-90', daysOverdue: days };
  return { bucket: '90+', daysOverdue: days };
};

/**
 * Build balanced journal for an Invoice issuance
 */
export const buildInvoiceJournal = (
  invoice: Invoice,
  creator = 'System'
): JournalEntry => {
  const lines: JournalLine[] = [
    {
      id: generateId('jline'),
      account_code: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.code,
      account_name: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.name,
      account_type: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.type,
      debit: invoice.final_amount,
      credit: 0
    },
    {
      id: generateId('jline'),
      account_code: ACCOUNT_CODES.LAB_REVENUE.code,
      account_name: ACCOUNT_CODES.LAB_REVENUE.name,
      account_type: ACCOUNT_CODES.LAB_REVENUE.type,
      debit: 0,
      credit: invoice.final_amount
    }
  ];

  assertJournalBalanced(lines);

  return {
    id: generateId('jrn'),
    journal_number: `JRN-INV-${invoice.invoice_number.replace(/[^0-9]/g, '') || Date.now()}`,
    date: invoice.created_at || new Date().toISOString().split('T')[0],
    event_type: 'invoice_issued',
    reference_type: 'invoice',
    reference_id: invoice.id,
    reference_number: invoice.invoice_number,
    lab_id: invoice.lab_id,
    lab_name: invoice.lab_name,
    description: `Billing invoice ${invoice.invoice_number} for ${invoice.case_type_name} (${invoice.case_number})`,
    lines,
    created_at: new Date().toISOString().replace('T', ' ').substring(0, 16),
    created_by: creator
  };
};

/**
 * Build balanced journal for a Payment collection (with optional split allocations & unapplied advance credit remainder)
 */
export const buildPaymentJournal = (
  payment: PaymentRecord,
  allocations: PaymentAllocation[],
  unappliedAmount: number,
  creator = 'Cashier'
): JournalEntry => {
  const totalAllocated = allocations.reduce((sum, a) => sum + a.amount, 0);
  const methodLabel = (payment.payment_method || 'bank').toUpperCase();

  const lines: JournalLine[] = [
    // 1. Debit Cash/Bank for the full received amount
    {
      id: generateId('jline'),
      account_code: ACCOUNT_CODES.CASH_BANK.code,
      account_name: `${ACCOUNT_CODES.CASH_BANK.name} (${methodLabel})`,
      account_type: ACCOUNT_CODES.CASH_BANK.type,
      debit: payment.amount,
      credit: 0
    }
  ];

  // 2. Credit Accounts Receivable for allocated portions
  if (totalAllocated > 0) {
    lines.push({
      id: generateId('jline'),
      account_code: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.code,
      account_name: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.name,
      account_type: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.type,
      debit: 0,
      credit: totalAllocated
    });
  }

  // 3. Credit Customer Advances for unapplied excess remainder
  if (unappliedAmount > 0) {
    lines.push({
      id: generateId('jline'),
      account_code: ACCOUNT_CODES.CUSTOMER_ADVANCES.code,
      account_name: ACCOUNT_CODES.CUSTOMER_ADVANCES.name,
      account_type: ACCOUNT_CODES.CUSTOMER_ADVANCES.type,
      debit: 0,
      credit: unappliedAmount
    });
  }

  assertJournalBalanced(lines);

  return {
    id: generateId('jrn'),
    journal_number: `JRN-PAY-${payment.payment_number?.replace(/[^0-9]/g, '') || Date.now()}`,
    date: payment.payment_date || new Date().toISOString().split('T')[0],
    event_type: 'payment_received',
    reference_type: 'payment',
    reference_id: payment.id,
    reference_number: payment.payment_number || 'PAY',
    lab_id: payment.lab_id || '',
    lab_name: payment.lab_name || '',
    description: `Payment received ${payment.payment_number} via ${methodLabel}${allocations.length ? ` applied to ${allocations.map(a => a.invoice_number).join(', ')}` : ''}${unappliedAmount > 0 ? ` (+${formatPKR(unappliedAmount)} unapplied advance)` : ''}`,
    lines,
    created_at: new Date().toISOString().replace('T', ' ').substring(0, 16),
    created_by: creator
  };
};

/**
 * Build balanced journal for an Advance Deposit
 */
export const buildAdvanceDepositJournal = (
  advance: AdvancePayment,
  creator = 'Cashier'
): JournalEntry => {
  const methodLabel = advance.payment_method.toUpperCase();
  const lines: JournalLine[] = [
    {
      id: generateId('jline'),
      account_code: ACCOUNT_CODES.CASH_BANK.code,
      account_name: `${ACCOUNT_CODES.CASH_BANK.name} (${methodLabel})`,
      account_type: ACCOUNT_CODES.CASH_BANK.type,
      debit: advance.amount,
      credit: 0
    },
    {
      id: generateId('jline'),
      account_code: ACCOUNT_CODES.CUSTOMER_ADVANCES.code,
      account_name: ACCOUNT_CODES.CUSTOMER_ADVANCES.name,
      account_type: ACCOUNT_CODES.CUSTOMER_ADVANCES.type,
      debit: 0,
      credit: advance.amount
    }
  ];

  assertJournalBalanced(lines);

  return {
    id: generateId('jrn'),
    journal_number: `JRN-ADV-${advance.payment_number.replace(/[^0-9]/g, '') || Date.now()}`,
    date: advance.payment_date || new Date().toISOString().split('T')[0],
    event_type: 'advance_deposited',
    reference_type: 'advance_payment',
    reference_id: advance.id,
    reference_number: advance.payment_number,
    lab_id: advance.lab_id,
    lab_name: advance.lab_name,
    description: `Advance deposit ${advance.payment_number} received from ${advance.lab_name} via ${methodLabel}`,
    lines,
    created_at: new Date().toISOString().replace('T', ' ').substring(0, 16),
    created_by: creator
  };
};

/**
 * Build balanced journal for applying advance credit to an invoice
 */
export const buildApplyAdvanceJournal = (
  advanceRef: string,
  invoice: Invoice,
  amount: number,
  creator = 'Staff'
): JournalEntry => {
  const lines: JournalLine[] = [
    {
      id: generateId('jline'),
      account_code: ACCOUNT_CODES.CUSTOMER_ADVANCES.code,
      account_name: ACCOUNT_CODES.CUSTOMER_ADVANCES.name,
      account_type: ACCOUNT_CODES.CUSTOMER_ADVANCES.type,
      debit: amount,
      credit: 0
    },
    {
      id: generateId('jline'),
      account_code: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.code,
      account_name: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.name,
      account_type: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.type,
      debit: 0,
      credit: amount
    }
  ];

  assertJournalBalanced(lines);

  return {
    id: generateId('jrn'),
    journal_number: `JRN-ALLOC-${Date.now().toString(36).toUpperCase()}`,
    date: new Date().toISOString().split('T')[0],
    event_type: 'advance_applied',
    reference_type: 'advance_allocation',
    reference_id: invoice.id,
    reference_number: invoice.invoice_number,
    lab_id: invoice.lab_id,
    lab_name: invoice.lab_name,
    description: `Applied advance credit (${advanceRef}) of ${formatPKR(amount)} to invoice ${invoice.invoice_number}`,
    lines,
    created_at: new Date().toISOString().replace('T', ' ').substring(0, 16),
    created_by: creator
  };
};

/**
 * Build balanced journal for Credit Note / Write-off / Adjustment
 */
export const buildAdjustmentJournal = (
  adj: AccountAdjustment,
  creator = 'Manager'
): JournalEntry => {
  const isCredit = adj.type === 'credit_note' || adj.type === 'write_off';
  const isRefund = adj.type === 'refund';

  let lines: JournalLine[] = [];

  if (isCredit) {
    const account = adj.type === 'write_off' ? ACCOUNT_CODES.BAD_DEBT : ACCOUNT_CODES.ADJUSTMENTS_WAIVERS;
    lines = [
      {
        id: generateId('jline'),
        account_code: account.code,
        account_name: account.name,
        account_type: account.type,
        debit: adj.amount,
        credit: 0
      },
      {
        id: generateId('jline'),
        account_code: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.code,
        account_name: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.name,
        account_type: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.type,
        debit: 0,
        credit: adj.amount
      }
    ];
  } else if (isRefund) {
    lines = [
      {
        id: generateId('jline'),
        account_code: ACCOUNT_CODES.CUSTOMER_ADVANCES.code,
        account_name: ACCOUNT_CODES.CUSTOMER_ADVANCES.name,
        account_type: ACCOUNT_CODES.CUSTOMER_ADVANCES.type,
        debit: adj.amount,
        credit: 0
      },
      {
        id: generateId('jline'),
        account_code: ACCOUNT_CODES.CASH_BANK.code,
        account_name: ACCOUNT_CODES.CASH_BANK.name,
        account_type: ACCOUNT_CODES.CASH_BANK.type,
        debit: 0,
        credit: adj.amount
      }
    ];
  } else {
    // Debit Adjustment (e.g. rush surcharge or courier debit)
    lines = [
      {
        id: generateId('jline'),
        account_code: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.code,
        account_name: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.name,
        account_type: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE.type,
        debit: adj.amount,
        credit: 0
      },
      {
        id: generateId('jline'),
        account_code: ACCOUNT_CODES.LAB_REVENUE.code,
        account_name: ACCOUNT_CODES.LAB_REVENUE.name,
        account_type: ACCOUNT_CODES.LAB_REVENUE.type,
        debit: 0,
        credit: adj.amount
      }
    ];
  }

  assertJournalBalanced(lines);

  return {
    id: generateId('jrn'),
    journal_number: `JRN-ADJ-${adj.adjustment_number.replace(/[^0-9]/g, '') || Date.now()}`,
    date: adj.date || new Date().toISOString().split('T')[0],
    event_type: adj.type,
    reference_type: 'adjustment',
    reference_id: adj.id,
    reference_number: adj.adjustment_number,
    lab_id: adj.lab_id,
    lab_name: adj.lab_name,
    description: `${adj.type.replace('_', ' ').toUpperCase()}: ${adj.reason}`,
    lines,
    created_at: new Date().toISOString().replace('T', ' ').substring(0, 16),
    created_by: creator
  };
};

/**
 * Immutable Reversal: Post equal-and-opposite journal lines linked to original journal
 */
export const buildReversalJournal = (
  original: JournalEntry,
  reason: string,
  actor: string
): JournalEntry => {
  const compensatingLines: JournalLine[] = original.lines.map((l) => ({
    id: generateId('jline'),
    account_code: l.account_code,
    account_name: l.account_name,
    account_type: l.account_type,
    debit: l.credit,
    credit: l.debit
  }));

  assertJournalBalanced(compensatingLines);

  return {
    id: generateId('jrn'),
    journal_number: `JRN-REV-${Date.now().toString(36).toUpperCase()}`,
    date: new Date().toISOString().split('T')[0],
    event_type: 'reversal',
    reference_type: original.reference_type,
    reference_id: original.reference_id,
    reference_number: `REV-OF-${original.reference_number}`,
    lab_id: original.lab_id,
    lab_name: original.lab_name,
    description: `REVERSAL of ${original.journal_number} (${original.reference_number}): ${reason}`,
    lines: compensatingLines,
    created_at: new Date().toISOString().replace('T', ' ').substring(0, 16),
    created_by: actor
  };
};
