# QC Module — Interface Design Brief ("Design It Twice")

Target module: **Quality Control (QC) recording + the quality gate for dental cases**
Repo: `D:\Dental Management Software` (Dental Solutions — clinic & dental-lab management, v2.2.0)
Status: greenfield module. No QC data model, no QC action, and no QC table exists today.

## 1. Why this module (verified evidence)
- `src/types.ts` — `CaseStatus` already contains `'qc'`; `src/db/migrations.ts` CHECKs the same enum.
- `src/components/cases/CaseListView.tsx:37` — kanban column "QC Quality" exists.
- `src/components/cases/CaseProgressIndicator.tsx:15` — ladder received → in_progress → qc → ready → delivered.
- `src/components/cases/CaseDetailPanel.tsx:29` — label "QC Quality" with badge styling.
- **Nothing records quality**: no inspection outcome, no failure reason, no rework counter, no inspector identity.
- `src/components/dashboard/DashboardView.tsx:571-572` — "First-Pass QC" KPI is a hardcoded `—`, while its
  neighbour "Avg Turnaround" (`:556-566`) is genuinely computed from case rows.
- `docs/PRODUCTION_RELEASE_REPORT.md` (Known Limitations): "QC benchmark metrics (First-Pass QC %) display
  "—" until a QC recording feature exists; they are no longer fabricated."
- `docs/ARCHITECTURE_AUDIT.md` — lifecycle draft→received→in_progress→qc→ready→delivered (+ revision,
  cancelled), with `case_status_history` as the only trace.

## 2. Who the callers are
| Caller | Needs |
|---|---|
| `CaseDetailPanel` / `CaseDetailModal` (technician at the bench) | record an inspection result; see QC state + history for a case |
| `CaseListView` (kanban QC column) / `CaseProgressIndicator` | gate: may this case move to `ready`? |
| `DashboardView` benchmark block | First-Pass QC % (beside Avg Turnaround); QC queue count |
| `AnalyticsView` | quality trend over time; top failure reasons |
| `NotificationsView` | notify on QC failure / rework |
| `PrintStudioView` | print a QC label / QC certificate (existing kinds: job slip, lab card, invoice, receipt) |
| `AppContext` | the single state/action surface components may use (`useApp()`) |
| vitest suite (`tests/db`, `tests/services`) | deterministic, engine-level testability |

## 3. Functional requirements (numbered — the critic grades every design against these)
R1. Record the outcome of a quality inspection for a case: pass or fail.
R2. On failure, capture why (structured reason(s) + free text) and put the case into rework.
R3. Gate the lifecycle: a case must not reach `ready`/`delivered` without a passing inspection record (per your designed rule).
R4. Track re-inspection: the same case can be inspected repeatedly; first-pass = passed on inspection #1.
R5. Report metrics: First-Pass QC %, rework rate, top-N failure reasons, average rework turnaround, per-inspector counts.
R6. Keep attributable history: who inspected, when, which result, what was checked, where.
R7. Notify: QC failure and QC pass must surface in the notification feed (`AppNotification`).
R8. Reference evidence: QC may attach photos/notes via the existing `attachments` table (`entity_type`), not a new blob store.
R9. Fully offline, local-only; no new npm/Rust dependencies; no network.
R10. QC data must survive the boot sync (`src/db/syncCore.ts` rebuilds collections with DELETE + re-INSERT).

## 4. Repo facts and idioms the design MUST fit
- **Stack**: React 19 + TypeScript 5.8 (`strict`) + Vite 6 + Tailwind 4; Tauri 2 desktop shell; sql.js 1.13 (WASM SQLite) is the authoritative store. Code runs in the browser *and* in the Node/vitest environment — no Node-only APIs in `src/`.
- **Repositories**: `src/db/repos.ts` — plain object literals, e.g. `export const casesRepo = { all(), byId(id), byCaseNumber(), insert(), update(), delete(), countByStatus() }`. Child tables use `childRepoFactory('table', true)`. Components never write raw SQL; everything goes through repos.
- **Migrations**: `src/db/migrations.ts` — append-only, numbered, each applied in a transaction. **Never edit an applied migration.** The latest is version 4 (`app_version`) → a new one would be `005`. Tables use FKs with `ON DELETE CASCADE`, CHECK constraints on enums/amounts, UNIQUE on document numbers.
- **Numbering**: `doc_sequences` + `src/db/sequences.ts` produce gap-free document numbers (DS-, INV-, PAY-, ADV-, CR-…) — reuse these rather than inventing a counter.
- **Append-only precedents**: `ledger_entries` is materialized with `UNIQUE(entry_type, reference_id)` as an idempotency guard; `audit_events` is append-only; `case_status_history` stores `{id, case_id, status, notes, timestamp, updated_by}` per transition.
- **Domain types**: `src/types.ts` (`DentalCase`, `CaseStatusHistory`, `ToothDetail`, `Invoice`, `LedgerEntry`, `AppNotification`, …). Structured sub-data is stored as TEXT JSON and decoded on read (`tooth_details`, `selected_teeth`, line items).
- **Update style**: `updateCase(id, updates, note?)` in `src/context/AppContext.tsx:1543` writes a `Partial<DentalCase>`, appends to `history` when `status` changes, and pushes a `status_change` notification for `ready`/`delivered`.
- **Services are pure functions**: `src/services/financeDomain.ts` (journal builders, `deriveInvoiceStatus`, `getAgingBucket`) and `src/services/prioritySla.ts` (`PRIORITY_SLA_DAYS`, `computeSlaDueDate`, `daysUntilDue`) — storage-agnostic and unit-tested. QC rules/metrics belong in this style.
- **State**: `AppContext.tsx` (~3k lines) holds collections in React state hydrated from the DB at boot and mirrors every write to the repos; components only call `useApp()`.
- **Sync**: `src/db/syncCore.ts` rebuilds collections with `DELETE` + re-`INSERT` inside one transaction (child tables are wiped explicitly), so any new table must either be integrated there or deliberately excluded with a reason — otherwise QC history is destroyed on the next boot sync.
- **Print**: `src/components/print/printRenderer.tsx` + `PrintStudioView.tsx` render documents (job slip, lab card, invoice, receipt) from domain objects.
- **Tests**: vitest (`npm test`) in `tests/db/*.test.ts` and `tests/services/*.test.ts`; `npm run lint` is `tsc --noEmit` (strict).

## 5. Hard constraints for every design
- Fit the idioms above. A design that needs a new dependency, a second store, network access, or an edited historical migration is **invalid**.
- Deep module over wide surface: hide significant complexity behind a small interface.
- Make misuse hard: no silent double-pass, no lifecycle bypass (if that is your rule), no orphan state if a write partially fails.
- Money/ledger, existing case statuses, and existing tables must not be redesigned.
- Roles exist: `Super Admin`, `Lab Admin`, `Technician`, `Billing Manager`; the actor is available as `user.name`. Consider who may inspect, who may waive.
- Never fabricate data; seeds are synthetic and opt-in.

## 6. Required output format (write this into your assigned file)
1. **Interface signature** — exact TS types + function/method signatures (names, params, return types) and any storage shape (table/columns or JSON payload).
2. **Usage examples** — realistic call sites in this repo's style (component usage, `AppContext` action, dashboard metric computation).
3. **What it hides internally** — the complexity a caller never sees.
4. **Trade-offs** — where this shape wins, where it loses, what it makes hard.
5. **Fit map** — exactly which existing files would change and the names you would expose (repo object, `AppContext` action names, service functions, migration number).
6. **Requirement coverage** — R1…R10: met / partial / not met, one line each.
7. **Non-goals.**

**Rules for this exercise: design only.** Signatures, types and ≤10-line usage snippets — no implementation bodies, no edits to any source file, no builds or tests. Write only your own doc file, then return a ≤40-line summary.

