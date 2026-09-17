# PRODUCTION RELEASE REPORT — Dental Solutions v2.0.1

All statuses are factual: PASS only where actually verified in this workspace.

## Version

**2.0.1** — incremented from 2.0.0 because a release-blocking bug fix shipped:
the packaged desktop app crashed at boot (`expected magic word 00 61 73 6d`)
because the 2.0.0 installers embedded the pre-fix web bundle. The boot path now
also validates the SQLite file header before engine load. Fixed in 2.0.1;
installers rebuilt and runtime-verified.

## Application Architecture

- React 19 + Vite + Tailwind SPA; TypeScript **strict** mode enabled and passing.
- SQLite (sql.js 1.13.0 WASM, vendored locally) is the authoritative store; typed
  repositories + transactional migrations 001–004.
- Tauri 2 desktop shell writes the same engine bytes to a real SQLite file.
- PASS — typecheck (strict), build, 63/63 tests.

## Database

- PASS — migrations apply once, idempotent on re-run (tested).
- PASS — FK enforcement + cascades, CHECK constraints (status enums, positive
  amounts), UNIQUE (lab names, document numbers) (tested).
- PASS — transactions, savepoints/nested rollback (tested).
- PASS — sequences gap-free and realignment-safe after import (tested).
- PASS — snapshot round-trip and corruption-header rejection (tested).
- PASS — repositories covered: labs, cases, case teeth/notes/history, invoices,
  items, payments, payment attachments/allocations, advances, adjustments,
  journal, ledger, reconciliation, notifications, settings, users, chairside,
  catalog, clinical specs, templates, vouchers, audit (tested).

## Offline Operation

- PASS — zero runtime `fetch`/XHR in application code (static scan; the only
  network code is the user-triggered update check in updateService).
- PASS — fonts vendored to `public/fonts`, WASM vendored to `public/vendor`,
  no CDN references remain.
- PASS — production build boots and operates in `vite preview` (live-verified:
  login, dashboard, case form).
- MANUAL TEST REQUIRED — full workflow pass with the physical network adapter
  disabled on the clinic machine.

## Modules Verified

- Dashboard: PASS (live) — all KPIs computed from DB records; empty state shows
  real zeros, no fabricated numbers remain (live-verified after the honesty fix).
- Cases / Job form: PASS (live) — SLA priority selector (Low 7d / Medium 4d /
  High 2d / Urgent 1d) auto-computes the delivery date; odontogram, per-tooth
  material/shade, auto-computed final price. Header duplicate of the priority
  selector removed (single selector remains beside the delivery date it drives);
  per-tooth notes label disambiguated from the case-level instructions field.
- Billing/Invoices/Payments/Ledger: PASS (tested) — 100k = 30k+20k+50k partial
  payments with derived status; balanced journal; per-lab running balances.
- Dental Workstation, Labs, Catalog, Analytics, Notifications, Calendar,
  Search, Settings: PASS (rendered from DB in live smoke test where exercised;
  CRUD covered by repo tests).

## Financial Verification

- PASS — partial payments, multiple payments, allocations, advances,
  adjustments, credit notes, reversals, journal balance CHECKs, ledger
  recompute, invoice status derivation, aging buckets (tested suite).
- Database/service calculations are authoritative; React state is a mirror.

## Backup/Restore

- PASS — package create with manifest + SHA-256; serialize/parse round-trip;
  corruption rejected by checksum; wrong magic rejected; newer format blocked;
  engine-swap restore brings back data and reattaches persistence; safety
  snapshot contains full DB (all tested in `tests/services/backup.test.ts`).
- PASS — restore UI in Settings validates before offering the destructive step.
- MANUAL TEST REQUIRED — restoring a `.dentalbackup` produced on machine A into
  a fresh install on machine B.

## Update System

- PASS — semver compare, downgrade protection, magic-header validation,
  SHA-256 tamper rejection, malformed package rejection (tested in
  `tests/services/update.test.ts`).
- PASS — both modes preserved: online manifest check and offline `.dentalupdate`
  import; no fake "offline automatic download" behavior exists.
- MANUAL TEST REQUIRED — end-to-end update install through the desktop installer.

## Security

- PASS — no API keys/secrets in repo (scanned); no patient/payment data in repo.
- PASS — passwords only as PBKDF2-SHA256 hashes; bootstrap plaintext limited to
  the documented `BOOTSTRAP_USERS` default-credential list (like router defaults,
  must be changed at first login); old backdoor removed (login verifies hashes).
- PASS — sessions stored as opaque tokens in the `sessions` table; user objects
  (with password fields) are no longer cached in localStorage.
- PASS — `.gitignore` excludes databases, backups, env files, build output.
- PASS — SQL is parameterized; table names validated against an allow-list.

## Testing

- PASS — **63 tests / 8 suites** (was 48): engine, repos, crypto, seeds,
  persistence, boot, **backup pipeline (new)**, **update service (new)**.
- PASS — `tsc --noEmit` in full `strict` mode (upgraded from non-strict).
- PASS — `vite build` green.

## Desktop Packaging

- PASS — **installers built on this machine (v2.0.1, Rust toolchain present):**
  - `src-tauri/target/release/bundle/nsis/Dental Solutions_2.0.1_x64-setup.exe`
  - `src-tauri/target/release/bundle/msi/Dental Solutions_2.0.1_x64_en-US.msi`
  - bare executable: `src-tauri/target/release/dental-solutions.exe`
  (stale 2.0.0 artifacts deleted; the WASM reference is confirmed embedded in
  the 2.0.1 exe)
  Fixes required during build: removed an invalid `fs:` capability permission;
  enabled rusqlite `bundled` (static SQLite, no external dependency).
- PASS — packaged 2.0.1 executable launches and boots the database **over a
  stale 0-byte file** left by the broken 2.0.0 run (the exact reported failure):
  the snapshot header guard rejected the bad file, the app started fresh, and
  wrote a valid `SQLite format 3` database (516 KB) at
  `%APPDATA%/pk.dentalsolutions.app/dental_solutions.sqlite`; WebView2 UI runs.
- PARTIAL — browser-side runtime smoke test passed live (login, session restore
  across reloads, dashboard honesty, case form). The equivalent in-app click
  path (create case → restart exe → verify data) must be done by the user on the
  installed app: automated UI-driving of the packaged exe is not available here.

## Git

- PASS — repository initialized; commit created and verified:
  `bcc8ea269c716ecbe915fe4cf1f4eb0497ff78c5` — author
  `beingadil <beingadil@users.noreply.github.com>` (repo-local config, per owner
  instruction; GitHub noreply email, sole contributor, no co-author trailer).
- PASS — pre-commit safety audit per owner requirements: **no `.env` file of any
  kind** (`.env.example` was found staged, then unstaged and deleted — the repo
  contains zero env files by explicit owner rule), no Freebuff files, no doc
  binaries (doc/docx/pdf/xls), no databases/backups, no secrets (content scan of
  the full staged diff: AWS/GitHub/Slack/Google key formats, private-key headers
  — all clean).

## GitHub

- PASS — remote `origin` = `https://github.com/beingadil/Dental-Clinic-Management.git`
  (URL provided by owner). Pushed `master` → `origin/master`; verified via
  `git ls-remote` (remote HEAD == local HEAD `bcc8ea2`). Pushed tree re-audited:
  197 files, zero matches for env/freebuff/sqlite/backup/build paths.

## Manual Tests Remaining

1. Full offline pass with Wi-Fi/ethernet physically disabled on the clinic PC.
2. Install from NSIS setup.exe → full smoke checklist (create case → restart →
   data persists → payment + screenshot → restart → backup → restore → search).
3. Cross-machine backup restore.
4. Physical printer test (invoice, receipt, job slip, lab card, statements) —
   print data renders from DB; hardware validation requires a real printer.

## Known Limitations

- `dsw_*` legacy localStorage keys are retained until the admin verifies data
  and takes a first `.dentalbackup` (clear via Settings → System Reset).
- `.dentalupdate` payload installation is applied by the desktop installer.
- QC benchmark metrics (First-Pass QC %) display "—" until a QC recording
  feature exists; they are no longer fabricated.

## Release Status

**RELEASED — v2.0.1 pushed to GitHub (`beingadil/Dental-Clinic-Management`,
commit `bcc8ea2`).** Code, database, financial integrity, offline capability,
installers, and tests verified. Remaining items are manual hardware/user
tests only (offline pass, installer smoke, cross-machine restore, printer).
