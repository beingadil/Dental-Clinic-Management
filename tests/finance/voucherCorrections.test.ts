// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTransactionCommands } from '../../src/context/hooks/useTransactionCommands';
import { assertJournalBalanced } from '../../src/services/financeDomain';

/**
 * A payment voucher is a correction, not a second document. Everything the
 * operator can fix on one has to reach the rest of the app, or the register
 * says one thing and the general ledger another:
 *
 *   - the invoice's balance recomputes from the payments that remain
 *   - the receipt's journal is rebuilt, and still balances
 *   - DELETING the voucher restores the invoice's full outstanding, and leaves
 *     the invoice itself untouched
 *
 * Method and date matter as much as the figure. Cash against a bank transfer
 * posts to a different account, and today's date against last week's cheque
 * lands in the wrong ledger period — a "corrected" voucher that still posted to
 * the old account is worse than one that was never corrected.
 */

const RECEIPT = 'PAY-2026-0007';

const mkPayment = (over: Record<string, unknown> = {}) => ({
  id: 'pay-1',
  invoice_id: 'inv-1',
  invoice_number: 'INV-0001',
  payment_number: RECEIPT,
  amount: 4000,
  payment_method: 'cash',
  payment_date: '2026-10-01',
  reference_number: 'TR-1',
  created_at: '2026-10-01 10:00',
  recorded_by: 'cashier',
  journal_id: 'jrn-1',
  ...over,
});

const mkJournal = (over: Record<string, unknown> = {}) => ({
  id: 'jrn-1',
  journal_number: 'JRN-1',
  date: '2026-10-01',
  event_type: 'payment_received',
  reference_type: 'payment',
  reference_id: 'pay-1',
  reference_number: RECEIPT,
  lab_id: 'lab-1',
  lab_name: 'Al-Noor',
  description: 'Payment received',
  lines: [],
  created_at: '2026-10-01 10:00',
  created_by: 'cashier',
  ...over,
});

/** Wires the hook over plain state, so a test reads as a before/after. */
const harness = (paymentOverrides: Record<string, unknown> = {}) => {
  const pay = mkPayment(paymentOverrides);
  let invoices: any[] = [
    {
      id: 'inv-1',
      invoice_number: 'INV-0001',
      lab_id: 'lab-1',
      amount: 10000,
      discount: 0,
      final_amount: 10000,
      amount_paid: 4000,
      payment_status: 'partial',
      payments: [pay],
    },
  ];
  let journalEntries: any[] = [mkJournal()];
  let auditEvents: any[] = [];
  let reconciliationItems: any[] = [];

  const view = renderHook(() =>
    useTransactionCommands({
      labs: [],
      invoices,
      setInvoices: (fn: any) => { invoices = fn(invoices); },
      advancePayments: [],
      setAdvancePayments: vi.fn(),
      journalEntries,
      setJournalEntries: (fn: any) => { journalEntries = fn(journalEntries); },
      auditEvents,
      setAuditEvents: (fn: any) => { auditEvents = fn(auditEvents); },
      reconciliationItems,
      setReconciliationItems: (fn: any) => { reconciliationItems = fn(reconciliationItems); },
      allPayments: [pay],
      pushNotifications: vi.fn(),
      genId: () => 'gen-test',
      saveVoucherToSystem: vi.fn(),
      actorName: 'Tester',
    } as never),
  );

  return {
    ...view,
    pay,
    get invoices() { return invoices; },
    get journal() { return journalEntries[0]; },
    get audit() { return auditEvents; },
  };
};

describe('voucher correction propagates', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => { h = harness(); });

  it('corrects the amount and moves the invoice balance with it', () => {
    act(() => { h.result.current.updatePaymentV2('pay-1', { amount: 9000 }); });
    expect(h.invoices[0].amount_paid).toBe(9000);
    expect(h.invoices[0].payment_status).toBe('partial');
  });

  it('settles the invoice when the corrected amount covers it', () => {
    act(() => { h.result.current.updatePaymentV2('pay-1', { amount: 10000 }); });
    expect(h.invoices[0].amount_paid).toBe(10000);
    expect(h.invoices[0].payment_status).toBe('paid');
  });

  it('rebuilds the journal so it still balances after a correction', () => {
    act(() => { h.result.current.updatePaymentV2('pay-1', { amount: 7500 }); });
    expect(h.journal).toBeTruthy();
    expect(assertJournalBalanced(h.journal.lines)).toBe(true);
  });

  it('moves the ledger to the corrected account when the method changes', () => {
    act(() => { h.result.current.updatePaymentV2('pay-1', { payment_method: 'bank' }); });
    expect(h.invoices[0].payments[0].payment_method).toBe('bank');
    // A bank transfer credits cash-clearing, not cash in hand. If the journal
    // still named the old account the ledger and the register would disagree.
    const accounts = h.journal.lines.map((l: any) => l.account_name).join(' | ');
    expect(accounts).not.toMatch(/Cash in Hand/i);
  });

  it('moves the ledger to the corrected date', () => {
    act(() => { h.result.current.updatePaymentV2('pay-1', { payment_date: '2026-09-28' }); });
    expect(h.invoices[0].payments[0].payment_date).toBe('2026-09-28');
    expect(h.journal.date).toBe('2026-09-28');
  });

  it('records the corrected reference', () => {
    act(() => { h.result.current.updatePaymentV2('pay-1', { reference_number: 'CHQ-77' }); });
    expect(h.invoices[0].payments[0].reference_number).toBe('CHQ-77');
  });

  it('refuses an amount that would overpay the invoice', () => {
    let ok = true;
    act(() => { ok = h.result.current.updatePaymentV2('pay-1', { amount: 99999 }); });
    expect(ok).toBe(false);
    expect(h.invoices[0].amount_paid).toBe(4000);
  });

  it('refuses a zero or negative amount', () => {
    expect(h.result.current.updatePaymentV2('pay-1', { amount: 0 })).toBe(false);
    expect(h.result.current.updatePaymentV2('pay-1', { amount: -5 })).toBe(false);
  });

  it('changes nothing when the value did not actually change', () => {
    const before = h.invoices[0].payments[0].amount;
    expect(h.result.current.updatePaymentV2('pay-1', { amount: before })).toBe(true);
    expect(h.audit).toHaveLength(0);
  });

  it('keeps the long-standing audit action name for an amount change', () => {
    // Renaming it would silently reclassify every historical entry in the trail.
    act(() => { h.result.current.updatePaymentV2('pay-1', { amount: 5000 }); });
    expect(h.audit[0].action).toBe('PAYMENT_AMOUNT_CHANGED');
  });

  it('uses a correction action for the other fields, one line each', () => {
    act(() => {
      h.result.current.updatePaymentV2('pay-1', {
        payment_method: 'cheque',
        payment_date: '2026-09-30',
      });
    });
    expect(h.audit).toHaveLength(2);
    expect(h.audit.every((e: any) => e.action === 'PAYMENT_CORRECTED')).toBe(true);
  });
});

describe('deleting a voucher', () => {
  it('restores the invoice to fully unpaid without touching the invoice', () => {
    const h = harness();
    act(() => { h.result.current.deletePaymentV2('pay-1'); });

    // The invoice is still there, same number, same total.
    expect(h.invoices).toHaveLength(1);
    expect(h.invoices[0].invoice_number).toBe('INV-0001');
    expect(h.invoices[0].final_amount).toBe(10000);
    // …and it is owed in full again, not recreated.
    expect(h.invoices[0].amount_paid).toBe(0);
    expect(h.invoices[0].payments).toHaveLength(0);
    expect(h.invoices[0].payment_status).toBe('unpaid');
  });

  it('takes the journal with it, so cash stops being debited', () => {
    const h = harness();
    act(() => { h.result.current.deletePaymentV2('pay-1'); });
    expect(h.journal).toBeUndefined();
  });

  it('is a no-op for a payment that does not exist', () => {
    const h = harness();
    expect(h.result.current.deletePaymentV2('pay-nope')).toBe(false);
  });
});