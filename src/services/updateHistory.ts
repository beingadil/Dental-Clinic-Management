/**
 * Auto-update history — a small persisted log consumed by Settings → Updates.
 * Every meaningful lifecycle event is appended (newest first, capped), so the
 * clinic can see exactly what the updater did and when.
 *
 * NOTE: settingsRepo.get/set already JSON-(de)serialize values — pass objects
 * through as-is; never double-encode.
 */
import { settingsRepo } from '../db/repos';
import { currentVersion } from './updateService';

export interface UpdateHistoryEntry {
  at: string;          // ISO timestamp
  version: string;     // release the event concerns
  state:
    | 'available'      // a newer release was detected
    | 'installed'      // verified installer launched (app exits to apply)
    | 'failed'         // check, download, verification or install failure
    | 'up_to_date';    // manual or automatic check found nothing newer
  message?: string;    // failure detail or notes
  from_version?: string;
}

const KEY = 'history';
const MAX_ENTRIES = 50;

export function getUpdateHistory(): UpdateHistoryEntry[] {
  try {
    const row = settingsRepo.get('updates', KEY); // already JSON-parsed by the repo
    return Array.isArray(row) ? (row as UpdateHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Appends an event (newest first) and trims the log. Never throws. */
export function recordUpdateHistory(entry: Omit<UpdateHistoryEntry, 'at' | 'from_version'> & { from_version?: string }): void {
  try {
    const next = [
      { at: new Date().toISOString(), from_version: currentVersion(), ...entry },
      ...getUpdateHistory(),
    ].slice(0, MAX_ENTRIES);
    settingsRepo.set('updates', KEY, next); // repo JSON-stringifies
  } catch { /* history is best-effort; never block the update flow */ }
}
