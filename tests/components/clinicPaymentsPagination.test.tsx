// @vitest-environment jsdom
/**
 * Pagination and debounced search on the Clinic Payments register.
 *
 * The register is the one table in the app that renders every payment it
 * holds. It now mounts a page instead of the whole backlog, and its search
 * settles once per pause instead of on every keystroke.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

const COUNT = 55;

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [{ id: 'lab-1', name: 'Bajwa Dental' }],
    invoices: Array.from({ length: COUNT }, (_, i) => {
      const n = i + 1;
      const padded = String(n).padStart(4, '0');
      return {
        id: `inv-${n}`,
        invoice_number: `INV-${padded}`,
        case_id: `case-${n}`,
        case_number: `DS-${padded}`,
        lab_id: 'lab-1',
        lab_name: 'Bajwa Dental',
        final_amount: 1000,
        amount_paid: 1000,
        payment_status: 'paid',
        patient_name: `Patient ${n}`,
        created_at: '2026-10-02 09:00',
        payments: [
          {
            id: `pay-${n}`,
            invoice_id: `inv-${n}`,
            amount: 1000,
            payment_method: 'cash',
            payment_date: `2026-10-${String((n % 28) + 1).padStart(2, '0')}`,
            payment_number: `PAY-${padded}`,
            recorded_by: 'Audit Bot',
          },
        ],
      };
    }),
    advancePayments: [],
    accountAdjustments: [],
    cases: [],
    user: { id: 'u-1', name: 'Mateen', role: 'Super Admin', isSuperAdmin: true },
  }),
}));

import { ClinicPaymentsView } from '../../src/components/reports/ClinicPaymentsView';

afterEach(cleanup);

const bodyRows = (container: HTMLElement) =>
  container.querySelectorAll('tbody tr').length;

describe('ClinicPaymentsView — pagination', () => {
  it('mounts only the first page of a large register, and reaches the rest', () => {
    const { container } = render(<ClinicPaymentsView />);

    // Default page size is 50; the fixture holds 55 direct payments.
    expect(bodyRows(container)).toBe(50);
    expect(screen.getByText(/Totals \(55\)/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(bodyRows(container)).toBe(5);

    fireEvent.click(screen.getByRole('button', { name: 'Page 1' }));
    expect(bodyRows(container)).toBe(50);
  });

  it('narrows through the footer page-size selector', () => {
    const { container } = render(<ClinicPaymentsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Rows per page' }));
    fireEvent.click(screen.getByRole('option', { name: '10 / page' }));
    expect(bodyRows(container)).toBe(10);
  });
});

describe('ClinicPaymentsView — debounced search', () => {
  it('does not refilter until the typing pauses', async () => {
    const { container } = render(<ClinicPaymentsView />);

    const input = screen.getByLabelText('Search payments');
    fireEvent.change(input, { target: { value: '0005' } });

    // Debounce has not settled: the table still shows the unfiltered page.
    expect(screen.getByText(/Totals \(55\)/)).toBeTruthy();

    // Real timers: the debounce fires ~200 ms after the last keystroke.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });

    expect(screen.queryByText(/Totals \(55\)/)).toBeNull();
    expect(screen.getByText(/Totals \(1\)/)).toBeTruthy();
    expect(bodyRows(container)).toBe(1);
  });
});
