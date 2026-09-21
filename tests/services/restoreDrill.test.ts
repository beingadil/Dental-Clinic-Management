import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { seedDatabase } from '../../src/db/seeds';
import { runRestoreDrill } from '../../src/services/restoreDrill';
import { createBackup, parseBackupFile, validateBackup } from '../../src/services/backupService';

/**
 * Integration: the restore drill must prove the restore pipeline end-to-end
 * on healthy data (PASS), and report failure instead of throwing when the
 * package is corrupt. The live engine must survive the drill untouched.
 */
describe('restore drill', () => {
  let engine: SqliteEngine;

  beforeAll(async () => {
    const init = initSqlJs as unknown as (cfg?: any) => Promise<any>;
    const SQL = await init();
    engine = await SqliteEngine.create(SQL);
    engine.migrate();
    setDatabase(engine);
    await seedDatabase();
  });

  it('verifies a fresh backup restores into a temp engine with matching row counts', async () => {
    const result = await runRestoreDrill();
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.checkedTables).toBeGreaterThanOrEqual(12);
    expect(result.checkedRows).toBeGreaterThan(0);
  }, 60_000);

  it('live engine stays usable after the drill (temp engine isolation)', async () => {
    const before = engine.rowCount('users');
    const result = await runRestoreDrill();
    expect(result.ok).toBe(true);
    expect(engine.rowCount('users')).toBe(before);
    expect(engine.scalar('SELECT MAX(version) FROM schema_migrations')).toBeGreaterThan(0);
  }, 60_000);

  it('fails closed when the package payload is corrupt', async () => {
    const pkg = await createBackup('corrupt test');
    const parsed = parseBackupFile(JSON.stringify(pkg));
    parsed.database_b64 = '####' + parsed.database_b64.slice(4);
    const verdict = await validateBackup(parsed);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.length).toBeGreaterThan(0);
  }, 60_000);
});
