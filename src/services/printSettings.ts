/**
 * Global print settings — how every printed document behaves app-wide
 * (paper size, margins, font scale, logo placement). Stored in SQLite via
 * the settingsRepo (`print` namespace). Per-document *section* toggles belong
 * to each print dialog; this only governs the shared page layout.
 *
 * Persistence contract (B1/F1 regression — do not regress): settingsRepo.get()
 * returns the ALREADY-PARSED value (repos.ts JSON.parses the column), so a
 * load must NOT parse again, and a save must hand set() the OBJECT (set()
 * stringifies). Rows written by the old double-encoding bug (a JSON string
 * handed to set() → stringified twice) are tolerated on read and healed by
 * the next save.
 */
import { settingsRepo } from '../db/repos';

export interface PrintSettings {
  paper: 'a4' | 'letter';
  margin: 'narrow' | 'normal' | 'wide';
  fontSize: 'compact' | 'normal' | 'large';
  showLogo: boolean;
  logoPosition: 'left' | 'center' | 'right';
  /** Job slip physical style: compact 100×95mm bag tag or the full-page lab card. */
  jobSlipStyle: 'compact' | 'full';
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paper: 'a4',
  margin: 'normal',
  fontSize: 'normal',
  showLogo: true,
  logoPosition: 'left',
  jobSlipStyle: 'compact',
};

const KNOWN_KEYS = new Set(Object.keys(DEFAULT_PRINT_SETTINGS) as (keyof PrintSettings)[]);

/** Coerce one already-parsed (or legacy double-encoded) value into settings. */
function coerce(parsed: unknown): PrintSettings {
  // Legacy double-encoded rows arrive as a string that still needs one parse.
  if (typeof parsed === 'string') {
    try { return coerce(JSON.parse(parsed)); } catch { return { ...DEFAULT_PRINT_SETTINGS }; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...DEFAULT_PRINT_SETTINGS };
  }
  // Keep only known keys — dead/stale keys must not survive a round-trip.
  const out: PrintSettings = { ...DEFAULT_PRINT_SETTINGS };
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (KNOWN_KEYS.has(k as keyof PrintSettings) && v !== undefined && v !== null) {
      (out as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

export function loadPrintSettings(): PrintSettings {
  try {
    const stored = settingsRepo.get('print', 'settings');
    if (stored !== undefined) {
      return coerce(stored);
    }
  } catch { /* fall through to defaults */ }
  return { ...DEFAULT_PRINT_SETTINGS };
}

export function savePrintSettings(settings: PrintSettings): void {
  settingsRepo.set('print', 'settings', settings);
}

/**
 * Which sections a document kind prints. This is the real "invoice printing
 * setting": the invoice dialog, batch printing and Settings → Print all read
 * the same stored list, so what you preview is exactly what comes out of the
 * printer — one source of truth instead of per-dialog local state.
 */
export function loadDocumentSections(kind: string, fallback: string[]): string[] {
  try {
    let stored: unknown = settingsRepo.get('print', `sections_${kind}`);
    // Legacy double-encoded row: one extra parse.
    if (typeof stored === 'string') {
      try { stored = JSON.parse(stored); } catch { stored = null; }
    }
    if (Array.isArray(stored)) {
      // Keep the stored order of known sections; unknown ids are dropped.
      return fallback.filter((id) => stored.includes(id));
    }
  } catch { /* fall through to the shipped default */ }
  return [...fallback];
}

export function saveDocumentSections(kind: string, sections: string[]): void {
  settingsRepo.set('print', `sections_${kind}`, sections);
}
