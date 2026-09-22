# Design 3 — Common-Case-First: **two verbs, seven words, zero dialogs**

> **Assigned constraint:** optimise for the most common case. The dominant flow — *one technician finishes a unit,
> opens the case, and either marks it QC-passed (case advances toward delivery) or fails it for one of a few
> habitual reasons* — must be **one call**, with **zero required ceremony**, **zero mandatory free text** and
> **zero dialog chains**, and the dashboard / kanban / KPI surfaces must react with **no extra plumbing**.
> Everything else (audit detail, evidence photos, re-inspection, per-tooth findings, waivers) must be **optional
> and never in the way**.
>
> Design only. No source file was edited; no build or test was run. Snippets are ≤10 lines and contain no
> implementation bodies.

## 0. The design in one line

```
qcPass(caseId)                      // the 90% call: one argument, no dialog, no text
qcFail(caseId, 'occlusion')         // the 9% call: one argument + one word from a closed 7-word vocabulary
```

A pass **is** the release (the case advances `qc`/`in_progress`/`revision` → `ready`), a fail **is** the rework
(the case goes to `revision`, the bench is notified) — no second call, no confirmation modal, no policy object,
no checklist, no config key. Three more names exist for the remaining 1% (`qcWaive`, `qcOf`, `qcStats`), and
they are *reads* plus one guarded escape hatch; a technician can work for months without knowing two of them.

Every repo fact this design commits to (verified in source, not assumed):

| Fact | Where verified |
|---|---|
| `CaseStatus` already contains `'qc'`; the ladder is received → in_progress → qc → ready → delivered | `src/types.ts:1-9`, `src/components/cases/CaseProgressIndicator.tsx:12-18` |
| The kanban already has a "QC Quality" column; the detail panel already labels `qc` | `src/components/cases/CaseListView.tsx:37`, `CaseDetailPanel.tsx:29` |
| `updateCase(id, updates, note?)` appends a `case_status_history` row on status change and pushes a `status_change` notification for `ready`/`delivered` — nothing else does | `src/context/AppContext.tsx:1543-1588` |
| All status writes funnel through `updateCase` (drag&drop, progress ladder, status select, detail edit, calendar) | `CaseListView.tsx:142,648,668`, `CaseDetailModal.tsx:461,522`, `DashboardView.tsx:622` |
| Cases are **not** written through a repo by the UI: React state is the mirror, `syncCollectionsToDb` flushes every collection with DELETE + re-INSERT in **one** transaction | `src/context/AppContext.tsx:650-662`, `src/db/syncCore.ts:64-351` |
| Case children are wiped explicitly (cascade is not trusted) and re-inserted after their parent | `src/db/syncCore.ts:131-182` |
| `notifications.type` CHECK is a closed list that already contains `status_change` and `escalation` | `src/db/migrations.ts:418-432` |
| `attachments` is a generic `(entity_type, entity_id)` table with no FK; its sync wipe is scoped to `entity_type='case'` | `src/db/migrations.ts:464-478`, `src/db/repos.ts:610-639`, `src/db/syncCore.ts:138` |
| UI document numbers are generated in `AppContext` by scanning the in-memory collection (`DS-`, `INV-`, `ADV-`); `doc_sequences` + `nextNumberStandalone` exists for the same purpose | `AppContext.tsx:1163,1177,1207`, `src/db/sequences.ts:36-47` |
| Migration 4 already INSERTs `app_meta('schema_version','4')` — a 005 must UPDATE it, not insert again | `src/db/migrations.ts:629-634` |
| `showToast(message, type)` is the app-wide feedback channel; a toast is not a dialog | `src/context/AppContext.tsx:378,730` |

---

## 1. Interface signature

### 1.1 The vocabulary — seven words, no taxonomy

```ts
// src/types.ts — closed, CHECK-constrained in migration 005
export type QcReason =
  | 'occlusion'   // Occlusion
  | 'shade'       // Shade mismatch
  | 'margin'      // Margin fit
  | 'contact'     // Contact tightness
  | 'finish'      // Finish / polish
  | 'damage'      // Damage / defect
  | 'other';      // Other (does NOT require free text — see §4.6)

export type QcCheckCode  = Exclude<QcReason, 'other'>;   // "what was checked" (R6) reuses the same words
export type QcOutcome    = 'pass' | 'fail' | 'waived';
export type QcWaiveReason = 'client_approved' | 'cosmetic_only' | 'deadline' | 'other';
```

One vocabulary serves three jobs: the fail reason, the optional check list, and the analytics dimension
(top-N reasons is a `GROUP BY reason`, not a mapping table). Labels live in `QC_REASON_LABELS`
(`src/services/qcDomain.ts`) next to the codes — there is no settings entry, no checklist editor, no
category table, and therefore no way for two benches to describe the same defect differently.

### 1.2 The record — append-only, one row per attempt

```ts
// src/types.ts
export interface QcInspection {
  id: string;                    // genId('qc')
  inspection_no: string;         // 'QC-0007' — nextNumberStandalone(SEQ_KEYS.qc, 'QC')
  case_id: string;               // FK → cases(id) ON DELETE CASCADE
  case_number: string;           // denormalised: label, notification and stats without a join
  attempt: number;               // 1-based per case; UNIQUE(case_id, attempt)
  outcome: QcOutcome;
  reason?: QcReason;             // present iff outcome !== 'pass'
  inspector: string;             // user.name
  inspector_role: UserProfile['role'];
  inspected_at: string;          // 'YYYY-MM-DD HH:MM' — the house timestamp format
  location?: string;             // "Bench 3" | "QC station"                 (optional, R6)
  notes?: string;                // optional free text — never mandatory     (R2)
  checked?: QcCheckCode[];       // optional; defaults to "all"              (R6)
  teeth?: number[];              // optional; only when the defect is local  (optional elaboration)
}
```

There is exactly **one** new domain record type. No `QcFinding`, no `QcChecklist`, no `QcPolicy`,
no `QcWaiver`, no `QcMetricRow`.


### 1.3 The caller surface — five names, two of them hot

```ts
// src/context/AppContext.tsx — added to AppContextType (components reach them via useApp())

// ── the verbs ───────────────────────────────────────────────────────────────────────────────
qcPass:  (caseId: string, detail?: QcDetail) => QcResult;                       // R1 — THE dominant call
qcFail:  (caseId: string, reason: QcReason, detail?: QcDetail) => QcResult;     // R2 — one reason word
qcWaive: (caseId: string, reason: QcWaiveReason, detail?: QcDetail) => QcResult; // Lab Admin | Super Admin

// ── the reads ───────────────────────────────────────────────────────────────────────────────
qcOf:    (caseId: string) => QcCaseState;        // one case: attempts, first-pass, block, history
qcStats: (options?: QcStatsOptions) => QcStats;  // whole lab: KPI numbers + top reasons + trend
```

```ts
// everything the caller MAY add — every field optional, nothing is required to pass or fail
export interface QcDetail {
  notes?: string;
  location?: string;
  checked?: QcCheckCode[];
  teeth?: number[];
  photos?: QcPhoto[];          // → attachments(entity_type='qc_inspection')     (R8)
  at?: string;                 // back-dated entry; defaults to now
}
export interface QcPhoto { filename: string; mime_type: string; data_url: string; size_bytes?: number; }

// what the verb decided — toast-ready; ignoring it is legal and common
export type QcResultCode =
  | 'RECORDED'          // written; caseStatus tells you where the case landed
  | 'DUPLICATE'         // the same case was just submitted twice (double-click guard)
  | 'ALREADY_RELEASED'  // case is ready/delivered — reopen it before re-inspecting
  | 'WRONG_STAGE'       // draft/received/cancelled are not inspectable
  | 'FORBIDDEN'         // role may not inspect / may not waive
  | 'NO_SUCH_CASE';

export interface QcResult {
  ok: boolean;
  code: QcResultCode;
  message: string;            // one user-facing sentence, e.g. "DS-0007 passed QC by Ayesha (QC-0012)"
  inspection?: QcInspection;  // the row, when one was written
  attempt?: number;
  caseStatus?: CaseStatus;    // 'ready' | 'revision' | unchanged
}
```

```ts
// src/types.ts — the per-case read (memoised inside AppContext; safe to call from every kanban card)
export interface QcCaseState {
  caseId: string;
  attempts: number;                    // total inspection records
  firstPass: boolean;                  // attempt 1 exists AND its outcome is 'pass'      (R4)
  lastOutcome?: QcOutcome;
  lastReason?: QcReason;
  lastInspector?: string;
  lastAt?: string;
  released: boolean;                   // case status ∈ ready|delivered WITH a pass/waive
  blocked: boolean;                    // case may NOT move to ready right now             (R3)
  blockReason?: string;                // the sentence to show on a disabled "Move to Ready"
  canInspect: boolean;                 // role + current status allow the verbs
  inspections: QcInspection[];         // newest first — the optional history panel        (R6)
}

export interface QcStatsOptions {
  from?: string; to?: string;          // 'YYYY-MM-DD' lexicographic range on inspected_at
  inspector?: string;
  topN?: number;                       // default 5
  trend?: 'week' | 'month' | 'none';   // default 'none' — do not compute what nobody asked for
}

export interface QcStats {
  inspected: number;                   // distinct cases with ≥1 record in range
  records: number;
  firstPassRate: number | null;        // 0..1, null when inspected === 0 (same honesty as "—" today)  (R5)
  reworkRate: number | null;           // cases with ≥1 fail ÷ inspected
  avgReworkHours: number | null;       // mean(first fail → next pass)
  topReasons: Array<{ reason: QcReason; count: number }>;
  byInspector: Array<{ inspector: string; pass: number; fail: number; firstPassRate: number | null }>;

### 1.4 The rules — five lines of policy, hard-coded, zero configuration

1. **Who may inspect:** `Technician`, `Lab Admin`, `Super Admin`. `Billing Manager` → `FORBIDDEN`.
   **Who may waive:** `Lab Admin`, `Super Admin` only.
2. **Inspectable statuses:** `in_progress`, `qc`, `revision`. (A technician who just finished a unit does **not**
   have to drag it into the QC lane first — §4.5 owns the cost of this decision.)
3. **Pass → `ready`.** **Fail → `revision`** + an `escalation` notification (priority `high`).
   **Waive → `ready`**, recorded as `waived` and **never** counted as a first pass (§4.7).
4. **Gate (R3):** `updateCase(..., { status: 'ready' })` is refused — no status write, no history row, one toast —
   **iff the case has QC records and the latest one is a `fail`**. A case with no QC records at all is unaffected
   (grandfathered); it is counted in `QcStats.uncovered` instead of being blocked.
5. **Numbering:** `attempt = 1 + count(records for case)`; `firstPass = attempt 1 outcome === 'pass'`.

### 1.5 Storage shape — one table, three constraints, two indexes

```sql
-- src/db/migrations.ts — MIGRATION_005_QC_INSPECTIONS (version: 5, name: 'qc_inspections')
-- appended to MIGRATIONS; must UPDATE app_meta('schema_version') (a second INSERT would abort on the PK).
CREATE TABLE qc_inspections (
  id             TEXT PRIMARY KEY,
  inspection_no  TEXT NOT NULL UNIQUE,                 -- 'QC-0001' (SEQ_KEYS.qc, prefix 'QC')
  case_id        TEXT NOT NULL,
  case_number    TEXT NOT NULL,
  attempt        INTEGER NOT NULL CHECK (attempt >= 1),
  outcome        TEXT NOT NULL CHECK (outcome IN ('pass','fail','waived')),
  reason         TEXT CHECK (reason IN ('occlusion','shade','margin','contact','finish','damage','other')),
  inspector      TEXT NOT NULL,
  inspector_role TEXT NOT NULL CHECK (inspector_role IN ('Super Admin','Lab Admin','Technician','Billing Manager')),
  inspected_at   TEXT NOT NULL,
  location       TEXT,

---

## 2. Usage examples

All snippets are the complete call site (≤10 lines) and contain no implementation.

### 2.1 The bench, pass — the whole feature in one line (CaseDetailModal / CaseDetailPanel)

```tsx
const { qcPass, showToast } = useApp();

<button onClick={() => { const r = qcPass(caseData.id); showToast(r.message, r.ok ? 'success' : 'warning'); }}
        className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg">
  <CheckCircle2 className="w-3.5 h-3.5" /> Pass QC
</button>
```

The case leaves the QC lane for `ready`, a `case_status_history` row is appended and the existing `status_change`
notification fires — all from one call, with no second `updateCase` and no dialog.

### 2.2 The bench, fail — reason = one chip tap, no modal, no text

```tsx
const { qcFail, showToast } = useApp();
const [chipsOpen, setChipsOpen] = useState(false);

<button onClick={() => setChipsOpen(true)} className="px-3 py-1.5 bg-rose-600 text-white text-xs font-bold rounded-lg">
  <XCircle className="w-3.5 h-3.5" /> Fail QC
</button>
{chipsOpen && QC_REASON_CODES.map((r) => (
  <button key={r} onClick={() => { const res = qcFail(caseData.id, r); showToast(res.message, 'warning'); setChipsOpen(false); }}>
    {QC_REASON_LABELS[r]}
  </button>
))}
```

`qcFail(id, 'occlusion')` is legal, complete and stops right there. `reason` is positional and required by the
type system, so a fail can never be recorded without a cause and a pass can never be recorded with one.

### 2.3 Everything else is one optional object (never in the way)

```tsx
qcFail(case.id, 'margin', { teeth: [26], notes: 'Distal margin open, 0.2 mm', location: 'Bench 3',
                            checked: ['margin', 'contact'], photos: await readCasePhotos(files) });
```

Notes, teeth, station, check list and photos are all optional; passing `undefined` (or nothing) is the norm.
`qcPass(case.id, { notes: '…' })` is also legal but nobody is ever asked for it.

### 2.4 Dashboard KPI — replace the hardcoded `—` (DashboardView.tsx:570-573)

```tsx
const { qcStats } = useApp();
const qc = qcStats({ from: monthStartISO() });          // memoised on (qcInspections, cases)
…
<span className="text-[10px] text-slate-400 uppercase block">First-Pass QC</span>
<span className="font-bold text-emerald-600">
  {qc.firstPassRate === null ? '—' : `${Math.round(qc.firstPassRate * 100)}%`}
</span>
```

Two changed lines inside the existing benchmark block (`:553-579`), one new `useApp()` destructure. No new state,
no new effect, no refresh call: `qcStats` recomputes because the QC collection is part of the context that the
dashboard already re-renders on.

### 2.5 Kanban — the QC column and the attempt badge (CaseListView.tsx)

```tsx
const qc = qcOf(c.id);                                   // memoised; safe per card
{qc.attempts > 0 && (
  <span title={qc.blockReason ?? `Attempt ${qc.attempts} by ${qc.lastInspector}`}
        className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
          qc.lastOutcome === 'pass' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
    {qc.lastOutcome === 'pass' ? `QC ✓` : `QC ✗ ${QC_REASON_LABELS[qc.lastReason ?? 'other']}`}
  </span>
)}
```

The "QC Quality" column itself needs no change — it is still `cases.filter(c => c.status === 'qc')`.

### 2.6 The gate at the release button (no signature change anywhere)

```tsx
const { qcOf, showToast } = useApp();
const qc = qcOf(c.id);


---

## 3. What it hides internally

A caller who writes `qcFail(id, 'occlusion')` never sees any of the following — that is the entire point of the
design, and the reason the caller surface is five names instead of five objects.

| Hidden behind the two verbs | Why it has to exist | Where it lives |
|---|---|---|
| Attempt numbering (`1 + count`), and the fact that a re-inspection is *unremarkable* — no "open a new inspection cycle" step | R4 first-pass = attempt 1 | `qcDomain` pure rule + `UNIQUE(case_id, attempt)` |
| The lifecycle transition: `qc`/`in_progress`/`revision` → `ready` (pass) or → `revision` (fail), plus the `case_status_history` row | R2/R3/R6 | delegated to the existing `updateCase` (one internal call) |
| Notification fan-out: pass reuses the existing `status_change` path for `ready`; fail prepends one `escalation` row with `priority: 'high'` | R7 without a new notification type or a NotificationsView change | `updateCase` + one `setNotifications` line |
| `inspection_no` allocation (`QC-0007`) via `doc_sequences` | house numbering idiom | `nextNumberStandalone(SEQ_KEYS.qc, 'QC')` |
| The double-click guard: a synchronous per-case write latch plus a read of the case's last record | `UNIQUE(case_id, attempt)` is the last line of defence, but a violated constraint aborts the *whole* collection flush (every table, not just QC) — so the guard must fire before the write | AppContext verb shell |
| Memoisation of `qcOf` (per case id) and `qcStats` (per `(inspections, cases, options)`) | Makes per-card and per-render calls free; callers cannot tell it is memoised | selector closures in AppContext |
| The gate's *conditional* existence (legacy cases with zero QC records are not blocked) and the `uncovered` counter | Prevents a greenfield module from blocking 100% of the existing backlog on day one | `updateCase` guard + `qcStats` |
| The sync contract: QC rows deleted/re-inserted inside the cases block, orphan rows skipped, evidence attachments scoped to `entity_type='qc_inspection'` | R10 — otherwise the next boot sync wipes the QC log, or a stale row aborts the flush on FK | `syncCore.ts` |
| First-pass, rework rate, mean rework hours, top-N reasons, per-inspector counters | R5 | pure fold in `qcDomain`; no stored aggregates, nothing to backfill |

---

## 4. Trade-offs — what this shape wins, loses, and makes hard

### 4.1 Where it wins

* **The dominant path is a sentence.** `qcPass(id)` / `qcFail(id, 'occlusion')` — 2 taps for a pass, 3 for a fail
  (Fail chip → reason chip). No confirmation modal, no reason text box, no "check all that apply" list, no mandatory
  station, no policy object. Compared with a single `qc({op:'inspect', …})` command, the call site needs no
  discriminant to be read correctly.
* **One vocabulary, three jobs.** The same seven codes are the fail reason, the optional check list and the
  analytics dimension — R6 and the top-N half of R5 come for free, and the chart is stable from day one.
* **The DB enforces the one rule that matters.** `CHECK ((outcome='pass' AND reason IS NULL) OR (outcome<>'pass'
  AND reason IS NOT NULL))` makes "failure without cause" and "pass with a cause" unrepresentable, not merely
  discouraged.
* **Zero plumbing, verifiably.** The QC collection is a member of `SyncCollections`; dashboard, kanban and KPI change
  by ≤3 lines each (§2.4, §2.5) because they read context state that already re-renders. The gate is one `if` inside
  an existing function with **no** call-site edit, and notifications re-use one existing type.
* **Everything extra is reachable but invisible.** Photos, notes, teeth, checks, per-case history and whole-lab
  metrics live in `QcDetail` / `qcOf().inspections` / `qcStats()` — three optional doors, none on the hot path.

### 4.2 What it sacrifices — quantified

| # | Sacrifice | Cost, concretely |
|---|---|---|
| 1 | **No depth per failure**: one reason code per failed attempt; no severity, no per-tooth finding, no joint causes | Top-N is a ≤7-row table; "margin **and** shade on tooth 26" cannot be queried. Retrofittable additively (optional `findings_json` column or child table) **without changing the two verbs**, because attempt/outcome/reason are already normalised |
| 2 | **The 7 words are baked into a SQL `CHECK`** — SQLite cannot `ALTER` a CHECK | Adding an 8th habitual reason later costs a table-rebuild migration (create/copy/drop/rename + index rebuild, ~35 lines) plus one union member and one label: ~30–60 min of work, and a full scan of the QC log (sub-second at 20k rows, a second or two at 500k). Rejected alternative — a shape-only CHECK with TS validation — is cheaper to extend but lets a bad code in through backup restore |
| 3 | **The gate is conditional on adoption** — "QC is the only way *through* QC", not a lock on the lifecycle | On upgrade day coverage is 0% of the backlog, so a never-inspected case can still be dragged to `ready`; what *is* hard-blocked is the real bypass (latest record is `fail`). `QcStats.uncovered` makes the gap visible instead of hiding it. A hard lock instead would block 100% of existing cases at their next delivery — and produce exactly the fabricated passes this module exists to prevent |
| 4 | **No quorum / no second signature / no approval chain** | One tap by any Technician releases a case: an enforced control is replaced by one statistical signal (per-inspector first-pass rate). A lab requiring two-person sign-off for implant work cannot have it here |
| 5 | **Waivers intentionally skew the headline KPI** | `waived` is excluded from the first-pass numerator and reported separately; at a realistic 1–3% waiver rate the KPI reads 1–3 points lower than a "pass-or-waived" definition — deliberately, so the number cannot be improved by waiving more |
| 6 | **`qcPass` accepts `in_progress`** (no drag into the QC lane required) | Gives up "the case physically sat in QC" as evidence and the `time-in-QC` metric (~1 metric), and makes the kanban QC column advisory rather than a state-machine step. Kept because requiring the drag adds one mandatory gesture to the 90% path to protect a number nobody displays today |
| 7 | **All metrics are computed in memory**, folded on every change | `qcStats` is O(records) per recompute: sub-millisecond at ~80 inspections/day (~20k/year). At ~500k rows (~25 years, or a multi-station lab) the dashboard fold reaches tens of milliseconds and the DELETE+re-INSERT of the QC table becomes the slowest part of a sync. Beyond that you need SQL aggregation (`GROUP BY reason`) — deliberately not offered, since it would be a second interface over the same facts |
| 8 | **No lab-wide QC log screen** | `qcOf(case)` gives per-case history; there is no "browse all inspections" view, no export, no pagination. A read-only table over `qcInspectionsRepo.all()` is later, additive work |
| 9 | **`qcFail` reuses `revision`** | The rose "Revisions" tile and the urgent banner (`DashboardView.tsx:183`, `InteractiveDeliveryCalendar.tsx:103`) now also fire for internal QC failures, so that tile's meaning widens by the QC failure rate; disambiguation requires `qcOf().lastReason`. A dedicated `qc_failed` status would fix it, but is forbidden — existing statuses must not be redesigned |
| 10 | **Single-writer, no merge** | Two installations of the desktop app never reconcile QC logs — an unchanged app-level limitation that QC simply makes more visible |

| Role checks and the waive permission | R6/R3 who-may rules | `qcDomain` + verb shell |

Two things the module deliberately does **not** hide, because hiding them would be dishonest: a refused call returns
a `QcResult` with a plain-language `message` (never a silent no-op), and every pass/fail leaves exactly one new row
in `qc_inspections` plus its `case_status_history` entry — the audit trail *is* the module, not a side effect.

<button disabled={qc.blocked} title={qc.blockReason}
        onClick={() => updateCase(c.id, { status: 'ready' })}>Move to Ready</button>
```

`updateCase` keeps its exact signature and does the refusing itself (rule §1.4-4), so the kanban drag
(`CaseListView.tsx:142`), the progress ladder (`:648,828`), the status select (`:668`), the detail edit
(`CaseDetailModal.tsx:461,522`) and the delivery calendar (`DashboardView.tsx:622`) are all gated without a single
call-site edit — the gate is one `if` at the top of the existing function, and its message goes straight to
`showToast`.

### 2.7 Metrics beyond the dashboard — AnalyticsView, print, tests

```tsx
const { qcStats } = useApp();
const q = qcStats({ from: '2026-01-01', to: '2026-06-30', trend: 'month', topN: 3 });

<BarChart data={q.trend.map((t) => ({ x: t.bucket, y: (t.firstPassRate ?? 0) * 100 }))} />
<TopReasons rows={q.topReasons.map((r) => ({ label: QC_REASON_LABELS[r.reason], count: r.count }))} />
```

The same call serves `PrintStudioView` (a new `documentKind: 'qc_label'` reads `qcOf(case.id)` and prints
`inspection_no`, inspector, verdict and date through `printRenderer.tsx`) and AnalyticsView, with no more module
surface. Service-level tests call the pure functions directly and need no engine:

```ts
import { qcStatsFrom, qcCaseStateFrom } from '../../src/services/qcDomain';
expect(qcStatsFrom({ inspections, cases, now: '2026-06-30' }).firstPassRate).toBeCloseTo(0.8);
expect(qcCaseStateFrom(inspections, { id: 'c1', status: 'ready' }).blocked).toBe(true);
```

  notes          TEXT,
  checked_json   TEXT,                                 -- optional JSON: ["margin","shade"]
  teeth_json     TEXT,                                 -- optional JSON: [26,27]
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  UNIQUE (case_id, attempt),                           -- the anti-double-pass guard, at rest
  CHECK ((outcome =  'pass' AND reason IS NULL)
      OR (outcome <> 'pass' AND reason IS NOT NULL))   -- R2 enforced by the DB, not by the UI
);
CREATE INDEX idx_qc_case ON qc_inspections (case_id, attempt DESC);
CREATE INDEX idx_qc_at   ON qc_inspections (inspected_at);
```

**Write path.** QC rows never bypass the app's existing cutover idiom. `qcInspections: QcInspection[]` becomes a
React-state collection in `AppContext` (hydrated at boot with `mirrorSet('qcInspections', qcInspectionsRepo.all())`),
is added to `SyncCollections`, and is deleted + re-inserted **inside the cases block of `syncNow`** — right beside
`case_status_history` (`syncCore.ts:131-182`), after the parents are re-inserted, skipping any row whose case is no
longer in the snapshot. Consequently:

* R10 holds for free — the QC log is rebuilt from state exactly like every other collection;
* the QC row and the case's new status land in **one** `db.withTransaction` (they are two fields of one flush), so
  the observable failure mode is "the last <150 ms of work is lost as a unit" — never a half-written inspection;
* `qcInspectionsRepo` stays **read-only** (`all()`, `byCase(id)`, `count()`) because writing through it would create
  a second source of truth — the same reason `AppContext` never calls `casesRepo.update` for a status change.

**Evidence (R8)** goes through the existing `attachmentsRepo.insert({ entity_type: 'qc_inspection',
entity_id: <inspection id>, … })` and back out via `attachmentsRepo.byEntity('qc_inspection', id)`.
`syncCore`'s attachment wipe is scoped to `entity_type='case'` (`syncCore.ts:138`), so QC photos survive every
rebuild; `deleteCase` must additionally drop `attachments` for that case's inspections and the QC rows themselves.

  waived: number;
  uncovered: number;                   // released cases with ZERO QC records — the honest adoption gap
  trend: Array<{ bucket: string; inspected: number; firstPassRate: number | null }>;  // [] when 'none'
}
```
