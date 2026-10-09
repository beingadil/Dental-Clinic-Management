import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { MIGRATIONS } from '../../src/db/migrations';
import { formatDoctorName } from '../../src/utils/doctorName';

/** A database at the pre-020 shape: v19 schema, prefixed doctor names. */
async function buildV19Engine(): Promise<SqliteEngine> {
  const SQL = await initSqlJs();
  const eng = await SqliteEngine.create(SQL, null);
  eng.migrate(MIGRATIONS.slice(0, 19)); // exactly the pre-020 world
  return eng;
}

const STAMP = '2026-01-05';

/**
 * Legacy rows in ALL SIX tables that carry a doctor_name, each written in the
 * form the old placeholder invited.
 */
function seedLegacyNames(engine: SqliteEngine): void {
  engine.run(`INSERT INTO labs (id, name, doctor_name, created_at) VALUES ('lab-a', 'Clinic A', 'Dr. Tariq Mahmood', '${STAMP}')`);
  engine.run(`INSERT INTO cases (id, case_number, lab_id, lab_name, doctor_name, selected_teeth, delivery_date, created_at, updated_at)
              VALUES ('case-a', 'DS-A', 'lab-a', 'Clinic A', 'Dr. Tariq Mahmood', '[]', '2026-03-01', '${STAMP}', '${STAMP}')`);
  engine.run(`INSERT INTO invoices (id, invoice_number, lab_id, lab_name, doctor_name, amount, discount, final_amount, amount_paid, payment_status, status_v2, created_at)
              VALUES ('inv-a', 'INV-A', 'lab-a', 'Clinic A', 'Dr. Tariq Mahmood', 1000, 0, 1000, 0, 'unpaid', 'open', '${STAMP}')`);
  engine.run(`INSERT INTO ledger_entries (id, date, entry_type, reference_id, description, doctor_name, debit, credit, created_at)
              VALUES ('le-a', '2026-02-01', 'invoice', 'inv-a', 'Legacy line', 'Dr. Tariq Mahmood', 0, 0, '${STAMP}')`);
  engine.run(`INSERT INTO saved_vouchers (id, voucher_number, voucher_type, case_id, doctor_name, saved_by, created_at)
              VALUES ('sv-a', 'VCH-A', 'job_slip', 'case-a', 'Dr. Tariq Mahmood', 'tester', '${STAMP}')`);
  engine.run(`INSERT INTO doctor_preferred_labs (id, doctor_name, lab_id, lab_name, created_at)
              VALUES ('dpl-a', 'Dr. Tariq Mahmood', 'lab-a', 'Clinic A', '${STAMP}')`);
}

const nameIn = (engine: SqliteEngine, table: string) =>
  engine.get<{ doctor_name: string }>(`SELECT doctor_name FROM ${table} WHERE rowid = 1`)?.doctor_name;

describe('migration 020 — stored doctor names become bare', () => {
  let engine: SqliteEngine;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    engine = await SqliteEngine.create(SQL, null);
    engine.migrate();
    setDatabase(engine);
  });

  it('stamps schema_version 20', () => {
    expect(MIGRATIONS.map((m) => m.version)).toContain(20);
    const row = engine.get<{ value: string }>("SELECT value FROM app_meta WHERE key = 'schema_version'");
    expect(row?.value).toBe('20');
  });

  it('rewrites legacy rows in every table that stores a doctor name', async () => {
    const v19 = await buildV19Engine();
    seedLegacyNames(v19);

    v19.migrate();

    // All six, not just `cases`: each renders independently, so fixing only one
    // would leave an invoice or a ledger line printing "Dr. Dr." forever.
    for (const table of ['labs', 'cases', 'invoices', 'ledger_entries', 'saved_vouchers', 'doctor_preferred_labs']) {
      expect(nameIn(v19, table), `${table}.doctor_name`).toBe('Tariq Mahmood');
    }
  });

  it('strips both the dotted and undotted spellings', async () => {
    const v19 = await buildV19Engine();
    v19.run(`INSERT INTO labs (id, name, doctor_name, created_at) VALUES ('l1', 'L1', 'Dr Ahmad', '${STAMP}')`);
    v19.run(`INSERT INTO labs (id, name, doctor_name, created_at) VALUES ('l2', 'L2', 'DR. SANA', '${STAMP}')`);

    v19.migrate();

    expect(v19.all<{ doctor_name: string }>('SELECT doctor_name FROM labs ORDER BY id').map((r) => r.doctor_name)).toEqual([
      'Ahmad',
      'SANA',
    ]);
  });

  it('strips a stacked honorific, so re-saving cannot resurrect the defect', async () => {
    const v19 = await buildV19Engine();
    v19.run(`INSERT INTO labs (id, name, doctor_name, created_at) VALUES ('l1', 'L1', 'Dr. Dr. Double', '${STAMP}')`);

    v19.migrate();

    expect(nameIn(v19, 'labs')).toBe('Double');
  });

  it('leaves names that merely start with those letters alone', async () => {
    const v19 = await buildV19Engine();
    // "Drake" begins with "dr"; a prefix match without the separator would
    // silently corrupt a real person's name.
    v19.run(`INSERT INTO labs (id, name, doctor_name, created_at) VALUES ('l1', 'L1', 'Drake Ahmad', '${STAMP}')`);
    v19.run(`INSERT INTO labs (id, name, doctor_name, created_at) VALUES ('l2', 'L2', 'Professor X', '${STAMP}')`);

    v19.migrate();

    expect(v19.all<{ doctor_name: string }>('SELECT doctor_name FROM labs ORDER BY id').map((r) => r.doctor_name)).toEqual([
      'Drake Ahmad',
      'Professor X',
    ]);
  });

  it('preserves an academic title instead of relabelling a Prof as a Dr', async () => {
    const v19 = await buildV19Engine();
    v19.run(`INSERT INTO labs (id, name, doctor_name, created_at) VALUES ('l1', 'L1', 'Prof. Ahmed Khan', '${STAMP}')`);

    v19.migrate();

    expect(nameIn(v19, 'labs')).toBe('Prof. Ahmed Khan');
  });

  it('preserves a NULL and does not blank an honorific-only value', async () => {
    const v19 = await buildV19Engine();
    v19.run(`INSERT INTO labs (id, name, doctor_name, created_at) VALUES ('l1', 'L1', NULL, '${STAMP}')`);
    v19.run(`INSERT INTO labs (id, name, doctor_name, created_at) VALUES ('l2', 'L2', 'Dr.', '${STAMP}')`);

    v19.migrate();

    const rows = v19.all<{ doctor_name: string | null }>('SELECT doctor_name FROM labs ORDER BY id');
    // A NULL stays NULL, and an honorific with no name behind it keeps its
    // original text: both are unusable already, and erasing them destroys
    // evidence the read path renders as "—" either way.
    expect(rows[0].doctor_name).toBeNull();
    expect(rows[1].doctor_name).toBe('Dr.');
  });

  it('leaves a bare name untouched, so the upgrade is safe to run', async () => {
    const v19 = await buildV19Engine();
    v19.run(`INSERT INTO labs (id, name, doctor_name, created_at) VALUES ('l1', 'L1', 'Tariq Mahmood', '${STAMP}')`);

    v19.migrate();

    expect(nameIn(v19, 'labs')).toBe('Tariq Mahmood');
  });

  it('yields a display form with exactly one honorific', async () => {
    const v19 = await buildV19Engine();
    seedLegacyNames(v19);
    v19.migrate();

    // The end-to-end point of the migration: what the slip will now print.
    expect(formatDoctorName(nameIn(v19, 'cases'))).toBe('Dr. Tariq Mahmood');
  });
});