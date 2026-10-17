/**
 * Dev-only demo fixtures.
 *
 * WHY THIS EXISTS — designing the dashboard against an empty database is
 * guesswork. The shipped build has no synthetic data and that is deliberate
 * (see TestingTab: "there is deliberately no way to populate the app with demo
 * or synthetic [data]"), so every empty state is a fair reading of a new install
 * and every LOADED state — the one the dashboard actually spends its life in —
 * was untestable by hand. This module fills that gap without touching the
 * shipped product.
 *
 * TWO HARD RULES, both of which a later edit could quietly break:
 *
 * 1. It must never reach a production bundle. It is referenced from exactly one
 *    place — a dynamic `import()` inside `if (import.meta.env.DEV)` in App.tsx.
 *    Vite substitutes `import.meta.env.DEV` with `false` at build time, so the
 *    whole branch (and therefore the only reference to this module) is removed
 *    before Rollup decides what to emit. A top-level `import` or a
 *    `lazy(() => import(...))` would BOTH defeat that and ship this file.
 *    `tests/dev/demoFixturesDevOnly.test.ts` fails the build if anyone does.
 *
 * 2. It must never appear in the shipped UI. There is no button, no settings
 *    row, no menu entry. It installs a console handle and nothing else.
 *
 * WHY IT GOES THROUGH THE CONTEXT, NOT SQLITE — this writes via the same
 * `addCase` / `addLab` the UI calls, so React state and the database move
 * together. Writing rows straight into SQLite would look correct and then be
 * silently undone: `syncCollectionsToDb` rebuilds every collection table from
 * React state on each autosave, so SQL-only writes are erased the moment any
 * unrelated state changes. That exact bug is recorded in the changelog for
 * category reassignment (v2.23.0, "undone by autosave").
 */
import { getDaysOffsetStr } from '../utils/dateUtils';
import { LAB_DEPARTMENTS } from '../utils/labDepartments';
import { isDatabaseReady } from '../db';
import { casesRepo } from '../db/repos';
import { flushNow } from '../db/persistence';
import type { useApp } from '../context/AppContext';
import type { CaseStatus, PriorityLevel, DentalLab, DentalCase } from '../types';

/**
 * Grep target. `npm run build` then
 * `grep -r "DS-DEMO-FIXTURE" dist/` must return nothing; that grep is the proof
 * that this module is absent from a production bundle.
 */
export const DEMO_FIXTURE_MARKER = 'DS-DEMO-FIXTURE::WHITEFIELD::v1';

type AppValue = ReturnType<typeof useApp>;



/** The five clinics the fixture books work against. */
const CLINICS: Omit<DentalLab, 'id' | 'created_at' | 'rating' | 'reviews_count' | 'opening_balance'>[] = [
  {
    name: 'Whitefield Dental Studio',
    contact_person: 'Dr. Imran Qureshi',
    phone: '+92 300 4412 880',
    email: 'front.desk@whitefielddental.pk',
    address: '12-A Main Boulevard, Whitefield',
    city: 'Lahore',
    doctor_name: 'Dr. Imran Qureshi',
    notes: 'Prefers zirconia; sends most crown work Friday.',
  },
  {
    name: 'Northgate Family Dentistry',
    contact_person: 'Dr. Sana Malik',
    phone: '+92 321 7789 204',
    email: 'reception@northgatedental.pk',
    address: 'Plot 44, Northgate Commercial Area',
    city: 'Islamabad',
    doctor_name: 'Dr. Sana Malik',
    notes: 'High denture volume. Needs case photos on every slip.',
  },
  {
    name: 'Riverside Smile Centre',
    contact_person: 'Dr. Faisal Rehman',
    phone: '+92 333 2201 556',
    email: 'cases@riversidesmile.pk',
    address: '7 Riverside Promenade',
    city: 'Karachi',
    doctor_name: 'Dr. Faisal Rehman',
    notes: 'Urgent turnarounds common; confirm shade before start.',
  },
  {
    name: 'Cedar Point Dental Care',
    contact_person: 'Dr. Ayesha Siddiqui',
    phone: '+92 345 6612 019',
    email: 'admin@cedarpointdental.pk',
    address: 'Cedar Point Plaza, Suite 210',
    city: 'Faisalabad',
    doctor_name: 'Dr. Ayesha Siddiqui',
  },
  {
    name: 'Central Prosthodontics',
    contact_person: 'Dr. Bilal Ahmed',
    phone: '+92 301 9945 337',
    email: 'lab.liaison@centralprostho.pk',
    address: '18 Hospital Road',
    city: 'Multan',
    doctor_name: 'Dr. Bilal Ahmed',
    notes: 'Implant cases only; always sends the fixture analogue.',
  },
];

type Department = (typeof LAB_DEPARTMENTS)[number];

interface CaseSpec {
  /** Index into CLINICS. */
  clinic: number;
  status: CaseStatus;
  /** Days from today the lab PROMISED delivery. Negative = already late. */
  dueInDays: number;
  /** How long ago the job arrived. Drives the ageing/stale reads. */
  receivedDaysAgo: number;
  priority: PriorityLevel;
  patient: string;
  teeth: number[];
  shade?: string;
  department: Department;
  /** Index into the catalogue, taken modulo the real product list. */
  product: number;
  instructions?: string;
  /** Marks the case's auto-created invoice as settled. */
  paid?: boolean;
}

/**
 * The board this fixture is built to produce, which is the point of it:
 *
 *   4 received · 11 in production · 3 QC · 3 ready · 3 delivered · 1 revision
 *   one case already past its promise (status in_progress, due 2 days ago)
 *   one QC case stale in the rack (arrived 6 days ago)
 *   several due today, spread across clinics
 *   three invoices settled, the rest unpaid — so Receivables has both states
 *
 * THE STALE STAGE NEEDS A BACKDATE — `computeWorkflow` ages a stage from the
 * case's last recorded transition, and `addCase` stamps that with *now*, so a
 * freshly seeded board reads every stage as 0 days old whatever `received_date`
 * says. `seed()` corrects that as its final step; see
 * backdateFixtureTransitions below.
 */
const CASE_SPECS: CaseSpec[] = [
  // ── Received (not started) ───────────────────────────────────────────
  { clinic: 0, status: 'received', dueInDays: 3, receivedDaysAgo: 0, priority: 'normal', patient: 'Hina Tariq', teeth: [16], shade: 'A2', department: 'CAD / CAM', product: 0, instructions: 'Full contour zirconia, contact points checked against the model.' },
  { clinic: 2, status: 'received', dueInDays: 0, receivedDaysAgo: 1, priority: 'high', patient: 'Owais Jamil', teeth: [11, 21], shade: 'A1', department: 'CAD / CAM', product: 1, instructions: 'Match to the existing central; patient is unhappy with the last shade.' },
  { clinic: 1, status: 'received', dueInDays: 5, receivedDaysAgo: 0, priority: 'low', patient: 'Rukhsana Bibi', teeth: [36, 37], shade: 'A3', department: 'Acrylic', product: 2 },
  { clinic: 4, status: 'received', dueInDays: 0, receivedDaysAgo: 0, priority: 'urgent', patient: 'Kamran Sheikh', teeth: [46], shade: 'B1', department: 'CAD / CAM', product: 0, instructions: 'Patient in the chair — collect today if possible.' },

  // ── In production ────────────────────────────────────────────────────
  // The LATE one: promised two days ago and still on the bench.
  { clinic: 2, status: 'in_progress', dueInDays: -2, receivedDaysAgo: 9, priority: 'urgent', patient: 'Zainab Farooq', teeth: [11, 12, 21, 22], shade: 'A2', department: 'Porcelain', product: 3, instructions: 'Four-unit anterior bridge. Clinic has already had to reschedule the patient.' },
  { clinic: 0, status: 'in_progress', dueInDays: 0, receivedDaysAgo: 4, priority: 'high', patient: 'Sohail Anwar', teeth: [24, 25], shade: 'A2', department: 'Sintering', product: 0 },
  { clinic: 0, status: 'in_progress', dueInDays: 2, receivedDaysAgo: 3, priority: 'normal', patient: 'Maria Nusrat', teeth: [13], shade: 'A3.5', department: 'CAD / CAM', product: 1 },
  { clinic: 1, status: 'in_progress', dueInDays: 0, receivedDaysAgo: 5, priority: 'high', patient: 'Abdul Hameed', teeth: [31, 32, 33, 41, 42, 43], shade: 'A3', department: 'Acrylic', product: 2, instructions: 'Full lower denture; try-in approved.' },
  { clinic: 1, status: 'in_progress', dueInDays: 4, receivedDaysAgo: 2, priority: 'normal', patient: 'Shazia Kamal', teeth: [14, 15, 16], shade: 'A2', department: 'CAD / CAM', product: 0 },
  { clinic: 2, status: 'in_progress', dueInDays: 1, receivedDaysAgo: 6, priority: 'high', patient: 'Danish Iqbal', teeth: [26], shade: 'A4', department: 'Sintering', product: 0, instructions: 'Heavy bruxer — increase occlusal thickness.' },
  { clinic: 3, status: 'in_progress', dueInDays: 3, receivedDaysAgo: 2, priority: 'normal', patient: 'Nadia Rasheed', teeth: [44, 45], shade: 'B2', department: 'Waxing', product: 3 },
  { clinic: 3, status: 'in_progress', dueInDays: 0, receivedDaysAgo: 4, priority: 'normal', patient: 'Tariq Mehmood', teeth: [36], shade: 'A3', department: 'Finishing', product: 1 },
  { clinic: 4, status: 'in_progress', dueInDays: 7, receivedDaysAgo: 1, priority: 'low', patient: 'Salma Yousaf', teeth: [46, 47], shade: 'A2', department: 'CAD / CAM', product: 4, instructions: 'Implant-supported; verify the analogue before sintering.' },
  { clinic: 4, status: 'in_progress', dueInDays: 2, receivedDaysAgo: 3, priority: 'normal', patient: 'Junaid Aslam', teeth: [21], shade: 'A1', department: 'Porcelain', product: 3 },
  { clinic: 0, status: 'in_progress', dueInDays: 6, receivedDaysAgo: 1, priority: 'normal', patient: 'Farah Deeba', teeth: [17, 27], shade: 'A3.5', department: 'Sintering', product: 0 },

  // ── QC ───────────────────────────────────────────────────────────────
  // The STALE one. STALE_DAYS in dashboard-panels is 4 and this case arrived 6
  // days ago, but that is NOT enough to colour the tile: `oldestDays` is
  // measured from the case's last status transition in `case_status_history`,
  // and `addCase` stamps that with *now*. backdateFixtureTransitions() supplies
  // the missing history, which is why seeding ends with a reload.
  { clinic: 2, status: 'qc', dueInDays: 2, receivedDaysAgo: 6, priority: 'high', patient: 'Imran Baig', teeth: [23, 24], shade: 'A2', department: 'QC', product: 1, instructions: 'Held for shade verification against the shade tab.' },
  { clinic: 1, status: 'qc', dueInDays: 0, receivedDaysAgo: 2, priority: 'normal', patient: 'Nusrat Jahan', teeth: [35], shade: 'A3', department: 'QC', product: 0 },
  { clinic: 3, status: 'qc', dueInDays: 1, receivedDaysAgo: 3, priority: 'urgent', patient: 'Wasim Akhtar', teeth: [11, 21], shade: 'B1', department: 'QC', product: 3, instructions: 'Rush — the clinic has a same-day seating appointment.' },

  // ── Ready (cleared, awaiting dispatch) ───────────────────────────────
  { clinic: 0, status: 'ready', dueInDays: 0, receivedDaysAgo: 5, priority: 'high', patient: 'Adeel Raza', teeth: [12], shade: 'A2', department: 'Finishing', product: 0 },
  { clinic: 4, status: 'ready', dueInDays: 0, receivedDaysAgo: 7, priority: 'normal', patient: 'Sadia Noor', teeth: [37, 47], shade: 'A3', department: 'Finishing', product: 1 },
  { clinic: 2, status: 'ready', dueInDays: 1, receivedDaysAgo: 4, priority: 'normal', patient: 'Hasnain Ali', teeth: [15], shade: 'B2', department: 'Finishing', product: 3 },

  // ── Delivered (settled invoices, and the Performance panel's numerator) ─
  { clinic: 0, status: 'delivered', dueInDays: -1, receivedDaysAgo: 8, priority: 'normal', patient: 'Rabia Sultan', teeth: [16, 26], shade: 'A2', department: 'CAD / CAM', product: 0, paid: true },
  { clinic: 1, status: 'delivered', dueInDays: -3, receivedDaysAgo: 12, priority: 'normal', patient: 'Aamir Nazir', teeth: [31, 41], shade: 'A3', department: 'Acrylic', product: 2, paid: true },
  { clinic: 3, status: 'delivered', dueInDays: -6, receivedDaysAgo: 15, priority: 'high', patient: 'Beenish Arif', teeth: [14, 15, 24, 25], shade: 'A2', department: 'Porcelain', product: 3, paid: true },

  // ── Revision (a case that came back) ─────────────────────────────────
  { clinic: 2, status: 'revision', dueInDays: 1, receivedDaysAgo: 11, priority: 'urgent', patient: 'Kashif Nawaz', teeth: [11], shade: 'A1', department: 'Porcelain', product: 3, instructions: 'Returned: incisal edge too long. Clinic wants it back this week.' },
];

/**
 * One macrotask so React can commit and the write-through sync can run.
 *
 * MessageChannel, NOT `setTimeout(0)`. A chained `setTimeout` loop is subject to
 * Chrome's timer-budget throttling: a backgrounded tab is given a small budget
 * and then has its further timers delayed, which stretched this seed from ~30
 * seconds to over ten minutes. Measured in the dev page — two chained
 * `setTimeout(0)` hops cost 0.2 ms, twenty cost more than 10 s, while
 * MessageChannel hops cost 0.1 ms each regardless of chaining. React's own
 * scheduler posts on the same channel, so this yields to precisely the work that
 * has to happen between two `addCase` calls.
 */
const settle = (): Promise<void> =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });

/**
 * Yields until `Date.now()` actually advances.
 *
 * `addLab` mints its id as `lab-${Date.now()}`, so clinics created inside one
 * millisecond collapse onto a single id. A human clicking "Add Clinic" cannot
 * do that; this loop can, and a clock-resolution guess (setTimeout 2ms) is not
 * safe when `Date.now()` is clamped to ~15ms on some platforms. Spinning until
 * the clock moves is deterministic on every platform.
 */
async function awaitClockAdvance(): Promise<void> {
  const before = Date.now();
  while (Date.now() === before) await settle();
}

export interface SeedReport {
  clinics: number;
  cases: number;
  invoices: number;
  markedPaid: number;
  caseNumbers: string[];
  /** Cases whose transition history was backdated — see below. */
  backdated: number;
  /**
   * True when every fixture transition was confirmed backdated in the DATABASE,
   * which is what a reload will hydrate. A silent false would leave the workflow
   * tiles reading 0 days with nothing to explain it.
   */
  staleStageReady: boolean;
}

/**
 * Rewrites each fixture case's status transition so it reads as "the day the case
 * arrived" instead of "the moment it was registered".
 *
 * WHY IT IS NEEDED — `computeWorkflow` measures `oldestDays` from
 * `lastTransition(c)`, the final entry of `c.history`. `addCase` writes exactly
 * one history entry and stamps it with `getNowStamp()`, so every freshly seeded
 * case is "0 days in stage": the stale treatment on the Production Workflow tile
 * (STALE_DAYS = 4) is unreachable however old `received_date` is. Nothing in the
 * public context can express a backdated transition either — `updateCase` builds
 * its own history array and discards any `history` passed in `updates`, and the
 * context exposes no collection setters at all. This is the only way in.
 *
 * WHY IT IS A DATABASE WRITE, AND WHY THE ORDER MATTERS — `case_status_history`
 * is rebuilt wholesale from React state on every collection sync (`syncCore`
 * deletes the table and re-inserts `cse.history`), so a database-only edit is
 * erased by whichever sync runs next. An earlier revision of this fixture
 * patched the table immediately after the last `addCase` and the board still
 * read 0 days after a reload: the sync effect for that still-pending commit ran
 * afterwards and overwrote the stamps. The fix is the ORDERING in `seed()` —
 * flush the pending sync first, patch only once the app has gone quiet, then
 * confirm the patch is still there before reporting success.
 *
 * The reload this needs is the same move the app's own restore pipeline makes
 * (BackupTab: write the database, then reload into it): React state still holds
 * the `addCase` stamps, so boot hydration is what finally puts the backdated
 * history into state, after which the two agree and nothing fights. Until that
 * reload, any interaction re-syncs state over the patch — which is why `seed()`
 * says so out loud, and why `backdate()` exists to re-apply it.
 *
 * NOTE the semantic shift, which is deliberate and fixture-only: it sets the
 * transition to the RECEIPT day, so `oldestDays` reads "days since arrival"
 * rather than "days since the case last moved". That is the reading a design
 * reviewer wants on a seeded board; it is not what production measures once real
 * cases accumulate genuine stage-to-stage transitions.
 */
/**
 * The transition stamp a fixture case SHOULD carry: the day it arrived.
 *
 * `HH:mm`, matching `getNowStamp()` — the app's own stamps carry no seconds, and
 * a fixture that wrote `HH:mm:ss` would sort differently from real data under the
 * `ORDER BY timestamp` in `caseToDomain`.
 */
function receiptStamp(c: DentalCase): string {
  return `${c.received_date || c.created_at} 09:00`;
}

/** Names of the fixture clinics — the marker that separates seeded data from real. */
function fixtureClinicNames(): Set<string> {
  return new Set(CLINICS.map((c) => c.name));
}

/** Fixture cases as they exist in the DATABASE right now. */
function fixtureCasesInDb(): DentalCase[] {
  if (!isDatabaseReady()) return [];
  const names = fixtureClinicNames();
  return (casesRepo.all() as DentalCase[]).filter((c) => names.has(c.lab_name));
}

/**
 * Fixture cases whose stored transition still carries the `addCase` stamp.
 * Reads the DATABASE, because that is what a reload hydrates from.
 *
 * Every fixture case carries exactly ONE transition (`addCase` writes one and
 * nothing here changes status), so there is no "which entry is the latest"
 * question to get wrong: `caseToDomain` orders history DESC while in-memory
 * history is append-ordered, and with a single entry both readings agree.
 */
function unbackdatedFixtureCases(): DentalCase[] {
  return fixtureCasesInDb().filter((c) => {
    const history = c.history || [];
    if (history.length === 0) return false;
    return history[history.length - 1].timestamp !== receiptStamp(c);
  });
}

/**
 * Waits until the write-through sync has actually landed the seeded cases WITH
 * their history rows, then reports whether it did.
 *
 * WHY THIS POLLS FOR A CONDITION INSTEAD OF AWAITING A DELAY — the sync runs in
 * a `useEffect`, so it lands on React's scheduler and not on a timer. An earlier
 * revision awaited a single `setTimeout(0)` and the database was still EMPTY when
 * the backdate looked at it: the patch touched nothing and cheerfully reported
 * `backdated: 0, staleStageReady: true`, and the board came up with every stage
 * reading 0 days. Waiting for the condition rather than for a duration is the
 * difference between a check and a guess here.
 *
 * Bounded by a DEADLINE rather than an attempt count, and yielding on
 * `setTimeout` rather than on the MessageChannel `settle`. Both details are
 * load-bearing: counting hops cannot work because the number needed is not
 * knowable (200 MessageChannel hops burn in ~20 ms, which is not enough time for
 * React to commit the final sync), and React posts its own work on that same
 * channel, so hopping on it in a tight loop starves the very effect being waited
 * for.
 */
async function awaitFixturePersisted(expected: number): Promise<boolean> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const rows = fixtureCasesInDb();
    if (rows.length >= expected && rows.every((c) => (c.history || []).length > 0)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function backdateFixtureTransitions(): number {
  if (!isDatabaseReady()) {
    throw new Error('The database is not ready yet — wait for boot, then seed.');
  }
  let touched = 0;
  for (const c of unbackdatedFixtureCases()) {
    const history = c.history || [];
    casesRepo.update(c.id, { history: history.map((h) => ({ ...h, timestamp: receiptStamp(c) })) });
    touched += 1;
  }
  return touched;
}

/**
 * Books the fixture dataset. Safe to await; every step yields to React so the
 * app's own numbering and its write-through sync see each previous insert.
 *
 * WHY IT CANNOT BE A TIGHT SYNCHRONOUS LOOP — `generateCaseNumber()` closes over
 * the `cases` array of the render it was created in (`AppContext.tsx`, unlike
 * `generateInvoiceNumber`, which got a reservation service for exactly this
 * reason). Calling `addCase` 25 times without yielding hands every case the
 * same `DS-0001`, and the UNIQUE constraint then aborts the whole SQLite sync
 * transaction. Yielding per case is the fix; the duplicate check below is the
 * proof that it worked rather than a hope.
 */
export async function seedDemoFixtures(
  getApp: () => AppValue,
  opts: { reload?: boolean } = {},
): Promise<SeedReport> {
  const reload = opts.reload !== false;
  const products = getApp().caseTypes.filter((ct) => ct.needs_teeth !== false);
  if (products.length === 0) {
    throw new Error(
      'Demo fixtures need the shipped catalogue. Open Settings → System Reset and choose ' +
        '"reset configuration", or restart the app, then seed again.',
    );
  }

  const alreadyLoaded = fixtureClinicNames();
  const alreadySeeded = getApp().labs.some((l) => alreadyLoaded.has(l.name));
  if (alreadySeeded) {
    throw new Error(
      'Demo fixtures look like they are already loaded (a fixture clinic exists). ' +
        'Run __dentalDemo.clear() first for a clean slate.',
    );
  }

  // ── Clinics ───────────────────────────────────────────────────────────
  const clinics: DentalLab[] = [];
  for (const clinic of CLINICS) {
    await awaitClockAdvance();
    clinics.push(getApp().addLab(clinic));
  }
  const clinicIds = new Set(clinics.map((c) => c.id));
  if (clinicIds.size !== clinics.length) {
    throw new Error(
      'Fixture clinics collided on id. `addLab` ids are `lab-${Date.now()}`; ' +
        'awaitClockAdvance() should have prevented this.',
    );
  }

  // ── Cases (each one also mints its invoice + issuance journal) ────────
  const created: { id: string; case_number: string }[] = [];
  const paidCaseIds: string[] = [];

  for (const spec of CASE_SPECS) {
    const product = products[spec.product % products.length];
    const clinic = clinics[spec.clinic];
    // v2.23.0 rule: the case price is the base price × the charted units.
    const units = spec.teeth.length;
    const price = Math.round((product.base_price || 0) * units);
    const app = getApp();

    const created_ = app.addCase({
      patient_name: spec.patient,
      lab_id: clinic.id,
      lab_name: clinic.name,
      case_type_id: product.id,
      case_type_name: product.name,
      units_count: units,
      doctor_name: clinic.contact_person,
      selected_teeth: spec.teeth,
      shade: spec.shade,
      material: product.material_system,
      department: spec.department,
      delivery_date: getDaysOffsetStr(spec.dueInDays),
      received_date: getDaysOffsetStr(-spec.receivedDaysAgo),
      priority: spec.priority,
      price,
      discount: 0,
      final_price: price,
      instructions: spec.instructions,
      status: spec.status,
    });

    created.push({ id: created_.id, case_number: created_.case_number });
    if (spec.paid) paidCaseIds.push(created_.id);
    await settle();
  }

  // ── Prove the numbering actually advanced ─────────────────────────────
  const numbers = created.map((c) => c.case_number);
  const unique = new Set(numbers);
  if (unique.size !== numbers.length) {
    const seen = new Set<string>();
    const dupes = numbers.filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
    throw new Error(
      `Duplicate case numbers minted: ${[...new Set(dupes)].join(', ')}. ` +
        'addCase reads `cases` from its render closure — it needs a yield between calls.',
    );
  }

  // ── Settle a few invoices so Receivables shows both states ────────────
  let markedPaid = 0;
  if (paidCaseIds.length > 0) {
    const paidIds = new Set(paidCaseIds);
    const invoiceIds = getApp()
      .invoices.filter((inv) => paidIds.has(inv.case_id) && inv.payment_status !== 'paid')
      .map((inv) => inv.id);
    if (invoiceIds.length > 0) {
      getApp().bulkMarkPaid(invoiceIds);
      markedPaid = invoiceIds.length;
      await settle();
    }
  }

  // ── Make the stale stage reachable (see backdateFixtureTransitions) ────
  // ORDER IS THE POINT. The write-through sync runs in an effect after each
  // commit, so a patch applied while a commit is still settling is overwritten.
  // Wait for the sync to actually land, patch, then VERIFY — the failure mode
  // here is silent: every stage simply reads 0 days and nothing says so.
  if (!(await awaitFixturePersisted(created.length))) {
    throw new Error(
      'The seeded cases never reached the database, so a reload would load an empty ' +
        'board. The write-through sync did not land — reload and seed again.',
    );
  }

  let backdated = backdateFixtureTransitions();
  let remaining = unbackdatedFixtureCases().length;
  for (let attempt = 0; attempt < 5 && remaining > 0; attempt++) {
    await settle();
    backdated += backdateFixtureTransitions();
    remaining = unbackdatedFixtureCases().length;
  }
  const staleStageReady = remaining === 0;
  // Persist the patched engine before the reload: in the browser the engine is
  // in-memory and the snapshot is the only copy that survives a page load.
  await flushNow();

  const report: SeedReport = {
    clinics: clinics.length,
    cases: created.length,
    invoices: getApp().invoices.filter((inv) => created.some((c) => c.id === inv.case_id)).length,
    markedPaid,
    caseNumbers: numbers,
    backdated,
    staleStageReady,
  };
  console.info(`[demo-fixtures] ${DEMO_FIXTURE_MARKER}`, report);

  if (!staleStageReady) {
    console.warn(
      '[demo-fixtures] the backdated transitions did not stick, so the workflow ' +
        'tiles will read 0 days. Run __dentalDemo.backdate() and reload.',
    );
  }

  // The reload is not a convenience: React state still holds the `addCase`
  // timestamps, so only boot hydration can put the backdated history into state.
  // Doing it here (rather than asking the operator to reload) is deliberate — any
  // interaction in the meantime re-syncs state over the patch.
  if (reload) {
    console.info('[demo-fixtures] reloading to load the seeded board…');
    window.location.reload();
  }
  return report;
}

/**
 * Console surface. Installed only while `import.meta.env.DEV` is true, and
 * removed on unmount so a fast-refresh cannot leave a stale closure pointing at
 * a dead React tree.
 */
export function installDemoFixtures(getApp: () => AppValue): () => void {
  const handle = {
    marker: DEMO_FIXTURE_MARKER,
    /**
     * Book the dataset, then reload into it. Returns a report; throws with a
     * readable reason. Pass { reload: false } to skip the reload (scripted use).
     */
    seed: (opts?: { reload?: boolean }) => seedDemoFixtures(getApp, opts),
    /** Wipe everything except accounts — the tested System Reset path. */
    clear: () => {
      getApp().wipeAllData();
      console.info('[demo-fixtures] wiped. Accounts are intentionally kept.');
    },
    /** Re-apply the backdated transitions (idempotent, no reload needed). */
    backdate: () => backdateFixtureTransitions(),
    /** What is on the board right now, for a quick sanity read. */
    status: () => {
      const app = getApp();
      const byStatus: Record<string, number> = {};
      for (const c of app.cases) {
        if (c.archived_at) continue;
        byStatus[c.status] = (byStatus[c.status] || 0) + 1;
      }
      return {
        clinics: app.labs.length,
        cases: app.cases.length,
        byStatus,
        invoices: app.invoices.length,
        unpaid: app.invoices.filter((i) => i.payment_status !== 'paid').length,
      };
    },
  };

  const w = window as unknown as Record<string, unknown>;
  w.__dentalDemo = handle;
  console.info(
    `[demo-fixtures] installed. Try:\n` +
      `  await __dentalDemo.seed()   // book the demo dataset\n` +
      `  __dentalDemo.status()       // what is on the board\n` +
      `  __dentalDemo.backdate()     // re-apply the stale-stage backdate\n` +
      `  __dentalDemo.clear()        // wipe (keeps accounts)`,
  );

  return () => {
    if (w.__dentalDemo === handle) delete w.__dentalDemo;
  };
}
