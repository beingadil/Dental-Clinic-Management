// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

/**
 * The clinics list carries a financial column, which makes it the most tempting
 * place in the app to hang a "Record Payment" button on a clinic row. It must
 * not have one.
 *
 * Payments are received in Billing and only in Billing. A clinic-level payment
 * has no invoice to settle against, so the only honest thing a clinic row can
 * offer is the amount owed — a read-only fact — and the operator then goes to
 * Billing to apply it. This file pins that boundary so a future "convenience"
 * shortcut does not quietly reintroduce a second entry point with different
 * (and weaker) semantics than the real one.
 */

const { LABS, CASES, INVOICES, PAYMENTS } = vi.hoisted(() => ({
  LABS: [
    { id: 'lab-1', name: 'Al-Noor Clinic', contact_person: 'Dr. Aslam', phone: '0300-1234567', email: 'alnoor@example.com', address: 'F-7 Markaz' },
    { id: 'lab-2', name: 'Bright Smile Dental', contact_person: 'Dr. Khan', phone: '0321-7654321', email: 'bright@example.com', address: 'Bahria Town' },
  ],
  CASES: [
    { id: 'c-1', case_number: 'DS-3002', lab_id: 'lab-1', status: 'in_progress', created_at: '2026-03-04 10:00', delivery_date: '2026-03-20' },
  ],
  /* lab-1 invoiced 10,000 and paid 4,000 → 6,000 outstanding.
     lab-2 invoiced 5,000 and paid it in full → clear. */
  INVOICES: [
    { id: 'i-1', invoice_number: 'INV-0001', lab_id: 'lab-1', created_at: '2026-03-05 09:00', issue_date: '2026-03-05', final_amount: 10000, amount_paid: 4000 },
    { id: 'i-2', invoice_number: 'INV-0002', lab_id: 'lab-2', created_at: '2026-03-06 09:00', issue_date: '2026-03-06', final_amount: 5000, amount_paid: 5000 },
  ],
  PAYMENTS: [
    { id: 'p-1', lab_id: 'lab-1', payment_date: '2026-03-10' },
  ],
}));

/** Outstanding is derived from the invoice set, so the mock is a real sum
    rather than a hardcoded number the test could pass by accident. */
vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: LABS,
    cases: CASES,
    invoices: INVOICES,
    allPayments: PAYMENTS,
    addLab: () => {},
    getLabFinancialSummary: (labId: string) => {
      const outstanding = INVOICES
        .filter((i) => i.lab_id === labId)
        .reduce((sum, i) => sum + Math.max(0, i.final_amount - i.amount_paid), 0);
      return { outstanding_balance: outstanding };
    },
  }),
}));

import { LabListView } from '../../src/components/labs/LabListView';

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('clinic money columns', () => {
  it('shows what each clinic still owes, derived from its invoices', () => {
    render(<LabListView />);
    fireEvent.click(screen.getByText('List'));

    const table = screen.getByRole('table');
    expect(within(table).getByText('Outstanding Balance')).toBeTruthy();

    const owed = within(table).getByText(/6,000/);
    expect(owed).toBeTruthy();
    // The settled clinic reads "Clear", not a zero the operator must interpret.
    expect(within(table).getByText('Clear')).toBeTruthy();
  });

  it('reports the most recent activity per clinic so a dormant account is visible', () => {
    render(<LabListView />);
    fireEvent.click(screen.getByText('List'));

    const table = screen.getByRole('table');
    expect(within(table).getByText('Last Activity')).toBeTruthy();
    // The 2026-03-10 payment is the latest thing that happened to lab-1.
    expect(within(table).getByText('2026-03-10')).toBeTruthy();
  });

  it('keeps the balance read-only — no payment shortcut on the clinic row', () => {
    render(<LabListView />);
    fireEvent.click(screen.getByText('List'));

    // The regression this file exists to catch: a per-clinic "Record Payment"
    // button. Billing is the only place a payment is received.
    expect(screen.queryByTitle('Record Payment')).toBeNull();
    expect(screen.queryByRole('button', { name: /record payment/i })).toBeNull();
  });

  it('offers no payment shortcut on the card grid either', () => {
    render(<LabListView />); // card grid is the default view

    expect(screen.queryByTitle('Record Payment')).toBeNull();
    expect(screen.queryByRole('button', { name: /record payment/i })).toBeNull();
  });
});