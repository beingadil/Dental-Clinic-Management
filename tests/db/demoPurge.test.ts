import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { usersRepo } from '../../src/db/repos';
import { MIGRATIONS } from '../../src/db/migrations';

/**
 * Migrations 008 + 009 — zero shipped accounts.
 *
 * Historical builds seeded demo accounts (adil / admin / billing / hamza /
 * Sana, all @dentalsolutions.pk) and a hidden `service.admin` support
 * account. The app now ships with NO accounts at all: migration 008 purges
 * the demo identities, migration 009 deletes every hidden account row, and
 * the login screen's first-run setup creates the operator's own Super Admin.
 */

let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
});

function insertUser(
  username: string,
  email: string,
  opts: { isSuperAdmin?: number; isHidden?: number } = {},
): void {
  usersRepo.insert({
    id: `usr_${username}`,
    username,
    email,
    name: username,
    role: opts.isSuperAdmin ? 'Super Admin' : 'Technician',
    password_hash: 'a'.repeat(64),
    password_salt: 'b'.repeat(16),
    is_super_admin: opts.isSuperAdmin ?? 0,
    is_hidden: opts.isHidden ?? 0,
  });
}

/** Rewind the ledger so migrations 008 and 009 re-apply for the test.
 *  Migration 10 stays in the ledger: its ALTER TABLE is already physically
 *  applied and cannot be re-run. */
function rewindToSchema7(): void {
  engine.run('DELETE FROM schema_migrations WHERE version >= 8 AND version < 10');
  engine.run("DELETE FROM app_meta WHERE key = 'schema_version'");
  engine.run("INSERT INTO app_meta (key, value) VALUES ('schema_version', '7')");
}

describe('migrations 008 + 009 — zero shipped accounts', () => {
  it('registers both migrations in the ledger with the right identity', () => {
    expect(MIGRATIONS.map((x) => x.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(MIGRATIONS[7]).toMatchObject({ version: 8, name: 'purge_demo_users' });
    expect(MIGRATIONS[8]).toMatchObject({ version: 9, name: 'drop_service_account' });
  });

  it('deletes demo accounts AND hidden service rows, keeps only real accounts', () => {
    // Simulate an upgraded machine: demo users + the retired hidden service
    // account + the operator's real first-run admin + real staff.
    insertUser('adil', 'adil@dentalsolutions.pk', { isSuperAdmin: 1 });
    insertUser('admin', 'admin@dentalsolutions.pk');
    insertUser('billing', 'billing@dentalsolutions.pk');
    insertUser('hamza', 'hamza@dentalsolutions.pk');
    insertUser('sana', 'Sana@dentalsolutions.pk'); // case-insensitive guard
    insertUser('clinic_owner', 'clinic_owner@localhost', { isSuperAdmin: 1 });
    insertUser('tech_sara', 'sara@localhost');
    insertUser('service.admin', 'service.admin@localhost', { isSuperAdmin: 1, isHidden: 1 });

    rewindToSchema7();
    engine.migrate();

    const survivors = usersRepo.all().map((u) => u.username).sort();
    expect(survivors).toEqual(['clinic_owner', 'tech_sara']);
  });

  it('is idempotent — re-running leaves the real accounts intact', () => {
    const count = usersRepo.count();
    engine.migrate();
    expect(usersRepo.count()).toBe(count);
    expect(usersRepo.all().map((u) => u.username).sort()).toEqual([
      'clinic_owner',
      'tech_sara',
    ]);
  });
});
