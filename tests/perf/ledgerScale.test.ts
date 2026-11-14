/**
 * Perf: ledger build at near-realistic scale.
 *
 * Fixture: ~1,500 invoices across 3 clinics with ~3,000 embedded payments.
 * This is the "thousands of entries" question, measured instead of guessed.
 * Timings are logged, not asserted — wall-clock assertions are meaningless
 * on a contended CI runner — but each routine must still complete and return
 * the right shape.
 */
import { describe, it, expect } from 'vitest';
import { buildLedgerEntries } from '../../src/services/ledgerDomain';
import { buildMonthlyStatements } from '../../src/services/monthlyStatement';
import type { Invoice, AdvancePayment, AccountAdjustment, DentalLab } from '../../src/types';

const CLINICS: DentalLab[] = [
  { id: 'lab-1', name: 'Perf Clinic A', doctor_name: 'Dr. A', address: 'x', city: 'x', phone: 'x', email: 'a@x', code: 'PERF1', created_at: '2025-01-05 09:00', opening_balance: 0, opening_balance_type: 'debit' } as unknown as DentalLab,
  { id: 'lab-2', name: 'Perf Clinic B', doctor_name: 'Dr. B', address: 'x', city: 'x', phone: 'x', email: 'b@x', code: 'PERF2', created_at: '2025-02-05 09:00', opening_balance: 0, opening_balance_type: 'debit' } as unknown as DentalLab,
  { id: 'lab-3', name: 'Perf Clinic C', doctor_name: 'Dr. C', address: 'x', city: 'x', phone: 'x', email: 'c@x', code: 'PERF3', created_at: '2025-03-05 09:00', opening_balance: 0, opening_balance_type: 'debit' } as unknown as DentalLab,
];

const buildFixture = () => {
  const invoices: Invoice[] = [];
  const advancePayments: AdvancePayment[] = [];
  const accountAdjustments: AccountAdjustment[] = [];
  for (let i = 0; i < 1500; i++) {
    const n = i + 1;
    const clinic = CLINICS[i % 3];
    const invoiceId = `inv-${n}`;
    const payments = Array.from({ length: i % 5 === 0 ? 0 : 2 }, (_, j) => ({
      id: `pay-${n}-${j}`,
      invoice_id: invoiceId,
      amount: 1000,
      payment_method: 'cash' as const,
      payment_date: `2026-0${(i % 9) + 1}-15`,
      payment_number: `PAY-${String(n * 2 + j).padStart(4, '0')}`,
      recorded_by: 'Perf',
    }));
    invoices.push({
      id: invoiceId,
      invoice_number: `INV-${String(n).padStart(5, '0')}`,
      case_id: `case-${n}`,
      case_number: `DS-${String(n).padStart(5, '0')}`,
      lab_id: clinic.id,
      lab_name: clinic.name,
      case_type_name: 'Zirconia',
      doctor_name: clinic.doctor_name,
      patient_name: `Patient ${n}`,
      amount: 5000,
      discount: 0,
      final_amount: 5000,
      amount_paid: payments.reduce((s, p) => s + p.amount, 0),
      payment_status: 'paid',
      payments,
      issue_date: `2026-0${(i % 9) + 1}-10`,
      due_date: `2026-0${(i % 9) + 1}-25`,
      created_at: `2026-0${(i % 9) + 1}-10 09:00`,
    } as unknown as Invoice);
  }
  return { invoices, advancePayments, accountAdjustments };
};

const { invoices, advancePayments, accountAdjustments } = buildFixture();

describe('scale — ledger build and monthly statements', () => {
  it('builds ledger entries for ~1,500 invoices and ~3,000 payments', () => {
    const t0 = performance.now();
    const entries = buildLedgerEntries({ invoices, advancePayments, accountAdjustments, labs: CLINICS });
    const ms = performance.now() - t0;
    console.info(`[perf] buildLedgerEntries(${invoices.length} invoices): ${ms.toFixed(1)} ms — ${entries.length} entries`);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('builds monthly statements across the same fixture', () => {
    const t0 = performance.now();
    const statements = buildMonthlyStatements({ invoices, advancePayments, accountAdjustments, labs: CLINICS });
    const ms = performance.now() - t0;
    console.info(`[perf] buildMonthlyStatements: ${ms.toFixed(1)} ms — ${statements.length} month blocks`);
    expect(statements.length).toBeGreaterThan(0);
  });

  it('builds for a single clinic without recomputing the whole book (filterLabId)', () => {
    const t0 = performance.now();
    const entries = buildLedgerEntries({ invoices, advancePayments, accountAdjustments, labs: CLINICS, filterLabId: 'lab-1' });
    const ms = performance.now() - t0;
    console.info(`[perf] buildLedgerEntries(filter lab-1): ${ms.toFixed(1)} ms — ${entries.length} entries`);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.lab_id === 'lab-1')).toBe(true);
  });
});
