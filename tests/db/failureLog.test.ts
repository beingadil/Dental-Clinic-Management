/**
 * @vitest-environment jsdom
 *
 * Audit D6: a failed save or sync was a `console.error` and nothing else. The
 * failure counter lived in a module variable, so it reset to a healthy-looking
 * zero on every launch, and nothing anywhere recorded WHY the write failed. The
 * clinic could not tell "the disk is full" from "one row violates a CHECK
 * constraint and every sync has been aborting since Tuesday".
 *
 * These tests pin the journal that closes that gap: causes are classified, the
 * counters and streaks are persisted, the log cannot itself throw, and the two
 * real failure paths (browser snapshot save, SQLite collection sync) land in it
 * with enough detail to act on.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { IDBFactory } from 'fake-indexeddb';

const REAL_IDB = new IDBFactory();

/** Controllable localStorage: a Map plus an optional character ceiling. */
function memStorage(limitChars = Number.POSITIVE_INFINITY) {
  const store = new Map<string, string>();
  let used = 0;
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const next = used - (store.get(k)?.length ?? 0) + v.length;
      if (next > limitChars) {
        const err = new Error(`exceeded the quota (${limitChars} chars)`);
        err.name = 'QuotaExceededError';
        throw err;
      }
      used = next;
      store.set(k, v);
    },
    removeItem: (k: string) => {
      used -= store.get(k)?.length ?? 0;
      store.delete(k);
    },
    clear: () => {
      store.clear();
      used = 0;
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
    used: () => used,
  };
  return storage;
}

async function freshEngine() {
  const SQL = await initSqlJs();
  const { SqliteEngine } = await import('../../src/db/engine');
  const eng = await SqliteEngine.create(SQL, null);
  eng.migrate();
  return eng;
}

beforeEach(() => {
  vi.resetModules();
  (globalThis as any).localStorage = memStorage();
  (globalThis as any).indexedDB = REAL_IDB;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('cause classification', () => {
  it('names the cause for every failure mode the app can actually hit', async () => {
    const { classifyFailure } = await import('../../src/db/failureLog');

    const quota = new Error('exceeded the quota');
    quota.name = 'QuotaExceededError';
    expect(classifyFailure(quota)).toBe('storage-full');

    // Safari and jsdom only set `code`; Chromium sets the name.
    expect(classifyFailure(Object.assign(new Error('x'), { code: 22 }))).toBe('storage-full');

    expect(classifyFailure(new Error('CHECK constraint failed: cases'))).toBe('data-constraint');
    expect(classifyFailure(new Error('UNIQUE constraint failed: payments.payment_number'))).toBe('data-constraint');
    expect(classifyFailure(new Error('FOREIGN KEY constraint failed'))).toBe('data-constraint');
    expect(classifyFailure(new Error('IndexedDB request failed'))).toBe('indexeddb');
    expect(classifyFailure(new Error('indexedDB snapshot write failed'))).toBe('indexeddb');
    expect(classifyFailure(new Error('Browser storage is full: 4.2 MB'))).toBe('storage-full');
    expect(classifyFailure(new Error('os error 112: there is not enough space on the disk'))).toBe('disk-io');
    expect(classifyFailure(new Error('something nobody has seen before'))).toBe('unknown');
  });
});

describe('persisted counters', () => {
  it('counts failures per operation and resets only the streak on success', async () => {
    const log = await import('../../src/db/failureLog');

    expect(log.recordFailure('save', new Error('boom')).streak).toBe(1);
    const second = log.recordFailure('save', new Error('boom'));
    expect(second).toMatchObject({ streak: 2, total: 2 });
    log.recordFailure('sync', new Error('UNIQUE constraint failed: cases.id'));

    let summary = log.getFailureSummary();
    expect(summary.save).toMatchObject({ streak: 2, total: 2 });
    expect(summary.sync).toMatchObject({ streak: 1, total: 1 });
    expect(summary.save.lastFailureAt).not.toBeNull();
    expect(summary.firstFailureAt).not.toBeNull();

    log.recordSuccess('save');

    summary = log.getFailureSummary();
    // The streak is a "failing right now" signal; the total is history.
    expect(summary.save.streak).toBe(0);
    expect(summary.save.total).toBe(2);
    expect(summary.save.lastSuccessAt).not.toBeNull();
    expect(summary.sync.streak).toBe(1);
  });

  it('survives a reload instead of resetting to zero', async () => {
    const first = await import('../../src/db/failureLog');
    first.recordFailure('save', new Error('disk full: quota exceeded'));
    first.recordFailure('sync', new Error('CHECK constraint failed: notifications'));

    // A reload throws the module away; only localStorage carries over.
    vi.resetModules();
    const second = await import('../../src/db/failureLog');
    const summary = second.getFailureSummary();

    expect(summary.save).toMatchObject({ streak: 1, total: 1, lastFailureAt: expect.any(String) });
    expect(summary.sync.total).toBe(1);
    expect(summary.recent).toHaveLength(2);
    expect(summary.recent[0].kind).toBe('sync'); // newest first
    expect(summary.firstFailureAt).not.toBeNull();
  });

  it('caps the journal and keeps the newest entries', async () => {
    const log = await import('../../src/db/failureLog');
    for (let i = 0; i < log.FAILURE_LOG_INFO.MAX_ENTRIES + 12; i++) {
      log.recordFailure('save', new Error(`failure ${i}`));
    }
    const summary = log.getFailureSummary();
    expect(summary.recent).toHaveLength(log.FAILURE_LOG_INFO.MAX_ENTRIES);
    expect(summary.save.total).toBe(log.FAILURE_LOG_INFO.MAX_ENTRIES + 12);
    expect(summary.recent[0].message).toBe(`failure ${log.FAILURE_LOG_INFO.MAX_ENTRIES + 11}`);
  });

  it('starts clean from a corrupt log rather than throwing', async () => {
    localStorage.setItem('dsw_persistence_failures', '{not json at all');
    const log = await import('../../src/db/failureLog');
    expect(() => log.getFailureSummary()).not.toThrow();
    expect(log.getFailureSummary().recent).toEqual([]);
    // And it is usable immediately after.
    expect(log.recordFailure('save', new Error('after corruption')).streak).toBe(1);
  });

  it('clears on demand', async () => {
    const log = await import('../../src/db/failureLog');
    log.recordFailure('save', new Error('boom'));
    log.clearFailureLog();
    const summary = log.getFailureSummary();
    expect(summary.recent).toEqual([]);
    expect(summary.save).toMatchObject({ streak: 0, total: 0 });
    expect(localStorage.getItem('dsw_persistence_failures')).toBeNull();
  });

  it('exports diagnostics that name the cause and the operation', async () => {
    const log = await import('../../src/db/failureLog');
    log.recordFailure('sync', new Error('UNIQUE constraint failed: payments.payment_number'));
    const text = log.exportFailureDiagnostics();
    expect(text).toContain('sync');
    expect(text).toContain('data-constraint');
    expect(text).toContain('UNIQUE constraint failed');
  });
});

describe('save failures reach the journal', () => {
  it('records a full-storage save with its cause, and clears it on the next good save', async () => {
    // No IndexedDB and a localStorage far too small: the legacy ceiling.
    (globalThis as any).indexedDB = undefined;
    (globalThis as any).localStorage = memStorage(1000);

    const eng = await freshEngine();
    const persistence = await import('../../src/db/persistence');
    const log = await import('../../src/db/failureLog');

    expect(await persistence.saveSnapshot(eng, { force: true })).toBe(false);
    expect(await persistence.saveSnapshot(eng, { force: true })).toBe(false);

    let summary = log.getFailureSummary();
    expect(summary.save.total).toBe(2);
    expect(summary.save.streak).toBe(2);
    expect(summary.recent[0].cause).toBe('storage-full');
    expect(summary.recent[0].message).toContain('.dentalbackup');
    // The panel shows where the data was headed and how big the snapshot was.
    expect(summary.recent[0].detail).toContain('backend=');
    expect(summary.recent[0].detail).toContain('snapshot=');
    // Not the raw DOMException the user used to see.
    expect(summary.recent[0].message).not.toContain("Failed to execute 'setItem'");

    // Now give it working storage: the next save must clear the streak while
    // keeping the history, and report where the snapshot actually landed.
    (globalThis as any).indexedDB = REAL_IDB;
    expect(await persistence.saveSnapshot(eng, { force: true })).toBe(true);

    summary = log.getFailureSummary();
    expect(summary.save.streak).toBe(0);
    expect(summary.save.total).toBe(2);
    expect(summary.save.lastSuccessAt).not.toBeNull();
    expect(persistence.getLastSaveBackend()).toBe('indexeddb');
    expect(persistence.getLastSnapshotBytes()).toBeGreaterThan(0);
  });
});

describe('sync failures reach the journal', () => {
  it('records the offending statement and its cause, then clears on a good sync', async () => {
    const eng = await freshEngine();
    const { setDatabase } = await import('../../src/db/core');
    setDatabase(eng);

    const { syncCollectionsToDb } = await import('../../src/db/syncCore');
    const log = await import('../../src/db/failureLog');

    const valid = {
      id: 'case-1', case_number: 'DS-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
      case_type_id: 'ct-1', case_type_name: 'Crown', doctor_name: 'Dr. Test',
      patient_name: 'Patient', selected_teeth: [16], status: 'received', priority: 'normal',
      price: 1000, discount: 0, final_price: 1000, delivery_date: '2026-10-01',
      created_at: '2026-09-28T09:00', updated_at: '2026-09-28T09:00', history: [],
    };
    const collections = (caseStatus: string) => ({
      users: [], labs: [{ id: 'lab-1', name: 'Test Clinic', created_at: '2026-09-28T09:00' }],
      caseTypes: [], cases: [{ ...valid, status: caseStatus }], invoices: [],
      advancePayments: [], accountAdjustments: [], journalEntries: [], notifications: [],
      auditEvents: [], reconciliationItems: [], savedVouchers: [], caseNotes: {},
      caseAttachments: {}, qcInspections: [], labContacts: [], labAddresses: [],
      pricingOverrides: [], labReviews: [], templates: [], doctorPreferences: [],
    });

    // `status` is a CHECK list in the schema. One value outside it aborts the
    // single transaction that writes EVERY table — the blast radius this log
    // exists to make visible.
    vi.useFakeTimers();
    syncCollectionsToDb(collections('not-a-real-status') as any);
    vi.advanceTimersByTime(150);

    let summary = log.getFailureSummary();
    expect(summary.sync.total).toBe(1);
    expect(summary.sync.streak).toBe(1);
    expect(summary.recent[0].kind).toBe('sync');
    expect(summary.recent[0].cause).toBe('data-constraint');
    expect(summary.recent[0].message).toContain('constraint');
    // SqliteEngine embeds the failing statement, which is what pinpoints the row.
    expect(summary.recent[0].message).toContain('[sql:');
    expect(summary.recent[0].message).toContain('cases');
    expect(summary.recent[0].detail).toContain('cases=1');

    // A corrected payload saves and clears the streak without erasing history.
    syncCollectionsToDb(collections('received') as any);
    vi.advanceTimersByTime(150);
    vi.useRealTimers();

    summary = log.getFailureSummary();
    expect(summary.sync.streak).toBe(0);
    expect(summary.sync.total).toBe(1);
    expect(eng.all<{ n: number }>('SELECT COUNT(*) AS n FROM cases')[0].n).toBe(1);
  });
});
