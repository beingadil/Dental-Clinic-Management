import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase, getDatabase } from '../../src/db/core';
import { labsRepo, casesRepo } from '../../src/db/repos';
import {
  createBackup,
  applyRestoredBytes,
  validateBackup,
  LATEST_SCHEMA_VERSION,
} from '../../src/services/backupService';

/**
 * Restore-safety regressions (backup & restore master-prompt Phase 10/12/24).
 *
 * Kept in their own file with ONE shared WASM instance on purpose: the main
 * backup suite builds ~18 engines, and every extra initSqlJs() compile pushed
 * that worker past Node's default heap (FATAL ERROR: mark-compacts). The
 * factory below reuses `SQL`, so restoring costs one engine, not one compile.
 */

let SQL: any;

beforeAll(async () => {
  SQL = await initSqlJs();
});

function memoryShim() {
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

/** Build → migrate → install globally: the exact semantics of initEngineFromBytes. */
function factory(sql: any) {
  return async (bytes: Uint8Array) => {
    const e = await SqliteEngine.create(sql, bytes);
    e.migrate();
    setDatabase(e);
    return e;
  };
}

/** The packaging engine is dead weight once the package exists — free its heap. */
async function packageFrom(engine: SqliteEngine, note?: string) {
  setDatabase(engine);
  const pkg = await createBackup(note);
  engine.close();
  return pkg;
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c: string) => c.charCodeAt(0));
}

describe('restore safety', () => {
  let localStorageShim: ReturnType<typeof memoryShim>;

  beforeAll(() => {
    localStorageShim = memoryShim();
    (globalThis as any).localStorage = localStorageShim;
  });

  afterEach(() => {
    try { getDatabase().close(); } catch { /* none set */ }
    setDatabase(null);
    localStorageShim = memoryShim();
    (globalThis as any).localStorage = localStorageShim;
  });

  // Phase 12 — a backup migrated further than this build understands must be
  // refused, never silently loaded: the app would read columns it does not know.
  it('rejects a backup whose schema is newer than this app supports', async () => {
    const engine = await SqliteEngine.create(SQL, null);
    engine.migrate();
    const pkg = await packageFrom(engine);

    const future = { manifest: { ...pkg.manifest, schema_version: LATEST_SCHEMA_VERSION + 1 }, database_b64: pkg.database_b64 };
    const verdict = await validateBackup(future);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join(' ')).toMatch(/newer|update/i);

    // Older schemas stay restorable — migrations upgrade them at apply time.
    const older = { manifest: { ...pkg.manifest, schema_version: 1 }, database_b64: pkg.database_b64 };
    expect((await validateBackup(older)).ok).toBe(true);
  });

  // Phase 10 — persist failure (disk/quota) must roll back to the previous engine.
  it('rolls back to the previous engine when the restored database cannot be persisted', async () => {
    const source = await SqliteEngine.create(SQL, null);
    source.migrate();
    setDatabase(source);
    labsRepo.insert({ id: 'lab-rb1', name: 'Rollback Source', created_at: '2026-01-01' });
    const pkg = await packageFrom(source);

    const current = await SqliteEngine.create(SQL, null);
    current.migrate();
    setDatabase(current);
    labsRepo.insert({ id: 'lab-keep', name: 'Current Data', created_at: '2026-01-01' });

    // Storage exhaustion on the next snapshot write.
    (globalThis as any).localStorage.setItem = () => {
      throw new Error('quota exceeded');
    };

    await expect(applyRestoredBytes(pkg, factory(SQL))).rejects.toThrow(/could not be written|storage/i);

    expect(getDatabase()).toBe(current);
    const names = labsRepo.all().map((l: any) => l.name);
    expect(names).toContain('Current Data');
    expect(names).not.toContain('Rollback Source');
  });

  // Phase 10 — the factory swaps the global engine and THEN fails; the
  // previous engine must be put back, not the half-restored one.
  it('restores the previous engine when the engine factory fails mid-swap', async () => {
    const source = await SqliteEngine.create(SQL, null);
    source.migrate();
    setDatabase(source);
    labsRepo.insert({ id: 'lab-ms1', name: 'MidSwap Source', created_at: '2026-01-01' });
    const pkg = await packageFrom(source);

    const current = await SqliteEngine.create(SQL, null);
    current.migrate();
    setDatabase(current);
    labsRepo.insert({ id: 'lab-keep2', name: 'Current Data Two', created_at: '2026-01-01' });

    const realBytes = b64ToBytes(pkg.database_b64);
    const buildAndSwap = factory(SQL);
    await expect(
      applyRestoredBytes(pkg, async (bytes: Uint8Array) => {
        await buildAndSwap(bytes);
        throw new Error('factory exploded after swap');
      }),
    ).rejects.toThrow(/factory exploded/);

    expect(getDatabase()).toBe(current);
    expect(labsRepo.all().map((l: any) => l.name)).toContain('Current Data Two');
  });

  // Phase 24 — row counts, not file size, prove the restore carried the data.
  it('reconciles table counts between manifest and the restored engine', async () => {
    const source = await SqliteEngine.create(SQL, null);
    source.migrate();
    setDatabase(source);
    labsRepo.insert({ id: 'lab-rc1', name: 'Recon Lab', created_at: '2026-01-01' });
    casesRepo.insert({
      id: 'c-rc1',
      case_number: 'DS-9902',
      lab_id: 'lab-rc1',
      lab_name: 'Recon Lab',
      doctor_name: 'Dr Recon',
      delivery_date: '2026-11-02',
      status: 'received',
      selected_teeth: [11],
    } as any);
    const pkg = await packageFrom(source);
    expect(pkg.manifest.table_counts['labs']).toBe(1);
    expect(pkg.manifest.table_counts['cases']).toBe(1);

    const fresh = await SqliteEngine.create(SQL, null);
    fresh.migrate();
    setDatabase(fresh);
    await applyRestoredBytes(pkg, factory(SQL));
    const restored = getDatabase();

    expect(restored.rowCount('labs')).toBe(pkg.manifest.table_counts['labs']);
    expect(restored.rowCount('cases')).toBe(pkg.manifest.table_counts['cases']);
    expect(restored.all<any>('SELECT case_number FROM cases').map((c: any) => c.case_number)).toContain('DS-9902');
  });
});
