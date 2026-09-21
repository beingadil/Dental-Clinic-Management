/**
 * Scheduled automatic backups. On a configurable cadence (off / daily /
 * weekly) the app writes a verified backup without anyone clicking anything:
 *
 * - Desktop: copies the live SQLite file (`db_backup_file`) into the app data
 *   directory as `dental_solutions.sqlite.<stamp>.bak`, then prunes old
 *   copies beyond the retention count. Cheap, exact, no base64.
 * - Browser: serializes a checksummed `.dentalbackup` JSON package and keeps
 *   the newest one in localStorage (the only headless-capable store there).
 *
 * State (schedule, last run, history) lives in the SQLite settings store via
 * settingsRepo, so it rides the normal backup/restore path.
 */
import { settingsRepo } from '../db/repos';
import { createBackup, serializeBackup } from './backupService';

export type BackupFrequency = 'off' | 'daily' | 'weekly';

export interface BackupRun {
  at: string;                 // ISO timestamp
  reason: 'boot' | 'interval' | 'manual';
  kind: 'file' | 'browser';
  ok: boolean;
  detail?: string;            // file name/size or error message
}

export interface BackupScheduleState {
  frequency: BackupFrequency;
  keep: number;               // retention count (desktop file rotation)
  lastRun: string | null;     // ISO timestamp of last successful run
  lastResult: BackupRun | null;
}

export const DEFAULT_BACKUP_SCHEDULE: BackupScheduleState = {
  frequency: 'daily',
  keep: 7,
  lastRun: null,
  lastResult: null,
};

const SCHEDULE_KEY = 'schedule';
const RUNS_KEY = 'runs';
const BROWSER_LATEST_KEY = 'dsw_autobackup_latest';
const MAX_RUNS = 20;

const INTERVAL_MS: Record<Exclude<BackupFrequency, 'off'>, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

let timer: ReturnType<typeof setTimeout> | null = null;

function tauri(): { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<any> } | null {
  const api = (window as any).__TAURI_INTERNALS__;
  return api && typeof api.invoke === 'function' ? api : null;
}

export function isDesktopShell(): boolean {
  return tauri() !== null;
}

export function getBackupSchedule(): BackupScheduleState {
  try {
    const row = settingsRepo.get('backups', SCHEDULE_KEY); // already JSON-parsed
    if (row && typeof row === 'object') {
      return { ...DEFAULT_BACKUP_SCHEDULE, ...row };
    }
  } catch { /* database not ready yet — defaults are safe */ }
  return { ...DEFAULT_BACKUP_SCHEDULE };
}

export function saveBackupSchedule(next: Partial<BackupScheduleState>): BackupScheduleState {
  const merged = { ...getBackupSchedule(), ...next };
  settingsRepo.set('backups', SCHEDULE_KEY, merged);
  return merged;
}

export function getBackupRuns(): BackupRun[] {
  try {
    const row = settingsRepo.get('backups', RUNS_KEY);
    return Array.isArray(row) ? (row as BackupRun[]) : [];
  } catch {
    return [];
  }
}

function recordRun(run: BackupRun): void {
  const runs = [run, ...getBackupRuns()].slice(0, MAX_RUNS);
  settingsRepo.set('backups', RUNS_KEY, runs);
}

function isDue(state: BackupScheduleState, now: number): boolean {
  if (state.frequency === 'off') return false;
  if (!state.lastRun) return true;
  return now - new Date(state.lastRun).getTime() >= INTERVAL_MS[state.frequency];
}

/** Prune desktop .bak files beyond the retention count (newest kept). */
async function pruneDesktopBackups(keep: number): Promise<void> {
  const api = tauri();
  if (!api || keep < 1) return;
  try {
    const files: Array<{ name: string; modified: string }> = await api.invoke('backup_list');
    const sorted = files.sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
    for (const f of sorted.slice(keep)) {
      await api.invoke('backup_delete', { name: f.name });
    }
  } catch { /* non-fatal: rotation is best-effort */ }
}

/**
 * Run one automatic backup pass. Returns the run record (or null when the
 * schedule is off / not due and force=false).
 */
export async function runScheduledBackup(reason: 'boot' | 'interval' | 'manual', force = false): Promise<BackupRun | null> {
  const state = getBackupSchedule();
  if (state.frequency === 'off' && !force) return null;
  if (!force && !isDue(state, Date.now())) return null;

  const api = tauri();
  let run: BackupRun;
  if (api) {
    try {
      const path: string = await api.invoke('db_backup_file');
      const name = path.split(/[\\/]/).pop() || path;
      run = { at: new Date().toISOString(), reason, kind: 'file', ok: true, detail: name };
      await pruneDesktopBackups(state.keep);
    } catch (err: any) {
      run = { at: new Date().toISOString(), reason, kind: 'file', ok: false, detail: String(err?.message || err) };
    }
  } else {
    try {
      const pkg = await createBackup('automatic');
      const json = serializeBackup(pkg);
      try {
        localStorage.setItem(BROWSER_LATEST_KEY, json);
        run = { at: new Date().toISOString(), reason, kind: 'browser', ok: true, detail: `${(json.length / 1024).toFixed(0)} KB` };
      } catch {
        run = { at: new Date().toISOString(), reason, kind: 'browser', ok: false, detail: 'browser storage full — export a .dentalbackup manually' };
      }
    } catch (err: any) {
      run = { at: new Date().toISOString(), reason, kind: 'browser', ok: false, detail: String(err?.message || err) };
    }
  }

  recordRun(run);
  if (run.ok) saveBackupSchedule({ lastRun: run.at, lastResult: run });
  else saveBackupSchedule({ lastResult: run });
  return run;
}

/**
 * Boot hook: first pass a minute after startup (lets the DB finish loading),
 * then re-check hourly. Hourly re-checks keep the cadence honest even when
 * the app runs for days without a restart.
 */
export function initBackupScheduler(): void {
  if (timer) return; // already running
  const tick = (reason: 'boot' | 'interval') => {
    runScheduledBackup(reason).catch(() => { /* never crash the app over a backup */ });
  };
  setTimeout(() => tick('boot'), 60 * 1000);
  timer = setInterval(() => tick('interval'), 60 * 60 * 1000);
}
