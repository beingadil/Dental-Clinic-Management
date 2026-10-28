/**
 * Entry order for invoice lists.
 *
 * Receive Payment shows a clinic's open invoices in the sequence they were
 * recorded — oldest first — and that is also the order the auto-allocation
 * fills. `issue_date` cannot carry that sequence: editing a case's delivery
 * date rewrites the invoice's issue date, so a later booking could jump ahead
 * of an earlier one. The booking day is `created_at`; same-day invoices are
 * ordered by the invoice number, which is minted in booking order.
 */
import { describe, it, expect } from 'vitest';
import type { Invoice } from '../../src/types';
import { compareInvoiceEntryOrder, invoiceEntryDate } from '../../src/services/invoiceOrder';

const invoice = (over: Partial<Invoice>): Invoice =>
  ({
    id: 'inv-1',
    invoice_number: 'INV-0001',
    lab_id: 'lab-1',
    lab_name: 'Ahmad Dental',
    final_amount: 50000,
    amount_paid: 0,
    credit_notes_total: 0,
    created_at: '2026-10-01',
    issue_date: '2026-10-01',
    due_date: '2026-11-01',
    payments: [],
    ...over,
  }) as unknown as Invoice;

describe('compareInvoiceEntryOrder', () => {
  it('orders by the day the invoice was booked, not by its issue date', () => {
    // The later booking was backdated; the earlier booking's issue date was
    // rewritten to a future delivery date by a case edit. Entry order is the
    // booking sequence, so the earlier booking must stay first.
    const bookedFirst = invoice({
      id: 'inv-a',
      invoice_number: 'INV-0002',
      created_at: '2026-10-01',
      issue_date: '2026-11-20',
    });
    const bookedSecond = invoice({
      id: 'inv-b',
      invoice_number: 'INV-0001',
      created_at: '2026-10-05',
      issue_date: '2026-09-01',
    });

    expect([bookedSecond, bookedFirst].sort(compareInvoiceEntryOrder).map((i) => i.id)).toEqual([
      'inv-a',
      'inv-b',
    ]);
  });

  it('orders invoices booked on the same day by invoice number', () => {
    // created_at is date-only, so same-day invoices tie on the day; the number
    // is minted in booking order and breaks the tie.
    const second = invoice({ id: 'inv-b', invoice_number: 'INV-0009', created_at: '2026-10-01' });
    const first = invoice({ id: 'inv-a', invoice_number: 'INV-0002', created_at: '2026-10-01' });

    expect([second, first].sort(compareInvoiceEntryOrder).map((i) => i.id)).toEqual([
      'inv-a',
      'inv-b',
    ]);
  });

  it('compares invoice numbers numerically, not as text', () => {
    const higher = invoice({ id: 'inv-b', invoice_number: 'INV-0100', created_at: '2026-10-01' });
    const lower = invoice({ id: 'inv-a', invoice_number: 'INV-0099', created_at: '2026-10-01' });

    expect([higher, lower].sort(compareInvoiceEntryOrder).map((i) => i.id)).toEqual([
      'inv-a',
      'inv-b',
    ]);
  });

  it('falls back to the issue date for rows booked before created_at existed', () => {
    const legacy = invoice({
      id: 'inv-legacy',
      created_at: '',
      issue_date: '2026-09-01',
      invoice_number: 'INV-0007',
    });
    const current = invoice({ id: 'inv-current', created_at: '2026-10-01' });

    expect([current, legacy].sort(compareInvoiceEntryOrder).map((i) => i.id)).toEqual([
      'inv-legacy',
      'inv-current',
    ]);
  });

  it('leaves the input array untouched', () => {
    const a = invoice({ id: 'inv-a', created_at: '2026-10-02' });
    const b = invoice({ id: 'inv-b', created_at: '2026-10-01' });
    const input = [a, b];

    expect([...input].sort(compareInvoiceEntryOrder).map((i) => i.id)).toEqual(['inv-b', 'inv-a']);
    expect(input.map((i) => i.id)).toEqual(['inv-a', 'inv-b']);
  });
});

describe('invoiceEntryDate', () => {
  it('shows the day the invoice was booked', () => {
    expect(invoiceEntryDate({ created_at: '2026-10-05', issue_date: '2026-11-20' })).toBe(
      '2026-10-05',
    );
  });

  it('shows the issue date when there is no booking stamp', () => {
    expect(invoiceEntryDate({ created_at: '', issue_date: '2026-09-01' })).toBe('2026-09-01');
  });

  it('trims a legacy timestamp to its day', () => {
    expect(invoiceEntryDate({ created_at: '2026-10-05 11:30', issue_date: '' })).toBe('2026-10-05');
  });
});
