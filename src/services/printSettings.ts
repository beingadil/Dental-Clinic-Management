/**
 * Global print settings — how every printed document behaves app-wide
 * (paper size, margins, font scale, logo placement). Stored in SQLite via
 * the settingsRepo (`print` namespace). Per-document *section* toggles stay
 * in Print Studio templates; this only governs the shared page layout.
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
