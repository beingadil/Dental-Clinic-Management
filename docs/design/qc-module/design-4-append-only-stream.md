# Design 4 — The QC Event Stream: an append-only log with derived read models

> **Assigned constraint (honoured strictly):** QC is an **immutable event stream** owned by this app,
> modelled on the repo's own append-only precedents — `ledger_entries` (`UNIQUE(entry_type, reference_id)`
> as an idempotency guard), `journal_entries`/`journal_lines` (facts + compensating reversals),
> `audit_events` (append-only), `case_status_history` (one row per transition), `doc_sequences` (gap-free
> numbering). **No QC row is ever mutated or deleted in place.** Corrections are *new compensating events*.
> "Current QC state" and every metric (First-Pass QC %, rework rate, failure-reason trends, inspector
> throughput) are **derived by folding the log**. Replay is idempotent and safe against the boot sync's
> `DELETE` + re-`INSERT` rebuild.
>
> **Design only.** No source file was edited, no build/test was run. Signatures, types and ≤10-line snippets.

## 0. Shape in one paragraph

One new table (`qc_events`, migration **005**), one new pure module (`src/services/qcStream.ts`, sibling of
`financeDomain.ts`/`prioritySla.ts`), one new repo with **no `update()` and no `delete(id)`**, and five
`AppContext` members (`qcAppend`, `qcCase`, `qcQueue`, `qcMetrics`, `qcEvents`). The technician's job is
expressed as *"append a fact"*; the app's job is to *fold the facts*. There is no inspectable, mutable
"inspection result" object anywhere — not in a table, not in state.

---

## 1. Interface signature

### 1.1 Event taxonomy — seven facts, no mutable row

| event type | fact recorded | who may append | carries |
|---|---|---|---|
| `inspection_opened` | *this inspector has this case at this bench, checking these items* | Technician¹, Lab Admin, Super Admin | `location`, `checks[]`, `attempt_no` |
| `inspection_passed` | *this attempt passed* | Technician¹, Lab Admin, Super Admin | `checks[]`, `summary?`, `evidence_ids[]` |
| `inspection_failed` | *this attempt failed, for these reasons* | Technician¹, Lab Admin, Super Admin | `reasons[]` (≥1, structured), `summary` (required), `checks[]`, `evidence_ids[]` |
| `inspection_abandoned` | *this attempt was closed with no verdict* (work not ready, sent back to rework) | Technician¹, Lab Admin, Super Admin | `note` |
| `release_waived` | *Lab Admin authorises releasing this case without a pass* | Lab Admin, Super Admin | `note` (required) |
| `verdict_amended` | **compensating**: *the verdict/reasons on event X were wrong; this is what they are* | Lab Admin, Super Admin | `supersedes_event_id`, corrected `verdict`/`reasons`/`summary`, `note` |
| `event_voided` | **compensating**: *event X was recorded in error and is annulled* | Lab Admin, Super Admin | `supersedes_event_id`, `note` |

¹ A Technician may append inspection facts **only for a case that is actually at the bench** (status `qc`, or
`revision`/`in_progress` after a failed attempt — see §3.7); corrections (`verdict_amended`, `event_voided`)
and `release_waived` are **not** available to Technicians, and the pure planner also refuses an inspector
compensating **their own** verdict (§3.7).

Two consequences worth stating up front, because they are what "append-only" buys:

* an attempt **never changes**; a mistake produces a *second* event that points at the first, and the fold
  (not the table) decides which one is in effect;
* a void does **not** renumber anything (`attempt_no` is an address, not a count — see §3.1).

### 1.2 The event (the only persisted QC shape)

```ts
// src/types.ts — domain types (JSON sub-fields stored as TEXT, decoded on read, repo convention)
export type QcEventType =
  | 'inspection_opened' | 'inspection_passed' | 'inspection_failed' | 'inspection_abandoned'
  | 'release_waived'    | 'verdict_amended'   | 'event_voided';

export type QcVerdict = 'pass' | 'fail';

export interface QcEvent {
  event_id: string;             // PK. Generated once per user intent → the idempotency key of the intent
  case_id: string;              // soft reference (no FK — see §3.6)
  case_number: string;          // denormalised at write time (feed/print, like ledger_entries.case_number)
  seq: number;                  // per-case append ordinal, stored → replay order is not time-dependent
  type: QcEventType;
  attempt_no: number;           // 1,2,3…; 0 for release_waived. Stored, never recomputed on read
  inspection_no: string | null; // 'QC-0007' — allocated ONCE from doc_sequences(key 'qc'), null for waivers
  verdict: QcVerdict | null;
  reasons: QcFailureReason[];   // structured codes; required non-empty on inspection_failed
  summary: string | null;       // free text (required on failed, optional elsewhere)
  checks: QcCheckResult[];      // 'what was checked' snapshot, frozen at append time
  location: string | null;      // 'where' — bench / room / workstation
  evidence_ids: string[];       // attachments.id rows with entity_type='qc_event'
  supersedes_event_id: string | null;  // compensating link; UNIQUE when non-null (§3.2)
  note: string | null;          // required on compensations + waivers
  actor: string;                // user.name
  actor_role: UserProfile['role'];
  occurred_at: string;          // ISO; injected clock (testable)
  client_token: string | null;  // optional external idempotency key (importers, tests)
}
```

### 1.3 The pure module — `src/services/qcStream.ts` (no engine, no React)

```ts
// ── vocabulary (code constants, not data: no new table, no config UI; the repo's financeDomain style) ──
export const QC_PREFIX = 'QC';
export const QC_FAILURE_REASONS = [
  'margin_gap','shade_mismatch','occlusion','surface_finish','contour_anatomy','fit_seating',
  'fracture_damage','wrong_tooth','material_deviation','articulation','packaging','other',
] as const;
export type QcFailureReason = (typeof QC_FAILURE_REASONS)[number];
export const QC_FAILURE_LABELS: Record<QcFailureReason, string>;      // 'shade_mismatch' → 'Shade mismatch'
export const QC_CHECKS: { key: string; label: string }[];             // 'what was checked' vocabulary
export type QcCheckResult = { key: string; result: 'ok' | 'attention' | 'na'; note?: string };
export const QC_INSPECT_ROLES: UserProfile['role'][];                 // who may append inspection facts
export const QC_CORRECTION_ROLES: UserProfile['role'][];              // who may amend / void / waive
export const QC_REWORK_ATTENTION_ATTEMPTS = 3;

// ── commands: the *intent*, one discriminated union (the whole write vocabulary a component needs) ──
export type QcCommand =
  | { kind: 'open';    case_id: string; location?: string; checks?: QcCheckResult[]; event_id?: string }
  | { kind: 'pass';    case_id: string; location?: string; checks?: QcCheckResult[]; summary?: string;
                       evidence_ids?: string[]; event_id?: string }
  | { kind: 'fail';    case_id: string; reasons: QcFailureReason[]; summary: string; location?: string;
                       checks?: QcCheckResult[]; evidence_ids?: string[]; event_id?: string }
  | { kind: 'abandon'; case_id: string; note: string; event_id?: string }
  | { kind: 'waive';   case_id: string; note: string; event_id?: string }
  | { kind: 'amend';   case_id: string; target_event_id: string; verdict: QcVerdict;
                       reasons?: QcFailureReason[]; summary?: string; note: string; event_id?: string }
  | { kind: 'void';    case_id: string; target_event_id: string; note: string; event_id?: string };

export type QcErrorCode =
  | 'not_booted' | 'not_found' | 'forbidden_role' | 'already_open' | 'already_decided' | 'already_passed'
  | 'nothing_to_decide' | 'reason_required' | 'target_not_found' | 'already_superseded' | 'constraint';

// ── the plan: what the pure layer decided, before any IO ──
export interface QcPlanContext {
  actor: { name: string; role: UserProfile['role'] };
  now: string;                                  // injected clock — determinism for tests
  caseRef: { id: string; case_number: string; lab_name: string; status: CaseStatus; delivery_date: string };
  priorEvents: readonly QcEvent[];              // THIS case's stream, ASC by seq (read inside the tx)
  nextSeq: number;                              // max(seq)+1 for this case
  nextInspectionNo: string | null;              // from doc_sequences, inside the same transaction
  nextEventId: (kind: 'inspection' | 'compensation') => string;
}
export interface QcPlan {
  ok: boolean;
  error: { code: QcErrorCode; message: string } | null;
  events: QcEvent[];                            // 1–2 drafted events (open+decision), fully materialised
  projection: { status: CaseStatus; note: string } | null;   // what cases.status should become, if anything
  notifications: AppNotification[];             // feed drafts (R7)
}

// ── the reads: derivation, gate, metrics (all pure; all storage-agnostic) ──
export function planQcAppend(cmd: QcCommand, ctx: QcPlanContext): QcPlan;
export function qcNeedsInspectionNo(cmd: QcCommand, priorEvents: readonly QcEvent[]): boolean; // shell-internal
export function foldQcStream(events: readonly QcEvent[]): Map<string, QcCaseSummary>;          // ONE pass
export function summarizeQcCase(events: readonly QcEvent[]): QcCaseSummary;                    // one case
export function qcReleaseGate(summary: QcCaseSummary, target: CaseStatus): QcGateDecision;
export function qcProjection(summary: QcCaseSummary, current: CaseStatus):
  { status: CaseStatus; note: string } | null;
export function qcMetrics(index: QcIndex, opts?: { from?: string; to?: string; topN?: number }): QcMetrics;
export function qcNotificationDrafts(plan: QcPlan, caseRef: QcPlanContext['caseRef']): AppNotification[];
export function qcReviewRows(summary: QcCaseSummary, caseRef: QcPlanContext['caseRef']): QcReviewRow[]; // print
```

### 1.4 Derived value shapes (what a caller actually consumes)

```ts
export interface QcAttempt {
  attempt_no: number;
  inspection_no: string | null;
  opened: { actor: string; at: string; location: string | null; checks: QcCheckResult[] } | null;
  verdict: 'pass' | 'fail' | 'abandoned' | 'open';             // 'open' = claim with no terminal event yet
  decided: { actor: string; at: string } | null;
  reasons: QcFailureReason[];                                  // with corrections applied
  summary: string | null;
  evidence_ids: string[];
  amended: boolean;                                            // true → payload came from a verdict_amended
  amendment_note: string | null;
  event_id: string | null;                                     // the terminal event this attempt came from
}

export interface QcCaseSummary {
  case_id: string;
  attempts: QcAttempt[];                                       // effective history ASC; voided attempts removed
  current: 'not_inspected' | 'open' | 'passed' | 'rework';     // ← the cheap "current QC status" for the UI
  gateOpen: boolean;                                           // a live pass exists
  waived: { actor: string; at: string; note: string } | null;   // live release_waived
  firstPass: boolean | null;                                   // null until attempt #1 is decided
  firstPassEligible: boolean;                                  // attempt #1 decided with a verdict (not abandoned)
  reworkCount: number;                                         // decided fails (a case can fail twice)
  inReworkSince: string | null;                                // fail timestamp of the open rework cycle
  reworkTurnaroundDays: number | null;                         // last fail → next pass
  attemptsCount: number;                                       // includes voided slots (audit honesty)
  streamLength: number; lastChangeAt: string | null;
  releasedWithoutLivePass: boolean;                            // left QC but no live pass/waiver now (red flag)
  needsAttention: boolean;                                     // ≥3 attempts, or an attempt open with no verdict
}

export interface QcIndex { byCase: ReadonlyMap<string, QcCaseSummary>; streamLength: number; computedAt: string }

export interface QcMetrics {
  window: { from: string | null; to: string | null };
  casesInspected: number; decidedAttempts: number;
  firstPassPct: number | null;                                 // null when nothing eligible → UI shows '—'
  firstPassEligible: number; abandonedFirstAttempts: number;    // so the UI can explain the denominator
  reworkRate: number | null;                                   // cases with ≥1 fail / cases with ≥1 verdict
  reworkCases: number; openRework: number;
  avgReworkTurnaroundDays: number | null;
  topFailureReasons: { reason: QcFailureReason; label: string; count: number; share: number }[];
  byInspector: { actor: string; role: string; inspections: number; passes: number; fails: number;
                 firstPassPct: number | null; lastAt: string }[];
  trend: { bucket: string; inspections: number; passes: number; fails: number;
           firstPassPct: number | null }[];
  queueDepth: number;                                          // cases in 'qc' with no decided verdict
}

export interface QcGateDecision {
  allowed: boolean;
  code: 'open' | 'pass_required' | 'waived' | 'unknown_case';
  message: string;                                             // ready-made for a tooltip / toast
}
```

### 1.5 The repository — append-only by construction

```ts
// src/db/repos.ts (shaped like ledgerRepo/journalRepo; NO update(), NO delete(id) — the absence IS the API)
export interface QcEventRow { /* the columns of §1.7; JSON fields are TEXT, decoded on read */ }
export const qcEventsRepo = {
  all(): QcEvent[];                                          // boot hydration + whole-log fold input
  byCase(caseId: string, tx?: TransactionApi): QcEvent[];    // ORDER BY seq ASC
  append(tx: TransactionApi, events: QcEvent[]): QcEvent[];  // INSERT … ON CONFLICT(event_id) DO NOTHING
  count(): number;
  orphanCount(): number;                                     // events whose case_id is absent from `cases`
  deleteAll(): void;                                         // ONLY for a full system wipe/reset (§3.6, §4)
};
```
`append` takes the caller's `TransactionApi` (the `nextNumber(tx, …)` idiom) so number allocation and the row
inserts share one transaction; the shell owns the `db.withTransaction(...)`.

### 1.6 The `AppContext` surface (the entire caller-facing API)

```ts
// src/context/AppContext.tsx — added to AppContextType; components only ever call useApp()
qcAppend(cmd: QcCommand): QcAppendReceipt;                 // the ONLY write path (R1,R2,R4,R8)
qcCase(caseId: string): QcCaseSummary;                     // O(1) map lookup — no query, no per-card fold
qcQueue(): QcCaseRef[];                                    // cases awaiting inspection (kanban, dashboard KPI)
qcMetrics(opts?: { from?: string; to?: string; topN?: number }): QcMetrics;   // R5, memoised
qcEvents(caseId?: string): QcEvent[];                      // raw stream, newest first (timeline/audit/print)
qcReplay(caseId?: string): { repaired: string[]; checked: number };  // re-project drift; never writes the log

export interface QcAppendReceipt {
  ok: boolean;
  appended: QcEvent[];                        // empty on refusal or idempotent replay
  duplicate_of: string | null;                // set ⇒ this intent was already appended (no-op, no bump)
  error: { code: QcErrorCode; message: string } | null;
  state: QcCaseSummary;                       // derived state AFTER the append (unchanged on refusal)
  projection: { from: CaseStatus; to: CaseStatus | null; note: string | null };
  notifications: AppNotification[];           // drafts already pushed into the feed
  gate: QcGateDecision;                       // may this case be released now?
  inspection_no: string | null;               // 'QC-0007' for the toast / label / certificate
}
```

### 1.7 Storage shape — migration `005_qc_event_stream` (append to `MIGRATIONS`; never edit 001–004)

```sql
CREATE TABLE qc_events (
  event_id            TEXT PRIMARY KEY,
  case_id             TEXT NOT NULL,   -- soft reference: NO FK, so `DELETE FROM cases` cannot cascade
  case_number         TEXT,
  seq                 INTEGER NOT NULL CHECK (seq > 0),
  type                TEXT NOT NULL CHECK (type IN ('inspection_opened','inspection_passed','inspection_failed',
                        'inspection_abandoned','release_waived','verdict_amended','event_voided')),
  attempt_no          INTEGER NOT NULL DEFAULT 0 CHECK (attempt_no >= 0),
  inspection_no       TEXT,
  verdict             TEXT CHECK (verdict IS NULL OR verdict IN ('pass','fail')),
  reasons             TEXT,            -- JSON array of codes
  summary             TEXT,
  checks              TEXT,            -- JSON array {key,result,note}
  location            TEXT,
  evidence_ids        TEXT,            -- JSON array of attachments.id
  supersedes_event_id TEXT,
  note                TEXT,
  actor               TEXT NOT NULL,
  actor_role          TEXT NOT NULL,
  occurred_at         TEXT NOT NULL,
  client_token        TEXT
);
-- the guards: each answers exactly one "is this the same thing again?" question (§3.2)
CREATE UNIQUE INDEX ux_qc_stream    ON qc_events(case_id, seq);
CREATE UNIQUE INDEX ux_qc_attempt   ON qc_events(case_id, attempt_no, type)
                                    WHERE supersedes_event_id IS NULL AND type <> 'release_waived';
CREATE UNIQUE INDEX ux_qc_supersede ON qc_events(supersedes_event_id) WHERE supersedes_event_id IS NOT NULL;
CREATE UNIQUE INDEX ux_qc_token     ON qc_events(client_token) WHERE client_token IS NOT NULL;
CREATE UNIQUE INDEX ux_qc_number    ON qc_events(inspection_no) WHERE inspection_no IS NOT NULL;
CREATE INDEX ix_qc_case  ON qc_events(case_id, seq);
CREATE INDEX ix_qc_when  ON qc_events(occurred_at);
CREATE INDEX ix_qc_actor ON qc_events(actor, occurred_at);
CREATE INDEX ix_qc_type  ON qc_events(type, occurred_at);
```
Plus one line in `src/db/sequences.ts` (`SEQ_KEYS.qc = 'qc'`, prefix `'QC'`), and evidence rows in the
**existing** `attachments` table with `entity_type = 'qc_event'`, `entity_id = <event_id>` — no new blob store.

---

## 2. Usage examples

**(a) `AppContext` — the whole write path (the shell that makes one append = one transaction).**

```ts
const qcAppend = (cmd: QcCommand): QcAppendReceipt => {
  if (!isDatabaseReady()) return qcRefused('not_booted', 'Database not ready');
  const caseRef = cases.find((c) => c.id === cmd.case_id);
  if (!caseRef) return qcRefused('not_found', 'Case not found');
  const receipt = getDatabase().withTransaction((tx) => {
    const prior = qcEventsRepo.byCase(cmd.case_id, tx);
    const ctx = { actor: { name: user?.name ?? 'System', role: user?.role ?? 'Technician' }, now: new Date().toISOString(),
      caseRef, priorEvents: prior, nextSeq: Math.max(0, ...prior.map(e => e.seq)) + 1,
      nextInspectionNo: qcNeedsInspectionNo(cmd, prior) ? nextNumber(tx, SEQ_KEYS.qc, QC_PREFIX) : null,
      nextEventId: () => genId('qcev') };
    const plan = planQcAppend(cmd, ctx);                     // pure: may refuse (no IO, no burned number)
    return { plan, appended: plan.ok ? qcEventsRepo.append(tx, plan.events) : [] };
  });
  // …merge into state (idempotent by event_id) → project status via updateCase → push notifications → return
};
```

**(b) Bench panel (`CaseDetailModal` → new `QcPanel`) — the fail path, 〈10 lines⌋.**

```tsx
const { qcAppend } = useApp();
const rec = qcAppend({ kind: 'fail', case_id: caseData.id, reasons: picked, summary: note,
                       location: 'Bench 3', checks, evidence_ids: uploaded.map(a => a.id) });
if (!rec.ok) return toast.error(rec.error!.message);                    // refusal is explained, never silent
toast.success(`${rec.inspection_no} failed — case moved to ${rec.projection.to}`);  // 'revision'
```

**(c) Kanban / `CaseProgressIndicator` — the gate is a read, and `updateCase` is the choke point.**

```tsx
const { qcCase, qcReleaseGate, updateCase } = useApp();
const s = qcCase(c.id);                                     // O(1) map lookup; zero SQL, zero fold per card
const gate = qcReleaseGate(s, 'ready');
<button disabled={!gate.allowed} title={gate.message}
        onClick={() => updateCase(c.id, { status: 'ready' }, `Released — ${s.attempts.at(-1)?.inspection_no}`)}>
  Move to Ready
</button>
```

**(d) `DashboardView.tsx:571` — First-Pass QC replaces the hardcoded `—` (honestly, not fabricated).**

```tsx
const { qcMetrics } = useApp();
const m = qcMetrics();                                      // memoised on the stream version (one fold)
<span className="font-bold text-emerald-600">
  {m.firstPassPct === null ? '—' : `${m.firstPassPct}%`}
</span>
<span className="text-[10px] text-slate-400">{m.queueDepth} in QC</span>
```

**(e) `AnalyticsView` — trend + top reasons, one call, labels already attached.**

```tsx
const { qcMetrics } = useApp();
const { trend, topFailureReasons, byInspector } =
  qcMetrics({ from: '2026-01-01', to: today }, 5);
// topFailureReasons[0] → { reason: 'shade_mismatch', label: 'Shade mismatch', count: 14, share: 0.31 }
// byInspector[0]       → { actor: 'Tech Hamza', inspections: 42, fails: 5, firstPassPct: 88.1, … }
```

**(f) Correcting a bad event — a Lab Admin appends a *new* fact; the original row is untouched.**

```tsx
// "I clicked Pass on the wrong case, three minutes ago." Nothing is edited or deleted:
const fix = qcAppend({ kind: 'void', case_id, target_event_id: wrongPassId,
                       note: 'Recorded against the wrong case — DS-1042 was still at the bench' });
if (fix.ok) toast.warning(`${wrongPassId.slice(0, 8)} voided — QC state is '${fix.state.current}' again`);
// Wrong *reason* rather than wrong verdict → same idea, replacement payload:
qcAppend({ kind: 'amend', case_id, target_event_id: failedId, verdict: 'fail',
           reasons: ['margin_gap'], note: 'Shade was fine; the distal margin was open' });
```

**(g) Boot/diagnostic replay — repair the projection, never the log.**

```ts
useEffect(() => { if (isDatabaseReady()) { hydrateQcFromDb(); qcReplay(); } }, []);  // boot, after mirrorSet
// Settings → diagnostics
const { repaired, checked } = qcReplay();       // re-derives each case's implied status
toast.info(`${repaired.length} case status(es) re-projected from the QC log (checked ${checked})`);
// idempotent: a second call returns repaired: [] because nothing differs any more
```

**(h) Tests — engine-level and pure, both deterministic (`tests/services/qcStream.test.ts`, `tests/db/repos.test.ts`).**

```ts
// pure: voiding is an overlay, not a deletion
const log = [ev.pass('c1', 1), ev.void('c1#1', 'wrong case')];
expect(foldQcStream(log).get('c1')!.gateOpen).toBe(false);
expect(foldQcStream(log).get('c1')!.attemptsCount).toBe(1);          // the slot is still addressable
// db: the syncCore rebuild must not touch the log (R10)
const before = engine.rowCount('qc_events');
syncNow(collections);                                                 // DELETE + re-INSERT every collection
expect(engine.rowCount('qc_events')).toBe(before);
expect(foldQcStream(qcEventsRepo.all()).get('c1')!.gateOpen).toBe(true);   // same fold, same answer
```

---

## 3. What it hides internally

Everything a caller never sees, and (the point of the exercise) the reasoning for each hard part.

### 3.1 The fold — an overlay algebra, not a state machine object

`foldQcStream` is one O(n) pass over the log array, producing a `Map<case_id, QcCaseSummary>`:

1. **Index compensations first.** `event_voided → void(target)`; `verdict_amended → amend(target, payload)`.
   `ux_qc_supersede` guarantees at most one compensation per target, so this map is unambiguous.
2. **Walk the case's events in `seq` order** (stored, so replay does not depend on clock skew) and build
   `attempts[]`: an `inspection_opened` fills the opening fields of attempt *N*; a terminal event fills the
   verdict. A target that was **voided** is dropped from the effective list; a target that was **amended**
   keeps its slot (same `attempt_no`, same `inspection_no`) but takes the amendment's verdict/reasons/summary.
3. **Reduce the attempts to derived state**: `current` = verdict of the highest live attempt (`passed` /
   `rework`), or `open` if the highest live attempt is a claim with no terminal event, else `not_inspected`;
   `gateOpen = current === 'passed'`; `firstPass = attempts[0]?.verdict === 'pass'` (with
   `firstPassEligible = false` when attempt #1 is `abandoned`, so it is *excluded* from the denominator instead
   of being counted as a failure); `reworkCount` = number of live `fail`s; `inReworkSince` / turnaround from the
   fail→pass pairs; `releasedWithoutLivePass` when a case is `ready`/`delivered` but nothing live justifies it.

Consequences that make this the right shape for a bench tool: **a void does not renumber**. `attempt_no` is an
*address* ("the third time we looked at this case"), not a count, so `attemptsCount = 3` with attempts 1 and 3
live and 2 voided is honest and stable; nothing is ever re-derived backwards. An `inspection_opened` is a
*claim*, not a required predecessor: `pass` without a prior `open` simply produces attempt *N* with
`opened: null` (a one-tap pass at the bench is legal; the log records exactly that — no fabricated "opened"
event).

### 3.2 Idempotency — what identifies "the same event" on retry *and* on rebuild

Five guards, each answering a different question; the first two are the direct analogues of
`ledger_entries.UNIQUE(entry_type, reference_id)`:

| guard | question it answers | where it bites |
|---|---|---|
| `PRIMARY KEY (event_id)` | *is this the same user **intent** re-delivered?* The action mints the id once (or accepts the caller's `cmd.event_id`, which is how tests and importers replay deterministically). | mirror merge is keyed by `event_id` (a duplicate is structurally impossible in state); `append` uses `INSERT … ON CONFLICT(event_id) DO NOTHING`; the receipt then reports `duplicate_of` + `ok: true` + **no** projection and **no** notification — a double-click is one fact, one `QC-nnnn`, one feed item. |
| `UNIQUE (case_id, seq)` | *is this the same **slot** in the stream?* | replay/rebuild determinism: the fold is ordering-stable, and a replayed intent that skipped the id check still cannot land twice. |
| `UNIQUE (case_id, attempt_no, type)` *(facts only)* | *is this the same **fact** about the same attempt?* "one verdict per attempt", "one opening per attempt" — the ledger-style guard. | a racing second window, a re-entered handler, or a stale-tab pass for attempt #1 trips the constraint (⇒ `QcErrorCode: 'constraint'`, mapped to a friendly message). |
| `UNIQUE (supersedes_event_id)` | *has this event already been corrected?* | forbids void+amend of the same event, double-void, and any "re-correction" chain — one compensation per original, always. |
| `UNIQUE (client_token)` + `UNIQUE (inspection_no)` | *did another system / a previous import already deliver this?* | importer/test safety; `inspection_no` is allocated once from `doc_sequences` and then *frozen on the row*, so a replay can never consume a second number (the numbering stays gap-free and stable). |

Three guards are **partial** (`WHERE …`), on purpose: compensations are excluded from
`ux_qc_attempt` (their identity is their target, not an attempt fact), and a voided waiver must not block a
replacement waiver, so `release_waived` is excluded from the attempt scope and guarded instead by the
domain's "one live waiver" rule plus its own `seq`.

**Rebuild/retry, side by side:**

| scenario | outcome |
|---|---|
| double-click "Pass" | same `event_id` ⇒ `duplicate_of` set, `appended: []`, no rework bump, no second notification, no second `QC-nnnn`. |
| double-click with two *fresh* ids (e.g. two windows) | planner refuses the second (`already_decided`); the DB refuses it too if the planner were bypassed. |
| a second **pass** on an already-passed case | planner refuses (`already_passed`): the sanctioned fix is `void` or `amend`, which is auditable and does not create a phantom "attempt 2". |
| boot sync `syncCore.syncNow` | the log is not in `SyncCollections`, so nothing deletes it: counts and fold output are identical before/after. |
| `.dentalbackup` restore | engine swap → `mirrorSet('qcEvents', qcEventsRepo.all())` re-hydrates whatever the payload contains (older or newer); the fold recomputes; `qcReplay()` repairs any status that the payload disagrees with. |
| `qcReplay()` twice | second call returns `repaired: []` — the repair path writes only when the derived status differs. |

### 3.3 One append, one transaction, one number

`qcAppend` runs entirely inside one `db.withTransaction(...)` (`BEGIN IMMEDIATE` / `SAVEPOINT` — the engine
already provides nesting): read the case's prior events → allocate `QC-nnnn` via
`nextNumber(tx, SEQ_KEYS.qc, 'QC')` **only when a number is needed** → `planQcAppend` (pure) → `append`.
A refusal or a constraint trip rolls back **including the counter**, so the promise `doc_sequences` makes
("gap-free document numbers") survives: no burned `QC` numbers, no half-written attempt. React state is merged
from the receipt *after* the commit, so the UI can never show an inspection the database does not have.

### 3.4 Deriving state without N+1 queries

The naïve event-sourced UI shows *one query per case per render* (or a fold per card). This design has **zero**
queries in the read path:

1. The log is hydrated once per session (`qcEventsRepo.all()`, one `SELECT`), plus once per append for that
   single case (`byCase`, one indexed `SELECT` inside the transaction).
2. `foldQcStream` is a single pass over the in-memory array producing **all** case summaries at once; it is
   memoised on the array identity (`useMemo`/lazy `useRef` keyed by `qcEvents`), so the dashboard KPI, the
   kanban badges, the print view and the gate all share one object.
3. `qcCase(id)` is a `Map.get` — O(1), no SQL, no fold, safe to call inside a list render for every row.
4. `qcMetrics(opts)` folds over the same summaries + the stream's verdict events (one pass for counts,
   top-N via a `Map` then a sort, trend via a date bucket function, inspector stats via one `Map`).
   `AnalyticsView`'s window is a filter over already-folded attempts, not a re-query.
5. `qcQueue()` intersects the derived summaries with the `cases` collection already in state (a `for` loop,
   no join, no query).

Cost: one O(E) fold per stream change, where E is the log length. Measured against this repo's data profile
(thousands of events, not millions) that is sub-millisecond-to-few-millisecond work with no allocations beyond
the summaries; past ~10⁵ events the honest answer is a *derived* projection table rebuilt from the log (still
never hand-written) — see §7 non-goals and §4.

### 3.5 Keeping `case_status_history` consistent

`case_status_history` stays exactly what it is — a per-transition narrative written by `updateCase`
(`src/context/AppContext.tsx:1543`). The QC stream does not write to it; the rules are:

1. **One projection writer.** The verdict's projection is applied by calling the existing `updateCase(id,
   { status }, note)` — so the history row is created by the same code that created every other row, with
   `updated_by = user.name`, and `casesRepo.update()` / `syncCore` keep rebuilding it from state as today.
   QC never inserts into `case_status_history` directly, so no shape is forked.
2. **The note cross-references the log**: `'QC fail QC-0007 — Margin gap, Shade mismatch'`. The history
   timeline and the log point at each other, one sentence apart, without duplication of payload.
3. **Derived rule**: `pass → 'ready'`, `fail → 'revision'` (the existing amber "Case returned for clinical
   revision / rework" state — no new `CaseStatus`, no CHECK change), `open → 'qc'`, `waive → no status write`
   (a waiver authorises; it does not move the case), void/amend → recompute from the reduction.
4. **Drift is detectable and repairable, not hidden.** `qcProjection(summary, cases.status)` returns the status
   the log implies (or `null`). `qcReplay()` walks `cases`, compares, and calls `updateCase` only where they
   differ. Because `updateCase` appends a history row only on an actual change, `qcReplay` is idempotent and
   *adds* the missing transition rather than rewriting anything. Any out-of-band release (direct repo/SQL/import)
   stays visible forever as `releasedWithoutLivePass` on the summary and as a `qc_gate_blocked` audit event.
5. Because the append is durable immediately (its own transaction) while the status is durable at the next sync
   tick (≤150 ms, `syncCore` debounce), the *evidence* is never behind the *narrative*. A crash between the two
   is exactly what boot `qcReplay()` repairs.

### 3.6 Why this table is deliberately **excluded** from the `syncCore` rebuild (R10)

`syncNow` (`src/db/syncCore.ts:64`) is a projection rebuild: `DELETE FROM <table>` + re-`INSERT` from React
state, with the case children wiped explicitly. For a **log** that is the wrong shape, so:

* `qc_events` is **not** a member of `SyncCollections`, and `syncNow` is **not modified** — the table is never
  deleted or rewritten, no matter how often the app syncs. (Precedent: `users` is already excluded from the
  collection sync for the same class of reason — its credential rows are managed exclusively by `usersRepo`.)
* `qc_events.case_id` carries **no FK** ⇒ `PRAGMA foreign_keys = ON` + `DELETE FROM cases` cannot cascade into
  it. Soft references are already the house style for exactly this: `payments.case_id`,
  `audit_events.entity_id`, `ledger_entries.reference_id`.
* Because the mirror is *derived from* the table (not the reverse), the only writer is the append. Boot order
  is `initializeDatabase()` → `hydrateAllFromDb()` (`mirrorSet('qcEvents', qcEventsRepo.all())`) → `qcReplay()`.
* `deleteCase(id)` therefore **does not** delete QC events (immutability is the point; the log records that a
  case was inspected and later removed). `qcQueue()`/`qcCase()` read through `cases`, so orphans are invisible
  in the UI; `qcEventsRepo.orphanCount()` exposes the number for diagnostics.
* The single sanctioned truncation is a full system reset (`resetToDemoData`/`wipeAllData` → `deleteAll()` plus
  `setQcEvents([])`), because the operator is explicitly discarding the database — never a per-record edit.
* Evidence attachments live in the existing `attachments` table with `entity_type = 'qc_event'`, and
  `syncNow`'s scoped wipe (`"DELETE FROM attachments WHERE entity_type = 'case'"`) does not touch them.

### 3.7 Correcting a mistaken event without mutation

Nothing in the module can `UPDATE` or `DELETE` a QC row: the repo has no such method, and the only DDL-level
write paths are `append` and `deleteAll` (system reset). The correction vocabulary is two compensating events:

| the mistake | compensating event | effect on the fold | why not "edit" |
|---|---|---|---|
| wrong verdict (clicked Pass, meant Fail) | `verdict_amended` (`supersedes = <terminal id>`, replacement verdict + reasons + `note`) | the attempt keeps its `attempt_no`/`inspection_no`; its payload comes from the amendment; `amended: true`; metrics recompute | a second verdict would look like "attempt #2", silently corrupting First-Pass QC % |
| wrong reason on a genuine fail | `verdict_amended` with the corrected `reasons[]` | same as above | keeps the reason taxonomy's trends honest |
| event belongs to another case / never happened | `event_voided` | the target leaves the effective history; the case state *falls back* to the previous live verdict (recomputed, not stored) | deleting the row would erase the fact that a human made it and an admin annulled it |
| case must ship without inspection | `release_waived` (write) / `event_voided` on the waiver (undo) | the gate opens while a live waiver exists; `qcReleaseGate` reports `code: 'waived'` so the UI can say *why* | the exception stays attributable (`note` required) |

Guard rails inside `planQcAppend` (all pure ⇒ fully unit-testable without a database):

* `QC_INSPECT_ROLES` for the four inspection facts; `QC_CORRECTION_ROLES` for `amend`/`void`/`waive`.
* A Technician cannot compensate **their own** verdict (`forbidden_role`) — the correction must come from
  Lab Admin / Super Admin, which is the boring, auditable rule.
* `amend` requires a *changed* payload and a `note`; `void` requires a `note`; `fail` requires ≥1 structured
  reason (`reason_required`, "'other' also needs a summary") — misuse is turned into an explained refusal.
* Refusals that prevent nonsense state: `already_decided` (a live verdict for this attempt exists),
  `already_passed` (a live pass exists — correct or void it, don't stack a second), `already_open` (a claim is
  live), `nothing_to_decide` (verdict with no claim and nothing to decide — impossible by construction),
  `target_not_found` / `already_superseded` (the compensation target is missing or already compensated),
  `constraint` (the DB guard fired anyway — mapped to the same friendly message).
* Because a refusal returns `ok: false, error{code,message}`, the panel can toast exactly what happened and
  offer the sanctioned next step ("Void the earlier pass?"), instead of throwing an exception into a render.

### 3.8 The plumbing nobody wants to think about

* **Notifications (R7)** — `qcNotificationDrafts` maps facts to the *existing* enum, because
  `notifications.type` is CHECK-constrained to
  `('overdue_case','pending_payment','escalation','status_change','unpaid_invoice','system')` and widening it
  would need a 12-step table rebuild: **fail ⇒ `escalation`** (priority `high`, title
  `QC FAILED — DS-1042`, message `QC-0009: margin_gap, shade_mismatch · rework opened`), **pass ⇒
  `status_change`** (`QC PASSED — DS-1042 · released by Tech Hamza`), **waive ⇒ `escalation`** (priority
  `high`, so an exception is as loud as a failure). `NotificationsView` needs no change.
* **Evidence (R8)** — `attachmentService.processFile()` (MIME allow-list, 8 MB/32 MB caps, checksum) stays the
  only validator; rows go to `attachments` with `entity_type='qc_event'`; the event stores only
  `evidence_ids[]`, so the log row remains a small, indexable fact and the `data_url`/blob lives where the repo
  already puts blobs. Uploading evidence *after* the verdict appends a small `inspection_passed`-adjacent
  `verdict_amended`-free path: it is simply a new event with the ids (evidence can only be added, never
  detached — a detached photo would be an edit; a wrong photo is voided by a compensating event).
* **Numbering** — `SEQ_KEYS.qc` + `nextNumber(tx, 'qc', 'QC')`, allocated once per attempt that gets a number
  (`inspection_opened` or the terminal event, whichever happens first), stored on the row, `UNIQUE` on
  non-null values. Waivers are unnumbered (they are not inspections).
* **Clock** — `QcPlanContext.now` is injected; every derived timestamp comes from `occurred_at`, so tests pin
  time and the vitest suite is deterministic without fake timers.
* **Printable QC summary** — `qcReviewRows(summary, caseRef)` returns label/value rows (attempt, inspector,
  date, checks, reasons, gate, waiver) so `printRenderer`'s `'qc_certificate'` kind renders from data, not from
  a bespoke query.

---

## 4. Trade-offs

### Where this shape wins

* **One truth, one writer.** Every QC fact enters through `qcAppend`; every QC answer leaves through the fold.
  There is no counter to drift, no `first_pass` column to backfill, no row whose "last write wins" semantics can
  rewrite history. Any metric can be recomputed from a cold `SELECT * FROM qc_events` and will agree exactly.
* **Corrections are first-class.** `ledger_entries`-style discipline (never edit; post a compensating entry) now
  covers quality as well as money, so "who changed the verdict, when, why" is answered by rows, not by an
  `updated_at` that merely says *something* changed.
* **Fit to a bench UI.** A technician's action is a fact ("pass", "fail + reasons"); the app decides the
  lifecycle consequences. The gate, the badge, the KPI and the certificate are four reads of one derived object.
* **Cheap reads, no N+1.** One fold per stream change, one `Map.get` per card, one memoised metric bundle for the
  whole dashboard. `AnalyticsView` windows are filters over folded data, not queries.
* **Rebuild-proof.** The boot sync cannot touch the log (not in `SyncCollections`; no FK to cascade through), and
  the projection is repaired *from* the log rather than the log from the projection.
* **Testability in this repo's style.** `qcStream.ts` is pure (no engine, no React) ⇒ `tests/services/qcStream.test.ts`
  asserts fold/refusal/idempotency without a database; `tests/db/repos.test.ts` asserts the five guards;
  `tests/db/engine.test.ts` only needs the migration list updated.

### Where it loses / what it makes hard

* **Voids leave visible holes.** A wrong `attempt_no` sequence (1, 2-voided, 3) is by design, but users who
  expect "clean history" will see the annulled slot in the timeline. Mitigation: the timeline renders voided
  events greyed with the annulment note — it is not hidden.
* **The projection can lag the evidence.** `cases.status` is durable at the next sync tick and is written by
  the mutable-state path; a crash can leave `status` behind the log until `qcReplay()`. This is the *opposite*
  trade to a "single mutable row" design, and it is the one I would defend: the security-relevant fact (the
  inspection) is never lost, while the cosmetic one (a kanban column) is re-derivable.
* **Two ways to read QC state exist** (`qcCase()` from state, `qcEventsRepo.all()` from the DB). They agree
  except in the crash window; the design names the DB as authoritative for QC and the fold as the only reader,
  so there is no second implementation to drift — but it *is* an asymmetry against the rest of the app, where
  React state is upstream of the database. It is the deliberate inversion that makes immutability survivable.
* **No SQL can answer "which cases failed QC?"** Without a projection column or table, that question is answered
  in memory by the fold. For the current data profile this is a non-issue; at scale it forces the derived
  projection table (rebuildable from the log, never hand-written) that this design deliberately does not build.
* **Log growth is unbounded** (no compaction, no archival). Every correction adds rows; at thousands of cases
  this is kilobytes, but there is no retention policy here — also deliberate: "we deleted the history to save
  space" is exactly the sentence an audit log must never produce.
* **Vocabularies are code.** `QC_FAILURE_REASONS`/`QC_CHECKS` are constants, so a new failure reason is a code
  change (and the trends of old rows keep their meaning). That is the price of the reason taxonomy being
  comparable across time; a `settings`-driven editor is a follow-up, not a rewrite.
* **More AppContext surface than a single-function design.** Five members (plus `qcReplay`) instead of one. The
  counter-argument: each member answers a *different question* (append / one case / queue / metrics / raw log),
  and they all read one derived index, so the surface is wide but shallow — one concept, six entry points.
* **Roles become load-bearing.** Correction and waiver are restricted and require notes; a two-person lab will
  hit "Technician not authorized" and must switch to the Lab Admin account. That friction is the feature.

<!-- CONTINUED -->









