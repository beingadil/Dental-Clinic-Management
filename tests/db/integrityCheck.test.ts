import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { runIntegrityCheck } from '../../src/db/integrityCheck';

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

beforeAll(async () => {
  SQL = await initSqlJs();
});

async function freshEngine(): Promise<SqliteEngine> {
  const engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  return engine;
}

const CASE_COLUMNS =
  'id, case_number, patient_name, lab_id, lab_name, case_type_id, case_type_name, units_count, doctor_name, selected_teeth, tooth_details, shade, material, delivery_date, priority, price, discount, final_price, instructions, photo_url, status, archived_at, created_at, updated_at';
const CASE_VALUES = (id: string, num: string) =>
  `('${id}', '${num}', 'P', 'lab-i', 'Probe Lab', NULL, NULL, 1, 'Dr P', '[]', NULL, NULL, NULL, '2026-10-01', 'normal', 100, 0, 100, NULL, NULL, 'received', NULL, '2026-09-27', '2026-09-27')`;
const INVOICE_COLUMNS =
  'id, invoice_number, lab_id, lab_name, amount, discount, final_amount, amount_paid, payment_status, status_v2, issue_date, due_date, journal_id, credit_notes_total, created_at, updated_at';
const INVOICE_VALUES = (id: string, num: string, journalId: string | null) =>
  `('${id}', '${num}', 'lab-i', 'Probe Lab', 100, 0, 100, 0, 'unpaid', 'open', '2026-09-27', '2026-10-01', ${journalId ? `'${journalId}'` : 'NULL'}, 0, '2026-09-27', '2026-09-27')`;
const JOURNAL_ENTRY_SQL = (id: string, num: string) =>
  `INSERT INTO journal_entries (id, journal_number, date, event_type, description, created_at, created_by)
   VALUES ('${id}', '${num}', '2026-09-27', 'invoice_issued', 'test', '2026-09-27', 'test')`;
const JOURNAL_LINE_SQL = (id: string, journalId: string, accountType: string, debit: number, credit: number) =>
  `INSERT INTO journal_lines (id, journal_id, account_code, account_name, account_type, debit, credit, description)
   VALUES ('${id}', '${journalId}', '1000', 'Test', '${accountType}', ${debit}, ${credit}, NULL)`;

describe('runIntegrityCheck', () => {
  it('reports ok on a healthy, migrated database', async () => {
    const engine = await freshEngine();
    engine.run(`INSERT INTO labs (id, name, created_at) VALUES ('lab-i', 'Probe Lab', '2026-01-01')`);
    engine.run(`INSERT INTO cases (${CASE_COLUMNS}) VALUES ${CASE_VALUES('case-i', 'DS-1')}`);
    engine.run(`INSERT INTO invoices (${INVOICE_COLUMNS}) VALUES ${INVOICE_VALUES('inv-i', 'INV-1', 'je-i')}`);
    engine.run(JOURNAL_ENTRY_SQL('je-i', 'JE-1'));
    engine.run(JOURNAL_LINE_SQL('jl-d', 'je-i', 'asset', 100, 0));
    engine.run(JOURNAL_LINE_SQL('jl-c', 'je-i', 'revenue', 0, 100));

    const report = runIntegrityCheck(engine);

    expect(report.ok).toBe(true);
    expect(report.findings.every((f) => f.ok)).toBe(true);
    expect(report.findings.map((f) => f.check)).toContain('Foreign key enforcement');
    expect(report.findings.map((f) => f.check)).toContain('Ledger balance');
    expect(report.findings.map((f) => f.check)).toContain('Invoice journal coverage');
  });

  it('detects a turned-off FK pragma', async () => {
    const engine = await freshEngine();
    engine.run('PRAGMA foreign_keys = OFF');

    const report = runIntegrityCheck(engine);

    expect(report.ok).toBe(false);
    const fk = report.findings.find((f) => f.check === 'Foreign key enforcement');
    expect(fk?.ok).toBe(false);
  });

  it('detects orphaned child rows', async () => {
    const engine = await freshEngine();
    // Orphans only arise when FK enforcement was off (the export() reset hazard).
    engine.run('PRAGMA foreign_keys = OFF');
    engine.run("INSERT INTO case_teeth (case_id, tooth_number) VALUES ('ghost-case', '16')");
    engine.run('PRAGMA foreign_keys = ON');

    const report = runIntegrityCheck(engine);

    expect(report.ok).toBe(false);
    const orphans = report.findings.find((f) => f.check === 'Orphaned child rows');
    expect(orphans?.ok).toBe(false);
    expect(orphans?.detail).toContain('case_teeth');
  });

  it('detects an unbalanced ledger journal', async () => {
    const engine = await freshEngine();
    engine.run(JOURNAL_ENTRY_SQL('je-bad', 'JE-BAD'));
    engine.run(JOURNAL_LINE_SQL('jl-bad', 'je-bad', 'revenue', 0, 500));

    const report = runIntegrityCheck(engine);

    expect(report.ok).toBe(false);
    const ledger = report.findings.find((f) => f.check === 'Ledger balance');
    expect(ledger?.ok).toBe(false);
    expect(ledger?.detail).toContain('1 unbalanced');
  });

  it('detects an invoice without its journal', async () => {
    const engine = await freshEngine();
    engine.run(`INSERT INTO labs (id, name, created_at) VALUES ('lab-i', 'Probe Lab', '2026-01-01')`);
    engine.run(`INSERT INTO invoices (${INVOICE_COLUMNS}) VALUES ${INVOICE_VALUES('inv-j', 'INV-2', null)}`);

    const report = runIntegrityCheck(engine);

    expect(report.ok).toBe(false);
    const coverage = report.findings.find((f) => f.check === 'Invoice journal coverage');
    expect(coverage?.ok).toBe(false);
    expect(coverage?.detail).toContain('1 invoice(s) without journal');
  });
});
