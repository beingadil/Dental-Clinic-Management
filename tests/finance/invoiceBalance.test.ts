/**
 * Invoice balance — the one definition of "what the clinic still owes".
 *
 * WHY THIS TEST EXISTS
 * The balance used to be written out at seventeen call sites in TWO
 * incompatible forms:
 *
 *     final_amount - amount_paid                        (16 sites)
 *     final_amount - amount_paid - credit_notes_total   (17 sites)
 *
 * Both were live. The second is the correct one — it is what the payment engine
 * charges against — so after a credit note was issued the invoice register, the
 * dashboard's Outstanding KPI, the CSV export and every printed statement all
 * overstated what was owed, and "Bulk mark paid" posted a different amount from
 * the row it was clicked on.
 *
 * A helper with no test is exactly how the two forms drifted apart in the first
 * place: nothing would have failed if someone reintroduced the short form at a
 * single new call site. So the invariant is pinned here.
 */
import { describe, expect, it } from 'vitest';
import { invoiceBalanceDue } from '../../src/services/financeDomain';
import { applyCreditNoteToInvoice, reverseCreditNoteOnInvoice } from '../../src/services/transactionDomain';
import type { Invoice } from '../../src/types';

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: 'inv-1',
    final_amount: 10000,
    amount_paid: 4000,
    credit_notes_total: 0,
    due_date: '2026-01-01',
    payment_status: 'partial',
    status_v2: 'partial',
    ...over,
  }) as Invoice;

describe('invoiceBalanceDue', () => {
  it('nets payments and credit notes together', () => {
    // 10,000 billed − 4,000 paid − 1,000 credited = 5,000 owed.
    // The short form returns 6,000, which is the number this test exists for.
    expect(invoiceBalanceDue(invoice({ credit_notes_total: 1000 }))).toBe(5000);
  });

  it('subtracts the credit note whether or not anything has been paid', () => {
    expect(invoiceBalanceDue(invoice({ amount_paid: 0, credit_notes_total: 2500 }))).toBe(7500);
  });

  it('treats missing optional fields as zero rather than NaN', () => {
    // Pre-credit-note invoices have `credit_notes_total` undefined, not 0.
    expect(invoiceBalanceDue({ final_amount: 5000, amount_paid: 500 })).toBe(4500);
    expect(invoiceBalanceDue({ final_amount: 5000 })).toBe(5000);
  });

  it('clamps at zero — an over-credited invoice owes nothing, not a negative', () => {
    expect(invoiceBalanceDue(invoice({ credit_notes_total: 9000 }))).toBe(0);
  });
});

describe('credit notes cannot exceed the invoice', () => {
  it('records a credit note that lands within the balance', () => {
    const next = applyCreditNoteToInvoice(invoice({ credit_notes_total: 0 }), 2000);
    expect(next.credit_notes_total).toBe(2000);
    expect(invoiceBalanceDue(next)).toBe(4000);
  });

  it('allows a credit larger than the outstanding balance but not the invoice total', () => {
    // 9,000 credit against a 10,000 invoice with 4,000 already paid is
    // legitimate: the clinic owes 6,000 and is owed 9,000 back, so the balance
    // is 0 and the invoice settles. The clamp is on the INVOICE TOTAL, not on
    // the outstanding balance — clamping to the latter would silently discard
    // 3,000 of a real refund.
    const next = applyCreditNoteToInvoice(invoice({ credit_notes_total: 0 }), 9000);
    expect(next.credit_notes_total).toBe(9000);
    expect(invoiceBalanceDue(next)).toBe(0);
  });

  it('clamps a credit beyond the invoice total instead of going negative', () => {
    // Without the clamp: credit 12,000 against a 10,000 invoice leaves
    // `final - credit = -2,000`, and the `amount_paid >= final - credit` test
    // is true, so the invoice force-marks itself `paid`. Every open-invoice
    // list filters on `due > 0`, so the invoice silently disappears from the
    // cashier's own queue with no error anywhere.
    const next = applyCreditNoteToInvoice(invoice({ credit_notes_total: 0 }), 12000);
    expect(next.credit_notes_total).toBe(10000);
    expect(invoiceBalanceDue(next)).toBe(0);
  });

  it('restores the balance when a credit note is reversed', () => {
    const credited = applyCreditNoteToInvoice(invoice(), 2000);
    const reversed = reverseCreditNoteOnInvoice(credited, 2000);
    expect(reversed.credit_notes_total).toBe(0);
    expect(invoiceBalanceDue(reversed)).toBe(6000);
  });

  it('never lets a reversal drive the credit total below zero', () => {
    const reversed = reverseCreditNoteOnInvoice(invoice({ credit_notes_total: 500 }), 2000);
    expect(reversed.credit_notes_total).toBe(0);
  });
});