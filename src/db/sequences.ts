import { getDatabase } from './index';
import { SqliteEngine, TransactionApi } from './engine';

/**
 * SQLite-backed document number generators. Formats preserved from the original app:
 *   DS-0001 (cases), INV-0001, PAY-0001, REC-0001 (mirrors payment number), ADV-0001,
 *   CR-0001 / DR-0001 / REF-0001 / WO-0001 (adjustments), JE-0001 (journal), TPL-0001.
 * Sequential via a dedicated counter table; safe inside caller transactions (savepoints).
 */

const TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS doc_sequences (
    seq_key TEXT PRIMARY KEY,
    next_value INTEGER NOT NULL DEFAULT 1
  )
`;

export function ensureSequenceTable(engine?: SqliteEngine): void {
  (engine ?? getDatabase()).run(TABLE_DDL);
}

/** Allocates the next document number for a key (e.g. key='case', prefix='DS'). */
export function nextNumber(engineOrTx: SqliteEngine | TransactionApi, key: string, prefix: string): string {
  const tx = engineOrTx as TransactionApi;
  tx.run(
    `INSERT INTO doc_sequences (seq_key, next_value) VALUES (?, 2) ON CONFLICT(seq_key) DO NOTHING`,
    [key]
  );
  const row = tx.get<{ next_value: number }>(`SELECT next_value FROM doc_sequences WHERE seq_key = ?`, [key]);
  const value = Number(row?.next_value ?? 1);
  tx.run(`UPDATE doc_sequences SET next_value = ? WHERE seq_key = ?`, [value + 1, key]);
  return `${prefix}-${String(value).padStart(4, '0')}`;
}

/** Standalone (auto-transaction) allocation. */
export function nextNumberStandalone(key: string, prefix: string): string {
  const engine = getDatabase();
  ensureSequenceTable(engine);
  return engine.transaction((tx) => nextNumber(tx, key, prefix));
}
/** Peeks without consuming (used for UI preview). */
export function peekNumber(key: string, prefix: string): string {
  const engine = getDatabase();
  ensureSequenceTable(engine);
  const row = engine.get<{ next_value: number }>(`SELECT next_value FROM doc_sequences WHERE seq_key = ?`, [key]);
  return `${prefix}-${String(Number(row?.next_value ?? 1)).padStart(4, '0')}`;
}

/** Re-aligns a counter after legacy import so new numbers never collide. */
export function ensureCounterAtLeast(engineOrTx: SqliteEngine | TransactionApi, key: string, minValue: number): void {
  const tx = engineOrTx as TransactionApi;
  tx.run(
    `INSERT INTO doc_sequences (seq_key, next_value) VALUES (?, ?) ON CONFLICT(seq_key) DO NOTHING`,
    [key, minValue]
  );
  tx.run(
    `UPDATE doc_sequences SET next_value = ? WHERE seq_key = ? AND next_value < ?`,
    [minValue, key, minValue]
  );
}

export const SEQ_KEYS = {
  case: 'case',
  invoice: 'invoice',
  payment: 'payment',
  advance: 'advance',
  adjustmentCreditNote: 'adjustment_cr',
  adjustmentDebit: 'adjustment_dr',
  adjustmentRefund: 'adjustment_ref',
  adjustmentWriteOff: 'adjustment_wo',
  journal: 'journal',
  template: 'template',
} as const;
