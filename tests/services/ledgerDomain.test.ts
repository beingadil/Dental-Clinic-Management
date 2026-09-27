import { describe, it, expect } from 'vitest';
import {
  nextCaseNumber,
  nextInvoiceNumber,
  nextPaymentNumber,
  nextAdvanceNumber,
  nextAdjustmentNumber,
  collectAllPayments,
  buildLabFinancialSummary,
  buildLedgerEntries,
} from '../../src/services/ledgerDomain';
import type { DentalCase, Invoice, AdvancePayment, AccountAdjustment, PaymentRecord } from '../../src/types';

const caseWith = (id: string, num?: string) =>
  ({ id, case_number: num, status: 'received' }) as unknown as DentalCase;

const invWith = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: over.id || 'inv-1',
    invoice_number: 'INV-0001',
    lab_id: 'lab-1',
    lab_name: 'Clinic One',
    amount: 100,
    discount: 0,
    final_amount: 100,
    amount_paid: 0,
    payment_status: 'unpaid',
    status_v2: 'open',
    payments: [],
    created_at: '2026-09-01',
    ...over,
  }) as Invoice;

const payWith = (over: Partial<PaymentRecord>): PaymentRecord =>
  ({
    id: 'pay-1',
    amount: 40,
    payment_method: 'cash',
    payment_date: '2026-09-05',
    created_at: '2026-09-05 10:00',
    ...over,
  }) as PaymentRecord;

const advWith = (over: Partial<AdvancePayment>): AdvancePayment =>
  ({
    id: 'adv-1',
    payment_number: 'ADV-0001',
    lab_id: 'lab-1',
    lab_name: 'Clinic One',
    amount: 200,
    allocated_amount: 0,
    remaining_amount: 200,
    payment_method: 'cash',
    status: 'available',
    created_at: '2026-09-02 09:00',
    ...over,
  }) as AdvancePayment;

const adjWith = (over: Partial<AccountAdjustment>): AccountAdjustment =>
  ({
    id: 'adj-1',
    adjustment_number: 'CR-0001',
    lab_id: 'lab-1',
    lab_name: 'Clinic One',
    type: 'credit_note',
    amount: 20,
    reason: 'goodwill',
    status: 'posted',
    created_at: '2026-09-03 09:00',
    ...over,
  }) as unknown as AccountAdjustment;

describe('document number generators', () => {
  it('returns the first number when lists are empty', () => {
    expect(nextCaseNumber([])).toBe('DS-0001');
    expect(nextInvoiceNumber([])).toBe('INV-0001');
    expect(nextPaymentNumber([])).toBe('PAY-0001');
    expect(nextAdvanceNumber([])).toBe('ADV-0001');
    expect(nextAdjustmentNumber([], 'credit_note')).toBe('CR-0001');
  });

  it('increments past the highest existing number', () => {
    expect(nextCaseNumber([caseWith('c1', 'DS-0007')])).toBe('DS-0008');
    expect(nextInvoiceNumber([invWith({ invoice_number: 'INV-0041' })])).toBe('INV-0042');
    expect(
      nextPaymentNumber([invWith({ payments: [payWith({ payment_number: 'PAY-0009' })] })]),
    ).toBe('PAY-0010');
    expect(nextAdvanceNumber([advWith({ payment_number: 'ADV-0003' })])).toBe('ADV-0004');
  });

  it('counts adjustment numbers per type', () => {
    const adjs = [
      adjWith({ adjustment_number: 'CR-0002' }),
      adjWith({ id: 'adj-2', type: 'debit_adjustment', adjustment_number: 'DR-0005' }),
    ];
    expect(nextAdjustmentNumber(adjs, 'credit_note')).toBe('CR-0003');
    expect(nextAdjustmentNumber(adjs, 'debit_adjustment')).toBe('DR-0006');
    expect(nextAdjustmentNumber(adjs, 'refund')).toBe('REF-0001');
  });
});

describe('collectAllPayments', () => {
  it('flattens payments across invoices, backfills invoice fields, newest first', () => {
    const result = collectAllPayments([
      invWith({
        id: 'inv-1',
        invoice_number: 'INV-0001',
        case_id: 'c1',
        case_number: 'DS-0001',
        payments: [payWith({ id: 'p1', payment_date: '2026-09-05' })],
      }),
      invWith({
        id: 'inv-2',
        invoice_number: 'INV-0002',
        case_id: 'c2',
        case_number: 'DS-0002',
        payments: [payWith({ id: 'p2', payment_date: '2026-09-10' })],
      }),
    ]);

    expect(result.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(result[0].invoice_number).toBe('INV-0002');
    expect(result[0].case_number).toBe('DS-0002');
    expect(result[0].lab_name).toBe('Clinic One');
  });
});

describe('buildLabFinancialSummary', () => {
  it('computes totals, advance balance and outstanding for one clinic', () => {
    const summary = buildLabFinancialSummary({
      labId: 'lab-1',
      invoices: [
        invWith({ final_amount: 100, amount_paid: 40, payment_status: 'partial', payments: [payWith({ id: 'p1' })] }),
        invWith({ id: 'inv-2', invoice_number: 'INV-0002', final_amount: 50, amount_paid: 50, payment_status: 'paid', payments: [payWith({ id: 'p2', amount: 50 })] }),
      ],
      advancePayments: [advWith({ amount: 30, remaining_amount: 10 })],
      accountAdjustments: [
        adjWith({ amount: 20, type: 'credit_note' }),
        adjWith({ id: 'adj-2', amount: 5, type: 'debit_adjustment', adjustment_number: 'DR-0001' }),
      ],
    });

    expect(summary.total_invoiced).toBe(150);
    expect(summary.total_paid).toBe(90);
    expect(summary.total_advance_received).toBe(30);
    expect(summary.advance_balance).toBe(10);
    expect(summary.total_credit_notes).toBe(20);
    expect(summary.total_debit_adjustments).toBe(5);
    // net = max(0, 150-90) + 5 - 10 - 20 = 35
    expect(summary.net_balance).toBe(35);
    expect(summary.outstanding_balance).toBe(35);
    expect(summary.invoices_count).toBe(2);
    expect(summary.partial_invoices_count).toBe(1);
    expect(summary.paid_invoices_count).toBe(1);
    expect(summary.payments_count).toBe(2);
    expect(summary.advance_count).toBe(1);
  });
});

describe('buildLedgerEntries', () => {
  it('posts invoice debit, payment credit, and computes a running balance', () => {
    const ledger = buildLedgerEntries({
      invoices: [
        invWith({
          final_amount: 100,
          created_at: '2026-09-01',
          payments: [payWith({ amount: 40, payment_date: '2026-09-05' })],
        }),
      ],
      advancePayments: [],
      accountAdjustments: [],
    });

    expect(ledger).toHaveLength(2);
    // newest first: payment is the last entry, returned first
    expect(ledger[0].entry_type).toBe('payment');
    expect(ledger[0].credit).toBe(40);
    expect(ledger[0].running_balance).toBe(60);
    expect(ledger[1].entry_type).toBe('invoice');
    expect(ledger[1].debit).toBe(100);
    expect(ledger[1].running_balance).toBe(100);
  });

  it('treats advance allocations as memo rows (no credit) and deposits as credits', () => {
    const ledger = buildLedgerEntries({
      invoices: [
        invWith({
          final_amount: 100,
          created_at: '2026-09-01',
          payments: [payWith({ payment_method: 'advance', payment_type: 'advance_allocation' })],
        }),
      ],
      advancePayments: [advWith({ amount: 200 })],
      accountAdjustments: [],
    });

    const alloc = ledger.find((e) => e.entry_type === 'advance_allocation');
    const deposit = ledger.find((e) => e.entry_type === 'advance_payment');
    expect(alloc).toBeDefined();
    expect(alloc!.credit).toBe(0);
    expect(deposit).toBeDefined();
    expect(deposit!.credit).toBe(200);
    // final balance: 100 debit - 200 credit = -100 (clinic credit surplus)
    expect(ledger[0].running_balance).toBe(-100);
  });

  it('posts credit notes as credits and debit adjustments as debits', () => {
    const ledger = buildLedgerEntries({
      invoices: [],
      advancePayments: [],
      accountAdjustments: [
        adjWith({ amount: 20, type: 'credit_note' }),
        adjWith({ id: 'adj-2', amount: 5, type: 'debit_adjustment', adjustment_number: 'DR-0001' }),
        adjWith({ id: 'adj-3', amount: 7, type: 'refund', adjustment_number: 'REF-0001' }),
      ],
    });

    const cr = ledger.find((e) => e.reference_number === 'CR-0001')!;
    const dr = ledger.find((e) => e.reference_number === 'DR-0001')!;
    const ref = ledger.find((e) => e.reference_number === 'REF-0001')!;
    expect(cr.credit).toBe(20);
    expect(dr.debit).toBe(5);
    expect(ref.debit).toBe(7);
  });

  it('filters to a single clinic when asked', () => {
    const ledger = buildLedgerEntries({
      invoices: [invWith({ lab_id: 'lab-1' }), invWith({ id: 'inv-2', invoice_number: 'INV-0002', lab_id: 'lab-2' })],
      advancePayments: [],
      accountAdjustments: [],
      filterLabId: 'lab-2',
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].lab_id).toBe('lab-2');
  });
});
