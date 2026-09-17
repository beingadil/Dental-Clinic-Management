# MIGRATION PROGRESS — Dental Solutions (localStorage → SQLite → Desktop)

Living status file. Updated after every major phase. Last updated: **2026-09-18 (production finalization pass complete — installers built, 63/63 tests, strict mode, live smoke test passed)**.

---

## Current phase

**Phases 0–10 + 12 COMPLETE.** Remaining: Phase 11 (final full test pass) and Phase 13 (git init + commit; push blocked until remote exists).

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Repository discovery, audits (`ARCHITECTURE_AUDIT.md`, `MIGRATION_AUDIT.md`) | ✅ Complete |
| 1 | Architecture: sql.js (WASM, bundled locally), persistence seam, repo layer | ✅ Complete |
| 2 | Database: engine, migrations 001–004, 30+ tables, transactions, FK enforcement, sequences | ✅ Complete (tested) |
| 3 | Legacy data migration: localStorage importer, quarantine, PBKDF2 re-hash, report | ✅ Complete (tested) |
| 4 | AppContext cutover: hydrate from SQLite, write-through sync (`syncCore`), no dual writes | ✅ Complete |
| 5 | Attachments: `attachmentService` (MIME/size validation, 8 MB/file, 32 MB/entity) + `attachments`/`payment_attachments` tables | ✅ Complete |
| 6 | Billing/payments/ledger: transactional repos, partial payments, proof images, journal balance CHECKs | ✅ Complete (tested: 100k = 30k+20k+50k scenario) |
| 7 | Offline sweep: Google Fonts vendored, Unsplash ref removed, `@google/genai`/`express`/`dotenv` removed, zero runtime network | ✅ Complete |
| 8 | Backup/restore: `.dentalbackup` package (SHA-256 manifest), validate → safety snapshot → engine swap, wired in Settings | ✅ Complete |
| 9 | Updates: version service (`2.0.0`), online manifest check, offline `.dentalupdate` import w/ checksum, Settings UI | ✅ Complete |
| 10 | Security: hashed login (no plaintext/backdoor), demo-credentials panel removed, validation service-side | ✅ Complete |
| 11 | Final full test pass — verified after all changes: 48/48 tests, tsc clean, build green, plaintext sweep done | ✅ Complete |
| 12 | Packaging: Tauri 2 shell, real file-backed SQLite (`dental_solutions.sqlite`, atomic writes), NSIS/MSI installer targets, full icon set | ✅ Complete (installer build needs Rust toolchain) |
| 13 | Git: init ✅, .gitignore ✅, README/CHANGELOG/LICENSE ✅, 192 files staged — **commit blocked: git user.name/user.email not configured (agent must not change git config)** | 🔶 Awaiting user identity |

## Key implementation files

- `src/db/` — engine, migrations, repos, sequences, crypto (PBKDF2), seeds, persistence (browser + Tauri), core, defaults, legacyMigrator, syncCore, index
- `src/services/` — backupService (`.dentalbackup`), updateService (online/offline), attachmentService, prioritySla, financeDomain
- `src/context/AppContext.tsx` — SQLite-backed store; async hashed login
- `src-tauri/` — Rust shell: `db_load`/`db_read_bytes`/`db_save_bytes`/`db_backup_file`/`file_sha256`, capabilities, icons, tauri.conf
- `public/icon.svg`, `public/icons/*` (incl. 1024 source), `public/fonts/*`
- `scripts/generate-icons.mjs`, `scripts/vendor-fonts.mjs`
- `tests/db/` — 6 suites, 48 tests (engine, repos, crypto, seeds, persistence, boot)

## Hardcoding audit (this round)

- Dashboard SLA banner `overdueCount || 2` → real count only
- Batch billing `final_price || 15000` → real price, 0 shown when unset
- Case form: duplicate status dropdown & material section removed, shade input unified with VITA swatches, per-priority SLA labels on priority buttons
- `CaseListView` hardcoded date `=== '2026-08-03'` → dynamic
- LoginPage demo-credentials panel (plaintext passwords) → removed
- Settings table inspector now reads live SQLite `sqlite_master` counts

## Production finalization round (2026-09-18)

- **Desktop installers BUILT:** `Dental Solutions_2.0.0_x64-setup.exe` (NSIS) and
  `Dental Solutions_2.0.0_x64_en-US.msi` in `src-tauri/target/release/bundle/`.
  Fixes required: removed invalid `fs:` capability; enabled rusqlite `bundled` feature.
- **Desktop smoke test (partial, live):** packaged exe launches, creates
  `%APPDATA%/pk.dentalsolutions.app/dental_solutions.sqlite`; login works; session
  persists across reloads via the SQLite `sessions` table.
- **Production-build crash FIXED:** sql.js WASM failed to load in `vite preview`
  (bundler `?url` not rewritten → 404 → HTML parsed as WASM). Fix: vendored
  `public/vendor/sql-wasm.wasm` + threaded `locateFile` through
  `initEngineFromBytes` (it was dropped during the earlier refactor).
- **Legacy dual-writes REMOVED:** branding/prefs/notif-config/email-templates now
  write only to SQLite settings tables; custom chairside appointments moved to the
  `chairside_appointments` table; session is a token in `dsw_session_token` +
  `sessions` table (no cached user objects, no auto-login-as-admin).
- **TypeScript `strict` enabled** (was missing from the AI Studio tsconfig): fixed
  16 latent null-safety bugs in billing components; fixed LoginPage first-run setup
  condition; added `sql.js` module declaration; excluded `src-tauri` build output.
- **Dashboard honesty audit completed:** removed ALL remaining fabricated numbers
  (active-cases fallback 18, collection 82%, material shares 42/28/18/12,
  "4.2 Days"/"98.4%"/"0.4%", fake chairside patients, deliveries fallback 3,
  "12 days" aging, "4 Clinics", fake phone fallback). Empty state now shows real
  zeros and proper empty-state hints (verified live in production build).
- **Test suite grown 48 → 63:** new `tests/services/backup.test.ts` (7 tests:
  package create/validate, corruption & header rejection, version gates,
  engine-swap restore, safety snapshot) and `tests/services/update.test.ts`
  (8 tests: semver, downgrade protection, checksum/tamper rejection).
- **Unsplash remote fallbacks removed** from attachments (offline guarantee).

## Next actions (user)

1. Configure git identity (repo-local is enough):
   `git config user.name "Your Name" && git config user.email "you@example.com"`
2. Commit (all files staged): `git commit` with the release message in
   docs/PRODUCTION_RELEASE_REPORT.md — or ask the agent to do it.
3. Create/connect a GitHub remote: `git remote add origin git@github.com:<user>/<repo>.git`
   then push (`git push -u origin master`).
4. Install from `src-tauri/target/release/bundle/nsis/Dental Solutions_2.0.0_x64-setup.exe`
   and run the full manual smoke checklist (see PRODUCTION_RELEASE_REPORT.md).

## 2.0.1 hotfix (packaged-app boot failure — 2026-09-18)

User-reported: installed app dies with `expected magic word 00 61 73 6d`.
Root cause: installers predated the production WASM-URL fix (bundle 404'd the
wasm → HTML parsed as WASM). Actions: snapshot/file header guard added to the
boot path, version bumped to 2.0.1 everywhere, 63/63 tests + strict tsc green,
installers rebuilt (`Dental Solutions_2.0.1_x64-setup.exe` / `.msi`), runtime
verified by booting the packaged exe over the stale 0-byte DB file (fresh valid
516 KB database created). Old 2.0.0 artifacts deleted. Docs + CHANGELOG updated.
Git commit still awaits user identity.

## CI pipeline (2026-09-18)

`.github/workflows/ci.yml` pushed (commit `236913f`) and verified live —
run [#35273019410](https://github.com/beingadil/Dental-Clinic-Management/actions/runs/35273019410):
- **web** (ubuntu): `tsc --noEmit` strict + vitest (63) + `vite build` → **success**
- **desktop** (windows, after web): full `tauri:build` (NSIS + MSI) → **success**;
  artifact `dental-solutions-windows-installers` (6.1 MB) uploaded, retention 30 days.
- Triggers: push to master, `v*` tags, PRs, manual dispatch. Concurrency-canceled.
- CI-built installers remove the local Rust toolchain requirement for future releases.

## GitHub Releases pipeline (2026-09-18)

Tag-triggered release publishing added and debugged live:
- `v*` tag push → CI builds the branded NSIS installer, generates SHA256SUMS.txt,
  creates/updates the GitHub Release and uploads assets, then force-publishes
  (draft residue from a failed run would otherwise stay invisible).
- Two real bugs found and fixed in the process: `softprops/action-gh-release`
  fails on Windows runners ("Error creating asset temp dir") → replaced with the
  official `gh` CLI; and asset upload does not flip a draft release to published
  → added explicit `gh release edit --draft=false`.
- **Verified end-to-end:** release v2.0.1 is public at
  github.com/beingadil/Dental-Clinic-Management/releases/tag/v2.0.1 with
  `Dental.Solutions_2.0.1_x64-setup.exe` (2.8 MB) + SHA256SUMS.txt; the
  downloaded installer's SHA-256 matches the published checksum exactly.
- Note: release asset filenames normalize spaces to dots.

## Known issues / follow-ups

- Desktop build requires Rust toolchain + one-time `cargo` compile (documented in README).
- `.dentalupdate` packages are verified in-app; payload installation is applied by the desktop installer (documented).
- Legacy `dsw_*` localStorage keys retained until clinic verifies data + takes first `.dentalbackup` (clear via System Reset).
- Bootstrap default passwords are documented in `src/db/defaults.ts`; change each account's
  password on first login (Settings → My Account & Security).
