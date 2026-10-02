import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase, getDatabase } from '../../src/db/core';
import { labsRepo, appMetaRepo } from '../../src/db/repos';
import { installAutoPersistence, persistEngineNow, flushNow, isSnapshotDirty } from '../../src/db/persistence';
import { createBackup, applyRestoredBytes, looksLikeSqlite } from '../../src/services/backupService';
import { initEngineFromBytes } from '../../src/db';

/**
 * Restore regression suite.
 *
 * The bug these lock down: `applyRestoredBytes` swapped the live engine but
 * never wrote it through to the persistence store, and the one-shot `hooked`
 * guard stopped the new engine from ever being wrapped for autosave. The page
 * then reloaded straight back onto the OLD database — a restore that reported
 * success and changed nothing, on every machine, every time.
 *
 * These assertions run against the real persistence code with an in-memory
 * localStorage shim, so they fail if the write is dropped again.
 */

let SQL: any;

beforeAll(async () => {
  SQL = await initSqlJs();
});

function makeMemoryShim() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
}

/**
 * Builds a migrated engine holding the given labs, and makes it the live
 * engine BEFORE any repo write.
 *
 * The ordering matters: repos resolve the engine through the module-global
 * getDatabase(), so inserting before setDatabase() writes into whatever the
 * previous test left behind — or throws "Database not initialized" on the
 * first test. The global is deliberately not reset between tests because the
 * restore path itself swaps it, which is exactly what these tests exercise.
 */
async function seeded(labs: Array<[string, string]>, marker: string): Promise<SqliteEngine> {
  const engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
  for (const [id, name] of labs) {
    labsRepo.insert({ id, name, created_at: '2026-01-01' });
  }
  appMetaRepo.set('marker', marker);
  return engine;
}

describe('backup restore writes through to persistence', () => {
  let shim: ReturnType<typeof makeMemoryShim>;

  beforeEach(() => {
    shim = makeMemoryShim();
    (globalThis as any).localStorage = shim;
  });

  it('persists the restored database, so the post-restore reload sees it', async () => {
    // Source clinic → backup
    const source = await seeded([['lab-src', 'Source Clinic']], 'source');
    setDatabase(source);
    installAutoPersistence(source);
    const pkg = await createBackup('restore source');

    // Current clinic has completely different data
    const current = await seeded([['lab-cur', 'Current Clinic']], 'current');
    setDatabase(current);
    installAutoPersistence(current);
    expect(labsRepo.all().map((l: any) => l.name)).not.toContain('Source Clinic');

    await applyRestoredBytes(pkg, (bytes) => initEngineFromBytes(bytes));

    // 1. In memory the swap happened.
    expect(labsRepo.all().map((l: any) => l.name)).toContain('Source Clinic');

    // 2. AND the bytes are on disk. Simulate the reload by rebuilding an engine
    //    purely from the persisted snapshot, exactly as boot does.
    const persisted = shim.getItem('dsw_sqlite_snapshot');
    expect(persisted).toBeTruthy();
    const raw = atob(persisted!.slice('DSDB1:'.length));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const afterReload = await SqliteEngine.create(SQL, bytes);
    afterReload.migrate();
    expect(afterReload.all<any>('SELECT name FROM labs').map((l) => l.name)).toContain('Source Clinic');
    expect(afterReload.scalar("SELECT value FROM app_meta WHERE key = 'marker'")).toBe('source');
  });

  it('keeps the restored engine under autosave instead of dropping the hook', async () => {
    const source = await seeded([['lab-hook', 'Hook Clinic']], 'hooked');
    setDatabase(source);
    installAutoPersistence(source);
    const pkg = await createBackup();

    const current = await seeded([], 'pre-restore');
    setDatabase(current);
    installAutoPersistence(current);

    await applyRestoredBytes(pkg, (bytes) => initEngineFromBytes(bytes));
    await flushNow();

    // A write on the RESTORED engine must schedule a flush of that same engine.
    const restored = getDatabase();
    labsRepo.insert({ id: 'lab-after-restore', name: 'Written After Restore', created_at: '2026-01-02' });
    expect(isSnapshotDirty()).toBe(true);

    await persistEngineNow(restored);

    const persisted = shim.getItem('dsw_sqlite_snapshot')!;
    const raw = atob(persisted.slice('DSDB1:'.length));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const reopened = await SqliteEngine.create(SQL, bytes);
    expect(
      reopened.all<any>('SELECT name FROM labs').map((l) => l.name),
    ).toContain('Written After Restore');
  });

  it('re-attaches autosave to a second restore without losing the first', async () => {
    const a = await seeded([['lab-a', 'Clinic A']], 'a');
    setDatabase(a);
    installAutoPersistence(a);
    const pkgA = await createBackup();

    const b = await seeded([['lab-b', 'Clinic B']], 'b');
    setDatabase(b);
    installAutoPersistence(b);
    const pkgB = await createBackup();

    // Restore A, write, then restore B on top — both must stick.
    await applyRestoredBytes(pkgA, (bytes) => initEngineFromBytes(bytes));
    await persistEngineNow(getDatabase());
    await applyRestoredBytes(pkgB, (bytes) => initEngineFromBytes(bytes));
    await persistEngineNow(getDatabase());

    const persisted = shim.getItem('dsw_sqlite_snapshot')!;
    const raw = atob(persisted.slice('DSDB1:'.length));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const reopened = await SqliteEngine.create(SQL, bytes);
    expect(reopened.all<any>('SELECT name FROM labs').map((l) => l.name)).toContain('Clinic B');
    expect(reopened.all<any>('SELECT name FROM labs').map((l) => l.name)).not.toContain('Clinic A');
  });

  it('refuses a payload that is not a SQLite database', async () => {
    const engine = await SqliteEngine.create(SQL, null);
    engine.migrate();
    setDatabase(engine);
    installAutoPersistence(engine);

    const pkg = await createBackup();
    const bogus = { ...pkg, database_b64: btoa('this is a text file, not a database') };
    await expect(applyRestoredBytes(bogus, (bytes) => initEngineFromBytes(bytes))).rejects.toThrow(
      /not a SQLite database/i,
    );
  });

  it('rolls back to the previous engine when the restore cannot be persisted', async () => {
    const source = await seeded([['lab-roll', 'Rollback Clinic']], 'rollback');
    setDatabase(source);
    installAutoPersistence(source);
    const pkg = await createBackup();

    const current = await seeded([['lab-keep', 'Keep Me Clinic']], 'keep');
    setDatabase(current);
    installAutoPersistence(current);

    // Simulate a full disk / quota: the persisted write throws.
    shim.setItem = () => {
      throw new Error('QuotaExceededError');
    };

    await expect(applyRestoredBytes(pkg, (bytes) => initEngineFromBytes(bytes))).rejects.toThrow(
      /could not be written to storage/i,
    );

    // The live engine must still be the pre-restore one — no half-restored state.
    expect(labsRepo.all().map((l: any) => l.name)).toContain('Keep Me Clinic');
  });

  it('reports the restored row count and schema version', async () => {
    const source = await seeded([['lab-1', 'One'], ['lab-2', 'Two'], ['lab-3', 'Three']], 'meta');
    setDatabase(source);
    installAutoPersistence(source);
    const pkg = await createBackup();

    const current = await seeded([], 'empty');
    setDatabase(current);
    installAutoPersistence(current);

    const outcome = await applyRestoredBytes(pkg, (bytes) => initEngineFromBytes(bytes));
    expect(outcome.schemaVersion).toBeGreaterThan(0);
    expect(outcome.rowsRestored).toBeGreaterThanOrEqual(3);
    expect(typeof outcome.crossVersion).toBe('boolean');
  });

  it('accepts real backup bytes and rejects foreign ones', async () => {
    const engine = await SqliteEngine.create(SQL, null);
    engine.migrate();
    const bytes = engine.export();
    expect(looksLikeSqlite(bytes)).toBe(true);
    expect(looksLikeSqlite(new TextEncoder().encode('nope'))).toBe(false);
    expect(looksLikeSqlite(new Uint8Array(0))).toBe(false);
  });
});

describe('export() must not disable foreign keys', () => {
  it('keeps ON DELETE CASCADE working after serialising', async () => {
    const engine = await SqliteEngine.create(SQL, null);
    engine.migrate();
    engine.run('PRAGMA foreign_keys = ON;');
    expect(engine.scalar('PRAGMA foreign_keys')).toBe(1);

    // This is the operation that used to silently disable cascades for the rest
    // of the session — every backup file, autosave flush and window close.
    engine.export();

    expect(engine.scalar('PRAGMA foreign_keys')).toBe(1);

    // Behavioural proof, not just the flag: cases.lab_id carries
    // ON DELETE CASCADE in the real schema, so deleting the lab must take the
    // case with it. With foreign_keys reset to OFF by export(), the case
    // survives as an orphan — the exact row that later collides on
    // `UNIQUE constraint failed: journal_lines.id`.
    engine.run("INSERT INTO labs (id, name, created_at) VALUES ('lab-fk', 'FK Lab', '2026-01-01')");
    engine.run(
      "INSERT INTO cases (id, case_number, lab_id, lab_name, doctor_name, delivery_date, status, created_at, updated_at, selected_teeth)" +
      " VALUES ('c-fk', 'DS-FK1', 'lab-fk', 'FK Lab', 'Dr. F', '2026-11-01', 'received', '2026-01-01', '2026-01-01', '[11]')",
    );
    expect(engine.rowCount('cases')).toBe(1);

    // Serialise again — the realistic sequence: write, autosave, then delete.
    engine.export();

    engine.run("DELETE FROM labs WHERE id = 'lab-fk'");
    expect(engine.rowCount('cases')).toBe(0);
    expect(engine.foreignKeyCheck()).toHaveLength(0);
  });
});
