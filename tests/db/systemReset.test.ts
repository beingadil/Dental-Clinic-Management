import { describe, it, expect, vi, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { getDatabase, setDatabase } from '../../src/db/core';
import { syncCollectionsToDb, getLastSyncError, type SyncCollections } from '../../src/db/syncCore';
import { runIntegrityCheck } from '../../src/db/integrityCheck';
import { WIPE_EXPLICIT_TABLES } from '../../src/context/hooks/useAuthDomain';
import { seedDatabase } from '../../src/db/seeds';
import { INITIAL_CASE_TYPES } from '../../src/data/initialData';

/**
 * Regression: "the system reset failed on the other PC".
 *
 * `wipeAllData()` does exactly two things to SQLite: it deletes the seven
 * tables the collection sync does not own, and it empties every React
 * collection so the debounced write-through rebuild rewrites the rest. If any
 * table in the database survives that pair, the operator resets, reloads, and
 * sees yesterday's patients / money / ledger back — and if the rebuild aborts,
 * persistence is dead for the whole profile with no visible error.
 *
 * So this test fills EVERY table the app writes with realistic rows, performs
 * the reset exactly as wipeAllData performs it, and then asserts two things:
 * the reset must not abort, and no business row may survive it.
 */

const TS = '2026-09-28T09:00:00.000Z';

/** One populated collection set touching every table the sync owns. */
function populatedCollections(): SyncCollections {
  const lab = { id: 'lab-1', name: 'Test Clinic', code: 'TC', created_at: TS };
  const kase = {
    id: 'case-1', case_number: 'DS-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
    case_type_id: 'ct-fixture', case_type_name: 'Crown', doctor_name: 'Dr. Test', department: 'Prosthodontics',
    patient_name: 'Patient', selected_teeth: [16, 26], tooth_details: { 16: { shade: 'A2' } },
    status: 'received', priority: 'normal', price: 1000, discount: 0, final_price: 1000,
    delivery_date: '2026-10-01', created_at: TS, updated_at: TS,
    history: [{ id: 'h-1', status: 'received', notes: 'arrived', timestamp: TS, updated_by: 'Admin' }],
  };
  const journal = {
    id: 'je-1', journal_number: 'JE-0001', date: '2026-09-28', event_type: 'invoice_issued',
    reference_type: 'invoice', reference_id: 'inv-1', reference_number: 'INV-0001',
    lab_id: 'lab-1', lab_name: 'Test Clinic', case_id: 'case-1', case_number: 'DS-0001',
    description: 'Invoice issued', created_at: TS, created_by: 'Admin',
    lines: [
      { id: 'jl-1', account_code: '1200', account_name: 'Accounts Receivable', account_type: 'asset', debit: 1000, credit: 0, description: 'AR' },
      { id: 'jl-2', account_code: '4000', account_name: 'Revenue', account_type: 'revenue', debit: 0, credit: 1000, description: 'Revenue' },
    ],
  };
  const invoice = {
    id: 'inv-1', invoice_number: 'INV-0001', case_id: 'case-1', case_number: 'DS-0001',
    lab_id: 'lab-1', lab_name: 'Test Clinic', case_type_name: 'Crown', doctor_name: 'Dr. Test',
    patient_name: 'Patient', amount: 1000, discount: 0, final_amount: 1000, amount_paid: 500,
    payment_status: 'partial', status_v2: 'partially_paid', issue_date: '2026-09-28',
    due_date: '2026-10-28', journal_id: 'je-1', created_at: TS, updated_at: TS,
    items: [{ id: 'ii-1', description: 'Crown', quantity: 1, unit_price: 1000, total_price: 1000 }],
    payments: [{
      id: 'pmt-1', payment_number: 'PAY-0001', invoice_id: 'inv-1', invoice_number: 'INV-0001',
      case_id: 'case-1', case_number: 'DS-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
      amount: 500, payment_method: 'cash', payment_date: '2026-09-28', recorded_by: 'Admin',
      payment_type: 'invoice_payment', journal_id: 'je-1', created_at: TS,
      attachments: [{ id: 'pa-1', file_name: 'receipt.pdf', file_type: 'application/pdf', file_url: 'blob:receipt' }],
      allocations: [{ id: 'alloc-1', invoice_id: 'inv-1', invoice_number: 'INV-0001', amount: 500, allocated_at: TS }],
    }],
  };
  return {
    // A real profile's price list: the shipped defaults plus one clinic-added
    // service. The sync owns case_types wholesale (it DELETEs and rewrites the
    // table), so this is the only way the catalog can reach the database.
    caseTypes: [
      ...INITIAL_CASE_TYPES,
      { id: 'ct-fixture', name: 'Crown', base_price: 1000, category: 'crown_bridge', created_at: TS },
    ],
    labs: [lab],
    cases: [kase],
    invoices: [invoice],
    advancePayments: [{
      id: 'adv-1', payment_number: 'ADV-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
      amount: 500, allocated_amount: 0, remaining_amount: 500, payment_method: 'cash',
      payment_date: '2026-09-28', status: 'available', recorded_by: 'Admin', created_at: TS,
      allocations: [{ id: 'aa-1', invoice_id: 'inv-1', amount: 500, allocated_at: TS, allocated_by: 'Admin' }],
      attachments: [{ id: 'pa-2', file_name: 'advance.pdf', file_type: 'application/pdf', file_url: 'blob:advance' }],
    }],
    accountAdjustments: [{
      id: 'adj-1', adjustment_number: 'CR-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
      type: 'credit_note', amount: 100, reason: 'test', date: '2026-09-28', status: 'posted',
      recorded_by: 'Admin', created_at: TS,
      attachments: [{ id: 'pa-3', file_name: 'credit.pdf', file_type: 'application/pdf', file_url: 'blob:credit' }],
    }],
    journalEntries: [journal],
    reconciliationItems: [{
      id: 'rec-1', payment_id: 'pmt-1', reference_number: 'PAY-0001', method: 'bank',
      amount: 500, date: '2026-09-28', lab_id: 'lab-1', lab_name: 'Test Clinic',
      invoice_id: 'inv-1', invoice_number: 'INV-0001', status: 'matched', created_at: TS,
    }],
    notifications: [{
      id: 'ntf-1', type: 'overdue_case', title: 'Overdue', message: 'Case overdue',
      case_id: 'case-1', case_number: 'DS-0001', created_at: TS,
    }],
    auditEvents: [{
      id: 'aud-1', timestamp: TS, actor: 'Admin', action: 'create', entity_type: 'case',
      entity_id: 'case-1', entity_ref: 'DS-0001', new_state: { status: 'received' },
    }],
    savedVouchers: [{
      id: 'sv-1', voucher_number: 'VOU-0001', voucher_type: 'job_slip', case_id: 'case-1',
      case_number: 'DS-0001', lab_name: 'Test Clinic', amount: 500, saved_by: 'Admin', created_at: TS,
    }],
    templates: [{
      id: 'tpl-1', template_name: 'Full Crown', case_type_id: 'ct-fixture', case_type_name: 'Crown',
      selected_teeth: [16], default_priority: 'normal', created_at: TS,
    }],
    labContacts: [{ id: 'lc-1', lab_id: 'lab-1', name: 'Contact', phone: '0300', role: 'owner', is_primary: true, created_at: TS }],
    labAddresses: [{ id: 'la-1', lab_id: 'lab-1', type: 'lab_location', street: '1 St', city: 'Lahore', is_default: true, created_at: TS }],
    pricingOverrides: [{ id: 'po-1', lab_id: 'lab-1', case_type_id: 'ct-fixture', case_type_name: 'Crown', standard_price: 1000, custom_price: 900, created_at: TS }],
    labReviews: [{ id: 'lr-1', lab_id: 'lab-1', rating: 5, review_text: 'Great', reviewer_name: 'Admin', created_at: TS }],
    doctorPreferences: [{ id: 'dp-1', doctor_name: 'Dr. Test', lab_id: 'lab-1', lab_name: 'Test Clinic', created_at: TS }],
    caseNotes: { 'case-1': [{ id: 'note-1', note_text: 'Shade A2', author: 'Admin', created_at: TS }] },
    caseAttachments: { 'case-1': [{ id: 'att-1', filename: 'scan.png', file_type: 'image/png', file_url: 'blob:scan', size_bytes: 2048, uploaded_by: 'Admin' }] },
    qcInspections: [{ id: 'qc-1', case_id: 'case-1', case_number: 'DS-0001', kind: 'inspection', result: 'pass', inspector: 'Admin', created_at: TS }],
  } as unknown as SyncCollections;
}/**
 * The post-reset state: every business collection emptied by wipeAllData, with
 * the service catalog deliberately left populated — restoreConfigAfterReset
 * puts it straight back into state, so the sync that follows rewrites the same
 * price list rather than an empty one.
 */
function emptyCollections(): SyncCollections {
  return {
    // restoreConfigAfterReset reads the WHOLE surviving catalog back out of the
    // database, so the state it returns carries every row, not just the fixture's.
    // restoreConfigAfterReset reads the WHOLE surviving catalog back out of the
    // database and puts it into state, so the sync that follows rewrites the same
    // price list rather than an empty one.
    caseTypes: populatedCollections().caseTypes,
    labs: [], cases: [], invoices: [], advancePayments: [], accountAdjustments: [],
    journalEntries: [], reconciliationItems: [], notifications: [], auditEvents: [], savedVouchers: [],
    templates: [], labContacts: [], labAddresses: [], pricingOverrides: [], labReviews: [],
    doctorPreferences: [], caseNotes: {}, caseAttachments: {}, qcInspections: [],
  } as unknown as SyncCollections;
}

/** Schedule the debounced sync and flush it inside the same fake-timer window. */
function syncNow(collections: SyncCollections): void {
  vi.useFakeTimers();
  try {
    syncCollectionsToDb(collections);
    vi.runAllTimers();
  } finally {
    vi.useRealTimers();
  }
}

/** A migrated + first-boot-seeded engine, exactly what the app boots with. */
async function bootEngine(): Promise<SqliteEngine> {
  const SQL = await initSqlJs();
  const eng = await SqliteEngine.create(SQL, null);
  eng.migrate();
  setDatabase(eng);
  await seedDatabase();
  return eng;
}

function count(eng: SqliteEngine, table: string): number {
  return eng.all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
}

/** Every table a system reset must leave empty. */
const MUST_BE_EMPTY = [
  'labs', 'cases', 'case_teeth', 'case_status_history', 'case_notes', 'qc_inspections',
  'attachments', 'invoices', 'invoice_items', 'payments', 'payment_attachments',
  'payment_allocations', 'advance_payments', 'advance_allocations', 'account_adjustments',
  'journal_entries', 'journal_lines', 'reconciliation_items', 'saved_vouchers', 'notifications',
  'audit_events', 'case_templates', 'lab_contacts', 'lab_addresses', 'lab_pricing_overrides',
  'lab_reviews', 'doctor_preferred_labs', 'chairside_appointments',
  'notification_config', 'email_templates',
];

/**
 * Clinic configuration a reset must KEEP, with the price list intact. These are
 * not business data: a reset that deleted them left the Catalog and the
 * Odontogram empty until the next app start, and the operator had to rebuild a
 * priceable clinic from memory to invoice anything.
 */
const MUST_SURVIVE = [
  'case_types', 'clinical_materials', 'clinical_prep_types', 'shade_guides', 'implant_brands',
];

describe('system reset on a populated database', () => {
  let eng: SqliteEngine;

  beforeEach(async () => {
    eng = await bootEngine();
  });

  it('fills every business table before the reset', () => {
    syncNow(populatedCollections());
    expect(getLastSyncError()).toBeNull();

    // Baseline: the fixture must actually be populated, otherwise the wipe
    // assertions below would pass vacuously.
    const SEEDED_NOT_SYNCED = ['notification_config', 'email_templates'];
    const populated = MUST_BE_EMPTY.filter((t) => count(eng, t) > 0 && !SEEDED_NOT_SYNCED.includes(t));
    expect(populated.length).toBeGreaterThan(15);
  });

  it('keeps payment allocations across an ordinary autosave round-trip', () => {
    syncNow(populatedCollections());
    expect(getLastSyncError()).toBeNull();
    expect(count(eng, 'payment_allocations')).toBe(1);

    // Second sync of the same state: the rebuild must not duplicate them either.
    syncNow(populatedCollections());
    expect(getLastSyncError()).toBeNull();
    expect(count(eng, 'payment_allocations')).toBe(1);
    expect(eng.get<{ source_id: string }>('SELECT source_id FROM payment_allocations')!.source_id).toBe('pmt-1');
  });

  it('resets without aborting the sync and leaves no business row behind', () => {
    // ── populate ──
    syncNow(populatedCollections());
    expect(getLastSyncError()).toBeNull();

    // The repo layer writes payment_allocations through its own path
    // (paymentsRepo.insert) — mirror that here so the reset is exercised against
    // a database that has one populated. (The old ledger_entries mirror is gone:
    // migration 022 dropped the table.)
    const db = getDatabase();
    db.run(
      `INSERT OR IGNORE INTO payment_allocations (id, source_type, source_id, source_ref, invoice_id, invoice_number, amount, allocated_at, allocated_by, notes)
       VALUES ('alloc-legacy', 'payment', 'pmt-1', 'PAY-0001', 'inv-1', 'INV-0001', 500, ?, 'Admin', NULL)`,
      [TS]
    );

    // What the operator had BEFORE the reset: the boot-seeded catalog plus the
    // fixture's row. Both must be there afterwards.
    const catalogBefore = eng.all<{ id: string }>('SELECT id FROM case_types ORDER BY id');

    // ── reset, exactly as wipeAllData does it ──
    db.withTransaction((tx) => {
      for (const table of WIPE_EXPLICIT_TABLES) {
        try { tx.run(`DELETE FROM ${table}`); } catch { /* absent in this profile */ }
      }
    });
    syncNow(emptyCollections());

    // (a) the reset must not abort persistence
    expect(getLastSyncError()).toBeNull();
    expect(runIntegrityCheck(eng).ok).toBe(true);

    // (b) nothing business-shaped may survive it
    const survivors = MUST_BE_EMPTY.filter((t) => count(eng, t) > 0);
    expect(survivors).toEqual([]);

    // (b2) …but the price list and the clinical references it depends on must.
    // These are the rows boot-time seeding put there, so "survived" is exact:
    // the same set, not a rebuilt approximation.
    for (const table of MUST_SURVIVE) {
      expect(count(eng, table), `${table} survived the reset`).toBeGreaterThan(0);
    }
    expect(eng.all<{ id: string }>('SELECT id FROM case_types ORDER BY id')).toEqual(catalogBefore);

    // (c) and the money still adds up on the empty ledger
    expect(Number(eng.scalar('SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) FROM journal_lines'))).toBe(0);
  });
});