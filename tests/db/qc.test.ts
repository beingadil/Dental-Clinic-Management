import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { labsRepo, casesRepo, qcInspectionsRepo } from '../../src/db/repos';
import { MIGRATIONS } from '../../src/db/migrations';
import { qcDedupeKey } from '../../src/services/qcDomain';
import { QcInspection, QcResult } from '../../src/types';

let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
});

let seq = 0;
function qcRow(overrides: Partial<QcInspection> & { case_id: string; result: QcResult }): QcInspection {
  seq += 1;
  const inspectionNo = overrides.inspection_no ?? 1;
  return {
    id: `qc-test-${seq}`,
    case_number: 'DS-QC-1',
    inspection_no: inspectionNo,
    kind: 'inspection',
    reason_code: overrides.result === 'fail' ? 'occlusion' : null,
    reason_text: null,
    checklist: null,
    inspector: 'Vitest',
    notes: null,
    supersedes_id: null,
    dedupe_key: qcDedupeKey(overrides.case_id, inspectionNo, overrides.result, 'inspection'),
    created_at: '2026-09-22 10:00',
    ...overrides,
  };
}

function seedCase(id: string, caseNumber: string): void {
  if (!labsRepo.byId('lab-qc')) labsRepo.insert({ id: 'lab-qc', name: 'QC Test Clinic' });
  if (!casesRepo.byId(id)) {
    casesRepo.insert({
      id,
      case_number: caseNumber,
      lab_id: 'lab-qc',
      lab_name: 'QC Test Clinic',
      doctor_name: 'Dr. Test',
      patient_name: 'QC Patient',
      selected_teeth: [11],
      delivery_date: '2026-10-01',
      price: 10000,
      discount: 0,
      final_price: 10000,
      status: 'qc',
    });
  }
}

describe('QC persistence — schema', () => {
  it('ships migrations through 010 and records the current schema_version', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(MIGRATIONS[7].name).toBe('purge_demo_users');
    const row = engine.get<{ value: string }>("SELECT value FROM app_meta WHERE key = 'schema_version'");
    expect(row?.value).toBe('10');
  });

  it('re-running migrations is idempotent and preserves QC rows', () => {
    seedCase('case-qc-idem', 'DS-QC-IDEM');
    qcInspectionsRepo.insert(qcRow({ case_id: 'case-qc-idem', result: 'pass' }));
    const before = qcInspectionsRepo.count();

    engine.migrate();

    expect(qcInspectionsRepo.count()).toBe(before);
    expect(qcInspectionsRepo.forCase('case-qc-idem')).toHaveLength(1);
  });
});

describe('qcInspectionsRepo — append-only stream', () => {
  it('inserts and reads back an inspection for a case', () => {
    seedCase('case-qc-1', 'DS-QC-1');
    const row = qcRow({ case_id: 'case-qc-1', result: 'pass', inspector: 'Hina' });
    qcInspectionsRepo.insert(row);

    const stored = qcInspectionsRepo.byId(row.id);
    expect(stored?.result).toBe('pass');
    expect(stored?.inspector).toBe('Hina');
    expect(qcInspectionsRepo.forCase('case-qc-1')).toHaveLength(1);
  });

  it('exposes no update or delete method (corrections are appended)', () => {
    expect((qcInspectionsRepo as any).update).toBeUndefined();
    expect((qcInspectionsRepo as any).delete).toBeUndefined();
  });

  it('refuses a duplicate dedupe_key — the idempotency guard', () => {
    seedCase('case-qc-2', 'DS-QC-2');
    const row = qcRow({ case_id: 'case-qc-2', result: 'fail' });
    qcInspectionsRepo.insert(row);

    const duplicate = { ...row, id: 'qc-dup-attempt' };
    expect(() => qcInspectionsRepo.insert(duplicate)).toThrow();
    expect(qcInspectionsRepo.forCase('case-qc-2')).toHaveLength(1);
  });

  it('rejects an invalid result via the CHECK constraint', () => {
    seedCase('case-qc-3', 'DS-QC-3');
    const bad = qcRow({ case_id: 'case-qc-3', result: 'pass' });
    bad.result = 'maybe' as QcResult;
    expect(() => qcInspectionsRepo.insert(bad)).toThrow();
  });

  it('counts failures for the KPI surface', () => {
    seedCase('case-qc-4', 'DS-QC-4');
    qcInspectionsRepo.insert(qcRow({ case_id: 'case-qc-4', result: 'fail', inspection_no: 1 }));
    qcInspectionsRepo.insert(qcRow({ case_id: 'case-qc-4', result: 'pass', inspection_no: 2, reason_code: null }));
    expect(qcInspectionsRepo.forCase('case-qc-4')).toHaveLength(2);
    expect(qcInspectionsRepo.countFailures()).toBeGreaterThanOrEqual(1);
  });

  it('cascades the QC history away with the case it belongs to', () => {
    seedCase('case-qc-5', 'DS-QC-5');
    qcInspectionsRepo.insert(qcRow({ case_id: 'case-qc-5', result: 'pass' }));
    expect(qcInspectionsRepo.forCase('case-qc-5')).toHaveLength(1);

    casesRepo.delete('case-qc-5');

    expect(qcInspectionsRepo.forCase('case-qc-5')).toHaveLength(0);
  });
});
