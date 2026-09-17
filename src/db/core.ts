import { SqliteEngine, DbError } from './engine';

/**
 * Process-wide engine holder. Kept separate from ./index to avoid circular
 * imports (persistence and repos need getDatabase without pulling boot logic).
 */

let current: SqliteEngine | null = null;

export function setDatabase(engine: SqliteEngine): void {
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
