import { describe, it, expect } from 'vitest';
import { buildInvoiceAccountPosition } from '../../src/services/invoiceAccount';
import type {
  AccountAdjustment,
  AdvancePayment,
  DentalLab,
  Invoice,
  PaymentRecord,
} from '../../src/types';

const invoiceWith = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: 'inv-1',
    invoice_number: 'INV-0001',
    case_id: 'case-1',
    case_number: 'DS-0001',
    lab_id: 'lab-1',
    lab_name: 'Clinic One',
    case_type_name: 'Zirconia Crown',
    doctor_name: 'Dr. Tariq',
    amount: 10000,
    discount: 0,
    final_amount: 10000,
    amount_paid: 0,
    payment_status: 'unpaid',
    issue_date: '2026-10-05',
    due_date: '2026-10-20',
    created_at: '2026-10-05',
    payments: [],
    ...over,
  }) as Invoice;

const paymentWith = (over: Partial<PaymentRecord> = {}): PaymentRecord =>
  ({
    id: 'pay-1',
    invoice_id: 'inv-1',
    amount: 1000,
    payment_method: 'cash',
    payment_date: '2026-10-06',
    recorded_by: 'Staff',
    ...over,
  }) as PaymentRecord;

const advanceWith = (over: Partial<AdvancePayment> = {}): AdvancePayment =>
  ({
    id: 'adv-1',
    payment_number: 'ADV-0001',
    lab_id: 'lab-1',
    lab_name: 'Clinic One',
    amount: 5000,
    allocated_amount: 0,
    remaining_amount: 5000,
    payment_method: 'cash',
    payment_date: '2026-10-01',
    created_at: '2026-10-01 09:00',
    recorded_by: 'Staff',
    ...over,
  }) as AdvancePayment;

const adjustmentWith = (over: Partial<AccountAdjustment> = {}): AccountAdjustment =>
  ({
    id: 'adj-1',
    adjustment_number: 'CR-0001',
    lab_id: 'lab-1',
    lab_name: 'Clinic One',
    type: 'credit_note',
    amount: 2000,
    reason: 'goodwill',
    date: '2026-10-06',
    created_at: '2026-10-06 09:00',
    status: 'posted',
    ...over,
  }) as AccountAdjustment;

const labWith = (over: Partial<DentalLab> = {}): DentalLab =>
  ({
    id: 'lab-1',
    name: 'Clinic One',
    opening_balance: 0,
    opening_balance_type: 'debit',
    ...over,
  }) as DentalLab;

const build = (over: {
  invoice?: Partial<Invoice>;
  invoices?: Invoice[];
  advances?: AdvancePayment[];
  adjustments?: AccountAdjustment[];
  labs?: DentalLab[];
} = {}) => {
  const invoice = invoiceWith(over.invoice);
  return buildInvoiceAccountPosition({
    invoice,
    invoices: over.invoices || [invoice],
    advancePayments: over.advances || [],
    accountAdjustments: over.adjustments || [],
    labs: over.labs || [labWith()],
  });
};

describe('invoice account position — advance deposits', () => {
  it('carries an unallocated advance into both opening and closing', () => {
    const position = build({ advances: [advanceWith()] });

    expect(position.openingBalance).toBe(-5000);
    expect(position.advanceDeposit).toBe(5000);
    expect(position.invoiceAmount).toBe(10000);
    expect(position.cashPaid).toBe(0);
    expect(position.closingBalance).toBe(5000);
  });

  it('does not count an advance twice when it is applied to this invoice', () => {
    const invoice = invoiceWith({
      amount_paid: 5000,
      payment_status: 'partial',
      payments: [
        paymentWith({
          amount: 5000,
          payment_method: 'advance',
          payment_type: 'advance_allocation',
          payment_date: '2026-10-05',
        }),
      ],
    });

    const position = buildInvoiceAccountPosition({
      invoice,
      invoices: [invoice],
      advancePayments: [advanceWith({ allocated_amount: 5000, remaining_amount: 0 })],
      accountAdjustments: [],
      labs: [labWith()],
    });

    expect(position.openingBalance).toBe(-5000);
    expect(position.advanceApplied).toBe(5000);
    expect(position.cashPaid).toBe(0);
    expect(position.closingBalance).toBe(5000);
  });

  it('keeps a same-day deposit visible even when it is applied the same day', () => {
    const invoice = invoiceWith({
      amount_paid: 5000,
      payments: [
        paymentWith({
          amount: 5000,
          payment_method: 'advance',
          payment_type: 'advance_allocation',
          payment_date: '2026-10-05',
        }),
      ],
    });

    const position = buildInvoiceAccountPosition({
      invoice,
      invoices: [invoice],
      advancePayments: [advanceWith({ payment_date: '2026-10-05', allocated_amount: 5000, remaining_amount: 0 })],
      accountAdjustments: [],
      labs: [labWith()],
    });

    expect(position.openingBalance).toBe(-5000);
    expect(position.advanceDeposit).toBe(5000);
    expect(position.closingBalance).toBe(5000);
  });

  it('nets an advance against earlier unpaid invoices in the opening balance', () => {
    const prior = invoiceWith({
      id: 'inv-0',
      invoice_number: 'INV-0000',
      final_amount: 4000,
      issue_date: '2026-10-02',
      created_at: '2026-10-02',
    });

    const position = build({
      invoices: [invoiceWith(), prior],
      advances: [advanceWith()],
    });

    expect(position.openingBalance).toBe(-1000);
    expect(position.advanceDeposit).toBe(1000);
    expect(position.closingBalance).toBe(9000);
  });

  it('does not double-count an advance that already settled an earlier invoice', () => {
    const prior = invoiceWith({
      id: 'inv-0',
      invoice_number: 'INV-0000',
      final_amount: 5000,
      amount_paid: 5000,
      payment_status: 'paid',
      issue_date: '2026-10-02',
      created_at: '2026-10-02',
      payments: [
        paymentWith({
          id: 'pay-adv-prior',
          invoice_id: 'inv-0',
          amount: 5000,
          payment_method: 'advance',
          payment_type: 'advance_allocation',
          payment_date: '2026-10-03',
        }),
      ],
    });

    const position = build({
      invoices: [invoiceWith(), prior],
      advances: [advanceWith({ allocated_amount: 5000, remaining_amount: 0 })],
    });

    expect(position.openingBalance).toBe(0);
    expect(position.advanceDeposit).toBe(0);
    expect(position.closingBalance).toBe(10000);
  });
});

describe('invoice account position — payments and credits', () => {
  it('reduces the closing balance, not the opening, for cash paid on this invoice', () => {
    const position = build({
      invoice: {
        amount_paid: 3000,
        payment_status: 'partial',
        payments: [paymentWith({ amount: 3000 })],
      },
    });

    expect(position.openingBalance).toBe(0);
    expect(position.cashPaid).toBe(3000);
    expect(position.closingBalance).toBe(7000);
  });

  it('settles earlier invoices through their own cash payments', () => {
    const prior = invoiceWith({
      id: 'inv-0',
      invoice_number: 'INV-0000',
      final_amount: 5000,
      amount_paid: 5000,
      payment_status: 'paid',
      issue_date: '2026-10-01',
      created_at: '2026-10-01',
      payments: [paymentWith({ id: 'pay-prior', invoice_id: 'inv-0', amount: 5000, payment_date: '2026-10-02' })],
    });

    const position = build({ invoices: [invoiceWith(), prior] });

    expect(position.openingBalance).toBe(0);
    expect(position.closingBalance).toBe(10000);
  });

  it('subtracts a credit note from the closing balance', () => {
    const position = build({
      invoice: { credit_notes_total: 2000 },
      adjustments: [adjustmentWith({ invoice_id: 'inv-1' })],
    });

    expect(position.openingBalance).toBe(0);
    expect(position.creditNotes).toBe(2000);
    expect(position.closingBalance).toBe(8000);
  });

  it('uses the booking day, not a rewritten delivery-date issue date', () => {
    const later = invoiceWith({
      id: 'inv-later',
      invoice_number: 'INV-0002',
      final_amount: 4000,
      issue_date: '2026-10-10',
      created_at: '2026-10-10',
    });

    const position = build({
      invoice: { issue_date: '2026-10-20' },
      invoices: [invoiceWith({ issue_date: '2026-10-20' }), later],
      advances: [advanceWith({ payment_date: '2026-10-06' })],
    });

    expect(position.openingBalance).toBe(0);
    expect(position.advanceDeposit).toBe(0);
    expect(position.closingBalance).toBe(10000);
  });

  it('includes an earlier booking even when its printed issue date is later', () => {
    const prior = invoiceWith({
      id: 'inv-0',
      invoice_number: 'INV-0000',
      final_amount: 4000,
      issue_date: '2026-10-30',
      created_at: '2026-10-01',
    });

    const position = build({ invoices: [invoiceWith(), prior] });

    expect(position.openingBalance).toBe(4000);
    expect(position.closingBalance).toBe(14000);
  });

  it('ignores payments and advances dated after the invoice', () => {
    const prior = invoiceWith({
      id: 'inv-0',
      invoice_number: 'INV-0000',
      final_amount: 4000,
      issue_date: '2026-10-06',
      created_at: '2026-10-06',
    });

    const position = build({
      invoices: [invoiceWith(), prior],
      advances: [advanceWith({ payment_date: '2026-10-06' })],
    });

    expect(position.openingBalance).toBe(0);
    expect(position.advanceDeposit).toBe(0);
    expect(position.closingBalance).toBe(10000);
  });
});

describe('invoice account position — clinic opening balance', () => {
  it('treats a credit opening balance as money we owe but not as an advance', () => {
    const position = build({
      labs: [labWith({ opening_balance: 2000, opening_balance_type: 'credit' })],
    });

    expect(position.openingBalance).toBe(-2000);
    expect(position.advanceDeposit).toBe(0);
    expect(position.closingBalance).toBe(8000);
  });

  it('adds a debit opening balance to the closing balance', () => {
    const position = build({
      labs: [labWith({ opening_balance: 2000, opening_balance_type: 'debit' })],
    });

    expect(position.openingBalance).toBe(2000);
    expect(position.closingBalance).toBe(12000);
  });

  it('ignores documents belonging to another clinic', () => {
    const otherAdvance = advanceWith({ id: 'adv-other', lab_id: 'lab-2' });
    const otherInvoice = invoiceWith({
      id: 'inv-other',
      invoice_number: 'INV-9999',
      lab_id: 'lab-2',
      final_amount: 9000,
      created_at: '2026-10-01',
    });

    const position = build({
      invoices: [invoiceWith(), otherInvoice],
      advances: [otherAdvance],
    });

    expect(position.openingBalance).toBe(0);
    expect(position.closingBalance).toBe(10000);
  });
});
