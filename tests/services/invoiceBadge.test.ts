import { describe, it, expect } from 'vitest';
import { invoiceBadge } from '../../src/services/invoiceBadge';
import type { Invoice } from '../../src/types';

/**
 * The Invoices table tells the operator what to do next, so the badge is a
 * decision, not decoration. Two things it must never get wrong:
 *
 *   - It must read the MONEY. `payment_status` is a denormalised copy that goes
 *     stale the moment a credit note or a hand-edited payment moves the balance,
 *     so keying off it can show "Pending" on an invoice that is fully settled.
 *
 *   - It must not make everything urgent. Only Overdue carries the danger tone;
 *     an unpaid invoice inside its terms is ordinary business, and drowning it
 *     in red is the same as not marking anything.
 */

const TODAY = new Date('2026-10-10T12:00:00');

const inv = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: 'i1',
    invoice_number: 'INV-0001',
    case_id: 'c1',
    case_number: 'DS-0001',
    lab_id: 'lab-1',
    lab_name: 'Al-Noor',
    amount: 10000,
    discount: 0,
    final_amount: 10000,
    amount_paid: 0,
    payment_status: 'unpaid',
    status_v2: 'open',
    issue_date: '2026-10-01',
    due_date: '2026-10-20',
    created_at: '2026-10-01 09:00',
    updated_at: '2026-10-01 09:00',
    payments: [],
    ...over,
  }) as Invoice;

describe('invoiceBadge — settlement is read from the money', () => {
  it('calls a fully settled invoice Paid even when the stored status says otherwise', () => {
    const badge = invoiceBadge(
      inv({ amount_paid: 10000, payment_status: 'unpaid' }),
      TODAY,
    );
    expect(badge.tone).toBe('paid');
    expect(badge.label).toBe('Paid');
    expect(badge.needsAttention).toBe(false);
  });

  it('calls an unpaid invoice Unpaid/Pending even when the stored status claims paid', () => {
    const badge = invoiceBadge(inv({ payment_status: 'paid' }), TODAY);
    expect(badge.label).toBe('Pending');
    expect(badge.needsAttention).toBe(false);
  });

  it('calls a part-paid invoice Partial and shows how much landed', () => {
    const badge = invoiceBadge(
      inv({ amount_paid: 4000, payment_status: 'unpaid' }),
      TODAY,
    );
    expect(badge.tone).toBe('partial');
    expect(badge.label).toBe('Partial');
    expect(badge.detail).toMatch(/4,000/);
  });

  it('settles an overpaid invoice, since there is nothing left to chase', () => {
    // A credit note or advance can push amount_paid past the balance.
    const badge = invoiceBadge(inv({ amount_paid: 12000 }), TODAY);
    expect(badge.tone).toBe('paid');
  });

  it('lets money beat a due date that has since passed', () => {
    // Paid, but the due date is behind us. The operator has nothing to chase.
    const badge = invoiceBadge(
      inv({ amount_paid: 10000, due_date: '2026-09-01' }),
      TODAY,
    );
    expect(badge.tone).toBe('paid');
    expect(badge.needsAttention).toBe(false);
  });
});

describe('invoiceBadge — only a late balance demands action', () => {
  it('marks a past-due unpaid invoice Overdue and counts the days', () => {
    const badge = invoiceBadge(inv({ due_date: '2026-10-05' }), TODAY);
    expect(badge.tone).toBe('overdue');
    expect(badge.detail).toBe('5 days overdue');
    expect(badge.needsAttention).toBe(true);
  });

  it('says "1 day overdue" rather than "1 days"', () => {
    const badge = invoiceBadge(inv({ due_date: '2026-10-09' }), TODAY);
    expect(badge.detail).toBe('1 day overdue');
  });

  it('chases the REMAINDER when a part-paid invoice goes past its date', () => {
    const badge = invoiceBadge(
      inv({ amount_paid: 4000, due_date: '2026-10-05' }),
      TODAY,
    );
    expect(badge.tone).toBe('overdue');
    expect(badge.needsAttention).toBe(true);
  });

  it('never calls a within-terms invoice Overdue, whatever the stored status', () => {
    // The specific regression: painting every unpaid row rose buried the
    // handful the operator actually had to chase.
    for (const status of ['unpaid', 'partial', 'paid'] as const) {
      const badge = invoiceBadge(
        inv({ due_date: '2026-10-25', payment_status: status }),
        TODAY,
      );
      expect(badge.tone).not.toBe('overdue');
    }
  });

  it('leaves an invoice due today Pending, not Overdue', () => {
    const badge = invoiceBadge(inv({ due_date: '2026-10-10' }), TODAY);
    expect(badge.tone).toBe('pending');
    expect(badge.needsAttention).toBe(false);
  });

  it('says nothing about time remaining while an invoice is still within terms', () => {
    // Payment terms are gone: "Due Today" / "Due in 6d" told the operator
    // nothing they can act on and was the widest string in the column.
    for (const due of ['2026-10-10', '2026-10-11', '2026-10-25']) {
      const badge = invoiceBadge(inv({ due_date: due }), TODAY);
      expect(badge.tone).toBe('pending');
      expect(badge.detail).toBe('');
    }
  });

  it('never phrases an overdue invoice as time remaining either', () => {
    // The only second line left is a PAST-due count — a fact to act on.
    const badge = invoiceBadge(inv({ due_date: '2026-10-05' }), TODAY);
    expect(badge.detail).toBe('5 days overdue');
    expect(badge.detail).not.toMatch(/Due in/);
  });

  it('treats an invoice with no due date as open-ended rather than late', () => {
    const badge = invoiceBadge(inv({ due_date: '' }), TODAY);
    expect(badge.tone).toBe('pending');
    expect(badge.detail).toBe('');
  });
});