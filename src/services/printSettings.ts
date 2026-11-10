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
import { ACCOUNT_BALANCE_ROWS, isAccountBalanceRow } from './printSections';

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
export { ACCOUNT_BALANCE_ROWS, isAccountBalanceRow } from './printSections';
export function loadDocumentSections(kind: string, fallback: string[]): string[] {
  try {
    let stored: unknown = settingsRepo.get('print', `sections_${kind}`);
    // Legacy double-encoded row: one extra parse.
    if (typeof stored === 'string') {
      try { stored = JSON.parse(stored); } catch { stored = null; }
    }
    if (Array.isArray(stored)) {
      // Lists written before the account summary was split into rows carry the
      // retired `balanceSummary` id; expand it onto the four rows in catalog
      // order (the filter below dedupes and orders to the document's order).
      const expanded = stored.flatMap((id) =>
        id === 'balanceSummary' ? [...ACCOUNT_BALANCE_ROWS] : [id],
      );
      // Keep the stored order of known sections; unknown ids are dropped.
      return fallback.filter((id) => expanded.includes(id));
    }
  } catch { /* fall through to the shipped default */ }
  return [...fallback];
}

export function saveDocumentSections(kind: string, sections: string[]): void {
  settingsRepo.set('print', `sections_${kind}`, sections);
}

/**
 * The statement's `bank` section was added after `sections_statement` rows
 * were being written, so a stored list without the id cannot distinguish
 * "saved before the option existed" from "saved with the block deliberately
 * excluded". A reload must not resurrect a block the operator unticked, so a
 * deliberate exclusion is recorded as its own marker row:
 *
 * - marker `off`      → the operator excluded it; never re-adopted.
 * - marker `on`/none  → adopt `bank` the moment the data that feeds the block
 *   (a saved bank name) exists, and persist the adoption so Settings and the
 *   print surfaces all read the same list.
 */
const BANK_MARKER_KEY = 'sections_statement_bank';

export function setStatementBankExcluded(excluded: boolean): void {
  settingsRepo.set('print', BANK_MARKER_KEY, excluded ? 'off' : 'on');
}

export function isStatementBankExcluded(): boolean {
  try {
    return String(settingsRepo.get('print', BANK_MARKER_KEY) ?? '') === 'off';
  } catch { return false; }
}

/**
 * Stored statement sections with the bank option adopted onto lists that
 * predate it (`hasBankData` = a bank name is saved on the branding record).
 * No-op when already present, deliberately excluded, or nothing to show.
 */
export function loadStatementSectionsAdoptingBank(fallback: string[], hasBankData: boolean): string[] {
  const stored = loadDocumentSections('statement', fallback);
  if (stored.includes('bank') || isStatementBankExcluded() || !hasBankData) return stored;
  const adopted = [...stored, 'bank'];
  saveDocumentSections('statement', adopted);
  return adopted;
}

/**
 * The invoice's account summary (opening balance / this invoice / closing)
 * joined the invoice section catalog later than operators had started saving
 * lists, exactly like the statement bank block above.
 *
 * Old lists lack the four row ids even though the block used to print as part
 * of `totals` — so a plain reload would silently remove a figure from every
 * invoice. Adoption is limited to lists that DID print the block (they carry
 * `totals`), which preserves the previous paper exactly. Once the operator
 * unticks every summary row, the marker stops them being resurrected.
 */
const INVOICE_SUMMARY_MARKER_KEY = 'sections_invoice_balanceSummary';

export function setInvoiceSummaryExcluded(excluded: boolean): void {
  settingsRepo.set('print', INVOICE_SUMMARY_MARKER_KEY, excluded ? 'off' : 'on');
}

export function isInvoiceSummaryExcluded(): boolean {
  try {
    return String(settingsRepo.get('print', INVOICE_SUMMARY_MARKER_KEY) ?? '') === 'off';
  } catch { return false; }
}

/**
 * Stored invoice sections with the account summary rows adopted onto lists
 * that predate them. No-op when already present, deliberately excluded, or
 * when the list never printed the block (no `totals`).
 */
export function loadInvoiceSectionsAdoptingSummary(fallback: string[]): string[] {
  const stored = loadDocumentSections('invoice', fallback);
  if (stored.some(isAccountBalanceRow) || isInvoiceSummaryExcluded() || !stored.includes('totals')) {
    return stored;
  }
  // Insert in catalog order, not at the end: the print dialog and Settings
  // must list the rows where every other invoice knows them.
  const adopted = fallback.filter((id) => isAccountBalanceRow(id) || stored.includes(id));
  saveDocumentSections('invoice', adopted);
  return adopted;
}
