# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/) and the
project adheres to [Semantic Versioning](https://semver.org/).

## [2.2.0] — 2026-09-19

### Added
- **In-app auto-update system.** The app now silently checks GitHub for a newer
  release on startup (and hourly after). When one exists, a dismissible banner
  offers a one-click installer download that opens in the system browser
  (new `open_external` Tauri command, https-only). Offline machines remain
  fully supported via the Settings → Import Offline Update (`.dentalupdate`)
  path. Update sources: a CI-published `update-manifest.json` on GitHub Pages,
  with the GitHub Releases API as fallback.
- CI now publishes `update-manifest.json` to the `gh-pages` branch on every
  `v*` tag so released installers are discoverable by the in-app updater.

### Fixed
- **`APP_VERSION` was left at 2.0.1 by the v2.1.0 release** — installed 2.1.0
  apps under-reported their version to the backup/update system.

### Changed
- **Create New Job form simplified:** the per-tooth tooth-spec inspector no
  longer shows the Restoration/Preparation Type grid and Restoration Material
  dropdown (redundant with the case-level material selection and the Catalog →
  Restoration Types manager). Shade and per-tooth notes are unchanged; defaults
  still flow to `case_teeth` storage.

## [2.1.0] — 2026-09-19

### Added
- Case job lifecycle: view/edit/delete cases, row action menus, Record Payment
  shortcut.
- Print Studio module (Job Slip / Lab Card / Invoice / Receipt with per-section
  toggles, live A4 preview, saved templates).
- Catalog → Restoration Types tab backed by SQLite clinical specs.
- True 32-tooth FDI SVG odontogram with clinical overlays and FDI/Universal
  toggle.
- Every billing entry auto-logs a voucher + journal entry.

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
