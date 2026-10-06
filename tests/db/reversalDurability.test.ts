import { describe, it, expect, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { syncCollectionsToDb, getLastSyncError, type SyncCollections } from '../../src/db/syncCore';

/**
 * Regression: syncCore's whole-table rebuild (DELETE + INSERT per money table)
 * named every column except the reversal audit trail, so payments fell back to
 * is_reversed DEFAULT 0 and reversal_reason / reversed_at / reversed_by were
 * dropped entirely. A payment reversed by the operator read back as live money
 * one debounce window (400 ms) later, and the reason/actor were gone for good.
 */

const REVERSAL = {
  is_reversed: true,
  reversal_reason: 'Cheque bounced',
  reversed_at: '2026-09-28T11:00:00.000Z',
  reversed_by: 'Dr. Ayesha',
};

function makeCollections(): SyncCollections {
  return {
    users: [],
    labs: [{ id: 'lab-1', name: 'Test Clinic', created_at: '2026-09-28T09:00' }],
    caseTypes: [],
    cases: [],
    invoices: [
      {
        id: 'inv-1', invoice_number: 'INV-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
        amount: 1000, discount: 0, final_amount: 1000, amount_paid: 1000,
        payment_status: 'paid', status_v2: 'paid',
        created_at: '2026-09-28T09:00',
        payments: [
          {
            id: 'pay-1', payment_number: 'PAY-2026-0001', receipt_number: 'REC-1',
            amount: 1000, payment_method: 'cheque', payment_date: '2026-09-28',
            recorded_by: 'Tester', created_at: '2026-09-28T09:00', attachments: [],
            ...REVERSAL,
          },
        ],
      },
    ],
    advancePayments: [
      {
        id: 'adv-1', payment_number: 'ADV-2026-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
        amount: 500, allocated_amount: 0, remaining_amount: 500, payment_method: 'cash',
        payment_date: '2026-09-28', recorded_by: 'Tester', status: 'available',
        attachments: [], allocations: [], ...REVERSAL,
      },
    ],
    accountAdjustments: [
      {
        id: 'adj-1', adjustment_number: 'ADJ-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
        type: 'credit_note', amount: 200, reason: 'Wrong shade', date: '2026-09-28',
        recorded_by: 'Tester', status: 'posted', attachments: [], ...REVERSAL,
      },
    ],
    journalEntries: [], reconciliationItems: [], notifications: [], savedVouchers: [],
    auditEvents: [], templates: [], labContacts: [], labAddresses: [], pricingOverrides: [],
    labReviews: [], caseNotes: {}, caseAttachments: {}, qcInspections: [], doctorPreferences: [],
  } as unknown as SyncCollections;
}

async function synced() {
  const SQL = await initSqlJs();
  const eng = await SqliteEngine.create(SQL, null);
  eng.migrate();
  setDatabase(eng);
  vi.useFakeTimers();
  syncCollectionsToDb(makeCollections());
  vi.advanceTimersByTime(150);
  vi.useRealTimers();
  expect(getLastSyncError()).toBeNull();
  return eng;
}

describe('reversal audit trail survives the sync rebuild', () => {
  it('persists reversal columns for payments, advances and adjustments', async () => {
    const eng = await synced();
    const cols = 'is_reversed, reversal_reason, reversed_at, reversed_by';
    for (const table of ['payments', 'advance_payments', 'account_adjustments']) {
      const row = eng.get<any>(`SELECT ${cols} FROM ${table}`);
      expect(row, table).toBeTruthy();
      expect(row.is_reversed, table).toBe(1);
      expect(row.reversal_reason, table).toBe(REVERSAL.reversal_reason);
      expect(row.reversed_at, table).toBe(REVERSAL.reversed_at);
      expect(row.reversed_by, table).toBe(REVERSAL.reversed_by);
    }
  });

  it('does not decay the reversal trail across repeated saves', async () => {
    const SQL = await initSqlJs();
    const eng = await SqliteEngine.create(SQL, null);
    eng.migrate();
    setDatabase(eng);
    const cols = 'is_reversed, reversal_reason, reversed_at, reversed_by';

    for (let pass = 0; pass < 3; pass += 1) {
      vi.useFakeTimers();
      syncCollectionsToDb(makeCollections());
      vi.advanceTimersByTime(150);
      vi.useRealTimers();
      expect(getLastSyncError(), `pass ${pass}`).toBeNull();
      for (const table of ['payments', 'advance_payments', 'account_adjustments']) {
        const row = eng.get<any>(`SELECT ${cols} FROM ${table}`);
        expect(row.is_reversed, `${table} pass ${pass}`).toBe(1);
        expect(row.reversal_reason, `${table} pass ${pass}`).toBe(REVERSAL.reversal_reason);
        expect(row.reversed_by, `${table} pass ${pass}`).toBe(REVERSAL.reversed_by);
      }
    }
  });
});
