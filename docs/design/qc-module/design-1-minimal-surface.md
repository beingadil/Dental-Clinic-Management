# Design 1 — Minimal Surface: **one command + one view**

> Constraint honoured: the entire caller-facing surface is **2 functions** (budget: ≤3).
> Design-only. No source was edited; no build or test was run.

## How the ≤3 count is computed (so the claim is checkable)

| Caller job | What it invokes |
|---|---|
| R1/R2/R8 record an inspection (pass/fail, reasons, notes, evidence) | `qc({ op: 'inspect', … })` |
| R3 gate the lifecycle (may this case be released?) | a `pass` *is* the release; `qcView().cases[id].release` is the predicate; `updateCase` refuses to bypass it |
| R3 waived exception path (who may waive) | `qc({ op: 'waive', … })` — payload variant of the same function |
| R8 attach evidence after the fact | `qc({ op: 'attach', … })` — payload variant of the same function |
| R4/R5/R6 read QC state, history, inspector, metrics, queue, trend | `qcView(options?)` |

**Public surface = `qc` + `qcView` (one command, one query).** The third slot of my budget is
deliberately unspent — there is no `releaseCase`, no `getQcHistory`, no `getQcMetrics`. `qcRepo`, the
migration, and the pure rule functions below are *internal machinery*: no component invokes them, exactly
like every other module in this repo (components use `useApp()`; repos are the persistence layer).

The whole design in one sentence: **an inspection outcome is the only thing that can release a case, and
the entire quality history of the lab is one fold over one append-only table.**


---

## 1. Interface signature

### 1.1 The two public functions

```ts
// src/context/AppContext.tsx — exposed on AppContextValue (callers use useApp())
qc: (command: QcCommand) => QcReceipt;            // THE command
qcView: (options?: QcViewOptions) => QcView;      // THE query (memoised per (inspections, cases, options))

// src/services/qcDomain.ts — the same query as a pure function (storage-agnostic, unit-testable)
export function qcView(input: QcViewInput, options?: QcViewOptions): QcView;

// src/services/qcDomain.ts — the pure decision the command wraps (internal: consumed by AppContext only)
export function decideInspection(
  cmd: QcCommand, context: QcDecisionContext
): QcDecision;   // { code, nextStatus, notification, notes … } — pure, no I/O, no state
```

`qcView` exists twice with the same name and the same return shape: once pure (called by tests **and** by
`AppContext`), once bound to app state. Callers learn one thing, not two. `decideInspection` is the state
machine; `AppContext.qc` is the ~25-line shell that runs the decision inside `db.withTransaction(...)`,
mirrors the result into React state, and hands back the receipt.

### 1.2 Types the caller must know

```ts
// ── the command: one union, three payload variants, zero extra methods ──
export type QcCommand =
  | { op: 'inspect';
      caseId: string;
      verdict: 'pass' | 'fail';
      reasons?: QcFailureReason[];   // REQUIRED (≥1) when verdict === 'fail'    (R2)
      notes?: string;                // free text                               (R2)
      checked?: QcCheckCode[];       // "what was checked"                      (R6)
      evidence?: QcEvidenceInput[];  // → attachments(entity_type='qc_inspection')(R8)
      location?: string;             // "where" — 'Bench 3', 'QC station'       (R6)
      inspectedAt?: string }         // manual back-entry; defaults to now
  | { op: 'waive';
      caseId: string;
      reason: string;                // REQUIRED, non-blank; QC_WAIVE_ROLES only
      notes?: string; evidence?: QcEvidenceInput[]; location?: string }
  | { op: 'attach';
      inspectionId: string;
      evidence: QcEvidenceInput[] };

// ── the receipt: what the transaction decided (one shape for every outcome) ──
export interface QcReceipt {
  ok: boolean;
  code: 'RECORDED' | 'IDEMPOTENT' | 'NOT_FOUND' | 'WRONG_STAGE' | 'ALREADY_RELEASED'
      | 'REASONS_REQUIRED' | 'REASON_REQUIRED' | 'FORBIDDEN' | 'NOTHING_TO_ATTACH';
  message: string;                 // user-facing sentence; feed it straight to showToast()
  inspection?: QcInspection;       // persisted row (or the pre-existing row when IDEMPOTENT)
  caseStatus?: CaseStatus;         // resulting status: 'ready' | 'revision' | unchanged
  caseState?: QcCaseState;         // derived post-write state, including the release gate
  notification?: AppNotification;  // the row pushed to the feed                    (R7)
  created: boolean;
}
```

```ts
// ── the query ──
export interface QcViewOptions {
  caseId?: string;                // scope cases/history to one case
  from?: string; to?: string;     // 'YYYY-MM-DD' lexicographic filter on inspected_at
  inspector?: string;             // filter the metric denominator by inspector
  topN?: number;                  // default 5 for topFailureReasons
  trendBucket?: 'week' | 'month'; // default: week when the range ≤ 120 days, else month
}

export interface QcViewInput {    // pure-function input (== what AppContext injects)
  inspections: QcInspection[];
  cases: Array<Pick<DentalCase, 'id' | 'case_number' | 'status' | 'priority' | 'delivery_date' | 'lab_name' | 'history'>>;
  evidence?: Record<string, QcEvidenceRef[]>;   // inspection_id → refs, hydrated from attachments
}

export interface QcView {
  metrics: QcMetrics;
  cases: Record<string, QcCaseState>;         // populated per QcViewOptions.caseId
  history: Record<string, QcInspection[]>;    // newest-first, same scoping
}
```

The query's **return type never varies**: options only narrow which map keys are populated. There is no
`QcView | QcCaseView` union for callers to narrow — a deliberate choice (§3.6).

```ts
export type QcVerdict = 'pass' | 'fail' | 'waived';
export interface QcEvidenceInput {   // produced by attachmentService.processFile(file, 'qc_inspection', caseId)
  filename: string; mime_type: string; size_bytes?: number; checksum?: string; data_url?: string;
}

// ── internal, not part of the caller surface: the pure decision contract (§1.1) ──
export interface QcDecisionContext {
  caseRow: { id: string; case_number: string; status: CaseStatus; history: CaseStatusHistory[] };
  priorInspections: QcInspection[];              // attempt order, ASC
  actor: { name: string; role: UserProfile['role'] };
  now: string;                                   // injected clock → deterministic tests
  allocateInspectionNo: (tx: TransactionApi) => string;   // injected sequence allocator (gap-free)
}
export interface QcDecision {
  code: QcReceipt['code'];
  nextStatus: CaseStatus | null;                 // null = status unchanged
  attemptNo: number;
  reworkStartedAt: string | null;
  releasedAt: string | null;
  notification: { type: NotificationType; title: string; message: string; priority?: PriorityLevel } | null;
  statusNote: string;                            // case_status_history notes ('QC pass QC-0007')
  benchNote: string | null;                      // fail only → case_notes
  message: string;                               // the receipt's user-facing sentence
}
```

```ts
export interface QcInspection {
  id: string;                       // genId('qc')
  inspection_no: string;            // 'QC-0001' — doc_sequences, SEQ_KEYS.qc
  case_id: string;
  case_number: string;              // denormalised at write time (print/notification without a join)
  attempt_no: number;               // 1-based, assigned INSIDE the transaction (never caller-supplied)
  verdict: 'pass' | 'fail' | 'waived';
  reasons: QcFailureReason[];       // decoded from reasons_json
  checked: QcCheckCode[];           // decoded from checklist_json
  notes?: string;
  inspector: string;                // user.name                                  (R6 · who)
  inspector_role: UserProfile['role'];
  inspected_at: string;             // 'YYYY-MM-DD HH:mm' — repo date style
  location?: string;                //                                            (R6 · where)
  rework_started_at?: string;       // set on 'fail' → starts the rework clock
  released_at?: string;             // set on 'pass' | 'waived'
  waiver_reason?: string;
  evidence: QcEvidenceRef[];        // joined from attachments; [] when none
}
export interface QcEvidenceRef { id: string; filename: string; file_type: string; size_bytes?: number }

export interface QcCaseState {
  verdict: 'pass' | 'fail' | 'waived' | 'none';  // latest inspection governs
  attempts: number;                              // inspections recorded (never 'attach')
  firstPass: 'passed' | 'failed' | 'pending';    // attempt #1 === 'pass' ⇒ 'passed'      (R4)
  openFailure: boolean;                          // failed and not yet re-passed
  reworkCount: number;                           // max(0, attempts - 1)
  needingAttention: boolean;                     // attempts ≥ QC_ATTEMPT_ATTENTION_THRESHOLD (3)
  selfInspected: boolean;                        // last inspector === last in-progress actor (visibility, §3.4)
  lastInspectedAt?: string; lastInspector?: string;
  release: QcReleaseGate;                        //                                         (R3)
}

export interface QcReleaseGate {
  allowed: boolean;
  via: 'pass' | 'waive' | null;                  // how it qualified
  blocker: { code: QcBlockerCode; message: string } | null;
  inspectionNo: string | null;
  decidedAt: string | null;
}
export type QcBlockerCode =
  | 'never_inspected'      // no inspection recorded — the normal state, not an error
  | 'last_verdict_failed'  // latest inspection is a fail → rework outstanding
  | 'case_cancelled'
  | 'case_draft';          // not yet in production — QC would be premature
```

```ts
export interface QcMetrics {
  inspections: number;                     // inspection rows in range (never 'attach')
  casesInspected: number;                  // distinct cases — the FPQC denominator
  firstPassQcPct: number | null;           // R5 · % of inspected cases passed on attempt #1; null = no data yet
  reworkRatePct: number | null;            // R5 · % of inspected cases needing ≥2 attempts
  avgReworkTurnaroundHours: number | null; // R5 · mean(fail → next pass); null when no rework completed
  openReworkCount: number;                 // failed, not yet re-passed
  oldestOpenReworkHours: number | null;    // ageing of the worst open rework
  queueCount: number;                      // cases currently sitting at status 'qc'
  waivedCount: number;                     // visibility for the waiver escape hatch
  releasedWithoutInspection: number;       // audit detector: ready/delivered with no pass (§3.9)
  topFailureReasons: QcFailureStat[];      // R5 · ≤ topN, sorted by count desc
  byInspector: QcInspectorStat[];          // R5 · per-inspector counts
  trend: QcTrendPoint[];                   // R5 · bucketed inspections / firstPassPct
}
export interface QcFailureStat { code: QcFailureReason; label: string; count: number; caseCount: number; share: number }
export interface QcInspectorStat { inspector: string; inspections: number; pass: number; fail: number; waivers: number; firstPassPct: number | null }
export interface QcTrendPoint { bucket: string /* '2026-W34' | '2026-08' */; inspections: number; pass: number; fail: number; firstPassPct: number | null }
```

Metric algebra (the definitions are part of the contract, so they cannot drift):

* `firstPassQcPct` = cases whose **attempt #1** verdict is `pass` ÷ `casesInspected`. A `waive` is **not** a
  first pass: waived cases leave both numerator and denominator — the number answers "did the work come out
  right the first time?", so buying your way out must not improve it (`waivedCount` makes the escape hatch
  visible instead of invisible).
* `reworkRatePct` = cases with ≥2 inspections ÷ `casesInspected` (case-level, not per-inspection).
* `avgReworkTurnaroundHours` = mean of (`pass.inspected_at` − the preceding `fail.inspected_at`) over
  consecutive fail→pass pairs; open rework is excluded from the mean but counted in `openReworkCount`.
* `topFailureReasons.count` = incidents (one per reason per failing inspection, so a two-reason failure
  counts twice); `caseCount` = distinct cases; `share` = count ÷ failing inspections.
* `null` is not `0`: empty data yields `null` and the UI keeps printing `—` (honours the release report's
  "no fabricated benchmarks" policy). `0` means a *measured* zero.

### 1.3 Vocabularies (closed sets — free text cannot be aggregated)

```ts
// src/services/qcDomain.ts — single source of truth, in the style of PRIORITY_SLA_DAYS / PRIORITY_LABELS
export const QC_FAILURE_REASONS = ['margin_gap','shade_mismatch','occlusion','fit_seating','surface_finish',
  'porosity','fracture','contamination','dimension','implant_interface','articulation','labelling','other'] as const;
export type QcFailureReason = typeof QC_FAILURE_REASONS[number];
export const QC_FAILURE_LABELS: Record<QcFailureReason, string> = { margin_gap: 'Marginal fit / open margin', /* … */ };

export const QC_CHECKS = ['margins','shade','occlusion','fit','finish','seat_on_model','contacts',
  'articulation','labelling'] as const;
export type QcCheckCode = typeof QC_CHECKS[number];

export const QC_INSPECT_ROLES: UserProfile['role'][] = ['Technician', 'Lab Admin', 'Super Admin'];
export const QC_WAIVE_ROLES:   UserProfile['role'][] = ['Lab Admin', 'Super Admin'];   // Billing Manager: neither
export const QC_ATTEMPT_ATTENTION_THRESHOLD = 3;
```

### 1.4 Storage shape — migration `005`, one table, append-only

```sql
-- MIGRATION_005_QC_INSPECTIONS  { version: 5, name: 'qc_inspections' }
CREATE TABLE qc_inspections (
  id                TEXT PRIMARY KEY,
  inspection_no     TEXT NOT NULL UNIQUE,          -- 'QC-0001' via doc_sequences (SEQ_KEYS.qc)
  case_id           TEXT NOT NULL,
  case_number       TEXT NOT NULL,
  attempt_no        INTEGER NOT NULL CHECK (attempt_no >= 1),
  verdict           TEXT NOT NULL CHECK (verdict IN ('pass','fail','waived')),
  reasons_json      TEXT NOT NULL DEFAULT '[]',    -- QcFailureReason[]  (TEXT-JSON repo idiom)
  checklist_json    TEXT NOT NULL DEFAULT '[]',    -- QcCheckCode[]      (TEXT-JSON repo idiom)
  notes             TEXT,
  inspector         TEXT NOT NULL,
  inspector_role    TEXT NOT NULL,
  inspected_at      TEXT NOT NULL,
  location          TEXT,
  rework_started_at TEXT,
  released_at       TEXT,
  waiver_reason     TEXT,
  created_at        TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  UNIQUE (case_id, attempt_no)                     -- idempotency guard (ledger_entries precedent)
);
CREATE INDEX idx_qc_case    ON qc_inspections(case_id, attempt_no);
CREATE INDEX idx_qc_time    ON qc_inspections(inspected_at);
CREATE INDEX idx_qc_verdict ON qc_inspections(verdict, inspected_at);
```

Internal persistence surface (not caller-facing — no component touches it):

```ts
// src/db/repos.ts — append-only by construction: no update(), no delete()
export const qcRepo = {
  all(): QcInspection[];                       // boot hydration + pure-metric input
  byCase(caseId: string): QcInspection[];      // ordered by attempt_no ASC
  insert(row: QcInspection, tx?: TransactionApi): QcInspection;   // inside the caller's transaction
  nextAttempt(tx: TransactionApi, caseId: string): number;        // SELECT MAX(attempt_no) + 1
  count(): number;
};
```

* **No new blob store (R8)**: evidence goes into the existing `attachments` table with
  `entity_type = 'qc_inspection'`, `entity_id = qc_inspections.id`; files are validated by the existing
  `attachmentService.processFile()` (8 MB / MIME allow-list / checksum) before insertion.
* **No new counter**: `SEQ_KEYS.qc = 'qc'`, prefix `'QC'`, allocated inside the same transaction via
  `nextNumber(tx, 'qc', 'QC')` — a rollback also rolls the counter back, so numbers stay gap-free.
* **No denormalised QC columns on `cases`**: attempts, first-pass and the gate are folded from this table
  on every read, so the ledger is the single source of truth and a tampered `cases.status` cannot
  fabricate a pass (§3.9).
* **No new notification type**: `notifications.type` is CHECK-constrained to
  `('overdue_case','pending_payment','escalation','status_change','unpaid_invoice','system')`; adding a type
  would force a table rebuild. Pass/waive therefore emit `status_change`, fail emits `escalation`
  (priority `high`). R7 is satisfied without touching an existing table.

---

## 2. Usage examples

**(a) CaseDetailPanel / CaseDetailModal — the technician at the bench records a pass**

```tsx
const { qc, showToast } = useApp();

const handlePass = () => {
  const receipt = qc({
    op: 'inspect', caseId: caseData.id, verdict: 'pass',
    checked: ['margins', 'shade', 'occlusion', 'fit'],
    location: 'Bench 3',
  });
  showToast(receipt.message, receipt.ok ? 'success' : 'error');
  if (receipt.ok) onClose();               // receipt.caseStatus === 'ready'
};
```

**(b) …records a failure with structured reasons + evidence (R2, R8)**

```tsx
const receipt = qc({
  op: 'inspect', caseId: caseData.id, verdict: 'fail',
  reasons: ['margin_gap', 'shade_mismatch'],
  checked: ['margins', 'shade'], notes: 'Distal margin open ~0.3 mm; shade 1 step dark.',
  evidence: await Promise.all(files.map(async (f) => ({ file: f, ...(await processFile(f, 'qc_inspection', caseData.id)) }))),
  location: 'QC station',
});
// one transaction: attempt_no = 2, case → 'revision', rework clock started,
// bench note appended, high-priority escalation notification raised.
```

**(c) CaseListView / CaseProgressIndicator — the release gate, read-only (R3)**

```tsx
const { qcView } = useApp();
const gate = qcView({ caseId: c.id }).cases[c.id].release;

<button
  disabled={!gate.allowed}
  title={gate.blocker?.message ?? `Released by ${gate.inspectionNo}`}
  onClick={() => updateCase(c.id, { status: 'ready' })}
>Move to Ready</button>;
```

**(d) DashboardView — replacing the hardcoded `—` at line 571-572 (R5)**

```tsx
const { metrics } = qcView({ from: monthStart });
const { firstPassQcPct, queueCount, openReworkCount } = metrics;

<span className="font-bold text-emerald-600">
  {firstPassQcPct === null ? '—' : `${firstPassQcPct.toFixed(0)}%`}
</span>
<span className="text-[10px] text-slate-400">{queueCount} in QC · {openReworkCount} rework</span>;
```

**(e) AnalyticsView — quality trend + top failure reasons (R5)**

```tsx
const { trend, topFailureReasons, byInspector } = qcView({
  from: startDate, to: endDate, topN: 5, trendBucket: 'month',
}).metrics;
<BarChart data={trend.map((t) => ({ month: t.bucket, pct: t.firstPassPct ?? 0 }))} />;
```

**(f) AppContext.updateCase — the gate cannot be bypassed, signature unchanged**

```ts
if (updates.status === 'ready' || updates.status === 'delivered') {
  const gate = qcView({ caseId: id }).cases[id]?.release;
  if (!gate?.allowed) {
    showToast(gate?.blocker?.message ?? 'Record a passing QC inspection before releasing.', 'error');
    return;                                  // no status change, no notification, no history row
  }
}
```

**(g) The notification feed needs no code (R7)** — `qc` already appended an `AppNotification`; the
bench sees `Case DS-1001 QC FAILED — margin_gap, shade_mismatch` via the existing `NotificationsView`.

**(h) tests/services/qcDomain.test.ts — deterministic, engine-free (R9)**

```ts
import { qcView } from '../../src/services/qcDomain';
const view = qcView({ inspections: [pass(1), fail(2, 'margin_gap'), pass(3)], cases: [qcCase()] });
expect(view.metrics.firstPassQcPct).toBe(0);
expect(view.metrics.reworkRatePct).toBe(100);
expect(view.metrics.avgReworkTurnaroundHours).toBeCloseTo(6);
expect(view.metrics.topFailureReasons[0].code).toBe('margin_gap');
```

---

## 3. What it hides internally

The two signatures are 6 lines of TypeScript. Everything below is invisible to callers.

### 3.1 The state machine (callers only ever see pass/fail/waive)

`decideInspection` owns this table. Stage legality is decided *before* any row is written, from
`cases.status` + the ledger:

| Case status | `inspect` | `waive` | Resulting status |
|---|---|---|---|
| `draft` | ✗ `WRONG_STAGE` (case_draft) | ✗ | unchanged |
| `received`, `in_progress` | ✗ `WRONG_STAGE` — move the case to `qc` first (the ladder already has that column) | ✗ | unchanged |
| `qc` | ✓ | ✓ | pass → `ready`, fail → `revision` |
| `revision` | ✓ (attempt #2..n — the rework loop) | ✓ | pass → `ready`, fail → `revision` |
| `ready`, `delivered` | ✗ `ALREADY_RELEASED` | ✗ `ALREADY_RELEASED` | unchanged — **no silent double-pass** |
| `cancelled` | ✗ `WRONG_STAGE` (case_cancelled) | ✗ | unchanged |
| any, unknown `caseId` | ✗ `NOT_FOUND` | ✗ | — |

Restricting inspection to `qc | revision` is deliberate: it keeps the app's existing ladder
(`received → in_progress → qc → ready → delivered`) as the only route, and it makes every release provably
either inspected or an exception (§3.9) instead of "inspected somewhere in the past, maybe".

Three rules a caller never thinks about:

1. **A pass *is* the release.** `qc()` is the only writer of `ready`; there is no second "release" call to
   forget, and no state where a case is passed but un-released. (Rejected alternative: park at `qc` and
   require a manual dispatch — see §4.)
2. **A fail always means rework**, mapped onto the status the app already has (`revision`, the amber kanban
   column the progress ladder already renders at index 2). No new `CaseStatus` value → the enum, the CHECK
   constraint, and `CaseProgressIndicator` stay untouched.
3. **The latest verdict governs.** Re-inspecting a passed case and failing it re-blocks release; the gate is
   a single fold, never a "has it ever passed?" history scan.

### 3.2 Attempt numbering and idempotency (no double records)

* `attempt_no` is assigned **inside** the transaction:
  `SELECT COALESCE(MAX(attempt_no), 0) + 1 FROM qc_inspections WHERE case_id = ?`. Never caller-supplied,
  so attempts cannot be skipped, reused, or forged.
* `UNIQUE(case_id, attempt_no)` is the concurrency guard: a double-click, a replayed handler, or two windows
  racing produce **one** row; the loser's insert trips the constraint, `decideInspection` sees the existing
  row and returns `IDEMPOTENT` with the original receipt (including the original `inspection_no`) — not an
  error, not a duplicate.
* Same-inspection evidence re-submission (`op: 'attach'`) dedupes on `(entity_id, checksum)` and returns
  `NOTHING_TO_ATTACH` when nothing new was added.
* `verdict: 'fail'` with an empty `reasons` array is refused (`REASONS_REQUIRED`) — free text alone cannot be
  the only quality signal, or `topFailureReasons` would be built out of prose.

### 3.3 Authorization (from `user`, not from the UI)

`QC_INSPECT_ROLES` = Technician | Lab Admin | Super Admin; `QC_WAIVE_ROLES` = Lab Admin | Super Admin;
Billing Manager gets `FORBIDDEN` on both. Waiving additionally requires a non-blank `reason`
(`REASON_REQUIRED`) and is stored as its own verdict with its own `waiver_reason` column, so it can never be
mistaken for a pass in metrics or in print.

Self-inspection (inspector == the technician who built it) is **allowed** — small labs cannot staff a
separate inspector, and a rule nobody can follow becomes a rule everybody bypasses. Instead the fact is
derived (`QcCaseState.selfInspected`) and countable, so managers can see it rather than pretend it is
prevented.

### 3.4 One write fans out to six rows — atomically

`AppContext.qc` performs the whole decision inside **one** `db.withTransaction(...)`, so there is no
observable state in which an inspection exists without its consequences:

```
BEGIN IMMEDIATE
  1. row   qc_inspections            (verdict, reasons, checklist, inspector, inspector_role, location)
  2. rows  attachments × n           entity_type='qc_inspection', entity_id=<inspection id>   (R8)
  3. UPDATE cases SET status = <ready|revision>, updated_at = …                               (R3/R2)
  4. row   case_status_history       { status, notes: 'QC pass QC-0007', updated_by: inspector } (R6)
  5. row   notifications             status_change (pass/waive) | escalation, priority 'high' (fail) (R7)
  6. row   audit_events              action 'qc.inspection.recorded', old_state/new_state = status pair
  7. row   case_notes (fail only)    the rework instruction, where technicians already look
COMMIT
```

The allocation of `inspection_no` (steps 1) uses `nextNumber(tx, 'qc', 'QC')` on the *same* transaction.
Anything that throws rolls the entire thing back — including the counter — so the UI can never show a
notification for an inspection the database does not have. React state is then updated from the returned
rows (`setCases`, `setNotifications`, `setQcInspections`, `setCaseNotes`), never optimistically.

### 3.5 The rework clock and the metric algebra live in one place

`rework_started_at` (set by a fail) and `released_at` (set by the next pass) are the only two timestamps the
metrics need; every R5 number is a pure fold over them, sorted by `attempt_no` per case. `qcView` therefore
contains the whole analytics layer — first-pass case-level rate, rework rate, completed-rework mean,
open-rework ageing, queue depth, waiver count, top-N reasons *with labels attached* (callers never map codes
to strings), per-inspector counts, and trend bucketing (`YYYY-Www` / `YYYY-MM`, computed with plain UTC date
math — no date library, matching `prioritySla.ts`).

### 3.6 One shape, scoped by options — never a union return

`QcView` always has `metrics`, `cases` and `history`. `options.caseId` narrows which keys are populated;
`from/to/inspector` narrow the metric population. Callers branch on nothing — a dashboard reads `metrics`, a
drawer reads `cases[id]`, and a print view reads `history[id]` from **the same call**, so there is no
"which getter do I need?" step. To keep that affordable, `AppContext.qcView` memoises: it folds the ledger
into a `Map<caseId, QcInspection[]>` once per change of (`qcInspections`, `cases`) and then answers every
scoped request from that index (`useMemo` keyed on the options object's primitive fields). A call site that
reads one case does not pay for a full re-regex — and neither does the tenth call site.

### 3.7 Derivation, not stored flags (why there is no `cases.first_pass`)

Storing `first_pass`, `attempts` or `qc_status` on `cases` would be denormalisation that three different code
paths (syncCore rebuild, legacy import, direct repo update) would have to keep true. Folding instead means
the ledger is always right and the numbers cannot drift from the rows that justify them. The trade is CPU
(§4).

### 3.8 Surviving the boot sync — the cascade trap (R10)

This is the subtlest part of the design, and it is entirely invisible to callers.

`syncCore.syncNow()` rebuilds collections with `DELETE` + re-`INSERT` inside one transaction, and it wipes
children of the case explicitly:

```
tx.run('DELETE FROM cases');            // ← fires ON DELETE CASCADE into every case child table
tx.run('DELETE FROM case_status_history'); …
```

A new `qc_inspections` table with `FK(case_id) → cases(id) ON DELETE CASCADE` is therefore **not**
"excluded automatically" — the very first boot sync would cascade-delete every QC row in the database.
R10 is a *cascade* problem, not a wipe problem. The design must therefore:

1. add `qcInspections: any[]` to `SyncCollections`, and a `DELETE FROM qc_inspections` + re-`INSERT` loop
   inside the cases section, alongside `case_status_history` (after the `cases` inserts, before the next
   parent table) — mirroring exactly how the existing case children are rebuilt;
2. hydrate `qcInspections` at boot from `qcRepo.all()` next to the other `mirrorSet(...)` calls;
3. keep the state invariant **"there is no QC row whose case is absent from `cases` state"** — because a
   re-`INSERT` of an orphaned QC row would violate the FK and abort the *entire* sync transaction
   (silently breaking persistence for every module, not just QC). Concretely: `deleteCase`,
   `wipeAllData` and `resetToDemoData` must prune `qcInspections` in lockstep with `cases`, and `syncNow`
   defensively skips QC rows whose `case_id` is not in the snapshot it is inserting;
4. re-hydrate `qcInspections` after `restoreBackupData` (the restored payload may be older or newer than
   the in-memory mirror).

QC **evidence** needs nothing: syncCore's attachment wipe is scoped
(`DELETE FROM attachments WHERE entity_type = 'case'`), so `entity_type='qc_inspection'` rows are never
touched by a rebuild. That is the whole reason R8 says "use the existing attachments table" — the scoped
delete makes the choice survivable.

### 3.9 The read-side trust model (there is no *stored* gate flag to lie about)

Because the gate is folded on read:

* `releasedWithoutInspection` = cases that **entered the QC stage** (their `history` contains a `qc` entry —
  data that already exists on every case) and now sit at `ready`/`delivered` with no `pass`/`waived`
  inspection. It is not a gate — it is a detector. Legacy imports, seeds, `casesRepo.update()` callers and
  direct SQL cannot be prevented from writing `status='ready'`, but they cannot hide either: the dashboard
  sees the count and the case's own `release.blocker` reads `never_inspected`. **A bypass becomes a visible
  exception instead of a silent one.** Scoping the detector to cases that actually passed through the QC
  column also keeps it honest on day one: the lab's pre-QC-era delivered cases are not retroactively
  slandered as failures.
* Nothing reads `cases.status` as proof of quality. A case with a pass row and a hand-edited status of
  `in_progress` is still releasable; a case forced to `ready` without a pass is still flagged.

### 3.10 Two enforcement points, one rule (R3 with belt and braces)

1. `qc()` is the only *intended* writer of `ready`, and a `pass` is the only verdict that produces it.
2. `updateCase(id, { status: 'ready' | 'delivered' })` — the path the kanban drag, the progress ladder, the
   detail panel's status select and the bulk actions all use — consults the same gate and refuses, returning
   the receipt-style message as a toast (see §2f). Signature unchanged, so no caller has to change and no
   new "approve" method appears.

Both points evaluate the *same* pure predicate (`deriveQcCaseState(...).release`), so they cannot drift.

---

## 4. Trade-offs

**Where this shape wins**

* **One thing to learn, in one place.** A new contributor sees `qc` and `qcView` on `AppContextValue`; the
  seven-row transaction, the state machine, the auth matrix, the metric algebra and the sync choreography
  are all below the waterline. Deep, not wide.
* **Misuse is structural, not documentary.** A pass is the only route to `ready`; attempts are assigned by
  the machine; a fail without reasons is refused; a waiver needs a role and a reason; a double-click is
  idempotent; `qc()` cannot half-apply. None of that depends on a component remembering to call something.
* **Ask anything, once.** Because `qcView` returns metrics + per-case state + history in one shape, the
  dashboard, kanban badge, drawer, print view and tests all call the same function — one memoisation, one
  definition of "first-pass", no chance of a second definition drifting.
* **R10 handled at the root.** The cascade interaction is named and specified, so the first boot sync does
  not erase the module it just shipped.
* **Append-only by contract.** `qcRepo` has no `update`/`delete`; a mistaken inspection is superseded, never
  rewritten. Quality history is audit-grade and the `WAIVED`/`FAIL` trail is preserved.

**Where it loses**

* **`op` is a poor man's polymorphism.** Call sites read `qc({ op: 'inspect', … })` where the rest of
  `AppContext` reads `recordPaymentV2(command)`, and TypeScript will not force a reader to notice the
  `attach` variant. Mitigation: exhaustive `switch` + `never` default in the implementation, three ops only,
  and a discriminator that is a literal English verb.
* **A wide receipt and a wide view.** `QcReceipt` and `QcView` hand the caller more than most call sites
  need (a receipt carries the notification *and* the new state). That is deliberate convenience (the panel
  wants toast + status + history at once) but it does widen the types a reader must skim — the cost of
  paying for a lookup only once.
* **A pass silently releases the case.** Labs that want "inspected → inspected OK (hold) → dispatch
  manually" are not modelled; the rule is fixed, not configurable in this design (a `settings`-driven
  variant would put a branch in the one place that must stay trivially auditable).
* **Folding on every read.** There is no stored first-pass flag, so `qcView` is O(inspections) per
  recomputation. At local single-lab volumes (thousands of rows) this is irrelevant and the memo cache
  absorbs the repeated calls; at 10⁶ rows it would need the `statsRepo`-style pre-aggregation the repo
  already uses elsewhere — an honest future limit, not a present one.
* **Waivers nudge the benchmark.** Excluding waived cases from `firstPassQcPct` is defensible, but a lab
  that waives liberally still looks healthy on that one number. `waivedCount` and
  `byInspector[].waivers` exist precisely so the number cannot be gamed invisibly.
* **One op more than the minimum.** `op: 'attach'` exists only because evidence legitimately arrives after
  the verdict. Dropping it would have made late photos orphans of the case-level attachment stream; keeping
  it costs one op and zero methods.

**The weakest point (self-critique)**

The gate's second enforcement point lives inside `updateCase`, a 60-line action in a 3k-line context that
*any* future writer of `cases.status` (a new bulk action, a new import path, a direct `casesRepo.update()`)
can side-step. The mitigation — deriving the gate and exposing `releasedWithoutInspection` — converts a
bypass from silent corruption into a visible exception, but it does not *prevent* it. A stricter design
would route every status write through one choke point; that is a refactor of existing code beyond this
module's remit (and beyond the "don't redesign existing tables/statuses" constraint), so this design
chooses detection over prevention and says so out loud.

---

## 5. Fit map

| File | Change | Exact names to expose |
|---|---|---|
| `src/db/migrations.ts` | **append** migration 005 (never edit 001–004), push into `MIGRATIONS` | `MIGRATION_005_QC_INSPECTIONS` — `{ version: 5, name: 'qc_inspections' }` containing the `CREATE TABLE` + 3 indexes above. ⚠️ It must **not** re-`INSERT` `app_meta('schema_version', …)`: `MIGRATION_004` already inserted that PRIMARY KEY, and a second plain insert would abort the migration and refuse boot. Use `UPDATE app_meta SET value='5' WHERE key='schema_version'` (or `INSERT … ON CONFLICT(key) DO UPDATE`). |
| `src/db/sequences.ts` | one line | `SEQ_KEYS.qc: 'qc'` (prefix `'QC'` used at the call site) |
| `src/types.ts` | add domain types | `QcCommand`, `QcReceipt`, `QcInspection`, `QcEvidenceRef`, `QcEvidenceInput`, `QcCaseState`, `QcReleaseGate`, `QcBlockerCode`, `QcVerdict`, `QcFailureReason`, `QcCheckCode`, `QcMetrics`, `QcFailureStat`, `QcInspectorStat`, `QcTrendPoint`, `QcView`, `QcViewInput`, `QcViewOptions` |
| `src/services/qcDomain.ts` | **NEW** (the only new file) — pure, storage-agnostic, no React, no `getDatabase()` | `qcView(input, options?)` · `decideInspection(cmd, ctx)` · `QC_FAILURE_REASONS` · `QC_FAILURE_LABELS` · `QC_CHECKS` · `QC_INSPECT_ROLES` · `QC_WAIVE_ROLES` · `QC_ATTEMPT_ATTENTION_THRESHOLD` |
| `src/db/repos.ts` | add repo + row decoder, mirroring `caseToDomain` | `QcInspectionRow` · `qcInspectionToDomain` · `qcRepo{ all, byCase, insert, nextAttempt, count }` (append-only: no update/delete) |
| `src/db/syncCore.ts` | `SyncCollections.qcInspections` + `DELETE FROM qc_inspections` and its re-`INSERT` loop beside `case_status_history`; skip rows whose case is not in the snapshot | §3.8 |
| `src/context/AppContext.tsx` | state `qcInspections` (+ `qcEvidence: Record<inspectionId, CaseAttachment[]>`); boot `mirrorSet('qcInspections', qcRepo.all())`; two `AppContextValue` members; prune in `deleteCase` / `wipeAllData` / `resetToDemoData`; re-hydrate in `restoreBackupData`; gate guard at the top of `updateCase` | `qc`, `qcView` (the entire new public surface) |
| `src/components/cases/CaseDetailPanel.tsx`, `CaseDetailModal.tsx` | QC section: verdict buttons, reason multi-select, checklist, `location`, evidence upload, attempt history from `history[id]` | uses only `qc` / `qcView` |
| `src/components/cases/CaseListView.tsx`, `CaseProgressIndicator.tsx` | QC column badge: attempts, `needingAttention`, gate-blocked release | `qcView({ caseId })` |
| `src/components/dashboard/DashboardView.tsx` | replace the hardcoded `—` (lines 571-572) with `metrics.firstPassQcPct`, plus queue/rework counts | `qcView()` |
| `src/components/analytics/AnalyticsView.tsx` | new quality block: `trend`, `topFailureReasons`, `byInspector` | `qcView({ from, to, topN, trendBucket })` |
| `src/components/print/printRenderer.tsx`, `PrintStudioView.tsx` | new `DocumentKind: 'qc_certificate'` rendered from one case's `history`/state (inspection no., verdict, inspector, checklist, timestamp). **No `saved_vouchers` row**: its `voucher_type` CHECK allows only `('job_slip','invoice')`, and widening it is a migration this design deliberately avoids | `qcView({ caseId })` |
| `src/components/notifications/NotificationsView.tsx` | **no change** — QC pass/fail reuse `status_change` / `escalation` | — |
| `src/services/backupService.ts` | optional: add `'qc_inspections'` to the manifest `table_counts` list for visibility (the payload already contains the whole DB, so backup/restore works without this) | — |
| `tests/services/qcDomain.test.ts` | **NEW** — pure metric/gate tests (first-pass, rework, waiver exclusion, `null` for empty, gate blockers, idempotent attempt numbering) | `qcView`, `decideInspection` |
| `tests/db/repos.test.ts` | append `qcRepo` cases: insert → `byCase` ordering → `UNIQUE(case_id, attempt_no)` rejection → cascade on case delete | `qcRepo` |
| `tests/db/engine.test.ts` | **must be updated**: line 17 asserts migration versions `[1, 2, 3, 4]`; it becomes `[1, 2, 3, 4, 5]` | — |
| `docs/DATABASE.md` | line 17 lists migrations through `004` and the table map in lines 26-30; add `005_qc_inspections` + `qc_inspections` | — |
| `src/db/legacyMigrator.ts` | **no change** — there is no legacy QC payload; imported cases keep only their `history`, which is exactly why the detector in §3.9 is history-scoped | — |

---

## 6. Requirement coverage

| # | Verdict | One line |
|---|---|---|
| **R1** | **met** | `qc({ op: 'inspect', caseId, verdict: 'pass' \| 'fail' })` is the single door for an outcome; the row is written by machine-assigned `attempt_no` and never edited. |
| **R2** | **met** | A `fail` requires ≥1 structured `reasons` entry (plus optional free text) and drives `qc → revision` in the same transaction, sets `rework_started_at`, adds a bench note and raises an escalation notification. |
| **R3** | **met** | A `pass` is the only writer of `ready`; `updateCase` refuses `ready`/`delivered` without a qualifying pass/waive; the `waive` op is the role-gated, reason-bearing exception, and `releasedWithoutInspection` makes any out-of-band write visible (§3.9, §3.10). |
| **R4** | **met** | `attempt_no` is in-transaction and `UNIQUE(case_id, attempt_no)`; a repeat inspection is just another `inspect` op; `firstPass = 'passed'` iff attempt #1 was a `pass`, folded per case. |
| **R5** | **met** | One call returns First-Pass QC %, rework rate, top-N failure reasons (codes + labels + share), average rework turnaround, per-inspector counts — plus QC queue depth, open-rework ageing and a trend series; `null` (never `0`) when there is no data. |
| **R6** | **met** | `inspector`, `inspector_role`, `inspected_at`, `checklist_json` ("what"), `location` ("where"), plus fan-out rows into `case_status_history` and `audit_events`. |
| **R7** | **met** | Pass/waive emit `status_change`, fail emits `escalation` (priority `high`) with `case_id`/`case_number` — legal under the `notifications.type` CHECK, so no existing table is rebuilt. |
| **R8** | **met** | Evidence lands in the existing `attachments` table as `entity_type='qc_inspection'`, validated by `attachmentService.processFile()`; the QC table stores no blobs, and the scoped sync wipe leaves these rows intact. |
| **R9** | **met** | Pure TypeScript in `src/services/qcDomain.ts` + sql.js only: no new npm/Rust dependency, no Node-only API, no network, deterministic and engine-free unit tests. |
| **R10** | **met** | `qcInspections` joins `SyncCollections` with its own `DELETE` + re-`INSERT` beside `case_status_history`; the `DELETE FROM cases` cascade is accounted for, orphan re-inserts are skipped, and `deleteCase`/`wipeAllData`/`resetToDemoData`/`restoreBackupData` keep state and DB in lockstep (§3.8). |
| — | *residual* | R3's second enforcement point cannot *prevent* a write that never goes through `AppContext` (direct repo/SQL/import); it converts it to a detected exception. Stated as the weakest point in §4. |

---

## 7. Non-goals

* **Checklist/template management** — no authoring of per-case-type QC checklist templates; `QC_CHECKS` is a
  fixed vocabulary in code (like `PRIORITY_SLA_DAYS`), and per-case ad-hoc checks are expressed as a subset.
* **Per-tooth QC** — no FDI-level verdicts and no `Odontogram` integration; a failure reason is case-level,
  with `notes` carrying the tooth detail.
* **Client-facing quality reports / signatures** — no external QC report, no signature capture, no email
  delivery; the print output is an internal certificate only.
* **Multi-inspector governance** — no quorum, no approval chains, no inspector certification/calibration
  tracking, no mandatory segregation of duties (self-inspection is allowed and merely counted).
* **Editing or deleting inspections** — the ledger is append-only; a correction is a new superseding
  inspection, so `qcRepo` deliberately has no `update`/`delete`.
* **SLA coupling** — `prioritySla.ts` and the overdue logic are untouched; QC duration does not feed SLA
  breach computation in this round.
* **Notification changes** — no new `NotificationType`, no email-template or channel work.
* **Voucher/print persistence for QC** — no `saved_vouchers` row for a QC certificate (the `voucher_type`
  CHECK stays as-is); certificates are printed from the QC view, not archived as vouchers.
* **Exports/analytics redesign** — no CSV/Excel export and no rework of `AnalyticsView` beyond the quality
  block; the `—` on the dashboard is replaced with real numbers, nothing else is restyled.
* **Seed/demo QC data** — no QC seeds and no fabricated benchmarks; first-pass stays `null`/`—` until the
  lab records real inspections.
* **Anything networked** — no cloud QC sync, no third-party service, no new dependency, no second store.

