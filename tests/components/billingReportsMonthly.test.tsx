// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import type { Invoice, AdvancePayment, AccountAdjustment } from '../../src/types';

const downloadCSV = vi.fn();
vi.mock('../../src/services/csvExport', () => ({
  downloadCSV: (...args: unknown[]) => downloadCSV(...args),
}));

/* Same two-month fixture as the monthlyStatement service suite, so the numbers
   on screen are the numbers the domain proves: Feb bills 40,000 and banks a
   10,000 advance; Mar bills 25,000, collects 20,000 (15,000 cash + 5,000 from
   the wallet), spends 5,000 of advance credit and takes a 3,000 credit note. */
const { INVOICES, ADVANCES, ADJUSTMENTS } = vi.hoisted(() => {
  const invoices = [
    {
      id: 'inv-feb',
      invoice_number: 'INV-0001',
      case_id: 'case-feb',
      case_number: 'DS-3001',
      lab_id: 'lab-1',
      lab_name: 'Al-Noor Clinic',
      case_type_name: 'Zirconia Crown',
      doctor_name: 'Dr. Aslam',
      amount: 40000,
      discount: 0,
      final_amount: 40000,
      amount_paid: 15000,
      payment_status: 'partial',
      created_at: '2026-02-05 10:00',
      due_date: '2026-02-05',
      payments: [
        {
          id: 'p-bank',
          invoice_id: 'inv-feb',
          amount: 15000,
          payment_date: '2026-03-04',
          payment_method: 'bank',
          recorded_by: 'Tester',
        },
      ],
    },
    {
      id: 'inv-mar',
      invoice_number: 'INV-0002',
      case_id: 'case-mar',
      case_number: 'DS-3002',
      lab_id: 'lab-1',
      lab_name: 'Al-Noor Clinic',
      case_type_name: 'Emax Crown',
      doctor_name: 'Dr. Aslam',
      amount: 25000,
      discount: 0,
      final_amount: 25000,
      amount_paid: 5000,
      payment_status: 'partial',
      created_at: '2026-03-02 10:00',
      due_date: '2026-03-02',
      payments: [
        {
          id: 'p-adv',
          invoice_id: 'inv-mar',
          amount: 5000,
          payment_date: '2026-03-10',
          payment_method: 'advance',
          payment_type: 'advance_allocation',
          advance_payment_id: 'adv-1',
          recorded_by: 'Tester',
        },
      ],
    },
  ];
  const advances = [
    {
      id: 'adv-1',
      payment_number: 'ADV-0001',
      lab_id: 'lab-1',
      lab_name: 'Al-Noor Clinic',
      amount: 10000,
      allocated_amount: 5000,
      remaining_amount: 5000,
      payment_method: 'bank',
      payment_date: '2026-02-20',
      recorded_by: 'Tester',
      created_at: '2026-02-20 14:00',
    },
  ];
  const adjustments = [
    {
      id: 'adj-1',
      adjustment_number: 'CR-0001',
      lab_id: 'lab-1',
      lab_name: 'Al-Noor Clinic',
      type: 'credit_note',
      amount: 3000,
      reason: 'Shade mismatch',
      date: '2026-03-15',
      recorded_by: 'Tester',
      created_at: '2026-03-15 16:00',
    },
  ];
  return { INVOICES: invoices, ADVANCES: advances, ADJUSTMENTS: adjustments };
});

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    invoices: INVOICES,
    cases: [],
    savedVouchers: [],
    deleteSavedVoucher: () => {},
    advancePayments: ADVANCES,
    accountAdjustments: ADJUSTMENTS,
  }),
}));

import { BillingReportsView } from '../../src/components/billing/BillingReportsView';

/** Newest month first, so tables[0] is March and tables[1] is February. */
const tables = () => screen.getAllByRole('table');
const clinicRow = (table: HTMLElement) =>
  within(table).getByText('Al-Noor Clinic').closest('tr') as HTMLElement;
const footerRow = (table: HTMLElement) =>
  within(table).getByText('Month Total').closest('tr') as HTMLElement;

/**
 * Read a figure by its column heading. Several money columns repeat the same
 * amount in one row (PKR 5,000 is both "Advance Used" and "Advance Credit"),
 * so positional lookup is the only way to assert which figure is which.
 */
const figure = (table: HTMLElement, row: HTMLElement, heading: string): string => {
  const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent!.trim());
  const cells = within(row).getAllByRole('cell');
  return cells[headers.indexOf(heading)]?.textContent?.trim() ?? '';
};

const renderReports = () =>
  render(
    <BillingReportsView onPrintInvoice={() => {}} onViewCaseSlip={() => {}} />,
  );

afterEach(() => {
  cleanup();
  downloadCSV.mockClear();
});

describe('BillingReportsView monthly statement', () => {
  beforeEach(() => renderReports());

  it('shows one block per billing month, newest first', () => {
    expect(tables()).toHaveLength(2);
    expect(screen.getByText('March 2026')).toBeTruthy();
    expect(screen.getByText('February 2026')).toBeTruthy();
  });

  it('carries closing balance, advance credit and remaining as their own columns', () => {
    const [march] = tables();
    for (const heading of [
      'Billed (Dr)',
      'Collected (Cr)',
      'Advance In',
      'Advance Used',
      'Credit Notes',
      'Debit Adj.',
      'Opening (B/F)',
      'Closing (C/F)',
      'Advance Credit',
      'Remaining Due',
    ]) {
      expect(within(march).getByText(heading)).toBeTruthy();
    }
  });

  it('months the settlement by the month the cash landed', () => {
    const [march, february] = tables();
    // 15,000 bank + 5,000 from the advance wallet.
    expect(figure(march, clinicRow(march), 'Collected (Cr)')).toBe('PKR 20,000');
    // February's invoice was settled in March, so February collected nothing.
    expect(figure(february, clinicRow(february), 'Collected (Cr)')).toBe('PKR 0');
  });

  it('shows advance received and the unallocated wallet separately', () => {
    const [march, february] = tables();
    const febRow = clinicRow(february);
    expect(figure(february, febRow, 'Advance In')).toBe('PKR 10,000');
    expect(figure(february, febRow, 'Advance Used')).toBe('PKR 0');
    expect(figure(february, febRow, 'Advance Credit')).toBe('PKR 10,000');

    const marRow = clinicRow(march);
    // 5,000 spent against invoices, 5,000 still banked in the wallet.
    expect(figure(march, marRow, 'Advance Used')).toBe('PKR 5,000');
    expect(figure(march, marRow, 'Advance Credit')).toBe('PKR 5,000');
  });

  it('shows the balance brought forward, carried down and still owing', () => {
    const [march, february] = tables();
    const marRow = clinicRow(march);
    expect(figure(march, marRow, 'Opening (B/F)')).toBe('PKR 30,000'); // February's closing
    expect(figure(march, marRow, 'Closing (C/F)')).toBe('PKR 37,000');
    expect(figure(march, marRow, 'Remaining Due')).toBe('PKR 37,000');

    const febRow = clinicRow(february);
    expect(figure(february, febRow, 'Opening (B/F)')).toBe('PKR 0');
    expect(figure(february, febRow, 'Closing (C/F)')).toBe('PKR 30,000');
    expect(figure(february, febRow, 'Remaining Due')).toBe('PKR 30,000');
  });

  it('credits the credit note in the month it was issued', () => {
    expect(within(clinicRow(tables()[0])).getByText('PKR 3,000')).toBeTruthy();
    expect(within(clinicRow(tables()[1])).queryByText('PKR 3,000')).toBeNull();
  });

  it('totals each month in a footer', () => {
    const march = tables()[0];
    const footer = footerRow(march);
    expect(figure(march, footer, 'Cases Billed')).toBe('1');
    expect(figure(march, footer, 'Billed (Dr)')).toBe('PKR 25,000');
    expect(figure(march, footer, 'Closing (C/F)')).toBe('PKR 37,000');
    expect(figure(march, footer, 'Remaining Due')).toBe('PKR 37,000');
  });

  it('exports the same closing balance, advance credit and remaining due to CSV', () => {
    fireEvent.click(screen.getByText('Export Monthly Statement CSV'));

    expect(downloadCSV).toHaveBeenCalledTimes(1);
    const rows = downloadCSV.mock.calls[0][1] as string[][];
    const header = rows[0];
    expect(header).toContain('Closing Balance (PKR)');
    expect(header).toContain('Advance Credit (PKR)');
    expect(header).toContain('Remaining Due (PKR)');

    const march = rows.find((r) => r[0] === '2026-03')!;
    expect(march[header.indexOf('Closing Balance (PKR)')]).toBe(37000);
    expect(march[header.indexOf('Advance Credit (PKR)')]).toBe(5000);
    expect(march[header.indexOf('Remaining Due (PKR)')]).toBe(37000);
  });
});