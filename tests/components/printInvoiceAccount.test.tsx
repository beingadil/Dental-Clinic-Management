// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { BrandingSettings, Invoice } from '../../src/types';
import { PrintDocument } from '../../src/components/print/printRenderer';
import type { InvoiceAccountPosition } from '../../src/services/invoiceAccount';

afterEach(cleanup);

const branding = {
  appName: 'DENTAL SOLUTIONS',
  tagline: '',
  phone: '',
  email: '',
  address: '',
} as BrandingSettings;

const invoice = {
  id: 'inv-1',
  invoice_number: 'INV-0001',
  case_id: 'case-1',
  case_number: 'DS-1001',
  lab_id: 'lab-1',
  lab_name: 'Cases Clinic',
  case_type_name: 'Zirconia Crown',
  doctor_name: 'Dr. Tariq',
  patient_name: 'Patient One',
  amount: 10000,
  discount: 0,
  final_amount: 10000,
  amount_paid: 0,
  payment_status: 'unpaid',
  issue_date: '2026-10-22',
  due_date: '2026-11-05',
  created_at: '2026-10-22',
  payments: [],
} as Invoice;

const position = (over: Partial<InvoiceAccountPosition> = {}): InvoiceAccountPosition => ({
  openingBalance: -5000,
  advanceDeposit: 5000,
  advanceApplied: 0,
  invoiceAmount: 10000,
  cashPaid: 0,
  creditNotes: 0,
  closingBalance: 5000,
  ...over,
});

const renderInvoice = (accountPosition?: InvoiceAccountPosition) =>
  render(
    <PrintDocument
      kind="invoice"
      sections={['totals']}
      branding={branding}
      invoice={invoice}
      accountPosition={accountPosition}
    />,
  );

const textOf = (container: HTMLElement) => container.textContent || '';

describe('printed invoice account balance', () => {
  it('prints the advance deposit in the opening balance and nets it out of the closing', () => {
    const { container } = renderInvoice(position());
    const text = textOf(container);

    expect(text).toContain('Account Balance');
    expect(text).toContain('Opening Balance');
    expect(text).toContain('Advance Deposit (we owe)');
    expect(text).toContain('PKR 5,000 Cr');
    expect(text).toContain('This Invoice');
    expect(text).toContain('Closing Balance (Dr)');
    expect(text).toContain('PKR 5,000');
  });

  it('closes on the credit side when the advance exceeds the invoice', () => {
    const { container } = renderInvoice(
      position({
        invoiceAmount: 3000,
        closingBalance: -2000,
        advanceDeposit: 5000,
      }),
    );
    const text = textOf(container);

    expect(text).toContain('Closing Balance (Cr)');
    expect(text).toContain('PKR 2,000');
  });

  it('notes an advance applied to the invoice without subtracting it twice', () => {
    const { container } = renderInvoice(
      position({
        advanceDeposit: 0,
        advanceApplied: 5000,
        closingBalance: 5000,
      }),
    );
    const text = textOf(container);

    expect(text).toContain('settled from the advance deposit');
    expect(text).toContain('PKR 5,000');
    expect(text).not.toContain('Advance Deposit (we owe)');
  });

  it('omits the block when no account position is supplied', () => {
    const { container } = renderInvoice();
    const text = textOf(container);

    expect(text).not.toContain('Account Balance');
    expect(text).not.toContain('Closing Balance');
  });
});
