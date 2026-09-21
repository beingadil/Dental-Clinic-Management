/**
 * Restore drill — proves the backup→restore pipeline actually works.
 *
 * Packs a fresh backup (same bytes the .dentalbackup export writes), runs the
 * full restore path into a temporary in-memory engine, verifies every table's
 * row count against the manifest, then discards the temp engine. The live
 * database is never touched. Pass = the machinery a real restore uses works,
 * right now, on this machine.
 */
import { createTransientEngine } from '../db';
import { createBackup, serializeBackup, parseBackupFile, validateBackup } from './backupService';

export interface RestoreDrillResult {
  ok: boolean;
  at: string;          // ISO timestamp
  checkedTables: number;
  checkedRows: number;
  detail: string;      // human-readable summary for the UI
  failures: string[];  // per-table mismatches when not ok
}

/** Tables whose row counts the drill cross-checks against the manifest. */
const DRILL_TABLES = [
  'users', 'labs', 'case_types', 'cases', 'case_notes', 'attachments',
  'invoices', 'payments', 'advance_payments', 'journal_entries', 'notifications', 'audit_events',
] as const;

export async function runRestoreDrill(): Promise<RestoreDrillResult> {
  const at = new Date().toISOString();
  try {
    // 1. Pack exactly what the .dentalbackup export path packs.
    const pkg = await createBackup('restore drill');
    const serialized = serializeBackup(pkg);

    // 2. Round-trip through the same parse/validate the real restore uses.
    const parsed = parseBackupFile(serialized);
    const verdict = await validateBackup(parsed);
    if (!verdict.ok) {
      return { ok: false, at, checkedTables: 0, checkedRows: 0, detail: 'validation rejected the package', failures: verdict.errors };
    }

    // 3. Restore into a throwaway engine — the live one is untouched.
    const bytes = base64ToBytes(pkg.database_b64);
    const temp = await createTransientEngine(bytes);

    // 4. Row-check every table against the manifest.
    const failures: string[] = [];
    let rows = 0;
    for (const t of DRILL_TABLES) {
      const expected = pkg.manifest.table_counts[t] ?? 0;
      const actual = temp.rowCount(t);
      rows += Math.max(actual, 0);
      if (expected !== actual) failures.push(`${t}: manifest ${expected} ≠ engine ${actual}`);
    }

    temp.close();

    return {
      ok: failures.length === 0,
      at,
      checkedTables: DRILL_TABLES.length,
      checkedRows: rows,
      detail: failures.length === 0
        ? `${rows.toLocaleString()} rows across ${DRILL_TABLES.length} tables restored & verified`
        : failures.slice(0, 3).join('; '),
      failures,
    };
  } catch (err: any) {
    return {
      ok: false,
      at,
      checkedTables: 0,
      checkedRows: 0,
      detail: `drill failed: ${err?.message || 'unknown error'}`,
      failures: [],
    };
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
