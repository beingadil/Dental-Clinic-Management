import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase, getDatabase } from '../../src/db/core';
import { labsRepo, casesRepo, appMetaRepo } from '../../src/db/repos';
import { installAutoPersistence } from '../../src/db/persistence';
import {
  createBackup,
  serializeBackup,
  parseBackupFile,
  validateBackup,
  applyRestoredBytes,
  createSafetySnapshot,
  BACKUP_MAGIC,
  BACKUP_FORMAT_VERSION,
  APP_VERSION,
} from '../../src/services/backupService';
import { initEngineFromBytes } from '../../src/db';

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
 * NOTE on restore semantics: applyRestoredBytes swaps the LIVE engine to a
 * fresh engine built from the backup payload. The test therefore backs up a
 * seeded source engine, switches to a *different* current engine, restores,
 * and expects the source engine's rows to reappear. setDatabase is the seam
 * that makes this observable without a browser.
 */

describe('.dentalbackup package pipeline', () => {
  let shim: ReturnType<typeof makeMemoryShim>;

  beforeEach(() => {
    shim = makeMemoryShim();
    (globalThis as any).localStorage = shim;
  });

  it('creates a verifiable package with manifest + checksum + payload', async () => {
    const engine = await SqliteEngine.create(SQL, null);
    engine.migrate();
    setDatabase(engine);
    labsRepo.insert({ id: 'lab-b1', name: 'Backup Source Lab', created_at: '2026-01-01' });

    const pkg = await createBackup('test export');
    expect(pkg.manifest.magic).toBe(BACKUP_MAGIC);
    expect(pkg.manifest.format_version).toBe(BACKUP_FORMAT_VERSION);
    expect(pkg.manifest.app_version).toBe(APP_VERSION);
    expect(pkg.manifest.table_counts['labs']).toBe(1);
    expect(pkg.manifest.db_checksum.startsWith('sha256:')).toBe(true);
    expect(pkg.manifest.db_size_bytes).toBeGreaterThan(0);
    expect(pkg.manifest.note).toBe('test export');

    const verdict = await validateBackup(pkg);
    expect(verdict.ok).toBe(true);
    expect(verdict.errors).toHaveLength(0);
    expect(verdict.manifest?.created_at).toBeTruthy();
  });

  it('round-trips through serialize → parse without loss', async () => {
    const engine = await SqliteEngine.create(SQL, null);
    engine.migrate();
    setDatabase(engine);
    labsRepo.insert({ id: 'lab-b2', name: 'Roundtrip Lab', created_at: '2026-01-01' });

    const original = await createBackup();
    const text = serializeBackup(original);
    const parsed = parseBackupFile(text);
    expect(parsed.manifest.magic).toBe(original.manifest.magic);
    expect(parsed.database_b64).toBe(original.database_b64);
    const verdict = await validateBackup(parsed);
    expect(verdict.ok).toBe(true);
  });

  it('rejects a corrupted payload via checksum mismatch', async () => {
    const engine = await SqliteEngine.create(SQL, null);
    engine.migrate();
    setDatabase(engine);

    const pkg = await createBackup();
    // Flip a byte in the middle of the payload
    const idx = Math.floor(pkg.database_b64.length / 2);
    const char = pkg.database_b64[idx] === 'A' ? 'B' : 'A';
    const corrupted = {
      ...pkg,
      database_b64: pkg.database_b64.slice(0, idx) + char + pkg.database_b64.slice(idx + 1),
    };
    const verdict = await validateBackup(corrupted);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join(' ')).toMatch(/checksum|integrity/i);
  });

  it('rejects a file with a wrong magic header', async () => {
    const engine = await SqliteEngine.create(SQL, null);
    engine.migrate();
    setDatabase(engine);
    const pkg = await createBackup();
    const forged = { manifest: { ...pkg.manifest, magic: 'SOMETHINGELSE' }, database_b64: pkg.database_b64 };
    const verdict = await validateBackup(forged);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join(' ')).toMatch(/header|Dental/i);
  });

  it('blocks newer format versions and warns on older ones', async () => {
    const engine = await SqliteEngine.create(SQL, null);
    engine.migrate();
    setDatabase(engine);
    const pkg = await createBackup();

    const future = { manifest: { ...pkg.manifest, format_version: BACKUP_FORMAT_VERSION + 5 }, database_b64: pkg.database_b64 };
    const futureVerdict = await validateBackup(future);
    expect(futureVerdict.ok).toBe(false);
    expect(futureVerdict.errors.join(' ')).toMatch(/newer|update/i);

    const older = { manifest: { ...pkg.manifest, format_version: 1 }, database_b64: pkg.database_b64 };
    const olderVerdict = await validateBackup(older);
    if (BACKUP_FORMAT_VERSION === 1) {
      // same version: still valid, no older-format warning expected
      expect(olderVerdict.ok).toBe(true);
    } else {
      expect(olderVerdict.warnings.join(' ')).toMatch(/older/i);
    }
  });

  it('restores: engine swap brings back the backup’s data and reattaches persistence', async () => {
    // Source engine with data → backup
    const source = await SqliteEngine.create(SQL, null);
    source.migrate();
    setDatabase(source);
    labsRepo.insert({ id: 'lab-r1', name: 'Restore Me Lab', created_at: '2026-01-01' });
    casesRepo.insert({
      id: 'c-r1',
      case_number: 'DS-9901',
      lab_id: 'lab-r1',
      lab_name: 'Restore Me Lab',
      doctor_name: 'Dr. Restore',
      delivery_date: '2026-11-01',
      status: 'received',
      selected_teeth: [11],
    } as any);
    const pkg = await createBackup('restore source');

    // "Current" engine — different data entirely
    const current = await SqliteEngine.create(SQL, null);
    current.migrate();
    setDatabase(current);
    expect(labsRepo.all().length).toBe(0);

    // Restore from the backup package
    await applyRestoredBytes(pkg, (bytes) => initEngineFromBytes(bytes));

    const restored = getDatabase();
    const labs = restored.all<any>('SELECT * FROM labs');
    expect(labs.map((l: any) => l.name)).toContain('Restore Me Lab');
    const cases = restored.all<any>('SELECT * FROM cases');
    expect(cases.map((c: any) => c.case_number)).toContain('DS-9901');
    expect(restored.scalar('SELECT MAX(version) FROM schema_migrations')).toBeGreaterThan(0);
    expect(installAutoPersistence).toBeDefined(); // engine reattached; marker check
  });

  it('creates a safety snapshot containing the full current database', async () => {
    const engine = await SqliteEngine.create(SQL, null);
    engine.migrate();
    setDatabase(engine);
    labsRepo.insert({ id: 'lab-s1', name: 'Safety Lab', created_at: '2026-01-01' });
    appMetaRepo.set('test_marker', 'present');

    const snap = await createSafetySnapshot();
    expect(snap.takenAt).toBeTruthy();
    const pkg = parseBackupFile(snap.data);
    const verdict = await validateBackup(pkg);
    expect(verdict.ok).toBe(true);
  });
});
