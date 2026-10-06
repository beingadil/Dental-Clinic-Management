/**
 * @vitest-environment jsdom
 *
 * Audit F7 — the failure the user actually saw, reproduced at real size.
 *
 * The browser snapshot used to live in localStorage, whose origin quota is
 * ~5 MB, and base64 inflates the database by 4/3. A real clinic database
 * therefore crossed the ceiling at roughly 3.7 MB of SQLite bytes, and from
 * that point on EVERY save threw QuotaExceededError while the 5 s checkpoint
 * kept re-encoding the whole multi-megabyte database — persistence dead and the
 * UI visibly slowing down.
 *
 * This is a drill, not a unit test: it GROWS a real database past that ceiling,
 * proves the legacy path genuinely cannot hold it, then proves the app survives
 * anyway — the IndexedDB snapshot saves, reloads intact, and is still writable
 * afterwards. If the ceiling ever moves back into the save path, this fails.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { IDBFactory } from 'fake-indexeddb';

const REAL_IDB = new IDBFactory();

/** The legacy ceiling, as Chromium/Firefox enforce it: 5 MiB of UTF-16. */
const LEGACY_QUOTA_BYTES = 5 * 1024 * 1024;

/** localStorage shim that meters storage the way a browser does (2 bytes/char). */
function legacyStorage(quotaBytes = LEGACY_QUOTA_BYTES) {
  const store = new Map<string, string>();
  let used = 0;
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const next = used - (store.get(k)?.length ?? 0) * 2 + v.length * 2;
      if (next > quotaBytes) {
        const err = new Error('QuotaExceededError: the quota has been exceeded.');
        err.name = 'QuotaExceededError';
        throw err;
      }
      used = next;
      store.set(k, v);
    },
    removeItem: (k: string) => {
      used -= (store.get(k)?.length ?? 0) * 2;
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
    bytesUsed: () => used,
    quotaBytes,
  };
}

/** A clinic-sized database: the audit trail is the table that really grows. */
async function growDatabase(rows: number) {
  const SQL = await initSqlJs();
  const { SqliteEngine } = await import('../../src/db/engine');
  const { setDatabase } = await import('../../src/db/core');
  const eng = await SqliteEngine.create(SQL, null);
  eng.migrate();
  setDatabase(eng);

  const filler = 'x'.repeat(900);
  eng.transaction((tx) => {
    for (let i = 0; i < rows; i++) {
      tx.run(
        `INSERT INTO audit_events (id, timestamp, actor, action, entity_type, entity_id, reason, old_state, new_state, notes)
         VALUES (?, ?, 'Dr. Test', 'case.updated', 'case', ?, 'clinical note', ?, ?, ?)`,
        [
          `ae-${i}`,
          new Date(Date.UTC(2026, 0, 1, 0, 0, i % 86400)).toISOString(),
          `case-${i}`,
          JSON.stringify({ note: filler }),
          JSON.stringify({ note: filler }),
          filler,
        ],
      );
    }
  });
  return eng;
}

/** A content fingerprint that does not depend on SQLite page layout. */
interface Fingerprintable {
  all: <T = Record<string, any>>(sql: string) => T[];
  rowCount: (t: string) => number;
}

function fingerprint(eng: Fingerprintable) {
  const tables = [
    'audit_events', 'cases', 'labs', 'invoices', 'payments', 'advance_payments',
    'account_adjustments', 'journal_entries', 'notifications', 'case_notes',
    'attachments', 'qc_inspections', 'case_status_history',
  ];
  const counts = tables.map((t) => `${t}=${eng.rowCount(t)}`);
  const sample = eng.all<{ n: number; len: number }>(
    'SELECT COUNT(*) AS n, SUM(LENGTH(notes)) AS len FROM audit_events',
  )[0];
  return `${counts.join(',')}|notes=${sample.n}/${sample.len}`;
}

beforeEach(() => {
  vi.resetModules();
  (globalThis as any).localStorage = legacyStorage();
  (globalThis as any).indexedDB = REAL_IDB;
  REAL_IDB.deleteDatabase('dsw_sqlite');
});

describe('quota-exhaustion drill', () => {
  it('holds, reloads and keeps writing a database larger than the legacy ceiling', async () => {
    const eng = await growDatabase(4000);

    const raw = eng.export();
    const encodedLength = Math.ceil(raw.length / 3) * 4 + 6; // base64 + "DSDB1:" header

    // --- the premise of the drill -------------------------------------------
    // This database is past the point where the old storage could hold it. If
    // this ever stops being true the drill is no longer testing anything.
    expect(raw.length).toBeGreaterThan(3.9 * 1024 * 1024);
    expect(encodedLength * 2).toBeGreaterThan(LEGACY_QUOTA_BYTES);

    const before = fingerprint(eng);
    const { saveSnapshot, loadSnapshot, getLastSaveError } = await import('../../src/db/persistence');
    const { getFailureSummary } = await import('../../src/db/failureLog');

    // --- 1. the legacy path genuinely cannot hold it ------------------------
    (globalThis as any).indexedDB = undefined;
    expect(await saveSnapshot(eng, { force: true })).toBe(false);
    expect(localStorage.getItem('dsw_sqlite_snapshot')).toBeNull();
    // localStorage holds bookkeeping only (the dirty flag and the failure
    // journal) — never the 16 MB database, not even a fragment of it.
    const keys = Array.from({ length: localStorage.length }, (_, i) => String(localStorage.key(i)));
    expect(keys).not.toContain('dsw_sqlite_snapshot');
    for (const key of keys) expect(['dsw_persistence_failures', 'dsw_sqlite_dirty']).toContain(key);
    expect(localStorage.bytesUsed()).toBeLessThan(50_000);
    expect(getLastSaveError()).toContain('storage is full');
    expect(getFailureSummary().recent[0].cause).toBe('storage-full');

    // --- 2. IndexedDB holds the same snapshot ------------------------------
    (globalThis as any).indexedDB = REAL_IDB;
    expect(await saveSnapshot(eng, { force: true })).toBe(true);
    expect(getFailureSummary().save.streak).toBe(0);

    const bytes = await loadSnapshot();
    expect(bytes).not.toBeNull();
    expect(bytes!.length).toBe(raw.length);

    // --- 3. it reloads as the same database --------------------------------
    const SQL = await initSqlJs();
    const { SqliteEngine } = await import('../../src/db/engine');
    const restored = await SqliteEngine.create(SQL, bytes!);
    expect(restored.scalar('PRAGMA integrity_check')).toBe('ok');
    expect(fingerprint(restored)).toBe(before);

    // --- 4. and the app is still fully writable after the reload -----------
    restored.run(
      "INSERT INTO audit_events (id, timestamp, actor, action, entity_type, entity_id) VALUES ('ae-after-reload', '2026-10-06T10:00:00.000Z', 'Dr. Test', 'case.created', 'case', 'case-new')",
    );
    const { setDatabase } = await import('../../src/db/core');
    setDatabase(restored);
    expect(await saveSnapshot(restored, { force: true })).toBe(true);

    const again = await loadSnapshot();
    const second = await SqliteEngine.create(SQL, again!);
    expect(second.rowCount('audit_events')).toBe(4001);
  }, 120_000);

  it('stops re-encoding a multi-megabyte database on every checkpoint while saves fail', async () => {
    const eng = await growDatabase(4000);
    (globalThis as any).indexedDB = undefined;

    const { saveSnapshot } = await import('../../src/db/persistence');
    const exportSpy = vi.spyOn(eng, 'export');

    // Two failing writes establish the streak (the first is allowed through,
    // the second is inside the 1 s backoff window but forced).
    expect(await saveSnapshot(eng, { force: true })).toBe(false);
    expect(await saveSnapshot(eng, { force: true })).toBe(false);
    const encodes = exportSpy.mock.calls.length;

    // Everything the 5 s checkpoint timer does from here on must be free. This
    // is the difference between "saving is broken" and "the app has ground to
    // a halt re-encoding 5 MB every five seconds".
    for (let i = 0; i < 12; i++) {
      expect(await saveSnapshot(eng)).toBe(false);
    }
    expect(exportSpy.mock.calls.length).toBe(encodes);
  }, 120_000);
});
