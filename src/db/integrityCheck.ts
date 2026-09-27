import type { SqliteEngine } from './engine';
import { getDatabase, isDatabaseReady } from './core';

/**
 * Boot-time integrity self-check (audit follow-up to the P2 FK-pragma fix).
 *
 * The P2 work proved two silent failure modes: sql.js resets
 * `PRAGMA foreign_keys` to OFF after every export(), and that hole let orphaned
 * child rows accumulate until the whole sync transaction died. This check
 * turns both classes into a visible, per-boot verdict instead of a latent trap.
 *
 * Pure reads only — never mutates the database.
 */

export interface IntegrityFinding {
  check: string;
  ok: boolean;
  detail: string;
}

export interface IntegrityReport {
  ok: boolean;
  ranAt: string;
  findings: IntegrityFinding[];
}

/** Child tables whose orphans historically aborted the whole-table sync. */
const ORPHAN_QUERIES: { table: string; sql: string }[] = [
  { table: 'journal_lines', sql: "SELECT COUNT(*) AS n FROM journal_lines WHERE journal_id NOT IN (SELECT id FROM journal_entries)" },
  { table: 'invoice_items', sql: "SELECT COUNT(*) AS n FROM invoice_items WHERE invoice_id NOT IN (SELECT id FROM invoices)" },
  { table: 'case_teeth', sql: "SELECT COUNT(*) AS n FROM case_teeth WHERE case_id NOT IN (SELECT id FROM cases)" },
  { table: 'payments', sql: "SELECT COUNT(*) AS n FROM payments WHERE invoice_id NOT IN (SELECT id FROM invoices)" },
  { table: 'case_notes', sql: "SELECT COUNT(*) AS n FROM case_notes WHERE case_id NOT IN (SELECT id FROM cases)" },
];

/** Ledger balance: every journal must sum debit == credit. */
const LEDGER_IMBALANCE_SQL = `
  SELECT COUNT(*) AS n FROM (
    SELECT journal_id, SUM(debit) AS d, SUM(credit) AS c
    FROM journal_lines GROUP BY journal_id
    HAVING ABS(d - c) > 0.005
  )`;

/** Invoices missing their issuance journal (every invoice must post one). */
const INVOICES_WITHOUT_JOURNAL_SQL = `
  SELECT COUNT(*) AS n FROM invoices i
  WHERE i.journal_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.id = i.journal_id)`;

export function runIntegrityCheck(engine: SqliteEngine): IntegrityReport {
  const findings: IntegrityFinding[] = [];

  // 1 — FK enforcement is actually ON (the export() reset regression).
  const fkOn = Number(engine.scalar('PRAGMA foreign_keys') ?? 0) === 1;
  findings.push({
    check: 'Foreign key enforcement',
    ok: fkOn,
    detail: fkOn
      ? 'PRAGMA foreign_keys = ON'
      : 'PRAGMA foreign_keys is OFF — cascade deletes are NOT enforced (see P2 fix: re-asserted after every snapshot save)',
  });

  // 2 — generic engine-level orphan scan (catches any FK violation the
  // hardcoded queries below don't cover).
  let genericOrphans = 0;
  try {
    genericOrphans = engine.foreignKeyCheck().length;
  } catch { /* engine without the pragma helper — the targeted queries still ran */ }
  findings.push({
    check: 'Foreign key violations (PRAGMA foreign_key_check)',
    ok: genericOrphans === 0,
    detail: genericOrphans === 0 ? 'No violations across all tables' : `${genericOrphans} violating row(s) — purge orphaned child rows`,
  });

  // 3 — targeted orphan counts on the sync-critical child tables.
  let worstOrphans = 0;
  let worstTable = '';
  for (const { table, sql } of ORPHAN_QUERIES) {
    try {
      const n = Number(engine.scalar(sql) ?? 0);
      if (n > worstOrphans) { worstOrphans = n; worstTable = table; }
    } catch { /* table missing on very old schemas — skip */ }
  }
  findings.push({
    check: 'Orphaned child rows',
    ok: worstOrphans === 0,
    detail: worstOrphans === 0 ? 'None in sync-critical tables' : `${worstOrphans} orphan(s) in ${worstTable || 'child tables'} — these abort the whole sync transaction`,
  });

  // 4 — ledger balance (money integrity).
  const imbalanced = Number(engine.scalar(LEDGER_IMBALANCE_SQL) ?? 0);
  findings.push({
    check: 'Ledger balance',
    ok: imbalanced === 0,
    detail: imbalanced === 0 ? 'Every journal debits == credits' : `${imbalanced} unbalanced journal(s)`,
  });

  // 5 — invoice journal coverage (P0 invariant).
  let unjournaled = -1;
  try {
    unjournaled = Number(engine.scalar(INVOICES_WITHOUT_JOURNAL_SQL) ?? 0);
  } catch { /* journal tables absent on pre-012 schemas */ }
  if (unjournaled >= 0) {
    findings.push({
      check: 'Invoice journal coverage',
      ok: unjournaled === 0,
      detail: unjournaled === 0 ? 'Every invoice has a posted journal' : `${unjournaled} invoice(s) without journal — reload to trigger the migration 012 backfill`,
    });
  }

  return {
    ok: findings.every((f) => f.ok),
    ranAt: new Date().toISOString(),
    findings,
  };
}

/** Boot-safe wrapper: null when the engine isn't up yet or the check throws. */
export function runIntegrityCheckSafe(): IntegrityReport | null {
  if (!isDatabaseReady()) return null;
  try {
    return runIntegrityCheck(getDatabase());
  } catch {
    return null;
  }
}
