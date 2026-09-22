# QC Module — Design 2: Maximum Flexibility

**Constraint honoured:** generalise deliberately so that a configurable checklist per restoration/case
type, per-tooth **and** per-unit findings, multiple inspectors with quorum, authorised waivers,
re-inspection cycles with distinct failure categories, partial passes and future quality programs are
all *data or policy*, not *code*. Every axis below is justified in §4 against a numbered requirement
or a named near-future need, and §4 also names the five places where more generality would actively
hurt the module.

Verified repo facts this design commits to (from `REQUIREMENTS-BRIEF.md` + source):

| Fact | Where verified |
|---|---|
| `CaseStatus` already contains `'qc'`; kanban column "QC Quality" exists | `src/types.ts:5`, `src/components/cases/CaseListView.tsx:37` |
| `case_status_history` `{id, case_id, status, notes, timestamp, updated_by}` is the only trace | `src/db/migrations.ts:180` |
| `attachments` is `{entity_type, entity_id, …}` with **no FK** — a generic evidence table | `src/db/migrations.ts:464`, `src/db/repos.ts:610` |
| `PRAGMA foreign_keys = ON`; `syncNow` does `DELETE FROM cases` inside one transaction | `src/db/engine.ts:63`, `src/db/syncCore.ts:132` |
| `payments.case_id`, `ledger_entries.reference_id`, `audit_events.entity_id` are **soft** cross-table refs | `src/db/migrations.ts:251,594,450` |
| `users` is deliberately excluded from the collection rebuild | `src/db/syncCore.ts:10-12` |
| Notifications CHECK is a closed list (`overdue_case`,`pending_payment`,`escalation`,`status_change`,`unpaid_invoice`,`system`) | `src/db/migrations.ts:420` |
| `settings(namespace,key,value)` upsert = the config store; `clinicalSpecsService` seeds defaults on a fresh DB | `src/db/repos.ts:1555`, `src/services/clinicalSpecsService.ts:118` |
| Dashboard prints `—` for QC today rather than a fabricated 0 | `src/components/dashboard/DashboardView.tsx:571-572` |

---

## 1. Interface signature

### 1.1 Vocabulary — closed enums vs open taxonomies (the governing rule)

**Rule:** *anything the code branches on is a closed enum with a SQL `CHECK`; anything the lab names
is open `TEXT`, validated at write time against configuration.* This is what stops flexibility from
degenerating into untyped string soup.

```ts
// src/types.ts — closed (CHECK-constrained in migration 005)
export type QcOutcome          = 'pass' | 'pass_with_notes' | 'fail' | 'abandoned';
export type QcFindingScope     = 'case' | 'tooth' | 'unit';
export type QcSeverity         = 'advisory' | 'minor' | 'blocking';
export type QcDisposition      = 'no_action' | 'adjust' | 'redo' | 'remake' | 'waive_requested' | 'accepted_as_is';
export type QcInspectionKind   = 'initial' | 'reinspection' | 'spot_check' | 'post_delivery';
export type QcInspectionStatus = 'open' | 'awaiting_signoff' | 'decided' | 'voided';

// open TEXT, validated by qcDomain against QcPolicy / QcChecklist:
//   program · checklist item key · finding.category · waiver.reason_code
//   finding.scope_ref · inspection.workstation
```

### 1.2 Configuration types (`src/types.ts`)

```ts
export interface QcChecklistItem {
  key: string;                          // stable id referenced by checks/findings, e.g. 'margin_fit'
  label: string;
  hint?: string;
  scope: QcFindingScope;                // default granularity when this item fails
  required: boolean;                    // participates in the coverage rule
  severity_on_fail: QcSeverity;         // 'advisory' ⇒ a fail here yields pass_with_notes
  default_category?: string;            // failure-category code from QcPolicy.failure_categories
  evidence?: 'none' | 'optional' | 'required';    // uses the existing attachments table (R8)
  applies_to?: { prep_types?: string[]; scopes?: QcFindingScope[] };  // item-level narrowing
}

export interface QcChecklist {
  id: string;                           // 'qc-crown_bridge' | 'qc-denture' | 'qc-aligner' | 'qc-universal'
  program: string;                      // 'production_qc' (default); future 'calibration' | 'warranty_claim'
  name: string;
  version: number;                      // monotonic; bumped on any items edit
  status: 'draft' | 'active' | 'retired';
  applies_to: {
    case_type_ids?: string[];            // DentalCase.case_type_id
    categories?: CaseType['category'][]; // 'crown_bridge'|'implant'|'denture'|'orthodontic'|'veneers'
    materials?: string[];
    priorities?: PriorityLevel[];
  };
  items: QcChecklistItem[];
  created_at: string; created_by: string; updated_at?: string;
}

export interface QcFailureCategory {      // config-driven taxonomy (not a fixed union)
  code: string;                           // open key, e.g. 'shade_mismatch'
  label: string;
  parent_code?: string;                   // one optional grouping level — no arbitrary trees
  severity: QcSeverity;
  default_disposition: QcDisposition;
  rework_role?: UserProfile['role'];
  is_active: boolean;
}

export interface QcApprovalRule {         // resolved onto each inspection at creation
  kind: 'any_one' | 'all_of' | 'quorum' | 'role_quorum';
  required: number;                       // 1 for any_one
  role?: UserProfile['role'];             // for role_quorum
}

export interface QcPolicy {               // settings('qc','policy'); every field ships with a default
  program: string;                        // 'production_qc'
  inspect_roles: UserProfile['role'][];   // who may record an inspection
  waive_roles: UserProfile['role'][];     // who may waive / override
  approval: QcApprovalRule;               // default { kind: 'any_one', required: 1 }
  gate: {
    required_for: CaseStatus[];           // default ['ready', 'delivered']
    allow_pass_with_notes: boolean;       // default true
    allow_waiver: boolean;                // default true
    require_all_required_items: boolean;  // default true
  };
  failure_categories: QcFailureCategory[];
  first_pass_includes_notes: boolean;     // default true (§1.6)
  default_checklist_id: string;           // 'qc-universal'
}
```


### 1.3 Record types (`src/types.ts`) — append-only

```ts
export interface QcFinding {
  id: string;
  inspection_id: string;
  case_id: string;                      // soft reference — §4.1 (A10) explains why there is no FK
  item_key?: string;                    // which checklist item raised it
  scope: QcFindingScope;
  scope_ref?: string;                   // open: '21' | 'unit_3' | 'stage_5' | 'upper' | 'smile_line'
  tooth_number?: number;                // FDI 11..48; required iff scope === 'tooth'
  category: string;                     // failure-category code ('other' always legal, requires note)
  severity: QcSeverity;
  disposition: QcDisposition;
  note?: string;
  evidence_attachment_ids?: string[];   // rows in the existing `attachments` table (R8)
  raised_by: string; created_at: string;
  resolved_at?: string; resolved_by?: string; resolution_note?: string;
}

export interface QcSignoff {
  id: string; inspection_id: string;
  inspector: string;                    // user.name
  role: UserProfile['role'];
  authority: 'inspector' | 'approver';
  decision: 'approve' | 'reject';
  note?: string; signed_at: string;
}

export interface QcInspection {
  id: string;
  inspection_number: string;            // 'QC-0001' via doc_sequences (SEQ_KEYS.qc, prefix 'QC')
  case_id: string; case_number: string; // soft references
  program: string;
  kind: QcInspectionKind;
  cycle: number;                        // 1 = first inspection of this case+program (R4)
  workstation?: string;                 // R6 "where"

  checklist_id: string;
  checklist_version: number;
  checklist_snapshot: QcChecklist;      // frozen copy ⇒ R6/R10: audit survives config churn

  checks: { item_key: string; result: 'ok' | 'issue' | 'na'; note?: string }[];

  status: QcInspectionStatus;
  outcome?: QcOutcome;                  // set when decided
  summary?: string;

  approval_rule: QcApprovalRule;        // resolved at creation from policy + checklist
  signoffs: QcSignoff[];

  started_at: string; started_by: string;
  decided_at?: string; decided_by?: string;
  waivers_applied: string[];            // QcWaiver ids
  voided_reason?: string;
  created_at: string; updated_at?: string;
}

export interface QcWaiver {
  id: string; case_id: string;
  target: 'finding' | 'inspection' | 'gate';
  target_id?: string;
  gate_status?: Extract<CaseStatus, 'ready' | 'delivered'>;
  reason_code: string;                  // open taxonomy ('client_approved_cosmetic', 'tool_unavailable', …)
  reason_text: string;                  // mandatory free text (R2/R6)
  authorised_by: string;
  authorised_role: UserProfile['role'];
  created_at: string;
  revoked_at?: string; revoked_by?: string; revoke_reason?: string;
}
```

### 1.4 Write input / result types (`src/types.ts`)

```ts
export interface QcInspectionInput {
  case_id: string;
  program?: string;                     // default policy.program
  kind?: QcInspectionKind;              // default: cycle === 1 ? 'initial' : 'reinspection'
  workstation?: string;
  checks?: { item_key: string; result: 'ok' | 'issue' | 'na'; note?: string }[];
  findings?: Array<Omit<QcFinding, 'id' | 'inspection_id' | 'case_id' | 'created_at' | 'raised_by'>>;
  outcome?: QcOutcome;                  // optional override; qcDomain derives it when omitted
  summary?: string;
  approve?: boolean;                    // default true → also signs off (single-inspector flow)
  attachment_ids?: string[];            // evidence for the inspection as a whole (R8)
}

export type QcRecordResult =
  | { ok: true;  inspection: QcInspection; gate: QcGateDecision }
  | { ok: false; error: QcError };

export type QcErrorCode =
  | 'CASE_NOT_FOUND' | 'CHECKLIST_INCOMPLETE' | 'CYCLE_ALREADY_DECIDED' | 'NOT_AUTHORISED'
  | 'UNKNOWN_CATEGORY' | 'INVALID_FINDING_SCOPE' | 'EVIDENCE_REQUIRED'
  | 'QUORUM_PENDING' | 'WAIVER_NOT_PERMITTED' | 'NOT_DB_READY';

export class QcError extends Error {
  constructor(message: string, public readonly code: QcErrorCode) { super(message); this.name = 'QcError'; }
}

export interface QcWaiverInput {
  case_id: string;
  target: QcWaiver['target'];
  target_id?: string;
  gate_status?: QcWaiver['gate_status'];
  reason_code: string;
  reason_text: string;
}

export interface QcGateDecision {
  allowed: boolean;
  blocked_by?: 'no_inspection' | 'checklist_incomplete' | 'failed' | 'awaiting_quorum'
             | 'blocking_findings' | 'not_required';
  message: string;                      // ready to render in a toast / tooltip
  waiver_id?: string;                   // set when a waiver authorised the transition
  inspection_id?: string;
}

export interface QcCaseSummary {
  case_id: string;
  state: 'not_inspected' | 'open' | 'awaiting_signoff' | 'passed' | 'passed_with_notes'
       | 'failed' | 'waived';
  cycles: number;
  first_pass: boolean;                  // decided cycle-1 verdict was a pass (see §1.6)
  last_inspection?: QcInspection;
  open_findings: QcFinding[];
  checklist?: QcChecklist;               // resolved for this case type (bench UI)
  gate: QcGateDecision;                  // gate at the case's *next* natural step
}
```


### 1.5 Repository signatures (`src/db/repos.ts`)

Reads are per-table (repo idiom); **all writes go through one aggregate writer** so an inspection and
its findings can never be half-written.

```ts
export const qcChecklistsRepo = {
  all(): QcChecklist[];
  byId(id: string): QcChecklist | undefined;
  byProgram(program: string): QcChecklist[];
  upsert(c: QcChecklist): QcChecklist;               // bumps version when items/applies_to change
};

export const qcInspectionsRepo = {
  all(): QcInspection[];
  byId(id: string): QcInspection | undefined;
  byCase(caseId: string): QcInspection[];            // ordered by cycle ASC
  byCaseProgram(caseId: string, program: string): QcInspection[];
  byCycle(caseId: string, program: string, cycle: number): QcInspection | undefined;
  decided(): QcInspection[];                         // metrics input
  nextCycle(caseId: string, program: string): number; // MAX(cycle)+1, 1 when none
};

export const qcFindingsRepo = {
  all(): QcFinding[];
  byCase(caseId: string): QcFinding[];
  byInspection(inspectionId: string): QcFinding[];
  open(): QcFinding[];                               // resolved_at IS NULL
};

export const qcWaiversRepo = {
  all(): QcWaiver[];
  byCase(caseId: string): QcWaiver[];
  active(caseId: string): QcWaiver[];                // revoked_at IS NULL
};

/** The single transactional writer: one withTransaction covers
 *  inspection + findings + sequence number + audit event.                    */
export const qcRepo = {
  recordInspection(input: QcInspectionInput, ctx: QcActorContext): QcRecordResult;
  sign(inspectionId: string, decision: QcSignoff['decision'], note: string | undefined, ctx: QcActorContext): QcRecordResult;
  applyWaiver(input: QcWaiverInput, ctx: QcActorContext): { ok: true; waiver: QcWaiver } | { ok: false; error: QcError };
  revokeWaiver(waiverId: string, reason: string, ctx: QcActorContext): void;
  resolveFinding(findingId: string, disposition: QcDisposition, note: string | undefined, ctx: QcActorContext): void;
  deleteForCase(caseId: string): void;               // called from AppContext.deleteCase only
};

export interface QcActorContext {                    // one object, not four loose params
  actor: string;                                     // user.name
  role: UserProfile['role'];
  now?: string;                                      // injectable clock ⇒ deterministic tests
  policy: QcPolicy;
  checklists: QcChecklist[];
}
```


### 1.6 Pure domain service (`src/services/qcDomain.ts`) — storage-agnostic

Sibling of `financeDomain.ts` / `prioritySla.ts`: pure functions over plain data, no engine, unit
tested in `tests/services/qcDomain.test.ts`.

```ts
export const DEFAULT_QC_POLICY: QcPolicy;
export const DEFAULT_QC_CHECKLISTS: QcChecklist[];   // universal + crown_bridge + denture + aligner
export const QC_CATEGORY_CODES: string[];            // derived from a policy's taxonomy

export function resolveChecklist(
  caseLike: Pick<DentalCase, 'case_type_id' | 'case_type_name' | 'material' | 'priority' | 'selected_teeth'>,
  checklists: QcChecklist[], policy: QcPolicy): QcChecklist;               // never undefined

export function checklistCoverage(checklist: QcChecklist, checks: QcInspection['checks'])
  : { required_total: number; required_answered: number; missing: string[]; complete: boolean };

export function evaluateOutcome(
  checklist: QcChecklist, checks: QcInspection['checks'], findings: QcFinding[],
  policy: QcPolicy): QcOutcome;                       // pass | pass_with_notes | fail  (partial pass)

export function resolveApprovalRule(
  policy: QcPolicy, checklist: QcChecklist,
  ctx?: { caseUnits?: number; caseLike?: Partial<DentalCase> }): QcApprovalRule;

export function quorumSatisfied(inspection: QcInspection): boolean;
export function pendingSignoffs(inspection: QcInspection): number;

export function summarizeCase(
  c: DentalCase, inspections: QcInspection[], findings: QcFinding[], waivers: QcWaiver[],
  policy: QcPolicy): QcCaseSummary;

export function gateCheck(
  c: DentalCase, to: CaseStatus, summary: QcCaseSummary, waivers: QcWaiver[],
  policy: QcPolicy): QcGateDecision;

export function canWaive(policy: QcPolicy, actor: Pick<UserProfile, 'role' | 'isSuperAdmin'>): boolean;
export function validateFindings(findings: QcFinding[], policy: QcPolicy)
  : { valid: boolean; errors: { index: number; code: QcErrorCode; message: string }[] };

export function scopeLabel(f: QcFinding): string;     // 'Tooth 21' | 'Unit 3 · lower' | 'Case'
export function qcQueue(cases: DentalCase[], inspections: QcInspection[], policy: QcPolicy): DentalCase[];
export function qcNotificationDrafts(
  inspection: QcInspection, c: DentalCase, findings: QcFinding[]
): Omit<AppNotification, 'id' | 'created_at'>[];      // R7 mapping lives in exactly one place

export interface QcMetricsOptions {
  from?: string; to?: string;                         // inclusive YYYY-MM-DD (AnalyticsView trend)
  program?: string; case_type_id?: string; inspector?: string;
  top_n?: number;                                     // default 5
}

export interface QcMetrics {
  inspected: number;                  // cases with ≥1 decided inspection = honest denominator
  first_pass: number;
  first_pass_pct: number | null;      // null ⇒ render '—'; never a fabricated 0
  first_pass_strict_pct: number | null;    // 'pass' only, notes excluded
  pass_with_notes_pct: number | null;
  rework_rate: number | null;         // cases with ≥1 fail / inspected
  rework_cycles: number;
  avg_rework_turnaround_days: number | null;   // fail decided_at → next inspection decided_at
  top_failure_reasons: { category: string; label: string; count: number }[];
  by_inspector: { inspector: string; inspections: number; first_passes: number; failures: number }[];
  queue_count: number;                // gate-required cases with no decision
  awaiting_signoff: number;
}

export function qcMetrics(
  cases: DentalCase[], inspections: QcInspection[], findings: QcFinding[],
  options?: QcMetricsOptions, policy?: QcPolicy): QcMetrics;    // policy optional ⇒ defaults
```

### 1.7 `AppContext` surface (`src/context/AppContext.tsx`) — the only thing components touch

```ts
// collections (hydrated at boot, written through on every write — see §4.1 A10 for the sync decision)
qcChecklists: QcChecklist[];
qcInspections: QcInspection[];
qcFindings: QcFinding[];
qcWaivers: QcWaiver[];
qcPolicy: QcPolicy;

// ── the ONE write path a technician needs
recordQcInspection(input: QcInspectionInput): QcRecordResult;

// ── reads (memoised over the collections; safe in render)
qcForCase(caseId: string): QcCaseSummary;
qcGateCheck(caseId: string, to: CaseStatus): QcGateDecision;
qcChecklistFor(caseId: string): QcChecklist;
qcMetrics(options?: QcMetricsOptions): QcMetrics;

// ── gate-aware lifecycle intent (updateCase keeps its current signature)
advanceCase(caseId: string, to: CaseStatus, note?: string): QcGateDecision;

// ── secondary writes (multi-inspector, waiver, rework, configuration)
signQcInspection(inspectionId: string, decision: QcSignoff['decision'], note?: string): QcRecordResult;
waiveQc(input: QcWaiverInput): { ok: true; waiver: QcWaiver } | { ok: false; error: QcError };
revokeQcWaiver(waiverId: string, reason: string): void;
resolveQcFinding(findingId: string, disposition: QcDisposition, note?: string): void;
saveQcChecklist(c: QcChecklist): QcChecklist;
updateQcPolicy(patch: Partial<QcPolicy>): void;
```

**Gate enforcement point (unchanged signature):** `updateCase(id, updates, note?)` keeps returning
`void`. Inside it, when `updates.status ∈ policy.gate.required_for`, the store consults
`gateCheck(...)`; a blocked transition **does not write the status** and appends an
`audit_events` row (`action: 'qc_gate_blocked'`). `advanceCase` is the *intent* API: it returns the
same `QcGateDecision` so the kanban/`CaseProgressIndicator` can toast "3 required checks unanswered",
and it delegates to `updateCase` when allowed — one writer, one explanation.


### 1.8 Storage shape — migration `005_qc_module` (column sketch; four tables, no edits to `cases`)

```sql
-- config, editable, versioned; written via qcChecklistsRepo.upsert (write-through, not collection-synced)
qc_checklists(
  id TEXT PRIMARY KEY, program TEXT NOT NULL DEFAULT 'production_qc', name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
  applies_to_json TEXT NOT NULL DEFAULT '{}', items_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT
);

-- append-only inspection header. case_id is a SOFT ref (no FK) — see §4.1 A10
qc_inspections(
  id TEXT PRIMARY KEY, inspection_number TEXT NOT NULL UNIQUE, case_id TEXT NOT NULL, case_number TEXT,
  program TEXT NOT NULL DEFAULT 'production_qc',
  kind TEXT NOT NULL DEFAULT 'initial' CHECK (kind IN ('initial','reinspection','spot_check','post_delivery')),
  cycle INTEGER NOT NULL CHECK (cycle >= 1), workstation TEXT,
  checklist_id TEXT NOT NULL, checklist_version INTEGER NOT NULL,
  checklist_snapshot_json TEXT NOT NULL, checks_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','awaiting_signoff','decided','voided')),
  outcome TEXT CHECK (outcome IN ('pass','pass_with_notes','fail','abandoned')),
  summary TEXT, approval_rule_json TEXT NOT NULL DEFAULT '{"kind":"any_one","required":1}',
  signoffs_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL, started_by TEXT NOT NULL, decided_at TEXT, decided_by TEXT,
  waivers_applied_json TEXT NOT NULL DEFAULT '[]', voided_reason TEXT,
  created_at TEXT NOT NULL, updated_at TEXT,
  -- the no-silent-double-pass guard, mirroring the ledger_entries idempotency precedent
  -- (migration 002: UNIQUE(entry_type, reference_id))
  UNIQUE (case_id, program, cycle)
);
CREATE INDEX idx_qc_insp_case   ON qc_inspections(case_id, cycle);
CREATE INDEX idx_qc_insp_status ON qc_inspections(status, created_at);
CREATE INDEX idx_qc_insp_date   ON qc_inspections(decided_at);

-- append-only findings, per case / per tooth / per unit
qc_findings(
  id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES qc_inspections(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL, item_key TEXT, scope TEXT NOT NULL CHECK (scope IN ('case','tooth','unit')),
  scope_ref TEXT, tooth_number INTEGER CHECK (tooth_number IS NULL OR (tooth_number BETWEEN 11 AND 48)),
  category TEXT NOT NULL, severity TEXT NOT NULL CHECK (severity IN ('advisory','minor','blocking')),
  disposition TEXT NOT NULL DEFAULT 'no_action'
    CHECK (disposition IN ('no_action','adjust','redo','remake','waive_requested','accepted_as_is')),
  note TEXT, evidence_json TEXT NOT NULL DEFAULT '[]',
  raised_by TEXT NOT NULL, created_at TEXT NOT NULL,
  resolved_at TEXT, resolved_by TEXT, resolution_note TEXT,
  UNIQUE (inspection_id, scope, scope_ref, item_key)   -- one row per target+item, no duplicated noise
);
CREATE INDEX idx_qc_find_case ON qc_findings(case_id, created_at);
CREATE INDEX idx_qc_find_cat  ON qc_findings(category);

-- authorised overrides, queryable by an auditor long after the inspection
qc_waivers(
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('finding','inspection','gate')),
  target_id TEXT, gate_status TEXT CHECK (gate_status IS NULL OR gate_status IN ('ready','delivered')),
  reason_code TEXT NOT NULL, reason_text TEXT NOT NULL,
  authorised_by TEXT NOT NULL, authorised_role TEXT NOT NULL, created_at TEXT NOT NULL,
  revoked_at TEXT, revoked_by TEXT, revoke_reason TEXT
);
CREATE INDEX idx_qc_waiver_case ON qc_waivers(case_id, target);
```

Seed of `DEFAULT_QC_CHECKLISTS` follows the existing fresh-DB pattern of
`clinicalSpecsService` (only when `qc_checklists` is empty) — config defaults, so no case data is
fabricated. `INSERT INTO app_meta ('schema_version','5')` is added, mirroring migration 004.
`src/db/sequences.ts` gains `SEQ_KEYS.qc = 'qc'` (prefix `QC`) — no new counter table.


---

## 2. Usage examples

### E1 — the common case: technician records a clean pass (5 lines, zero configuration)

```tsx
// src/components/cases/QcPanel.tsx  (rendered inside CaseDetailModal)
const { recordQcInspection } = useApp();
const onPass = () => {
  const res = recordQcInspection({ case_id: caseId, workstation: 'Bench 3' });
  if (!res.ok) return toast.error(res.error.message);     // e.g. 'Margin & fit has no result recorded'
  toast.success(`Passed — ${res.inspection.inspection_number} · gate: ${res.gate.allowed ? 'open' : res.gate.message}`);
};
```
No checklist id, no cycle, no actor, no timestamp, no number, no notification: the checklist is
resolved from `case_type`/`category`, `cycle` from `nextCycle()`, `QC-0007` from `doc_sequences`,
the actor from `user`, and `pass` is *derived* from the answers. `checks` may be omitted entirely when
`policy.gate.require_all_required_items === false`.

### E2 — explicit answers when the bench wants them (still one call)

```tsx
// `checks` is plain local form state: one row per item of qcChecklistFor(caseId)
const res = recordQcInspection({ case_id: caseId, checks, workstation: 'Bench 3', summary: 'Ready for pickup' });
```

### E3 — partial pass: cosmetic advisory note, case still passes (R: partial pass)

```tsx
const res = recordQcInspection({
  case_id: caseId,
  checks: [{ item_key: 'shade_match', result: 'ok' }],
  findings: [{
    item_key: 'surface_finish', scope: 'tooth', tooth_number: 21, scope_ref: '21',
    category: 'surface_gloss', severity: 'advisory',       // advisory ⇒ outcome becomes pass_with_notes
    disposition: 'accepted_as_is', note: 'Micro-gloss difference under LED, not visible in daylight',
  }],
  attachment_ids: [photoAttachmentId],                     // existing attachments table (R8)
});
// res.inspection.outcome === 'pass_with_notes'; res.gate.allowed === true (policy allows it)
```

### E4 — fail, per-tooth findings, rework, then re-inspection cycle 2 (R2/R4)

```tsx
const fail = recordQcInspection({
  case_id: caseId, summary: 'Distal margin open on the bridge retainer',
  findings: [
    { item_key: 'margin_fit', scope: 'tooth', tooth_number: 26, scope_ref: '26', category: 'fit_remake',
      severity: 'blocking', disposition: 'remake', note: 'Open distal margin, probe catches' },
    { item_key: 'surface_finish', scope: 'tooth', tooth_number: 27, scope_ref: '27', category: 'surface_gloss',
      severity: 'minor', disposition: 'adjust', note: 'Polish occlusal contacts' },
  ],
});
// fail.inspection.outcome === 'fail'  → case moves to 'revision' (rework), notification draft emitted
const again = recordQcInspection({ case_id: caseId, kind: 'reinspection', checks });  // cycle = 2
// again.inspection.cycle === 2; first-pass QC for this case is already false (cycle 1 failed)
```

### E5 — multiple inspectors with a quorum (R: quorum/approval)

```tsx
updateQcPolicy({ approval: { kind: 'quorum', required: 2 } });        // Lab Admin, once
const first = recordQcInspection({ case_id: caseId, checks, approve: false });
// first.inspection.status === 'awaiting_signoff'; first.gate.allowed === false
const second = signQcInspection(first.inspection.id, 'approve', 'Counter-checked under bench lamp');
// second.inspection.status === 'decided'; outcome resolved from the *recorded* checks + findings
```

### E6 — authorised waiver / override (R: waiver by an authorised role)

```tsx
const w = waiveQc({ case_id: caseId, target: 'gate', gate_status: 'ready',
  reason_code: 'client_approved_cosmetic', reason_text: 'Dr Farooq reviewed photos and accepted them' });
if (w.ok) { const d = advanceCase(caseId, 'ready', 'Waived by Lab Admin'); /* d.allowed === true */ }
// A Technician calling waiveQc gets { ok: false, error: QcError('Lab Admin or Super Admin only', 'WAIVER_NOT_PERMITTED') }
```

### E7 — kanban / progress indicator: gate-aware movement

```tsx
const { advanceCase, qcForCase } = useApp();
const decision = qcForCase(c.id).gate;             // render as a badge in the QC column
<button disabled={!decision.allowed} title={decision.message}
        onClick={() => { const d = advanceCase(c.id, 'ready', 'QC passed'); if (!d.allowed) toast.warn(d.message); }}>
  Move to Ready
</button>
```

### E8 — Dashboard: replace the hardcoded `—` (R5)

```tsx
const { qcMetrics } = useApp();
const { first_pass_pct, queue_count } = qcMetrics();        // memoised over the collections
<span className="font-bold text-emerald-600">{first_pass_pct === null ? '—' : `${first_pass_pct.toFixed(0)}%`}</span>
<span className="text-[10px] text-slate-400 uppercase">In QC · {queue_count}</span>
```

### E9 — AnalyticsView trend + top failures (R5) and NotificationsView (R7)

```tsx
const trend = qcMetrics({ from: '2026-01-01', to: '2026-06-30', top_n: 5 });   // chart from trend points
const chart = trend.top_failure_reasons.map(r => ({ label: r.label, value: r.count }));   // 'Shade mismatch', 14
// R7 is not a component concern: recordQcInspection already pushed qcNotificationDrafts() into
// the notifications collection (type 'escalation' on fail, 'status_change' on pass — see §4.2).
```

### E10 — engine-level, deterministic (vitest, `tests/db` + `tests/services`)

```ts
const res = qcRepo.recordInspection({ case_id: case.id, checks }, { actor: 'Ayesha', role: 'Technician',
  now: '2026-03-02T09:15:00Z', policy: DEFAULT_QC_POLICY, checklists: DEFAULT_QC_CHECKLISTS });
expect(res.ok && res.inspection.inspection_number).toBe('QC-0001');
expect(qcInspectionsRepo.byCase(case.id)).toHaveLength(1);
const dup = qcRepo.recordInspection({ case_id: case.id }, ctx);
expect(dup).toMatchObject({ ok: false, error: { code: 'CYCLE_ALREADY_DECIDED' } });   // no silent double-pass
```


---

## 3. What it hides internally

A caller sees one call and one summary object. Behind them:

1. **Checklist resolution & snapshotting.** Which checklist wins for a crown in zirconia (category
   match → case-type match → `default_checklist_id`) and the fact that the *entire checklist is
   frozen into the inspection row* (`checklist_snapshot_json`) so editing a checklist next year cannot
   rewrite history (R6/R10).
2. **Coverage rule.** Which items are `required`, which are `na` by prep type/shade, and whether
   "required items answered" is satisfied. The caller never computes percentages.
3. **Outcome derivation.** `pass` vs `pass_with_notes` vs `fail` is derived from severities
   (`severity_on_fail` + a finding's own severity), not chosen by the UI; `approve: true` cannot turn a
   blocking finding into a pass (no silent double-pass).
4. **Cycle arithmetic and the idempotency guard.** `cycle = nextCycle()`; `UNIQUE(case_id, program,
   cycle)` means a second decision on a decided cycle returns `CYCLE_ALREADY_DECIDED` instead of
   appending a quiet second pass.
5. **Quorum resolution and counting.** `QcApprovalRule` is resolved at creation from policy +
   checklist (and may later depend on case units); `quorumSatisfied()` counts `inspector`/`approver`
   signoffs with distinct identities, so one person cannot satisfy a quorum of two.
6. **Gate evaluation.** `gateCheck()` compares policy (`required_for`, `allow_pass_with_notes`,
   `allow_waiver`) with the derived summary and produces the human reason string used by badges,
   toasts and the audit row. `updateCase` consults it so no component can bypass the gate.
7. **Waiver authority.** Role check (`canWaive`), target resolution (`finding`|`inspection`|`gate`),
   revocation, and the "waiver is evidence, not deletion" rule — the failed inspection stays visible.
8. **Notifications & audit.** `qcNotificationDrafts()` centralises the mapping onto the existing
   `NotificationType` union, and the audit event is appended inside the same transaction as the record.
9. **Evidence plumbing.** Attachment ids are validated against the existing `attachments` table
   (`entity_type: 'qc_inspection'`, `entity_id: inspection.id`) — no new blob store, no size logic in
   QC (the service already enforces 8 MB/32 MB).
10. **Metrics honesty.** Windowing, dedupe per case, "inspected" as the denominator, `null` instead
    of a fabricated `0`, orphan-row tolerance, and the two first-pass definitions from one function.
11. **Transaction discipline.** Inspection + findings + sequence + audit in one `withTransaction`;
    `qcRepo` is the only writer, so an orphan finding cannot exist.


---

## 4. Trade-offs

### 4.1 The generality axes I chose — each named and justified

| # | Axis | How it generalises | Justification (requirement / near-future need) | Where I stop |
|---|---|---|---|---|
| A1 | **Checklist as versioned data** | `QcChecklist{program, applies_to, version, status, items[]}` rows, not a TS union of "what QC checks" | Assignment: *crown vs denture vs aligner differ in what "quality" means*; R6 "what was checked". Without it, every new case type is a migration + code branch | No checklist composition/inheritance, no per-lab checklist scoping, no dynamic JS conditions inside items — `applies_to` is declarative only |
| A2 | **Two-target findings** (`scope` + `scope_ref`, typed `tooth_number`) | One `qc_findings` table serves per-case, per-tooth and per-unit | Assignment: *per-tooth and per-unit findings*; denture = units, crown/bridge = FDI teeth, aligner = arch/stage | Exactly three scopes. No `qc_finding_targets` join table, no arbitrary entity references |
| A3 | **Open failure-category taxonomy** in `QcPolicy.failure_categories` | `category` is TEXT validated against config; `parent_code` groups | R2 "structured reason(s)", R5 "top-N failure reasons"; a denture failure vocabulary is not a crown one | One optional parent level (grouping only); no trees, no per-checklist category sets, no category→SLA automation |
| A4 | **Inspection = multi-signoff session with a resolved approval rule** | `signoffs[]` + `QcApprovalRule{any_one,all_of,quorum,role_quorum}` resolved at creation | Assignment: *multiple inspectors per case plus a quorum/approval rule*; default `any_one` keeps solo work one call | No workflow engine: no per-participant state machine, no delegation, no timed escalation, no signing order |
| A5 | **Waiver as a first-class, targetable, revocable artifact** | `QcWaiver{target: finding\|inspection\|gate, reason_code, authorised_by/role}` + `canWaive` | Assignment: *waiver/override by an authorised role*; R6 attribution | Single approval level (one authorised person). No approval chains, no expiry timers, no dual authorisation |
| A6 | **Cycle + kind as first-class dimensions** | `cycle` derived by `nextCycle()`; `kind ∈ initial\|reinspection\|spot_check\|post_delivery` | R4 "same case can be inspected repeatedly; first-pass = #1"; spot checks and post-delivery audits are the next realistic ask | Four closed kinds; no QC calendar/scheduling, no automatic spot-check sampling policy |
| A7 | **`program` seam for future quality programs** | One TEXT column on checklists + inspections, default `'production_qc'` | Assignment: *future quality programs (calibration, warranty claims)*. A calibration checklist can be recorded through the same writer for the same case with no schema change | No program registry table, no per-program RBAC, no program-specific state machines. If a program needs a fundamentally different shape (e.g. machine calibration curves), it gets its own module and reuses `qcRepo` only as a pattern |
| A8 | **Whole-behaviour policy object** | `QcPolicy`: who may inspect/waive, gate statuses, partial-pass acceptance, coverage strictness, first-pass definition | Roles exist (`Lab Admin`/`Technician`/`Super Admin`/`Billing Manager`) and labs will disagree; R3 "per your designed rule", R5 metric definition | One global policy in `settings('qc','policy')`. No per-lab, per-role or per-case-type policy resolution order — that is where config becomes unreadable |
| A9 | **Checklist snapshot stored on each inspection** | `checklist_snapshot_json` frozen per record | R6 "what was checked" + R10 durability: editing or retiring a checklist must never rewrite the past | Denormalised text (~2–6 KB/row). Accepted; no "reconstruct from version history" service |
| A10 | **QC tables deliberately excluded from the collection rebuild** (soft `case_id`, no FK) | QC rows are written-through by `qcRepo` and read at boot into state; `syncCollectionsToDb` does not DELETE them | R10. `syncNow` does `DELETE FROM cases` with `PRAGMA foreign_keys=ON`; a CASCADE FK would silently erase the QC log on every sync, and DELETE+re-INSERT of an audit log is the wrong shape. Precedent: `users` is already excluded, `payments.case_id`/`audit_events.entity_id` are already soft refs | No cross-checking trigger; `deleteCase` calls `qcRepo.deleteForCase`, and metrics tolerate orphan rows |
| A11 | **Injectable clock + pure functions** | `QcActorContext.now`, all rules in `qcDomain` | vitest suite must be deterministic (`tests/services`, `tests/db`) | No timezone/locale-aware scheduling |
| A12 | **Intent API beside the writer** | `advanceCase()` returns `QcGateDecision`; `updateCase()` keeps its signature and enforces the gate internally | R3 without touching ~20 existing `updateCase` call sites (`CaseListView.tsx:142,648,668`, `CaseDetailModal.tsx:461,522`) | No generic "transition request" bus, no event-sourced lifecycle |


### 4.2 Where over-generalization would hurt — and how I refused it

| Tempting extension | Why it is refused *here* | What we lose by stopping |
|---|---|---|
| A workflow engine (per-participant states, delegation, escalation timers, transition guards as data) | The module's job is *recording quality*, not routing work. A second state machine beside `CaseStatus` would fork the lifecycle that `CaseProgressIndicator`/kanban already own, and would need its own UI to be usable | A lab wanting "escalate to Lab Admin after 2 days unsigned" gets a notification-driven follow-up instead of an automatic escalation |
| A numeric quality score / weighted rubric per item | Open-ended numbers invite a fabricated KPI, and the dashboard's own rule is "never fabricate" (`—` for First-Pass QC today). `pass_with_notes` already carries "small defects" without inventing a scale | No single "quality index" chart; metrics stay counts and percentages |
| EAV / free-form attribute table for "prefer whatever fields a checklist wants" | Unqueryable, untypable, and it would push schema decisions into the UI. Items are declarative rows (`QcChecklistItem`) with a scope and a severity | A lab needing a 12-field measurement per tooth must extend `QcChecklistItem` (additive migration) instead of inventing fields ad hoc |
| First-class `qc_pass` / `qc_fail` `NotificationType`s | Would require rebuilding the `notifications` table's CHECK in migration 005, i.e. redesigning an existing table — explicitly disallowed. The mapping is quarantined in `qcNotificationDrafts()` so a later additive migration can change one function | The feed cannot icon-differentiate QC until then; QC rows use `escalation` (fail) / `status_change` (pass) with title + `link_url` |
| Separate tables/registries per quality program, per-lab policies, per-checklist category vocabularies | Each adds a resolution order ("which policy applies to this case?") that nobody can predict by reading the code. One global policy + one program string is inspectable | A multi-site lab with genuinely divergent policy needs a per-lab override later; that is one additive settings key, not this design's job |
| Making `outcome` open text or a numeric score | The gate branches on it; ambiguity here means a case can reach `ready` on a string nobody can interpret | None worth having |
| Cross-lab benchmarking, SPC charts, image/AI defect detection, patient-facing QC pages | Out of scope and, for a local-only offline app (R9), unbounded | Nothing this module must do |

### 4.3 Where this shape wins

- **Crown, denture and aligner differ without code**: three seeded `QcChecklist` rows; a new
  restoration type is data entry, and the technician's call is identical in all three cases (E1).
- **The common call is not drowned in configuration**: `recordQcInspection({ case_id })` is a valid
  complete pass when policy allows; every other parameter is optional, and nothing in E1 requires a
  prior setup step.
- **Multi-inspector, waivers and partial passes are first-class** instead of bolted on: `approve:false`
  + `signQcInspection` for quorum, `QcWaiver` for override, `severity: 'advisory'` for cosmetic.
- **One metric function** feeds Dashboard, Analytics and Print from the same definitions (R5), and it
  returns `null` — not `0` — when there is nothing to report.
- **Auditability that survives everything**: snapshot per inspection (A9) + append-only rows + soft
  refs (A10) + `UNIQUE(case_id, program, cycle)` (R4/R10)/no silent double-pass.
- **Testability**: rules live in pure functions with an injectable clock, matching
  `financeDomain.ts` / `prioritySla.ts`.

### 4.4 Where this shape loses / what it makes hard

- **Configuration is a real surface**: someone must maintain checklists, categories and the policy.
  Without the Catalog/Settings tab this becomes hand-edited JSON — the design ships defaults so an
  unconfigured lab is fully usable, and treats the editors as required follow-up, not optional polish.
- **Write-time validation instead of compile-time**: `category`, `item_key` and `reason_code` are
  strings; a typo surfaces as `UNKNOWN_CATEGORY`, not a TS error. That is the price of A3; it is paid
  once inside `validateFindings` and covered by tests.
- **JSON columns limit SQL analytics**: `checks_json` is not queryable. Accepted because the
  *queryable* QA signal — failures — is relational (`qc_findings.category`, `.item_key`, `.tooth_number`).
- **A snapshot cost**: `checklist_snapshot_json` duplicates text per inspection (A9).
- **The gate lives in one React action, not in the DB**: a script calling `casesRepo.update(id,{status:'ready'})`
  bypasses it. Mitigated by A12's derived gate (dashboards read inspections, so a bypassed status
  cannot fake a pass) and by the repo convention that components never write raw SQL.
- **SQLite NULL semantics sharpen one constraint**: `UNIQUE(inspection_id, scope, scope_ref, item_key)`
  treats NULLs as distinct, so the *shipped* migration should use `COALESCE(scope_ref,'')`/`COALESCE(item_key,'')`
  in the unique index (or let `validateFindings` reject duplicates). Called out so the implementer does
  not discover it in production.
- **`abandoned` is a real outcome**: an inspection started and never decided must be voidable
  (`voided_reason`) and must not be counted as a pass — that keeps the metrics honest but adds a state
  every UI must handle.


---

## 5. Fit map — exact files touched and names exposed

| File | Change | Names exposed / edited |
|---|---|---|
| `src/types.ts` | **new QC block** (no edits to existing types; `NotificationType`, `CaseStatus`, `AppNotification` untouched) | `QcOutcome`, `QcFindingScope`, `QcSeverity`, `QcDisposition`, `QcInspectionKind`, `QcInspectionStatus`, `QcChecklistItem`, `QcChecklist`, `QcFailureCategory`, `QcApprovalRule`, `QcPolicy`, `QcFinding`, `QcSignoff`, `QcInspection`, `QcWaiver`, `QcInspectionInput`, `QcRecordResult`, `QcErrorCode`, `QcError`, `QcWaiverInput`, `QcGateDecision`, `QcCaseSummary`, `QcMetrics`, `QcMetricsOptions` |
| `src/db/migrations.ts` | **append** `MIGRATION_005_QC_MODULE` (version 5) and register it in `MIGRATIONS`; no applied migration edited | 4 `CREATE TABLE`s + indexes + `INSERT INTO app_meta ('schema_version','5')` per §1.8 |
| `src/db/sequences.ts` | one line | `SEQ_KEYS.qc = 'qc'` (prefix `'QC'` at the call site) |
| `src/db/repos.ts` | **append** a QC section; optional: add `qc_inspections`/`qc_findings` to `statsRepo.all()` | `qcChecklistsRepo`, `qcInspectionsRepo`, `qcFindingsRepo`, `qcWaiversRepo`, `qcRepo`, `QcActorContext` |
| `src/db/syncCore.ts` | *deliberate non-integration*, documented in the header comment next to the existing `users` exclusion; `SyncCollections` unchanged | comment: "qc_* and settings are written-through by their repos; excluded from the delete-and-replace rebuild because they are append-only evidence" |
| `src/services/qcDomain.ts` | **new file** (pure, no engine import) | `DEFAULT_QC_POLICY`, `DEFAULT_QC_CHECKLISTS`, `resolveChecklist`, `checklistCoverage`, `evaluateOutcome`, `resolveApprovalRule`, `quorumSatisfied`, `pendingSignoffs`, `summarizeCase`, `gateCheck`, `canWaive`, `validateFindings`, `scopeLabel`, `qcQueue`, `qcNotificationDrafts`, `qcMetrics` |
| `src/db/seeds.ts` | one opt-in call, same shape as the existing clinical-specs seeding | `seedQcDefaults()` (seed `DEFAULT_QC_CHECKLISTS` when `qc_checklists` is empty) |
| `src/context/AppContext.tsx` | state + hydration + effects + actions; `updateCase` gate hook; `deleteCase` calls `qcRepo.deleteForCase` | `qcChecklists`, `qcInspections`, `qcFindings`, `qcWaivers`, `qcPolicy`, `recordQcInspection`, `signQcInspection`, `waiveQc`, `revokeQcWaiver`, `resolveQcFinding`, `saveQcChecklist`, `updateQcPolicy`, `qcForCase`, `qcGateCheck`, `qcChecklistFor`, `qcMetrics`, `advanceCase` |
| `src/components/cases/QcPanel.tsx` | **new** — checklist form, findings rows, sign-off, waiver button (mounted by `CaseDetailModal`) | `QcPanel` |
| `src/components/cases/CaseDetailModal.tsx` | mount `QcPanel` in the QC tab area next to the existing status-note field (`:1368`) | — |
| `src/components/cases/CaseDetailPanel.tsx` | QC row: latest outcome + cycle count + "Record inspection" (label already exists at `:29`) | — |
| `src/components/cases/CaseListView.tsx` | QC column: gate badge; `handleDrop`/status select (`:142`, `:648`, `:668`) switch to `advanceCase` for gate-required statuses | — |
| `src/components/cases/CaseProgressIndicator.tsx` | optional prop `gate?: QcGateDecision` to disable the `ready` stop with the reason as tooltip | — |
| `src/components/dashboard/DashboardView.tsx` | replace the `—` at `:571-572` with `qcMetrics().first_pass_pct ?? '—'`; add `queue_count` | — |
| `src/components/analytics/AnalyticsView.tsx` | two new cards from `qcMetrics({from,to})`: quality trend + top failure reasons; include in CSV export | — |
| `src/components/notifications/NotificationsView.tsx` | optional: map QC titles/`link_url` to the existing icon switch (`:192-206`) | — |
| `src/components/catalog/CatalogView.tsx` | third tab ("QC Checklists") beside `materials`/`prepTypes` (`:29`) + failure-category editor writing `qcPolicy.failure_categories` | `QcChecklistEditor`, `QcCategoryEditor` |
| `src/components/print/printRenderer.tsx`, `PrintStudioView.tsx` | `DocumentKind` (`printRenderer.tsx:5`) gains `'qc_certificate'` (and `'qc_label'` if wanted); add `PRINT_SECTIONS` + `DEFAULT_ENABLED` entries rendered from `QcCaseSummary` | `PrintDocument` kind `'qc_certificate'` |
| `tests/services/qcDomain.test.ts`, `tests/db/qcRepos.test.ts` | **new** — rules/coverage/quorum/gate/metrics, and repo/UNIQUE/idempotency behaviour | — |

**Not touched:** `cases` columns, `CaseStatus`, `case_status_history`, `notifications` CHECK,
`ledger_entries`, money paths, `attachments` schema, any applied migration, any dependency.


---

## 6. Requirement coverage (R1–R10)

| Req | Verdict | One line |
|---|---|---|
| **R1** Record the outcome of an inspection (pass/fail) | **Met** | `recordQcInspection({ case_id, … })` writes an append-only `qc_inspections` row with a derived `outcome ∈ pass\|pass_with_notes\|fail\|abandoned`; a bare `{ case_id }` call is a valid pass when policy allows. |
| **R2** On failure capture why (structured + free text) and put the case into rework | **Met** | `QcFinding.category` (config taxonomy) + `severity` + `disposition` + mandatory `note`; a `fail` drives `updateCase(status:'revision')`-style rework and emits the failure notification; `validateFindings` rejects an unknown `category` and an `other` without a note. |
| **R3** Gate the lifecycle: no `ready`/`delivered` without a passing inspection | **Met** | `qcDomain.gateCheck()` + `policy.gate.required_for = ['ready','delivered']`; enforced inside `updateCase` (blocked ⇒ no status write + `audit_events` row), explained by `advanceCase`/`qcGateCheck`; waiver path keeps it auditable. |
| **R4** Track re-inspection; first-pass = passed on inspection #1 | **Met** | `cycle = qcInspectionsRepo.nextCycle()`, `UNIQUE(case_id, program, cycle)` refuses a second decision on a decided cycle; `QcMetrics.first_pass_pct` / `first_pass_strict_pct` are computed from decided cycle-1 inspections. |
| **R5** Metrics: First-Pass QC %, rework rate, top-N reasons, avg rework turnaround, per-inspector counts | **Met** | Single `qcMetrics()` returns all five (plus queue/awaiting-signoff), windowed and filterable; Dashboard/Analytics/Print read the same function; `null` (not `0`) when there is no data. |
| **R6** Attributable history: who / when / result / what was checked / where | **Met** | `started_by`+`decided_by`+`signoffs[].inspector/role`, `started_at`/`decided_at`, `outcome`, `checklist_snapshot`+`checks`, `workstation`; append-only rows plus `audit_events` inside the same transaction. |
| **R7** Notify: QC failure and QC pass surface in `AppNotification` | **Met** | `qcNotificationDrafts()` pushes into the existing `notifications` collection from the same action → `notificationsRepo`; mapping reuses the existing type union (fail ⇒ `escalation`, pass ⇒ `status_change`) — see §4.2 for why the enum is not widened now. |
| **R8** Evidence via the existing `attachments` table | **Met** | `attachment_ids` / `evidence_attachment_ids` are validated rows with `entity_type: 'qc_inspection'`; no new blob store, and the existing 8 MB/32 MB limits in `attachmentService` still apply. |
| **R9** Fully offline, local-only, no new deps | **Met** | Only `src/types.ts`, `src/db/*`, `src/services/qcDomain.ts`, `src/context`, existing Tailwind components; no fetch, no npm/Rust addition, no Node-only API. |
| **R10** QC data survives the boot sync | **Met (deliberate exclusion)** | QC tables are append-only, written-through by `qcRepo` and read at boot; they are **not** part of `syncCollectionsToDb`'s DELETE+INSERT (documented like the `users` exclusion), and `case_id` is a soft reference because `syncNow` runs `DELETE FROM cases` with `PRAGMA foreign_keys=ON`. |

**Requirement-adjacent, delivered beyond the list:** per-item evidence requirement (`evidence: 'required'`),
waiver revocation, `abandoned`/voided inspections so an unfinished session cannot masquerade as a pass,
`qc_certificate` print kind, and the seam for the next quality program (`program` column).

---

## 7. Non-goals

1. **No workflow/routing engine.** No delegation, signing order, escalation timers or per-participant
   state machines; quorum is a count over signatures.
2. **No numeric quality score or weighted rubric**, and no composite "quality index" KPI.
3. **No image analysis, CAD/scan inspection or AI defect detection** — evidence is attached, not judged.
4. **No new notification type / no rebuild of the `notifications` table** in this migration.
5. **No redesign of `cases`, `CaseStatus`, `case_status_history`, attachments or any money path**, and
   no edit to any applied migration.
6. **No scheduling layer** (calibration intervals, spot-check sampling rules, audit calendars) — the
   `kind`/`program` fields are the seam, not the scheduler.
7. **No per-lab or per-case-type policy resolution order**, no multi-tenant QC, no cross-lab
   benchmarking or SPC dashboards.
8. **No customer- or doctor-facing QC portal**, no QC emails/PDF sharing beyond the local print path.
9. **No SPC/statistical theory, no control charts, no warranty-claim adjudication workflow** (the
   `program` seam exists; the claims process does not).
10. **No editing of decided inspections** — corrections happen as a new cycle or a waiver; that is what
    makes R4/R6 trustworthy.

