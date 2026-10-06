/**
 * Persisted persistence-failure journal.
 *
 * Why this exists (audit D6 / F7): when the autosave failed, the ONLY trace was
 * a `console.error`. The counter that decided retry backoff lived in a module
 * variable, so it died with the page; and nothing recorded WHAT went wrong, so
 * the clinic could not tell "the disk is full" from "IndexedDB is blocked" from
 * "one row violates a UNIQUE constraint and every sync has been aborting since
 * Tuesday" — the last of which is the single highest-impact failure mode in this
 * app, because the collection sync deletes and re-inserts every table inside one
 * transaction, so ONE bad row stops ALL persistence.
 *
 * So: every failure is appended to a small capped journal in localStorage
 * (which is the one store that still works when the database store itself is
 * the thing that failed), with its kind, its classified cause, and its message.
 * Counters are persisted too, so a failure streak survives a reload instead of
 * resetting to a healthy-looking zero.
 *
 * Nothing in here may throw. A diagnostics log that can itself fail a save is
 * worse than no log.
 */

export type FailureKind = 'save' | 'sync' | 'restore';

export type FailureCause =
  | 'storage-full' // browser storage quota refused the write
  | 'indexeddb' // the IndexedDB snapshot store failed
  | 'no-storage' // neither IndexedDB nor localStorage is available
  | 'disk-io' // desktop file write failed
  | 'data-constraint' // SQLite UNIQUE / CHECK / NOT NULL / FK rejection
  | 'unknown';

export interface PersistenceFailure {
  /** Stable id, so the panel can key a list without trusting timestamps. */
  id: string;
  kind: FailureKind;
  cause: FailureCause;
  /** The message as shown to the user. Never empty. */
  message: string;
  /** When it happened, ISO. */
  at: string;
  /** Optional extra context (phase, table, row count). */
  detail?: string;
}

export interface FailureKindStats {
  /** Consecutive failures; reset by a success. */
  streak: number;
  /** Every failure of this kind since the log was last cleared. */
  total: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
}

export interface FailureSummary {
  save: FailureKindStats;
  sync: FailureKindStats;
  restore: FailureKindStats;
  firstFailureAt: string | null;
  /** Newest first. */
  recent: PersistenceFailure[];
}

const STORAGE_KEY = 'dsw_persistence_failures';
const STATE_VERSION = 1;
/** Ring-buffer cap: enough to see a pattern, small enough to never matter. */
const MAX_ENTRIES = 50;
const MAX_MESSAGE = 400;
const MAX_DETAIL = 200;

const KINDS: FailureKind[] = ['save', 'sync', 'restore'];

interface FailureState {
  version: number;
  failures: PersistenceFailure[];
  streaks: Record<FailureKind, number>;
  totals: Record<FailureKind, number>;
  lastFailureAt: Partial<Record<FailureKind, string | null>>;
  lastSuccessAt: Partial<Record<FailureKind, string | null>>;
  firstFailureAt: string | null;
}

function emptyState(): FailureState {
  const streaks = {} as Record<FailureKind, number>;
  const totals = {} as Record<FailureKind, number>;
  for (const k of KINDS) {
    streaks[k] = 0;
    totals[k] = 0;
  }
  return {
    version: STATE_VERSION,
    failures: [],
    streaks,
    totals,
    lastFailureAt: {},
    lastSuccessAt: {},
    firstFailureAt: null,
  };
}

/* ------------------------------------------------------------------ storage */

/**
 * localStorage is the journal's home on purpose: it is the one store that keeps
 * working when IndexedDB is blocked or the database snapshot is what failed.
 * Every access is guarded — absent in Node/jsdom and in some private modes.
 */
function ls(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

let cache: FailureState | null = null;

function load(): FailureState {
  if (cache) return cache;
  try {
    const raw = ls()?.getItem(STORAGE_KEY);
    if (!raw) return (cache = emptyState());
    const parsed = JSON.parse(raw) as Partial<FailureState>;
    const base = emptyState();
    if (parsed.version !== STATE_VERSION) return (cache = base);
    if (Array.isArray(parsed.failures)) base.failures = parsed.failures.slice(0, MAX_ENTRIES);
    for (const k of KINDS) {
      base.streaks[k] = Number(parsed.streaks?.[k]) || 0;
      base.totals[k] = Number(parsed.totals?.[k]) || 0;
      base.lastFailureAt[k] = parsed.lastFailureAt?.[k] ?? null;
      base.lastSuccessAt[k] = parsed.lastSuccessAt?.[k] ?? null;
    }
    base.firstFailureAt = parsed.firstFailureAt ?? null;
    return (cache = base);
  } catch {
    // Corrupt log: a fresh one is strictly better than failing to boot.
    return (cache = emptyState());
  }
}

function persist(state: FailureState): void {
  try {
    ls()?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full origin means the journal is the first thing to go; the in-memory
    // copy still feeds the panel for this session.
  }
}

function notify(): void {
  try {
    window.dispatchEvent(new Event('persistence:failures'));
  } catch {
    /* no DOM (tests/Node) */
  }
}

/* ------------------------------------------------------------- classifying */

function textOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

/**
 * Turn an arbitrary thrown value into a cause the panel can act on. Message
 * matching is the only option for SQLite errors, which sql.js raises as plain
 * `Error` objects carrying SQLite's own wording.
 */
export function classifyFailure(err: unknown): FailureCause {
  const name = (err as { name?: string } | null)?.name ?? '';
  const code = (err as { code?: number } | null)?.code;
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22) return 'storage-full';

  const msg = textOf(err).toLowerCase();
  if (msg.includes('quota') || msg.includes('storage is full') || msg.includes('quotaexceeded')) return 'storage-full';
  if (msg.includes('indexeddb')) return 'indexeddb';
  if (msg.includes('no storage') || msg.includes('both unavailable')) return 'no-storage';
  if (
    msg.includes('constraint failed') ||
    msg.includes('unique constraint') ||
    msg.includes('foreign key constraint') ||
    msg.includes('check constraint') ||
    msg.includes('not null constraint') ||
    msg.includes('datatype mismatch')
  ) {
    return 'data-constraint';
  }
  if (msg.includes('ipc') || msg.includes('os error') || msg.includes('permission denied') || msg.includes('no such file')) {
    return 'disk-io';
  }
  return 'unknown';
}

/* -------------------------------------------------------------------- writes */

let seq = 0;

/**
 * Appends a failure and returns the new consecutive-failure streak, which the
 * retry path uses for backoff — so the backoff survives a reload instead of
 * resetting to "no failures yet" every time the user reopens the app.
 */
export function recordFailure(
  kind: FailureKind,
  err: unknown,
  opts: { cause?: FailureCause; detail?: string; at?: string } = {},
): { streak: number; total: number; entry: PersistenceFailure } {
  const state = load();
  const message = (textOf(err) || 'Unknown failure').slice(0, MAX_MESSAGE);
  const at = opts.at ?? new Date().toISOString();
  const entry: PersistenceFailure = {
    id: `${kind}-${at}-${(seq += 1)}`,
    kind,
    cause: opts.cause ?? classifyFailure(err),
    message,
    at,
    detail: opts.detail ? opts.detail.slice(0, MAX_DETAIL) : undefined,
  };
  state.failures = [entry, ...state.failures].slice(0, MAX_ENTRIES);
  state.streaks[kind] = (state.streaks[kind] ?? 0) + 1;
  state.totals[kind] = (state.totals[kind] ?? 0) + 1;
  state.lastFailureAt[kind] = at;
  state.firstFailureAt = state.firstFailureAt ?? at;
  persist(state);
  notify();
  return { streak: state.streaks[kind], total: state.totals[kind], entry };
}

/** Clears the streak for one kind. Totals and the journal are kept. */
export function recordSuccess(kind: FailureKind): void {
  const state = load();
  if ((state.streaks[kind] ?? 0) === 0) {
    state.lastSuccessAt[kind] = new Date().toISOString();
    persist(state);
    return;
  }
  state.streaks[kind] = 0;
  state.lastSuccessAt[kind] = new Date().toISOString();
  persist(state);
  notify();
}

export function clearFailureLog(): void {
  cache = emptyState();
  try {
    ls()?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to reclaim */
  }
  notify();
}

/* ------------------------------------------------------------------- reads */

function statsOf(state: FailureState, kind: FailureKind): FailureKindStats {
  return {
    streak: state.streaks[kind] ?? 0,
    total: state.totals[kind] ?? 0,
    lastFailureAt: state.lastFailureAt[kind] ?? null,
    lastSuccessAt: state.lastSuccessAt[kind] ?? null,
  };
}

export function getFailureSummary(): FailureSummary {
  const state = load();
  return {
    save: statsOf(state, 'save'),
    sync: statsOf(state, 'sync'),
    restore: statsOf(state, 'restore'),
    firstFailureAt: state.firstFailureAt,
    recent: state.failures.slice(),
  };
}

export function getRecentFailures(kind?: FailureKind): PersistenceFailure[] {
  const all = load().failures;
  return (kind ? all.filter((f) => f.kind === kind) : all).slice();
}

/**
 * Plain-text diagnostics for the "copy" button — the format is deliberately
 * the same shape as the audit findings, so a report pasted into a support
 * thread can be read without the app.
 */
export function exportFailureDiagnostics(): string {
  const s = getFailureSummary();
  const lines: string[] = [
    `# Persistence failure log — ${new Date().toISOString()}`,
    '',
    `save   streak=${s.save.streak} total=${s.save.total} lastFailure=${s.save.lastFailureAt ?? 'never'} lastSuccess=${s.save.lastSuccessAt ?? 'never'}`,
    `sync   streak=${s.sync.streak} total=${s.sync.total} lastFailure=${s.sync.lastFailureAt ?? 'never'} lastSuccess=${s.sync.lastSuccessAt ?? 'never'}`,
    `restore streak=${s.restore.streak} total=${s.restore.total} lastFailure=${s.restore.lastFailureAt ?? 'never'}`,
    `firstFailureAt=${s.firstFailureAt ?? 'never'}`,
    '',
  ];
  if (!s.recent.length) lines.push('(no failures recorded)');
  for (const f of s.recent) {
    lines.push(`[${f.at}] ${f.kind} (${f.cause}) — ${f.message}${f.detail ? ` | ${f.detail}` : ''}`);
  }
  return lines.join('\n');
}

export const FAILURE_LOG_INFO = { STORAGE_KEY, MAX_ENTRIES };
