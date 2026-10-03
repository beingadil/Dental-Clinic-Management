import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { MIGRATIONS } from '../../src/db/migrations';

let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
});

function seedInvoice(id: string, invoiceNumber: string, finalAmount: number, created: string): void {
  engine.run(
    `INSERT INTO labs (id, name, created_at) VALUES ('lab-m012', 'Migration 012 Clinic', '2026-01-01')
     ON CONFLICT(id) DO NOTHING`,
  );
  engine.run(
    `INSERT INTO invoices (id, invoice_number, case_id, case_number, lab_id, lab_name, case_type_id, case_type_name, doctor_name, patient_name,
                           amount, discount, final_amount, amount_paid, payment_status, status_v2, issue_date, due_date, journal_id, credit_notes_total, created_at, updated_at)
     VALUES (?, ?, NULL, NULL, 'lab-m012', 'Migration 012 Clinic', NULL, NULL, NULL, NULL,
             ?, 0, ?, 0, 'unpaid', 'open', NULL, NULL, NULL, 0, ?, ?)`,
    [id, invoiceNumber, finalAmount, finalAmount, created, created],
  );
}

function seedIssuedJournal(referenceId: string): void {
  engine.run(
    `INSERT INTO journal_entries (id, journal_number, date, event_type, reference_type, reference_id, reference_number, lab_id, lab_name, description, created_at, created_by)
     VALUES ('jrn-pre-' || ?, 'JRN-INV-PRE', '2026-01-01', 'invoice_issued', 'invoice', ?, 'INV-PRE', 'lab-m012', 'Migration 012 Clinic', 'pre-existing', '2026-01-01', 'test')`,
    [referenceId, referenceId],
  );
}

/** Rewind the ledger so migration 012 re-applies over freshly seeded rows
 *  (on a fresh engine it already ran before the tests seed anything). */
function rewindToSchema11(): void {
  engine.run('DELETE FROM schema_migrations WHERE version = 12');
  engine.run("DELETE FROM app_meta WHERE key = 'schema_version'");
  engine.run("INSERT INTO app_meta (key, value) VALUES ('schema_version', '11')");
}

describe('migration 012 — invoice journal backfill', () => {
  it('creates one balanced journal per invoice with none', () => {
    seedInvoice('inv-m012-a', 'INV-A', 1234.56, '2026-06-01');
    seedIssuedJournal('inv-m012-a'); // already journaled → skipped
    seedInvoice('inv-m012-b', 'INV-B', 500, '2026-06-02');

    rewindToSchema11();
    engine.migrate(); // 012 applies now

    const je = engine.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM journal_entries WHERE reference_id = 'inv-m012-b' AND event_type = 'invoice_issued'`,
    );
    expect(je?.n).toBe(1);

    const lines = engine.all<{ debit: number; credit: number }>(
      'SELECT debit, credit FROM journal_lines WHERE journal_id = ?',
      ['jrn-invbf-inv-m012-b'],
    );
    expect(lines).toHaveLength(2);
    const debits = lines.reduce((s, l) => s + l.debit, 0);
    const credits = lines.reduce((s, l) => s + l.credit, 0);
    expect(debits).toBeCloseTo(500, 2);
    expect(credits).toBeCloseTo(500, 2);
  });

  it('does not touch pre-existing journals or unjournaled invoices in the same run', () => {
    const pre = engine.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM journal_entries WHERE reference_id = 'inv-m012-a' AND event_type = 'invoice_issued' AND created_by = 'test'`,
    );
    expect(pre?.n).toBe(1); // backfill skipped it
  });

  it('is idempotent on re-run', () => {
    const before = engine.get<{ n: number }>("SELECT COUNT(*) AS n FROM journal_entries WHERE created_by = 'Migration 012'")?.n;
    engine.migrate();
    const after = engine.get<{ n: number }>("SELECT COUNT(*) AS n FROM journal_entries WHERE created_by = 'Migration 012'")?.n;
    expect(after).toBe(before);
  });

  it('balances the whole live ledger after backfill', () => {
    const sums = engine.get<{ d: number; c: number }>(
      'SELECT SUM(debit) AS d, SUM(credit) AS c FROM journal_lines',
    );
    expect(sums?.d).toBeCloseTo(sums?.c ?? 0, 2);
    const orphan = engine.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM invoices i WHERE NOT EXISTS (
         SELECT 1 FROM journal_entries je WHERE je.event_type = 'invoice_issued' AND je.reference_id = i.id)`,
    );
    expect(orphan?.n).toBe(0);
  });

  it('keeps the migration ledger intact through 015', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });
});
