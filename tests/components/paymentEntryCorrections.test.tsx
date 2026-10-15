// @vitest-environment jsdom
/**
 * Correcting a payment entry — delete, and change the amount.
 *
 * The reason this is exercised through the command hook rather than through a
 * pure helper: the whole risk of a correction is that the three things that
 * describe the same money drift apart. A payment entry lives in three places at
 * once — the invoice's `amount_paid` total, the receipt's journal on the general
 * ledger, and the audit trail — and a delete or an edit that updates two of them
 * leaves the books disagreeing with themselves in a way nothing else in the app
 * would notice for months. So every assertion below checks a pair of them
 * together, never one alone.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useState } from 'react';
import type {
  AccountAdjustment,
  AdvancePayment,
  Invoice,
  JournalEntry,
  PaymentAllocation,
  PaymentRecord,
  ReconciliationItem,
} from '../../src/types';
import { useTransactionCommands } from '../../src/context/hooks/useTransactionCommands';

const CLINIC = { id: 'lab-1', name: 'Cases Clinic' };

const ALLOCATION: PaymentAllocation = {
  id: 'alloc-1',
  source_type: 'payment',
  source_id: 'pay-1',
  source_ref: 'PAY-2026-0001',
  invoice_id: 'inv-1',
  invoice_number: 'INV-0042',
  amount: 10000,
  allocated_at: '2026-10-05 09:00',
  allocated_by: 'Cashier',
};

/** One stored slice of a single-invoice receipt, as prepareTransaction writes it. */
const slice = (over: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: 'pay-slice-1-inv-1',
  payment_number: 'PAY-2026-0001',
  receipt_number: 'REC-2026-0001',
  invoice_id: 'inv-1',
  invoice_number: 'INV-0042',
  lab_id: CLINIC.id,
  lab_name: CLINIC.name,
  amount: 10000,
  payment_method: 'bank',
  payment_date: '2026-10-05',
  recorded_by: 'Cashier',
  journal_id: 'jrn-1',
  allocations: [ALLOCATION],
  unapplied_amount: 0,
  ...over,
});

const invoice = (payment: PaymentRecord | null, finalAmount = 30000): Invoice => ({
  id: 'inv-1',
  invoice_number: 'INV-0042',
  case_id: 'case-1',
  case_number: 'DS-2001',
  lab_id: CLINIC.id,
  lab_name: CLINIC.name,
  case_type_name: 'Zirconia Crown',
  doctor_name: 'Dr. Tariq Mahmood',
  patient_name: 'Ali Raza',
  amount: finalAmount,
  discount: 0,
  final_amount: finalAmount,
  amount_paid: payment ? payment.amount : 0,
  payment_status: payment ? 'partial' : 'unpaid',
  due_date: '2026-11-05',
  created_at: '2026-10-05 09:00',
  payments: payment ? [payment] : [],
});

/** The receipt's journal, as buildPaymentJournal writes it: debit cash, credit A/R. */
const receiptJournal = (amount = 10000): JournalEntry => ({
  id: 'jrn-1',
  journal_number: 'JRN-PAY-20260001',
  date: '2026-10-05',
  event_type: 'payment_received',
  reference_type: 'payment',
  reference_id: 'pay-1',
  reference_number: 'PAY-2026-0001',
  lab_id: CLINIC.id,
  lab_name: CLINIC.name,
  case_id: 'case-1',
  case_number: 'DS-2001',
  description: 'Payment received PAY-2026-0001 via BANK',
  lines: [
    { id: 'jl-1', account_code: '1010', account_name: 'Cash / Bank (BANK)', account_type: 'asset', debit: amount, credit: 0 },
    { id: 'jl-2', account_code: '1100', account_name: 'Accounts Receivable', account_type: 'asset', debit: 0, credit: amount },
  ],
  created_at: '2026-10-05 09:00',
  created_by: 'Cashier',
});

/** The invoice balance a set of stored payments adds up to. */
const paidOf = (inv: Invoice) =>
  (inv.payments || []).filter((p) => !p.is_reversed).reduce((sum, p) => sum + p.amount, 0);

/**
 * The command hook with its own state, so each test reads the state the command
 * actually produced rather than a copy the test made.
 */
const harness = (initial: {
  invoices: Invoice[];
  journalEntries: JournalEntry[];
  reconciliationItems?: ReconciliationItem[];
}) =>
  renderHook(() => {
    const [invoices, setInvoices] = useState<Invoice[]>(initial.invoices);
    const [advancePayments, setAdvancePayments] = useState<AdvancePayment[]>([]);
    const [accountAdjustments, setAccountAdjustments] = useState<AccountAdjustment[]>([]);
    const [journalEntries, setJournalEntries] = useState<JournalEntry[]>(initial.journalEntries);
    const [auditEvents, setAuditEvents] = useState<{ action: string }[]>([]);
    const [reconciliationItems, setReconciliationItems] = useState<ReconciliationItem[]>(
      initial.reconciliationItems ?? [],
    );

    const api = useTransactionCommands({
      labs: [CLINIC],
      invoices,
      setInvoices,
      advancePayments,
      setAdvancePayments,
      accountAdjustments,
      setAccountAdjustments,
      journalEntries,
      setJournalEntries,
      auditEvents,
      setAuditEvents,
      reconciliationItems,
      setReconciliationItems,
      allPayments: invoices.flatMap((i) => i.payments || []),
      actorName: 'Cashier',
      pushNotifications: () => {},
      genId: (prefix: string) => `${prefix}-1`,
      saveVoucherToSystem: () => ({}),
    });

    return { api, invoices, journalEntries, auditEvents, reconciliationItems };
  });

afterEach(() => cleanup());

describe('deleting a payment entry', () => {
  it('removes the entry, restores the invoice balance and drops the receipt journal', () => {
    const { result } = harness({
      invoices: [invoice(slice())],
      journalEntries: [receiptJournal()],
      reconciliationItems: [
        {
          id: 'rec-1',
          payment_id: 'pay-1',
          reference_number: 'PAY-2026-0001',
          method: 'bank',
          amount: 10000,
          date: '2026-10-05',
          lab_id: CLINIC.id,
          lab_name: CLINIC.name,
          status: 'verified',
          notes: 'Payment PAY-2026-0001',
        },
      ],
    });

    expect(result.current.invoices[0].amount_paid).toBe(10000);

    act(() => {
      result.current.api.deletePaymentV2('pay-slice-1-inv-1');
    });

    const inv = result.current.invoices[0];
    expect(inv.payments).toHaveLength(0);
    // The total is recomputed from the rows that remain, never nudged by a delta.
    expect(inv.amount_paid).toBe(0);
    expect(inv.amount_paid).toBe(paidOf(inv));
    expect(inv.payment_status).toBe('unpaid');
    expect(inv.status_v2).toBe('open');
    // The invoice itself is never touched.
    expect(inv.invoice_number).toBe('INV-0042');
    expect(inv.final_amount).toBe(30000);

    // A payment that no longer exists must not keep debiting cash.
    expect(result.current.journalEntries).toHaveLength(0);
    // Nor keep asking the operator to match cash that was deleted.
    expect(result.current.reconciliationItems).toHaveLength(0);
    expect(result.current.auditEvents[0].action).toBe('PAYMENT_DELETED');
  });

  it('deletes the whole receipt, not one row of one invoice', () => {
    // A receipt that paid across two invoices is stored as one row per invoice.
    const first = slice({ id: 'pay-slice-1-inv-1', payment_number: 'PAY-2026-0001-1', amount: 8000, invoice_id: 'inv-1' });
    const second = slice({
      id: 'pay-slice-2-inv-2',
      payment_number: 'PAY-2026-0001-2',
      amount: 2000,
      invoice_id: 'inv-2',
      invoice_number: 'INV-0043',
    });
    const secondInvoice = { ...invoice(second), id: 'inv-2', invoice_number: 'INV-0043', final_amount: 5000 };

    const { result } = harness({
      invoices: [invoice(first), secondInvoice],
      journalEntries: [receiptJournal()],
    });

    act(() => {
      result.current.api.deletePaymentV2('pay-slice-1-inv-1');
    });

    // Deleting any row of a receipt deletes the receipt: leaving half of it
    // behind would leave a journal that matches neither invoice.
    for (const inv of result.current.invoices) {
      expect(inv.payments).toHaveLength(0);
      expect(inv.amount_paid).toBe(0);
    }
    expect(result.current.journalEntries).toHaveLength(0);
  });

  it('refuses an entry that is not on any invoice', () => {
    const { result } = harness({ invoices: [invoice(slice())], journalEntries: [receiptJournal()] });

    let ok = true;
    act(() => {
      ok = result.current.api.deletePaymentV2('pay-does-not-exist');
    });

    expect(ok).toBe(false);
    expect(result.current.invoices[0].amount_paid).toBe(10000);
    expect(result.current.journalEntries).toHaveLength(1);
  });
});

describe('changing a payment entry\'s amount', () => {
  it('moves the invoice balance and keeps the journal balanced', () => {
    const { result } = harness({ invoices: [invoice(slice())], journalEntries: [receiptJournal()] });

    let ok = false;
    act(() => {
      ok = result.current.api.updatePaymentAmountV2('pay-slice-1-inv-1', 12500);
    });

    expect(ok).toBe(true);
    const inv = result.current.invoices[0];
    expect(inv.payments[0].amount).toBe(12500);
    expect(inv.amount_paid).toBe(12500);
    expect(inv.amount_paid).toBe(paidOf(inv));

    const journal = result.current.journalEntries[0];
    const debits = journal.lines.reduce((sum, l) => sum + l.debit, 0);
    const credits = journal.lines.reduce((sum, l) => sum + l.credit, 0);
    expect(debits).toBe(12500);
    expect(credits).toBe(12500);
    // Rebuilt in place: the journal keeps its identity, so nothing else that
    // points at it (the payment's journal_id) goes stale.
    expect(journal.id).toBe('jrn-1');
    expect(journal.journal_number).toBe('JRN-PAY-20260001');
    expect(result.current.auditEvents[0].action).toBe('PAYMENT_AMOUNT_CHANGED');
  });

  it('settles the invoice when the corrected amount clears the balance', () => {
    const { result } = harness({ invoices: [invoice(slice())], journalEntries: [receiptJournal()] });

    act(() => {
      result.current.api.updatePaymentAmountV2('pay-slice-1-inv-1', 30000);
    });

    const inv = result.current.invoices[0];
    expect(inv.amount_paid).toBe(30000);
    expect(inv.payment_status).toBe('paid');
    expect(inv.status_v2).toBe('paid');
  });

  it('refuses an amount that would take the invoice past settled', () => {
    const { result } = harness({ invoices: [invoice(slice())], journalEntries: [receiptJournal()] });

    let ok = true;
    act(() => {
      ok = result.current.api.updatePaymentAmountV2('pay-slice-1-inv-1', 45000);
    });

    // The excess belongs in an advance deposit, which is a different document
    // with its own number and its own liability line.
    expect(ok).toBe(false);
    expect(result.current.invoices[0].amount_paid).toBe(10000);
    expect(result.current.invoices[0].payments[0].amount).toBe(10000);
    expect(result.current.journalEntries[0].lines[0].debit).toBe(10000);
    expect(result.current.auditEvents).toHaveLength(0);
  });

  it('refuses a nonsensical amount', () => {
    const { result } = harness({ invoices: [invoice(slice())], journalEntries: [receiptJournal()] });

    for (const bad of [0, -500, Number.NaN]) {
      let ok = true;
      act(() => {
        ok = result.current.api.updatePaymentAmountV2('pay-slice-1-inv-1', bad);
      });
      expect(ok).toBe(false);
    }

    expect(result.current.invoices[0].amount_paid).toBe(10000);
  });
});
