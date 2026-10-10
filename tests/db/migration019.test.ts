import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { MIGRATIONS } from '../../src/db/migrations';

/** The migration ledger must be 1..N with no gaps, for whatever N is now. */
const ALL_VERSIONS = Array.from({ length: MIGRATIONS.length }, (_, i) => i + 1);
const LATEST_VERSION = String(MIGRATIONS[MIGRATIONS.length - 1].version);
import { casesRepo, labsRepo } from '../../src/db/repos';

/**
 * Migration 019: `cases.received_date`.
 *
 * `delivery_date` is the FUTURE promised date — it drives overdue flags, SLA
 * reminders, queue bucketing and sorting, and it is NOT NULL. A slip has to
 * show the day the job actually came in, which is a different date, so this
 * adds it as a separate NULLABLE column rather than repurposing delivery_date.
 */
describe('migration 019 — cases.received_date', () => {
  let engine: SqliteEngine;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    engine = await SqliteEngine.create(SQL, null);
    engine.migrate();
    setDatabase(engine);
  });

  it('adds a nullable received_date column and stamps the current schema_version', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(ALL_VERSIONS);
    const cols = engine.all<{ name: string; notnull: number }>('PRAGMA table_info(cases)');
    const received = cols.find((c) => c.name === 'received_date');
    expect(received).toBeDefined();
    // NOT NULL would fail the migration on every pre-019 case row.
    expect(received?.notnull).toBe(0);
    const row = engine.get<{ value: string }>("SELECT value FROM app_meta WHERE key = 'schema_version'");
    expect(row?.value).toBe(LATEST_VERSION);
  });

  beforeEach(() => {
    labsRepo.insert({ id: 'lab-r019', name: 'Received Lab' });
  });

  const seedCase = (overrides: Record<string, unknown> = {}) =>
    casesRepo.insert({
      case_number: 'DS-R001',
      lab_id: 'lab-r019',
      lab_name: 'Received Lab',
      doctor_name: 'Dr Rao',
      selected_teeth: [11],
      delivery_date: '2026-12-01',
      ...overrides,
    });

  it('round-trips received_date on insert and update, and leaves legacy rows NULL', () => {
    const withDate = seedCase({ received_date: '2026-10-03' });
    expect(withDate.received_date).toBe('2026-10-03');
    // delivery_date is untouched — it is still the promised future date.
    expect(withDate.delivery_date).toBe('2026-12-01');

    casesRepo.update(withDate.id, { received_date: '2026-10-05' });
    expect(casesRepo.byId(withDate.id)?.received_date).toBe('2026-10-05');

    const legacy = seedCase({ case_number: 'DS-R002' });
    expect(legacy.received_date ?? null).toBeNull();
    expect(legacy.delivery_date).toBe('2026-12-01');

    // Clearing it back to NULL is allowed (the field is optional).
    casesRepo.update(withDate.id, { received_date: null });
    expect(casesRepo.byId(withDate.id)?.received_date).toBeNull();
  });
});