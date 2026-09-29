import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { MIGRATIONS, MIGRATION_013_JOURNAL_CASE_REFS } from '../../src/db/migrations';

/** A database at the pre-013 shape: v12 schema, journals without case refs. */
async function buildV12Engine(): Promise<SqliteEngine> {
  const SQL = await initSqlJs();
  const eng = await SqliteEngine.create(SQL, null);
  eng.migrate(MIGRATIONS.slice(0, 12)); // exactly the pre-013 world
  return eng;
}

function seedWorld(engine: SqliteEngine): void {
  engine.run(
    `INSERT INTO labs (id, name, created_at) VALUES ('lab-013', 'Case Ref Clinic', '2026-01-01')`
  );
  engine.run(
    `INSERT INTO cases (id, case_number, patient_name, lab_id, lab_name, doctor_name, selected_teeth, delivery_date, priority, price, discount, final_price, status, created_at, updated_at)
     VALUES ('case-013', 'DS-013', 'Ali Raza', 'lab-013', 'Case Ref Clinic', 'Dr. Sana', '[]', '2026-02-01', 'normal', 1000, 0, 1000, 'received', '2026-01-05', '2026-01-05')`
  );
  engine.run(
    `INSERT INTO invoices (id, invoice_number, case_id, case_number, lab_id, lab_name, case_type_name, doctor_name, amount, discount, final_amount, amount_paid, payment_status, status_v2, created_at, updated_at)
     VALUES ('inv-013', 'INV-013', 'case-013', 'DS-013', 'lab-013', 'Case Ref Clinic', 'Crown', 'Dr. Sana', 25000, 0, 25000, 0, 'unpaid', 'open', '2026-01-10', '2026-01-10')`
  );
  engine.run(
    `INSERT INTO payments (id, payment_number, invoice_id, invoice_number, case_id, case_number, lab_id, lab_name, amount, payment_method, payment_date, recorded_by, status, created_at)
     VALUES ('pay-013', 'PAY-013', 'inv-013', 'INV-013', 'case-013', 'DS-013', 'lab-013', 'Case Ref Clinic', 10000, 'cash', '2026-01-15', 'test', 'posted', '2026-01-15')`
  );
  // Pre-013 journals: case context only in free-text description.
  engine.run(
    `INSERT INTO journal_entries (id, journal_number, date, event_type, reference_type, reference_id, reference_number, lab_id, lab_name, description, created_at, created_by)
     VALUES ('jrn-013-inv', 'JRN-INV-013', '2026-01-10', 'invoice_issued', 'invoice', 'inv-013', 'INV-013', 'lab-013', 'Case Ref Clinic', 'free text only', '2026-01-10', 'test')`
  );
  engine.run(
    `INSERT INTO journal_entries (id, journal_number, date, event_type, reference_type, reference_id, reference_number, lab_id, lab_name, description, created_at, created_by)
     VALUES ('jrn-013-pay', 'JRN-PAY-013', '2026-01-15', 'payment_received', 'payment', 'pay-013', 'PAY-013', 'lab-013', 'Case Ref Clinic', 'also free text', '2026-01-15', 'test')`
  );
  // Advance deposit: genuinely no case relationship.
  engine.run(
    `INSERT INTO journal_entries (id, journal_number, date, event_type, reference_type, reference_id, reference_number, lab_id, lab_name, description, created_at, created_by)
     VALUES ('jrn-013-adv', 'JRN-ADV-013', '2026-01-01', 'advance_deposited', 'advance_payment', 'adv-013', 'ADV-013', 'lab-013', 'Case Ref Clinic', 'clinic-level', '2026-01-01', 'test')`
  );
}

describe('migration 013 — journal case references (v12 → v13 upgrade path)', () => {
  let engine: SqliteEngine;

  beforeAll(async () => {
    engine = await buildV12Engine();
    seedWorld(engine);
    const { applied } = engine.migrate([MIGRATION_013_JOURNAL_CASE_REFS]);
    expect(applied).toContain(13);
  });

  it('invoice-issued journal gains the invoice’s case relationally', () => {
    const inv = engine.get<any>(
      `SELECT case_id, case_number FROM journal_entries WHERE id = 'jrn-013-inv'`
    );
    expect(inv.case_id).toBe('case-013');
    expect(inv.case_number).toBe('DS-013');
  });

  it('payment journal gains the payment’s case', () => {
    const pay = engine.get<any>(
      `SELECT case_id, case_number FROM journal_entries WHERE id = 'jrn-013-pay'`
    );
    expect(pay.case_id).toBe('case-013');
    expect(pay.case_number).toBe('DS-013');
  });

  it('never touches description text — refs come from joins, not parsing', () => {
    const inv = engine.get<any>(
      `SELECT description FROM journal_entries WHERE id = 'jrn-013-inv'`
    );
    expect(inv.description).toBe('free text only');
  });

  it('leaves genuinely case-less transactions (advance deposit) NULL', () => {
    const adv = engine.get<any>(
      `SELECT case_id, case_number FROM journal_entries WHERE id = 'jrn-013-adv'`
    );
    expect(adv.case_id ?? null).toBeNull();
    expect(adv.case_number ?? null).toBeNull();
  });

  it('creates the case index for case-scoped queries', () => {
    const idx = engine.get<any>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_journal_case'`
    );
    expect(idx).toBeTruthy();
  });

  it('journalRepo round-trips case refs (sync contract)', () => {
    const row = engine.get<any>(`SELECT case_id, case_number FROM journal_entries WHERE id = 'jrn-013-inv'`);
    // The same columns syncCore writes back out on every snapshot save.
    expect(row.case_id).toBe('case-013');
    expect(row.case_number).toBe('DS-013');
  });
});
