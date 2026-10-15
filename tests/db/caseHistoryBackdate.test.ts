/**
 * The stale-stage mechanism the demo fixture depends on.
 *
 * `computeWorkflow` measures a stage's age from the case's LAST status
 * transition (`lastTransition` → final `c.history` entry), not from
 * `delivery_date` and not from `received_date`. `addCase` writes exactly one
 * history row and stamps it with the current moment, so a case that arrived six
 * days ago but was registered just now reads as **0 days in stage** — and the
 * "stale" treatment on the Production Workflow tile (STALE_DAYS = 4) is
 * unreachable no matter what `received_date` says.
 *
 * That is why `src/dev/demoFixtures.ts` backdates history at the database level
 * as its final step, and why the fixture needs one reload to show a stale tile:
 * `case_status_history` is rebuilt from React state on every collection sync,
 * but the app HYDRATES history from that table on boot, so a backdate survives
 * the reload and is then written back.
 *
 * ORDERING IS WHAT MAKES THAT WORK, and it is the thing that broke first: the
 * collection sync runs in an effect after every commit, so a patch applied while
 * a commit is still settling is silently overwritten — the fixture reported
 * success while the board read 0 days. `seed()` therefore flushes the pending
 * write, waits for the app to go quiet, patches, and then VERIFIES the patch
 * against the database before reporting.
 *
 * This test pins both halves against a real SQLite engine:
 *   1. a freshly inserted case reports 0 days in stage (the trap), and
 *   2. after `casesRepo.update(id, { history })` the read-back history carries
 *      the backdated stamp and the stage reports stale.
 *
 * It deliberately does NOT import the fixture module — the fixture is
 * referenced from exactly one place by design
 * (see tests/dev/demoFixturesDevOnly.test.ts).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { seedDatabase } from '../../src/db/seeds';
import { casesRepo, caseTypesRepo, labsRepo } from '../../src/db/repos';
import { computeWorkflow } from '../../src/components/dashboard/dashboardMetrics';
import type { DentalCase } from '../../src/types';

const TODAY = '2026-10-13';
/** Six days before TODAY — past STALE_DAYS (4). */
const RECEIVED = '2026-10-07';
const STALE_DAYS = 4;

const CASE_ID = 'case-stale-qc';
const LAB_ID = 'lab-backdate-test';
/**
 * The moment the case was REGISTERED, which is what `addCase` stamps into the
 * initial `case_status_history` row (it uses `created_at`, not `received_date`).
 * That gap — registered today, received six days ago — is the whole trap.
 */
const REGISTERED_STAMP = `${TODAY} 09:00`;
const BACKDATED_STAMP = `${RECEIVED} 09:00`;

let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
  await seedDatabase();

  // The `cases.lab_id` FK is enforced (a plain insert without this row fails
  // with FOREIGN KEY constraint failed), so the clinic has to exist first.
  labsRepo.insert({ id: LAB_ID, name: 'Backdate Test Clinic' });

  // A real catalogue row, so the FK to case_types is satisfied.
  const product = caseTypesRepo.all()[0] as { id: string; name: string };

  casesRepo.insert({
    id: CASE_ID,
    case_number: 'DS-9001',
    lab_id: LAB_ID,
    lab_name: 'Backdate Test Clinic',
    case_type_id: product.id,
    case_type_name: product.name,
    doctor_name: 'Dr. Test',
    selected_teeth: [11],
    delivery_date: '2026-10-15',
    received_date: RECEIVED,
    priority: 'normal',
    price: 1000,
    discount: 0,
    final_price: 1000,
    status: 'qc',
    // Inserted NOW while `received_date` is six days back — exactly the state
    // `addCase` leaves behind, and the reason a freshly seeded board has no
    // stale stage.
    created_at: REGISTERED_STAMP,
  });
});

/** `oldestDays` for the QC stage, or null when empty. */
function qcOldestDays(): number | null {
  const cases = casesRepo.all() as DentalCase[];
  const stage = computeWorkflow({
    cases,
    invoices: [],
    payments: [],
    labs: [],
    todayStr: TODAY,
  }).find((s) => s.key === 'qc');
  return stage?.oldestDays ?? null;
}

describe('a stage reads stale only after its history is backdated', () => {
  it('a case registered now reads as 0 days in stage, whatever received_date says', () => {
    // received_date is six days ago, but the only recorded transition is now.
    const fresh = casesRepo.byId(CASE_ID) as DentalCase;
    expect(fresh.received_date).toBe(RECEIVED);
    expect(fresh.history).toHaveLength(1);
    expect(fresh.history![0].timestamp.slice(0, 10)).toBe(TODAY);

    expect(qcOldestDays()).toBe(0);
    // So the tile's stale treatment cannot fire on received_date alone.
    expect(0 >= STALE_DAYS).toBe(false);
  });

  it('backdating the transition makes the stage stale AND survives the read-back', () => {
    const before = casesRepo.byId(CASE_ID) as DentalCase;
    const backdated = (before.history || []).map((h) => ({ ...h, timestamp: BACKDATED_STAMP }));

    casesRepo.update(CASE_ID, { history: backdated });

    // The write landed: history is re-read through the same hydration path the
    // app uses on boot (`caseToDomain` re-reads case_status_history).
    const after = casesRepo.byId(CASE_ID) as DentalCase;
    const last = (after.history || [])[after.history!.length - 1];
    expect(last.timestamp).toBe(BACKDATED_STAMP);

    // And the dashboard's stale predicate now fires.
    const days = qcOldestDays();
    expect(days).toBe(6);
    expect(days! >= STALE_DAYS).toBe(true);
  });

  it('is idempotent — re-applying the same backdate changes nothing', () => {
    const current = casesRepo.byId(CASE_ID) as DentalCase;
    casesRepo.update(CASE_ID, {
      history: (current.history || []).map((h) => ({ ...h, timestamp: BACKDATED_STAMP })),
    });
    expect(qcOldestDays()).toBe(6);
  });
});
