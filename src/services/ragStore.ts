/**
 * Lazy, in-memory loader for the build-time RAG index (public/rag/rag-manifest.json).
 * Never touches the app database; serves from cache once initialised.
 */
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../db/engine';

const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || '/';
const WASM = `${BASE}vendor/sql-wasm.wasm`;

export interface RagManifest {
  schemaVersion: number;
  commit: string;
  builtAt: string;
  file: string;
  chunks: number;
  bytes: number;
  sha256: string;
  tokenizer: string;
  k1: number;
  b: number;
  zoneWeights: { symbol: number; heading: number; content: number };
}

export type RagStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

let cachedEngine: SqliteEngine | null = null;
let cachedManifest: RagManifest | null = null;
let loadPromise: Promise<SqliteEngine | null> | null = null;
let status: RagStatus = 'idle';

export const getRagStatus = (): RagStatus => status;
export const getRagManifest = (): RagManifest | null => cachedManifest;

const bytesMatch = async (bytes: Uint8Array, expectedSha: string): Promise<boolean> => {
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
    const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    return hex === expectedSha;
  } catch {
    return true; // extremely defensive: skip verify rather than break offline shells
  }
};

async function loadOnce(): Promise<SqliteEngine | null> {
  if (cachedEngine) return cachedEngine;
  status = 'loading';
  try {
    const mres = await fetch(`${BASE}rag/rag-manifest.json`, { cache: 'no-cache' });
    if (!mres.ok) throw new Error('manifest missing');
    const manifest = (await mres.json()) as RagManifest;
    if (!manifest || manifest.schemaVersion !== 1 || !manifest.file) throw new Error('bad manifest');

    const fres = await fetch(`${BASE}rag/${manifest.file}`, { cache: 'no-cache' });
    if (!fres.ok) throw new Error('index fetch failed');
    const bytes = new Uint8Array(await fres.arrayBuffer());
    if (manifest.bytes && bytes.byteLength !== manifest.bytes) throw new Error('byte mismatch');
    if (manifest.sha256 && !(await bytesMatch(bytes, manifest.sha256))) throw new Error('sha mismatch');

    const SQL = await initSqlJs({ locateFile: () => WASM });
    // Open WITHOUT migrations: the index is a build artifact, never app data.
    cachedEngine = await SqliteEngine.create(SQL, bytes);
    cachedManifest = manifest;
    status = 'ready';
    return cachedEngine;
  } catch {
    status = 'unavailable';
    return null;
  }
}

export async function ensureRagStore(): Promise<SqliteEngine | null> {
  if (!loadPromise) loadPromise = loadOnce();
  return loadPromise;
}

/** Test-only: drop the memoised engine so a suite can re-initialise. */
export const resetRagStoreForTests = (): void => {
  cachedEngine = null;
  cachedManifest = null;
  loadPromise = null;
  status = 'idle';
};
