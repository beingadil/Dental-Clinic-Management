import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine, DbError } from '../../src/db/engine';
import { MIGRATIONS } from '../../src/db/migrations';

let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
});

describe('migrations', () => {
  it('applies all migrations once and records versions', () => {
    const versions = engine.all<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('is idempotent on re-run', () => {
    const { applied, skipped } = engine.migrate();
    expect(applied).toHaveLength(0);
    expect(skipped).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('creates the expected core tables', () => {
    for (const t of ['users', 'labs', 'cases', 'invoices', 'payments', 'ledger_entries', 'audit_events', 'settings']) {
      expect(engine.tableExists(t)).toBe(true);
    }
  });
});

describe('transactions', () => {
  it('commits when the body succeeds', () => {
    engine.transaction((tx) => {
      tx.run("INSERT INTO labs (id, name, created_at) VALUES ('lab-1', 'Bright Smiles Clinic', '2026-01-01')");
    });
    expect(engine.get("SELECT name FROM labs WHERE id = 'lab-1'")).toBeTruthy();
  });

  it('rolls back everything when the body throws', () => {
    expect(() =>
      engine.transaction((tx) => {
        tx.run("INSERT INTO labs (id, name, created_at) VALUES ('lab-2', 'Will Rollback', '2026-01-01')");
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(engine.get("SELECT id FROM labs WHERE id = 'lab-2'")).toBeUndefined();
  });

  it('supports nested savepoints', () => {
    engine.withTransaction((tx) => {
      tx.run("INSERT INTO labs (id, name, created_at) VALUES ('lab-3', 'Nested Savepoint', '2026-01-01')");
    });
    expect(engine.get("SELECT id FROM labs WHERE id = 'lab-3'")).toBeTruthy();
  });
});

describe('constraints', () => {
  it('enforces UNIQUE on labs.name (case-insensitive)', () => {
    expect(() =>
      engine.run("INSERT INTO labs (id, name, created_at) VALUES ('lab-4', 'BRIGHT SMILES CLINIC', '2026-01-01')")
    ).toThrow();
  });

  it('enforces CHECK on case status', () => {
    expect(() =>
      engine.run(
        "INSERT INTO cases (id, case_number, lab_id, lab_name, doctor_name, delivery_date, status, created_at, updated_at) VALUES ('c-x', 'DS-9999', 'lab-1', 'Bright Smiles Clinic', 'Dr. Who', '2026-02-01', 'flying', '2026-01-01', '2026-01-01')"
      )
    ).toThrow();
  });

  it('enforces positive payment amounts', () => {
    expect(() =>
      engine.run(
        "INSERT INTO payments (id, amount, payment_method, payment_date, recorded_by, created_at) VALUES ('p-x', -5, 'cash', '2026-01-01', 'tester', '2026-01-01')"
      )
    ).toThrow();
  });

  it('cascades case deletion to notes, history and teeth', () => {
    engine.run(
      "INSERT INTO cases (id, case_number, lab_id, lab_name, doctor_name, delivery_date, status, created_at, updated_at, selected_teeth) VALUES ('c-1', 'DS-0001', 'lab-1', 'Bright Smiles Clinic', 'Dr. Who', '2026-02-01', 'received', '2026-01-01', '2026-01-01', '[11,12]')"
    );
    engine.run("INSERT INTO case_notes (id, case_id, note_text, author, created_at) VALUES ('n-1', 'c-1', 'note', 'tech', '2026-01-02')");
    engine.run("INSERT INTO case_status_history (id, case_id, status, timestamp, updated_by) VALUES ('h-1', 'c-1', 'received', '2026-01-01', 'sys')");
    engine.run("INSERT INTO case_teeth (case_id, tooth_number) VALUES ('c-1', 11)");

    engine.run('DELETE FROM cases WHERE id = ?', ['c-1']);
    expect(engine.get("SELECT id FROM case_notes WHERE case_id = 'c-1'")).toBeUndefined();
    expect(engine.get("SELECT id FROM case_status_history WHERE case_id = 'c-1'")).toBeUndefined();
    expect(engine.get("SELECT tooth_number FROM case_teeth WHERE case_id = 'c-1'")).toBeUndefined();
  });
});

describe('json codec and helpers', () => {
  it('round-trips JSON values', () => {
    const value = { 11: { shade: 'A2', prep_type: 'crown' } };
    const encoded = engine.encodeJson(value);
    expect(engine.decodeJson<any>(encoded, {})).toEqual(value);
    expect(engine.decodeJson(null, 'fallback')).toBe('fallback');
    expect(engine.decodeJson('not-json{', 'fallback')).toBe('fallback');
  });

  it('converts int booleans', () => {
    expect(engine.intBool(1)).toBe(true);
    expect(engine.intBool(0)).toBe(false);
    expect(engine.intBool(null, true)).toBe(true);
    expect(engine.intBool('true')).toBe(true);
  });

  it('rejects invalid table names in helpers', () => {
    expect(() => engine.rowCount('users; DROP TABLE users')).toThrow(DbError);
    expect(() => engine.tableExists('not-a-table!')).toThrow(DbError);
  });
});

describe('integrity', () => {
  it('passes foreign_key_check on a clean database', () => {
    expect(engine.foreignKeyCheck()).toEqual([]);
  });
});
