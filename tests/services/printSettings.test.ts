import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase, getDatabase } from '../../src/db/core';
import {
  loadPrintSettings,
  savePrintSettings,
  loadDocumentSections,
  saveDocumentSections,
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
