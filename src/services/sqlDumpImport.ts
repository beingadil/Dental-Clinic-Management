import { createScratchEngine } from '../db';
import { isDatabaseReady, getDatabase } from '../db/core';
import type { SqliteEngine } from '../db/engine';
import { LATEST_SCHEMA_VERSION, applyRestoredBytes } from './backupService';
import { saveSafetySnapshot } from './safetySnapshotStore';

/**
 * `.sql` dump importer.
 *
 * The export button writes a `sqlite3 .dump`-shaped script containing every
 * table of the live database. Until now the only way to load one was the
 * `sqlite3` CLI — so "restore this dump on the new clinic PC" meant installing a
 * tool the technician does not have, and "what is actually in this file?" meant
 * reading it by hand.
 *
 * The import runs in three enforced steps:
 *
 *   1. ANALYSE — the script is replayed into a THROWAWAY in-memory database.
 *      The live engine is not reachable from that code path at all, so a
 *      malformed or hostile file can do no damage. The throwaway database is
 *      also what produces the preview (tables, rows, schema version) the
 *      operator confirms against.
 *   2. SNAPSHOT — a full copy of the outgoing database is written before the
 *      swap, and a failure to write it ABORTS the import. An import that cannot
 *      be undone must not run.
 *   3. SWAP — the validated bytes go through `applyRestoredBytes`, the same
 *      path a `.dentalbackup` restore uses, so the permission check, integrity
 *      check, persistence re-arm and rollback-on-failure are shared rather than
 *      reimplemented.
 *
 * SECURITY: a `.sql` dump contains `users.password_hash` / `password_salt`.
 * The report exposes only row COUNTS and schema facts — never a cell value —
 * and the preview panel never renders a data row. The importer also refuses
 * scripts that can reach outside the sandbox (`ATTACH`, `DETACH`,
 * `VACUUM INTO` and `load_extension` all touch the host from inside WASM).
 */

/** Refuse absurd input rather than freezing the webview on a huge file. */
export const MAX_DUMP_BYTES = 64 * 1024 * 1024;

/** Tables whose presence means the dump carries credential material. */
const CREDENTIAL_TABLES = ['users'];

export interface SqlDumpHeader {
  /** `-- Export Date:` from the exporter's header comment. */
  exportedAt?: string;
  /** `-- Laboratory:` from the exporter's header comment. */
  labName?: string;
  /** `-- Tables: N | Rows: M` as claimed by the exporter. */
  declaredTables?: number;
  declaredRows?: number;
}

export interface RejectedStatement {
  /** 1-based position within the script. */
  index: number;
  reason: string;
  /** First ~120 characters, so the operator can find the statement. */
  snippet: string;
}

export interface SqlDumpReport {
  ok: boolean;
  /** Blocking problems — a non-empty list means the import is refused. */
  errors: string[];
  /** Non-blocking observations worth showing before confirming. */
  warnings: string[];
  header: SqlDumpHeader;
  /** Schema version found in the dump's own migration ledger. */
  schemaVersion: number;
  /** Row counts for populated tables only. */
  tableCounts: Record<string, number>;
  totalRows: number;
  /** Statements skipped rather than executed (blocked or failed). */
  rejected: RejectedStatement[];
  /** True when the dump holds `users` rows — i.e. credential hashes. */
  containsCredentials: boolean;
}

export interface SqlDumpAnalysis extends SqlDumpReport {
  /** The validated database as SQLite bytes. Present only when `ok`. */
  bytes?: Uint8Array;
}

export interface SqlImportOutcome {
  rowsImported: number;
  schemaVersion: number;
  /** True when the dump's ledger was behind this build and got upgraded. */
  upgraded: boolean;
  /** True when the dump was produced by a different app version. */
  crossVersion: boolean;
}

// ------------------------------------------------------------- statement split

/**
 * Splits a SQL script into statements on top-level semicolons.
 *
 * A regex split is wrong here and dangerously so: `;` is legal inside a string
 * literal, inside a comment, and inside a `[bracketed]`, `"quoted"` or
 * `` `backticked` `` identifier. The clinic's own dumps contain free text (case
 * notes, addresses, audit payloads) where a naive split would cut a statement
 * in half — and the pieces could be individually valid, so the engine would
 * accept a corrupted load instead of failing.
 *
 * Trigger bodies are the hard case: `CREATE TRIGGER ... BEGIN <stmt>; <stmt>; END;`
 * contains semicolons that do NOT end a statement. This app's own schema
 * creates such triggers, so a splitter that ignored them broke the app's dumps
 * — the first version reported six rejected statements for a perfectly valid
 * export. `triggerDepth` tracks the BEGIN/END nesting so the inner semicolons
 * are kept with their statement.
 */
export function splitSqlStatements(script: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  const n = script.length;
  // Inside a CREATE TRIGGER body, `BEGIN` opens and `END` closes. Only then is
  // a `;` a real statement terminator.
  let triggerDepth = 0;
  // Whether the statement currently being accumulated is a CREATE TRIGGER. This
  // is the decisive context check: without it a plain `BEGIN;` (a transaction
  // with no keyword) is indistinguishable from a trigger body, and one bare
  // BEGIN would swallow the rest of the script. `BEGIN TRANSACTION` alone was
  // not enough — dumps legitimately contain both.
  let inTriggerStatement = false;
  // CASE...END blocks, which nest independently of trigger bodies.
  let caseDepth = 0;

  while (i < n) {
    const ch = script[i];
    const next = script[i + 1];

    // -- line comment
    if (ch === '-' && next === '-') {
      const end = script.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      current += script.slice(i, stop);
      i = stop;
      continue;
    }

    // /* block comment */
    if (ch === '/' && next === '*') {
      const end = script.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      current += script.slice(i, stop);
      i = stop;
      continue;
    }

    // 'string' — a doubled '' is an escaped quote, not a terminator
    if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (script[j] === "'") {
          if (script[j + 1] === "'") j += 2;
          else { j++; break; }
        } else j++;
      }
      current += script.slice(i, j);
      i = j;
      continue;
    }

    // "quoted" / `backticked` identifiers
    if (ch === '"' || ch === '`') {
      const close = ch;
      let j = i + 1;
      while (j < n) {
        if (script[j] === close) {
          if (script[j + 1] === close) j += 2;
          else { j++; break; }
        } else j++;
      }
      current += script.slice(i, j);
      i = j;
      continue;
    }

    // [bracketed] identifier
    if (ch === '[') {
      const end = script.indexOf(']', i);
      const j = end === -1 ? n : end + 1;
      current += script.slice(i, j);
      i = j;
      continue;
    }

    // Track trigger-body nesting. These are bare keywords, so they are only
    // recognised outside every quoted/comment context handled above.
    //
    // `BEGIN` only opens a trigger body when it is not a transaction opener —
    // this app's dumps both open `BEGIN TRANSACTION` and define triggers, and
    // treating the transaction as a trigger body swallows the whole script.
    // The lookahead slice must extend PAST the keyword: `\b` at the end of a
    // slice that is exactly the keyword always matches, which silently turned
    // `cases`, `case_types` and `case_number` into `CASE`/`CASEs`/`CASE_number`
    // and then renamed the tables. One extra character is what makes the
    // boundary test real.
    if (!inTriggerStatement && /^\s*CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(script.slice(i, i + 80))) {
      inTriggerStatement = true;
    }
    if (inTriggerStatement && (ch === 'B' || ch === 'b') && /^BEGIN\b/i.test(script.slice(i, i + 7))) {
      const after = script.slice(i + 5, i + 22).trimStart();
      const isTransaction = /^(TRANSACTION|DEFERRED|IMMEDIATE|EXCLUSIVE)\b/i.test(after);
      if (!isTransaction) {
        triggerDepth++;
        current += script.slice(i, i + 5);
        i += 5;
        continue;
      }
    }
    if ((ch === 'E' || ch === 'e') && /^END\b/i.test(script.slice(i, i + 4))) {
      current += script.slice(i, i + 3);
      i += 3;
      // `END` is ambiguous: it closes a CASE expression just as often as it
      // closes a trigger body. Only the latter terminates a statement, and only
      // when one is actually open — a bare `END` in a statement that is merely
      // building a CASE (migration 016's owner_type backfill does exactly that)
      // must not cut the statement short. CASE is counted separately for the
      // same reason.
      if (caseDepth > 0) {
        caseDepth--;
      } else if (triggerDepth > 0) {
        triggerDepth--;
        if (triggerDepth === 0) {
          statements.push(current);
          current = '';
          inTriggerStatement = false;
          i++; // consume the terminator
        }
      }
      continue;
    }

    if ((ch === 'C' || ch === 'c') && /^CASE\b/i.test(script.slice(i, i + 5))) {
      caseDepth++;
      current += script.slice(i, i + 4);
      i += 4;
      continue;
    }

    if (ch === ';' && triggerDepth === 0) {
      statements.push(current);
      current = '';
      inTriggerStatement = false;
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  statements.push(current);
  // Drop fragments that are only whitespace and/or comments.
  return statements.filter((s) => stripSqlComments(s).trim().length > 0);
}

/** Removes comments so a fragment can be inspected or classified. */
export function stripSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = endOfBlockComment(sql, i);
      i = end;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const close = ch;
      let j = i + 1;
      while (j < n) {
        if (sql[j] === close) {
          if (sql[j + 1] === close) j += 2;
          else { j++; break; }
        } else j++;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Index just past the closing marker of a block comment opened before `from`. */
function endOfBlockComment(sql: string, from: number): number {
  const end = sql.indexOf('*/', from + 2);
  return end === -1 ? sql.length : end + 2;
}

function snippetOf(sql: string): string {
  const oneLine = stripSqlComments(sql).replace(/\s+/g, ' ').trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}...` : oneLine;
}

// ------------------------------------------------------------------- blocking

/**
 * Statements that reach outside the in-memory sandbox.
 *
 * These are legal SQLite and sql.js executes all of them: `ATTACH DATABASE
 * '/path' ...` and `VACUUM INTO '/path'` write files to the host from inside
 * the WASM build, and `load_extension` loads arbitrary code. A clinic PC must
 * never run those because someone opened a file named `.sql`, so they are
 * refused outright rather than silently ignored — the operator is told exactly
 * what was removed.
 */
const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bATTACH\b/i, reason: 'ATTACH would open a second database file on disk' },
  { pattern: /\bDETACH\b/i, reason: 'DETACH would close the database sandbox' },
  { pattern: /\bVACUUM\s+INTO\b/i, reason: 'VACUUM INTO would write a file to disk' },
  { pattern: /\bload_extension\b/i, reason: 'load_extension would load native code' },
  { pattern: /\breadfile\s*\(|\bwritefile\s*\(/i, reason: 'SQLite file I/O functions are not allowed in an import' },
];

function classifyForbidden(sql: string): string | null {
  const bare = stripSqlComments(sql);
  for (const { pattern, reason } of FORBIDDEN) {
    if (pattern.test(bare)) return reason;
  }
  return null;
}

/**
 * Pragmas that only affect this connection's behaviour. Anything else
 * (writable_schema, compile_options, ...) is refused: a dump has no business
 * changing how the engine is configured.
 */
const ALLOWED_PRAGMAS = new Set([
  'foreign_keys', 'defer_foreign_keys', 'legacy_alter_table', 'ignore_check_constraints',
  'recursive_triggers', 'journal_mode', 'synchronous', 'temp_store', 'cache_size',
  'mmap_size', 'page_size', 'encoding', 'user_version', 'application_id',
]);

function classifyPragma(sql: string): string | null {
  const m = /^\s*PRAGMA\s+([A-Za-z_]+)/i.exec(stripSqlComments(sql));
  if (!m) return null;
  const name = m[1].toLowerCase();
  if (ALLOWED_PRAGMAS.has(name)) return null;
  return `PRAGMA ${m[1]} is not allowed in an import`;
}

// --------------------------------------------------------------------- header

/**
 * Reads the provenance comments this app's exporter writes.
 *
 * Only `-- Key: value` pairs from the file's first lines are read, and only for
 * a known key. Nothing is echoed back to the UI verbatim, because a `.sql` dump
 * also contains arbitrary clinic text — and password hashes — in its data
 * section.
 */
export function parseSqlDumpHeader(script: string): SqlDumpHeader {
  const header: SqlDumpHeader = {};
  const head = script.split('\n').slice(0, 40);
  for (const line of head) {
    if (!line.trimStart().startsWith('--')) continue;
    const m = /^--\s*([A-Za-z ]+?)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key === 'export date') header.exportedAt = value;
    else if (key === 'laboratory') header.labName = value;
    else if (key === 'tables') {
      const t = /(\d+)\s*\|/.exec(value);
      if (t) header.declaredTables = Number(t[1]);
      const r = /rows:\s*(\d+)/i.exec(value);
      if (r) header.declaredRows = Number(r[1]);
    }
  }
  return header;
}

// -------------------------------------------------------------------- analysis

/** Row counts for populated user tables — counts only, never values. */
function countTables(engine: SqliteEngine): Record<string, number> {
  const counts: Record<string, number> = {};
  const names = engine.all<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  );
  for (const { name } of names) {
    const quoted = `"${name.replace(/"/g, '""')}"`;
    const n = Number(engine.scalar(`SELECT COUNT(*) FROM ${quoted}`) ?? 0);
    if (n > 0) counts[name] = n;
  }
  return counts;
}

/** Tables this app requires to be present for the app to boot at all. */
const REQUIRED_TABLES = ['schema_migrations', 'users', 'labs', 'cases', 'invoices'];

/**
 * Replays the script into a throwaway database and reports what it contains.
 *
 * Never touches the live engine: the scratch engine is local to this function
 * and closed in a `finally`, so a bad file cannot corrupt the clinic's data no
 * matter how far it gets.
 *
 * Statements are executed ONE AT A TIME rather than as a single script. sql.js
 * aborts at the first error and leaves everything before it applied, with no
 * implicit transaction, so a whole-script run of a file that breaks halfway
 * yields a half-built database and one opaque error. Statement-wise execution
 * names the offending statement and lets the rest load, which is what makes the
 * "rejected statements" report possible at all.
 */
export async function analyzeSqlDump(script: string): Promise<SqlDumpAnalysis> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rejected: RejectedStatement[] = [];
  const header = parseSqlDumpHeader(script);

  const fail = (message: string): SqlDumpAnalysis => ({
    ok: false,
    errors: [message],
    warnings,
    header,
    schemaVersion: 0,
    tableCounts: {},
    totalRows: 0,
    rejected,
    containsCredentials: false,
  });

  if (!script || !script.trim()) {
    return fail('The file is empty — there is nothing to import.');
  }
  if (script.length > MAX_DUMP_BYTES) {
    return fail(
      `The script is ${(script.length / 1024 / 1024).toFixed(1)} MB, over the ${MAX_DUMP_BYTES / 1024 / 1024} MB import limit.`,
    );
  }

  let engine: SqliteEngine | null = null;
  try {
    engine = await createScratchEngine();

    const statements = splitSqlStatements(script);
    if (!statements.length) {
      return fail('No SQL statements were found — this does not look like a SQLite dump.');
    }

    for (let i = 0; i < statements.length; i++) {
      const sql = statements[i];
      const blocked = classifyForbidden(sql) ?? classifyPragma(sql);
      if (blocked) {
        rejected.push({ index: i + 1, reason: blocked, snippet: snippetOf(sql) });
        continue;
      }
      try {
        // execScript, NOT run(): `db.run(sql, [])` with an empty params array
        // silently executes nothing, which would report success on an empty
        // database. See SqliteEngine.execScript.
        engine.execScript(sql);
      } catch (err: any) {
        rejected.push({
          index: i + 1,
          reason: err?.message || 'statement failed',
          snippet: snippetOf(sql),
        });
        if (rejected.length > 20) {
          errors.push('The script contains too many failing statements to be usable.');
          break;
        }
      }
    }

    const tableCounts = countTables(engine);
    const tableCount = Number(
      engine.scalar(
        `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      ) ?? 0,
    );
    const totalRows = Object.values(tableCounts).reduce((a, b) => a + b, 0);

    if (!tableCount) {
      errors.push('The script ran but created no tables — it is not a usable database dump.');
    } else {
      for (const required of REQUIRED_TABLES) {
        if (!engine.tableExists(required)) {
          errors.push(
            `The dump has no "${required}" table — this is not a Dental Solutions database, or it is incomplete.`,
          );
        }
      }
    }

    if (!engine.tableExists('schema_migrations')) {
      errors.push('The dump has no migration ledger (schema_migrations missing) — it cannot be started by this app.');
    }

    let schemaVersion = 0;
    if (engine.tableExists('schema_migrations')) {
      schemaVersion = Number(engine.scalar('SELECT MAX(version) FROM schema_migrations') ?? 0);
      if (schemaVersion > LATEST_SCHEMA_VERSION) {
        errors.push(
          `This dump uses database schema v${schemaVersion}, but this app supports v${LATEST_SCHEMA_VERSION}. ` +
          'Update the application before importing it.',
        );
      } else if (schemaVersion < LATEST_SCHEMA_VERSION) {
        warnings.push(
          `The dump is on schema v${schemaVersion}; this app will upgrade it to v${LATEST_SCHEMA_VERSION} on import.`,
        );
      }
      if (schemaVersion === 0) {
        errors.push('The dump records no schema version — the migration ledger is empty.');
      }
    }

    if (rejected.length) {
      const preview = rejected.slice(0, 3).map((r) => `line block ${r.index}: ${r.reason}`).join('; ');
      errors.push(
        `${rejected.length} statement${rejected.length === 1 ? '' : 's'} in the script could not be applied ` +
        `(${preview}${rejected.length > 3 ? '; …' : ''}). The dump is incomplete and was not imported.`,
      );
    }

    const integrity = String(engine.scalar('PRAGMA integrity_check') ?? '').trim();
    if (integrity && integrity !== 'ok') {
      errors.push(`SQLite integrity_check reported: ${integrity}`);
    }

    const fk = engine.foreignKeyCheck();
    if (fk.length) {
      warnings.push(
        `${fk.length} row${fk.length === 1 ? '' : 's'} reference a parent record that is not in the dump. ` +
        'The app can still open this database.',
      );
    }

    const containsCredentials = CREDENTIAL_TABLES.some((t) => (tableCounts[t] ?? 0) > 0);
    if (containsCredentials) {
      warnings.push(
        'This dump contains user accounts and their password hashes. ' +
        'Anyone holding the file can attempt to authenticate — treat it like a password.',
      );
    }
    if (header.exportedAt) {
      const when = new Date(header.exportedAt);
      if (!Number.isNaN(when.getTime())) {
        warnings.push(`Dump taken ${when.toLocaleString()}.`);
      }
    }
    if (header.declaredRows !== undefined && header.declaredRows !== totalRows) {
      warnings.push(
        `The header claims ${header.declaredRows.toLocaleString()} rows but ${totalRows.toLocaleString()} loaded.`,
      );
    }
    if (!totalRows && !errors.length) {
      warnings.push('The dump contains the schema but no data rows.');
    }

    const ok = errors.length === 0;
    const result: SqlDumpAnalysis = {
      ok,
      errors,
      warnings,
      header,
      schemaVersion,
      tableCounts,
      totalRows,
      rejected,
      containsCredentials,
    };
    // Bytes are produced only for a clean run. There is no reason to hand back
    // the bytes of a database we just reported as broken.
    if (ok) result.bytes = engine.export();
    return result;
  } catch (err: any) {
    errors.push(err?.message ? `The script could not be read: ${err.message}` : 'The script could not be read.');
    return { ok: false, errors, warnings, header, schemaVersion: 0, tableCounts: {}, totalRows: 0, rejected, containsCredentials: false };
  } finally {
    // The scratch engine owns a WASM heap; leaking one per preview click would
    // be a slow leak in a long-lived settings screen.
    engine?.close();
  }
}

// --------------------------------------------------------------------- import

/** One-line summary of a report for the settings panel. */
export function describeSqlDump(report: SqlDumpReport): string {
  const parts = [
    `${report.totalRows.toLocaleString()} rows across ${Object.keys(report.tableCounts).length} tables`,
    `schema v${report.schemaVersion}`,
  ];
  return parts.join(' · ');
}

function currentSchemaVersion(): number {
  if (!isDatabaseReady()) return 0;
  try {
    return Number(getDatabase().scalar('SELECT MAX(version) FROM schema_migrations') ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Imports a validated `.sql` dump, replacing the live database.
 *
 * ENFORCED, in this order and with no way to skip a step:
 *
 *   1. `analysis.ok` must be true. A dump that failed validation is never
 *      applied, however the caller got hold of it.
 *   2. A full copy of the OUTGOING database is written to durable storage. If
 *      that write fails the import throws and nothing is replaced — an import
 *      that cannot be undone must not run.
 *   3. `applyRestoredBytes` performs the swap. It re-checks permissions, runs
 *      `integrity_check`, re-arms autosave, writes the new database through to
 *      disk, and puts the previous engine back if the write fails.
 *
 * The validation in step 1 and the swap in step 3 are two separate databases
 * by construction: the bytes were produced by a scratch engine that has since
 * been closed, so there is no window in which the live engine is half-written.
 *
 * The caller is expected to reload afterwards, so React re-reads the new data.
 */
export async function importSqlDump(analysis: SqlDumpAnalysis): Promise<SqlImportOutcome> {
  if (!analysis.ok || !analysis.bytes) {
    throw new Error(
      analysis.errors[0] || 'This dump did not validate, so it was not imported. Your current data is untouched.',
    );
  }
  if (!isDatabaseReady()) {
    throw new Error('The database is not ready yet — wait for the app to finish starting.');
  }

  // Step 2: enforced pre-import copy of the outgoing data.
  const outgoingBytes = getDatabase().export();
  try {
    await saveSafetySnapshot(outgoingBytes, {
      takenAt: new Date().toISOString(),
      schemaVersion: currentSchemaVersion(),
    });
  } catch (snapErr: any) {
    throw new Error(
      'the pre-import safety copy could not be written, so the import was cancelled. ' +
      'Free up storage space and try again. ' +
      `(${snapErr?.message || 'storage error'})`,
    );
  }

  // Step 3: the same swap a .dentalbackup restore performs. Wrap the dump's
  // bytes in a package so that path — including its permission check, its
  // integrity_check and its rollback — is reused verbatim instead of forked.
  const packageBytes = analysis.bytes;
  const outcome = await applyRestoredBytes(
    {
      manifest: {
        magic: 'DENTALBACKUP',
        format_version: 1,
        app_version: '',
        schema_version: analysis.schemaVersion,
        created_at: new Date().toISOString(),
        table_counts: analysis.tableCounts,
        db_checksum: '',
        db_size_bytes: packageBytes.length,
        note: `Imported from SQL dump${analysis.header.labName ? ` — ${analysis.header.labName}` : ''}`,
      },
      database_b64: bytesToBase64(packageBytes),
    },
    // Lazy import: this module is reachable from tests that stub the engine,
    // and db/index pulls in sql.js and the whole boot chain.
    async (bytes) => {
      const { initEngineFromBytes } = await import('../db');
      return initEngineFromBytes(bytes);
    },
  );

  const upgraded = analysis.schemaVersion < LATEST_SCHEMA_VERSION;
  return {
    rowsImported: outcome.rowsRestored,
    schemaVersion: outcome.schemaVersion,
    upgraded,
    crossVersion: outcome.crossVersion,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Reads a File the user picked and analyses it. Kept next to the service so the
 * panel and the tests share one path.
 */
export async function analyzeSqlDumpFile(file: File): Promise<SqlDumpAnalysis> {
  if (file.size > MAX_DUMP_BYTES) {
    return {
      ok: false,
      errors: [
        `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ` +
        `${MAX_DUMP_BYTES / 1024 / 1024} MB import limit.`,
      ],
      warnings: [],
      header: {},
      schemaVersion: 0,
      tableCounts: {},
      totalRows: 0,
      rejected: [],
      containsCredentials: false,
    };
  }
  const text = await file.text();
  return analyzeSqlDump(text);
}