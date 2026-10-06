import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { schemaScript } from '../../src/db/migrations';
import { SQLITE_DDL_SCHEMA } from '../../src/services/sqliteStorage';

/**
 * The .sql / .dentalbackup export used to carry its own hand-written DDL
 * string. It had silently drifted from the live schema (no
 * `payment_attachments.owner_type`, ~30 tables missing), so a dump could not be
 * replayed into a database the app would recognise. The export DDL is now
 * `schemaScript()` — MIGRATIONS replayed verbatim — which makes drift
 * structurally impossible, but only if the replayed script actually runs and
 * lands on exactly the schema a migrated engine has.
 *
 * These tests are that proof: they execute the generated DDL against a fresh
 * sql.js database and compare it, object for object, to `SqliteEngine.migrate()`.
 */

let SQL: any;
let migrated: SqliteEngine;

function blankDb(): any {
  const db = new SQL.Database(null);
  db.run('PRAGMA foreign_keys = ON');
  return db;
}

/** Every user object of a type in a raw sql.js database, internal ones excluded. */
function objectsOf(db: any, type: string): string[] {
  const res = db.exec(`SELECT name FROM sqlite_master WHERE type = '${type}' AND name NOT LIKE 'sqlite_%'`);
  if (!res.length) return [];
  return res[0].values.map((v: any[]) => String(v[0])).sort();
}

/** Column name + type + NOT NULL for every table, so a diff cannot hide in a name. */
function columnShape(db: any): Record<string, string[]> {
  const shape: Record<string, string[]> = {};
  for (const table of objectsOf(db, 'table')) {
    shape[table] = db
      .exec(`PRAGMA table_info(${table})`)[0]
      .values.map((v: any[]) => `${v[1]}:${v[2]}:${v[3] ? 1 : 0}`);
  }
  return shape;
}

beforeAll(async () => {
  SQL = await initSqlJs();
  migrated = await SqliteEngine.create(SQL, null);
  migrated.migrate();
});

describe('export DDL == live schema', () => {
  it('executes cleanly against a blank database', () => {
    const db = blankDb();
    expect(() => db.run(schemaScript())).not.toThrow();
    db.close();
  });

  it('creates the same tables as a migrated engine', () => {
    const db = blankDb();
    db.run(schemaScript());
    expect(objectsOf(db, 'table')).toEqual(objectsOf(rawMigrated(), 'table'));
    db.close();
  });

  it('gives every table the same columns, types and NOT NULL flags', () => {
    const db = blankDb();
    db.run(schemaScript());
    expect(columnShape(db)).toEqual(columnShape(rawMigrated()));
    db.close();
  });

  it('creates the same indexes', () => {
    const db = blankDb();
    db.run(schemaScript());
    expect(objectsOf(db, 'index')).toEqual(objectsOf(rawMigrated(), 'index'));
    db.close();
  });

  it('creates the same triggers', () => {
    const db = blankDb();
    db.run(schemaScript());
    expect(objectsOf(db, 'trigger')).toEqual(objectsOf(rawMigrated(), 'trigger'));
    db.close();
  });

  it('creates the same views', () => {
    const db = blankDb();
    db.run(schemaScript());
    expect(objectsOf(db, 'view')).toEqual(objectsOf(rawMigrated(), 'view'));
    db.close();
  });

  it('ends at the current schema version', () => {
    const db = blankDb();
    db.run(schemaScript());
    const version = (db.exec("SELECT value FROM app_meta WHERE key = 'schema_version'")[0].values[0][0]);
    expect(Number(version)).toBe(Number(migrated.scalar("SELECT value FROM app_meta WHERE key = 'schema_version'")));
    db.close();
  });

  it('carries the attachment owner_type column the hand-written DDL lacked', () => {
    const db = blankDb();
    db.run(schemaScript());
    const cols = db.exec('PRAGMA table_info(payment_attachments)')[0].values.map((v: any[]) => v[1]);
    expect(cols).toContain('owner_type');
    db.close();
  });

  it('declares doc_sequences, the table only the runtime used to create', () => {
    // Created lazily by ensureSequenceTable()/the seeder, so it was in every
    // real database and in no migration — and therefore absent from the export
    // until migration 018. A dump without the document-number counters reissues
    // numbers that already exist.
    const db = blankDb();
    db.run(schemaScript());
    expect(objectsOf(db, 'table')).toContain('doc_sequences');
    db.close();
  });

  

  it('SQLITE_DDL_SCHEMA is exactly the script the migrations produce', () => {
    expect(SQLITE_DDL_SCHEMA).toBe(schemaScript());
    expect(SQLITE_DDL_SCHEMA).toContain('-- ── migration 16: payment_attachment_owner ──');
  });
});

// The migrated engine keeps its handle private; comparing against a raw handle
// means re-opening the bytes it exported. Cached: export() serializes the whole
// database and every caller here only needs to read the schema.
let migratedBytes: Uint8Array | null = null;
function rawMigrated(): any {
  if (!migratedBytes) migratedBytes = migrated.export();
  return new SQL.Database(migratedBytes);
}