import { describe, it, expect } from 'vitest';
import {
  buildMonthlyStatements,
  formatMonthLabel,
  monthlyStatementCsvRows,
} from '../../src/services/monthlyStatement';
import { buildLabFinancialSummary } from '../../src/services/ledgerDomain';
import type { Invoice, PaymentRecord, AdvancePayment, AccountAdjustment } from '../../src/types';

/**
 * Monthly statement math.
 *
 * These tests pin the corrections the old report got wrong, so a future
 * refactor cannot quietly reintroduce them:
 *   - a payment belongs to the month the CASH moved, not the invoice's month
 *   - advances reduce the receivable when banked and are neutral when applied
 *   - each month's closing balance is the next month's opening
 *   - the newest closing balance equals the authoritative lab summary
 */

const pay = (over: Partial<PaymentRecord> & { amount: number; payment_date: string }): PaymentRecord => ({
  id: over.id || 'pay-1',
  invoice_id: 'inv-1',
  payment_method: 'bank',
  recorded_by: 'Tester',
  ...over,
});

const invoice = (
  over: Partial<Invoice> & { id: string; final_amount: number; created_at: string }
): Invoice => ({
  invoice_number: `INV-${over.id}`,
  case_id: `case-${over.id}`,
  case_number: `DS-${over.id}`,
  lab_id: 'lab-1',
  lab_name: 'Al-Noor Clinic',
  case_type_name: 'Zirconia Crown',
  doctor_name: 'Dr. Aslam',
  discount: 0,
  amount_paid: 0,
  payment_status: 'unpaid',
  due_date: over.created_at.slice(0, 10),
  payments: [],
  ...over,
  amount: over.amount ?? over.final_amount,
  final_amount: over.final_amount,
  created_at: over.created_at,
});

/* Al-Noor Clinic across two months:
     Feb: invoice 40,000, advance banked 10,000 (5,000 left unspent)
     Mar: invoice 25,000, 15,000 bank payment against Feb's invoice,
          5,000 of the Feb advance applied to Mar's invoice, 3,000 credit note */
const INVOICES: Invoice[] = [
  invoice({
    id: 'feb',
    created_at: '2026-02-05 10:00',
    final_amount: 40000,
    amount_paid: 15000,
    payments: [pay({ id: 'p-bank', amount: 15000, payment_date: '2026-03-04' })],
  }),
  invoice({
    id: 'mar',
    created_at: '2026-03-02 10:00',
    final_amount: 25000,
    amount_paid: 5000,
    payments: [
      pay({
        id: 'p-adv',
        amount: 5000,
        payment_date: '2026-03-10',
        payment_method: 'advance',
        payment_type: 'advance_allocation',
        advance_payment_id: 'adv-1',
      }),
    ],
  }),
];

const ADVANCES: AdvancePayment[] = [
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

const ADJUSTMENTS: AccountAdjustment[] = [
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

const blocks = buildMonthlyStatements({
  invoices: INVOICES,
  advancePayments: ADVANCES,
  accountAdjustments: ADJUSTMENTS,
});
/* Newest month first, the order every report tab in this app uses. */
const march = blocks[0];
const february = blocks[1];
const row = (b: typeof blocks[number], labId = 'lab-1') => b.rows.find((r) => r.lab_id === labId)!;

describe('buildMonthlyStatements', () => {
  it('returns one block per calendar month, newest first', () => {
    expect(blocks.map((b) => b.month)).toEqual(['2026-03', '2026-02']);
  });

  it('files a collection in the month the cash landed, not the invoice month', () => {
    // Feb's invoice is paid in March; March must show the collection.
    expect(row(march).collected).toBe(20000);
    expect(row(february).collected).toBe(0);
  });

  it('counts an applied advance once as a settlement and once as advance applied', () => {
    expect(row(march).advance_applied).toBe(5000);
    // 15,000 bank + 5,000 spent from the wallet.
    expect(row(march).collected).toBe(20000);
    // The deposit is NOT a settlement in its own month.
    expect(row(february).advance_received).toBe(10000);
  });

  it('tracks the unallocated advance wallet across months', () => {
    expect(row(february).advance_credit).toBe(10000);
    expect(row(march).advance_credit).toBe(5000);
  });

  it('bills each invoice in its own month and counts the cases', () => {
    expect(row(february).billed).toBe(40000);
    expect(row(february).cases_billed).toBe(1);
    expect(row(march).billed).toBe(25000);
    expect(row(march).cases_billed).toBe(1);
  });

  it('credits the credit note in its own month', () => {
    expect(row(march).credit_notes).toBe(3000);
    expect(row(february).credit_notes).toBe(0);
  });

  it('carries each closing balance into the next opening balance', () => {
    // Feb: 40,000 billed − 10,000 advance banked.
    expect(row(february).opening_balance).toBe(0);
    expect(row(february).closing_balance).toBe(30000);

    // Mar: 30,000 opening + 25,000 billed − 20,000 collected
    //      + 5,000 advance applied − 3,000 credit note.
    expect(row(march).opening_balance).toBe(30000);
    expect(row(march).closing_balance).toBe(37000);
  });

  it('reports the amount still owed as the non-negative closing balance', () => {
    expect(row(march).remaining).toBe(37000);
  });

  it('clamps remaining to zero when the clinic is in credit', () => {
    const credited = buildMonthlyStatements({
      invoices: [invoice({ id: 'x', created_at: '2026-01-05 10:00', final_amount: 5000 })],
      advancePayments: [{ ...ADVANCES[0], payment_date: '2026-01-06', created_at: '2026-01-06 10:00' }],
      accountAdjustments: [],
    });
    const r = credited[0].rows[0];
    expect(r.closing_balance).toBe(-5000); // in credit
    expect(r.remaining).toBe(0);
    expect(r.advance_credit).toBe(10000);
  });

  it('reconciles the newest closing balance with the authoritative lab summary', () => {
    const summary = buildLabFinancialSummary({
      labId: 'lab-1',
      invoices: INVOICES,
      advancePayments: ADVANCES,
      accountAdjustments: ADJUSTMENTS,
    });
    expect(row(march).closing_balance).toBe(summary.net_balance);
    expect(row(march).remaining).toBe(summary.outstanding_balance);
    expect(row(march).advance_credit).toBe(summary.advance_balance);
  });

  it('excludes voided invoices and write-offs', () => {
    const blocksWithNoise = buildMonthlyStatements({
      invoices: [
        ...INVOICES,
        invoice({
          id: 'void',
          created_at: '2026-04-01 10:00',
          final_amount: 99000,
          status_v2: 'voided',
        }),
      ],
      advancePayments: [],
      accountAdjustments: [
        ...ADJUSTMENTS,
        {
          ...ADJUSTMENTS[0],
          id: 'adj-wo',
          adjustment_number: 'ADJ-0002',
          type: 'write_off',
          amount: 50000,
          date: '2026-04-02',
        },
      ],
    });
    const april = blocksWithNoise.find((b) => b.month === '2026-04');
    expect(april).toBeUndefined();
  });

  it('falls back to the current month for records with a malformed date', () => {
    const [newest] = buildMonthlyStatements({
      invoices: [invoice({ id: 'bad', created_at: 'not-a-date', final_amount: 1000 })],
      advancePayments: [],
      accountAdjustments: [],
    });
    expect(newest.month).toMatch(/^\d{4}-\d{2}$/);
    expect(newest.rows[0].billed).toBe(1000);
  });

  it('totals every column across the clinics of a month', () => {
    expect(march.totals).toMatchObject({
      clinics: 1,
      cases_billed: 1,
      billed: 25000,
      collected: 20000,
      advance_received: 0,
      advance_applied: 5000,
      credit_notes: 3000,
      opening_balance: 30000,
      closing_balance: 37000,
      advance_credit: 5000,
      remaining: 37000,
    });
  });

  it('handles an empty ledger without throwing', () => {
    expect(
      buildMonthlyStatements({ invoices: [], advancePayments: [], accountAdjustments: [] })
    ).toEqual([]);
  });
});

describe('formatMonthLabel', () => {
  it('renders a human month label', () => {
    expect(formatMonthLabel('2026-03')).toBe('March 2026');
    expect(formatMonthLabel('2026-01')).toBe('January 2026');
  });
});

describe('monthlyStatementCsvRows', () => {
  it('exports every statement column, one row per clinic per month', () => {
    const rows = monthlyStatementCsvRows(blocks);
    expect(rows[0]).toEqual([
      'Month',
      'Dental Clinic',
      'Cases Billed',
      'Billed (PKR)',
      'Collected (PKR)',
      'Advance Received (PKR)',
      'Advance Applied (PKR)',
      'Credit Notes (PKR)',
      'Debit Adjustments (PKR)',
      'Opening Balance (PKR)',
      'Closing Balance (PKR)',
      'Advance Credit (PKR)',
      'Remaining Due (PKR)',
    ]);
    // Newest month first, matching the table.
    expect(rows[1][0]).toBe('2026-03');
    const i = rows[0].indexOf('Closing Balance (PKR)');
    const j = rows[0].indexOf('Advance Credit (PKR)');
    const k = rows[0].indexOf('Remaining Due (PKR)');
    expect(rows[1][i]).toBe(37000);
    expect(rows[1][j]).toBe(5000);
    expect(rows[1][k]).toBe(37000);
  });
});