/**
 * Global print settings — how every printed document behaves app-wide
 * (paper size, margins, font scale, logo placement). Stored in SQLite via
 * the settingsRepo (`print` namespace). Per-document *section* toggles belong
 * to each print dialog; this only governs the shared page layout.
 */
import { settingsRepo } from '../db/repos';

export interface PrintSettings {
  paper: 'a4' | 'letter';
  margin: 'narrow' | 'normal' | 'wide';
  fontSize: 'compact' | 'normal' | 'large';
  showLogo: boolean;
  logoPosition: 'left' | 'center' | 'right';
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paper: 'a4',
  margin: 'normal',
  fontSize: 'normal',
  showLogo: true,
  logoPosition: 'left',
};

export function loadPrintSettings(): PrintSettings {
  try {
    const row = settingsRepo.get('print', 'settings');
    if (row) {
      return { ...DEFAULT_PRINT_SETTINGS, ...JSON.parse(row.value) };
    }
  } catch { /* fall through to defaults */ }
  return { ...DEFAULT_PRINT_SETTINGS };
}

export function savePrintSettings(settings: PrintSettings): void {
  settingsRepo.set('print', 'settings', JSON.stringify(settings));
}

/**
 * Which sections a document kind prints. This is the real "invoice printing
 * setting": the invoice dialog, batch printing and Settings → Print all read
 * the same stored list, so what you preview is exactly what comes out of the
 * printer — one source of truth instead of per-dialog local state.
 */
export function loadDocumentSections(kind: string, fallback: string[]): string[] {
  try {
    const row = settingsRepo.get('print', `sections_${kind}`);
    if (row) {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed)) {
        // Keep the stored order of known sections; unknown ids are dropped.
        return fallback.filter((id) => parsed.includes(id));
      }
    }
  } catch { /* fall through to the shipped default */ }
  return [...fallback];
}

export function saveDocumentSections(kind: string, sections: string[]): void {
  settingsRepo.set('print', `sections_${kind}`, JSON.stringify(sections));
}
