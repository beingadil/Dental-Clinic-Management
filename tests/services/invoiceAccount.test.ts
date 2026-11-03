import { describe, it, expect } from 'vitest';
import {
  buildInvoiceAccountPosition,
  buildStatementAccountPosition,
} from '../../src/services/invoiceAccount';
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

  it('prints a same-day deposit as a receipt, not as opening credit', () => {
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

    /* The deposit and the invoice share a day, so the deposit is a receipt of
       that day: opening is nil, the money appears once under "Advance received
       this period", and the application is only a memo. The closing figure is
       unchanged — this is a classification fix, not a new balance. */
    expect(position.openingBalance).toBe(0);
    expect(position.advanceDeposit).toBe(0);
    expect(position.advanceReceived).toBe(5000);
    expect(position.advanceApplied).toBe(5000);
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

describe('statement account position — period dated opening and closing', () => {
  /* The Mir Dental case, pinned: two invoices raised in September 2026 for
     172,500, a 23,000 cash receipt, and a 50,000 deposit that was recorded as
     an advance and never applied. The old statement derived an opening of
     50,000 Cr from TODAY'S net balance and printed "Paid 23,000", so the
     clinic read as if it had been in credit before the invoices existed and
     as if 50,000 of its money had gone missing. The closing (99,500 Dr) was
     always right; the story around it was not. */
  const mirInvoices = (): Invoice[] => [
    invoiceWith({
      id: 'mir-inv-1',
      invoice_number: 'INV-0101',
      final_amount: 100000,
      amount_paid: 23000,
      payment_status: 'partial',
      created_at: '2026-09-05',
      issue_date: '2026-09-05',
      payments: [
        paymentWith({
          id: 'mir-pay-1',
          invoice_id: 'mir-inv-1',
          amount: 23000,
          payment_method: 'cash',
          payment_date: '2026-09-20',
        }),
      ],
    }),
    invoiceWith({
      id: 'mir-inv-2',
      invoice_number: 'INV-0102',
      final_amount: 72500,
      amount_paid: 0,
      payment_status: 'unpaid',
      created_at: '2026-09-18',
      issue_date: '2026-09-18',
    }),
  ];

  const mirAdvance = (over: Partial<AdvancePayment> = {}): AdvancePayment =>
    advanceWith({
      id: 'mir-adv-1',
      amount: 50000,
      allocated_amount: 0,
      remaining_amount: 50000,
      payment_date: '2026-09-10',
      created_at: '2026-09-10 09:00',
      ...over,
    });

  const buildPeriod = (over: {
    period: { from: string; to: string };
    invoices?: Invoice[];
    advances?: AdvancePayment[];
    adjustments?: AccountAdjustment[];
    labs?: DentalLab[];
  }) =>
    buildStatementAccountPosition({
      labId: 'lab-1',
      invoices: over.invoices || mirInvoices(),
      advancePayments: over.advances || [mirAdvance()],
      accountAdjustments: over.adjustments || [],
      labs: over.labs || [labWith({ id: 'lab-1', name: 'Mir Dental' })],
      period: over.period,
    });

  it('pins the Mir Dental September statement: 0 + 172,500 − 23,000 − 50,000 = 99,500', () => {
    const position = buildPeriod({ period: { from: '2026-09-01', to: '2026-09-30' } });

    // Opening is a DATE, not today's balance: nothing was posted before
    // September, so the clinic starts at nil — not at 50,000 Cr.
    expect(position.openingBalance).toBe(0);
    expect(position.advanceDeposit).toBe(0);
    expect(position.invoiceAmount).toBe(172500);
    expect(position.cashPaid).toBe(23000);
    // The deposit is its own receipt line. It is never netted into opening.
    expect(position.advanceReceived).toBe(50000);
    expect(position.advanceApplied).toBe(0);
    expect(position.closingBalance).toBe(99500);
    // And the reader is told the 50,000 is still unapplied, so the invoices
    // showing unpaid is not a mystery.
    expect(position.unallocatedAdvance).toBe(50000);
  });

  it('never lets a post-period receipt leak backwards into the opening', () => {
    const invoices = mirInvoices();
    // The 23,000 arrived in October, after the September statement closed.
    invoices[0].payments = [
      paymentWith({
        id: 'late-pay',
        invoice_id: 'mir-inv-1',
        amount: 23000,
        payment_date: '2026-10-02',
      }),
    ];

    const september = buildPeriod({
      period: { from: '2026-09-01', to: '2026-09-30' },
      invoices,
      advances: [],
    });

    expect(september.openingBalance).toBe(0);
    expect(september.cashPaid).toBe(0);
    expect(september.closingBalance).toBe(172500);

    const october = buildPeriod({
      period: { from: '2026-10-01', to: '2026-10-31' },
      invoices,
      advances: [],
    });
    // The September balance is the October opening, and the receipt lands in
    // the month it was banked.
    expect(october.openingBalance).toBe(172500);
    expect(october.invoiceAmount).toBe(0);
    expect(october.cashPaid).toBe(23000);
    expect(october.closingBalance).toBe(149500);
  });

  it('does not pull later invoices into an earlier closing', () => {
    const later = invoiceWith({
      id: 'mir-inv-3',
      invoice_number: 'INV-0103',
      final_amount: 50000,
      created_at: '2026-10-06',
      issue_date: '2026-10-06',
      payments: [
        paymentWith({ id: 'oct-pay', invoice_id: 'mir-inv-3', amount: 20000, payment_date: '2026-10-08' }),
      ],
    });

    const september = buildPeriod({
      period: { from: '2026-09-01', to: '2026-09-30' },
      invoices: [...mirInvoices(), later],
    });
    expect(september.invoiceAmount).toBe(172500);
    expect(september.closingBalance).toBe(99500);

    const october = buildPeriod({
      period: { from: '2026-10-01', to: '2026-10-31' },
      invoices: [...mirInvoices(), later],
    });
    expect(october.openingBalance).toBe(99500);
    expect(october.invoiceAmount).toBe(50000);
    expect(october.cashPaid).toBe(20000);
    expect(october.closingBalance).toBe(129500);
  });

  it('shows a deposit banked before the period as opening credit, with a memo', () => {
    const position = buildPeriod({
      period: { from: '2026-09-01', to: '2026-09-30' },
      advances: [mirAdvance({ payment_date: '2026-08-20', created_at: '2026-08-20 09:00' })],
    });

    expect(position.openingBalance).toBe(-50000);
    expect(position.advanceDeposit).toBe(50000);
    expect(position.advanceReceived).toBe(0);
    expect(position.closingBalance).toBe(99500);
    expect(position.unallocatedAdvance).toBe(50000);
  });

  it('keeps credit notes and debit notes on their own lines', () => {
    const position = buildPeriod({
      period: { from: '2026-09-01', to: '2026-09-30' },
      adjustments: [
        adjustmentWith({
          id: 'mir-cn',
          type: 'credit_note',
          amount: 5000,
          invoice_id: 'mir-inv-1',
          date: '2026-09-22',
        }),
        adjustmentWith({
          id: 'mir-dn',
          type: 'debit_adjustment',
          amount: 2000,
          invoice_id: 'mir-inv-1',
          date: '2026-09-23',
        }),
      ],
    });

    expect(position.creditNotes).toBe(5000);
    expect(position.debitNotes).toBe(2000);
    // 172,500 − 23,000 − 50,000 − 5,000 + 2,000
    expect(position.closingBalance).toBe(96500);
  });

  it('treats an advance application as a 0/0 memo and shrinks the wallet', () => {
    const invoices = mirInvoices();
    invoices[1] = {
      ...invoices[1],
      amount_paid: 30000,
      payment_status: 'partial',
      payments: [
        paymentWith({
          id: 'mir-alloc',
          invoice_id: 'mir-inv-2',
          amount: 30000,
          payment_method: 'advance',
          payment_type: 'advance_allocation',
          advance_payment_id: 'mir-adv-1',
          payment_date: '2026-09-25',
        }),
      ],
    };

    const position = buildPeriod({
      period: { from: '2026-09-01', to: '2026-09-30' },
      invoices,
      advances: [mirAdvance({ allocated_amount: 30000, remaining_amount: 20000 })],
    });

    // The deposit already carried the credit when it was banked; applying it
    // must not move the closing balance.
    expect(position.advanceApplied).toBe(30000);
    expect(position.closingBalance).toBe(99500);
    expect(position.unallocatedAdvance).toBe(20000);
  });

  it('carries the clinic opening balance at its own date', () => {
    const debitOpen = buildPeriod({
      period: { from: '2026-09-01', to: '2026-09-30' },
      labs: [
        labWith({
          id: 'lab-1',
          opening_balance: 10000,
          opening_balance_type: 'debit',
          created_at: '2025-01-01',
        }),
      ],
    });
    expect(debitOpen.openingBalance).toBe(10000);
    expect(debitOpen.closingBalance).toBe(109500);

    const creditOpen = buildPeriod({
      period: { from: '2026-09-01', to: '2026-09-30' },
      labs: [
        labWith({
          id: 'lab-1',
          opening_balance: 10000,
          opening_balance_type: 'credit',
          created_at: '2025-01-01',
        }),
      ],
    });
    expect(creditOpen.openingBalance).toBe(-10000);
    // A credit opening is credit, but it is not an advance deposit.
    expect(creditOpen.advanceDeposit).toBe(0);
    expect(creditOpen.closingBalance).toBe(89500);
  });
});

describe('invoice account position — a single invoice uses the same rules', () => {
  const mirInvoice = (over: Partial<Invoice> = {}): Invoice =>
    invoiceWith({
      id: 'mir-single',
      invoice_number: 'INV-0101',
      final_amount: 172500,
      amount_paid: 23000,
      payment_status: 'partial',
      created_at: '2026-09-05',
      issue_date: '2026-09-05',
      payments: [
        paymentWith({
          id: 'mir-single-pay',
          invoice_id: 'mir-single',
          amount: 23000,
          payment_date: '2026-09-20',
        }),
      ],
      ...over,
    });

  it('prints a same-day deposit as a receipt, so the invoice opens at nil', () => {
    const invoice = mirInvoice();
    const position = buildInvoiceAccountPosition({
      invoice,
      invoices: [invoice],
      advancePayments: [mirAdvanceForSingle({ payment_date: '2026-09-05', created_at: '2026-09-05 09:00' })],
      accountAdjustments: [],
      labs: [labWith({ id: 'lab-1', name: 'Mir Dental' })],
    });

    expect(position.openingBalance).toBe(0);
    expect(position.advanceDeposit).toBe(0);
    expect(position.advanceReceived).toBe(50000);
    expect(position.cashPaid).toBe(23000);
    expect(position.closingBalance).toBe(99500);
    expect(position.unallocatedAdvance).toBe(50000);
  });

  it('shows a pre-invoice deposit as opening credit, labelled as included', () => {
    const invoice = mirInvoice();
    const position = buildInvoiceAccountPosition({
      invoice,
      invoices: [invoice],
      advancePayments: [mirAdvanceForSingle({ payment_date: '2026-08-20', created_at: '2026-08-20 09:00' })],
      accountAdjustments: [],
      labs: [labWith({ id: 'lab-1', name: 'Mir Dental' })],
    });

    expect(position.openingBalance).toBe(-50000);
    expect(position.advanceDeposit).toBe(50000);
    expect(position.advanceReceived).toBe(0);
    expect(position.closingBalance).toBe(99500);
    expect(position.unallocatedAdvance).toBe(50000);
  });
});

/** A Mir-style deposit for the single-invoice cases above. */
const mirAdvanceForSingle = (over: Partial<AdvancePayment> = {}): AdvancePayment =>
  advanceWith({
    id: 'mir-single-adv',
    amount: 50000,
    allocated_amount: 0,
    remaining_amount: 50000,
    ...over,
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
