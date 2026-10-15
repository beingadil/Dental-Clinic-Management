/**
 * Global SLA settings — the turnaround promise attached to each case priority,
 * for the whole laboratory.
 *
 * These used to be a frozen constant, so the numbers a clinic quoted could not
 * be changed without editing and rebuilding the app: every case, the delivery
 * date the wizard auto-computed, the analytics turnaround report and the job
 * slip all read one hardcoded table. They are now operator-configurable and
 * stored in SQLite (`settingsRepo`, `sla` namespace), and they apply to EVERY
 * case the moment they are saved.
 *
 * WHY THE CONSTANT EXPORTS STILL EXIST
 * `PRIORITY_SLA_DAYS`, `prioritySlaLabel` and `computeSlaDueDate` are imported by
 * the case wizard, the analytics turnaround report and their tests. Rather than
 * change every call site to await a load, the stored map is resolved ONCE at
 * module load and the existing signatures are kept as thin wrappers over it.
 * `reloadSlaSettings()` re-resolves after a save so the next render is correct;
 * React state in the caller is what actually drives a re-render.
 *
 * PERSISTENCE CONTRACT — identical to printSettings: `settingsRepo.get()`
 * returns the ALREADY-PARSED value, so nothing here parses twice, and
 * `saveSlaSettings` hands the OBJECT to `set()`, which stringifies it. Rows
 * written by the old double-encoding bug are tolerated on read and healed on the
 * next save.
 */
import { settingsRepo } from '../db/repos';
import { PriorityLevel } from '../types';
import { getDateStr } from '../utils/dateUtils';

/** The shipped defaults. A fresh install — or a failed read — gets exactly these. */
export const DEFAULT_SLA_DAYS: Record<PriorityLevel, number> = {
  urgent: 1,
  high: 2,
  normal: 4,
  low: 7,
};

/**
 * The stored map, resolved once at module load and refreshed by
 * `reloadSlaSettings()`. Declared `let` because it is reassigned; every read goes
 * through it, so a save followed by a re-render shows the new numbers.
 */
let slaDays: Record<PriorityLevel, number> = { ...DEFAULT_SLA_DAYS };

/** Upper bound on a turnaround. Guards against a typo saving a 9999-day promise. */
const MAX_SLA_DAYS = 365;

const isPriority = (v: unknown): v is PriorityLevel =>
  v === 'low' || v === 'normal' || v === 'high' || v === 'urgent';

/**
 * Coerce an already-parsed (or legacy double-encoded) value into a full map.
 * A missing, malformed or out-of-range entry falls back PER LEVEL rather than
 * discarding the whole map: one bad key must not reset the other three to
 * defaults and silently change the turnaround a clinic is quoting.
 */
function coerce(parsed: unknown): Record<PriorityLevel, number> {
  const out: Record<PriorityLevel, number> = { ...DEFAULT_SLA_DAYS };
  if (typeof parsed === 'string') {
    try { return coerce(JSON.parse(parsed)); } catch { return out; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isPriority(k)) continue; // dead/stale key — dropped, not carried
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAX_SLA_DAYS) continue;
    out[k] = Math.round(n);
  }
  return out;
}

/** The stored map, read fresh. Never throws — a read failure yields defaults. */
export function loadSlaSettings(): Record<PriorityLevel, number> {
  try {
    const stored = settingsRepo.get('sla', 'days');
    if (stored !== undefined) return coerce(stored);
  } catch { /* fall through to defaults */ }
  return { ...DEFAULT_SLA_DAYS };
}

/** Persist the map, then refresh the module-level copy so the UI re-reads it. */
export function saveSlaSettings(days: Record<PriorityLevel, number>): void {
  settingsRepo.set('sla', 'days', coerce(days));
  reloadSlaSettings();
}

/** Re-resolve the module-level map from storage. Called after a save. */
export function reloadSlaSettings(): void {
  slaDays = loadSlaSettings();
}

// Seed the module copy at load so the frozen exports below are correct on first
// read, including in tests that never call load() explicitly.
slaDays = loadSlaSettings();

/**
 * The live priority → turnaround map.
 *
 * A FUNCTION, not the old frozen const: exporting a frozen object meant every
 * importer held the values from module-load time and kept them after a save. The
 * name is kept so the existing call sites need no change, but it now reads the
 * current value on every access.
 */
export const PRIORITY_SLA_DAYS: Record<PriorityLevel, number> = new Proxy(
  {} as Record<PriorityLevel, number>,
  {
    get: (_t, prop: string) => slaDays[prop as PriorityLevel],
    has: (_t, prop: string) => prop in slaDays,
    ownKeys: () => Object.keys(slaDays),
    getOwnPropertyDescriptor: (_t, prop: string) => ({
      value: slaDays[prop as PriorityLevel],
      enumerable: true,
      configurable: true,
    }),
  },
);

export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  low: 'Low',
  normal: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const PRIORITY_ORDER: PriorityLevel[] = ['urgent', 'high', 'normal', 'low'];

/** "Urgent — 1 day", "Medium — 4 days" (for buttons, selects, badges). */
export function prioritySlaLabel(p: PriorityLevel): string {
  const days = slaDays[p];
  return `${PRIORITY_LABELS[p]} — ${days} day${days === 1 ? '' : 's'}`;
}

/**
 * Due date = today + the configured turnaround for `priority`, on the LOCAL day.
 *
 * `normalFallbackDays` exists because `UserPreferences.default_turnaround_days`
 * is a real, operator-editable control in Settings → Preferences that used to be
 * read by nothing at all — the SLA table quietly ignored it. Rather than add a
 * SECOND editor for the same promise, that preference is now the fallback for the
 * `normal` priority when the operator has not set an explicit SLA row for it.
 * The SLA table always wins; this only fills a gap.
 */
export function computeSlaDueDate(
  priority: PriorityLevel,
  from: Date = new Date(),
  normalFallbackDays?: number,
): string {
  const d = new Date(from);
  const fallback =
    priority === 'normal' &&
    typeof normalFallbackDays === 'number' &&
    Number.isFinite(normalFallbackDays) &&
    normalFallbackDays > 0 &&
    normalFallbackDays <= MAX_SLA_DAYS
      ? Math.round(normalFallbackDays)
      : slaDays[priority];
  d.setDate(d.getDate() + fallback);
  // Local day, not toISOString(): setDate() works in local time, so reading
  // the result back in UTC walked the date back a day for every clinic
  // booking before 05:00 PKT.
  return getDateStr(d);
}