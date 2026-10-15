/**
 * The payments register's derivation.
 *
 * Three money documents — a payment, an advance deposit and a credit note — are
 * one feed to the operator, filtered by the SAME query and date range as the
 * invoice table above them. Two stacked filter bands used to disagree the moment
 * either changed, so the assertions here are about agreement: a patient query
 * must be answered by both lists, and a clinic filter must not leave the
 * register listing every other clinic's receipts.
 */
import { describe, it, expect } from 'vitest';
import type { AccountAdjustment, AdvancePayment, Invoice, PaymentRecord } from '../../src/types';
import {
  buildUnifiedTransactions,
  filterUnifiedTransactions,
  transactionCsvRows,
} from '../../src/services/transactionRegister';
import { toCSV } from '../../src/services/csvExport';

const PAYMENT: PaymentRecord = {
  id: 'pay-slice-1',
  payment_number: 'PAY-2026-0007',
  receipt_number: 'REC-2026-0007',
  invoice_id: 'inv-1',
  invoice_number: 'INV-0042',
  lab_id: 'lab-1',
  lab_name: 'Ahmad Dental',
  amount: 25000,
  payment_method: 'bank',
  payment_date: '2026-10-05',
  reference_number: 'TR-998234',
  recorded_by: 'Cashier',
};

const OTHER_PAYMENT: PaymentRecord = {
  ...PAYMENT,
  id: 'pay-slice-2',
  payment_number: 'PAY-2026-0008',
  // Overridden: a reference is unique per receipt, so a shared one would make
  // the reference-query assertion below pass for the wrong reason.
  receipt_number: 'REC-2026-0008',
  reference_number: 'TR-110000',
  invoice_id: 'inv-2',
  invoice_number: 'INV-0043',
  lab_id: 'lab-2',
  lab_name: 'Bilal Dental',
  amount: 9000,
  payment_date: '2026-09-01',
};

const INVOICE = {
  id: 'inv-1',
  invoice_number: 'INV-0042',
  case_number: 'DS-2001',
  patient_name: 'Ali Raza',
  doctor_name: 'Ahmad',
  lab_id: 'lab-1',
  lab_name: 'Ahmad Dental',
  case_type_name: 'Zirconia Crown',
  final_amount: 75000,
  amount_paid: 25000,
  payment_status: 'partial',
  due_date: '2026-11-05',
  payments: [PAYMENT],
} as unknown as Invoice;

const ADVANCE = {
  id: 'adv-1',
  payment_number: 'ADV-2026-0001',
  lab_id: 'lab-1',
  lab_name: 'Ahmad Dental',
  amount: 5000,
  allocated_amount: 0,
  remaining_amount: 5000,
  payment_method: 'cash',
  payment_date: '2026-10-06',
  recorded_by: 'Cashier',
} as unknown as AdvancePayment;

const CREDIT_NOTE = {
  id: 'adj-1',
  adjustment_number: 'CR-2026-0001',
  lab_id: 'lab-1',
  lab_name: 'Ahmad Dental',
  type: 'credit_note',
  amount: 1500,
  reason: 'Chipped on delivery, recalled',
  date: '2026-10-07',
  invoice_id: 'inv-1',
  invoice_number: 'INV-0042',
  recorded_by: 'Manager',
} as unknown as AccountAdjustment;

const build = (over: Partial<Parameters<typeof buildUnifiedTransactions>[0]> = {}) =>
  buildUnifiedTransactions({
    allPayments: [PAYMENT, OTHER_PAYMENT],
    advancePayments: [ADVANCE],
    accountAdjustments: [CREDIT_NOTE],
    invoices: [INVOICE],
    ...over,
  });

const ALL = { search: '', fromDate: '', toDate: '', clinicId: 'all' };

describe('building the register feed', () => {
  it('puts payments, advances and adjustments on one list, newest first', () => {
    const rows = build();

    expect(rows.map((r) => r.txnNumber)).toEqual([
      'CR-2026-0001',
      'ADV-2026-0001',
      'PAY-2026-0007',
      'PAY-2026-0008',
    ]);
  });

  it('carries the invoice identity onto the payment row', () => {
    const row = build().find((r) => r.txnNumber === 'PAY-2026-0007')!;

    expect(row.sourceType).toBe('payment');
    expect(row.invoiceNumber).toBe('INV-0042');
    expect(row.caseNumber).toBe('DS-2001');
    expect(row.detail).toContain('INV-0042');
    expect(row.detail).toContain('DS-2001');
    expect(row.rawPayment?.id).toBe('pay-slice-1');
  });

  it('labels a credit note, a surcharge and a refund distinctly', () => {
    expect(build().find((r) => r.id === 'adj-1')!.category).toBe('Credit Note');

    const surcharge = { ...CREDIT_NOTE, id: 'adj-2', type: 'debit_adjustment' } as AccountAdjustment;
    const refund = { ...CREDIT_NOTE, id: 'adj-3', type: 'refund' } as AccountAdjustment;

    expect(build({ accountAdjustments: [surcharge] })[0].category).toBe('Debit Surcharge');
    expect(build({ accountAdjustments: [surcharge] })[0].direction).toBe('debit');
    expect(build({ accountAdjustments: [refund] })[0].category).toBe('Customer Refund');
    expect(build({ accountAdjustments: [refund] })[0].direction).toBe('refund');
  });
});

describe('the page filters drive the register', () => {
  it('answers a patient query with the payments against their invoice', () => {
    // The whole reason the row carries the invoice's fields: the table above
    // finds Ali Raza's invoice, so the register has to find his payment.
    const rows = filterUnifiedTransactions(build(), { ...ALL, search: 'Ali Raza' });

    expect(rows.map((r) => r.txnNumber)).toEqual(['CR-2026-0001', 'PAY-2026-0007']);
  });

  it('answers a receipt-reference query', () => {
    const rows = filterUnifiedTransactions(build(), { ...ALL, search: 'TR-998234' });
    expect(rows.map((r) => r.txnNumber)).toEqual(['PAY-2026-0007']);
  });

  it('narrows to one clinic', () => {
    const rows = filterUnifiedTransactions(build(), { ...ALL, clinicId: 'lab-2' });
    expect(rows.map((r) => r.txnNumber)).toEqual(['PAY-2026-0008']);
  });

  it('keeps only the entries inside the date range, inclusive of both ends', () => {
    const rows = filterUnifiedTransactions(build(), {
      ...ALL,
      fromDate: '2026-10-06',
      toDate: '2026-10-07',
    });

    expect(rows.map((r) => r.txnNumber)).toEqual(['CR-2026-0001', 'ADV-2026-0001']);
  });

  it('treats a stored timestamp as its calendar day, never a UTC day earlier', () => {
    const stamped = { ...PAYMENT, id: 'pay-stamped', payment_date: '2026-10-05 23:30' } as PaymentRecord;

    const rows = filterUnifiedTransactions(
      build({ allPayments: [stamped], advancePayments: [], accountAdjustments: [] }),
      { ...ALL, fromDate: '2026-10-05', toDate: '2026-10-05' },
    );

    expect(rows).toHaveLength(1);
  });

  it('returns everything unfiltered, and nothing for a query that matches no row', () => {
    expect(filterUnifiedTransactions(build(), ALL)).toHaveLength(4);
    expect(filterUnifiedTransactions(build(), { ...ALL, search: 'nobody at all' })).toHaveLength(0);
  });
});

describe('the register CSV', () => {
  it('leads with the headers, then one row per entry', () => {
    const rows = transactionCsvRows(build().filter((r) => r.sourceType === 'payment'));

    expect(rows[0][0]).toBe('Transaction #');
    expect(rows).toHaveLength(3);
    expect(rows[1][0]).toBe('PAY-2026-0007');
    expect(rows[1][7]).toBe(25000);
  });

  it('is quoted by the shared RFC-4180 writer, not by hand', () => {
    // The text the operator sees must survive a round trip through the CSV:
    // a hand-rolled joiner is what broke rows on commas before.
    const commaReason = { ...CREDIT_NOTE, reason: 'Recalled, chipped on delivery' } as AccountAdjustment;
    const csv = toCSV(transactionCsvRows(build({ accountAdjustments: [commaReason] })));

    expect(csv).toContain('"Recalled, chipped on delivery"');
    expect(csv).toContain('Transaction #,Date,Dental Clinic');
  });
});
