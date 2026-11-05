import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase, getDatabase } from '../../src/db/core';
import {
  loadPrintSettings,
  savePrintSettings,
  loadDocumentSections,
  saveDocumentSections,
  setStatementBankExcluded,
  isStatementBankExcluded,
  loadStatementSectionsAdoptingBank,
  loadInvoiceSectionsAdoptingSummary,
  setInvoiceSummaryExcluded,
  isInvoiceSummaryExcluded,
  DEFAULT_PRINT_SETTINGS,
  type PrintSettings,
} from '../../src/services/printSettings';

/**
 * B1/F1 regression: printSettings used to JSON.parse the value returned by
 * settingsRepo.get() — which is ALREADY parsed — so row.value was undefined,
 * loadPrintSettings threw and silently returned defaults, while
 * savePrintSettings double-encoded its row. Paper size, margins, font scale
 * and every document-section toggle were dead while the UI claimed
 * "Saved — applies to all documents".
 */

async function freshDb() {
  const SQL = await initSqlJs();
  const eng = await SqliteEngine.create(SQL, null);
  eng.migrate();
  setDatabase(eng);
  return eng;
}

beforeEach(async () => {
  await freshDb();
});

describe('printSettings persistence (B1/F1)', () => {
  it('round-trips settings (save → load returns what was saved)', () => {
    const saved: PrintSettings = { ...DEFAULT_PRINT_SETTINGS, paper: 'letter', fontSize: 'large', logoPosition: 'center' };
    savePrintSettings(saved);
    expect(loadPrintSettings()).toEqual(saved);
  });

  it('tolerates a legacy double-encoded row (save stringified twice)', () => {
    // What the old savePrintSettings wrote: a JSON string handed to set(),
    // which stringified AGAIN.
    const legacy = JSON.stringify(JSON.stringify({ ...DEFAULT_PRINT_SETTINGS, margin: 'wide' }));
    getDatabase().run(`INSERT INTO settings (namespace, key, value, updated_at) VALUES ('print', 'settings', ?, '2026-01-01')`, [legacy]);
    expect(loadPrintSettings().margin).toBe('wide');
    // A save must heal the row: after round-trip the row is single-encoded.
    savePrintSettings({ ...DEFAULT_PRINT_SETTINGS, margin: 'narrow' });
    expect(loadPrintSettings().margin).toBe('narrow');
  });

  it('drops unknown keys from stored rows', () => {
    getDatabase().run(`INSERT INTO settings (namespace, key, value, updated_at) VALUES ('print', 'settings', ?, '2026-01-01')`, [
      JSON.stringify({ ...DEFAULT_PRINT_SETTINGS, paper: 'letter', zombieKey: true }),
    ]);
    const loaded = loadPrintSettings() as unknown as Record<string, unknown>;
    expect(loaded.paper).toBe('letter');
    expect('zombieKey' in loaded).toBe(false);
  });

  it('corrupt JSON falls back to defaults without throwing', () => {
    getDatabase().run(`INSERT INTO settings (namespace, key, value, updated_at) VALUES ('print', 'settings', '{not-json', '2026-01-01')`, []);
    expect(loadPrintSettings()).toEqual(DEFAULT_PRINT_SETTINGS);
  });

  it('document sections round-trip and keep fallback ordering', () => {
    const fallback = ['header', 'items', 'totals', 'footer'];
    saveDocumentSections('invoice', ['totals', 'header']);
    expect(loadDocumentSections('invoice', fallback)).toEqual(['header', 'totals']);
  });

  it('document sections tolerate a legacy double-encoded row', () => {
    getDatabase().run(`INSERT INTO settings (namespace, key, value, updated_at) VALUES ('print', 'sections_invoice', ?, '2026-01-01')`, [
      JSON.stringify(JSON.stringify(['items'])),
    ]);
    expect(loadDocumentSections('invoice', ['header', 'items'])).toEqual(['items']);
  });
});

/**
 * The statement's `bank` section was added after operators were already saving
 * section lists, so a stored list without it is ambiguous: saved-before-it-
 * existed (adopt) or deliberately unticked (never resurrect). The marker row
 * is the tiebreaker; these tests pin both directions of the reload story.
 *
 * Fixtures mirror the one real caller (PrintInvoicesView): the fallback is
 * DEFAULT_ENABLED.statement — the full section catalog, bank included — and a
 * legacy stored list is the same catalog with `bank` missing, because
 * `loadDocumentSections` filters stored ids through the fallback it is given.
 */
describe('statement bank option (adopt / deliberate exclusion)', () => {
  /* The catalog as it recurs on Settings → Print and the print screens. */
  const FALLBACK = ['brand', 'docTitle', 'statementFor', 'period', 'invoiceTable', 'balanceSummary', 'bank', 'footer'];
  /* What lists saved before the bank option existed look like: same catalog, no bank. */
  const LEGACY = FALLBACK.filter((s) => s !== 'bank');

  const readMarker = (): string | null => {
    const row = getDatabase().get<{ value: string }>(
      'SELECT value FROM settings WHERE namespace = ? AND key = ?',
      ['print', 'sections_statement_bank'],
    );
    if (!row) return null;
    try { return String(JSON.parse(row.value)); } catch { return String(row.value); }
  };

  it('adopts the bank section onto stored lists that predate it, persisting the adoption', () => {
    saveDocumentSections('statement', [...LEGACY]);
    const adopted = loadStatementSectionsAdoptingBank(FALLBACK, true);
    // `bank` joins the list (appended; the stored order is normalized to the
    // catalog order on every read, checked below), once and only once.
    expect(adopted).toHaveLength(FALLBACK.length);
    expect([...adopted].sort()).toEqual([...FALLBACK].sort());
    expect(adopted.filter((s) => s === 'bank')).toHaveLength(1);
    // Persisted: a plain load sees it too, in catalog order (Settings and the
    // preview agree).
    expect(loadDocumentSections('statement', FALLBACK)).toEqual(FALLBACK);
    // The loader stamps the list itself; the deliberate-exclusion marker is
    // only written at UI transitions (bank added over a bank-less list), not
    // on every adopt.
    expect(readMarker()).toBeNull();
  });

  it('does not adopt when the branding record has no bank data to print', () => {
    saveDocumentSections('statement', [...LEGACY]);
    expect(loadStatementSectionsAdoptingBank(FALLBACK, false)).toEqual(LEGACY);
    expect(loadDocumentSections('statement', FALLBACK)).toEqual(LEGACY);
    expect(readMarker()).toBeNull();
  });

  it('never re-adopts a bank the operator excluded deliberately', () => {
    saveDocumentSections('statement', [...LEGACY]);
    setStatementBankExcluded(true);
    expect(isStatementBankExcluded()).toBe(true);
    expect(readMarker()).toBe('off');
    expect(loadStatementSectionsAdoptingBank(FALLBACK, true)).toEqual(LEGACY);
    // And nothing was written back behind the operator's back.
    expect(loadDocumentSections('statement', FALLBACK)).toEqual(LEGACY);
  });

  it('clears the exclusion when the bank is added back', () => {
    setStatementBankExcluded(true);
    setStatementBankExcluded(false);
    expect(isStatementBankExcluded()).toBe(false);
    expect(readMarker()).toBe('on');
    saveDocumentSections('statement', [...LEGACY]);
    const adopted = loadStatementSectionsAdoptingBank(FALLBACK, true);
    expect(adopted).toHaveLength(FALLBACK.length);
    expect([...adopted].sort()).toEqual([...FALLBACK].sort());
  });

  it('leaves a list that already carries bank exactly as stored', () => {
    saveDocumentSections('statement', [...FALLBACK]);
    expect(loadStatementSectionsAdoptingBank(FALLBACK, true)).toEqual(FALLBACK);
    expect(readMarker()).toBeNull();
  });
});

/**
 * The invoice account summary joined the invoice catalog after lists were
 * already saved. Before that it printed as part of `totals`, so an upgrade
 * must keep it on exactly the lists that had `totals`, while an operator who
 * unticked it afterwards must not see it resurrected on the next invoice.
 */
describe('invoice account summary adoption', () => {
  const FALLBACK = [
    'brand', 'docTitle', 'billTo', 'invoiceMeta', 'lineItems',
    'totals', 'balanceSummary', 'paymentHistory', 'bank', 'terms', 'signature', 'footer',
  ];
  const LEGACY_WITH_TOTALS = FALLBACK.filter((s) => s !== 'balanceSummary');

  it('adds the summary to a saved list that used to print the block', () => {
    saveDocumentSections('invoice', [...LEGACY_WITH_TOTALS]);
    const adopted = loadInvoiceSectionsAdoptingSummary(FALLBACK);

    expect(adopted).toContain('balanceSummary');
    expect([...adopted].sort()).toEqual([...FALLBACK].sort());
    // Persisted, so Settings → Print and every invoice dialog agree.
    expect(loadDocumentSections('invoice', FALLBACK)).toEqual(FALLBACK);
    expect(isInvoiceSummaryExcluded()).toBe(false);
  });

  it('does not add it to a list that never printed totals', () => {
    const noTotals = LEGACY_WITH_TOTALS.filter((s) => s !== 'totals');
    saveDocumentSections('invoice', noTotals);
    expect(loadInvoiceSectionsAdoptingSummary(FALLBACK)).toEqual(noTotals);
  });

  it('never resurrects a summary the operator switched off', () => {
    saveDocumentSections('invoice', [...LEGACY_WITH_TOTALS]);
    setInvoiceSummaryExcluded(true);

    expect(loadInvoiceSectionsAdoptingSummary(FALLBACK)).toEqual(LEGACY_WITH_TOTALS);
    expect(isInvoiceSummaryExcluded()).toBe(true);
  });

  it('adopts again after the operator switches it back on', () => {
    saveDocumentSections('invoice', [...LEGACY_WITH_TOTALS]);
    setInvoiceSummaryExcluded(true);
    setInvoiceSummaryExcluded(false);

    expect(isInvoiceSummaryExcluded()).toBe(false);
    expect(loadInvoiceSectionsAdoptingSummary(FALLBACK)).toEqual(FALLBACK);
  });
});
