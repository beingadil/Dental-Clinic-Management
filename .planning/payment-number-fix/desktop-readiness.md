# Desktop Readiness — Tauri vs Electron + daily-use checklist

**Repo:** D:\Dental Management Software · app v2.12.3 · Evidence is file:line; anything unverified is marked (assumption).

## 1. Packaging facts (verified)

- **Tauri 2 desktop app already ships** — `src-tauri/tauri.conf.json:1-2` (`$schema` config/2), `package.json` deps `@tauri-apps/api`, scripts `tauri`, `tauri:dev`, `tauri:build`.
- Identity: productName **"Dental Solutions"**, version **2.12.3**, identifier **pk.dentalsolutions.app** (`tauri.conf.json:3-5`).
- Installer: **NSIS**, `installMode: currentUser` (`tauri.conf.json:28-43`) — per-user install, no admin prompt.
- Frontend: Vite build → `../dist` (`tauri.conf.json:6-11`).
- CSP (`tauri.conf.json:24-26`) allows only self + wasm-eval + `raw.githubusercontent.com`, `beingadil.github.io`, `api.github.com` for updates.
- Data file: desktop writes the exact sql.js engine bytes to `dental_solutions.sqlite` in the OS app-data dir over IPC (`src/db/persistence.ts:9-11, 46-59`), **atomically (tmp + fsync + rename)**. Browser fallback = localStorage snapshot (:7-8) with a bad-magic guard (:21-39).
- Capabilities: a single `src-tauri/capabilities/default.json`.
- Updates are **manifest-driven, not the Tauri updater plugin**: `plugins.updater` is absent from `tauri.conf.json`; `src/services/updateService.ts:3-16, 24-30` polls the CI-published `update-manifest.json` (raw gh-pages), falls back to the GitHub Releases API, user-confirmed download of the NSIS installer, plus an offline `.dentalupdate` USB path with checksum validation. Nothing is auto-replaced on disk mid-run (:8-10).

## 2. Electron question — answered

**No. Do not move to Electron.** The desktop shell already exists, ships NSIS installers and auto-update manifests, and is built on a WebView that Windows 10/11 already provides. Migrating would mean rewriting the shell (window controls, IPC, file IO, updater) for zero functional gain, while losing the atomic db_save IPC path this app depends on.

| | Tauri 2 (current) | Electron (hypothetical migration) |
|---|---|---|
| Runtime | OS WebView2 (present on Win10/11) | bundled Chromium + Node per install |
| Installer/RAM | smaller install, lower RAM | larger install, higher RAM |
| This app's IPC (`db_save_bytes`, `db_backup_file`) | shipped (`src/db/persistence.ts:46-59`) | rewrite required |
| Updater | manifest + NSIS installer (verified above) | would need a new updater pipeline |
| Risk of migration | zero (already works) | regression risk across every native surface |

The only Electron-adjacent downside of Tauri is the WebView2 dependency — already satisfied on this machine (the app is running).

## 3. Daily-use risk checklist (operator-facing)

- **"Database sync failed" banner = the SQLite rewrite transaction was rejected; work since the last successful sync exists only in memory.** Do not keep entering data. Note the last action, restart, re-enter. (Root causes fixed in this change set: duplicate payment/invoice/case/advance numbers, slice sharing, QC FK orphans, duplicate teeth/ids — all now healed at sync instead of aborting.)
- **Crash/restart:** the DB file is written atomically after every debounced sync (`src/db/persistence.ts:9-11`), so a crash loses at most the unsynced tail — never a half-written file.
- **Backups:** automatic schedule defaults to **daily, keep 7** (`src/services/backupScheduler.ts:34-39`); desktop copies the live SQLite file to app-data (`backupScheduler.ts:4-7`). State rides the normal backup/restore path (`backupService.ts`, Settings → Backup). Run the built-in restore drill once before go-live.
- **Auto-archive** of delivered cases and the **update check** run without user action (AppContext boot effects; `updateService.ts` boot check) — both are idempotent and safe offline.
- **Updates:** online check needs `raw.githubusercontent.com` / `api.github.com` reachable (CSP allows them, `tauri.conf.json:25`); on an offline PC use the `.dentalupdate` package import.

## 4. One-time duplicate-number repair utility (if ever needed)

Max 5 bullets — the sync healer already repairs duplicates on the next save, so this is only for a profile that needs reportable renumbering:
- Scan `payments.payment_number`, `advance_payments.payment_number`, `invoices.invoice_number`, `cases.case_number`, `account_adjustments.adjustment_number`, `qc_inspections.dedupe_key` for duplicates (prior art: `src/db/legacyMigrator.ts`, `src/db/integrityCheck.ts`).
- Reuse the syncCore `uniqueNumber` convention (`-D2/-D3`) so healed values match what the syncer would produce.
- Write inside one transaction, then re-export bytes via the persistence path.
- Emit an audit event per rename (number changes on receipts must be explainable).
- Never touch `id` columns; money rows are renumbered, never deleted.

## 5. Go-live checklist

**MUST-DO**
1. Rebuild with these fixes (`npm run tauri:build`) and install; the running build still has the buggy generators.
2. Note & re-enter any entries made while the sync-failed banner is up (they are memory-only and die with the process).
3. Take a manual backup, then run Settings → Backup → restore drill once.
4. Confirm backup schedule (default daily/keep 7) and its last-run result after the first day.
5. Sign the installer (`signtool`) if it leaves this PC; unsigned NSIS triggers SmartScreen warnings.

**NICE-TO-HAVE**
6. Verify the update path once (Settings → Updates) so the first real update isn't a surprise.
7. Keep the GitHub Pages `update-manifest.json` job green in CI; it is the primary update source.
8. Revisit the residual audit findings (`.planning/payment-number-fix/invoice-audit.md`, `case-audit.md`) before multi-user rollout.
