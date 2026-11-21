import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { MIGRATIONS, MIGRATION_031_CLEAR_ALIGNERS } from '../../src/db/migrations';

/**
 * Migration 031 — Clear Aligners (per stage).
 *
 * The lab enters an aligner case AFTER the series is produced: record
 * delivery, not manufacturing. The migration adds two nullable stage-count
 * columns to cases and seeds the catalog row, billed per tray stage with
 * no tooth charting.
 */
describe('migration 031 — clear aligners', () => {
  let engine: SqliteEngine;

  beforeAll(async () => {
    const SQL = await initSqlJs();
    engine = await SqliteEngine.create(SQL, null);
    engine.migrate(MIGRATIONS.slice(0, 30)); // the world before 031
    // An upgraded install — any catalog content is enough; migration then
    // appends the aligner product without clobbering what the clinic has.
    engine.run(
      `INSERT INTO case_types (id, name, base_price, category, needs_teeth, created_at)
       VALUES ('ct-existing', 'Zirconia Crown', 15000, 'crown_bridge', 1, '2026-01-01')`
    );
    const { applied } = engine.migrate([MIGRATION_031_CLEAR_ALIGNERS]);
    expect(applied).toContain(31);
  });

  it('cases gained the two nullable aligner columns (NULL on existing rows)', () => {
    const cols = engine.all<{ name: string }>(`PRAGMA table_info(cases)`).map((r) => r.name);
    expect(cols).toContain('aligner_upper_count');
    expect(cols).toContain('aligner_lower_count');
  });

  it('existing rows carry NULL for both arch counts (not zero — unknown, not empty)', () => {
    engine.run(
      `INSERT INTO labs (id, name, created_at) VALUES ('lab-031', 'Align Clinic', '2026-01-01')`
    );
    engine.run(
      `INSERT INTO cases (id, case_number, patient_name, lab_id, lab_name, doctor_name, selected_teeth, delivery_date, priority, price, discount, final_price, status, created_at, updated_at)
       VALUES ('case-031', 'DS-031', 'Ali', 'lab-031', 'Align Clinic', 'Dr. S', '[]', '2030-01-01', 'normal', 500, 0, 500, 'received', '2026-01-05', '2026-01-05')`
    );
    const row = engine.get<any>(`SELECT aligner_upper_count, aligner_lower_count FROM cases WHERE id = 'case-031'`);
    expect(row.aligner_upper_count).toBeNull();
    expect(row.aligner_lower_count).toBeNull();
  });

  it('ct-aligners ships into a stocked catalog (upgrade path)', () => {
    const ct = engine.get<any>(
      `SELECT base_price, category, needs_teeth FROM case_types WHERE id = 'ct-aligners'`
    );
    expect(ct.base_price).toBe(500);
    expect(ct.category).toBe('orthodontic');
    expect(ct.needs_teeth).toBe(0);
    // The clinic's own row is untouched.
    const existing = engine.get<any>(`SELECT base_price FROM case_types WHERE id = 'ct-existing'`);
    expect(existing.base_price).toBe(15000);
  });

  it('a fresh database skips the catalog insert — seedDatabase owns it', async () => {
    const SQL = await initSqlJs();
    const fresh = await SqliteEngine.create(SQL, null);
    fresh.migrate(MIGRATIONS); // full fresh install
    const seeded = fresh.get<any>(`SELECT base_price FROM case_types WHERE id = 'ct-aligners'`);
    // Fresh installs get the row without the migration having to force it —
    // seeds are what delivers the shipped catalog.
    expect(seeded).toBeUndefined();
    const count = fresh.scalar(`SELECT COUNT(*) FROM case_types`);
    expect(count).toBe(0);
  });

  it('reseeding over an existing user catalog row never overwrites it', () => {
    // The operator edited the rate — migration must not clobber it.
    engine.run(`UPDATE case_types SET base_price = 750 WHERE id = 'ct-aligners'`);
    const rerun = engine.migrate([MIGRATION_031_CLEAR_ALIGNERS]);
    expect(rerun.applied).not.toContain(31);
    const ct = engine.get<any>(`SELECT base_price FROM case_types WHERE id = 'ct-aligners'`);
    expect(ct.base_price).toBe(750);
  });
});
