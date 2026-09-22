# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/) and the
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Quality Control module** — QC recording and the case quality gate, the
  feature the dashboard's "First-Pass QC" KPI was waiting on.
  - `qc_inspections` (migration **005**): an append-only inspection stream with
    a `UNIQUE(dedupe_key)` idempotency guard, FK cascade to the case, and CHECK
    constraints on `kind` and `result` — the same discipline as `ledger_entries`.
    Corrections are appended (`kind = 'correction'` + `supersedes_id`); nothing
    is ever mutated or deleted.
  - `src/services/qcDomain.ts`: pure, storage-agnostic rules — reason codes,
    derived per-case QC state (attempts, first-pass, last failure), the release
    gate, and KPIs (First-Pass QC %, rework rate, top failure reasons, inspector
    throughput). Rates are `null` — never a fabricated 0% — when uninspected.
  - `src/db/repos.ts`: `qcInspectionsRepo` (all, forCase, byId, byDedupeKey,
    insert, count, countFailures) and no update/delete by design.
  - `src/db/syncCore.ts`: QC rows participate in the write-through rebuild, so
    the quality history survives every boot sync.
  - `useApp()` surface: `qcInspections`, `recordQcCase(command)`, `getQcState`,
    `getQcMetrics`; `updateCase` now refuses `ready`/`delivered` without a
    passing inspection (other edits in the same call still apply).
  - Case detail panel: "Quality Check" block — one-click **Pass QC**, **Fail QC**
    with structured reason + optional note, and the full inspection trail.
  - Dashboard: "First-Pass QC" now renders the real derived rate (em dash only
    when there is genuinely no QC data).

### Security
- **No credentials ship with the build.** The `BOOTSTRAP_USERS` array (plaintext
  `adil123`/`admin123`/`tech123`/`bill123` plus the lab's real emails) is deleted; seeding
  and the legacy importer no longer create accounts, so a fresh profile provisions its
  first Super Admin through the login screen with an operator-chosen password.
  `addUser`/`createInitialAdmin` reject passwords under 8 characters (no `changeme123`
  fallback), and the unused quick-fill credential helper is gone from the login page.
- **User management persists.** `updateUser` now writes through `usersRepo.update()`
  (including PBKDF2 re-hash on password reset, which the Settings reset path uses) and
  `deleteUser` calls `usersRepo.delete()`, protecting the Super Admin by role rather than
  by the hardcoded username `adil`.
- **CSP enabled** for the desktop shell (`tauri.conf.json`) and the web build
  (`index.html`), with `referrer: no-referrer`; connect-src is limited to the update
  endpoints.
- **SQL export fixed**: the dumped `users` DDL/INSERT now match the real schema
  (`password_hash`/`password_salt`) and read hashes from the database; `escapeSqlString`
  escapes backslashes and strips NUL bytes.
- **Import hardening**: `.dentalbackup` restore enforces the extension and a 512 MB cap and
  takes a safety snapshot first; `.dentalupdate` import caps at 64 MB; the logo upload
  validates an image MIME allow-list.
- **Wipe actually wipes**: `wipeAllData` also purges the SQLite tables outside the
  collection sync (chairside, clinical specs).
- Random IDs and session tokens now use the platform CSPRNG; `vite.config.ts` disables
  source maps and pins the minifier.

### Fixed
- `tests/services/update.test.ts` fixtures were pinned to `2.1.0` and had been failing since
  the app version reached 2.2.0 (every package was rejected as "not newer"); they now derive
  a version above the installed one.
- `tests/db/seeds.test.ts`, `tests/db/boot.test.ts` and `tests/db/engine.test.ts` updated for
  the security change (no accounts are seeded; the migration list is now 1–5).

### Tests
- `tests/services/qc.test.ts` (15 cases) and `tests/db/qc.test.ts` (8 cases)
  covering derivation, corrections, gate rules, honest-null metrics, migration
  005, the dedupe guard, CHECK enforcement, cascade delete and sync survival.

## [2.0.1] — 2026-09-18

### Fixed
- **Packaged desktop app failed to boot** with `Database boot failed: expected
  magic word 00 61 73 6d` (`<!do` = HTML): the 2.0.0 installers had been built
  before the production WASM-URL fix landed, so the embedded bundle still
  resolved `sql-wasm.wasm` relative to the JS bundle → 404 → HTML parsed as
  WASM. Installers rebuilt with the corrected bundle (2.0.1).
- Boot path now validates the persisted snapshot/file against the 16-byte
  `SQLite format 3\x00` header before handing bytes to the engine. A corrupt,
  truncated, 0-byte, or non-SQLite file (e.g. a stale leftover from a crashed
  2.0.0 install) is rejected safely and the app starts from a fresh database
  instead of bricking — verified live by booting 2.0.1 over a 0-byte stale file
  (it created a valid 516 KB database).

### Changed
- Version bumped to 2.0.1 in `package.json`, `tauri.conf.json`, `Cargo.toml`,
  and the backup/update service (`APP_VERSION`), so new backups declare the
  correct version.

## [2.0.0] — 2026-09-17

### Added
- **Real SQLite database** (sql.js WASM, bundled locally) as the authoritative
  store for every module: cases, teeth, labs, invoices, payments, advances,
  adjustments, journal, ledger, notifications, audit, settings.
- Transactional migrations (001–004) with recorded history and safe failure.
- Typed repository layer with FK enforcement, CHECK constraints, and gap-free
  document sequences (DS-, INV-, PAY-, …).
- Legacy data migration: one-time localStorage → SQLite importer with per-record
  validation, quarantine, plaintext-password re-hashing, and a persisted report.
- PBKDF2-hashed authentication; plaintext passwords and hardcoded backdoor removed.
- Portable `.dentalbackup` format: checksummed, versioned, with validated
  restore (safety snapshot → engine swap → reload).
- Update system: online manifest check + offline `.dentalupdate` package import
  with SHA-256 verification; version `2.0.0` surfaced in Settings.
- Priority SLA model (urgent 1 / high 2 / normal 4 / low 7 days) with automatic
  due dates and badges across case forms and lists.
- Attachment validation service (MIME allow-list, 8 MB/file, 32 MB/entity).
- Desktop packaging (Tauri 2): real file-backed SQLite (`dental_solutions.sqlite`
  with WAL + atomic writes), NSIS/MSI installers, full app icon set.
- Application icon (SVG master + PNG/ICO/ICNS) and vendored offline fonts.

### Changed
- Dashboard and billing now compute every metric from live database records;
  fake fallback numbers removed.
- Case form simplified: duplicate status/material/shade controls unified;
  per-priority SLA shown on selection buttons.
- Google Fonts self-hosted; zero runtime network dependencies remain.

### Removed
- AI Studio (`@google/genai`), `express`, and `dotenv` (unused) dependencies.
- Plaintext demo-credentials panel and demo image URL from login/settings flows.

### Security
- Passwords stored only as PBKDF2-SHA256 hashes.
- SQL injection hardening (parameterized queries, table-name validation).
- `.gitignore` excludes databases, backups, and patient data from version control.
