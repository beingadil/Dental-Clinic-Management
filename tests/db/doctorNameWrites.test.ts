import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import {
  casesRepo,
  invoicesRepo,
  labsRepo,
  ledgerRepo,
  vouchersRepo,
  doctorPreferredLabsRepo,
} from '../../src/db/repos';
import { formatDoctorName } from '../../src/utils/doctorName';

/**
 * Migration 020 rewrote history. What keeps it from drifting back is the
 * WRITE boundary: every repo insert/update now normalises the name on the way
 * in, so no form, ledger projection or import can reintroduce the prefix that
 * the migration just removed.
 *
 * Migration 020 covers the past; this covers the future. Without it the bare
 * form is a one-time cleanup that the very next prefixed save undoes, and the
 * "Dr. Dr." slip comes straight back.
 */
let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
});

const STAMP = '2026-05-04';

describe('repo write boundary — doctor names normalise on the way in', () => {
  it('stores a case bare even when the caller passed a prefixed name', () => {
    labsRepo.insert({ id: 'lab-w1', name: 'Write Boundary Lab' });
    const created = casesRepo.insert({
      case_number: 'DS-W1',
      lab_id: 'lab-w1',
      lab_name: 'Write Boundary Lab',
      doctor_name: 'Dr. Tariq Mahmood',
      selected_teeth: [11],
      delivery_date: '2026-06-01',
      created_at: STAMP,
    });

    expect(created.doctor_name).toBe('Tariq Mahmood');
    // Read back through the repo, not the in-memory echo of the insert.
    expect(casesRepo.byId(created.id)?.doctor_name).toBe('Tariq Mahmood');
  });

  it('strips on update too, not just insert', () => {
    labsRepo.insert({ id: 'lab-w2', name: 'Update Boundary Lab' });
    const created = casesRepo.insert({
      case_number: 'DS-W2',
      lab_id: 'lab-w2',
      lab_name: 'Update Boundary Lab',
      doctor_name: 'Tariq Mahmood',
      selected_teeth: [11],
      delivery_date: '2026-06-01',
      created_at: STAMP,
    });

    // A legacy form still submitting the prefixed text.
    casesRepo.update(created.id, { doctor_name: 'Dr. Tariq Mahmood' });

    expect(casesRepo.byId(created.id)?.doctor_name).toBe('Tariq Mahmood');
  });

  it('keeps a stacked double prefix from surviving either pass', () => {
    labsRepo.insert({ id: 'lab-w3', name: 'Stacked Prefix Lab' });
    const created = casesRepo.insert({
      case_number: 'DS-W3',
      lab_id: 'lab-w3',
      lab_name: 'Stacked Prefix Lab',
      // The defect this whole change exists to prevent, arriving on write.
      doctor_name: 'Dr. Dr. Ahmad Khan',
      selected_teeth: [11],
      delivery_date: '2026-06-01',
      created_at: STAMP,
    });

    expect(created.doctor_name).toBe('Ahmad Khan');
  });

  it('preserves an academic title rather than downgrading it', () => {
    labsRepo.insert({ id: 'lab-w4', name: 'Academic Title Lab' });
    const created = casesRepo.insert({
      case_number: 'DS-W4',
      lab_id: 'lab-w4',
      lab_name: 'Academic Title Lab',
      doctor_name: 'Prof. Ahmed Khan',
      selected_teeth: [11],
      delivery_date: '2026-06-01',
      created_at: STAMP,
    });

    expect(created.doctor_name).toBe('Prof. Ahmed Khan');
  });

  it('normalises the clinic, invoice, ledger and voucher columns as well', () => {
    // Fixing only `cases` would leave an invoice or a ledger line printing
    // "Dr. Dr." forever, because each renders independently.
    const lab = labsRepo.insert({ id: 'lab-w5', name: 'All Columns Lab', doctor_name: 'Dr. Ayesha Khan' });
    expect(lab.doctor_name).toBe('Ayesha Khan');

    const inv = invoicesRepo.insert({
      invoice_number: 'INV-W5',
      lab_id: 'lab-w5',
      lab_name: 'All Columns Lab',
      doctor_name: 'Dr. Ayesha Khan',
      amount: 1000,
      discount: 0,
      final_amount: 1000,
      amount_paid: 0,
      created_at: STAMP,
    });
    expect(inv.doctor_name).toBe('Ayesha Khan');

    const ledger = ledgerRepo.insert({
      date: '2026-05-01',
      lab_id: 'lab-w5',
      lab_name: 'All Columns Lab',
      entry_type: 'invoice',
      reference_id: inv.id,
      description: 'Issuance',
      debit: 1000,
      credit: 0,
      doctor_name: 'Dr. Ayesha Khan',
    });
    expect(ledger.doctor_name).toBe('Ayesha Khan');

    const voucher = vouchersRepo.insert({
      id: 'vch-w5',
      voucher_number: 'VCH-W5',
      voucher_type: 'job_slip',
      case_id: 'case-w5',
      doctor_name: 'Dr. Ayesha Khan',
      saved_by: 'tester',
      created_at: STAMP,
    });
    expect(voucher.doctor_name).toBe('Ayesha Khan');
  });

  it('never lets a stranded honorific reach a printed name', () => {
    // A value that is nothing but "Dr." has nobody behind it. The write path
    // preserves the text (migration 020 does too — blanking it would destroy
    // evidence of what was actually stored), and the READ path is what turns
    // it into a fallback. Asserting the pair together is the real contract:
    // preserved on disk, never printed.
    const lab = labsRepo.insert({ id: 'lab-w6', name: 'No Doctor Lab', doctor_name: 'Dr.' });
    expect(lab.doctor_name).toBe('Dr.');
    expect(formatDoctorName(lab.doctor_name)).toBe('—');
  });
});

describe('doctor preferred lab — keyed on the bare name', () => {
  it('finds a stored preference when the lookup carries the honorific', () => {
    labsRepo.insert({ id: 'lab-w7', name: 'Preference Lab' });
    doctorPreferredLabsRepo.set('Dr. Ayesha Khan', 'lab-w7', 'Preference Lab');

    const stored = doctorPreferredLabsRepo.all().find((d) => d.lab_id === 'lab-w7');
    expect(stored?.doctor_name).toBe('Ayesha Khan');

    // The case form holds whatever the operator typed, honorific included.
    expect(doctorPreferredLabsRepo.byDoctor('Dr. Ayesha Khan')?.lab_id).toBe('lab-w7');
    expect(doctorPreferredLabsRepo.byDoctor('Ayesha Khan')?.lab_id).toBe('lab-w7');
  });

  it('updates the existing row rather than creating a duplicate', () => {
    labsRepo.insert({ id: 'lab-w8', name: 'Pref A Lab' });
    labsRepo.insert({ id: 'lab-w9', name: 'Pref B Lab' });

    doctorPreferredLabsRepo.set('Ayesha Khan', 'lab-w8', 'Pref A Lab');
    // Typed with the honorific the second time — same person, must not fork.
    doctorPreferredLabsRepo.set('Dr. Ayesha Khan', 'lab-w9', 'Pref B Lab');

    const rows = doctorPreferredLabsRepo.all().filter((d) => d.lab_name.startsWith('Pref '));
    expect(rows).toHaveLength(1);
    expect(rows[0].lab_id).toBe('lab-w9');
  });
});