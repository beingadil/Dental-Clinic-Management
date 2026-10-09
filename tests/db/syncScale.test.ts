import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase, getDatabase } from '../../src/db/core';
import { syncCollectionsToDb, type SyncCollections } from '../../src/db/syncCore';

/**
 * Scale guard for the write-through sync.
 *
 * The app re-syncs ALL collections through one delete-and-replace transaction
 * whenever any collection changes. At a clinic-realistic 10k cases + 10k
 * invoices that transaction issues tens of thousands of synchronous statements
 * on the UI thread (sql.js is WebAssembly on the main thread), which is what
 * made the desktop window freeze and get killed during ordinary editing.
 *
 * The budget below is deliberately generous — it is a "the main thread is not
 * being held hostage" tripwire, not a benchmark. It fails loudly if someone
 * reintroduces a per-edit full rebuild at this scale.
 */

let engine: SqliteEngine;

/** Rows per collection used for the scale run. */
const CASES = 10_000;
const INVOICES = 10_000;

/** Main-thread budget for one full sync at 10k/10k, in ms. */
const SYNC_BUDGET_MS = 2_500;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
});

function buildCollections(): SyncCollections {
  const labs = [{ id: 'lab-1', name: 'Bench Lab', code: 'BL', address: '', city: '', phone: '', email: '' }];

  const cases = Array.from({ length: CASES }, (_, i) => ({
    id: `case-${i}`,
    case_number: `DS-${100000 + i}`,
    patient_name: `Patient ${i}`,
    lab_id: 'lab-1',
    lab_name: 'Bench Lab',
    doctor_name: `Dr. Who`,
    units_count: 3,
    selected_teeth: [16, 26, 36],
    tooth_details: { 16: { shade: 'A2' }, 26: { shade: 'A2' }, 36: { shade: 'A2' } },
    delivery_date: '2026-10-01',
    received_date: '2026-09-25',
    priority: 'normal',
    price: 25000,
    discount: 0,
    final_price: 25000,
    status: 'in_progress',
    created_at: '2026-09-25 10:00',
    updated_at: '2026-09-25 10:00',
    history: [{ id: `h-${i}`, status: 'received', notes: '', timestamp: '2026-09-25 10:00', updated_by: 'seed' }],
  }));

  const invoices = Array.from({ length: INVOICES }, (_, i) => ({
    id: `inv-${i}`,
    invoice_number: `INV-${100000 + i}`,
    case_id: `case-${i}`,
    case_number: `DS-${100000 + i}`,
    lab_id: 'lab-1',
    lab_name: 'Bench Lab',
    doctor_name: 'Dr. Who',
    patient_name: `Patient ${i}`,
    amount: 25000,
    discount: 0,
    final_amount: 25000,
    amount_paid: 0,
    payment_status: 'unpaid',
    status_v2: 'open',
    issue_date: '2026-09-25',
    due_date: '2026-10-25',
    created_at: '2026-09-25 10:00',
    payments: [],
  }));

  return {
    cases,
    labs,
    caseTypes: [],
    invoices,
    advancePayments: [],
    accountAdjustments: [],
    journalEntries: [],
    reconciliationItems: [],
    notifications: [],
    savedVouchers: [],
    auditEvents: [],
    templates: [],
    labContacts: [],
    labAddresses: [],
    pricingOverrides: [],
    labReviews: [],
    doctorPreferences: [],
    caseNotes: {},
    caseAttachments: {},
    qcInspections: [],
  };
}

/** Runs one debounced sync and resolves once the debounce window has elapsed. */
function runSync(collections: SyncCollections): Promise<void> {
  syncCollectionsToDb(collections);
  // syncCollectionsToDb is a 150 ms trailing debounce; nothing is exposed for
  // "committed", so the counts below are what actually assert it happened.
  return new Promise((resolve) => setTimeout(resolve, 400));
}

describe('collection sync at clinic scale', () => {
  it(`syncs ${CASES} cases + ${INVOICES} invoices inside the main-thread budget`, async () => {
    const collections = buildCollections();

    const t0 = performance.now();
    await runSync(collections);
    const fullSyncMs = performance.now() - t0;

    // Sanity: the sync actually wrote the rows it claimed to.
    const db = getDatabase();
    expect(db.rowCount('cases')).toBe(CASES);
    expect(db.rowCount('invoices')).toBe(INVOICES);

    // eslint-disable-next-line no-console
    console.log(`[scale] full sync of ${CASES}+${INVOICES} rows: ${Math.round(fullSyncMs)} ms`);

    // The snapshot path that runs on every autosave: export() serializes the
    // WHOLE database, then it is base64'd and shipped over the Tauri IPC
    // bridge. Measure it too — this is the path that repeats every 400 ms.
    const e0 = performance.now();
    const bytes = db.export();
    const exportMs = performance.now() - e0;
    const mb = bytes.length / (1024 * 1024);
    // eslint-disable-next-line no-console
    console.log(
      `[scale] snapshot: export ${Math.round(exportMs)} ms, ` +
        `${mb.toFixed(1)} MB raw, ~${(bytes.length / 1024 / 1024 * 4 / 3).toFixed(1)} MB as base64`,
    );

    expect(
      fullSyncMs,
      `full sync took ${Math.round(fullSyncMs)} ms, budget ${SYNC_BUDGET_MS} ms`,
    ).toBeLessThan(SYNC_BUDGET_MS);
  }, 120_000);
});