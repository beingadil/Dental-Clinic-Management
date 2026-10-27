import { describe, it, expect } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';

/**
 * Migration 028 — roles become data (RBAC v4).
 *
 * The three built-ins ship as is_system rows (baselines stay code-defined in
 * permissions.ts; the seeded permission JSON is intentionally empty). The
 * users.role CHECK from migration 026 is dropped by a rebuild so custom role
 * names can be referenced — custom roles are validated by app code instead.
 */
describe('migration 028 — custom roles', () => {
  it('seeds the three built-ins and lets users reference any role name', async () => {
    const SQL = await initSqlJs();
    const eng = await SqliteEngine.create(SQL, null);
    eng.migrate();

    const roles = eng.all<{ name: string; is_system: number }>('SELECT name, is_system FROM roles');
    expect(roles.map((r) => r.name).sort()).toEqual(['Audit Checker', 'Clinic Entry Manager', 'Super Admin']);
    expect(roles.every((r) => r.is_system === 1)).toBe(true);

    // The role CHECK is gone: a custom role name is now legal in users.
    eng.run(
      `INSERT INTO users (id, username, email, name, role, password_hash, password_salt, created_at)
       VALUES ('u1', 'sup', 'sup@localhost', 'Sup', 'Production Supervisor', 'h', 's', '2026-10-27')`
    );
    expect(eng.scalar("SELECT COUNT(*) FROM users WHERE role = 'Production Supervisor'")).toBe(1);
  });

  it('rejects a second definition of the same role name', async () => {
    const SQL = await initSqlJs();
    const eng = await SqliteEngine.create(SQL, null);
    eng.migrate();
    expect(() =>
      eng.run(
        `INSERT INTO roles (id, name, description, permissions, is_system, created_at)
         VALUES ('role-x', 'SUPER ADMIN', 'dupe', '[]', 0, datetime('now'))`
      )
    ).toThrow(); // UNIQUE COLLATE NOCASE — any case variant collides
  });
});
