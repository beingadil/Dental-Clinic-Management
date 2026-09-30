import { describe, it, expect, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { syncCollectionsToDb, getLastSyncError, type SyncCollections } from '../../src/db/syncCore';

/**
 * Regression: ONE duplicate payment_number in React state (multi-invoice
 * slices shared a number before the generator fix) aborted the whole sync
 * transaction with "UNIQUE constraint failed: payments.payment_number" and
 * silently stopped ALL persistence. The syncer must heal duplicates — first
 * occurrence keeps its number, later ones get a deterministic -D2 suffix —
 * and never drop money rows.
 */

const paymentRow = (id: string, number: string, amount: number) => ({
  id, payment_number: number, receipt_number: 'REC-2026-0001', amount,
  payment_method: 'cash', payment_date: '2026-09-28', recorded_by: 'Tester',
  created_at: '2026-09-28T09:00',
});

const invoiceRow = (id: string, number: string, payments: ReturnType<typeof paymentRow>[]) => ({
  id, invoice_number: number, lab_id: 'lab-1', lab_name: 'Test Clinic',
  amount: 1000, discount: 0, final_amount: 1000,
  amount_paid: payments.reduce((sum, p) => sum + p.amount, 0),
  payment_status: 'partial', status_v2: 'partially_paid',
  created_at: '2026-09-28T09:00', payments,
});

function makeCollections(): SyncCollections {
  return {
    users: [],
    labs: [{ id: 'lab-1', name: 'Test Clinic', created_at: '2026-09-28T09:00' }],
    caseTypes: [],
    cases: [],
    invoices: [
      // Two slices of ONE split receipt — the exact pre-fix duplicate shape.
      invoiceRow('inv-1', 'INV-0001', [paymentRow('pay-1', 'PAY-2026-0001', 300), paymentRow('pay-2', 'PAY-2026-0001', 200)]),
      invoiceRow('inv-2', 'INV-0002', []),
    ],
    advancePayments: [
      { id: 'adv-1', payment_number: 'ADV-2026-0001', lab_id: 'lab-1', lab_name: 'Test Clinic', amount: 500, allocated_amount: 0, remaining_amount: 500, payment_method: 'cash', payment_date: '2026-09-28', recorded_by: 'Tester', status: 'available', attachments: [] },
      { id: 'adv-2', payment_number: 'ADV-2026-0001', lab_id: 'lab-1', lab_name: 'Test Clinic', amount: 700, allocated_amount: 0, remaining_amount: 700, payment_method: 'bank', payment_date: '2026-09-28', recorded_by: 'Tester', status: 'available', attachments: [] },
    ],
    accountAdjustments: [], journalEntries: [], reconciliationItems: [],
    notifications: [], savedVouchers: [], auditEvents: [], templates: [],
    labContacts: [], labAddresses: [], pricingOverrides: [], labReviews: [],
    caseNotes: {}, caseAttachments: {}, qcInspections: [], doctorPreferences: [],
  } as unknown as SyncCollections;
}

describe('syncCore duplicate-number healing', () => {
  it('persists every row when payments and advances share document numbers', async () => {
    const SQL = await initSqlJs();
    const eng = await SqliteEngine.create(SQL, null);
    eng.migrate();
    setDatabase(eng);

    vi.useFakeTimers();
    syncCollectionsToDb(makeCollections());
    vi.advanceTimersByTime(150);
    vi.useRealTimers();

    expect(getLastSyncError()).toBeNull();

    const paymentNumbers = eng
      .all<{ n: string }>('SELECT payment_number AS n FROM payments ORDER BY payment_number')
      .map((r) => r.n);
    expect(paymentNumbers).toHaveLength(2);
    expect(new Set(paymentNumbers).size).toBe(2);
    expect(paymentNumbers).toContain('PAY-2026-0001');
    expect(paymentNumbers).toContain('PAY-2026-0001-D2');

    const advanceNumbers = eng
      .all<{ n: string }>('SELECT payment_number AS n FROM advance_payments ORDER BY payment_number')
      .map((r) => r.n);
    expect(advanceNumbers).toHaveLength(2);
    expect(new Set(advanceNumbers).size).toBe(2);
    expect(advanceNumbers).toContain('ADV-2026-0001');
    expect(advanceNumbers).toContain('ADV-2026-0001-D2');
  });

  it('heals duplicate invoice/case numbers, skips orphan QC rows and dedupes teeth', async () => {
    const SQL = await initSqlJs();
    const eng = await SqliteEngine.create(SQL, null);
    eng.migrate();
    setDatabase(eng);

    const caseRow = (id: string, num: string, teeth: number[]) => ({
      id, case_number: num, lab_id: 'lab-1', lab_name: 'Test Clinic', doctor_name: 'Dr. T',
      selected_teeth: teeth, delivery_date: '2026-10-01', status: 'received',
      created_at: '2026-09-28T09:00', updated_at: '2026-09-28T09:00', history: [],
    });

    // Fake timers MUST be active when syncCollectionsToDb arms its 150 ms
    // debounce — a real timer installed before vi.useFakeTimers() never
    // advances and the sync never runs (the order bug this test shipped with).
    vi.useFakeTimers();
    syncCollectionsToDb({
      users: [], labs: [{ id: 'lab-1', name: 'Test Clinic', created_at: '2026-09-28T09:00' }],
      caseTypes: [],
      cases: [caseRow('case-1', 'DS-0001', [16, 16, 17]), caseRow('case-2', 'DS-0001', [])],
      invoices: [invoiceRow('inv-1', 'INV-0001', []), invoiceRow('inv-2', 'INV-0001', [])],
      advancePayments: [], accountAdjustments: [], journalEntries: [], reconciliationItems: [],
      notifications: [], savedVouchers: [], auditEvents: [], templates: [], labContacts: [],
      labAddresses: [], pricingOverrides: [], labReviews: [], caseNotes: {}, caseAttachments: {},
      qcInspections: [
        { id: 'qc-1', case_id: 'case-2', inspection_no: 1, kind: 'inspection', result: 'pass', inspector: 'T', dedupe_key: 'qc-case2-1', created_at: '2026-09-28T09:00' },
        { id: 'qc-2', case_id: 'case-gone', inspection_no: 1, kind: 'inspection', result: 'pass', inspector: 'T', dedupe_key: 'qc-orphan-1', created_at: '2026-09-28T09:00' },
      ],
      doctorPreferences: [],
    } as unknown as SyncCollections);

    vi.advanceTimersByTime(150);
    vi.useRealTimers();

    expect(getLastSyncError()).toBeNull();
    const caseNumbers = eng.all<{ n: string }>('SELECT case_number AS n FROM cases ORDER BY case_number').map((r) => r.n);
    expect(caseNumbers).toEqual(['DS-0001', 'DS-0001-D2']);
    const invoiceNumbers = eng.all<{ n: string }>('SELECT invoice_number AS n FROM invoices ORDER BY invoice_number').map((r) => r.n);
    expect(invoiceNumbers).toEqual(['INV-0001', 'INV-0001-D2']);
    const teeth = eng.all<{ n: number }>('SELECT tooth_number AS n FROM case_teeth ORDER BY tooth_number').map((r) => r.n);
    expect(teeth).toEqual([16, 17]);
    const qcCount = eng.all<{ n: number }>('SELECT COUNT(*) AS n FROM qc_inspections')[0].n;
    expect(qcCount).toBe(1);
  });
});
