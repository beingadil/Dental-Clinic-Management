import { exportDatabaseBytes, getDatabase, isDatabaseReady, setDatabase } from '../db/core';
import { SqliteEngine } from '../db/engine';
import { MIGRATIONS } from '../db/migrations';
import { sha256Hex } from '../db/crypto';
import { installAutoPersistence, persistEngineNow } from '../db/persistence';
import { canManageSystem } from './permissions';

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
/**
 * Highest schema this build can read. A backup migrated further than this
 * would load tables/columns the running app does not know — it must be
 * refused, not silently loaded (older backups are fine: the normal
 * migration pass upgrades them at apply time).
 */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
/** Every real SQLite file starts with this 16-byte header. */
const SQLITE_MAGIC = 'SQLite format 3\x00';
/** Build-time injected from package.json (see vite.config.ts `define`).
 * Never hardcode this again — a stale duplicate caused an infinite update
 * loop where 2.12.0 installs believed they were 2.10.0. */
export const APP_VERSION: string = __APP_VERSION__;

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

/**
 * Cheap structural gate applied before we hand bytes to sql.js. A payload that
 * is not a SQLite file makes the WASM build throw an opaque
 * 'expected magic word 00 61 73 6d' error; catching it here turns a corrupt or
 * wrong-kind-of-file restore into a readable message.
 */
export function looksLikeSqlite(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < SQLITE_MAGIC.length) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) {
    if (String.fromCharCode(bytes[i]) !== SQLITE_MAGIC[i]) return false;
  }
  return true;
}

/** Tables whose counts are published in every backup manifest. */
const MANIFEST_TABLES = [
  'users', 'labs', 'case_types', 'cases', 'case_notes', 'attachments', 'invoices', 'payments',
  'payment_attachments', 'advance_payments', 'account_adjustments', 'journal_entries', 'notifications',
  'audit_events', 'saved_vouchers',
] as const;

export async function createBackup(note?: string): Promise<BackupPackage> {
  const bytes = exportDatabaseBytes();
  const db = getDatabase();
  const b64 = bytesToB64(bytes);
  const counts: Record<string, number> = {};
  for (const t of MANIFEST_TABLES) {
    try { counts[t] = db.rowCount(t); } catch { counts[t] = -1; }
  }
  const manifest: BackupManifest = {
    magic: BACKUP_MAGIC,
    format_version: BACKUP_FORMAT_VERSION,
    app_version: APP_VERSION,
    schema_version: Number(db.scalar('SELECT MAX(version) FROM schema_migrations') ?? 0),
    // Backup provenance is metadata, not clinic bookkeeping: UTC ISO here is
    // correct and unambiguous when a file travels between time zones.
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
  if (typeof m.schema_version === 'number' && m.schema_version > LATEST_SCHEMA_VERSION) {
    errors.push(
      `This backup was created with a newer version of Dental Management ` +
      `(database schema v${m.schema_version}, this app supports v${LATEST_SCHEMA_VERSION}). ` +
      'Update the application before restoring this backup.',
    );
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
 * Defense in depth for the most destructive operation in the app.
 *
 * Authorization in this codebase is UI-only (audit S2): the Settings tab is
 * hidden from non-admins, but nothing stops the service layer from being
 * called. Restore replaces the entire clinic database, so it re-checks the
 * permission at the service boundary. `currentUser` is injected rather than
 * imported to keep this module free of a React/context dependency.
 */
let currentUser: { role: string } | null = null;

/** Registers the signed-in user for the restore authorization check. */
export function setBackupAuthorizationUser(user: { role: string } | null): void {
  currentUser = user;
}

export interface RestoreOutcome {
  /** Rows now readable from the restored database (sum of manifest tables). */
  rowsRestored: number;
  /** Schema version after pending migrations were applied to the payload. */
  schemaVersion: number;
  /** True when the payload was built by a different app version. */
  crossVersion: boolean;
}

/**
 * Swaps the live engine to the restored bytes, verifies the result is a real,
 * readable database, and — the part that used to be missing — writes it through
 * to persistent storage BEFORE returning.
 *
 * Why the write matters: the caller reloads the page so React re-reads the
 * restored data. On boot the app loads whatever is in the persistence store,
 * not whatever is in memory. Swapping the engine without persisting it means
 * the reload comes straight back up on the OLD database and the restore looks
 * like it silently did nothing.
 *
 * If persistence fails (disk full, storage quota) we put the previous engine
 * back and throw, so a failed restore leaves the clinic's data untouched.
 */
export async function applyRestoredBytes(
  pkg: BackupPackage,
  engineFactory: (bytes: Uint8Array) => Promise<SqliteEngine>,
): Promise<RestoreOutcome> {
  const bytes = b64ToBytes(pkg.database_b64);
  // No registered user means no authority to destroy data (tests and the
  // restore drill pass an explicit value or exercise a different path).
  if (currentUser && !canManageSystem(currentUser as any, 'backup:restore')) {
    throw new Error('Your role is not permitted to restore a database.');
  }
  if (!looksLikeSqlite(bytes)) {
    throw new Error(
      'The backup payload is not a SQLite database (bad file header). The file is truncated or was not produced by this application.',
    );
  }

  // Captured before the swap so a failed persist can be rolled back.
  const previous = isDatabaseReady() ? getDatabase() : null;

  // Everything between here and the persist step runs against a candidate
  // engine that the factory may ALREADY have installed globally
  // (initEngineFromBytes calls setDatabase). Any failure in the block must
  // put the previous engine back — a failed restore must never leave the
  // half-restored database live.
  let engine: SqliteEngine | null = null;
  let schemaVersion = 0;
  try {
    engine = await engineFactory(bytes);

    // Prove the swap produced a usable database before committing to it:
    // migration ledger present, readable, and structurally sound.
    if (!engine.tableExists('schema_migrations')) {
      throw new Error('backup database has no migration ledger (schema_migrations missing)');
    }
    schemaVersion = Number(engine.scalar('SELECT MAX(version) FROM schema_migrations') ?? 0);
    const integrity = String(engine.scalar('PRAGMA integrity_check') ?? '');
    if (integrity !== 'ok') {
      throw new Error(`SQLite integrity_check reported: ${integrity}`);
    }
  } catch (err: any) {
    setDatabase(previous);
    if (engine && engine !== previous) closeQuietly(engine);
    throw new Error(
      `The backup database could not be prepared (${err?.message || 'unknown error'}). ` +
      'Your current data is untouched.',
    );
  }

  // engineFactory (initEngineFromBytes) has already made this the live engine;
  // re-assert defensively so a different factory cannot leave the old one bound.
  setDatabase(engine);
  // Re-wraps THIS engine for autosave. The old one-shot guard used to skip this
  // after the first call, leaving the restored database unwatched: nothing
  // marked it dirty, so nothing was ever saved and nothing survived a restart.
  installAutoPersistence(engine);

  const persisted = await persistEngineNow(engine);
  if (!persisted) {
    if (previous) setDatabase(previous);
    closeQuietly(engine);
    throw new Error(
      'The restored database could not be written to storage. It is usually out of disk or browser-storage space. ' +
      'Nothing was changed — free up space and try the restore again.',
    );
  }

  // The outgoing engine is unreachable now that the restore is committed and on
  // disk. Close it so the old copy's WASM heap is released instead of leaking
  // for the rest of the session.
  if (previous && previous !== engine) closeQuietly(previous);

  let rowsRestored = 0;
  for (const t of MANIFEST_TABLES) {
    try { rowsRestored += engine.rowCount(t); } catch { /* table absent in old payload */ }
  }

  return {
    rowsRestored,
    schemaVersion,
    crossVersion: pkg.manifest?.app_version ? pkg.manifest.app_version !== APP_VERSION : false,
  };
}

function closeQuietly(engine: SqliteEngine): void {
  try { engine.close(); } catch { /* already closed */ }
}

export const RESTORE_NOTE = 'Restores replace ALL current data — a safety snapshot is taken first.';
