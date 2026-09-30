# Case Module Audit — job-case flows vs the all-or-nothing SQLite sync

**Audit date:** 2026-10-01 · **Scope:** case create/update/status/delivery/archive/delete, delivery→invoice side effects, case-side `invoice.payments` writers, case deletion vs FKs, QC inspections attached to cases, status-history/notes/teeth writes. Read-only audit; no repo files were modified.

**Known context (not re-derived):** persistence = `src/db/syncCore.ts` `syncCollectionsToDb` — 150ms-debounced DELETE + re-INSERT of ~17 tables in ONE transaction; any invalid/duplicate row aborts ALL persistence; `cases.case_number` and `invoices.invoice_number` are UNIQUE; `payments.payment_number` UNIQUE; the payments healer (syncCore.ts:78-89) only covers `payments`/`advance_payments`.

**Key structural note:** in this codebase the invoice is generated at **case registration** (`addCase`, AppContext.tsx:934-967), not at delivery. Delivery is only a status value + history entry + notification. There is no delivery-triggered invoice/payment writer anywhere (verified in "Verified safe"), so repeated delivery toggles cannot create duplicate invoices/payments — but they do bypass the QC gate (C6).

---

## Findings

### C1 — P0 (money/data loss): `deleteCase` silently destroys invoices + nested payments without reversal, audit, or the active-payment guard that `deleteInvoice` enforces

**Evidence:**
- `src/context/AppContext.tsx:1136-1144` — `deleteCase` does `setInvoices((prev) => prev.filter((inv) => inv.case_id !== id))` (1139) with no guard and no reversal journal; only a console-only workflow trigger (1142).
- `src/context/AppContext.tsx:1499-1513` — `deleteInvoice` explicitly refuses to void an invoice with active (non-reversed) payments ("Reverse them first", 1506-1513). `deleteCase` bypasses this guard entirely.
- `src/db/syncCore.ts:100-107, 255-291` — the sync rebuilds `payments` from the invoices in state, so once the invoice leaves state its payment rows are deleted from SQLite on the next sync (no tombstone, no audit).
- UI path: `src/components/cases/CaseDetailModal.tsx:1352-1365` — the edit footer's "Delete Case" button (confirm text says "PERMANENTLY delete case") calls `deleteCase(initialCase.id)` for ANY case, including paid ones.

**Failure scenario:** a case was invoiced and paid (e.g. two PKR payments). User opens the case, clicks "Delete Case", confirms. Invoice + payments vanish from React state; 150ms later the sync transaction rewrites `invoices`/`payments` without them. Money trail gone; no reversal journal; no `INVOICE_VOIDED`/`PAYMENT_REVERSED` audit row; reconciliation rows (also rebuilt, syncCore.ts:371-382) now point at vanished payments. Orphaned `journal_entries`/`journal_lines` remain, so General Ledger and invoice-based views disagree.

**Minimal fix:** inside `deleteCase`, reuse the `deleteInvoice` semantics — refuse (toast) when any linked invoice has active payments; otherwise void each linked invoice through the existing reversal path (reversal journal + audit event at AppContext.tsx:1515-1544) before removing it. If the product wants "delete = hide", route this button to `archiveCase` (1149-1156) and keep money rows.

### C2 — P1 (breaks ALL persistence): QC rows of a deleted/wiped/restored-away case remain in state; `syncNow` re-inserts them and the `qc_inspections.case_id` FK aborts the whole transaction

**Evidence:**
- Schema: `src/db/migrations.ts:662-678` — `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE` (677), `dedupe_key TEXT NOT NULL UNIQUE` (675).
- Rebuild inserts every state row with no orphan skip: `src/db/syncCore.ts:98` (delete) + `226-239` (insert loop). The QC design doc explicitly required an orphan skip and state pruning: `docs/design/qc-module/design-1-minimal-surface.md:520-524` — never implemented.
- Trigger paths, all leaving `qcInspections` untouched:
  - `deleteCase` — `src/context/AppContext.tsx:1136-1144` (the only QC writer is `recordQcCase` at 1102; no prune anywhere).
  - `deleteCasePermanently` — `src/context/AppContext.tsx:1167-1177`; DB cascade deletes the rows (`src/db/repos.ts:591-603`, esp. 599) but state keeps them → same transaction re-inserts them.
  - `wipeAllData` — `src/context/hooks/useAuthDomain.ts:372-419` (`setCases([])` 373; QC state not passed to the hook at all, AppContext.tsx:803-822).
  - `resetToDemoData` — `src/context/hooks/useAuthDomain.ts:340-370`.
  - `restoreBackupData` — `src/context/hooks/useAuthDomain.ts:306-338`; backups never contain `qcInspections` (`getBackupData` 297-303; AppContext.tsx:812-822), so after restore the in-memory QC rows reference case ids that no longer exist.
- Boot hydration loads QC rows from the DB (`src/context/hooks/useCasesDomain.ts:35-40`), so a profile can carry QC rows even before the QC UI ships.

**Failure scenario:** a QC row exists for case A (boot-hydrated/legacy). User permanently deletes case A (`CaseListView.tsx:1041-1050` → `deleteCasePermanently`), or wipes data. Next sync: `INSERT INTO qc_inspections … case_id='A'` → `FOREIGN KEY constraint failed` → whole transaction rolls back → app runs unpersisted with the sync-failed banner; retries keep failing until restart (and re-fail if the case is really gone).

**Minimal fix (precedent in-file):** in the QC loop (syncCore.ts:230-238) build `const liveCaseIds = new Set(c.cases.map(x => x.id))` and `continue` when `!liveCaseIds.has(qc.case_id)`; prune QC state in `deleteCase`/`deleteCasePermanently` (`setQcInspections(prev => prev.filter(q => q.case_id !== id))`), clear it in `wipeAllData`/`resetToDemoData`, and add `qcInspections`+`setQcInspections` to the auth-domain snapshot/setters for restore.

### C3 — P1 (breaks ALL persistence, cross-module): deleting a lab that cases/invoices/advances still reference aborts the whole sync; case edits keep invoices pointed at the old lab, making this reachable

**Evidence:**
- `deleteLab` removes only the lab + its contacts/addresses/pricing/reviews: `src/context/AppContext.tsx:1278-1284`. No check against cases/invoices.
- FKs without cascade: `cases.lab_id` (`migrations.ts:143,164`), `invoices.lab_id` (218,237), `advance_payments.lab_id` (310,328), `account_adjustments.lab_id` (347,366).
- Sync order deletes labs (`syncCore.ts:115`) then re-inserts cases (181-193) in the same transaction → dangling `lab_id` throws `FOREIGN KEY constraint failed`.
- Amplifier inside the case module: `updateCase` re-prices the invoice but never propagates `lab_id`/`lab_name` (`AppContext.tsx:1022-1042` — only `amount`/`discount`/`final_amount`/status), while `addCase` stamps the invoice's lab at creation (940-941). Editing a case's lab leaves the invoice on the old lab, so deleting the old lab later hits the `invoices.lab_id` FK.

**Failure scenario:** case edited from Lab A to Lab B; later Lab A is deleted; next sync inserts the invoice with `lab_id=A` → FK violation → all persistence stops. Same with any case/invoice still on the deleted lab.
**Minimal fix:** give `deleteLab` the `deleteInvoice`-style guard: if any case/invoice/advance/adjustment in state references the lab, toast and refuse. Separately, extend the invoice sync in `updateCase` (1022-1042) to copy `lab_id`/`lab_name` when they change.

### C4 — P1 (breaks ALL persistence, unrecoverable): no duplicate healer for `cases.case_number` / `invoices.invoice_number`; numbers are generated from render-scope state with only a 350ms settle guard against re-submit

**Evidence:**
- UNIQUE constraints: `cases.case_number` (`migrations.ts:141`), `invoices.invoice_number` (215).
- Sync healers exist ONLY for payments/advances (`syncCore.ts:78-89`, applied at 267-271 and 296-300). The cases insert (181-193) and invoices insert (255-266) have no `usedNumbers` set and no first-wins dedupe.
- Number generation scans render-scope state: `AppContext.tsx:888-889` → `src/services/ledgerDomain.ts:58-67` (`nextCaseNumber`/`nextInvoiceNumber`, max-scan). `addCase` (909-937) uses both and enqueues them in the same tick.
- Re-submit surface: `src/components/cases/CaseDetailModal.tsx:445-447` (`commitCase` guards only `step` and a 350ms settle window since entering the final step, `STEP_SETTLE_MS` at 180-181/566-569), `onClick={commitCase}` at 1403-1405 and `handleSubmit` at 515-523. There is no in-flight/submitting flag, so any second invocation ≥350ms after entering the step (key-repeat Enter, queued click, scripted call) runs `addCase` again reading the SAME stale `cases`/`invoices` arrays → identical `DS-` and `INV-` numbers enqueued in one batch.

**Failure scenario (a):** double-commit as above → two cases with `DS-0007` (and two invoices `INV-0007`) in state → `UNIQUE constraint failed: cases.case_number` → whole sync transaction aborts, banner shown, no auto-heal (unlike payments, this state never repairs itself).
**Failure scenario (b):** any pre-existing duplicate `DS-`/`INV-` numbers in a legacy/imported profile (the exact class of data the payments healer was written for) brick every save permanently with no recovery path.

**Minimal fix:** extend the syncCore healer with `usedCaseNumbers`/`usedInvoiceNumbers` (first-wins + `-D2` suffix, same pattern as lines 82-89) applied inside the cases/invoices loops; and add an in-flight guard in `commitCase` (`if (committingRef.current) return; committingRef.current = true;` reset on failure, plus a `disabled` state on the save button).

### C5 — P2 (P1 blast radius): status-history / teeth / notes inserts have no id de-dup; a collision from legacy data aborts the same all-or-nothing transaction

**Evidence:**
- `case_status_history.id` PK (`migrations.ts:180-188`); sync insert uses `h.id || genId('h')` with no dedupe: `syncCore.ts:204-209`.
- `case_teeth` PK `(case_id, tooth_number)` (`migrations.ts:167-178`); sync inserts one row per entry of `selected_teeth` with no de-dup: `syncCore.ts:194-203`.
- `case_notes.id` PK (`migrations.ts:190-198`); sync insert `syncCore.ts:210-215` has no dedupe, and new notes use a timestamp-only id `note-${Date.now()}` (`AppContext.tsx:1182`) — two notes added in the same millisecond (double-submit of the note form) collide.
- There IS dedupe precedent for the same failure class in syncCore for journal lines (344-369, comment at 345-347) and notifications (396-413) — case children were missed.

**Failure scenario:** imported/merged state with a reused history id (e.g. 'h1' on two cases), a duplicated tooth number in `selected_teeth`, or a same-ms note double-submit → PK violation → whole sync aborts.
**Minimal fix:** first-wins `seen…Ids` guards in the history/notes loops, skip-if-seen in the teeth loop, and give notes the same uuid-based id generator as attachments (`genId` at AppContext.tsx:503-506, already used at 1214).

### C6 — P2 (correctness): the QC gate is not enforced on manual `ready`/`delivered` transitions

**Evidence:**
- Gate logic exists and is documented as mandatory: `src/services/qcDomain.ts:48` (`QC_GATED_STATUSES = ['ready','delivered']`), 175-177 (`qcGateSatisfied`), design doc `design-2-max-flexibility.md:752` ("enforced inside `updateCase`").
- `updateCase` (`AppContext.tsx:981-1043`) contains no gate consultation (AppContext imports only `statusAfterQc`, 50-57, not `qcGateSatisfied`).
- All manual writers go straight through: drag & drop `CaseListView.tsx:161-164`, ladder clicks 761/947, status select 781, case view `CaseDetailView.tsx:95`, dashboard `DashboardView.tsx:671`, dispatch `InteractiveDeliveryCalendar.tsx:323` (`'delivered'`), and the modal's own status state (`CaseDetailModal.tsx:1128`).

**Failure scenario:** any case can be marked `ready`/`delivered` with a failed or absent QC inspection (no persistence impact — this is a business-rule bypass only).
**Minimal fix:** at the top of `updateCase`, when `updates.status` is `'ready'|'delivered'`, call `qcGateSatisfied(deriveQcCaseState(qcInspections, id))`; on failure show the toast and return before any state write.

### C7 — P2 (correctness): case edits never propagate `lab_id`/`lab_name`/`delivery_date` to the linked invoice

**Evidence:** `updateCase` syncs only price fields (`AppContext.tsx:1022-1042`); the invoice already holds the creation-time lab (`addCase` 940-941) and `issue_date = delivery_date` (950). Print views then show the stale lab (`BulkPrintModal.tsx:373-379` reads `invoice.lab_name`; `printRenderer.tsx` the same).
**Failure scenario:** invoice shows the wrong clinic after a case is reassigned; and the stale `lab_id` is what feeds C3's FK abort when the old lab is deleted.
**Minimal fix:** add `lab_id`/`lab_name` (and `issue_date` when `delivery_date` changes) to the invoice-map branch in `updateCase`.

### C8 — P2 (data loss on recovery path): backup/restore excludes QC — QC history is lost and can orphan (trigger of C2)

**Evidence:** `getBackupData` exports `{ ...snapshot }` (`useAuthDomain.ts:297-303`) and the snapshot has no `qcInspections` (`AppContext.tsx:812-822`); `restoreBackupData` (306-338) never touches QC state. Meanwhile the sync rebuild deletes and re-inserts `qc_inspections` from React state (`syncCore.ts:98, 226-239`), so DB-side QC rows not represented in state are wiped on the first sync after any change.
**Failure scenario:** user restores a backup → all QC history disappears from the DB (and, if stale QC rows remain in state, C2's FK abort fires).
**Minimal fix:** include `qcInspections` in the auth-domain snapshot + add `setQcInspections` (thread it from `useCasesDomain` at AppContext.tsx:520) and rehydrate on restore; prune orphans as in C2.

### C9 — P2 (state hygiene): `deleteCase` / `deleteCasePermanently` leave notes, attachments and QC in memory for the removed case

**Evidence:** `AppContext.tsx:1136-1144` and `1167-1177` prune only cases/invoices/notifications. `caseNotes`/`caseAttachments` entries for the deleted id stay in the maps; the sync only walks them inside the existing-case loop (`syncCore.ts:210-223`), so they are silently never persisted (memory-only leak), while `qcInspections` causes the C2 abort.
**Minimal fix:** prune `caseNotes[id]`, `caseAttachments[id]` (and `qcInspections` per C2) in both delete functions — or centralize one `pruneCaseChildren(id)` helper and call it from both.

### C10 — P2 (logging correctness): batch-printing invoices logs a duplicate voucher per print run

**Evidence:** `src/components/cases/BulkPrintModal.tsx:117-134` calls `saveVoucherToSystem` once per matched invoice on every print; `useVoucherLogging.ts` (single writer) prepends + inserts; `saved_vouchers` has no UNIQUE on `voucher_number` (`migrations.ts` saved_vouchers DDL — `voucher_number TEXT NOT NULL`, id PK only), and the sync rebuild (syncCore.ts:384-394) inserts whatever state holds. Repeated prints create duplicate ledger-log rows and duplicate `[VOUCHER LOGGED]` case notes (`voucherDomain.buildVoucherCaseNote` via useVoucherLogging.ts).
**Minimal fix:** before calling `saveVoucherToSystem`, skip when a voucher with the same `voucher_number` + `case_id` already exists in `savedVouchers`, or add the dedupe inside `saveVoucherToSystem`.

### C11 — P2 (latent correctness): `addCase` stamps `journal_id` by mutating the invoice object AFTER it was inserted into state

**Evidence:** `AppContext.tsx:959` `setInvoices((prev) => [newInvoice, ...prev])` runs before `967` `newInvoice.journal_id = journal.id`. The sync effect happens to observe the mutation because it reads the same object reference on the post-render pass, and the boot backfill (631-651, migration 012) can re-link if the pairing is lost — but the invoice is briefly in state without its journal_id.
**Minimal fix:** build the journal first (or set `journal_id` on the object) and only then `setInvoices`, so the state snapshot is always complete.

---

## Verified safe (no action needed)

1. **Delivery/status toggles create no invoices or payments.** `updateCase` appends one history row and, for `ready`/`delivered`, one notification (`AppContext.tsx:993-1007`). Repeated toggles cannot duplicate invoices/payments/journals — those writers live only in `addCase` (934-967) and the billing flows.
2. **Status-history ids from the UI are collision-proof.** New entries use uuid-based `genId` (`AppContext.tsx:503-506`, used at 922/995); notifications in the sweeps use `prependUniqueNotifications` (868, 878). (Imported data is C5.)
3. **No case-side module writes `invoice.payments`.** Grep of `src/components/cases/*` and `src/components/print/*` shows read-only usage (`printRenderer.tsx:125-126, 353, 365`; `BulkPrintModal.tsx:331`). Writers are only `AppContext` 956 (empty array at creation), 1485 (`bulkMarkPaid`), 1615 (legacy `applyAdvanceCredit`), and `transactionDomain.ts:270/420` (billing RecordTransactionModal via `useTransactionCommands.ts`) — none reachable from the case viewer/print/QC paths.
4. **`bulkMarkPaid` cannot double-issue a payment number for one invoice:** remaining<=0 skip + per-invoice `-index` suffix (`AppContext.tsx:1425-1427, 1432-1433`).
5. **QC double-post is blocked at the DB first:** `recordQcCase` inserts before touching state and maps the UNIQUE failure to a toast (`AppContext.tsx:1091-1099`); `qcDedupeKey` is deterministic (`qcDomain.ts:69-71`).
6. **Archive/restore are FK-safe:** they only flip `archived_at` (`AppContext.tsx:1149-1165`; migration 011, `migrations.ts:744-752`), and the boot auto-archive runs once per session behind a ref (`AppContext.tsx:586-592`).
7. **Payment/advance duplicates and duplicate journal-line/notification ids are healed at sync** (`syncCore.ts:78-89, 267-271, 296-300, 344-369, 396-413`).
8. **Invoice price edits cannot violate CHECK(final_amount >= 0)** — clamped at `AppContext.tsx:1028-1031` (migration constraint `migrations.ts:226`).
9. **Case-child loops can't abort on orphan notes/attachments** — they iterate only `c.caseNotes[cse.id] || []` / `c.caseAttachments[cse.id] || []` for existing cases (`syncCore.ts:210-223`). (QC is the exception — C2.)

## Severity summary

- **P0:** 1 (C1)
- **P1:** 3 (C2, C3, C4)
- **P2:** 7 (C5, C6, C7, C8, C9, C10, C11)

**Recommended fix order:** C2 (one-line sync orphan skip + state pruning, restores persistence safety for the whole app) → C1 (money-loss guard) → C3/C4 (FK + UNIQUE hardening in syncCore) → C5–C11.




