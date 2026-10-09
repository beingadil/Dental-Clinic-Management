import { MIGRATIONS, Migration, SCHEMA_MIGRATIONS_DDL } from './migrations';

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
  /** sql.js convenience: bind, step once, reset. Used by the statement cache. */
  run(values?: any): boolean;
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
/** Statements that change the schema (or rebuild the file), invalidating any
 *  compiled statement held in `stmtCache`. */
const DDL_RE = /\b(CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX)\b/i;

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
  /**
   * Prepared statements, keyed by SQL text.
   *
   * `db.run(sql, params)` re-parses the SQL on every call, and one whole-
   * collection sync issues tens of thousands of them (10k cases + 10k
   * invoices + their teeth/history/payment rows). Measured on the same
   * machine at 10k parameterized inserts: 198 ms through `db.run`, 42 ms
   * through one prepared statement — the parse, nothing else. Same SQL, same
   * order, same transaction, so sync semantics are untouched.
   *
   * Only PARAMETERIZED single statements are cached. Unparameterized work
   * (DDL, PRAGMA, the handful of `DELETE FROM …` rewrites) goes straight to
   * `db.run`: it is a few dozen calls per sync, and it stays the correct path
   * for multi-statement scripts, which `db.prepare` cannot run at all.
   */
  private readonly stmtCache = new Map<string, Statement>();
  /** Bounds the cache: sync SQL is a fixed set of templates, but ad-hoc
   *  generated statements (IN lists, per-column UPDATEs) must not grow it
   *  without limit. Dropping the whole map is fine — it is a pure cache. */
  private static readonly STMT_CACHE_MAX = 256;

  private clearStatementCache(): void {
    for (const stmt of this.stmtCache.values()) {
      try { stmt.free(); } catch { /* already freed */ }
    }
    this.stmtCache.clear();
  }

  run(sql: string, params: SqlValue[] = []): void {
    const cacheable = params.length > 0 && !sql.includes(';');
    if (cacheable) {
      const cached = this.stmtCache.get(sql);
      if (cached) {
        try {
          cached.run(params as any);
          return;
        } catch (err) {
          // A statement that threw may be left mid-step, so it must not be
          // reused. Drop it, then report exactly what the uncached path would.
          this.stmtCache.delete(sql);
          try { cached.free(); } catch { /* already gone */ }
          throw new DbError(this.explain(err, sql), this.classify(err, sql), err);
        }
      }
      try {
        const stmt = this.db.prepare(sql);
        try {
          stmt.run(params as any);
        } catch (err) {
          try { stmt.free(); } catch { /* already gone */ }
          throw err;
        }
        if (this.stmtCache.size >= SqliteEngine.STMT_CACHE_MAX) this.clearStatementCache();
        this.stmtCache.set(sql, stmt);
        return;
      } catch (err) {
        throw new DbError(this.explain(err, sql), this.classify(err, sql), err);
      }
    }
    try {
      this.db.run(sql, params as any);
    } catch (err) {
      throw new DbError(this.explain(err, sql), this.classify(err, sql), err);
    } finally {
      // Schema DDL recompiles every statement against the new shape. Detected
      // by keyword rather than a whitelist so a migration, a CREATE TABLE in
      // sequences.ts, and an imported dump all invalidate the cache.
      if (DDL_RE.test(sql)) this.clearStatementCache();
    }
  }

  /**
   * Executes a MULTI-STATEMENT SQL script (a `.sql` dump) against this engine.
   *
   * Deliberately not `run()`. `db.run(sql, params)` with an empty params array
   * silently executes NOTHING — sql.js treats the array as "this statement has
   * parameters" and never steps it — so an importer built on `run()` would
   * report success on a completely empty database. Passing no params at all
   * makes sql.js iterate every statement, which is what a script needs.
   *
   * IMPORTANT for callers: sql.js aborts at the FIRST failing statement and
   * leaves everything before it applied. There is no implicit transaction, so
   * a script that fails at the end leaves a partial database behind. Only ever
   * point this at a throwaway engine, or wrap the script in its own
   * BEGIN/COMMIT.
   */
  execScript(sql: string): void {
    try {
      this.db.run(sql);
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
    // DDL below can invalidate a compiled statement, and a cached one would
    // then run against the old schema shape.
    this.clearStatementCache();
    this.run(SCHEMA_MIGRATIONS_DDL);

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

    // Migrations that DROP objects (017 drops twelve dead indexes) leave the
    // freed pages on the file's freelist, where they still count towards the
    // exported byte length — the whole point of dropping them was to shrink the
    // in-memory database, since the webview keeps the engine as bytes and
    // re-encodes it on every save. VACUUM is the only way to release them, and
    // it must run outside a transaction, so it goes after the loop rather than
    // inside it. Skipped entirely on an up-to-date database (the common boot),
    // so this costs nothing after the first run.
    if (applied.length > 0) this.compact();

    return { applied, skipped };
  }

  /**
   * Rebuild the database file, releasing freelist pages left by dropped
   * objects and rebuild-and-reswap sync cycles. Cheap enough to run after any
   * migration that changed the schema; never runs inside a transaction.
   */
  compact(): void {
    this.run('VACUUM');
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

  /**
   * Serializes the whole SQLite file.
   *
   * CRITICAL: sql.js implements export() by closing the connection and
   * reopening the file, which resets EVERY connection-level PRAGMA to its
   * default — `foreign_keys` included (SQLite defaults it OFF for backwards
   * compatibility). The flag is not stored in the file, so it is simply gone.
   *
   * That matters enormously here: every ON DELETE CASCADE in the schema stops
   * firing after any export (backup file, autosave flush, beforeunload save),
   * so the next whole-table sync orphans child rows and then dies on
   * `UNIQUE constraint failed: journal_lines.id`. Re-assert it here — once —
   * for every caller, instead of relying on each call site remembering.
   */
  export(): Uint8Array {
    // sql.js implements export() by closing and reopening the connection, so
    // every cached statement belongs to the closed handle.
    this.clearStatementCache();
    const bytes = this.db.export();
    try {
      this.db.run('PRAGMA foreign_keys = ON;');
    } catch {
      /* non-fatal: pragma is advisory, data is already serialized */
    }
    return bytes;
  }

  close(): void {
    this.clearStatementCache();
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
