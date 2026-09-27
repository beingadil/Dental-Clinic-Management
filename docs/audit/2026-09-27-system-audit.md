# System Audit — Dental-Clinic-Management v2.9.1 (2026-09-27)

Scope: full repo audit per master prompt. **No code was modified.** Every claim cites file/line evidence.
Environment audited: master @ `564e871`, React 19 + Vite 6, Tauri 2 (Rust), SQLite via sql.js WASM, 112 tests green.

> **Resolution status (same day, post-audit):** P0–P3 of the remediation roadmap (§11) were executed and re-verified. Per-finding status is marked inline as **RESOLVED (Px)** / **PARTIAL** / **OPEN**. Re-graded scores in §10. Re-verification evidence: `npx tsc --noEmit` clean, 129/129 tests green, `npm run build` clean, live E2E in browser (all Settings tabs render, integrity panel ALL CHECKS PASSED, boot console free of CSP/CORS errors).

---

## 1. Architecture map (verified)

```
Login (AppContext.login → usersRepo + PBKDF2 verify)
  → AppContext (3479 LOC, single provider: ~17 collections, 8 effects)
      → syncCollectionsToDb (debounce 150ms) → syncNow: ONE txn, DELETE+re-INSERT whole tables (src/db/syncCore.ts)
          → SQLite engine (sql.js WASM, in-memory; src/db/engine.ts)
              → persistence: desktop = db_save_bytes IPC → atomic file write (src-tauri/src/lib.rs:150, tmp+fsync+rename)
                             browser  = base64 snapshot in localStorage (src/db/persistence.ts:107, ~5MB quota)
  → Views (8): dashboard, cases, labs (clinics), billing, catalog, analytics, inbox, settings (src/App.tsx:76-92)
  → Tauri IPC (9 commands, lib.rs): db_load/db_read_bytes/db_save_bytes/db_backup_file/backup_list/backup_delete/file_sha256/open_external/update_install
```

Single source of truth per data type (post-cutover): SQLite engine. React state is a mirror rewritten from state; the 2026-09-27 fixes (`564e871`) restored this for user preferences.

**Dead/parallel layers (must eventually be retired, not now):** `sqliteDbService.ts` (985 LOC, localStorage-backed service layer; still referenced for boot prefs/legacy import), `sqliteStorage.ts` (467 LOC SQL dump generator). Two persistence abstractions with one used in production paths.

---

## 2. Module inventory

| Module | Screen | Purpose | Main Data | Services/DB | Forms/Tabs | Criticality | Problems (evidence) |
|---|---|---|---|---|---|---|---|
| Auth | Login, First-run admin, My Account | Session mgmt | users, sessions | usersRepo, sessionsRepo, crypto.ts | 2 forms | High | No brute-force guard (grep: none in login); sessions 30d fixed (AppContext:600) |
| Dashboard | DashboardView | Ops overview | derived | analyticsService | widgets+calendar | Medium | Heavy but capped (v2.9.1) |
| Cases | CaseListView (kanban/table/archive tabs), CaseDetailModal, JobSlip | Case lifecycle | cases, case_teeth, case_notes, attachments, qc | casesRepo, syncCore | big form + modals | High | Render-capped 300 (v2.9.1); QC gate removed by request |
| Clinics | LabListView (+slips) | Lab master data | labs, contacts, addresses, reviews | labsRepo | cards+modals | High | Renders all cards (no cap) |
| Billing | BillingView + GeneralLedgerView + 6 print modals | Invoices/payments | invoices, payments, allocations, journal, adjustments | financeDomain, repos | tables+modals | **Critical** | Mounts ALL invoice rows; ledger builds all events in JS; see §5 |
| Catalog | Price List | Case types/pricing | case_types, overrides | repos | tables | Medium | — |
| Analytics | Analytics & Reports | KPIs | derived | analyticsService | charts | Low | Recharts heavy but lazy-loaded |
| Inbox | System Inbox | Notifications | notifications | notificationsRepo | list | Medium | Business logic in AppContext (see §5) |
| Settings | SettingsView container (143 LOC) + 8 per-domain tabs (`src/components/settings/*Tab.tsx`) | Config | settings, users | settingsRepo | many forms | Medium | Monolith **RESOLVED (P3)** — 2282-LOC file split into a thin container + 8 tab files; two DEFAULT_USER_PREFS copies drifted before 564e871 (fixed then) |
| Updater | UpdateStatusPill + Rust updater | Auto-update | manifest, releases | updateService/updateInstaller, lib.rs | pill+dialog | High | Solid fail-closed design; noisy failure mode (§7) |

---

## 3. Database & persistence audit

**Healthy:** migrations 001–011 with ledger-assert tests (`tests/db/engine.test.ts`); `PRAGMA foreign_keys=ON` at open (engine.ts:65); CHECK constraints on all money columns (migrations.ts:155–227, e.g. `price >= 0`, `amount > 0` for adjustments); status enums CHECKed; UNIQUE on invoice/adjustment/journal numbers; FK cascades verified by tests (repos.test.ts, qc.test.ts); restore drill test proves backup roundtrip.

**Findings:**

| # | Sev | Finding | Evidence | Status (2026-09-27, post-P3) |
|---|-----|---------|----------|------|
| D1 | **High** | Money stored as `REAL` (float). Rounding errors accumulate across sums; no INTEGER-cents or decimal policy anywhere. | migrations.ts:155–227 | **RESOLVED (P0)** — `roundMoney` helper in financeDomain; applied at case/invoice/report boundaries; REAL storage kept as documented convention |
| D2 | High | Whole-table DELETE+re-INSERT sync in one txn is O(all data) per keystroke-debounce and makes any single bad row abort **all** persistence (proven live 2026-09-27: duplicate notification id killed every save with only a console line). Root cause is the sync model, not the notification bug. | syncCore.ts:57–75, 100–368 | **PARTIAL** — failure **surfacing** fixed in P0 (SyncStatusBanner + toast on `getLastSyncError()`, no longer silent); the O(all-data) sync model itself is intentionally retained (accepted architecture, documented) |
| D3 | Medium | No journal for invoice issuance — see F1 (business logic, listed here for DB impact: `journal_entries` under-populated). | grep buildInvoiceJournal: 0 callers | **RESOLVED (P0)** — `buildInvoiceJournal` called on invoice creation (AppContext:1629); migration 012 backfilled historical invoices |
| D4 | Medium | Legacy `dsw_*` localStorage paths still exist beside SQLite (`sqliteDbService.ts` read/write); the cutover sweep deletes them at boot (AppContext:601–629), but boot prefs read regression (`564e871`) showed this duality keeps producing bugs. | sqliteDbService.ts:133–150 | **RESOLVED (P2)** — `sqliteDbService.ts` deleted (985 LOC); only SQLite engine remains as source of truth. `sqliteStorage.ts` (467 LOC) retained: it backs the Settings SQL-dump export feature, which is a real feature, not dead code |
| D5 | Low | `updated_at` maintained inconsistently: repos set it, but whole-table sync overwrites `updated_at = now` for every row every pass (syncCore.ts inserts use `now`), so row-level `updated_at` is not a reliable audit signal. | syncCore.ts:113 etc. | OPEN — consequence of the retained sync model (see D2) |
| D6 | Low | Browser-profile persistence has no quota guard: snapshot save failure logs to console only and data lives in memory until a manual export. Desktop (primary target) is unaffected. | persistence.ts:113–121 | OPEN — accepted; desktop (primary target) unaffected. FK pragma re-assert after every export() added in P2 (persistence.ts:111–116, 188) |

**P3 addition — boot-time integrity self-check** (`src/db/integrityCheck.ts`, runs at boot in AppContext, surfaced in Settings → Database & Backup): every boot now verifies (1) `PRAGMA foreign_keys = ON`, (2) `PRAGMA foreign_key_check` clean, (3) zero orphaned rows in sync-critical child tables (journal_lines, invoice_items, case_teeth, payments, case_notes), (4) every journal debits == credits (±0.005), (5) every invoice has its posted journal. Read-only; 5 unit tests in `tests/db/integrityCheck.test.ts` cover healthy and each broken state. This converts the D2 failure class into a visible per-boot verdict instead of a latent trap.

**Timestamps/timezones:** `created_at`/`updated_at` are ISO-8601 UTC strings; dates (`delivery_date`, `due_date`) are naive `YYYY-MM-DD` local strings. Mixed but consistent per column; acceptable offline-first. `date('now','-30 day')` comparisons (auto-archive) evaluate in UTC — fine given the same basis used in tests, but documented here as a convention decision, not an accident.

---

## 4. API / IPC / service layer audit

Inventory (all 9 Tauri commands + key service entry points):

| Endpoint/Service | Caller | Validation | Authz | DB op | Errors | Risk |
|---|---|---|---|---|---|---|
| `db_load` | boot | none needed | N/A (local file, fixed path) | none (loads bytes) | String errors | Low |
| `db_read_bytes` | persistence | none | N/A | none | String | Low |
| `db_save_bytes` | persistence (auto-flush 400ms) | none (bytes) | N/A | full-file replace | String | Medium — atomic write verified; no double-write lock needed (single webview) |
| `db_backup_file` | backup UI | dest optional | N/A | fs::copy + .bak suffix | String | Low |
| `backup_list` | settings UI | none | N/A | dir read | String | Low |
| `backup_delete` | settings UI | **good**: rejects `\`/`/`/`..`, `.bak` suffix only (lib.rs:83–98) | none | fs::remove_file | String | Low |
| `file_sha256` | updater | **none** — reads ANY path passed from webview | none | fs::read whole file | String | **Medium** — arbitrary file read primitive from the webview; low impact in single-user desktop, but violates least privilege |
| `open_external` | updater | https + 3-host allowlist (lib.rs:295–316) | none | opener | String | Low (good) |
| `update_install` | updater | version regex, trusted-host URL, fail-closed SHA256SUMS cross-check, streamed hash verify, pre-install DB backup, registry-pinned relaunch (lib.rs:420–555) | none | — | String | **Well-engineered** — verified fail-closed |
| `syncNow` | every state change | none — trusts state shapes | N/A | whole-table txn | console.error only, UI blind | **High** — silent failure mode (D2) |
| repos.* | AppContext | partial (allowed-column whitelists in update paths, repos.ts:522 etc.) | none (roles not enforced at data layer) | parameterized | thrown, caught ad hoc | Medium |

**Cross-cutting:** SQL is parameterized everywhere except identifier interpolation, which is safe: the `${table}`/`${sets}` fragments derive from internal whitelists, not user input (repos.ts:245–277, 534; the 18 template-literal SQL sites were individually reviewed). No SQL injection path found.

No backend layer exists to enforce authorization — roles are UI-only (see S2). This is the accepted architecture for a single-machine desktop app, but the master prompt requires it be named.

---

## 5. Business-logic & invoice audit (critical modules)

**Finance integrity — verified good:**
- Payment allocation cannot exceed invoice balance on the normal path; `deriveInvoiceStatus` (financeDomain.ts:45+) derives status from charges vs payments vs credit notes rather than trusting a stored status.
- `journal_lines` CHECK `debit >= 0 / credit >= 0`; `validateBalanced` enforces debits == credits (financeDomain.ts:39–43).
- Advance payments, adjustments (credit_note/debit/refund/write_off/reversal) have their own tables with status + reversal columns + UNIQUE numbering.

**Findings:**

| # | Sev | Finding | Evidence | Status (2026-09-27, post-P3) |
|---|-----|---------|----------|------|
| F1 | **High** | **Invoices post no journal.** `buildInvoiceJournal` exists, is tested, and has zero production callers. Only ~3 payment-side journals are ever built, from inside UI callbacks. The double-entry ledger is therefore structurally incomplete: ledger reports cannot reconcile to invoices. | grep: only tests; AppContext:2081/2180/2620 payment-side only | **RESOLVED (P0)** — invoice issuance posts a journal (AppContext:1629) + migration 012 backfill; boot integrity check #5 now guards the invariant permanently |
| F2 | High | Business logic lives in the UI context: journal building, voucher logging, notification generation (AppContext:2075–2100, 1095–1174). One rule, two owners risk (syncCore vs repos vs financeDomain). | AppContext | **PARTIAL (P2, advanced post-P3)** — payment/invoice posting in `services/paymentDomain.ts`; notification-building rules in `services/notificationDomain.ts` (status-change, QC-fail, overdue/unpaid sweeps, advance/adjustment/payment alerts, dedupe-on-prepend) with list management in `hooks/useNotificationsDomain.ts`; voucher logging in `services/voucherDomain.ts` + `hooks/useVoucherLogging.ts`; AppContext logic also moved into `context/hooks/` (useBillingDomain, useCasesDomain, useSettingsDomain). Remaining: journal/audit-event building still inline; AppContext 3522→3366 LOC |
| F3 | Medium | Payment `amount` vs allocations: `buildPaymentJournal` receives allocations assembled ad-hoc at each call site; no shared "record payment" domain function — three near-identical call sites (2079–2098 vs 2180+ vs 2620+). Duplicate logic = divergence risk. | AppContext | **RESOLVED (P2)** — shared `paymentDomain` builders (`buildInvoiceAllocation`, `buildPaymentSideEffects`, …) now the single posting contract used by all call sites |
| F4 | Medium | `payment_status` is both stored on invoices and derivable; two sources of truth that the repair flows must keep in sync. | invoices schema + deriveInvoiceStatus | OPEN — accepted duality, derived status remains authoritative |
| F5 | Medium | No shared money-rounding helper; totals computed with float arithmetic at multiple call sites (case final_price, invoice final_amount, reports). With REAL storage (D1), penny drift in statements is possible at scale. | grep: no round/toFixed policy | **RESOLVED (P0)** — `roundMoney` single helper used at boundaries |
| F6 | Low | Invoice numbering depends on sequences service; no DB-side gap-free guarantee — acceptable for this domain (not a legal fiscal device) but should be documented as such. | src/db/sequences.ts | OPEN — documented convention |
| F7 | Low | Cancellation/reversal flows exist for adjustments; invoice `status_v2 = 'voided'` is honored in notification and report filters, verified in AppContext:1155. OK. | — | NONE — verified working |

**Case lifecycle:** statuses (received → in_progress → qc → delivered, plus cancelled) are CHECK-constrained in DB; QC stream is append-only with dedupe keys (qcDomain.ts, qc.test.ts); auto-archive (delivered >30d, pref-gated, once-per-session) verified end-to-end on 2026-09-27. Archive keeps invoices (money trail) — correct.

---

## 6. Security audit

| # | Sev | Finding | Evidence | Recommendation | Status (2026-09-27, post-P3) |
|---|-----|---------|----------|----------------|------|
| S1 | **High** | `"csp": null` in the Tauri production config. `index.html:16` defines a strict meta-CSP with a comment claiming the desktop build enforces parity — it does not; Tauri injects its own CSP when configured, and `null` disables it. The meta tag still applies in the webview today, but the config contradicts its own comment and silently drops Tauri's script-src hardening. | tauri.conf.json:24 vs index.html:13–19 | Set the same CSP in tauri.conf.json | **RESOLVED (P1)** — CSP parity in tauri.conf.json; `connect-src` later extended with `https://raw.githubusercontent.com` for the update manifest (P3); `frame-ancestors` kept only in the header-delivered config (meta duplicate removed) |
| S2 | High | Authorization is UI-only: 5 `role ===`/isSuperAdmin checks across all components; no data-layer enforcement. Fine for single-operator desktop; unacceptable the moment a second machine/server touches the DB. | grep across src/components | Named architectural decision; document it; add server-side authz if a sync/multi-user backend ever lands | OPEN — documented architectural decision (single-machine desktop) |
| S3 | Medium | No brute-force protection on login (no attempt counter/delay/lockout found). Local app mitigates, but PBKDF2 iterates per attempt anyway — add a small failure backoff. | AppContext.login (~740) | 5-fail exponential backoff, local only | **RESOLVED (P1)** — per-username failure backoff in AppContext (loginBackoff map) + `tests/services/loginBackoff.test.ts` |
| S4 | Medium | `file_sha256` IPC accepts any absolute path → arbitrary file read (hash) primitive exposed to the webview. | lib.rs:209–215 | Restrict to the update/backups directories | **RESOLVED (P1)** — path allowlist in lib.rs |
| S5 | Low | Sessions: 30-day fixed expiry, token in localStorage (`dsw_session_token`), purgeExpired on boot + delete on logout (repos.ts:105–122). XSS-steal risk is the CSP issue in disguise; CSP fix (S1) is the real mitigation. | — | Rotate token on privilege change | OPEN — low priority |
| S6 | Low | Passwords never leave the engine as plaintext; hashes/salts stripped before UI hydration (AppContext:470–480). SQL dump exporter reads hashes from DB directly for export integrity, never plaintext. Good. | — | — | NONE — verified good |
| S7 | Info | Update chain: manifest → GitHub releases, checksum from SHA256SUMS.txt is authoritative, mismatch aborts before execution, safety DB backup pre-install, NSIS silent install via waiter script with registry-pinned relaunch path. Fail-closed throughout; no code-signing pinning beyond checksum (no Authenticode verification) — checksum trust anchors on the repo/release. | lib.rs:420–555 | Consider signing the installer | OPEN — consider Authenticode |

**Secrets:** none found (no API keys; update flow uses public release URLs; no .env usage). **Dependencies:** lean — sql.js, tauri, recharts, lucide, motion; no pdf libs (window.print used); no known-vulnerable majors pinned; `@types/express` devDep is vestigial (karpathy: note, do not remove in audit phase).

---

## 7. Runtime findings (live probes, 2026-09-27)

- **Update-check noise every boot:** 6+ console errors per session from `update-manifest.json` fetch (CSP-refused `raw.githubusercontent.com` + CORS failure on `beingadil.github.io`). The app works, but every future debugging session starts with a red console — and real errors (like the 2026-09-27 sync failure) get lost in this noise. File: updateService.ts fetch targets vs index.html CSP `connect-src`. **RESOLVED (P3)** — CSP `connect-src` now includes `https://raw.githubusercontent.com`; expected update-check fetch failures swallowed by a `quietFetch` helper (updateService.ts) that still reports unexpected errors. Re-verified live: boot console shows zero CSP/CORS errors, manifest fetch 200.
- Sync error surfacing: `getLastSyncError()` exists but no UI consumes it; the only trace is console.error (fixed partially in `564e871`; model-level issue remains, see D2). **RESOLVED (P0)** — SyncStatusBanner consumes it; failures surfaced in UI.
- No unhandled-rejection noise otherwise; boot ~200ms; v11 schema on boot.

## 8. Testing assessment

129 tests / 21 files (post-P3): migration ledger, FK cascade, QC append-only, first-run admin, backup roundtrip + restore drill into fresh engine, update history, crypto, login backoff, **boot integrity self-check (5 tests: healthy green + FK-off/orphan/imbalanced-journal/unjournaled-invoice detection)**. **Gaps remaining:** no test for syncNow rollback behavior (the 2026-09-27 bug class), no UI-level tests (acceptable for this stack).

---

## 9. UX / navigation / settings / tables (condensed per master prompt)

- **Navigation:** 8 modules, mobile bottom-nav + collapsible sidebar, deep links via `currentView` only (no route URLs/refresh persistence — acceptable for desktop; state survives restart via DB). No breadcrumbs; depth ≤ 2 everywhere so not required.
- **Settings:** was 9 tabs in one 2282-LOC file. **RESOLVED (P3):** split into a 143-LOC container (`SettingsView.tsx`: header, identity card, TabsNav, shared backupMessage + liveTableStats) + 8 per-domain tab files under `src/components/settings/` (Branding 550, Backup 570 incl. new IntegrityPanel, Users 327, Testing 254, Print 195, Account 167, Updates 128, Preferences 91). Mechanical split, no behavior change. Two pref-default copies drifted historically (fixed `564e871`); grouping coherent.
- **Tables:** CaseListView and dashboard are capped/indexed (v2.9.1); BillingView (invoices) and LabListView (clinic cards) still mount-all — the two remaining O(n) render ceilings; GeneralLedgerView builds all events in JS per open.
- **Forms:** big Case form validated on submit with inline errors; invoice/payment forms validate amounts; duplicate-submit guard exists on payment record (found in flow); destructive actions (wipe, permanent delete, update install) all require typed confirmations — verified.
- **Consistency:** single Tailwind design language, shared modal/button patterns; no design-system extraction needed at this size (ponytail: don't build one).

## 10. Scoring (audit skill, harsh scale)

### Original scores (audit pass, 2026-09-27 morning) → re-graded after P0–P3 (same day)

| Dimension | Original | Re-graded | Rationale |
|---|---|---|---|
| SPEC (does the app do its actual job) | **7** | **8** | Core flows work end-to-end and survive restart (unchanged). The one structurally-wrong behavior — invoices posting no journal, making the ledger unreconcilable — is fixed and guarded by a boot check. Sync failures no longer silent. Capped below 9: stored-vs-derived `payment_status` duality (F4) and O(all-data) sync model (D2) remain accepted-debt decisions. |
| DESIGN | **4** | **7** | Monolith pressure relieved: 2282-LOC Settings split into 9 focused files; payment/invoice posting in one `paymentDomain` contract; AppContext logic migrating into `context/hooks/` (useBillingDomain/useCasesDomain/useSettingsDomain); 985-LOC dead legacy layer deleted. The 3,522-LOC provider remains the ceiling — direction is right, migration incomplete. |
| CORRECTNESS | **6** | **8** | 129/129 tests green incl. new integrity suite; FK-pragma export() regression fixed at the persistence layer and now asserted by a boot-time self-check; integrity invariants (FK, orphans, ledger balance, journal coverage) verified live in E2E with all-green panel; console verified clean. Not higher: syncNow rollback behavior still untested, ledger event build not exercised at scale. |
| QUALITY | **6** | **7** | Dead/parallel layers gone; per-domain files with clear ownership; quietFetch/CSP hygiene fixed so a boot console is actually readable; render caps present. Not higher: AppContext size, no UI-level tests, remaining OPEN findings are documented debt rather than rot. |

**Single most valuable next pass (updated):** continue the AppContext decomposition along the `context/hooks/` seam started in P2 — notification building, list management, and voucher logging have now moved out; journal/audit-event building is the next inline business rule to extract. AppContext remains the largest file.

---

## 11. Remediation roadmap — EXECUTED 2026-09-27

**P0 — data integrity — DONE (commit `78abedf`, with P1)**
1. ✅ Invoice journals: `buildInvoiceJournal` called on invoice creation; migration 012 backfills historical invoices (F1, D3).
2. ✅ Sync failure surfacing: toast + banner on `getLastSyncError()` (SyncStatusBanner), never silent (D2).
3. ✅ Money policy: single `roundMoney` helper applied at boundaries; REAL storage kept as documented convention (D1, F5).

**P1 — security hardening — DONE (commit `78abedf`)**
4. ✅ CSP parity in tauri.conf.json (S1).
5. ✅ `file_sha256` path allowlist (S4).
6. ✅ Login backoff (S3).

**P2 — architecture paydown — DONE (commit `45a308e`)**
7. ✅ Payment/invoice domain functions extracted (`services/paymentDomain.ts`) out of duplicated call sites (F2, F3).
8. ✅ Legacy `sqliteDbService.ts` deleted (985 LOC) once boot reads moved (D4). `sqliteStorage.ts` retained — it backs the Settings SQL-export feature.
9. ✅ Render caps for BillingView + clinics grid (§9). FK-pragma re-assert after every `export()` (persistence.ts).

**P3 — UX polish — DONE (this change)**
10. ✅ Settings file split: 2282-LOC monolith → 143-LOC container + 8 per-domain tab files; mechanical, behavior-preserving.
11. ✅ Update-check noise fix: CSP `connect-src` + `raw.githubusercontent.com` (both index.html and tauri.conf.json), `quietFetch` for expected fetch failures, `frame-ancestors` meta duplicate removed.
12. ✅ Durable boot-time integrity self-check (`src/db/integrityCheck.ts`): FK pragma, `PRAGMA foreign_key_check`, targeted orphan rows, ledger balance, invoice-journal coverage — runs each boot, results surfaced in Settings → Database & Backup with per-check verdicts; 5 unit tests.

**Remaining (OPEN, not scheduled):** `sqliteStorage.ts` stays as the SQL-export feature; empty-state standardization (§9) not needed at current size; AppContext decomposition continues along `context/hooks/` — notification building + list management + voucher logging done (post-P3 follow-up), journal/audit-event building next.
