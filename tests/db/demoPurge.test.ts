import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { usersRepo } from '../../src/db/repos';
import { MIGRATIONS } from '../../src/db/migrations';
import { seedServiceAccount } from '../../src/db/serviceAccount';

/**
 * Migration 008 — purge_demo_users.
 *
 * Historical builds seeded demo accounts (adil / admin / billing / hamza /
 * Sana, all @dentalsolutions.pk) and the legacy migrator carried them into
 * SQLite on machines that upgraded from the localStorage era. App-created
 * accounts use @localhost emails, so the purge matches exactly the shipped
 * demo identities and nothing else.
 */

let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
});

function insertUser(username: string, email: string, isSuperAdmin = 0): void {
  usersRepo.insert({
    id: `usr_${username}`,
    username,
    email,
    name: username,
    role: isSuperAdmin ? 'Super Admin' : 'Technician',
    password_hash: 'a'.repeat(64),
    password_salt: 'b'.repeat(16),
    is_super_admin: isSuperAdmin,
  });
}

describe('migration 008 — purge_demo_users', () => {
  it('is registered in the migrations ledger with the right identity', () => {
    const m = MIGRATIONS[MIGRATIONS.length - 1];
    expect(m.version).toBe(8);
    expect(m.name).toBe('purge_demo_users');
    expect(MIGRATIONS.map((x) => x.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('deletes shipped demo accounts but keeps real, service and super-admin accounts', async () => {
    // Simulate an upgraded machine: schema already migrated to v7-equivalent
    // state by beforeAll; the demo-era rows exist and 008 is pending. Rewind
    // the ledger so 008 applies again for this test.
    insertUser('adil', 'adil@dentalsolutions.pk', 1);
    insertUser('admin', 'admin@dentalsolutions.pk');
    insertUser('billing', 'billing@dentalsolutions.pk');
    insertUser('hamza', 'hamza@dentalsolutions.pk');
    insertUser('sana', 'Sana@dentalsolutions.pk'); // case-insensitive guard
    insertUser('clinic_owner', 'clinic_owner@localhost', 1); // real first-run admin
    insertUser('tech_sara', 'sara@localhost'); // real staff account
    await seedServiceAccount(); // hidden, must survive (async — PBKDF2)

    engine.run('DELETE FROM schema_migrations WHERE version = 8');
    engine.run("DELETE FROM app_meta WHERE key = 'schema_version'");
    engine.run("INSERT INTO app_meta (key, value) VALUES ('schema_version', '7')");
    engine.migrate();

    const survivors = usersRepo.all().map((u) => u.username).sort();
    expect(survivors).toEqual(['clinic_owner', 'service.admin', 'tech_sara']);
  });

  it('is idempotent — re-running leaves accounts intact', () => {
    const count = usersRepo.count();
    engine.migrate();
    expect(usersRepo.count()).toBe(count);
    expect(usersRepo.all().map((u) => u.username).sort()).toEqual([
      'clinic_owner',
      'service.admin',
      'tech_sara',
    ]);
  });
});
