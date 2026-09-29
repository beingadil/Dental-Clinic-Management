# Phase log

- Session 2026-09-27: audit-only (master prompt forbids code changes in phase 1).
- Phase 1 done: stack confirmed (React 19/Vite 6, Tauri 2, sql.js WASM, 9 Rust IPC commands, capabilities/default.json minimal perms).
- Phase 2 done: migrations 001-011, FKs ON, CHECKs, UNIQUEs, cascade verified; syncCore whole-table txn model mapped; legacy layers identified.
- Phase 3 done: financeDomain journal builders traced; buildInvoiceJournal has zero production callers; payment journals built in AppContext.
- Phase 4 done: PBKDF2 sessions OK; no brute-force guard; 5 role checks total; AppContext 3479 LOC.
- Phase 5/6 done: CSP meta strict in index.html but tauri.conf csp:null (stale comment claims parity); runtime console shows recurring update-manifest fetch failures (CSP+CORS) every boot; update flow fail-closed verified in Rust; backup_delete path-guarded; file_sha256 unrestricted-read noted.
- Phase 7: report written to docs/audit/2026-09-27-system-audit.md.
- No code modified. No commits.

## Session 2 (P0+P1 implementation)
- P0: migration 012 backfill (1000/1000 invoices journaled, ledger balanced 14.5M/14.5M, verified e2e); buildInvoiceJournal wired in addCase + restore script; roundMoney helper in financeDomain; sync failures surface via SyncStatusBanner + toast (banner proven live against a real UNIQUE failure during testing).
- Extra heal found needed: journal_lines duplicate ids in state abort sync (same class as notifications bug) — healed in syncCore.
- P1: CSP parity in tauri.conf.json (ipc: sources added for Tauri v2); file_sha256 restricted to db-dir + update temp-dir (zero existing callers verified); login backoff (5 fails → 30s doubling lock, cap 5min, pure policy + tests).
- Gates: tsc clean, 121/121 tests, vite build, cargo check all green.
- Incident: two accidental wipes of the throwaway preview profile (synthetic syncCollectionsToDb with empty arrays + debounced snapshot flush). Recovered via .freebuff/restore-preview-profile.cjs which rebuilds the dataset with journals posted.

## Session 3 (P2 + legacy retirement + render caps)
- P2 done: paymentDomain.ts extracted (deriveSimpleStatus, buildInvoiceAllocation, buildPaymentSideEffects, buildPaidInFullNotification); recordPayment + bulkMarkPaid + deletePayment + updateInvoice refactored onto it; getLedgerEntries wrapped in useCallback (fixes GLV memo).
- Legacy retirement: sqliteDbService.ts DELETED (985 LOC). All 9 fallback reads moved to repos. sqliteStorage.ts KEPT — its dump exporter powers SettingsView's live export (audit overstated its deadness; corrected).
- Render caps: BillingView 300-row cap + Show More; LabListView 120-card cap; GeneralLedgerView 400-row cap with full-period totals preserved (closing balance PKR 9,332,500 Dr verified equal to dashboard receivables).
- MAJOR discovery during e2e: sql.js export() silently resets PRAGMA foreign_keys to OFF — every FK/cascade guarantee died after the first snapshot save. syncCore's DELETE FROM labs ran before cases with FK off (masked), then failed with FK on. Fixed: re-assert PRAGMA after every export (saveSnapshot + beforeunload), FK-safe child-before-parent delete ordering in syncNow, orphan purge for legacy rows. Regression tests in tests/db/fkPragma.test.ts (124/124 green).
- Bundle: 257.6 → 234.1 kB main chunk after legacy deletion.
- E2E verified: 1000/1000 invoices journaled, balanced 14.5M/14.5M, sync clean across navigation, caps proven live (300→600 invoices, 120 clinics, 400→800 ledger rows).

## Session 4 (P3: settings split + console noise + integrity self-check)
- Settings split: 2282-LOC SettingsView.tsx → 143-LOC container (header, identity card, TabsNav, shared backupMessage + liveTableStats, initBackupScheduler) + 8 per-domain tab files in src/components/settings/: BrandingTab (550), BackupTab (570, owns IntegrityPanel), UsersTab (327), TestingTab (254), PrintTab (195), AccountTab (167), UpdatesTab (128), PreferencesTab (91). Mechanical extraction, no behavior change; tabs own their own state; container passes only shared backupMessage/liveTableStats props. Dead container state (editingUserId, sectionKind, etc.) dropped with the move.
- Console noise fix: root cause was CSP-refused raw.githubusercontent.com (P1 CSP omitted it) + CORS failure on beingadil.github.io. Fix: connect-src += https://raw.githubusercontent.com in index.html AND tauri.conf.json; quietFetch helper in updateService.ts swallows expected update-check fetch failures; frame-ancestors 'none' removed from index.html meta (ignored+warned in meta context; kept in tauri.conf.json which is header-delivered).
- Integrity self-check: src/db/integrityCheck.ts — runIntegrityCheck(engine) returns IntegrityReport {ok, ranAt, findings[]}; checks FK pragma = ON, PRAGMA foreign_key_check clean, targeted orphans (journal_lines/invoice_items/case_teeth/payments/case_notes), ledger balance (|d−c| > 0.005), invoices without journal (skipped if journal tables absent). runIntegrityCheckSafe() boot-safe wrapper. AppContext runs it once per boot (ref-guard, after DB hydration) and exposes integrityReport; BackupTab renders the panel above backup actions. Read-only, never mutates.
- Tests: tests/db/integrityCheck.test.ts — healthy DB green, FK-off detected, orphan detected, unbalanced journal detected, unjournaled invoice detected (5 tests; orphan fixture inserted with pragma off to mirror the real failure mode).
- Gates: tsc clean, 129/129 tests, vite build green.
- E2E (live preview :3001): all 8 tabs render; integrity panel shows ALL CHECKS PASSED with 5 per-check verdicts; boot console clean — zero CSP/CORS errors, update-manifest fetch 200. Note: vite moved to :3001 (stale :3000 listener not ours, left alone).
- Audit doc updated: per-finding resolution status (RESOLVED/PARTIAL/OPEN/NONE) + re-grade SPEC 7→8, DESIGN 4→7, CORRECTNESS 6→8, QUALITY 6→7.

## Session 5 (post-P3: AppContext decomposition, audit top recommendation)
- Goal: move notification generation + voucher logging out of AppContext along the existing context/hooks/ seam (audit F2 continuation, karpathy-verified claims before writing).
- New pure modules: src/services/notificationDomain.ts (197 LOC — buildStatusChangeNotification, buildQcFailedNotification, buildOverdueAlerts, buildUnpaidInvoiceAlerts, buildAdvanceDepositNotification + V2 variant, buildAdvanceSettledInvoiceNotification, buildAdjustmentNotification, buildPaymentReceivedNotification, buildGenericNotification, prependUniqueNotifications dedupe-on-prepend helper), src/services/voucherDomain.ts (41 LOC — assembleVoucher, buildVoucherCaseNote).
- New hooks: src/context/hooks/useNotificationsDomain.ts (96 LOC — mark/unread/archive/restore/delete/bulkDelete/clear management + addNotification + pushNotifications; takes notifications/setNotifications + optional bulk-delete toast callback so the info toast stays in AppContext), src/context/hooks/useVoucherLogging.ts (61 LOC — saveVoucherToSystem with same genId shape, write-through vouchersRepo + mirrorSet, case-note trail, VOUCHER_SAVED workflow trigger).
- AppContext 3522 → 3366 LOC. All 7 inline notification constructor blocks + both auto-alert sweeps + the 8 list-management functions + saveVoucherToSystem replaced with domain calls; message strings byte-identical. Orphaned imports pruned (vouchersRepo, mirrorSet).
- Behavioral note: overdue/unpaid sweeps and QC/status notifications now flow through prependUniqueNotifications with the same deterministic ids — dedupe semantics preserved exactly (the sync-killing duplicate-id class stays guarded).
- Gates: tsc clean, 129/129 tests, vite build green (main chunk 236.63 → 238.64 kB, +2 kB from module split).
- E2E live: app boots clean, Inbox renders, Send Test Alert (addNotification path) → 1 item, Mark All Read → unread 0, Clear Read → empty; console clean after actions.

## Session 6 (AppContext decomposition — the three extraction targets)
- Target 1 — services/ledgerDomain.ts (350 LOC, pure): nextCase/Invoice/Payment/Advance/AdjustmentNumber generators, collectAllPayments (flat payment collection with backfilled invoice fields), buildLabFinancialSummary, buildLedgerEntries (double-entry ledger engine: invoice debits, payment/advance/credit-note credits, memo rows for advance allocations, posting-instant ordering with same-day offsets, running balance, newest-first return). Byte-identical arithmetic and ids. 9 unit tests (tests/services/ledgerDomain.test.ts): first-number, per-type adjustment prefixes, flatten+order, summary math incl. net/outstanding/advance balance, ledger debit/credit/memo/balance, clinic filter.
- Target 2 — services/transactionDomain.ts (567 LOC, pure) + hooks/useTransactionCommands.ts (508 LOC): all 7 V2 cashier flows (recordTransaction, advanceDeposit, applyAdvanceCredit, issueCreditNote, reverseTransaction, reconcileItem, flagReconciliationException). Shared buildAuditEvent helper replaces ~10 inline AuditEvent literals (audit field set: PAYMENT_COLLECTED, ADVANCE_DEPOSIT_RECORDED, ADVANCE_CREDIT_APPLIED, CREDIT_NOTE_ISSUED, TRANSACTION_REVERSED ×3 entity kinds, RECONCILIATION_VERIFIED/EXCEPTION). Pure helpers: prepareTransaction (over-allocation invariant throw kept), applyPaymentToInvoice, prepareAdvanceDeposit, allocateAdvancesFifo, buildAdvanceAllocationPayment, buildCreditNoteAdjustment, markReversal, buildReversalAuditEvent, buildReconciliationUpdate. formatPKR imported so audit strings stay byte-identical.
- Target 3 — hooks/useAuthDomain.ts (434 LOC): createInitialAdmin, login (backoff + role routing), logout, addUser/updateUser/deleteUser/changePassword, getBackupData (snapshot), restoreBackupData (setter fan-out), resetToDemoData, wipeAllData (incl. non-synced table purge + dsw_* localStorage sweep).
- AppContext: 3366 → 2042 LOC (−1324, −42% from the P3 baseline 3522). Body is now: state hydration, boot effects, case/lab CRUD setters, derived counters, provider value.
- Gates: tsc clean, 138/138 tests (129 + 9 ledger), vite build green (main chunk 238.64 → 242.91 kB, +4 kB from module split).
- E2E (user-tested live): clinic registration + case creation + finance flows exercised manually, app functional end to end.



