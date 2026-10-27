import { describe, it, expect } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';

describe('migration 026 — RBAC v2 roles + user clinic scope', () => {
  it('fresh databases admit only the three v2 roles and ship user_clinics', async () => {
    const SQL = await initSqlJs();
    const eng = await SqliteEngine.create(SQL, null);
    eng.migrate();

    // Migration 028 relaxed the role CHECK: custom role names are data now,
    // validated by app code rather than the schema. The v2 roles still insert.
    eng.run(
      `INSERT INTO users (id, username, email, name, role, password_hash, password_salt, created_at)
       VALUES ('u1', 'entry', 'entry@localhost', 'Entry', 'Clinic Entry Manager', 'h', 's', '2026-10-26')`
    );
    eng.run(
      `INSERT INTO users (id, username, email, name, role, password_hash, password_salt, created_at)
       VALUES ('u2', 'audit', 'audit@localhost', 'Audit', 'Audit Checker', 'h', 's', '2026-10-26')`
    );
    eng.run(
      `INSERT INTO users (id, username, email, name, role, password_hash, password_salt, created_at)
       VALUES ('u3', 'tech', 'tech@localhost', 'T', 'Technician Supervisor', 'h', 's', '2026-10-26')`
    );
    const roles = eng.all<{ role: string }>('SELECT role FROM users ORDER BY id').map((r) => r.role);
    expect(roles.sort()).toEqual(['Audit Checker', 'Clinic Entry Manager', 'Technician Supervisor']);

    // user_clinics exists, keyed (user_id, lab_id), cascading on both parents.
    eng.run(
      `INSERT INTO users (id, username, email, name, role, password_hash, password_salt, created_at)
       VALUES ('u4', 'scoped', 'scoped@localhost', 'Scoped', 'Clinic Entry Manager', 'h', 's', '2026-10-26')`
    );
    eng.run(`INSERT INTO labs (id, name, created_at) VALUES ('lab-1', 'Clinic One', '2026-10-26')`);
    eng.run(`INSERT INTO user_clinics (user_id, lab_id, created_at) VALUES ('u4', 'lab-1', '2026-10-26')`);
    expect(eng.all('SELECT * FROM user_clinics')).toHaveLength(1);
    eng.run(`DELETE FROM users WHERE id = 'u4'`);
    expect(eng.all('SELECT * FROM user_clinics')).toHaveLength(0);
  });

  it('upgrades an existing database: every old role maps onto Super Admin', async () => {
    const SQL = await initSqlJs();
    const eng = await SqliteEngine.create(SQL, null);
    const { MIGRATIONS } = await import('../../src/db/migrations');
    eng.migrate(MIGRATIONS.filter((m: any) => m.version !== 26));

    // A v25 database: realistic live rows in the old four-role schema.
    const seed = (id: string, username: string, role: string) =>
      eng.run(
        `INSERT INTO users (id, username, email, name, role, password_hash, password_salt, created_at)
         VALUES (?, ?, ?, ?, ?, 'h', 's', '2026-10-01')`,
        [id, username, `${username}@localhost`, username, role]
      );
    seed('a1', 'adil', 'Super Admin');
    seed('a2', 'mateen', 'Billing Manager');
    seed('a3', 'hamza', 'Technician');
    seed('a4', 'sana', 'Lab Admin');
    seed('a5', 'hidden', 'Super Admin');

    eng.migrate([MIGRATIONS.find((m: any) => m.version === 26)!]);

    const rows = eng.all<{ id: string; role: string }>('SELECT id, role FROM users ORDER BY id');
    expect(rows.map((r) => r.role)).toEqual([
      'Super Admin', // adil
      'Super Admin', // mateen (was Billing Manager)
      'Super Admin', // hamza (was Technician)
      'Super Admin', // sana (was Lab Admin)
      'Super Admin', // hidden
    ]);
    // Passwords and flags survive the rebuild untouched.
    const adil = eng.get<{ password_hash: string; is_super_admin: number; is_hidden: number }>(
      `SELECT password_hash, is_super_admin, is_hidden FROM users WHERE id = 'a1'`
    );
    expect(adil?.password_hash).toBe('h');
    expect(adil?.is_super_admin).toBe(0);

    // Schema version advanced.
    const meta = eng.get<{ value: string }>(
      `SELECT value FROM app_meta WHERE key = 'schema_version'`
    );
    expect(meta?.value).toBe('26');
  });
});
