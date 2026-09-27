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
  it('sql.js export() resets the connection-level FK flag (documents the hazard)', () => {
    expect(engine.get('PRAGMA foreign_keys')?.foreign_keys).toBe(1);
    engine.export();
    expect(engine.get('PRAGMA foreign_keys')?.foreign_keys).toBe(0);
  });

  it('saveSnapshot re-asserts foreign_keys = ON after exporting', async () => {
    engine.export(); // simulate any prior export leaving the flag off
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
