import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { b64encodeForTest, b64decodeForTest } from './helpers';

/**
 * Snapshot persistence semantics: the full SQLite file (engine.export())
 * round-trips through a base64 string without data loss, and restoring a
 * snapshot continues from the same schema version and data.
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

describe('snapshot round-trip', () => {
  it('restores schema and data from exported bytes', async () => {
    const shim = makeMemoryShim();
    (globalThis as any).localStorage = shim;

    // 1. original database with data
    const original = await SqliteEngine.create(SQL, null);
    original.migrate();
    original.run("INSERT INTO labs (id, name, created_at) VALUES ('lab-snap', 'Snapshot Clinic', '2026-01-01')");
    original.run("INSERT INTO cases (id, case_number, lab_id, lab_name, doctor_name, delivery_date, status, created_at, updated_at, selected_teeth) VALUES ('c-snap', 'DS-7777', 'lab-snap', 'Snapshot Clinic', 'Dr. S', '2026-10-01', 'received', '2026-01-01', '2026-01-01', '[11]')");

    // 2. persist snapshot (same encoding as persistence.ts)
    const bytes = original.export();
    const encoded = 'DSDB1:' + b64encodeForTest(bytes);
    shim.setItem('dsw_sqlite_snapshot', encoded);

    // 3. fresh engine restores from snapshot
    const restoredRaw = shim.getItem('dsw_sqlite_snapshot')!;
    expect(restoredRaw.startsWith('DSDB1:')).toBe(true);
    const restoredBytes = b64decodeForTest(restoredRaw.slice('DSDB1:'.length));
    const restored = await SqliteEngine.create(SQL, restoredBytes);

    // 4. schema survives; migrations are a no-op
    const { applied } = restored.migrate();
    expect(applied).toHaveLength(0);
    expect(restored.get("SELECT name FROM labs WHERE id = 'lab-snap'")?.name).toBe('Snapshot Clinic');
    const c = restored.get<any>("SELECT selected_teeth FROM cases WHERE case_number = 'DS-7777'");
    expect(JSON.parse(c.selected_teeth)).toEqual([11]);
  });

  it('rejects corrupted snapshots by header check', async () => {
    const shim = makeMemoryShim();
    (globalThis as any).localStorage = shim;
    shim.setItem('dsw_sqlite_snapshot', 'bogus-data');
    // loadSnapshot() removes the bad key and returns null — verified via import
    const { loadSnapshot } = await import('../../src/db/persistence');
    const result = await loadSnapshot();
    expect(result).toBeNull();
    expect(shim.getItem('dsw_sqlite_snapshot')).toBeNull();
  });
});
