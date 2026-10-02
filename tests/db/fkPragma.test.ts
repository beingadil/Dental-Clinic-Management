import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { saveSnapshot } from '../../src/db/persistence';

let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
});

describe('PRAGMA foreign_keys survives snapshot saves', () => {
  it('SqliteEngine.export() re-asserts the FK flag sql.js resets', () => {
    // sql.js implements export() by closing and reopening the connection,
    // which drops every connection-level PRAGMA — foreign_keys included, and
    // SQLite's default is OFF. This test used to ASSERT that reset (0) as a
    // documented hazard; left unchecked it silently switched off every
    // ON DELETE CASCADE in the schema after any backup or autosave, which is
    // what orphaned journal_lines and then aborted the whole-table sync with
    // `UNIQUE constraint failed: journal_lines.id`.
    //
    // The hazard is now contained inside SqliteEngine.export() itself, so the
    // contract is the opposite: the flag must survive.
    expect(engine.get('PRAGMA foreign_keys')?.foreign_keys).toBe(1);
    engine.export();
    expect(engine.get('PRAGMA foreign_keys')?.foreign_keys).toBe(1);
  });

  it('saveSnapshot leaves foreign_keys = ON', async () => {
    await saveSnapshot(engine);
    expect(engine.get('PRAGMA foreign_keys')?.foreign_keys).toBe(1);
  });

  it('cascade deletes actually work after a snapshot save (end-to-end)', async () => {
    await saveSnapshot(engine); // flag now guaranteed ON
    engine.run(`INSERT INTO labs (id, name, created_at) VALUES ('lab-fk', 'FK Probe Clinic', '2026-01-01')`);
    engine.run(
      `INSERT INTO cases (id, case_number, patient_name, lab_id, lab_name, case_type_id, case_type_name, units_count, doctor_name, selected_teeth, tooth_details, shade, material, delivery_date, priority, price, discount, final_price, instructions, photo_url, status, archived_at, created_at, updated_at)
       VALUES ('case-fk', 'DS-FKPROBE', 'FK Patient', 'lab-fk', 'FK Probe Clinic', NULL, NULL, 1, 'Dr. FK', '[]', NULL, NULL, NULL, '2026-10-01', 'normal', 100, 0, 100, NULL, NULL, 'received', NULL, '2026-09-27', '2026-09-27')`,
    );
    engine.run(`INSERT INTO case_teeth (case_id, tooth_number) VALUES ('case-fk', '16')`);
    expect(engine.get(`SELECT COUNT(*) AS n FROM case_teeth WHERE case_id = 'case-fk'`)?.n).toBe(1);

    engine.run(`DELETE FROM cases WHERE id = 'case-fk'`);
    expect(engine.get(`SELECT COUNT(*) AS n FROM case_teeth WHERE case_id = 'case-fk'`)?.n).toBe(0);
    engine.run(`DELETE FROM labs WHERE id = 'lab-fk'`);
  });
});
