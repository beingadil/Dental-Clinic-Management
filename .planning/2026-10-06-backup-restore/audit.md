# Backup & Restore — System Audit (2026-10-06)

## Phase 0 — Audit answers (all verified in code, not assumed)

| Question | Answer |
|---|---|
| Architecture | **Tauri 2 + sql.js (WASM, in-memory)** — NOT Electron/better-sqlite3. The prompt's Electron references were adapted, not applied blindly. |
| DB engine owner | Webview owns all SQL. Rust (`lib.rs`) intentionally holds **no open connection** — only file I/O. One authoritative engine singleton: `src/db/core.ts` (`setDatabase`/`getDatabase`). |
| Dev DB location | Browser dev: `localStorage` key `dsw_sqlite_snapshot` (`DSDB1:`-prefixed base64 of the SQLite file). |
| Production DB location | Desktop: `%APPDATA%/<app-id>/dental_solutions.sqlite` (`resolve_db_path` → `app_data_dir`), written atomically by `db_save_bytes` (tmp + fsync + rename). |
| WAL / -shm files | **None by construction.** Single-threaded in-memory engine; sql.js has no WAL. The consistency mechanism is `engine.export()` full-file snapshot. |
| Multiple SQLite DBs | No attachments. `createTransientEngine` builds throwaway verification engines only (never persistent). |
| Renderer → SQLite direct | None. All SQL in the webview engine; Rust does file I/O only. Base64-over-IPC for bytes; `file_sha256` is path-restricted to the DB dir + update temp dir. |
| Migrations | `MIGRATIONS` ledger in `src/db/migrations.ts` (v1–v15), tracked in `schema_migrations`, applied transactionally by `SqliteEngine.migrate()`. Restored payloads are migrated by `initEngineFromBytes`. |
| Foreign keys | ON at engine open AND re-asserted after every `export()` (sql.js resets pragmas on export — the documented P2 regression). Boot integrity check verifies it. |
| Transactions | `transaction()` (BEGIN IMMEDIATE) and nestable `withTransaction()` (SAVEPOINTs) used throughout repos/sync. |
| Data outside SQLite | **None.** Attachments live in-DB (`attachments.data_url`). The SQLite bytes are the complete data scope — no external-files phase needed. |
| Existing backup machinery | `.dentalbackup` JSON package (manifest + base64 DB + SHA-256), validation, safety snapshot (IndexedDB via `safetySnapshotStore`), staged engine swap with rollback, restore drill, auto-scheduler (off/daily/weekly + desktop `.bak` rotation), permission re-check at service boundary. All pre-existing and tested. |

## What this round actually changed (and why)

The master prompt's rebuild-everything reading was rejected: **most of it already existed**, and Phase 29 forbids replacing existing architecture. Four genuine gaps were closed, each with a failing test written first:

1. **Phase 12 — newer-schema backup accepted** (`validateBackup` never checked `schema_version`).
   Fix: `LATEST_SCHEMA_VERSION` exported; `schema_version > LATEST_SCHEMA_VERSION` is a hard error with the prompt's required message shape. Older schemas still pass (migrated at apply time). Test: `rejects a backup whose schema is newer`.
2. **Phase 10 — failed engine swap left the half-restored DB live.** If the factory swapped the global engine and then failed (or `schema_migrations` was missing / `PRAGMA integrity_check` failed), the old engine was closed but the broken one stayed installed.
   Fix: the entire candidate block is now guarded; any failure calls `setDatabase(previous)` and closes the candidate, then throws "could not be prepared … Your current data is untouched." `setDatabase` widened to accept `null` (clearing on a restore-before-boot failure). Tests: mid-swap rollback + persist-failure rollback.
3. **Phase 22 — no `PRAGMA integrity_check` pre-commit.** Now runs against the candidate engine (with the migration-ledger existence check) before the swap is committed and persisted.
4. **Phase 7 — no database status surface.** `BackupTab` gained a status card: live file location (desktop path via new `getDesktopDatabasePath()`, or "Browser local storage"), schema version, and last-snapshot-save verdict (`getLastSaveError()` — the "data is live in memory only; export a backup now" warning). No per-render `export()`.

## Phase 23 scenario coverage

| Scenario | Covered by |
|---|---|
| 1 empty DB backup/restore | manifest table_counts = 0 path; drill |
| 2 populated DB + counts | existing backup suite + new reconciliation test |
| 3 cross-PC | format is portable JSON; restore path is machine-independent (no absolute paths in payload) |
| 4 corrupted backup | checksum-mismatch test (existing) |
| 5 wrong file | `looksLikeSqlite` + magic-header test (existing) |
| 6 newer schema | **new** this round |
| 7 failed restore recoverable | **new**: persist-failure + mid-swap rollback tests |
| 9 WAL mode | N/A — no WAL by construction (documented above) |
| 10 active app | engine.export() is the snapshot; drill runs live |
| 12 interruption | atomic `db_save_bytes` (tmp+rename); restore never deletes before a validated replacement exists |

## Test infrastructure note

The four new tests live in their own file (`tests/services/backupRestoreSafety.test.ts`) sharing ONE sql.js WASM instance: the main backup suite builds ~18 engines and additional `initSqlJs()` compiles pushed that worker past Node's default heap (FATAL mark-compacts OOM, 63s run). Engines are closed in `afterEach`. Result: 1.1s, stable.

## Gates at commit time

tsc 0 · vitest **411/48** (was 407/47) · vite build OK · binary-guard OK · version-guard OK · cargo test 7/7 · live UI verified (status card renders, console clean).
