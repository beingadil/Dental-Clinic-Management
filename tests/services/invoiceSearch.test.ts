/**
 * The invoice search.
 *
 * The list used to match invoice #, case #, clinic, doctor and procedure. Every
 * assertion below is a value an operator has in front of them when they reach
 * for the search box — a patient's name read off the slip in their hand, a
 * receipt number off a bank statement, a figure they remember from the invoice.
 * The point of the change is that none of these require knowing which column
 * the value lives in, so the tests are written as questions an operator asks.
 */
import { describe, it, expect } from 'vitest';
import type { Invoice, PaymentRecord } from '../../src/types';
import { invoiceMatchesSearch } from '../../src/services/invoiceSearch';

const PAYMENT: PaymentRecord = {
  id: 'pay-1',
  payment_number: 'PAY-2026-0007',
  receipt_number: 'REC-2026-0007',
  invoice_id: 'inv-1',
  invoice_number: 'INV-0042',
  amount: 25000,
  payment_method: 'bank',
  payment_date: '2026-10-05',
  reference_number: 'TR-998234',
  recorded_by: 'Cashier',
};

const INVOICE: Invoice = {
  id: 'inv-1',
  invoice_number: 'INV-0042',
  case_id: 'case-1',
  case_number: 'DS-2001',
  lab_id: 'lab-1',
  lab_name: 'Ahmad Dental',
  case_type_name: 'Zirconia Crown',
  doctor_name: 'Ahmad',
  patient_name: 'Ali Raza',
  amount: 75000,
  discount: 0,
  final_amount: 75000,
  amount_paid: 25000,
  payment_status: 'partial',
  status_v2: 'partially_paid',
  issue_date: '2026-10-01',
  due_date: '2026-11-05',
  created_at: '2026-10-01 09:00',
  payments: [PAYMENT],
};

const finds = (query: string) => invoiceMatchesSearch(INVOICE, query);

describe('invoice search answers what the operator has in hand', () => {
  it('finds the invoice by patient name', () => {
    expect(finds('Ali Raza')).toBe(true);
    expect(finds('ali')).toBe(true);
    expect(finds('raza')).toBe(true);
  });

  it('finds it by invoice number and by case number', () => {
    expect(finds('INV-0042')).toBe(true);
    expect(finds('inv-0042')).toBe(true);
    expect(finds('DS-2001')).toBe(true);
  });

  it('finds it by doctor, however the name was written', () => {
    // Stored bare; the operator types the honorific — and vice versa.
    expect(finds('Ahmad')).toBe(true);
    expect(finds('Dr Ahmad')).toBe(true);
    expect(finds('Dr. Ahmad')).toBe(true);
  });

  it('finds it by clinic and by procedure', () => {
    expect(finds('Ahmad Dental')).toBe(true);
    expect(finds('zirconia')).toBe(true);
  });

  it('finds it by the receipt reference on the bank statement', () => {
    expect(finds('TR-998234')).toBe(true);
    expect(finds('PAY-2026-0007')).toBe(true);
  });

  it('finds it by the money, bare or as printed', () => {
    expect(finds('75000')).toBe(true);
    expect(finds('75,000')).toBe(true);
    expect(finds('25000')).toBe(true);
  });

  it('finds it by date and by status', () => {
    expect(finds('2026-11-05')).toBe(true);
    expect(finds('partial')).toBe(true);
  });

  it('ignores surrounding whitespace and letter case', () => {
    expect(finds('   ALI RAZA  ')).toBe(true);
  });

  it('matches everything on an empty query, and nothing on a real miss', () => {
    expect(finds('')).toBe(true);
    expect(finds('   ')).toBe(true);
    expect(finds('Bilal Khan')).toBe(false);
    expect(finds('INV-9999')).toBe(false);
  });
});
