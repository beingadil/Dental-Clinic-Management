import { SqliteEngine } from './engine';
import { getDatabase } from './core';

/**
 * Local persistence for the SQLite database.
 *
 * - Browser: snapshots serialize the full SQLite file into localStorage under
 *   a single binary-safe base64 key (zero-config, survives restarts).
 * - Desktop (Tauri): the exact same engine bytes are written to a real
 *   `dental_solutions.sqlite` file in the OS app-data directory via IPC,
 *   atomically (tmp file + fsync + rename). Same engine, same file format.
 */

const SNAPSHOT_KEY = 'dsw_sqlite_snapshot';
const DIRTY_KEY = 'dsw_sqlite_dirty';
const MAGIC = 'DSDB1';

/** Every real SQLite database file starts with this 16-byte header. */
const SQLITE_MAGIC = 'SQLite format 3\x00';

/** Guards the engine against parsing non-SQLite bytes (HTML 404 bodies,
 *  truncated writes, 0-length files). Feeding those to sql.js throws
 *  'expected magic word 00 61 73 6d' style errors and bricks the boot. */
function asSqliteBytes(bytes: Uint8Array | null): Uint8Array | null {
  if (!bytes || bytes.length === 0) return null;
  let header = '';
  for (let i = 0; i < SQLITE_MAGIC.length; i++) header += String.fromCharCode(bytes[i]);
  if (header !== SQLITE_MAGIC) {
    // Not a database file — never feed it to the engine. Starting empty is
    // safe: a non-SQLite file contains no recoverable clinic data, and the
    // next autosave replaces it with a real database.
    console.error(
      `[db] persisted snapshot is not a SQLite database (got ${bytes.length} bytes, ` +
      `bad magic) — starting from a fresh database`,
    );
    return null;
  }
  return bytes;
}

/** True when running inside the Tauri desktop shell. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Desktop IPC bindings (only callable when isDesktop()). */
async function desktopDb(): Promise<{
  db_load: (args: { path?: string }) => Promise<{ path: string; existed: boolean }>;
  db_read_bytes: () => Promise<string>;
  db_save_bytes: (args: { bytesB64: string }) => Promise<{ path: string; bytes: number }>;
  db_backup_file: (args: { dest?: string }) => Promise<string>;
}> {
  const { invoke } = await import('@tauri-apps/api/core');
  return {
    db_load: (args) => invoke('db_load', args),
    db_read_bytes: () => invoke('db_read_bytes'),
    db_save_bytes: (args) => invoke('db_save_bytes', args),
    db_backup_file: (args) => invoke('db_backup_file', args),
  };
}

function b64encode(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64decode(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Loads the persisted engine bytes: real file on desktop, localStorage in browser. */
export async function loadSnapshot(): Promise<Uint8Array | null> {
  if (isDesktop()) {
    try {
      const tauri = await desktopDb();
      const info = await tauri.db_load({});
      // eslint-disable-next-line no-console
      console.info(`[db] desktop database file: ${info.path} (${info.existed ? 'existing' : 'new'})`);
      const b64 = await tauri.db_read_bytes();
      return asSqliteBytes(b64 ? b64decode(b64) : null);
    } catch (err) {
      console.error('[db] desktop load failed — starting empty', err);
      return null;
    }
  }
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    if (!raw.startsWith(MAGIC + ':')) {
      console.warn('[db] snapshot header mismatch — starting from empty database');
      localStorage.removeItem(SNAPSHOT_KEY);
      return null;
    }
    return asSqliteBytes(b64decode(raw.slice(MAGIC.length + 1)));
  } catch (err) {
    console.error('[db] failed to load snapshot — starting from empty database', err);
    return null;
  }
}

/**
 * Last persistence failure, or null when the last write succeeded.
 *
 * A failed save used to be a console.error and nothing else: the app kept
 * running happily on in-memory data that no longer had a copy anywhere, and
 * the clinic only found out when the work was gone at close. Surfacing this
 * is the whole point of tracking it (audit D6).
 */
let lastSaveError: string | null = null;

function noteSaveFailure(err: unknown): void {
  lastSaveError = err instanceof Error ? err.message : String(err);
  emitSaveStatus();
}

function noteSaveSuccess(): void {
  if (lastSaveError === null) return;
  lastSaveError = null;
  emitSaveStatus();
}

function emitSaveStatus(): void {
  try {
    window.dispatchEvent(new Event('db:save-status'));
  } catch {
    /* no DOM (tests/Node) — nothing to notify */
  }
}

export function getLastSaveError(): string | null {
  return lastSaveError;
}

export async function saveSnapshot(engine: SqliteEngine): Promise<boolean> {
  try {
    // engine.export() re-asserts PRAGMA foreign_keys itself (see SqliteEngine.export)
    const bytes = engine.export();
    if (isDesktop()) {
      const tauri = await desktopDb();
      const res = await tauri.db_save_bytes({ bytesB64: b64encode(bytes) });
      localStorage.setItem(DIRTY_KEY, 'false');
      noteSaveSuccess();
      // eslint-disable-next-line no-console
      console.info(`[db] saved ${res.bytes} bytes to ${res.path}`);
      return true;
    }
    const encoded = MAGIC + ':' + b64encode(bytes);
    localStorage.setItem(SNAPSHOT_KEY, encoded);
    localStorage.setItem(DIRTY_KEY, 'false');
    noteSaveSuccess();
    return true;
  } catch (err) {
    // Quota/IO: keep in-memory truth intact; surface clearly instead of failing silently.
    console.error('[db] SNAPSHOT SAVE FAILED — data still live in memory', err);
    noteSaveFailure(err);
    return false;
  }
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
/**
 * Engines already wrapped, tracked per-instance rather than by a one-shot flag.
 * A backup restore swaps in a brand-new engine that must be watched exactly
 * like the first one; the old boolean guard made the restored database
 * silently unwatched, so nothing marked it dirty, nothing was ever written
 * back, and the reload that follows a restore re-read the STALE snapshot.
 */
const hookedEngines = new WeakSet<SqliteEngine>();
let lifecycleInstalled = false;

function markDirty(): void {
  dirty = true;
  try {
    localStorage.setItem(DIRTY_KEY, 'true');
  } catch { /* non-fatal */ }
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushNow();
    }, 400);
  }
}

export async function flushNow(): Promise<boolean> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!dirty) return true;
  try {
    const ok = await saveSnapshot(getDatabase());
    if (ok) dirty = false;
    return ok;
  } catch {
    return false;
  }
}

/**
 * Writes `engine`'s bytes straight through to the OS file (desktop) or
 * localStorage (browser) right now, bypassing the debounce.
 *
 * This is the seam a backup restore MUST use: the restored engine is
 * persisted BEFORE the app reloads, otherwise the reload re-reads the previous
 * snapshot and the restore appears to have done nothing at all.
 */
export async function persistEngineNow(engine: SqliteEngine): Promise<boolean> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const ok = await saveSnapshot(engine);
  if (ok) dirty = false;
  return ok;
}

/** Wraps engine mutation methods to schedule persistence. Re-runnable per engine. */
export function installAutoPersistence(engine: SqliteEngine): void {
  if (hookedEngines.has(engine)) return;
  hookedEngines.add(engine);
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  dirty = false;

  const originalRun = engine.run.bind(engine);
  engine.run = function (sql: string, params?: any) {
    markDirty();
    return originalRun(sql, params);
  } as typeof engine.run;

  // Page lifecycle hooks — flush synchronously on hide/unload.
  if (typeof window !== 'undefined') installLifecycleHooks();
}

/** One-time page/OS lifecycle wiring. Safe to call repeatedly; runs once. */
function installLifecycleHooks(): void {
  if (lifecycleInstalled) return;
  lifecycleInstalled = true;

  window.addEventListener('beforeunload', () => {
    if (dirty) {
      try {
        // Best-effort fallback only: this async save races webview teardown.
        // The reliable path is the onCloseRequested interception below, which
        // awaits the flush BEFORE the window is allowed to close.
        const engineNow = getDatabase();
        const bytes = engineNow.export();
        if (isDesktop()) {
          void desktopDb().then((t) => t.db_save_bytes({ bytesB64: b64encode(bytes) }));
        } else {
          localStorage.setItem(SNAPSHOT_KEY, MAGIC + ':' + b64encode(bytes));
          localStorage.setItem(DIRTY_KEY, 'false');
        }
      } catch { /* best effort */ }
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirty) {
      void flushNow();
    }
  });
  // Periodic checkpoint: cap the at-risk window at 5 s even when the user
  // never triggers the visibility/close paths (crash, power loss). Cheap:
  // no-op when not dirty; flushNow clears any pending debounce first.
  setInterval(() => {
    if (dirty) void flushNow();
  }, 5000);
  // Desktop quit path: intercept window close (X button, WindowControls,
  // Alt+F4) and finish the debounced SQLite write FIRST, then close. The
  // plain beforeunload handler cannot do this — its fire-and-forget IPC
  // save is killed mid-flight by webview teardown, losing the newest
  // writes (the 'my data did not save' class of reports).
  if (isDesktop()) {
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        await win.onCloseRequested(async (event) => {
          if (!dirty) return; // nothing pending — close proceeds normally
          event.preventDefault();
          try {
            // Bound the wait: a hung IPC must never make the app
            // unclosable. 3 s covers the largest realistic snapshot.
            await Promise.race([
              flushNow(),
              new Promise((r) => setTimeout(r, 3000)),
            ]);
          } catch { /* still close — an unclosable app is worse than a
                        bounded loss, and periodic flushes cap it */ }
          win.destroy();
        });
      } catch { /* not a Tauri context — beforeunload fallback applies */ }
    })();
  }
}

export function isSnapshotDirty(): boolean {
  return dirty || localStorage.getItem(DIRTY_KEY) === 'true';
}

export const SNAPSHOT_INFO = { SNAPSHOT_KEY, MAGIC };
