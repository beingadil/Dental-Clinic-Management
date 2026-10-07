import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  analyzeSqlDump,
  splitSqlStatements,
  stripSqlComments,
  parseSqlDumpHeader,
  importSqlDump,
} from '../../src/services/sqlDumpImport';
import { setDatabase, getDatabase, isDatabaseReady } from '../../src/db/core';
import { SqliteEngine } from '../../src/db/engine';
import { generateSqliteExport } from '../../src/services/sqliteStorage';
import * as snapshotStore from '../../src/services/safetySnapshotStore';

/**
 * The `.sql` importer must be as careful as the restore it is a sibling of.
 *
 * Importing a dump REPLACES the clinic's live database, so the file is untrusted
 * input arriving from a USB stick. Three properties are therefore load-bearing:
 *
 *   - validation happens in a throwaway database, so a malformed file cannot
 *     reach the live engine at all;
 *   - the report the operator confirms against never contains a cell value,
 *     because the file carries `users.password_hash`;
 *   - statements that escape the WASM sandbox (`ATTACH`, `VACUUM INTO`,
 *     `load_extension`) are refused rather than executed — sql.js permits all
 *     of them, and two of them write files to the host.
 *
 * The `run()` trap is asserted explicitly too: `db.run(sql, [])` silently
 * executes nothing, so an importer written against `run()` would "succeed" on
 * an empty database and wipe the clinic's data. That is exactly the class of
 * failure this suite exists to catch.
 */

vi.mock('../../src/services/safetySnapshotStore', () => ({
  saveSafetySnapshot: vi.fn(async () => 'indexeddb' as const),
}));

/** A dump with a users row whose hash must never surface in the report. */
const CREDENTIAL = 'pbkdf2$240000$deadbeefcafe';

function handcraftedDump(extra = ''): string {
  const schema = [
    `CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);`,
    `INSERT INTO schema_migrations VALUES (1,'init','2026-01-01T00:00:00.000Z');`,
    `CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, password_hash TEXT, password_salt TEXT, name TEXT);`,
    `INSERT INTO users VALUES ('u1','labadmin','${CREDENTIAL}','c0ffee','Lab Admin');`,
    `CREATE TABLE labs (id TEXT PRIMARY KEY, name TEXT, address TEXT);`,
    `INSERT INTO labs VALUES ('lab-1','Bright Smiles','12-C Gulberg; not a statement break');`,
    `CREATE TABLE cases (id TEXT PRIMARY KEY, case_number TEXT, patient_name TEXT, notes TEXT);`,
    `INSERT INTO cases VALUES ('case-1','DS-0001','Ayesha Khan','note with a ; semicolon and -- dashes');`,
    `CREATE TABLE invoices (id TEXT PRIMARY KEY, invoice_number TEXT, amount REAL);`,
    `INSERT INTO invoices VALUES ('inv-1','INV-0001',23000);`,
  ].join('\n');
  return [
    `-- ========================================================================`,
    `-- DENTAL SOLUTIONS LABORATORY ERP - SQLITE PRODUCTION DATABASE EXPORT`,
    `-- Export Date: 2026-10-06T12:00:00.000Z`,
    `-- Laboratory: Round Trip Dental`,
    `-- Tables: 5 | Rows: 5`,
    `-- Contains credential hashes; store it like a password.`,
    `-- ========================================================================`,
    `PRAGMA foreign_keys = OFF;`,
    `BEGIN TRANSACTION;`,
    schema + extra,
    `COMMIT;`,
    `PRAGMA foreign_keys = ON;`,
  ].join('\n');
}

describe('splitSqlStatements', () => {
  it('splits on top-level semicolons only', () => {
    const statements = splitSqlStatements(
      `CREATE TABLE a(x);\nINSERT INTO a VALUES ('semi; colon');\n-- trailing comment ;\nINSERT INTO a VALUES ('a--b');`,
    );
    expect(statements).toHaveLength(3);
    expect(statements[1]).toContain("'semi; colon'");
    expect(statements[2]).toContain("'a--b'");
  });

  it('does not split on a semicolon inside a comment', () => {
    const statements = splitSqlStatements(`-- one; two\n/* three; four */ SELECT 1;`);
    expect(statements).toHaveLength(1);
  });

  it('keeps semicolons inside quoted and bracketed identifiers intact', () => {
    const statements = splitSqlStatements(`SELECT "we;ird", [al;so] FROM t; SELECT 2;`);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('"we;ird"');
    expect(statements[0]).toContain('[al;so]');
  });

  it('handles a doubled quote inside a string literal', () => {
    const statements = splitSqlStatements(`INSERT INTO t VALUES ('O''Brien; Jr'); SELECT 1;`);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("O''Brien; Jr");
  });

  it('strips comments for classification', () => {
    expect(stripSqlComments(`-- ATTACH DATABASE '/x' AS y\nSELECT 1`).trim()).toBe('SELECT 1');
  });

  // Regression: the CASE/BEGIN/END guards test `keyword + one lookahead char`.
  // Slicing exactly the keyword made `\b` match at the end of the slice, so
  // `cases`, `case_types` and `case_number` were rewritten to uppercase `CASE`
  // and the imported database ended up with a table literally named `CASEs` —
  // which then failed the app's own required-table check.
  it('leaves identifiers that merely start with "case" untouched', () => {
    const statements = splitSqlStatements(
      `CREATE TABLE cases (case_number TEXT);\nCREATE TABLE case_types (id TEXT);\n` +
        `INSERT INTO cases (case_number) VALUES ('DS-1');`,
    );
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain('CREATE TABLE cases (case_number TEXT)');
    expect(statements[1]).toContain('CREATE TABLE case_types');
    expect(statements[2]).toContain('INSERT INTO cases');
  });

  it('keeps a trigger that contains a CASE expression in one statement', () => {
    const statements = splitSqlStatements(
      `CREATE TRIGGER audit_x AFTER INSERT ON cases BEGIN\n` +
        `  INSERT INTO audit_events (entity_type) SELECT CASE WHEN new.case_number IS NULL THEN 'none' ELSE 'case' END;\n` +
        `END;\n` +
        `INSERT INTO cases (case_number) VALUES ('DS-2');`,
    );
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('CREATE TRIGGER');
    expect(statements[0]).toContain('END;');
    expect(statements[1]).toContain(`'DS-2'`);
  });

  it('does not mistake BEGIN TRANSACTION for a trigger body', () => {
    const statements = splitSqlStatements(
      `BEGIN TRANSACTION;\nINSERT INTO t VALUES (1);\nCOMMIT;\nBEGIN;\nINSERT INTO t VALUES (2);\nCOMMIT;`,
    );
    expect(statements).toHaveLength(6);
  });
});

describe('parseSqlDumpHeader', () => {
  it('reads only the known header keys', () => {
    const header = parseSqlDumpHeader(handcraftedDump());
    expect(header.exportedAt).toBe('2026-10-06T12:00:00.000Z');
    expect(header.labName).toBe('Round Trip Dental');
    expect(header.declaredTables).toBe(5);
    expect(header.declaredRows).toBe(5);
  });

  it('is empty for a file with no header', () => {
    expect(parseSqlDumpHeader(`CREATE TABLE a(x);`).labName).toBeUndefined();
  });
});

describe('analyzeSqlDump', () => {
  it('accepts a valid dump and reports its contents', async () => {
    const report = await analyzeSqlDump(handcraftedDump());
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.tableCounts).toEqual({
      users: 1, labs: 1, cases: 1, invoices: 1, schema_migrations: 1,
    });
    expect(report.totalRows).toBe(5);
    expect(report.schemaVersion).toBe(1);
    expect(report.containsCredentials).toBe(true);
    expect(report.bytes).toBeInstanceOf(Uint8Array);
    expect((report.bytes as Uint8Array).length).toBeGreaterThan(0);
  });

  it('produces bytes that open as a real database with the rows intact', async () => {
    const report = await analyzeSqlDump(handcraftedDump());
    const SQL = (await import('sql.js')).default;
    const sql = await SQL();
    const db = new sql.Database(report.bytes!);
    // The semicolon inside the free-text column survived the split and the load.
    expect(db.exec(`SELECT address FROM labs`)[0].values[0][0]).toBe('12-C Gulberg; not a statement break');
    expect(db.exec(`SELECT notes FROM cases`)[0].values[0][0]).toBe('note with a ; semicolon and -- dashes');
    expect(db.exec('PRAGMA integrity_check')[0].values[0][0]).toBe('ok');
    db.close();
  });

  it('never puts credential material in the report', async () => {
    const report = await analyzeSqlDump(handcraftedDump());
    const serialised = JSON.stringify({
      errors: report.errors,
      warnings: report.warnings,
      tableCounts: report.tableCounts,
      header: report.header,
    });
    expect(serialised).not.toContain(CREDENTIAL);
    expect(serialised).not.toContain('c0ffee');
    expect(serialised).not.toContain('pbkdf2');
    // ...but the operator IS told the file holds credentials.
    expect(report.containsCredentials).toBe(true);
    expect(report.warnings.join(' ')).toMatch(/password hashes/i);
  });

  it('rejects an empty file', async () => {
    const report = await analyzeSqlDump('   \n  ');
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toMatch(/empty/i);
    expect(report.bytes).toBeUndefined();
  });

  it('rejects a file that is not SQL at all', async () => {
    const report = await analyzeSqlDump('Dear team, here are the numbers.\nRegards, Bilal');
    expect(report.ok).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.bytes).toBeUndefined();
  });

  it('names the failing statement instead of dying opaquely', async () => {
    const broken = handcraftedDump('INSERT INTO no_such_table VALUES (1);');
    const report = await analyzeSqlDump(broken);
    expect(report.ok).toBe(false);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].snippet).toContain('no_such_table');
    expect(report.errors.join(' ')).toMatch(/could not be applied/i);
  });

  it('refuses a dump with no Dental Solutions tables', async () => {
    const foreign = [
      `CREATE TABLE unrelated (id INTEGER);`,
      `INSERT INTO unrelated VALUES (1);`,
    ].join('\n');
    const report = await analyzeSqlDump(foreign);
    expect(report.ok).toBe(false);
    expect(report.errors.join(' ')).toMatch(/not a Dental Solutions database/);
  });

  it('refuses a dump with no migration ledger', async () => {
    const noLedger = [
      `CREATE TABLE users (id TEXT);`,
      `CREATE TABLE labs (id TEXT);`,
      `CREATE TABLE cases (id TEXT);`,
      `CREATE TABLE invoices (id TEXT);`,
    ].join('\n');
    const report = await analyzeSqlDump(noLedger);
    expect(report.ok).toBe(false);
    expect(report.errors.join(' ')).toMatch(/schema_migrations/);
  });

  it('refuses a dump from a newer schema than this build supports', async () => {
    const future = handcraftedDump().replace(
      `INSERT INTO schema_migrations VALUES (1,'init','2026-01-01T00:00:00.000Z');`,
      `INSERT INTO schema_migrations VALUES (999,'from the future','2027-01-01T00:00:00.000Z');`,
    );
    const report = await analyzeSqlDump(future);
    expect(report.ok).toBe(false);
    expect(report.errors.join(' ')).toMatch(/Update the application/i);
  });

  it('accepts an older dump and says it will be upgraded', async () => {
    const report = await analyzeSqlDump(handcraftedDump());
    expect(report.warnings.join(' ')).toMatch(/upgrade it to v/i);
  });

  describe('sandbox escapes', () => {
    const cases: [string, string, RegExp][] = [
      ['ATTACH', `ATTACH DATABASE '/tmp/evil.db' AS evil;`, /ATTACH/],
      ['DETACH', `DETACH DATABASE evil;`, /DETACH/],
      ['VACUUM INTO', `VACUUM INTO '/tmp/evil.db';`, /VACUUM INTO/],
      ['load_extension', `SELECT load_extension('/tmp/evil.so');`, /load_extension/],
      ['readfile', `SELECT readfile('/etc/passwd');`, /file I\/O/],
    ];
    for (const [label, statement, pattern] of cases) {
      it(`refuses ${label} and reports it as rejected`, async () => {
        const report = await analyzeSqlDump(handcraftedDump(statement));
        expect(report.ok).toBe(false);
        const rejection = report.rejected.find((r) => pattern.test(r.reason));
        expect(rejection, `expected a rejection matching ${pattern} in ${JSON.stringify(report.rejected)}`).toBeTruthy();
        expect(report.errors.join(' ')).toMatch(/could not be applied/i);
        expect(report.bytes).toBeUndefined();
      });
    }

    it('refuses a disallowed PRAGMA but allows foreign_keys', async () => {
      const bad = await analyzeSqlDump(handcraftedDump(`PRAGMA writable_schema = ON;`));
      expect(bad.ok).toBe(false);
      expect(bad.rejected.some((r) => /PRAGMA/.test(r.reason))).toBe(true);

      // The dump's own `PRAGMA foreign_keys = OFF` must NOT be treated as hostile.
      const good = await analyzeSqlDump(handcraftedDump());
      expect(good.rejected).toEqual([]);
    });

    it('does not let a blocked statement execute — the data statements still load', async () => {
      const report = await analyzeSqlDump(
        handcraftedDump(`ATTACH DATABASE '/tmp/sqlDumpImport_should_not_exist.db' AS evil;`),
      );
      // The rest of the script still loaded, which is what makes the rejected
      // list informative rather than all-or-nothing.
      expect(report.tableCounts.cases).toBe(1);
    });
  });
});

/** In-memory localStorage so `persistEngineNow` has somewhere to write. */
function memoryLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
  } as Storage;
}

/**
 * A dump a real clinic could actually have: this build's full schema plus a
 * handful of rows, produced by the app's own exporter.
 *
 * The minimal handcrafted fixture above is the right shape for testing the
 * ANALYZER (it fails fast on missing tables), but it cannot be imported: the
 * swap re-runs `migrate()` against the incoming bytes, and a four-table
 * hand-written schema has no `app_meta` for migration 4 to write to. The import
 * tests therefore seed a real engine and dump it.
 */
async function seededDump(sql: any, restoreTo: SqliteEngine | null = null): Promise<string> {
  const src = await SqliteEngine.create(sql, null);
  src.migrate();
  const ts = '2026-10-01T00:00:00.000Z';
  src.run(
    `INSERT INTO users (id, username, email, name, role, password_hash, password_salt, is_super_admin, is_active, created_at, updated_at)
     VALUES ('u1','labadmin','admin@localhost','Lab Admin','Lab Admin',?,'c0ffee',0,1,?,?)`,
    [CREDENTIAL, ts, ts],
  );
  src.run(
    `INSERT INTO labs (id, name, code, contact_person, phone, email, address, city, doctor_name, notes, rating, reviews_count, created_at)
     VALUES ('lab-1','Bright Smiles','BS-01','Dr. Rao','+92-300-1112223','hi@bright.example','12-C Gulberg; not a statement break','Karachi','Dr. Rao','ok',5,1,?)`,
    [ts],
  );
  src.run(
    `INSERT INTO cases (id, case_number, patient_name, lab_id, lab_name, doctor_name, delivery_date, instructions, created_at, updated_at)
     VALUES ('case-1','DS-0001','Ayesha Khan','lab-1','Bright Smiles','Dr. Rao','2026-10-05','note with a ; semicolon and -- dashes',?,?)`,
    [ts, ts],
  );
  src.run(
    `INSERT INTO invoices (id, invoice_number, lab_id, lab_name, amount, final_amount, created_at)
     VALUES ('inv-1','INV-0001','lab-1','Bright Smiles',23000,23000,?)`,
    [ts],
  );
  // The exporter reads the LIVE engine, so the seeded copy has to be live for
  // the duration of the dump — then the caller's engine goes back.
  setDatabase(src);
  const dump = generateSqliteExport({ labName: 'Imported Dental' });
  src.close();
  setDatabase(restoreTo);
  return dump;
}

describe('importSqlDump', () => {
  let live: SqliteEngine;
  let sql: any;
  const saved = (snapshotStore.saveSafetySnapshot as any);

  beforeEach(async () => {
    // mockReset, not mockClear: a queued one-shot rejection from an earlier
    // test must not survive into the next one.
    saved.mockReset();
    saved.mockImplementation(async () => 'indexeddb' as any);
    // The import has to survive a restart, so it must actually persist; without
    // a storage shim every swap fails at the write-back step.
    (globalThis as any).localStorage = memoryLocalStorage();
    const SQL = (await import('sql.js')).default;
    sql = await SQL();
    live = await SqliteEngine.create(sql, null);
    live.migrate();
    setDatabase(live);
  });

  it('takes a safety snapshot of the OUTGOING database before swapping', async () => {
    const report = await analyzeSqlDump(await seededDump(sql, live));
    expect(report.ok).toBe(true);
    await importSqlDump(report);

    expect(saved).toHaveBeenCalledTimes(1);
    const [bytes, meta] = saved.mock.calls[0];
    expect(bytes).toBeInstanceOf(Uint8Array);
    // It must be the PRE-import database, i.e. still readable as the app's own.
    expect(new TextDecoder().decode(bytes.subarray(0, 15))).toBe('SQLite format 3');
    expect(meta.schemaVersion).toBe(19);
  });

  it('installs the dump and reports what came in', async () => {
    const report = await analyzeSqlDump(await seededDump(sql, live));
    const outcome = await importSqlDump(report);
    expect(outcome.schemaVersion).toBeGreaterThanOrEqual(18);
    // A dump taken by this build is already current, so nothing is upgraded.
    expect(outcome.upgraded).toBe(false);

    const db = getDatabase();
    expect(db.scalar(`SELECT username FROM users WHERE id = 'u1'`)).toBe('labadmin');
    expect(db.scalar(`SELECT address FROM labs WHERE id = 'lab-1'`)).toBe('12-C Gulberg; not a statement break');
    expect(db.scalar(`SELECT instructions FROM cases WHERE id = 'case-1'`)).toBe('note with a ; semicolon and -- dashes');
    expect(db.scalar(`SELECT amount FROM invoices WHERE id = 'inv-1'`)).toBe(23000);
    // The credential row came across — that is what a restore means — even
    // though it was never shown to the operator.
    expect(db.scalar(`SELECT password_hash FROM users WHERE id = 'u1'`)).toBe(CREDENTIAL);
  });

  it('refuses to import a dump that did not validate, and changes nothing', async () => {
    const before = getDatabase().scalar(`SELECT COUNT(*) FROM sqlite_master`);
    const report = await analyzeSqlDump(`CREATE TABLE unrelated (id INTEGER); INSERT INTO unrelated VALUES (1);`);
    expect(report.ok).toBe(false);

    await expect(importSqlDump(report)).rejects.toThrow(/not a Dental Solutions database/i);
    expect(saved).not.toHaveBeenCalled();
    expect(getDatabase()).toBe(live);
    expect(getDatabase().scalar(`SELECT COUNT(*) FROM sqlite_master`)).toBe(before);
  });

  it('refuses an analysis with no bytes even when ok is true', async () => {
    const report = await analyzeSqlDump(await seededDump(sql, live));
    await expect(importSqlDump({ ...report, bytes: undefined })).rejects.toThrow(/did not validate/i);
    expect(saved).not.toHaveBeenCalled();
    expect(getDatabase()).toBe(live);
  });

  it('aborts and leaves the live database in place when the snapshot cannot be written', async () => {
    saved.mockRejectedValueOnce(new Error('quota exceeded'));
    const report = await analyzeSqlDump(await seededDump(sql, live));

    await expect(importSqlDump(report)).rejects.toThrow(/safety copy could not be written/i);
    // The whole point of enforcing the snapshot: nothing was replaced.
    expect(getDatabase()).toBe(live);
    expect(getDatabase().scalar(`SELECT username FROM users WHERE id = 'u1'`)).toBeUndefined();
  });
});

describe('importer against the real exporter', () => {
  beforeEach(() => {
    setDatabase(null);
    (globalThis as any).localStorage = memoryLocalStorage();
  });

  it('round-trips the app\'s own dump through analyze without loss', async () => {
    // Build a small live database, dump it, and analyse the result — the path a
    // clinic actually takes, rather than a handcrafted fixture.
    const SQL = (await import('sql.js')).default;
    const sql = await SQL();
    const eng = await SqliteEngine.create(sql, null);
    eng.migrate();
    setDatabase(eng);
    eng.run(
      `INSERT INTO users (id, username, email, name, role, password_hash, password_salt, is_super_admin, is_active, created_at, updated_at)
       VALUES ('u9','tech','tech@localhost','Tech','Technician','${CREDENTIAL}','c0ffee',0,1,?,?)`,
      ['2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'],
    );
    eng.run(
      `INSERT INTO labs (id, name, code, contact_person, phone, email, address, city, doctor_name, notes, rating, reviews_count, created_at)
       VALUES ('lab-9','Smile Studio','SS-01','Dr. Rao','+92-300-9998887','hi@smile.example','C:\\Lab\\shared','Karachi','Dr. Rao','ok',5,1,?)`,
      ['2026-10-01T00:00:00.000Z'],
    );

    const script = generateSqliteExport({ labName: 'Analysed Dental' });
    const report = await analyzeSqlDump(script);

    expect(report.errors).toEqual([]);
    expect(report.rejected).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.schemaVersion).toBe(19);
    expect(report.header.labName).toBe('Analysed Dental');
    expect(report.tableCounts.users).toBe(1);
    expect(report.tableCounts.labs).toBe(1);
    expect(report.containsCredentials).toBe(true);
    // The exporter's own header claim must agree with what actually loaded.
    expect(report.totalRows).toBe(report.header.declaredRows);

    // And the analysed bytes hold the real values, backslash included.
    const db = new sql.Database(report.bytes!);
    expect(db.exec(`SELECT address FROM labs WHERE id='lab-9'`)[0].values[0][0]).toBe('C:\\Lab\\shared');
    expect(db.exec(`SELECT password_hash FROM users WHERE id='u9'`)[0].values[0][0]).toBe(CREDENTIAL);
    db.close();

    setDatabase(null);
  });

  it('imports the app\'s own dump back over the live database', async () => {
    const SQL = (await import('sql.js')).default;
    const sql = await SQL();
    const eng = await SqliteEngine.create(sql, null);
    eng.migrate();
    setDatabase(eng);
    eng.run(
      `INSERT INTO users (id, username, email, name, role, password_hash, password_salt, is_super_admin, is_active, created_at, updated_at)
       VALUES ('u9','tech','tech@localhost','Tech','Technician','${CREDENTIAL}','c0ffee',0,1,?,?)`,
      ['2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'],
    );

    const report = await analyzeSqlDump(generateSqliteExport({ labName: 'Round Trip' }));
    expect(report.ok).toBe(true);
    const outcome = await importSqlDump(report);

    // A dump of this build carries the full ledger, so nothing is upgraded.
    expect(outcome.upgraded).toBe(false);
    expect(outcome.schemaVersion).toBe(19);
    expect(getDatabase().scalar(`SELECT username FROM users WHERE id='u9'`)).toBe('tech');
    expect(isDatabaseReady()).toBe(true);
  });
});