import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase, getDatabase } from '../../src/db/core';
import {
  clinicMonthSnapshots,
  closeMonth,
  reopenMonth,
  diffClosedMonths,
  closedMonthFor,
  listMonthCloses,
} from '../../src/services/monthClose';
import { buildMonthlyStatements } from '../../src/services/monthlyStatement';
import type { Invoice, PaymentRecord, AdvancePayment, AccountAdjustment, DentalLab } from '../../src/types';

/**
 * Month-end closing:
 *   - a clinic-month stores exactly what the live monthly statement computes
 *   - a silent clinic (no postings) still gets a row, carrying its balance
 *   - a zero-activity clinic stores zeros
 *   - reopening needs a reason and removes the stored row
 *   - figures that moved after a close are reported, never silently re-stored
 */

async function freshDb() {
  const SQL = await initSqlJs();
  const eng = await SqliteEngine.create(SQL, null);
  eng.migrate();
  setDatabase(eng);
  return eng;
}

beforeEach(async () => {
  await freshDb();
});

/** `getDatabase` here keeps the migration test honest: the close path writes
 *  into `month_closes` through the repo, so the table must exist. */
const auditActions = (): string[] =>
  getDatabase()
    .all<{ action: string }>('SELECT action FROM audit_events')
    .map((r) => r.action);

const pay = (over: Partial<PaymentRecord> & { id: string; amount: number; payment_date: string }): PaymentRecord => ({
  invoice_id: 'inv-1',
  payment_method: 'bank',
  recorded_by: 'Tester',
  ...over,
});

const invoice = (
  over: Partial<Invoice> & { id: string; final_amount: number; created_at: string },
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

const LABS: Pick<DentalLab, 'id' | 'name' | 'opening_balance' | 'opening_balance_type' | 'created_at'>[] = [
  { id: 'lab-1', name: 'Al-Noor Clinic', opening_balance: 0, opening_balance_type: 'debit', created_at: '2025-01-01' },
  { id: 'lab-2', name: 'Silent Clinic', opening_balance: 0, opening_balance_type: 'debit', created_at: '2025-01-01' },
  { id: 'lab-3', name: 'Old Practice', opening_balance: 0, opening_balance_type: 'debit', created_at: '2025-01-01' },
];

/* lab-1: Jan invoice 10,000 with 4,000 banked, March invoice 25,000 with 7,000
   banked. lab-3: Jan invoice 3,000, unpaid. lab-2: never posts anything. */
const buildInput = (extraPayments: PaymentRecord[] = []) => ({
  invoices: [
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
      payments: [pay({ id: 'p-mar', amount: 7000, payment_date: '2026-03-10' }), ...extraPayments],
    }),
    invoice({
      id: 'jan-lab3',
      lab_id: 'lab-3',
      lab_name: 'Old Practice',
      created_at: '2026-01-07 09:00',
      final_amount: 3000,
      amount_paid: 0,
    }),
  ],
  advancePayments: [] as AdvancePayment[],
  accountAdjustments: [] as AccountAdjustment[],
  labs: LABS,
});

describe('month-end closing', () => {
  it('stores exactly the figures the live monthly statement computes', () => {
    const input = buildInput();
    const statement = buildMonthlyStatements(input).find((b) => b.month === '2026-03');
    const live = statement?.rows.find((r) => r.lab_id === 'lab-1');
    expect(live).toBeDefined();

    const row = closeMonth({ ...input, month: '2026-03', labId: 'lab-1', actor: 'Super Admin' });
    expect(row.month).toBe('2026-03');
    expect(row.lab_id).toBe('lab-1');
    expect(row.billed).toBeCloseTo(live!.billed);
    expect(row.cases_billed).toBe(live!.cases_billed);
    expect(row.collected).toBeCloseTo(live!.collected);
    expect(row.closing_balance).toBeCloseTo(live!.closing_balance);
    expect(row.opening_balance).toBeCloseTo(live!.opening_balance);
    expect(row.advance_credit).toBeCloseTo(live!.advance_credit);
    expect(row.closed_by).toBe('Super Admin');
    expect(closedMonthFor('2026-03').get('lab-1')?.closing_balance).toBeCloseTo(live!.closing_balance);
    expect(auditActions()).toContain('month_close');
  });

  it('gives a silent but previously active clinic a carried-balance row', () => {
    const input = buildInput();
    const feb = clinicMonthSnapshots(input, '2026-02');
    const lab3 = feb.find((r) => r.lab_id === 'lab-3');
    // Never posted in February: carries January's closing rather than vanishing.
    expect(lab3).toBeDefined();
    expect(lab3!.cases_billed).toBe(0);
    expect(lab3!.billed).toBe(0);
    expect(lab3!.collected).toBe(0);
    expect(lab3!.opening_balance).toBeCloseTo(3000);
    expect(lab3!.closing_balance).toBeCloseTo(3000);
  });

  it('gives a clinic with no activity ever a zero row', () => {
    const input = buildInput();
    const mar = clinicMonthSnapshots(input, '2026-03');
    const lab2 = mar.find((r) => r.lab_id === 'lab-2');
    expect(lab2).toBeDefined();
    expect(lab2!.cases_billed).toBe(0);
    expect(lab2!.billed).toBe(0);
    expect(lab2!.collected).toBe(0);
    expect(lab2!.opening_balance).toBeCloseTo(0);
    expect(lab2!.closing_balance).toBeCloseTo(0);
  });

  it('closes a silent month and stores the carried snapshot', () => {
    const input = buildInput();
    const row = closeMonth({ ...input, month: '2026-02', labId: 'lab-3', actor: 'Billing Manager' });
    expect(row.cases_billed).toBe(0);
    expect(row.billed).toBe(0);
    expect(row.collected).toBe(0);
    expect(row.closing_balance).toBeCloseTo(3000);
    // And Feb for lab-1 carries its own Jan closing (10,000 - 4,000 collected).
    const lab1 = closeMonth({ ...input, month: '2026-02', labId: 'lab-1', actor: 'Billing Manager' });
    expect(lab1.closing_balance).toBeCloseTo(6000);
  });

  it('reopening without a reason is refused and nothing is deleted', () => {
    const input = buildInput();
    closeMonth({ ...input, month: '2026-03', labId: 'lab-1', actor: 'Super Admin' });
    expect(() => reopenMonth({ ...input, month: '2026-03', labId: 'lab-1', actor: 'Super Admin', reason: '   ' })).toThrow(/reason/i);
    expect(closedMonthFor('2026-03').get('lab-1')).toBeDefined();
  });

  it('reopening with a reason removes the row and writes the audit entry', () => {
    const input = buildInput();
    closeMonth({ ...input, month: '2026-03', labId: 'lab-1', actor: 'Super Admin' });
    reopenMonth({ ...input, month: '2026-03', labId: 'lab-1', actor: 'Super Admin', reason: 'Late bank slip found' });
    expect(closedMonthFor('2026-03').get('lab-1')).toBeUndefined();
    const actions = auditActions();
    expect(actions).toContain('month_close');
    expect(actions).toContain('month_reopen');
  });

  it('reports drift against a closed month, and clears it on re-close', () => {
    const input = buildInput();
    closeMonth({ ...input, month: '2026-03', labId: 'lab-1', actor: 'Super Admin' });

    // Books move in the closed month AFTER closing.
    const moved = buildInput([pay({ id: 'p-mar-late', amount: 2000, payment_date: '2026-03-20' })]);
    const drift = diffClosedMonths(moved);
    const found = drift.find((d) => d.month === '2026-03' && d.labId === 'lab-1');
    expect(found).toBeDefined();
    expect(found!.moved.map((m) => m.field)).toContain('collected');
    expect(found!.moved.map((m) => m.field)).toContain('closing_balance');

    // Re-close lands the row on today's books; drift clears.
    closeMonth({ ...moved, month: '2026-03', labId: 'lab-1', actor: 'Super Admin' });
    const after = diffClosedMonths(moved);
    expect(after.find((d) => d.month === '2026-03' && d.labId === 'lab-1')).toBeUndefined();
  });

  it('records reopening then re-closing over whatever the books now say', () => {
    const input = buildInput();
    closeMonth({ ...input, month: '2026-03', labId: 'lab-1', actor: 'Super Admin' });
    reopenMonth({ ...input, month: '2026-03', labId: 'lab-1', actor: 'Billing Manager', reason: 'Wrong month' });
    const moved = buildInput([pay({ id: 'p-mar-2', amount: 5000, payment_date: '2026-03-25' })]);
    const row = closeMonth({ ...moved, month: '2026-03', labId: 'lab-1', actor: 'Billing Manager' });
    /* 7,000 banked in the fixture plus 5,000 the re-close picked up. */
    expect(row.collected).toBeCloseTo(12000);
    expect(row.closed_by).toBe('Billing Manager');
  });

  it('keeps one current row per clinic-month even across re-closes', () => {
    const input = buildInput();
    closeMonth({ ...input, month: '2026-03', labId: 'lab-1', actor: 'A' });
    closeMonth({ ...buildInput([pay({ id: 'p-x', amount: 1000, payment_date: '2026-03-29' })]), month: '2026-03', labId: 'lab-1', actor: 'B' });
    const all = listMonthCloses().filter((r) => r.month === '2026-03' && r.lab_id === 'lab-1');
    expect(all).toHaveLength(1);
  });

  it('rejects a malformed month', () => {
    const input = buildInput();
    expect(() => closeMonth({ ...input, month: '2026-3', labId: 'lab-1' })).toThrow(/YYYY-MM/);
    expect(() => reopenMonth({ ...input, month: 'March 2026', labId: 'lab-1', reason: 'x' })).toThrow(/YYYY-MM/);
  });
});


