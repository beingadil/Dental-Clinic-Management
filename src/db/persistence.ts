import { SqliteEngine } from './engine';
import { getDatabase } from './core';
import { recordFailure, recordSuccess, type FailureCause } from './failureLog';

/**
 * Local persistence for the SQLite database.
 *
 * - Browser: snapshots serialize the full SQLite file into IndexedDB under a
 *   single binary-safe base64 key (zero-config, survives restarts), falling
 *   back to localStorage only when IndexedDB is unavailable.
 *
 *   IndexedDB, not localStorage, is the primary browser store on purpose. A
 *   localStorage origin quota is ~5 MB and base64 inflates the database by
 *   4/3, so a real clinic database (~3.7 MB) hits the ceiling and every
 *   subsequent save throws QuotaExceededError — persistence stops silently
 *   and the banner reports "changes are not being written to disk". IndexedDB
 *   is quota'd against free disk instead, so the same snapshot simply fits.
 * - Desktop (Tauri): the exact same engine bytes are written to a real
 *   `dental_solutions.sqlite` file in the OS app-data directory via IPC,
 *   atomically (tmp file + fsync + rename). Same engine, same file format.
 */

const SNAPSHOT_KEY = 'dsw_sqlite_snapshot';
const DIRTY_KEY = 'dsw_sqlite_dirty';
const MAGIC = 'DSDB1';

/** IndexedDB location for the browser snapshot. */
const IDB_NAME = 'dsw_sqlite';
const IDB_STORE = 'snapshots';
const IDB_KEY = 'database';

/**
 * Retry backoff after a failed save, in ms.
 *
 * A permanently failing save used to be retried every 5 s by the checkpoint
 * timer, and each attempt re-serialized the WHOLE database (export + base64
 * over megabytes) before throwing the same QuotaExceededError. That is what
 * made the app "become slow" once the snapshot outgrew localStorage: a
 * multi-megabyte re-encode every five seconds, forever, on the UI thread.
 */
const SAVE_BACKOFF_MS = [0, 1_000, 5_000, 15_000, 60_000, 300_000];
/**
 * Consecutive failed saves. Mirrored from the PERSISTED journal in failureLog
 * rather than owned here: as a plain module variable it reset to 0 on every
 * reload, so a save that had been failing for a week looked brand new — and
 * healthy — each morning when the clinic reopened the app.
 */
let saveFailures = 0;
let lastSaveAttemptAt = 0;
/** Where the last snapshot actually landed. Reported by Settings > Database & Backup. */
let lastBackend: SnapshotBackend | null = null;
/** Serialized size of the last snapshot, so a quota message can state it. */
let lastSnapshotBytes = 0;
/**
 * In-memory time of the last successful save in THIS session. The journal only
 * writes a success timestamp when it is clearing a streak (to stay off the
 * checkpoint path), so without this a perfectly healthy app reported "last save
 * OK never", which reads like a bug to the person relying on it.
 */
let lastSaveAt: string | null = null;

export type SnapshotBackend = 'desktop' | 'indexeddb' | 'localstorage' | 'none';

function backoffDelay(failures: number): number {
  return SAVE_BACKOFF_MS[Math.min(failures, SAVE_BACKOFF_MS.length - 1)];
}

/**
 * Tag an error with the cause known at the throw site. The save path can see
 * WHY it failed (quota vs blocked IndexedDB vs missing storage) but only as a
 * local condition; without this tag the catch below could only report a string.
 */
function withCause(err: Error, cause: FailureCause): Error {
  (err as Error & { failureCause?: FailureCause }).failureCause = cause;
  return err;
}

function causeOf(err: unknown): FailureCause | undefined {
  return (err as { failureCause?: FailureCause } | null)?.failureCause;
}

/** Chromium reports this as a name; Safari and jsdom only set `code`. */
function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number };
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22;
}

function formatBytes(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * localStorage is not merely quota-limited: in Node (tests), in jsdom, and in
 * some private-mode browsers it is absent entirely, and touching it threw out
 * of an otherwise successful save. The dirty flag is an optimisation hint —
 * it must never be able to fail a save.
 */
function ls(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    ls()?.setItem(key, value);
  } catch {
    /* quota or unavailable — the snapshot itself is what matters */
  }
}

function lsRemove(key: string): void {
  try {
    ls()?.removeItem(key);
  } catch {
    /* nothing to reclaim */
  }
}

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

/** Absolute path of the desktop database file, once db_load has resolved it. */
let desktopDbPath: string | null = null;

/** The live database file location (desktop only; null in the browser). */
export function getDesktopDatabasePath(): string | null {
  return desktopDbPath;
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

/**
 * Every byte value as its own one-character string, built once.
 *
 * `String.fromCharCode(...bytes)` is the obvious way to widen bytes to a
 * binary string and it is the slow one: spreading an 8.8 MB snapshot in 32 KB
 * slices measures 582 ms on V8, which is more than the whole autosave debounce
 * and lands directly on the UI thread, every save. Indexing a prebuilt table
 * is the same output with no argument splat: 217 ms for the same bytes,
 * byte-identical result (asserted by tests/db/base64.test.ts).
 */
const LATIN1_CHARS: string[] = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i));

/**
 * base64 of `bytes`, chunked at a MULTIPLE OF 3 bytes (base64 is a 3-byte
 * group encoding, so only a 3-aligned split produces chunks that concatenate
 * into the same string as one pass would).
 */
const B64_CHUNK = 0xc000; // 49152 = 3 * 16384
export function b64encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    const end = Math.min(i + B64_CHUNK, bytes.length);
    let binary = '';
    for (let j = i; j < end; j += 4096) {
      const stop = Math.min(j + 4096, end);
      let s = '';
      for (let k = j; k < stop; k++) s += LATIN1_CHARS[bytes[k]];
      binary += s;
    }
    out += btoa(binary);
  }
  return out;
}

export function b64decode(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ------------------------------------------------------------- IndexedDB store
let idbPromise: Promise<IDBDatabase | null> | null = null;

/**
 * Opens the snapshot database, or resolves null when IndexedDB is missing or
 * blocked (Node tests, jsdom, private-mode browsers). Cached: the open is a
 * round trip to the browser and runs on every load and every save.
 */
function openIdb(): Promise<IDBDatabase | null> {
  if (idbPromise) return idbPromise;
  const attempt = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
      if (!idb) {
        resolve(null);
        return;
      }
      const req = idb.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };        req.onsuccess = () => resolve(req.result);
      // A blocked or unavailable IndexedDB must degrade to localStorage, not
      // take the whole boot down.
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }).then((db) => {
    // Runs a microtask later, so the assignment below has already happened and
    // clearing the cache here actually sticks.
    if (db === null) forgetIdbFailure();
    return db;
  });
  idbPromise = attempt;
  return attempt;
}

/**
 * Forgets the cached open result after ANY non-success, so "blocked right now"
 * does not become "unavailable forever".
 *
 * The realistic case: two app windows, one of them mid-version-change, so the
 * open fires `onblocked`. Caching that null meant this session silently wrote
 * to the ~5 MB localStorage fallback instead — and, once the database outgrew
 * it, silently stopped persisting at all — for a condition that clears by
 * itself a second later. Retrying costs one promise allocation per save.
 */
function forgetIdbFailure(): void {
  idbPromise = null;
}

function idbRequest<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return openIdb().then(
    (db) =>
      new Promise<T | null>((resolve, reject) => {
        if (!db) {
          resolve(null);
          return;
        }
        let req: IDBRequest;
        try {
          req = fn(db.transaction(IDB_STORE, mode).objectStore(IDB_STORE));
        } catch (err) {
          reject(err);
          return;
        }
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
      }),
  );
}

/** Reads the browser snapshot from IndexedDB; null when absent/unavailable. */
async function readIdbSnapshot(): Promise<string | null> {
  const value = await idbRequest<string>('readonly', (s) => s.get(IDB_KEY) as IDBRequest);
  return typeof value === 'string' ? value : null;
}

/** Writes the browser snapshot to IndexedDB. Throws on a real write failure. */
async function writeIdbSnapshot(text: string): Promise<void> {
  await idbRequest('readwrite', (s) => s.put(text, IDB_KEY) as IDBRequest);
}

/**
 * Drops the legacy localStorage snapshot once IndexedDB holds the same data.
 * Without this the app carries two full copies of the database, which on a
 * near-quota origin is the difference between fitting and not.
 */
function dropLegacySnapshot(): void {
  lsRemove(SNAPSHOT_KEY);
}

/** Loads the persisted engine bytes: real file on desktop, IndexedDB (or localStorage) in browser. */
export async function loadSnapshot(): Promise<Uint8Array | null> {
  if (isDesktop()) {
    try {
      const tauri = await desktopDb();
      const info = await tauri.db_load({});
      desktopDbPath = info.path;
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
    let raw = await readIdbSnapshot();
    let fromIdb = raw !== null;
    if (raw === null) raw = ls()?.getItem(SNAPSHOT_KEY) ?? null;
    if (!raw) return null;
    if (!raw.startsWith(MAGIC + ':')) {
      console.warn('[db] snapshot header mismatch — starting from empty database');
      if (fromIdb) await idbRequest('readwrite', (s) => s.delete(IDB_KEY) as IDBRequest).catch(() => null);
      else lsRemove(SNAPSHOT_KEY);
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

function noteSaveFailure(err: unknown, detail?: string): void {
  lastSaveError = err instanceof Error ? err.message : String(err);
  // The streak comes back from the persisted journal, so backoff resumes (and
  // the panel can report "failing since <date>") across restarts.
  saveFailures = recordFailure('save', err, { cause: causeOf(err), detail }).streak;
  emitSaveStatus();
}

function noteSaveSuccess(): void {
  lastSaveAt = new Date().toISOString();
  // Stay a no-op while healthy: this runs on every checkpoint, and the journal
  // write is a localStorage round trip we must not pay for 17,280 times a day.
  const recovering = saveFailures > 0 || lastSaveError !== null;
  saveFailures = 0;
  if (!recovering) return;
  lastSaveError = null;
  recordSuccess('save');
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

/** Where the last successful snapshot was written (null before the first save). */
export function getLastSaveBackend(): SnapshotBackend | null {
  return lastBackend;
}

/** Byte length of the last snapshot handed to the store, 0 before the first save. */
export function getLastSnapshotBytes(): number {
  return lastSnapshotBytes;
}

/** When this session last wrote a snapshot successfully; null before then. */
export function getLastSaveAt(): string | null {
  return lastSaveAt;
}

/**
 * Writes the engine's bytes to disk / storage.
 *
 * Browser order of preference:
 *   1. IndexedDB — quota is disk-backed, so it holds any realistic database.
 *   2. localStorage — legacy fallback, ~5 MB origin quota.
 * A failure at either level keeps the in-memory truth, records a message the
 * banner can act on, and backs off so the 5 s checkpoint does not re-encode
 * megabytes forever.
 */
export async function saveSnapshot(engine: SqliteEngine, opts: { force?: boolean } = {}): Promise<boolean> {
  if (!opts.force) {
    const wait = backoffDelay(saveFailures) - (Date.now() - lastSaveAttemptAt);
    if (saveFailures > 0 && wait > 0) return false;
  }
  lastSaveAttemptAt = Date.now();
  try {
    // engine.export() re-asserts PRAGMA foreign_keys itself (see SqliteEngine.export)
    const bytes = engine.export();
    lastSnapshotBytes = bytes.length;
    if (isDesktop()) {
      try {
        const tauri = await desktopDb();
        const res = await tauri.db_save_bytes({ bytesB64: b64encode(bytes) });
        lastBackend = 'desktop';
        lsSet(DIRTY_KEY, 'false');
        noteSaveSuccess();
        // eslint-disable-next-line no-console
        console.info(`[db] saved ${res.bytes} bytes to ${res.path}`);
        return true;
      } catch (err) {
        // File write failed (disk full, permissions, revoked access).
        if (err instanceof Error) throw withCause(err, 'disk-io');
        throw err;
      }
    }

    const encoded = MAGIC + ':' + b64encode(bytes);
    let stored = false;
    let idbError: unknown = null;
    try {
      if (await openIdb()) {
        await writeIdbSnapshot(encoded);
        stored = true;
        lastBackend = 'indexeddb';
        // IndexedDB now owns the only copy; reclaim the legacy one.
        dropLegacySnapshot();
      }
    } catch (err) {
      // A failing IndexedDB must not lose the save — fall through to
      // localStorage rather than reporting an error we can still recover from.
      idbError = err;
      console.warn('[db] IndexedDB snapshot write failed — falling back to localStorage', err);
    }
    if (!stored && !idbError) {
      // IndexedDB unavailable entirely: the legacy path is all we have.
      if (!ls()) {
        throw withCause(
          new Error(
            'This browser exposes no storage for the database snapshot (IndexedDB and localStorage ' +
              'are both unavailable). Export a .dentalbackup from Settings > Database & Backup now to protect this work.',
          ),
          'no-storage',
        );
      }
      try {
        localStorage.setItem(SNAPSHOT_KEY, encoded);
        stored = true;
        lastBackend = 'localstorage';
      } catch (err) {
        if (isQuotaError(err)) {
          throw withCause(
            new Error(
              `Browser storage is full: this database snapshot is ${formatBytes(bytes.length)} ` +
                `(${formatBytes(encoded.length)} encoded) and the site can hold about 5 MB. ` +
                'Export a .dentalbackup from Settings > Database & Backup now to protect this work.',
            ),
            'storage-full',
          );
        }
        throw err;
      }
    } else if (!stored && idbError) {
      // A blocked or failing IndexedDB with no usable fallback. The cause is
      // usually the same quota — the same snapshot that overflows localStorage
      // is simply too large for a quota-limited IndexedDB in a private window.
      throw withCause(
        new Error(
          `Snapshot could not be saved (${idbError instanceof Error ? idbError.message : String(idbError)}). ` +
            'Export a .dentalbackup from Settings > Database & Backup now to protect this work.',
        ),
        isQuotaError(idbError) ? 'storage-full' : 'indexeddb',
      );
    }

    lsSet(DIRTY_KEY, 'false');
    noteSaveSuccess();
    return true;
  } catch (err) {
    // Quota/IO: keep in-memory truth intact; surface clearly instead of failing silently.
    console.error('[db] SNAPSHOT SAVE FAILED — data still live in memory', err);
    noteSaveFailure(
      err,
      `backend=${lastBackend ?? 'none'} snapshot=${formatBytes(lastSnapshotBytes)}`,
    );
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
  const wasDirty = dirty;
  dirty = true;
  // The flag is a crash-recovery HINT, not a per-statement journal: once it is
  // durably 'true' in localStorage, rewriting the identical value changes
  // nothing about recovery but costs a synchronous storage write on EVERY
  // statement. engine.run is wrapped, and one collection sync issues ~22k
  // statements at 2500 cases — so the old unconditional write performed 22k
  // blocking localStorage writes per logical save (~105 ms of pure main-thread
  // I/O, measured at 4.67 us per write in Chromium). Write only on the
  // false -> true edge, which is the only transition that carries information.
  if (!wasDirty) lsSet(DIRTY_KEY, 'true');
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
  // force: a restore must write through even inside the failure backoff,
  // otherwise the reload after the restore re-reads the pre-restore snapshot.
  const ok = await saveSnapshot(engine, { force: true });
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
          // IndexedDB first (it holds any realistic size); the localStorage
          // write stays as the synchronous fallback for engines that tear the
          // page down before an async store transaction settles.
          void writeIdbSnapshot(MAGIC + ':' + b64encode(bytes)).catch(() => {
            try {
              localStorage.setItem(SNAPSHOT_KEY, MAGIC + ':' + b64encode(bytes));
              localStorage.setItem(DIRTY_KEY, 'false');
            } catch { /* best effort */ }
          });
          lsSet(DIRTY_KEY, 'false');
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
  return dirty || ls()?.getItem(DIRTY_KEY) === 'true';
}

export const SNAPSHOT_INFO = { SNAPSHOT_KEY, MAGIC };
