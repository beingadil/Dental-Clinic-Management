/**
 * Pre-restore safety snapshot storage.
 *
 * A restore REPLACES the live database. Before that happens we must keep one
 * recoverable copy of the outgoing data, otherwise a bad restore is
 * unrecoverable.
 *
 * Why this is not just `localStorage`: a .dentalbackup is the whole SQLite file
 * base64-encoded, so a safety copy is roughly as large as the database itself.
 * Storing it in localStorage means holding TWO full copies in a 5–10 MB quota,
 * which fails for any real clinic database — and the failure mode is the worst
 * possible one, a restore that reports "blocked" for reasons the user cannot see
 * or fix.
 *
 * IndexedDB stores binary blobs with a quota orders of magnitude larger and
 * without the 4x base64 expansion. localStorage remains as a fallback for
 * environments where IndexedDB is unavailable, and the restore stays blocked if
 * neither can hold the copy — a guardrail we want to keep.
 */

const DB_NAME = 'dsw_safety';
const STORE = 'snapshots';
const KEY = 'pre_restore';
/** localStorage fallback key (metadata + base64 payload). */
const LS_KEY = 'dsw_pre_restore_snapshot';

export interface SafetySnapshotMeta {
  takenAt: string;
  bytes: number;
  schemaVersion: number;
  /** Counts captured before the restore, for the "undo" summary line. */
  tableCounts?: Record<string, number>;
}

export interface SafetySnapshot {
  meta: SafetySnapshotMeta;
  data: Uint8Array;
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
    });
  } finally {
    db.close();
  }
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    });
  } finally {
    db.close();
  }
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
    });
  } finally {
    db.close();
  }
}

/**
 * Persists the outgoing database. Throws only when NO backend could hold it —
 * callers must treat that as a hard block on restore.
 */
export async function saveSafetySnapshot(
  bytes: Uint8Array,
  meta: Omit<SafetySnapshotMeta, 'bytes'>,
): Promise<'indexeddb' | 'localstorage'> {
  const record: SafetySnapshot = {
    meta: { ...meta, bytes: bytes.length },
    // Store a copy: sql.js reuses the underlying WASM heap on export(), so a
    // retained view would be mutated out from under us.
    data: new Uint8Array(bytes),
  };

  try {
    await idbPut(KEY, record);
    safeRemoveLocalStorage();
    return 'indexeddb';
  } catch {
    // fall through to localStorage
  }

  localStorage.setItem(LS_KEY, JSON.stringify({
    meta: record.meta,
    b64: bytesToB64(bytes),
  }));
  return 'localstorage';
}

/** Reads back the pre-restore copy, or null when there is none. */
export async function loadSafetySnapshot(): Promise<SafetySnapshot | null> {
  try {
    const record = await idbGet<SafetySnapshot>(KEY);
    if (record?.data?.length) return record;
  } catch {
    // fall through to localStorage
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.b64) return null;
    return { meta: parsed.meta, data: b64ToBytes(parsed.b64) };
  } catch {
    return null;
  }
}

/** Metadata only — safe to call during render/bootstrap. */
export async function readSafetySnapshotMeta(): Promise<SafetySnapshotMeta | null> {
  try {
    const record = await idbGet<SafetySnapshot>(KEY);
    if (record?.meta) return record.meta;
  } catch {
    // fall through
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw)?.meta ?? null;
  } catch {
    return null;
  }
}

export async function clearSafetySnapshot(): Promise<void> {
  try {
    await idbDelete(KEY);
  } catch {
    /* best effort — localStorage removal below is the important part */
  }
  safeRemoveLocalStorage();
}

function safeRemoveLocalStorage(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* non-fatal */
  }
}
