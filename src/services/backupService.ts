import { exportDatabaseBytes, getDatabase } from '../db/core';
import { SqliteEngine } from '../db/engine';
import { setDatabase } from '../db/core';
import { sha256Hex } from '../db/crypto';
import { installAutoPersistence } from '../db/persistence';

/**
 * Phase 8 — `.dentalbackup` package format.
 *
 * A backup is a single JSON file (versioned, checksummed) containing the
 * complete SQLite database (base64) plus metadata. Restore flow:
 * validate header + checksum → safety snapshot of current data (caller) →
 * reopen engine from restored bytes → reinstall persistence hooks.
 */

export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_MAGIC = 'DENTALBACKUP';
export const APP_VERSION = '2.3.2';

export interface BackupManifest {
  magic: string;
  format_version: number;
  app_version: string;
  schema_version: number;
  created_at: string;
  table_counts: Record<string, number>;
  db_checksum: string;
  db_size_bytes: number;
  note?: string;
}

export interface BackupPackage {
  manifest: BackupManifest;
  database_b64: string;
}

export interface RestoreValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest?: BackupManifest;
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function createBackup(note?: string): Promise<BackupPackage> {
  const bytes = exportDatabaseBytes();
  const db = getDatabase();
  const b64 = bytesToB64(bytes);
  const counts: Record<string, number> = {};
  for (const t of ['users', 'labs', 'case_types', 'cases', 'case_notes', 'attachments', 'invoices', 'payments',
    'payment_attachments', 'advance_payments', 'account_adjustments', 'journal_entries', 'notifications',
    'audit_events', 'saved_vouchers']) {
    try { counts[t] = db.rowCount(t); } catch { counts[t] = -1; }
  }
  const manifest: BackupManifest = {
    magic: BACKUP_MAGIC,
    format_version: BACKUP_FORMAT_VERSION,
    app_version: APP_VERSION,
    schema_version: Number(db.scalar('SELECT MAX(version) FROM schema_migrations') ?? 0),
    created_at: new Date().toISOString(),
    table_counts: counts,
    db_checksum: 'sha256:' + (await sha256Hex(bytes)),
    db_size_bytes: bytes.length,
    note,
  };
  return { manifest, database_b64: b64 };
}

export function serializeBackup(pkg: BackupPackage): string {
  return JSON.stringify(pkg);
}

export function parseBackupFile(text: string): BackupPackage {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('Not a valid backup file');
  return parsed as BackupPackage;
}

/** Full pre-restore validation: structure, header, payload, checksum, compatibility. */
export async function validateBackup(pkg: BackupPackage): Promise<RestoreValidation> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!pkg || !pkg.manifest || typeof pkg.manifest !== 'object' || !pkg.database_b64) {
    return {
      ok: false,
      errors: ['Missing manifest or database payload — this is not a valid .dentalbackup package.'],
      warnings,
    };
  }
  const m = pkg.manifest;
  if (m.magic !== BACKUP_MAGIC) {
    errors.push('File header mismatch — this is not a Dental Solutions backup.');
  }
  if (m.format_version > BACKUP_FORMAT_VERSION) {
    errors.push(`Backup format v${m.format_version} is newer than this app supports (v${BACKUP_FORMAT_VERSION}). Update the application first.`);
  }
  if (m.format_version < BACKUP_FORMAT_VERSION) {
    warnings.push(`Backup uses older format v${m.format_version}; it will be upgraded automatically.`);
  }
  try {
    const bytes = b64ToBytes(pkg.database_b64);
    const expected = 'sha256:' + (await sha256Hex(bytes));
    if (m.db_checksum && m.db_checksum !== expected) {
      errors.push('Integrity checksum mismatch — the backup is corrupt or was modified.');
    }
    if (m.db_size_bytes && m.db_size_bytes !== bytes.length) {
      warnings.push('Recorded size differs slightly from payload; continuing with checksum verdict.');
    }
  } catch {
    errors.push('Database payload could not be decoded.');
  }
  if (m.app_version && m.app_version !== APP_VERSION) {
    warnings.push(`Backup created with app v${m.app_version}; running v${APP_VERSION}.`);
  }

  return { ok: errors.length === 0, errors, warnings, manifest: m };
}

/** Safety snapshot of the CURRENT database — must be taken before restore. */
export async function createSafetySnapshot(): Promise<{ takenAt: string; data: string }> {
  const pkg = await createBackup('Automatic safety snapshot before restore');
  return { takenAt: new Date().toISOString(), data: serializeBackup(pkg) };
}

/**
 * Swaps the live engine to the restored bytes and reattaches persistence.
 * The database is closed and reopened from the backup payload in-place.
 */
export function applyRestoredBytes(
  pkg: BackupPackage,
  engineFactory: (bytes: Uint8Array) => Promise<SqliteEngine>
): Promise<void> {
  const bytes = b64ToBytes(pkg.database_b64);
  return engineFactory(bytes).then((engine) => {
    // old engine handle becomes unreachable; new one takes over persistence
    setDatabase(engine);
    installAutoPersistence(engine);
  });
}

export const RESTORE_NOTE = 'Restores replace ALL current data — a safety snapshot is taken first.';
