// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const downloadCSV = vi.fn();
vi.mock('../../src/services/csvExport', () => ({
  downloadCSV: (...args: unknown[]) => downloadCSV(...args),
}));

// The modal reads labs, the ledger and the case book from the app context.
// Stubbing it keeps this a pure render test of the statement surface. The
// fixtures are hoisted with the factory so the module graph can import the
// component below without hitting the temporal dead zone.
const { CASE, LEDGER } = vi.hoisted(() => {
  const kase = {
    id: 'case-1',
    case_number: 'DS-2001',
    patient_name: 'Ali Raza',
    lab_id: 'lab-1',
    lab_name: 'Cases Clinic',
    case_type_id: 'ct-1',
    case_type_name: 'Zirconia Crown',
    units_count: 3,
    doctor_name: 'Dr. Tariq Mahmood',
    selected_teeth: [21, 11],
    shade: 'A2',
    material: 'Zirconia',
    delivery_date: '2026-12-20',
    received_date: '2026-10-03',
    priority: 'normal',
    price: 30000,
    discount: 0,
    final_price: 30000,
    status: 'received',
    created_at: '2026-10-01 09:00',
    updated_at: '2026-10-01 09:00',
    history: [],
  };
  const ledger = [
    {
      id: 'l1',
      date: '2026-10-05',
      entry_type: 'invoice',
      reference_number: 'INV-0042',
      description: 'Case DS-2001',
      debit: 30000,
      credit: 0,
      running_balance: 30000,
      case_id: 'case-1',
      case_number: 'DS-2001',
    },
    {
      id: 'l2',
      date: '2026-10-06',
      entry_type: 'payment',
      reference_number: 'PAY-0007',
      description: 'Bank transfer',
      debit: 0,
      credit: 5000,
      running_balance: 25000,
    },
  ];
  return { CASE: kase, LEDGER: ledger };
});

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [{ id: 'lab-1', name: 'Cases Clinic' }],
    cases: [CASE],
    brandingSettings: {
      appName: 'DENTAL SOLUTIONS',
      tagline: '',
      phone: '',
      email: '',
      address: '',
    },
    getLabFinancialSummary: () => ({ netOutstanding: 30000, advanceCreditBalance: 0 }),
    getLedgerEntries: () => LEDGER,
  }),
}));

import { ClinicStatementModal } from '../../src/components/billing/ClinicStatementModal';

afterEach(() => {
  cleanup();
  downloadCSV.mockClear();
});

const renderModal = () =>
  render(
    <ClinicStatementModal isOpen onClose={() => {}} clinicId="lab-1" />,
  );

describe('ClinicStatementModal case detail', () => {
  it('shows the case identity and both dates on the invoice row', () => {
    renderModal();

    // Case/Job column
    expect(screen.getAllByText('DS-2001').length).toBeGreaterThan(0);

    // Detail block: label + value pairs, not just the invoice number.
    expect(screen.getByText('Patient')).toBeTruthy();
    expect(screen.getByText('Ali Raza')).toBeTruthy();
    expect(screen.getByText('Procedure')).toBeTruthy();
    expect(screen.getByText('Zirconia Crown')).toBeTruthy();
    expect(screen.getByText('Teeth')).toBeTruthy();
    expect(screen.getByText('#11, #21')).toBeTruthy();
    expect(screen.getByText('Shade')).toBeTruthy();
    expect(screen.getByText('A2')).toBeTruthy();
    expect(screen.getByText('Received Date')).toBeTruthy();
    expect(screen.getByText('Oct 3, 2026')).toBeTruthy();
    // The promised day is its own row, not folded into the received one.
    expect(screen.getByText('Delivery Date')).toBeTruthy();
    expect(screen.getByText('Dec 20, 2026')).toBeTruthy();
  });

  it('leaves doctor, material and units to the case record', () => {
    renderModal();

    expect(screen.queryByText('Doctor')).toBeNull();
    expect(screen.queryByText('Material')).toBeNull();
    expect(screen.queryByText('Units')).toBeNull();
    expect(screen.queryByText('Dr. Tariq Mahmood')).toBeNull();
  });

  it('leaves a payment row with no case detail', () => {
    renderModal();
    // Only the invoice row carries the block, so the labels appear once each.
    expect(screen.getAllByText('Procedure')).toHaveLength(1);
  });

  it('exports the case identity in the CSV', () => {
    renderModal();
    fireEvent.click(screen.getByText('Export CSV'));

    expect(downloadCSV).toHaveBeenCalledTimes(1);
    const rows = downloadCSV.mock.calls[0][1] as string[][];
    const header = rows[0];
    expect(header).toContain('Case/Job');

    const invoice = rows[1];
    expect(invoice[header.indexOf('Case/Job')]).toBe('DS-2001');
    // The ledger publishes `entry_type`; exporting the never-populated legacy
    // `type` alias is what left the Type column blank.
    expect(invoice[header.indexOf('Type')]).toBe('invoice');
    const description = invoice[header.indexOf('Description')];
    expect(description).toContain('Patient: Ali Raza');
    expect(description).toContain('Procedure: Zirconia Crown');
    expect(description).toContain('Teeth: #11, #21');
    expect(description).toContain('Shade: A2');
    expect(description).toContain('Received Date: Oct 3, 2026');
    expect(description).toContain('Delivery Date: Dec 20, 2026');
    expect(description).not.toContain('Doctor:');
    expect(description).not.toContain('Material:');
    expect(description).not.toContain('Units:');

    // The payment row gets an empty case, not the invoice's.
    const payment = rows[2];
    expect(payment[header.indexOf('Case/Job')]).toBe('');
    expect(payment[header.indexOf('Description')]).toBe('Bank transfer');
    expect(payment[header.indexOf('Type')]).toBe('payment');
  });
});