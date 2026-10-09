// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const { CASE, INVOICE, LAB, TODAY } = vi.hoisted(() => {
  // The modal opens on the Today period, so the fixture invoice is dated today.
  const now = new Date();
  const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
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
  return {
    CASE: kase,
    TODAY,
    LAB: { id: 'lab-1', name: 'Cases Clinic', doctor_name: 'Tariq Mahmood' },
    // Unpaid, so it survives the modal's "balance due > 0" filter, and dated
    // today so it survives the default Today period.
    INVOICE: {
      id: 'inv-1',
      invoice_number: 'INV-0042',
      case_id: 'case-1',
      case_number: 'DS-2001',
      lab_id: 'lab-1',
      lab_name: 'Cases Clinic',
      case_type_name: 'Zirconia Crown',
      doctor_name: 'Tariq Mahmood',
      patient_name: 'Ali Raza',
      amount: 30000,
      discount: 0,
      final_amount: 30000,
      amount_paid: 10000,
      payment_status: 'partial',
      issue_date: null, // set by the test to today
      due_date: '',
      created_at: '',
      payments: [],
    },
  };
});

// Print settings read SQLite through the settings repo; the layout under test
// is the shipped default, so the store is stubbed out entirely.
vi.mock('../../src/services/printSettings', () => ({
  loadPrintSettings: () => ({
    paper: 'a4',
    margin: 'normal',
    fontSize: 'normal',
    showLogo: true,
    logoPosition: 'left',
    jobSlipStyle: 'full',
  }),
  loadDocumentSections: (_kind: string, fallback: string[]) => [...fallback],
}));

// Mutable so a test can swap the case list to exercise the fallback path,
// where an invoice names a case that is no longer in the store.
const store = vi.hoisted(() => ({ cases: [] as unknown[] }));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [LAB],
    invoices: [{ ...INVOICE, issue_date: TODAY, created_at: TODAY }],
    cases: store.cases,
    brandingSettings: {
      appName: 'DENTAL SOLUTIONS',
      tagline: '',
      phone: '',
      email: '',
      address: '',
    },
    saveVoucherToSystem: () => {},
  }),
}));

import { BatchInvoicePrintModal } from '../../src/components/billing/BatchInvoicePrintModal';

afterEach(cleanup);

describe('BatchInvoicePrintModal case detail', () => {
  beforeEach(() => {
    store.cases = [CASE];
  });

  it('prints the case identity on the summary sheet', () => {
    render(<BatchInvoicePrintModal onClose={() => {}} />);

    // The statement table resolves the invoice to its case: the number shows
    // twice on screen, once in the selection list and once on the sheet.
    expect(screen.getAllByText('INV-0042')).toHaveLength(2);
    expect(screen.getByText('Patient')).toBeTruthy();
    expect(screen.getByText('Ali Raza')).toBeTruthy();
    expect(screen.getByText('Procedure')).toBeTruthy();
    expect(screen.getByText('Zirconia Crown')).toBeTruthy();
    expect(screen.getByText('Teeth')).toBeTruthy();
    expect(screen.getByText('#11, #21')).toBeTruthy();
    expect(screen.getByText('Shade')).toBeTruthy();
    // Both dates, kept apart: one is history, the other a promise.
    expect(screen.getByText('Received Date')).toBeTruthy();
    expect(screen.getByText('Oct 3, 2026')).toBeTruthy();
    expect(screen.getByText('Delivery Date')).toBeTruthy();
    expect(screen.getByText('Dec 20, 2026')).toBeTruthy();
  });

  it('names the patient and procedure in the selection list', () => {
    render(<BatchInvoicePrintModal onClose={() => {}} />);

    // The operator sees what they are about to print without opening a case.
    expect(screen.getByText('Ali Raza · Zirconia Crown')).toBeTruthy();
  });

  it('falls back to the bare case number when the case is gone', () => {
    // printRenderer.tsx claims omitting `cases` "degrades to the bare case
    // number rather than breaking". An invoice can outlive its case — the
    // store is edited in place — so that claim needs to hold, not just be
    // plausible: the sheet must still print the invoice and its numbers.
    store.cases = [];
    render(<BatchInvoicePrintModal onClose={() => {}} />);

    // The case number still appears on both the picker row and the sheet.
    expect(screen.getAllByText('DS-2001')).toHaveLength(2);
    // The money columns are untouched by the missing join.
    expect(screen.getAllByText('PKR 30,000').length).toBeGreaterThan(0);
    // And the detail block is simply absent, not half-rendered.
    expect(screen.queryByText('Ali Raza')).toBeNull();
    expect(screen.queryByText('Patient')).toBeNull();
  });
});