import { describe, it, expect } from 'vitest';
import { prepareTransaction, prepareAdvanceDeposit, buildCreditNoteAdjustment } from '../../src/services/transactionDomain';
import { nextPaymentNumber, maxDocumentSeq } from '../../src/services/ledgerDomain';
import type { Invoice } from '../../src/types';

/**
 * Regression for the live "UNIQUE constraint failed: payments.payment_number"
 * sync aborts:
 *  - a receipt split across several invoices stored every slice with ONE
 *    payment number (deterministic duplicate);
 *  - sequences were derived from row COUNTS, so deleting a payment made the
 *    generator re-issue a number that still existed.
 * Every stored payment/advance/receipt number must be unique no matter how
 * many rows were deleted or how the existing numbers are formatted.
 */

const YEAR = new Date().getFullYear();

const invWith = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: over.id || 'inv-1',
    invoice_number: 'INV-0001',
    lab_id: 'lab-1',
    lab_name: 'Clinic One',
    amount: 1000,
    discount: 0,
    final_amount: 1000,
    amount_paid: 0,
    payment_status: 'unpaid',
    status_v2: 'open',
    payments: [],
    created_at: '2026-09-01',
    ...over,
  }) as Invoice;

const cmdWith = (allocations: { invoiceId: string; amount: number }[], over: { amount?: number; saveRemainingAsAdvance?: boolean } = {}) => ({
  clinicId: 'lab-1',
  amount: allocations.reduce((sum, a) => sum + a.amount, 0),
  method: 'cash' as const,
  date: '2026-10-01',
  allocations,
  ...over,
});

const prepare = (
  allocations: { invoiceId: string; amount: number }[],
  numbering: Partial<{
    existingPaymentNumbers: string[];
    existingAdvanceNumbers: string[];
    existingReceiptNumbers: string[];
  }> = {},
  over: { amount?: number; saveRemainingAsAdvance?: boolean } = {},
) =>
  prepareTransaction({
    command: cmdWith(allocations, over),
    invoices: [invWith(), invWith({ id: 'inv-2', invoice_number: 'INV-0002' })],
    existingPaymentNumbers: numbering.existingPaymentNumbers || [],
    existingAdvanceNumbers: numbering.existingAdvanceNumbers || [],
    existingReceiptNumbers: numbering.existingReceiptNumbers || [],
    labName: 'Clinic One',
    actor: 'Cashier',
    paymentId: 'pay-1',
  });

describe('payment numbering is duplicate-proof', () => {
  it('gives every invoice slice its own number when one receipt is split across invoices', () => {
    const prepared = prepare([
      { invoiceId: 'inv-1', amount: 200 },
      { invoiceId: 'inv-2', amount: 100 },
    ]);

    const numbers = prepared.invoiceSlices.map((s) => s.payment.payment_number);
    expect(numbers).toEqual([`PAY-${YEAR}-0001-1`, `PAY-${YEAR}-0001-2`]);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(prepared.paymentNumber).toBe(`PAY-${YEAR}-0001`);
  });

  it('keeps the canonical number on a single-invoice slice', () => {
    const prepared = prepare([{ invoiceId: 'inv-1', amount: 300 }]);
    expect(prepared.invoiceSlices).toHaveLength(1);
    expect(prepared.invoiceSlices[0].payment.payment_number).toBe(`PAY-${YEAR}-0001`);
  });

  it('continues after the highest existing number when rows were deleted', () => {
    // Count-based numbering saw 3 rows and re-issued PAY-2026-0004 — already gone —
    // or worse, a number that still existed on another invoice.
    const prepared = prepare([{ invoiceId: 'inv-1', amount: 100 }], {
      existingPaymentNumbers: ['PAY-2026-0003', 'PAY-2026-0005', 'PAY-0002'],
    });
    expect(prepared.paymentNumber).toBe('PAY-2026-0006');
  });

  it('reads legacy (PAY-0002) and year-formatted (PAY-2026-0005) numbers on one scale', () => {
    const prepared = prepare([{ invoiceId: 'inv-1', amount: 100 }], {
      existingPaymentNumbers: ['PAY-2026-0009', 'PAY-0003'],
    });
    expect(prepared.paymentNumber).toBe(`PAY-${YEAR}-0010`);
  });

  it('keeps receipts on their own monotonic sequence', () => {
    const prepared = prepare([{ invoiceId: 'inv-1', amount: 100 }], {
      existingReceiptNumbers: ['REC-2026-0007', 'REC-0002'],
    });
    expect(prepared.receiptNumber).toBe('REC-2026-0008');
  });
});

describe('advance numbering is duplicate-proof', () => {
  it('continues past the highest advance number for a deposit', () => {
    const prepared = prepareAdvanceDeposit({
      command: { clinicId: 'lab-1', amount: 500, method: 'cash', date: '2026-10-01' },
      existingAdvanceNumbers: ['ADV-2026-0004', 'ADV-0002'],
      existingReceiptNumbers: [],
      labName: 'Clinic One',
      actor: 'Cashier',
      advanceId: 'adv-1',
    });
    expect(prepared.advance.payment_number).toBe('ADV-2026-0005');
  });

  it('never lets the unapplied remainder reuse an existing advance number', () => {
    const prepared = prepare([{ invoiceId: 'inv-1', amount: 300 }], {
      existingPaymentNumbers: ['PAY-2026-0009'],
      existingAdvanceNumbers: ['ADV-2026-0002'],
      existingReceiptNumbers: ['REC-2026-0001'],
    }, { amount: 500, saveRemainingAsAdvance: true });

    expect(prepared.remainderAdvance?.payment_number).toBe('ADV-2026-0003');
    expect(prepared.remainderAdvance?.receipt_number).toBe(prepared.receiptNumber);
  });
});

describe('maxDocumentSeq', () => {
  it('ignores slice copies and empty entries', () => {
    expect(maxDocumentSeq(['PAY-2026-0009', 'PAY-0003', 'PAY-2026-0009-2', ''], 'PAY')).toBe(9);
  });

  it('does not leak between prefixes', () => {
    expect(maxDocumentSeq(['ADV-2026-0012', 'PAY-2026-0004'], 'PAY')).toBe(4);
  });

  it('feeds the legacy bulk generator the year-formatted sequence, not the year', () => {
    const invs = [invWith({ payments: [{ id: 'p', payment_number: 'PAY-2026-0009', amount: 10, payment_method: 'cash', payment_date: '2026-09-01', created_at: '2026-09-01' } as any] })];
    expect(nextPaymentNumber(invs)).toBe('PAY-0010');
  });

  it('treats a bulk slice (PAY-0012-1) as base sequence 12, not 1', () => {
    expect(maxDocumentSeq(['PAY-0012-1', 'PAY-0012-2'], 'PAY')).toBe(12);
    const invs = [invWith({ payments: [{ id: 'p', payment_number: 'PAY-0012-1', amount: 10, payment_method: 'cash', payment_date: '2026-09-01', created_at: '2026-09-01' } as any] })];
    expect(nextPaymentNumber(invs)).toBe('PAY-0013');
  });

  it('counts a split receipt base so the next payment cannot re-mint its slices', () => {
    const prepared = prepare([{ invoiceId: 'inv-1', amount: 100 }], {
      existingPaymentNumbers: [`PAY-${YEAR}-0001-1`, `PAY-${YEAR}-0001-2`],
    });
    expect(prepared.paymentNumber).toBe(`PAY-${YEAR}-0002`);
  });
});

describe('credit-note numbering is duplicate-proof', () => {
  it('continues past the highest existing CR- number', () => {
    const prepared = buildCreditNoteAdjustment({
      command: { clinicId: 'lab-1', invoiceId: 'inv-1', amount: 50, reasonCode: 'remake', reasonText: 'Remake' },
      invoice: invWith(),
      existingAdjustmentNumbers: ['CR-2026-0003', 'CR-0002'],
      labName: 'Clinic One',
      actor: 'Manager',
      adjustmentId: 'adj-1',
    });
    expect(prepared.adjustment.adjustment_number).toBe(`CR-${YEAR}-0004`);
  });
});

