import { describe, it, expect, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { syncCollectionsToDb, type SyncCollections } from '../../src/db/syncCore';
import { getLastSyncError } from '../../src/db/syncCore';

/**
 * Regression: syncNow used to DELETE FROM labs while advance_payments /
 * account_adjustments (lab_id → labs, no cascade) still existed, aborting the
 * whole sync transaction with "FOREIGN KEY constraint failed". The full
 * collection payload (labs + cases + invoices + advances with allocations +
 * adjustments) must round-trip without error.
 */

function makeCollections(): SyncCollections {
  const lab = { id: 'lab-1', name: 'Test Clinic', created_at: '2026-09-28T09:00' };
  const kase = {
    id: 'case-1', case_number: 'DS-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
    case_type_id: 'ct-1', case_type_name: 'Crown', doctor_name: 'Dr. Test',
    patient_name: 'Patient', selected_teeth: [16], status: 'received', priority: 'normal',
    price: 1000, discount: 0, final_price: 1000, delivery_date: '2026-10-01',
    created_at: '2026-09-28T09:00', updated_at: '2026-09-28T09:00', history: [],
  };
  const invoice = {
    id: 'inv-1', invoice_number: 'INV-0001', case_id: 'case-1', case_number: 'DS-0001',
    lab_id: 'lab-1', lab_name: 'Test Clinic', case_type_name: 'Crown', doctor_name: 'Dr. Test',
    patient_name: 'Patient', amount: 1000, discount: 0, final_amount: 1000, amount_paid: 0,
    payment_status: 'unpaid', delivery_date: '2026-10-01', payments: [],
    created_at: '2026-09-28T09:00', updated_at: '2026-09-28T09:00',
  };
  return {
    users: [], labs: [lab], caseTypes: [], cases: [kase], invoices: [invoice],
    advancePayments: [{
      id: 'adv-1', payment_number: 'ADV-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
      amount: 500, allocated_amount: 0, remaining_amount: 500, payment_method: 'cash',
      payment_date: '2026-09-28', status: 'available', attachments: [],
      receipt_number: null, reference_number: null, notes: null, recorded_by: 'Test',
    }],
    accountAdjustments: [{
      id: 'adj-1', adjustment_number: 'CR-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
      type: 'credit_note', amount: 100, reason: 'test', date: '2026-09-28', status: 'posted',
      attachments: [], recorded_by: 'Test', approved_by: null,
      credit_note_number: null, invoice_id: null, invoice_number: null,
      reference_number: null, notes: null,
    }],
    journalEntries: [], notifications: [], auditEvents: [], reconciliationItems: [],
    savedVouchers: [], caseNotes: {}, caseAttachments: {}, qcInspections: [],
    labContacts: [], labAddresses: [], pricingOverrides: [], labReviews: [],
    templates: [], doctorPreferences: [],
  } as unknown as SyncCollections;
}

describe('syncCore FK ordering', () => {
  it('syncs labs with advances and adjustments without FK failure', async () => {
    const SQL = await initSqlJs();
    const eng = await SqliteEngine.create(SQL, null);
    eng.migrate();
    setDatabase(eng);

    // syncCollectionsToDb is debounced (150ms) — flush the timer synchronously.
    vi.useFakeTimers();
    expect(() => syncCollectionsToDb(makeCollections())).not.toThrow();
    vi.advanceTimersByTime(150);
    vi.useRealTimers();
    expect(getLastSyncError()).toBeNull();

    const labCount = eng.all<{ n: number }>('SELECT COUNT(*) AS n FROM labs')[0].n;
    const advCount = eng.all<{ n: number }>('SELECT COUNT(*) AS n FROM advance_payments')[0].n;
    const adjCount = eng.all<{ n: number }>('SELECT COUNT(*) AS n FROM account_adjustments')[0].n;
    expect({ labCount, advCount, adjCount }).toEqual({ labCount: 1, advCount: 1, adjCount: 1 });
  });
});
