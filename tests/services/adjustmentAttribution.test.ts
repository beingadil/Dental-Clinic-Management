/**
 * Adjustment attribution.
 *
 * The invoice module lists money documents on the invoice row they belong to.
 * Payments carry an invoice id; clinic-level adjustments do not. A credit note
 * recorded today does NOT settle an invoice — it is a ledger row on the clinic
 * account — so it lands on a row only as a `clinicLevel` display home, the
 * same as a surcharge or a refund. Notes recorded by 2.30–2.31 were applied
 * FIFO, and replaying those against the clinic's invoice credits still has to
 * land them on exactly the rows they paid down.
 */
import { describe, it, expect } from 'vitest';
import type { AccountAdjustment, Invoice } from '../../src/types';
import {
  attributeAdjustmentsToInvoices,
  attributedCreditTotal,
} from '../../src/services/adjustmentAttribution';

const invoice = (over: Partial<Invoice>): Invoice =>
  ({
    id: 'inv-1',
    invoice_number: 'INV-0001',
    lab_id: 'lab-1',
    lab_name: 'Ahmad Dental',
    final_amount: 50000,
    amount_paid: 0,
    credit_notes_total: 0,
    created_at: '2026-01-01 09:00',
    due_date: '2026-02-01',
    payments: [],
    ...over,
  }) as unknown as Invoice;

const adjustment = (over: Partial<AccountAdjustment>): AccountAdjustment =>
  ({
    id: 'adj-1',
    adjustment_number: 'CR-0001',
    lab_id: 'lab-1',
    lab_name: 'Ahmad Dental',
    type: 'credit_note',
    amount: 10000,
    reason: 'Discount',
    date: '2026-03-01',
    recorded_by: 'Manager',
    created_at: '2026-03-01 10:00',
    ...over,
  }) as AccountAdjustment;

const INV_A = (credits = 0) =>
  invoice({
    id: 'inv-a',
    invoice_number: 'INV-0001',
    created_at: '2026-01-01 09:00',
    credit_notes_total: credits,
  });
const INV_B = (credits = 0) =>
  invoice({
    id: 'inv-b',
    invoice_number: 'INV-0002',
    created_at: '2026-02-01 09:00',
    final_amount: 30000,
    credit_notes_total: credits,
  });

describe('attributeAdjustmentsToInvoices', () => {
  it('replays clinic credit notes FIFO across the oldest open invoices', () => {
    const map = attributeAdjustmentsToInvoices(
      [INV_B(10000), INV_A(50000)], // input order must not matter
      [adjustment({ amount: 60000 })],
    );

    expect(map.get('inv-a')).toEqual([
      expect.objectContaining({ amount: 50000, clinicLevel: false }),
    ]);
    expect(map.get('inv-b')).toEqual([
      expect.objectContaining({ amount: 10000, clinicLevel: false }),
    ]);
    expect(map.get('inv-a')![0].adjustment.adjustment_number).toBe('CR-0001');
  });

  it('stacks repeated notes on the remaining capacity, oldest first', () => {
    const map = attributeAdjustmentsToInvoices(
      [INV_A(50000), INV_B(20000)],
      [
        adjustment({ id: 'adj-1', adjustment_number: 'CR-0001', amount: 40000, date: '2026-03-01' }),
        adjustment({ id: 'adj-2', adjustment_number: 'CR-0002', amount: 30000, date: '2026-03-02' }),
      ],
    );

    expect(map.get('inv-a')!.map((e) => e.amount)).toEqual([40000, 10000]);
    expect(map.get('inv-b')!.map((e) => e.amount)).toEqual([20000]);
    expect(map.get('inv-b')!.every((e) => e.clinicLevel === false)).toBe(true);
  });

  it('honours an invoice-linked note on that invoice first', () => {
    const map = attributeAdjustmentsToInvoices(
      [INV_A(), INV_B(5000)],
      [adjustment({ amount: 5000, invoice_id: 'inv-b', invoice_number: 'INV-0002' })],
    );

    expect(map.get('inv-b')).toEqual([
      expect.objectContaining({ amount: 5000, clinicLevel: false }),
    ]);
    expect(map.has('inv-a')).toBe(false);
  });

  it('parks clinic-level surcharges and refunds on the oldest invoice', () => {
    const map = attributeAdjustmentsToInvoices(
      [INV_A(), INV_B()],
      [
        adjustment({ id: 'adj-dr', adjustment_number: 'DR-0001', type: 'debit_adjustment', amount: 2500 }),
        adjustment({ id: 'adj-ref', adjustment_number: 'REF-0001', type: 'refund', amount: 1500 }),
      ],
    );

    expect(map.get('inv-a')).toEqual([
      expect.objectContaining({ amount: 2500, clinicLevel: true }),
      expect.objectContaining({ amount: 1500, clinicLevel: true }),
    ]);
    expect(map.has('inv-b')).toBe(false);
  });

  it('keeps an overflowing credit visible without pretending it was applied', () => {
    const map = attributeAdjustmentsToInvoices(
      [INV_A(50000)],
      [adjustment({ amount: 70000 })],
    );

    expect(map.get('inv-a')).toEqual([
      expect.objectContaining({ amount: 50000, clinicLevel: false }),
      expect.objectContaining({ amount: 20000, clinicLevel: true }),
    ]);
  });

  it('does not park credit on a voided invoice', () => {
    const voided = invoice({
      id: 'inv-v',
      invoice_number: 'INV-0000',
      created_at: '2025-12-01 09:00',
      status_v2: 'voided',
    });
    const map = attributeAdjustmentsToInvoices(
      [voided, INV_B(10000)],
      [adjustment({ amount: 10000 })],
    );

    expect(map.has('inv-v')).toBe(false);
    expect(map.get('inv-b')).toEqual([
      expect.objectContaining({ amount: 10000, clinicLevel: false }),
    ]);
  });

  it('does not leak another clinic’s adjustments onto this clinic’s rows', () => {
    const map = attributeAdjustmentsToInvoices(
      [INV_A()],
      [adjustment({ lab_id: 'lab-2', amount: 1000 })],
    );
    expect(map.size).toBe(0);
  });

  it('parks an unapplied credit note as a clinic-level document, not a settlement', () => {
    // Record Adjustment posts to the ledger only: the invoices carry no
    // credits, so the note must not claim any of their capacity.
    const map = attributeAdjustmentsToInvoices(
      [INV_A(), INV_B()],
      [adjustment({ amount: 10000 })],
    );

    expect(map.get('inv-b')).toEqual([
      expect.objectContaining({ amount: 10000, clinicLevel: true }),
    ]);
    expect(map.has('inv-a')).toBe(false);
  });

  it('leaves invoices without adjustments out of the map', () => {
    const map = attributeAdjustmentsToInvoices([INV_A(), INV_B()], []);
    expect(map.size).toBe(0);
  });
});

describe('attributedCreditTotal', () => {
  it('is zero for a note the current build never applied', () => {
    expect(
      attributedCreditTotal('adj-1', [INV_A(), INV_B()], [adjustment({ amount: 10000 })]),
    ).toBe(0);
  });

  it('counts only the portion of a legacy note that sits in invoice credits', () => {
    // 2.30–2.31 applied notes FIFO; only 40,000 of this 50,000 note landed.
    const legacy = adjustment({ amount: 50000 });
    expect(attributedCreditTotal(legacy.id, [INV_A(40000)], [legacy])).toBe(40000);
  });

  it('stops at the clinic’s own invoices', () => {
    const legacy = adjustment({ amount: 10000 });
    const otherClinic = invoice({ id: 'inv-x', lab_id: 'lab-2', credit_notes_total: 10000 });
    expect(attributedCreditTotal(legacy.id, [otherClinic], [legacy])).toBe(0);
  });

  it('is zero for surcharges and refunds, which never touch invoices', () => {
    const dr = adjustment({ id: 'adj-dr', type: 'debit_adjustment', amount: 2500 });
    const refund = adjustment({ id: 'adj-ref', type: 'refund', amount: 1500 });
    expect(attributedCreditTotal('adj-dr', [INV_A(2500)], [dr, refund])).toBe(0);
    expect(attributedCreditTotal('adj-ref', [INV_A(2500)], [dr, refund])).toBe(0);
  });

  it('is zero for an id that is not on file', () => {
    expect(attributedCreditTotal('missing', [INV_A(1000)], [])).toBe(0);
  });
});
