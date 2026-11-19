// @vitest-environment jsdom
/**
 * The Clinic Payments register is read-only money data. Two properties pin
 * it: the permission gate keeps a non-reports role out, and the type filter
 * narrows the rows exactly as its chip promises.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const mockUser = vi.hoisted(() => ({
  current: { id: 'u-1', name: 'Mateen', role: 'Super Admin', isSuperAdmin: true },
}));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [{ id: 'lab-1', name: 'Bajwa Dental' }],
    invoices: [
      {
        id: 'inv-1',
        invoice_number: 'INV-0001',
        case_id: 'case-1',
        case_number: 'DS-1001',
        lab_id: 'lab-1',
        lab_name: 'Bajwa Dental',
        final_amount: 30000,
        amount_paid: 5000,
        payment_status: 'partial',
        patient_name: 'Ali Raza',
        created_at: '2026-10-02 09:00',
        payments: [
          {
            id: 'pay-1',
            invoice_id: 'inv-1',
            amount: 5000,
            payment_method: 'cash',
            payment_date: '2026-10-05',
            payment_number: 'PAY-0001',
            recorded_by: 'Manager',
          },
        ],
      },
    ],
    advancePayments: [
      {
        id: 'adv-1',
        lab_id: 'lab-1',
        lab_name: 'Bajwa Dental',
        amount: 10000,
        allocated_amount: 0,
        remaining_amount: 10000,
        payment_date: '2026-10-06',
        created_at: '2026-10-06 09:00',
        payment_number: 'ADV-0001',
        payment_method: 'bank',
        recorded_by: 'Manager',
      },
    ],
    accountAdjustments: [
      {
        id: 'adj-cr',
        adjustment_number: 'CR-0001',
        lab_id: 'lab-1',
        lab_name: 'Bajwa Dental',
        type: 'credit_note',
        amount: 2000,
        reason: 'Goodwill discount',
        date: '2026-10-04',
        invoice_id: 'inv-1',
        invoice_number: 'INV-0001',
        recorded_by: 'Manager',
        created_at: '2026-10-04 09:00',
      },
      {
        id: 'adj-dr',
        adjustment_number: 'DR-0001',
        lab_id: 'lab-1',
        lab_name: 'Bajwa Dental',
        type: 'debit_adjustment',
        amount: 1500,
        reason: 'Rework charge',
        date: '2026-10-07',
        recorded_by: 'Manager',
        created_at: '2026-10-07 09:00',
      },
    ],
    cases: [],
    user: mockUser.current,
  }),
}));

import { ClinicPaymentsView } from '../../src/components/reports/ClinicPaymentsView';

afterEach(cleanup);

describe('ClinicPaymentsView', () => {
  it('lists direct payments and advance deposits for the lab', () => {
    render(<ClinicPaymentsView />);
    expect(screen.getByText('PAY-0001')).toBeTruthy();
    expect(screen.getByText('ADV-0001')).toBeTruthy();
  });

  it('blocks a role without reports:view', () => {
    mockUser.current = { id: 'u-2', name: 'Checker', role: 'Clinic Entry Manager', isSuperAdmin: false } as never;
    render(<ClinicPaymentsView />);
    expect(screen.getByText('Insufficient permission')).toBeTruthy();
    expect(screen.queryByText('PAY-0001')).toBeNull();
    mockUser.current = { id: 'u-1', name: 'Mateen', role: 'Super Admin', isSuperAdmin: true } as never;
  });

  it('lists credit notes and debit adjustments as adjustment rows', () => {
    render(<ClinicPaymentsView />);
    expect(screen.getByText('CR-0001')).toBeTruthy();
    expect(screen.getByText('DR-0001')).toBeTruthy();
  });

  it('narrows to adjustment rows when the Adjustments chip is pressed', () => {
    render(<ClinicPaymentsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Adjustments' }));
    expect(screen.getByText('CR-0001')).toBeTruthy();
    expect(screen.getByText('DR-0001')).toBeTruthy();
    expect(screen.queryByText('PAY-0001')).toBeNull();
    expect(screen.queryByText('ADV-0001')).toBeNull();
  });

  it('narrows to advance deposits when the chip is pressed', () => {
    render(<ClinicPaymentsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Advance deposits' }));
    expect(screen.getByText('ADV-0001')).toBeTruthy();
    expect(screen.queryByText('PAY-0001')).toBeNull();
  });

  it('shows the type chips as aria-pressed toggles', () => {
    render(<ClinicPaymentsView />);
    const all = screen.getByRole('button', { name: 'All' });
    expect(all.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Payments' }));
    expect(screen.getByRole('button', { name: 'Payments' }).getAttribute('aria-pressed')).toBe('true');
    expect(all.getAttribute('aria-pressed')).toBe('false');
  });
});
