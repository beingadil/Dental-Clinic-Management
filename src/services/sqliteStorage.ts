import { saveFile } from '../lib/saveFile';

/**
 * SQLite & Offline Database Persistence Engine for Dental Solutions Lab ERP
 * 
 * Provides:
 * - SQLite DDL relational schema definition for all laboratory tables
 * - Offline-first persistence synchronization
 * - SQLite SQL Dump Generator (.sql)
 * - SQLite SQL Importer & Query Runner
 * - Full database backup, restore, and integrity checks
 */

import { getDatabase, isDatabaseReady } from '../db/core';
import { SqliteEngine } from '../db/engine';
import { schemaScript } from '../db/migrations';

export interface SqliteTableInfo {
  name: string;
  rowCount: number;
  columns: string[];
}

export interface SqliteExportOptions {
  includeSchema?: boolean;
  includeData?: boolean;
  labName?: string;
}

/**
 * Schema for the generated .sql dump — derived from MIGRATIONS, never hand-written.
 *
 * This used to be a hand-maintained copy of the DDL. It had drifted: the export
 * shipped a schema the app itself no longer runs on (missing
 * `payment_attachments.owner_type` from migration 016, plus ~30 tables the
 * string never learned about), so a dump could not be relied on to restore or
 * to inspect the clinic's real database. Replaying MIGRATIONS makes divergence
 * impossible: the next migration ships and this export changes with it.
 */
export const SQLITE_DDL_SCHEMA = schemaScript();

// ---------------------------------------------------------------- SQL literals

/**
 * One SQL literal, faithful to the value SQLite handed us.
 *
 * Backslashes are deliberately NOT escaped. SQLite string literals have no
 * backslash escape — `\` is an ordinary character — so the old
 * `\\` -> `\\\\` transform silently corrupted every Windows path and every
 * value containing a backslash the moment it was dumped (each separator came
 * back out doubled). Only `'` needs doubling, and NUL is stripped because
 * SQLite cannot hold it in TEXT at all.
 */
function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NULL';
    if (value === Infinity) return '9e999';
    if (value === -Infinity) return '-9e999';
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  // BLOB columns come back as Uint8Array; X'..' is the only lossless literal.
  if (value instanceof Uint8Array) {
    let hex = '';
    for (let i = 0; i < value.length; i++) hex += value[i].toString(16).padStart(2, '0');
    return `X'${hex}'`;
  }
  return `'${String(value).replace(/\u0000/g, '').replace(/'/g, "''")}'`;
}

/** Quoted identifier. Names come from sqlite_master, never from user input. */
function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

interface TableDump {
  table: string;
  columns: string[];
  rows: unknown[][];
}

/**
 * Every user table with its columns, parents before children.
 *
 * Order comes from PRAGMA foreign_key_list. The script itself turns FK
 * enforcement off while it loads (`PRAGMA foreign_keys=OFF`, exactly like
 * `sqlite3 .dump`), so ordering is not strictly required — but a consumer that
 * ignores the pragma, or a person replaying the file in a GUI, still gets a
 * script that loads cleanly. Dependency cycles (none today) fall back to
 * emitting the remainder in name order.
 */
function tablesParentsFirst(engine: SqliteEngine): { name: string; columns: string[] }[] {
  const tables = engine
    .all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .map((r) => ({
      name: r.name,
      columns: engine.all<{ name: string }>(`PRAGMA table_info(${ident(r.name)})`).map((c) => c.name),
    }));

  const known = new Set(tables.map((t) => t.name));
  const parents = new Map<string, string[]>();
  for (const t of tables) {
    const own = new Set<string>();
    for (const fk of engine.all<{ table: string }>(`PRAGMA foreign_key_list(${ident(t.name)})`)) {
      if (fk.table !== t.name && known.has(fk.table)) own.add(fk.table);
    }
    parents.set(t.name, [...own]);
  }

  const ordered: { name: string; columns: string[] }[] = [];
  const emitted = new Set<string>();
  let remaining = tables;
  while (remaining.length) {
    const ready = remaining.filter((t) => (parents.get(t.name) ?? []).every((p) => emitted.has(p)));
    const batch = ready.length ? ready : remaining; // cycle: keep going rather than stall
    for (const t of batch) {
      ordered.push(t);
      emitted.add(t.name);
    }
    remaining = remaining.filter((t) => !emitted.has(t.name));
  }
  return ordered;
}

/** Every row of every user table in the live database, in FK-safe order. */
function dumpAllRows(engine: SqliteEngine): TableDump[] {
  const dumped: TableDump[] = [];
  for (const t of tablesParentsFirst(engine)) {
    const all = engine.all<Record<string, unknown>>(`SELECT * FROM ${ident(t.name)}`);
    if (!all.length) continue; // empty tables are already created by the DDL
    dumped.push({
      table: t.name,
      columns: t.columns,
      rows: all.map((row) => t.columns.map((c) => row[c])),
    });
  }
  return dumped;
}

/**
 * Generate a complete, ready-to-run SQLite SQL export script.
 *
 * DATA COMES FROM THE LIVE DATABASE, for every table — not from a hand-written
 * list of columns fed by an in-memory snapshot. The previous implementation
 * wrote 11 of the 45 tables with a subset of their columns, so a dump silently
 * dropped case teeth, QC inspections, notes, vouchers, reconciliation rows,
 * ledger entries, per-user preferences and every reversal flag on money
 * documents. Worst of all it never wrote `schema_migrations`, so importing the
 * dump into the app meant replaying migration 1 against tables that already
 * existed — the file could not boot.
 *
 * Dumping generically makes "identical business data" a property of the
 * structure instead of a promise someone has to maintain: a new table or column
 * ships and it is in the export. `schema_migrations` and `doc_sequences` travel
 * with it, so the imported database boots without re-running a migration and
 * keeps issuing document numbers where the source left off.
 *
 * The script is shaped like `sqlite3 .dump` output — FK enforcement off, one
 * transaction, DDL then data — so it loads with
 * `sqlite3 clinic.sqlite < dump.sql` as well as through the app's own tooling.
 *
 * NOTE: like the live database and like `.dentalbackup`, this file contains
 * `users.password_hash` / `password_salt`. Treat it as a credential.
 */
export function generateSqliteExport(opts: { labName?: string; generatedAt?: string } = {}): string {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const labName = opts.labName || 'Dental Solutions';
  const engine = isDatabaseReady() ? getDatabase() : null;
  const dumped = engine ? dumpAllRows(engine) : [];
  const totalRows = dumped.reduce((n, t) => n + t.rows.length, 0);

  let sql = '';
  sql += `-- ========================================================================\n`;
  sql += `-- DENTAL SOLUTIONS LABORATORY ERP - SQLITE PRODUCTION DATABASE EXPORT\n`;
  sql += `-- Export Date: ${generatedAt}\n`;
  sql += `-- Laboratory: ${labName}\n`;
  sql += `-- Tables: ${dumped.length} | Rows: ${totalRows}\n`;
  sql += `-- Source: the live SQLite database (same row data as a .dentalbackup)\n`;
  if (!engine) {
    sql += `-- WARNING: THE DATABASE WAS NOT INITIALISED — SCHEMA ONLY, NO DATA.\n`;
  }
  sql += `-- Contains credential hashes; store it like a password.\n`;
  sql += `-- Load with: sqlite3 clinic.sqlite < this_file.sql\n`;
  sql += `-- ========================================================================\n\n`;

  // Shaped exactly like `sqlite3 .dump`: FK enforcement off for the load (the
  // pragma is a no-op inside a transaction, so it must precede BEGIN), one
  // transaction around DDL + data, then FK enforcement restored.
  sql += `PRAGMA foreign_keys = OFF;\n`;
  sql += `BEGIN TRANSACTION;\n\n`;

  sql += `-- ========================================================================\n`;
  sql += `-- SCHEMA — replayed from MIGRATIONS, so it cannot drift from the app\n`;
  sql += `-- ========================================================================\n\n`;
  sql += SQLITE_DDL_SCHEMA + `\n\n`;

  sql += `-- ========================================================================\n`;
  sql += `-- DATA — every table, every column\n`;
  sql += `-- ========================================================================\n\n`;
  if (!dumped.length) sql += `-- (no rows)\n\n`;
  for (const t of dumped) {
    sql += `-- ${t.table} (${t.rows.length} ${t.rows.length === 1 ? 'row' : 'rows'})\n`;
    const cols = t.columns.map(ident).join(', ');
    for (const row of t.rows) {
      sql += `INSERT OR REPLACE INTO ${ident(t.table)} (${cols}) VALUES (${row.map(sqlLiteral).join(', ')});\n`;
    }
    sql += `\n`;
  }

  sql += `COMMIT;\n`;
  sql += `PRAGMA foreign_keys = ON;\n\n`;
  sql += `-- End of SQLite Export --\n`;

  return sql;
}

/**
 * Save the SQLite .sql dump. Routed through saveFile so the desktop build
 * writes a real file (the Tauri shell ignores a Blob-URL download entirely);
 * the web path is unchanged.
 */
export function downloadSqliteDump(sqlContent: string, fileName = 'dentallab_database.sql'): void {
  void saveFile(fileName, sqlContent, {
    extension: '.sql',
    mimeType: 'application/sql;charset=utf-8',
    dialogTitle: 'Save SQL dump',
  });
}

/**
 * Convenient wrapper to generate and download SQLite .sql file directly
 */
export function exportSqliteFile(opts: { labName?: string } = {}, customFilename?: string): string {
  const sql = generateSqliteExport(opts);
  const filename = customFilename || `dental_solutions_sqlite_${new Date().toISOString().split('T')[0]}.sql`;
  downloadSqliteDump(sql, filename);
  return filename;
}

/**
 * Diagnostic row counts for the core ERP tables, from a state snapshot.
 *
 * Not a description of the export: the dump writes every table in the database
 * (see `generateSqliteExport`), which is more than the eleven listed here.
 */
export function getSqliteTableStats(appData: any) {
  return [
    { name: 'users', count: appData.users?.length || 0, description: 'User accounts, permissions & authentication' },
    { name: 'labs', count: appData.labs?.length || 0, description: 'Registered dental clinics & partner laboratories' },
    { name: 'case_types', count: appData.caseTypes?.length || 0, description: 'CAD/CAM catalog items & base fee matrix' },
    { name: 'cases', count: appData.cases?.length || 0, description: 'Dental clinical restoration cases & FDI odontogram' },
    { name: 'invoices', count: appData.invoices?.length || 0, description: 'Billing invoices & financial balances' },
    { name: 'payments', count: (appData.payments?.length || appData.invoices?.flatMap((i: any) => i.payments || []).length || 0), description: 'Invoice payment receipts & remittances' },
    { name: 'advance_payments', count: appData.advancePayments?.length || 0, description: 'Clinic prepayment & unallocated deposits' },
    { name: 'account_adjustments', count: appData.accountAdjustments?.length || 0, description: 'Credit/Debit memos & ledger adjustments' },
    { name: 'journal_entries', count: appData.journalEntries?.length || 0, description: 'Double-entry audit journals & lines' },
    { name: 'audit_events', count: appData.auditEvents?.length || 0, description: 'Immutable system compliance log' },
    { name: 'notifications', count: appData.notifications?.length || 0, description: 'Real-time workflow & overdue alerts' },
  ];
}

/**
 * Parses an exported JSON backup or SQL inserts structure to reconstruct relational state
 */
export function parseSqliteDumpToState(sqlOrJsonText: string): any | null {
  try {
    // If it's a JSON string
    if (sqlOrJsonText.trim().startsWith('{')) {
      const parsed = JSON.parse(sqlOrJsonText);
      return parsed;
    }
    return null;
  } catch (err) {
    console.error('Failed to parse database dump:', err);
    return null;
  }
}

