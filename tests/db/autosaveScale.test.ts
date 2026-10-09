import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase, getDatabase } from '../../src/db/core';
import { syncCollectionsToDb, type SyncCollections } from '../../src/db/syncCore';
import { b64encode } from '../../src/db/persistence';

/**
 * The autosave path, measured end to end.
 *
 * syncScale.test.ts covers the database write. It does NOT cover what the
 * desktop shell actually does with the bytes: export() -> base64 -> IPC. At
 * 10k cases + 10k invoices that snapshot is ~8.8 MB, which crosses the Tauri
 * IPC bridge as a ~11.8 MB JSON string, every 400 ms, on the UI thread. This
 * is the pipeline that froze and killed the window.
 */

let engine: SqliteEngine;

const CASES = 10_000;
const INVOICES = 10_000;

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

describe('autosave pipeline at clinic scale', () => {
  it('measures export + base64 + IPC-shaped structured clone', async () => {
    syncCollectionsToDb(buildCollections());
    await new Promise((r) => setTimeout(r, 400));

    const db = getDatabase();
    expect(db.rowCount('cases')).toBe(CASES);
    expect(db.rowCount('invoices')).toBe(INVOICES);

    const e0 = performance.now();
    const bytes = db.export();
    const exportMs = performance.now() - e0;

    const b0 = performance.now();
    const encoded = b64encode(bytes);
    const b64Ms = performance.now() - b0;

    // Tauri IPC serializes the argument to JSON. Clone the 11.8 MB string to
    // stand in for that; it is the part that spikes memory on the UI thread.
    const c0 = performance.now();
    JSON.parse(JSON.stringify({ bytesB64: encoded }));
    const cloneMs = performance.now() - c0;

    const mb = bytes.length / (1024 * 1024);
    // eslint-disable-next-line no-console
    console.log(
      `[autosave] export ${Math.round(exportMs)} ms | base64 ${Math.round(b64Ms)} ms | ` +
        `ipc-clone ${Math.round(cloneMs)} ms | total ${Math.round(exportMs + b64Ms + cloneMs)} ms\n` +
        `[autosave] ${mb.toFixed(1)} MB raw -> ${(encoded.length / 1024 / 1024).toFixed(1)} MB base64 ` +
        `(every 400 ms while dirty)`,
    );

    // A debounce window is 400 ms. If one autosave costs more than that, the
    // next edit lands mid-encode and the backlog compounds without bound.
    const perSaveMs = exportMs + b64Ms + cloneMs;
    expect(
      perSaveMs,
      `one autosave costs ${Math.round(perSaveMs)} ms, which exceeds the 400 ms debounce`,
    ).toBeLessThan(400);
  }, 120_000);
});