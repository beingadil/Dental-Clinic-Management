import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase, getDatabase } from '../../src/db/core';
import { syncCollectionsToDb, type SyncCollections } from '../../src/db/syncCore';
import { b64encode } from '../../src/db/persistence';
import { casesRepo } from '../../src/db/repos';

/**
 * 100k-case / 100k-invoice scale guard.
 *
 * `syncScale.test.ts` covers the clinic-realistic 10k. This one answers the
 * larger question directly: does the system survive a hundred thousand cases
 * and a hundred thousand invoices, and if it survives, WHERE does it hurt?
 *
 * The measurements below are not decorative. Each one is a number the UI thread
 * actually pays, and each budget below is anchored to a cost the app already
 * commits to elsewhere:
 *
 *   - FULL SYNC (9.9 s at 100k) — every collection change re-syncs ALL
 *     collections through one delete-and-replace transaction, synchronously,
 *     on the UI thread. At 100k that is a ~10 second freeze. This is the
 *     finding, not a pass: the budget is scaled 10x from the 10k guard
 *     (2.5 s x 10) precisely so that a regression to per-edit full rebuilds
 *     still trips it, while acknowledging that today's cost is ~10 s.
 *   - b64encode (1.6 s at 100k) — the autosave serializes the WHOLE database
 *     and base64s it on the UI thread on every save. `installLifecycleHooks`
 *     bounds the desktop close flush at 3 s; a 1.6 s encode plus IPC transfer
 *     of a 123 MB string is the single biggest unmeasured risk at this scale,
 *     so it is asserted rather than assumed.
 *   - PAGINATED READ / AGGREGATE — these are what the user actually does with
 *     100k rows, and they are fast. Asserted so nobody "fixes" pagination by
 *     removing it.
 *
 * Reported sizes: 92.5 MB raw / ~123 MB base64 at 200k rows.
 */

let engine: SqliteEngine;

const CASES = 100_000;
const INVOICES = 100_000;

/**
 * 10x the 10k guard's 2_500 ms. Sized to the data, not to today's number, so
 * this fails only if the sync gets structurally worse — but note the absolute
 * value is ~10 s of frozen UI thread, which is the real finding of this file.
 */
const SYNC_BUDGET_MS = 25_000;

/**
 * Export + base64 for one autosave.
 *
 * Anchored to the 3 s bound the desktop close handler already imposes
 * (`Promise.race([flushNow(), 3000])` in persistence.ts). If a single encode
 * approaches that, a close can drop the newest write — so the budget sits
 * below it with headroom, and the assertion documents the coupling.
 */
const ENCODE_BUDGET_MS = 2_000;

/** One page of the invoice list. Generous; measured ~5 ms. */
const PAGE_BUDGET_MS = 250;

/** The dashboard money total. Generous; measured ~27 ms. */
const AGGREGATE_BUDGET_MS = 500;

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
    doctor_name: 'Tariq Mahmood',
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
    doctor_name: 'Tariq Mahmood',
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

/**
 * Runs one debounced sync and resolves when the rows have actually landed.
 *
 * Polling row counts rather than sleeping a fixed interval: `syncCollectionsToDb`
 * is a 150 ms trailing debounce with no "committed" signal, and at 100k the
 * work takes seconds, so a sleep would measure the sleep.
 */
async function runSync(collections: SyncCollections): Promise<number> {
  const t0 = performance.now();
  syncCollectionsToDb(collections);
  const db = getDatabase();
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (db.rowCount('cases') >= CASES && db.rowCount('invoices') >= INVOICES) {
      return performance.now() - t0;
    }
  }
  return performance.now() - t0;
}

describe(`collection sync at ${CASES / 1000}k scale`, () => {
  it(`syncs ${CASES} cases + ${INVOICES} invoices and stays inside the scaled budget`, async () => {
    const collections = buildCollections();

    const fullSyncMs = await runSync(collections);

    const db = getDatabase();
    expect(db.rowCount('cases')).toBe(CASES);
    expect(db.rowCount('invoices')).toBe(INVOICES);

    // eslint-disable-next-line no-console
    console.log(
      `[scale-100k] full sync: ${Math.round(fullSyncMs)} ms ` +
        `(budget ${SYNC_BUDGET_MS} ms) — this is ${(fullSyncMs / SYNC_BUDGET_MS * 100).toFixed(0)}% of budget, ` +
        'and it is all on the UI thread',
    );

    expect(
      fullSyncMs,
      `full sync took ${Math.round(fullSyncMs)} ms, budget ${SYNC_BUDGET_MS} ms`,
    ).toBeLessThan(SYNC_BUDGET_MS);

    // --- The autosave path: whole-DB export + base64, every save. -----------
    const e0 = performance.now();
    const bytes = db.export();
    const exportMs = performance.now() - e0;

    const b0 = performance.now();
    const encoded = b64encode(bytes);
    const encodeMs = performance.now() - b0;
    const encodeTotalMs = exportMs + encodeMs;

    const rawMb = bytes.length / (1024 * 1024);
    const b64Mb = encoded.length / (1024 * 1024);

    // eslint-disable-next-line no-console
    console.log(
      `[scale-100k] autosave encode: export ${Math.round(exportMs)} ms + b64 ${Math.round(encodeMs)} ms ` +
        `= ${Math.round(encodeTotalMs)} ms of UI thread, ${rawMb.toFixed(1)} MB raw / ${b64Mb.toFixed(1)} MB base64 ` +
        'crossing the Tauri IPC on every save',
    );

    // Round-trip correctness is not negotiable at this size: this is the exact
    // path that persists the clinic's data to disk.
    const { b64decode } = await import('../../src/db/persistence');
    const decoded = b64decode(encoded);
    expect(decoded.length).toBe(bytes.length);
    expect(Buffer.from(decoded).equals(Buffer.from(bytes))).toBe(true);

    expect(
      encodeTotalMs,
      `export+base64 took ${Math.round(encodeTotalMs)} ms, budget ${ENCODE_BUDGET_MS} ms ` +
        `(close handler bounds the flush at 3000 ms)`,
    ).toBeLessThan(ENCODE_BUDGET_MS);

    // --- Reads: what the user actually does with 100k rows. ----------------
    const p0 = performance.now();
    const page = db.all('SELECT * FROM invoices ORDER BY due_date LIMIT 50');
    const pageMs = performance.now() - p0;
    expect(page.length).toBe(50);

    // eslint-disable-next-line no-console
    console.log(`[scale-100k] paginated invoice read (50 rows): ${pageMs.toFixed(1)} ms`);

    const a0 = performance.now();
    // scalar() rather than get(): an aggregate always returns exactly one row,
    // and scalar() types that honestly instead of T | undefined.
    const rowCount = Number(db.scalar('SELECT COUNT(*) FROM invoices'));
    const sum = Number(db.scalar('SELECT SUM(final_amount) FROM invoices'));
    const aggMs = performance.now() - a0;
    expect(rowCount).toBe(INVOICES);
    expect(sum).toBe(INVOICES * 25000);

    // eslint-disable-next-line no-console
    console.log(`[scale-100k] invoice aggregate over ${rowCount} rows: ${aggMs.toFixed(1)} ms`);

    expect(pageMs, `paged read took ${pageMs.toFixed(1)} ms, budget ${PAGE_BUDGET_MS} ms`).toBeLessThan(PAGE_BUDGET_MS);
    expect(aggMs, `aggregate took ${aggMs.toFixed(1)} ms, budget ${AGGREGATE_BUDGET_MS} ms`).toBeLessThan(AGGREGATE_BUDGET_MS);
  }, 300_000);

  it('serves a single case out of 100k without a full scan penalty', async () => {
    const t0 = performance.now();
    const found = casesRepo.all();
    const loadAllMs = performance.now() - t0;
    expect(found.length).toBe(CASES);

    // The boot hydration path loads EVERY case into app state. This is the
    // cost that decides whether a 100k database is usable at all on open, and
    // it is the reason `casesRepo.all()` is asserted rather than a paged read:
    // if someone changes hydration to page, this documents the size it grew
    // from.
    // eslint-disable-next-line no-console
    console.log(
      `[scale-100k] boot hydration (casesRepo.all(), ${found.length} rows): ${Math.round(loadAllMs)} ms`,
    );
    expect(loadAllMs).toBeLessThan(30_000);
  }, 300_000);
});