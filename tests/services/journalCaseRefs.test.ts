import { describe, it, expect } from 'vitest';
import {
  buildInvoiceJournal,
  buildPaymentJournal,
  buildAdvanceDepositJournal,
  buildApplyAdvanceJournal,
  buildAdjustmentJournal,
  buildReversalJournal,
} from '../../src/services/financeDomain';
import { Invoice, PaymentRecord, AdvancePayment, AccountAdjustment } from '../../src/types';

const baseInvoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'inv-1',
  invoice_number: 'INV-1001',
  case_id: 'case-1',
  case_number: 'DS-202',
  lab_id: 'lab-1',
  lab_name: 'SA Clinic',
  case_type_name: 'Crown',
  doctor_name: 'Dr. A',
  amount: 25000,
  discount: 0,
  final_amount: 25000,
  amount_paid: 0,
  payment_status: 'unpaid',
  created_at: '2026-09-28',
  due_date: '2026-10-05',
  payments: [],
  ...over,
});

const basePayment = (over: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: 'pay-1',
  payment_number: 'PAY-1001',
  invoice_id: 'inv-1',
  invoice_number: 'INV-1001',
  case_id: 'case-1',
  case_number: 'DS-202',
  lab_id: 'lab-1',
  lab_name: 'SA Clinic',
  amount: 25000,
  payment_method: 'cash',
  payment_date: '2026-09-28',
  recorded_by: 'tester',
  ...over,
} as PaymentRecord);

describe('journal builders — first-class Case/Job references', () => {
  it('invoice journal carries the invoice’s case_id/case_number', () => {
    const j = buildInvoiceJournal(baseInvoice());
    expect(j.case_id).toBe('case-1');
    expect(j.case_number).toBe('DS-202');
  });

  it('payment journal takes case from payment, falls back to explicit caseRef', () => {
    const j1 = buildPaymentJournal(basePayment(), [], 0, 'Cashier');
    expect(j1.case_id).toBe('case-1');

    const noCasePayment = basePayment({ case_id: undefined, case_number: undefined });
    const j2 = buildPaymentJournal(noCasePayment, [], 0, 'Cashier', { case_id: 'case-9', case_number: 'DS-999' });
    expect(j2.case_id).toBe('case-9');
    expect(j2.case_number).toBe('DS-999');
  });

  it('advance deposit is a clinic-level event — no case fabricated', () => {
    const adv = {
      id: 'adv-1', payment_number: 'ADV-0001', lab_id: 'lab-1', lab_name: 'SA Clinic',
      amount: 50000, payment_method: 'cash' as const, payment_date: '2026-09-28',
      recorded_by: 'tester',
    } as AdvancePayment;
    const j = buildAdvanceDepositJournal(adv);
    expect(j.case_id ?? undefined).toBeUndefined();
    expect(j.case_number ?? undefined).toBeUndefined();
  });

  it('advance application journal carries the target invoice’s case', () => {
    const j = buildApplyAdvanceJournal('ADV-0001', baseInvoice(), 10000);
    expect(j.case_id).toBe('case-1');
    expect(j.case_number).toBe('DS-202');
  });

  it('adjustment journal carries case when the adjustment has one', () => {
    const adj = {
      id: 'adj-1', adjustment_number: 'CR-0001', lab_id: 'lab-1', lab_name: 'SA Clinic',
      type: 'credit_note' as const, amount: 5000, reason: 'Goodwill', date: '2026-09-28',
      invoice_id: 'inv-1', invoice_number: 'INV-1001',
      case_id: 'case-1', case_number: 'DS-202',
      recorded_by: 'tester', created_at: '2026-09-28',
    } as AccountAdjustment;
    const j = buildAdjustmentJournal(adj);
    expect(j.case_id).toBe('case-1');
    expect(j.case_number).toBe('DS-202');
  });

  it('reversal journal inherits the original journal’s case', () => {
    const original = buildInvoiceJournal(baseInvoice());
    const rev = buildReversalJournal(original, 'duplicate', 'Manager');
    expect(rev.case_id).toBe(original.case_id);
    expect(rev.case_number).toBe(original.case_number);
    expect(rev.event_type).toBe('reversal');
  });

  it('every builder still produces balanced journals (debits == credits)', () => {
    const journals = [
      buildInvoiceJournal(baseInvoice()),
      buildPaymentJournal(basePayment(), [{
        id: 'alloc-1', source_type: 'payment' as const, source_id: 'pay-1', source_ref: 'PAY-1001',
        invoice_id: 'inv-1', invoice_number: 'INV-1001', amount: 25000, allocated_at: '2026-09-28', allocated_by: 'tester',
      }], 0),
      buildApplyAdvanceJournal('ADV-0001', baseInvoice(), 10000),
    ];
    for (const j of journals) {
      const d = j.lines.reduce((s, l) => s + l.debit, 0);
      const c = j.lines.reduce((s, l) => s + l.credit, 0);
      expect(d).toBe(c);
    }
  });
});
