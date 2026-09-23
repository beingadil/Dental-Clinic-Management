import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { usersRepo } from '../../src/db/repos';
import { seedDatabase } from '../../src/db/seeds';
import { initEngineFromBytes } from '../../src/db';

/**
 * First-run admin persistence — the boot contract.
 *
 * The app ships zero accounts; the login screen's first-run setup creates
 * the Super Admin via usersRepo.insert. This test guards the layer beneath
 * the login screen: an admin created in session N must be visible to
 * session N+1 after a full engine restart from the persisted bytes
 * (what closing and reopening the app does). A regression here or in the
 * boot hydration resurfaces the "create the administrator" form forever.
 */

let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
  await seedDatabase();
});

describe('first-run admin — survives app restart', () => {
  it('fresh install ships zero accounts', () => {
    expect(usersRepo.count()).toBe(0);
  });

  it('admin created via setup is visible after a full restart from persisted bytes', async () => {
    // Session 1: the operator creates the admin (same path as createInitialAdmin).
    usersRepo.insert({
      id: 'usr-first-run-admin',
      username: 'operator',
      email: 'operator@localhost',
      name: 'Lab Operator',
      role: 'Super Admin',
      password_hash: 'a'.repeat(64),
      password_salt: 'b'.repeat(16),
      is_super_admin: 1,
    });

    // Close the app: export bytes; reopen: rebuild the engine from them.
    const bytes = engine.export();
    const SQL = await initSqlJs();
    const restarted = await initEngineFromBytes(bytes);
    setDatabase(restarted);

    const visible = usersRepo.all().filter((u) => !(u as any).is_hidden);
    expect(visible.map((u) => u.username)).toContain('operator');
    expect(visible[0].is_super_admin).toBe(1);
  });
});
