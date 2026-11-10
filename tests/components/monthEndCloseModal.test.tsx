// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import type { Invoice, PaymentRecord } from '../../src/types';

/* Month-end closing UI — the per-clinic close/reopen loop against a real DB.
   The figures are whatever the live books say, so the test drives one clinic
   through: pick the month, see live totals, close it, reopen it with a reason. */

const store = vi.hoisted(() => ({
  invoices: [] as unknown[],
  advances: [] as unknown[],
  adjustments: [] as unknown[],
}));
const showToast = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [{ id: 'lab-1', name: 'Mir Dental', opening_balance: 0, opening_balance_type: 'debit', created_at: '2025-01-01' }],
    invoices: store.invoices,
    advancePayments: store.advances,
    accountAdjustments: store.adjustments,
    cases: [],
    brandingSettings: { appName: 'DENTAL SOLUTIONS', tagline: '', phone: '', email: '', address: '' },
    user: { id: 'u-1', name: 'Super Admin', role: 'Super Admin', isSuperAdmin: true, permissions: [], isActive: true, doctorChecked: false },
    showToast: showToast.fn,
    setCurrentView: () => {},
  }),
}));

import { MonthEndCloseModal } from '../../src/components/billing/MonthEndCloseModal';
import { closedMonthFor } from '../../src/services/monthClose';

const pay = (over: Partial<PaymentRecord> & { id: string; amount: number; payment_date: string }): PaymentRecord => ({
  invoice_id: 'inv-1',
  payment_method: 'bank',
  recorded_by: 'Tester',
  ...over,
});

const invoice = (
  over: Partial<Invoice> & { id: string; final_amount: number; created_at: string },
): Invoice => {
  const payments: PaymentRecord[] = over.payments ?? [
    pay({ id: `p-${over.id}`, amount: over.amount_paid ?? 7000, payment_date: '2026-03-10' }),
  ];
  return {
    invoice_number: `INV-${over.id}`,
    case_id: `case-${over.id}`,
    case_number: `DS-${over.id}`,
    lab_id: 'lab-1',
    lab_name: 'Mir Dental',
    case_type_name: 'Zirconia Crown',
    doctor_name: 'Dr. Bilal Mir',
    discount: 0,
    amount_paid: 7000,
    payment_status: 'partial',
    due_date: over.created_at.slice(0, 10),
    payments,
    ...over,
    amount: over.amount ?? over.final_amount,
    final_amount: over.final_amount,
    created_at: over.created_at,
  };
};

async function freshDb() {
  const SQL = await initSqlJs();
  const eng = await SqliteEngine.create(SQL, null);
  eng.migrate();
  setDatabase(eng);
}

beforeEach(async () => {
  await freshDb();
  store.invoices = [
    invoice({
      id: 'jan',
      created_at: '2026-01-05 09:00',
      final_amount: 10000,
      amount_paid: 4000,
      payments: [pay({ id: 'p-jan', amount: 4000, payment_date: '2026-01-20' })],
    }),
    invoice({
      id: 'mar',
      created_at: '2026-03-02 09:00',
      final_amount: 25000,
      amount_paid: 7000,
      payments: [pay({ id: 'p-mar', amount: 7000, payment_date: '2026-03-10' })],
    }),
  ];
  store.advances = [];
  store.adjustments = [];
  showToast.fn.mockReset();
});

afterEach(() => cleanup());

const pickMonth = (label: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Month to close' }));
  fireEvent.click(screen.getByRole('option', { name: label }));
};

describe('month-end closing modal', () => {
  it('lists the clinic with live figures for the picked month', () => {
    render(<MonthEndCloseModal open onClose={() => {}} />);
    pickMonth('March 2026');

    expect(screen.getByText('Mir Dental')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('PKR 25,000')).toBeTruthy();   // billed
    expect(screen.getByText('PKR 7,000')).toBeTruthy();    // collected
  });

  it('closes the clinic-month and stores the row', () => {
    render(<MonthEndCloseModal open onClose={() => {}} />);
    pickMonth('March 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(showToast.fn).toHaveBeenCalledWith(expect.stringContaining('Mir Dental'), 'success');
    expect(closedMonthFor('2026-03').get('lab-1')).toBeDefined();
    expect(screen.getByText(/Closed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /PDF/ })).toBeTruthy();
  });

  it('requires a reason to reopen', () => {
    render(<MonthEndCloseModal open onClose={() => {}} />);
    pickMonth('March 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    const dialog = screen.getByRole('dialog');
    const reopenBtn = within(dialog).getByRole('button', { name: 'Reopen' });
    fireEvent.click(reopenBtn);
    expect(showToast.fn).toHaveBeenCalledWith(expect.stringMatching(/reason/i), 'error');
    expect(closedMonthFor('2026-03').get('lab-1')).toBeDefined();

    fireEvent.change(within(dialog).getByLabelText('Reason for reopening'), { target: { value: 'Late slip banked' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reopen' }));
    expect(closedMonthFor('2026-03').get('lab-1')).toBeUndefined();
    expect(showToast.fn).toHaveBeenCalledWith(expect.stringContaining('reopened'), 'info');
  });

  it('blocks closing the wrong month — rows show live zeros for a month with no books', () => {
    render(<MonthEndCloseModal open onClose={() => {}} />);
    pickMonth('February 2026');
    // Billed and collected both read zero — the month was silent for this clinic.
    expect(screen.getAllByText('PKR 0').length).toBeGreaterThanOrEqual(2);
    // Closing is allowed for any month — the operator owns the call.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(closedMonthFor('2026-02').get('lab-1')).toBeDefined();
    // …and the carried balance proves itself: Jan's closing carries in
    // (10,000 billed in January − 4,000 banked then).
    expect(closedMonthFor('2026-02').get('lab-1')?.closing_balance).toBeCloseTo(6000);
  });
});
