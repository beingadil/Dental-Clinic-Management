import initSqlJs from 'sql.js';
import { SqliteEngine, SqlJsStatic, DbError } from './engine';
import { seedDatabase } from './seeds';
import { runLegacyMigration } from './legacyMigrator';
import { installAutoPersistence, loadSnapshot } from './persistence';
import { setDatabase, getDatabase, isDatabaseReady, exportDatabaseBytes } from './core';
import { runIntegrityCheck } from './integrityCheck';

export { getDatabase, isDatabaseReady, exportDatabaseBytes };
let bootPromise: Promise<SqliteEngine> | null = null;
let wasmLocator: ((file: string) => string) | null = null;

export interface BootOptions {
  /** Browser wasm locator (from ?url import or a vendored public path). Optional under Node/test. */
  locateFile?: (file: string) => string;
}

/**
 * Boots the local SQLite database:
 * 1. loads the sql.js WASM engine,
 * 2. restores the last persisted snapshot (if any),
 * 3. applies pending migrations,
 * 4. seeds defaults on first run,
 * 5. imports legacy localStorage data (one-time, generates a report),
 * 6. installs debounced autosave persistence.
 */
export function initializeDatabase(options: BootOptions = {}): Promise<SqliteEngine> {
  if (!bootPromise) {
    if (options.locateFile) wasmLocator = options.locateFile;
    bootPromise = (async () => {
      const engine = await initEngineFromBytes(await loadSnapshot() ?? undefined);
      await seedDatabase();
      await runLegacyMigration();
      return engine;
    })().catch((err) => {
      bootPromise = null;
      throw new DbError(`Database boot failed: ${err instanceof Error ? err.message : String(err)}`, 'DB_OPEN', err);
    });
  }
  return bootPromise;
}

/**
 * Builds (or rebuilds) the live engine from raw SQLite bytes.
 * Used both by the normal boot (restoring the persisted snapshot) and by
 * backup restore (swapping in a `.dentalbackup` payload). Applies any
 * migrations the payload still needs, so older backups are upgraded safely.
 */
export async function initEngineFromBytes(bytes?: Uint8Array): Promise<SqliteEngine> {
  const init = (initSqlJs ?? null) as unknown as (cfg?: any) => Promise<SqlJsStatic>;
  // Thread the wasm locator through every engine build (boot AND backup
  // restore); without it sql.js resolves the .wasm relative to the JS bundle
  // and 404s in production builds.
  const SQL = await init(wasmLocator ? { locateFile: wasmLocator } : undefined);
  const engine = await SqliteEngine.create(SQL, bytes);
  const { applied } = engine.migrate();
  // eslint-disable-next-line no-console
  console.info(
    `[db] SQLite ready — schema v${engine.scalar('SELECT MAX(version) FROM schema_migrations')}` +
      (applied.length ? ` (applied: ${applied.join(', ')})` : '')
  );
  setDatabase(engine);
  // Boot-time integrity self-check. Advisory, never fatal: the findings are
  // logged and the same verdict is re-runnable on demand from
  // Settings > Persistence Health. It does NOT throw, including on a restore —
  // backupService.ts already gates a swap on its own structural validation
  // (schema_migrations present + PRAGMA integrity_check ok), and this
  // referential pass would otherwise reject a valid older database that simply
  // predates one of the invariants.
  const integrity = runIntegrityCheck(engine);
  if (!integrity.ok) {
    const bad = integrity.findings
      .filter((f) => !f.ok)
      .map((f) => `${f.check}: ${f.detail}`)
      .join('; ');
    // eslint-disable-next-line no-console
    console.error(`[db] INTEGRITY CHECK WARNING at ${integrity.ranAt}: ${bad}`, integrity.findings);
  }
  installAutoPersistence(engine);
  return engine;
}

export type { SqliteEngine };

/**
 * Builds a transient in-memory engine for verification drills (restore
 * checks). Never touches the live global engine, its persistence, or the
 * snapshot store — the caller owns closing it.
 */
export async function createTransientEngine(bytes?: Uint8Array): Promise<SqliteEngine> {
  const engine = await createScratchEngine(bytes);
  engine.migrate();
  return engine;
}

/**
 * A bare in-memory engine with the pragmas the app opens databases with, but
 * WITHOUT migrations.
 *
 * `createTransientEngine` is the wrong tool for replaying a `.sql` dump: it
 * runs `migrate()` first, which creates the whole schema, and the dump's own
 * `CREATE TABLE` statements would then collide with tables that already exist.
 * The importer needs the opposite order — an empty database the dump builds.
 */
export async function createScratchEngine(bytes?: Uint8Array): Promise<SqliteEngine> {
  const init = (initSqlJs ?? null) as unknown as (cfg?: any) => Promise<SqlJsStatic>;
  const SQL = await init(wasmLocator ? { locateFile: wasmLocator } : undefined);
  return SqliteEngine.create(SQL, bytes);
}
