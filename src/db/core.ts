import { SqliteEngine, DbError } from './engine';

/**
 * Process-wide engine holder. Kept separate from ./index to avoid circular
 * imports (persistence and repos need getDatabase without pulling boot logic).
 */

let current: SqliteEngine | null = null;

/**
 * Installs the live engine. `null` clears it — used by backup/restore
 * rollback so a failed swap can never leave a half-restored database
 * presenting itself as the live one.
 */
export function setDatabase(engine: SqliteEngine | null): void {
  current = engine;
}

export function getDatabase(): SqliteEngine {
  if (!current) {
    throw new DbError('Database not initialized — await initializeDatabase() first', 'DB_OPEN');
  }
  return current;
}

export function isDatabaseReady(): boolean {
  return current !== null;
}

export function exportDatabaseBytes(): Uint8Array {
  return getDatabase().export();
}
