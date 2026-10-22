// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { BrandingSettings, Invoice } from '../../src/types';
import { PrintDocument } from '../../src/components/print/printRenderer';

afterEach(cleanup);

/* The closing line of a clinic statement is a debit/credit balance, not just
   "what is left on these invoices": a clinic that sent a 50,000 advance and
   was billed 8,000 holds 42,000 with us, so the statement must close on the
   credit side. The old block also called every rupee received "Amount Paid",
   which read as if the advance itself had never been paid. */

const branding = {
  appName: 'DENTAL SOLUTIONS',
  tagline: '',
  phone: '',
  email: '',
  address: '',
} as BrandingSettings;

const makeInvoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'inv-1',
  invoice_number: 'INV-0001',
  case_id: 'case-1',
  case_number: 'DS-1001',
  lab_id: 'lab-1',
  lab_name: 'Cases Clinic',
  case_type_name: 'Zirconia Crown',
  doctor_name: 'Dr. Tariq',
  patient_name: 'Patient One',
  amount: 8000,
  discount: 0,
  final_amount: 8000,
  amount_paid: 8000,
  payment_status: 'paid',
  issue_date: '2026-10-22',
  due_date: '2026-11-05',
  created_at: '2026-10-22',
  payments: [],
  ...over,
});

const renderStatement = (invoice: Invoice, advanceBalance: number) =>
  render(
    <PrintDocument
      kind="statement"
      sections={['invoiceTable', 'balanceSummary']}
      branding={branding}
      invoices={[invoice]}
      cases={[]}
      labName="Cases Clinic"
      advanceBalance={advanceBalance}
    />,
  );

describe('statement closing balance — debit / credit', () => {
  it('closes on the credit side when an unallocated advance exceeds the dues', () => {
    const { container } = renderStatement(makeInvoice(), 42000);
    const text = container.textContent || '';

    expect(text).toContain('Advance Credit (we owe)');
    expect(text).toContain('PKR 42,000');
    expect(text).toContain('Closing Balance (Cr)');
    // The received figure is no longer mislabelled as if it were the only money paid.
    expect(text).not.toContain('Amount Paid');
    expect(text).toContain('Paid / Adjusted');
  });

  it('closes on the debit side when the clinic still owes for the cases', () => {
    const { container } = renderStatement(
      makeInvoice({ amount_paid: 0, payment_status: 'unpaid' }),
      0,
    );
    const text = container.textContent || '';

    expect(text).toContain('Closing Balance (Dr)');
    expect(text).toContain('PKR 8,000');
    expect(text).not.toContain('Advance Credit (we owe)');
  });

  it('leaves the closing line unsigned when the account settles exactly', () => {
    const { container } = renderStatement(makeInvoice(), 0);
    const text = container.textContent || '';

    expect(text).toContain('Closing Balance');
    expect(text).not.toContain('Closing Balance (Dr)');
    expect(text).not.toContain('Closing Balance (Cr)');
  });
});
