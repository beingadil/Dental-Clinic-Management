/**
 * @vitest-environment jsdom
 *
 * Regression: the browser snapshot was written to localStorage, whose origin
 * quota is ~5 MB. Base64 inflates the database by 4/3, so once a real clinic
 * database passed ~3.7 MB every save threw QuotaExceededError, the dirty flag
 * never cleared, and the 5 s checkpoint re-encoded the entire database before
 * throwing again — persistence dead and the UI visibly slowing down.
 *
 * These tests pin the three behaviours that make that failure survivable:
 * IndexedDB is the primary store, a full localStorage reports an actionable
 * message instead of a raw DOM exception, and repeated failures back off
 * instead of re-encoding on every tick.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import initSqlJs from 'sql.js';
import { IDBFactory } from 'fake-indexeddb';
import { SqliteEngine } from '../../src/db/engine';

const REAL_IDB = new IDBFactory();
(globalThis as any).indexedDB ??= REAL_IDB;

function quotaShim(limitChars: number) {
  const store = new Map<string, string>();
  let used = 0;
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const prev = store.get(k);
      const next = used - (prev?.length ?? 0) + v.length;
      if (next > limitChars) {
        const err = new Error(`exceeded the quota (${limitChars} chars)`);
        err.name = 'QuotaExceededError';
        throw err;
      }
      used = next;
      store.set(k, v);
    },
    removeItem: (k: string) => {
      const prev = store.get(k);
      if (prev) used -= prev.length;
      store.delete(k);
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
    __used: () => used,
  };
}

async function freshEngine() {
  const SQL = await initSqlJs();
  const eng = await SqliteEngine.create(SQL, null);
  eng.migrate();
  eng.run("INSERT INTO labs (id, name, created_at) VALUES ('lab-q', 'Quota Clinic', '2026-01-01')");
  return eng;
}

describe('browser snapshot storage', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as any).indexedDB = REAL_IDB;
    REAL_IDB.deleteDatabase('dsw_sqlite');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).indexedDB = REAL_IDB;
  });

  it('round-trips a snapshot through IndexedDB and leaves no legacy copy behind', async () => {
    (globalThis as any).localStorage = quotaShim(50 * 1024 * 1024);
    const eng = await freshEngine();
    const { saveSnapshot, loadSnapshot } = await import('../../src/db/persistence');
    const { setDatabase } = await import('../../src/db/core');
    setDatabase(eng);

    expect(await saveSnapshot(eng)).toBe(true);
    // The whole database does NOT sit in localStorage any more.
    expect(localStorage.getItem('dsw_sqlite_snapshot')).toBeNull();
    expect(localStorage.getItem('dsw_sqlite_dirty')).toBe('false');
    // ...it is in IndexedDB, and the dirty flag was cleared.
    expect(localStorage.__used()).toBeLessThan(100);

    const bytes = await loadSnapshot();
    expect(bytes).not.toBeNull();
    const restored = await SqliteEngine.create(await initSqlJs(), bytes!);
    expect(restored.get("SELECT name FROM labs WHERE id = 'lab-q'")?.name).toBe('Quota Clinic');
  });

  it('reports an actionable message when the localStorage fallback is full', async () => {
    // Force the legacy path: a browser with no IndexedDB at all.
    (globalThis as any).indexedDB = undefined;
    (globalThis as any).localStorage = quotaShim(1000); // far too small
    const eng = await freshEngine();
    const { saveSnapshot, getLastSaveError } = await import('../../src/db/persistence');

    expect(await saveSnapshot(eng, { force: true })).toBe(false);
    const message = getLastSaveError() ?? '';
    expect(message).toContain('storage is full');
    expect(message).toContain('.dentalbackup');
    // Not the raw DOMException text the banner used to show.
    expect(message).not.toContain("Failed to execute 'setItem'");
  });

  it('backs off after a failure instead of re-encoding on every checkpoint', async () => {
    (globalThis as any).indexedDB = undefined;
    (globalThis as any).localStorage = quotaShim(1000);
    const eng = await freshEngine();
    const { saveSnapshot } = await import('../../src/db/persistence');

    const exportSpy = vi.spyOn(eng, 'export');
    expect(await saveSnapshot(eng, { force: true })).toBe(false);
    expect(await saveSnapshot(eng, { force: true })).toBe(false);
    const afterFailures = exportSpy.mock.calls.length;

    // Third attempt, no force: inside the backoff window, so it must not even
    // serialize the database.
    expect(await saveSnapshot(eng)).toBe(false);
    expect(exportSpy.mock.calls.length).toBe(afterFailures);

    // An explicit write-through (backup restore) still goes through.
    expect(await saveSnapshot(eng, { force: true })).toBe(false);
    expect(exportSpy.mock.calls.length).toBe(afterFailures + 1);
  });
});
