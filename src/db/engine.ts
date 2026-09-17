import { MIGRATIONS, Migration } from './migrations';

/**
 * Minimal typed wrapper around sql.js (SQLite compiled to WebAssembly).
 * Runs fully offline — the .wasm binary is bundled by Vite at build time.
 */

export interface SqlJsStatic {
  Database: new (data?: Uint8Array | Buffer | null, config?: any) => any;
}

export interface Database {
  run(sql: string, params?: any): Database;
  exec(sql: string, params?: any): QueryExecResult[];
  prepare(sql: string, params?: any): Statement;
  export(): Uint8Array;
  close(): void;
}

export interface Statement {
  bind(values?: any): boolean;
  step(): boolean;
  get(): any[];
  getAsObject(): Record<string, any>;
  free(): boolean;
  reset(): void;
}

export interface QueryExecResult {
  columns: string[];
  values: any[][];
}

export type SqlValue = string | number | Uint8Array | null;

export class DbError extends Error {
  constructor(
    message: string,
    public readonly code: 'DB_OPEN' | 'MIGRATION' | 'CONSTRAINT' | 'NOT_FOUND' | 'QUERY' | 'VALIDATION',
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'DbError';
  }
}

const ALLOWED_TABLE = /^[a-z_][a-z0-9_]*$/;

/** Column types the JSON codec can round-trip through TEXT columns. */
export interface JsonCodecConfig {
  [column: string]: 'array' | 'object' | 'boolean';
}

export class SqliteEngine {
  private static savepointCounter = 0;
  private constructor(private db: Database, public readonly SQL: SqlJsStatic) {}

  static async create(sqlJs: SqlJsStatic, existingBytes?: Uint8Array | null): Promise<SqliteEngine> {
    try {
      const db = new sqlJs.Database(existingBytes ?? null);
      // SQLite defaults to FKs OFF for backwards compatibility; this app's
      // integrity model depends on cascades, so enable immediately on open.
      db.run('PRAGMA foreign_keys = ON;');
      return new SqliteEngine(db, sqlJs);
    } catch (err) {
      throw new DbError('Failed to open local database', 'DB_OPEN', err);
    }
  }

  // ------------------------------------------------------------- raw access
  run(sql: string, params: SqlValue[] = []): void {
    try {
      this.db.run(sql, params as any);
    } catch (err) {
      throw new DbError(this.explain(err, sql), this.classify(err, sql), err);
    }
  }

  all<T = Record<string, any>>(sql: string, params: SqlValue[] = []): T[] {
    try {
      const stmt = this.db.prepare(sql);
      try {
        if (params.length) stmt.bind(params as any);
        const rows: T[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
        return rows;
      } finally {
        stmt.free();
      }
    } catch (err) {
      throw new DbError(this.explain(err, sql), this.classify(err, sql), err);
    }
  }

  get<T = Record<string, any>>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  scalar(sql: string, params: SqlValue[] = []): any {
    const row = this.get(sql, params);
    if (!row) return undefined;
    const first = Object.values(row)[0];
    return first === undefined ? null : first;
  }

  // ------------------------------------------------------------- transactions
  transaction<T>(fn: (tx: TransactionApi) => T): T {
    this.run('BEGIN IMMEDIATE');
    try {
      const result = fn(this.buildTxApi());
      this.run('COMMIT');
      return result;
    } catch (err) {
      try { this.run('ROLLBACK'); } catch { /* connection-level failure: original error is more relevant */ }
      throw err;
    }
  }

  /** Nestable transaction: outermost uses BEGIN/COMMIT, nested ones use SAVEPOINTs. */
  withTransaction<T>(fn: (tx: TransactionApi) => T): T {
    this.run('SAVEPOINT sp');
    try {
      const result = fn(this.buildTxApi());
      this.run('RELEASE sp');
      return result;
    } catch (err) {
      try { this.run('ROLLBACK TO sp'); this.run('RELEASE sp'); } catch { /* keep original error */ }
      throw err;
    }
  }

  private buildTxApi(): TransactionApi {
    return {
      run: (sql, params = []) => this.run(sql, params),
      all: <R,>(sql: string, params: SqlValue[] = []) => this.all<R>(sql, params),
      get: <R,>(sql: string, params: SqlValue[] = []) => this.get<R>(sql, params),
    };
  }

  // ------------------------------------------------------------- migrations
  migrate(migrations: Migration[] = MIGRATIONS): { applied: number[]; skipped: number[] } {
    const applied: number[] = [];
    const skipped: number[] = [];
    this.run('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');

    for (const m of migrations) {
      const done = this.get('SELECT version FROM schema_migrations WHERE version = ?', [m.version]);
      if (done) {
        skipped.push(m.version);
        continue;
      }
      try {
        this.transaction((tx) => {
          for (const stmt of m.statements) tx.run(stmt);
          tx.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
            m.version,
            m.name,
            new Date().toISOString(),
          ]);
        });
        applied.push(m.version);
      } catch (err) {
        throw new DbError(`Migration ${m.version} (${m.name}) failed — database left at prior version`, 'MIGRATION', err);
      }
    }
    return { applied, skipped };
  }

  // ------------------------------------------------------------- helpers
  tableExists(name: string): boolean {
    if (!ALLOWED_TABLE.test(name)) throw new DbError(`Invalid table name: ${name}`, 'VALIDATION');
    return !!this.get(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`, [name]);
  }

  rowCount(table: string): number {
    if (!ALLOWED_TABLE.test(table)) throw new DbError(`Invalid table name: ${table}`, 'VALIDATION');
    return Number(this.scalar(`SELECT COUNT(*) FROM ${table}`) ?? 0);
  }

  foreignKeyCheck(): { table: string; rowid: number; parent: string; fkid: number }[] {
    return this.all('PRAGMA foreign_key_check') as any;
  }

  export(): Uint8Array {
    return this.db.export();
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }

  // ------------------------------------------------------------- JSON codec
  encodeJson(value: unknown): string {
    return JSON.stringify(value ?? null);
  }

  decodeJson<T>(raw: unknown, fallback: T): T {
    if (raw === null || raw === undefined || raw === '') return fallback;
    if (typeof raw !== 'string') return raw as unknown as T;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  intBool(value: unknown, fallback = false): boolean {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
    return fallback;
  }

  private explain(err: unknown, sql: string): string {
    const msg = err instanceof Error ? err.message : String(err);
    return `${msg} [sql: ${sql.slice(0, 120)}]`;
  }

  private classify(err: unknown, sql: string): DbError['code'] {
    const msg = (err instanceof Error ? err.message : String(err)).toUpperCase();
    if (msg.includes('CONSTRAINT') || msg.includes('UNIQUE')) return 'CONSTRAINT';
    if (msg.includes('NO SUCH TABLE') || msg.includes('NO SUCH COLUMN')) return 'NOT_FOUND';
    return 'QUERY';
  }
}

export interface TransactionApi {
  run(sql: string, params?: SqlValue[]): void;
  all<T>(sql: string, params?: SqlValue[]): T[];
  get<T>(sql: string, params?: SqlValue[]): T | undefined;
}

/** Convenience: assert a required foreign key target exists before insert. */
export function assertExists(engine: SqliteEngine, table: string, id: string, label: string): void {
  if (!engine.get(`SELECT id FROM ${table} WHERE id = ?`, [id])) {
    throw new DbError(`${label} not found: ${id}`, 'NOT_FOUND');
  }
}

export { MIGRATIONS };
export type { Migration };
