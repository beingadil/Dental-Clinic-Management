import { describe, it, expect, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { syncCollectionsToDb, getLastSyncError, type SyncCollections } from '../../src/db/syncCore';
import { MIGRATIONS } from '../../src/db/migrations';
import { runIntegrityCheck } from '../../src/db/integrityCheck';

/**
 * Regression: F4 — one attachment on an advance or adjustment killed ALL
 * persistence in the app.
 *
 * `payment_attachments` declared `FOREIGN KEY (payment_id) REFERENCES
 * payments(id)`, but the whole codebase stores advance/adjustment ids in
 * that column. syncCollectionsToDb runs every collection inside ONE
 * SAVEPOINT, so a single advance receipt raised "FOREIGN KEY constraint
 * failed", the savepoint rolled back, and nothing after that point in the
 * transaction (adjustments, notifications, vouchers, audit events,
 * templates, lab contacts/addresses/pricing/reviews) reached the database —
 * on every subsequent save, forever.
 *
 * Migration 016 makes the table what it always was (owner_type + cascade
 * triggers). These tests lock that in, together with the other foreign-key
 * landmines in the same function: pricing overrides pointed at case_types
 * before case_types were rewritten, and rows whose parent was missing from
 * state aborted the save instead of being skipped.
 */

const moneyState = (): SyncCollections =>
  ({
    users: [],
    labs: [{ id: 'lab-1', name: 'Test Clinic', created_at: '2026-09-28T09:00' }],
    caseTypes: [{ id: 'ct-1', name: 'Zirconia Crown', base_price: 900, created_at: '2026-09-28T09:00' }],
    cases: [],
    invoices: [],
    advancePayments: [
      {
        id: 'adv-1', payment_number: 'ADV-2026-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
        amount: 500, allocated_amount: 0, remaining_amount: 500, payment_method: 'cash',
        payment_date: '2026-09-28', recorded_by: 'Tester', status: 'available',
        allocations: [{ id: 'aa-1', invoice_id: 'inv-1', amount: 100 }],
        attachments: [
          { id: 'pa-adv', file_name: 'advance-receipt.pdf', file_type: 'application/pdf', file_size: '1024', file_url: 'data:application/pdf;base64,AA', uploaded_at: '2026-09-28T09:00' },
        ],
      },
    ],
    accountAdjustments: [
      {
        id: 'adj-1', adjustment_number: 'ADJ-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
        type: 'credit_note', amount: 100, reason: 'remake', date: '2026-09-28',
        recorded_by: 'Tester', status: 'posted',
        attachments: [
          { id: 'pa-adj', file_name: 'credit-note.pdf', file_type: 'application/pdf', file_size: '2048', file_url: 'data:application/pdf;base64,BB', uploaded_at: '2026-09-28T09:00' },
        ],
      },
    ],
    journalEntries: [],
    reconciliationItems: [],
    notifications: [{ id: 'n-1', type: 'system', title: 'Advance received', message: 'ok', created_at: '2026-09-28T09:00' }],
    savedVouchers: [], auditEvents: [], templates: [], labContacts: [], labAddresses: [],
    pricingOverrides: [
      { id: 'po-1', lab_id: 'lab-1', case_type_id: 'ct-1', case_type_name: 'Zirconia Crown', standard_price: 900, custom_price: 800, created_at: '2026-09-28T09:00' },
    ],
    labReviews: [], caseNotes: {}, caseAttachments: {}, qcInspections: [], doctorPreferences: [],
  } as unknown as SyncCollections);

async function freshEngine(): Promise<SqliteEngine> {
  const SQL = await initSqlJs();
  const eng = await SqliteEngine.create(SQL, null);
  eng.migrate();
  setDatabase(eng);
  return eng;
}

const flush = (state: SyncCollections) => {
  vi.useFakeTimers();
  syncCollectionsToDb(state);
  vi.advanceTimersByTime(150);
  vi.useRealTimers();
};

describe('F4 — money attachments no longer abort the whole sync', () => {
  it('persists an advance + adjustment that each carry a receipt', async () => {
    const eng = await freshEngine();

    const state = moneyState();
    (state.invoices as any[]).push({
      id: 'inv-1', invoice_number: 'INV-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
      amount: 900, discount: 0, final_amount: 900, amount_paid: 0,
      payment_status: 'unpaid', status_v2: 'open', created_at: '2026-09-28T09:00', payments: [],
    });
    flush(state);

    expect(getLastSyncError()).toBeNull();
    expect(eng.scalar('SELECT COUNT(*) FROM advance_payments')).toBe(1);
    expect(eng.scalar('SELECT COUNT(*) FROM account_adjustments')).toBe(1);
    // Everything synced after the money block landed too.
    expect(eng.scalar('SELECT COUNT(*) FROM notifications')).toBe(1);
    expect(eng.scalar('SELECT COUNT(*) FROM advance_allocations')).toBe(1);
    // The receipts themselves are readable by owner, not just present.
    expect(
      eng.all<{ owner_type: string; filename: string }>(
        'SELECT owner_type, filename FROM payment_attachments ORDER BY owner_type',
      ),
    ).toEqual([
      { owner_type: 'adjustment', filename: 'credit-note.pdf' },
      { owner_type: 'advance', filename: 'advance-receipt.pdf' },
    ]);
  });

  it('survives re-syncing the same state (no duplicate-id abort)', async () => {
    const eng = await freshEngine();
    const state = moneyState();
    (state.invoices as any[]).push({
      id: 'inv-1', invoice_number: 'INV-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
      amount: 900, discount: 0, final_amount: 900, amount_paid: 0,
      payment_status: 'unpaid', status_v2: 'open', created_at: '2026-09-28T09:00', payments: [],
    });
    flush(state);
    flush(state);
    flush(state);

    expect(getLastSyncError()).toBeNull();
    expect(eng.scalar('SELECT COUNT(*) FROM payment_attachments')).toBe(2);
    expect(eng.scalar('SELECT COUNT(*) FROM advance_payments')).toBe(1);
  });

  it('cascades attachments away with their owner document', async () => {
    const eng = await freshEngine();
    const state = moneyState();
    (state.invoices as any[]).push({
      id: 'inv-1', invoice_number: 'INV-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
      amount: 900, discount: 0, final_amount: 900, amount_paid: 0,
      payment_status: 'unpaid', status_v2: 'open', created_at: '2026-09-28T09:00', payments: [],
    });
    flush(state);
    expect(eng.scalar('SELECT COUNT(*) FROM payment_attachments')).toBe(2);

    eng.run('DELETE FROM advance_payments WHERE id = ?', ['adv-1']);
    expect(eng.scalar("SELECT COUNT(*) FROM payment_attachments WHERE owner_type = 'advance'")).toBe(0);
    expect(eng.scalar("SELECT COUNT(*) FROM payment_attachments WHERE owner_type = 'adjustment'")).toBe(1);
  });
});

describe('F4 — pricing overrides survive the catalog rewrite', () => {
  it('keeps a lab pricing override that points at a real case type', async () => {
    const eng = await freshEngine();

    flush(moneyState());
    flush(moneyState());

    expect(getLastSyncError()).toBeNull();
    expect(eng.scalar('SELECT COUNT(*) FROM lab_pricing_overrides')).toBe(1);
    expect(eng.scalar('SELECT custom_price FROM lab_pricing_overrides WHERE id = ?', ['po-1'])).toBe(800);
  });

  it('drops only the orphan override, never the whole table', async () => {
    const eng = await freshEngine();
    const state = moneyState();
    (state.pricingOverrides as any[]).push({
      id: 'po-2', lab_id: 'lab-1', case_type_id: 'ct-deleted', case_type_name: 'Gone',
      standard_price: 500, custom_price: 450, created_at: '2026-09-28T09:00',
    });

    flush(state);

    expect(getLastSyncError()).toBeNull();
    expect(eng.scalar('SELECT COUNT(*) FROM lab_pricing_overrides')).toBe(1);
  });
});

describe('F4 — rows with a missing parent are skipped, not fatal', () => {
  it('keeps the healthy rows when a case/invoice points at a deleted lab', async () => {
    const eng = await freshEngine();
    const state = moneyState();
    (state.invoices as any[]).push({
      id: 'inv-1', invoice_number: 'INV-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
      amount: 900, discount: 0, final_amount: 900, amount_paid: 0,
      payment_status: 'unpaid', status_v2: 'open', created_at: '2026-09-28T09:00', payments: [],
    });
    (state.cases as any[]).push({
      id: 'case-orphan', case_number: 'DS-0001', lab_id: 'lab-deleted', lab_name: 'Gone Lab',
      doctor_name: 'Dr. T', selected_teeth: [16], delivery_date: '2026-10-01', status: 'received',
      created_at: '2026-09-28T09:00', updated_at: '2026-09-28T09:00', history: [],
    });
    (state.cases as any[]).push({
      id: 'case-ok', case_number: 'DS-0002', lab_id: 'lab-1', lab_name: 'Test Clinic',
      doctor_name: 'Dr. T', selected_teeth: [17], delivery_date: '2026-10-01', status: 'received',
      created_at: '2026-09-28T09:00', updated_at: '2026-09-28T09:00', history: [],
    });

    flush(state);

    expect(getLastSyncError()).toBeNull();
    expect(eng.all<{ id: string }>('SELECT id FROM cases').map((r) => r.id)).toEqual(['case-ok']);
    expect(eng.scalar('SELECT COUNT(*) FROM advance_payments')).toBe(1);
    expect(eng.scalar('SELECT COUNT(*) FROM notifications')).toBe(1);
  });

  it('skips an advance allocation whose invoice is gone, keeps the rest of the advance', async () => {
    const eng = await freshEngine();

    flush(moneyState());

    expect(getLastSyncError()).toBeNull();
    expect(eng.scalar('SELECT COUNT(*) FROM advance_allocations')).toBe(0);
    expect(eng.scalar('SELECT COUNT(*) FROM advance_payments')).toBe(1);
  });

  it('degrades an unknown notification kind instead of aborting the save', async () => {
    const eng = await freshEngine();
    const state = moneyState();
    (state.notifications as any[]).push({
      id: 'n-2', type: 'retired_kind', title: 'Legacy alert', message: 'ok', created_at: '2026-09-28T09:00',
    });

    flush(state);

    expect(getLastSyncError()).toBeNull();
    expect(eng.scalar('SELECT COUNT(*) FROM notifications')).toBe(2);
    expect(eng.scalar("SELECT type FROM notifications WHERE id = 'n-2'")).toBe('system');
  });
});

describe('F4 — migration 016 shape', () => {
  it('ships through 016', () => {
    expect(MIGRATIONS.map((m) => m.version)).toContain(16);
    expect(MIGRATIONS[15].name).toBe('payment_attachment_owner');
  });

  it('reclassifies legacy rows and leaves no unattached proofs', async () => {
    const eng = await freshEngine();
    // Post-migration writes land through the owner_type default.
    eng.run(
      `INSERT INTO payment_attachments (id, owner_type, payment_id, filename, file_type, file_url, uploaded_at)
       VALUES ('pa-x', 'advance', 'adv-x', 'r.pdf', 'application/pdf', 'data:,x', '2026-09-28')`,
    );
    const report = runIntegrityCheck(eng);
    const owners = report.findings.find((f) => f.check === 'Money attachment owners');
    expect(owners?.ok).toBe(false);
    expect(owners?.detail).toContain('deleted money document');
  });
});