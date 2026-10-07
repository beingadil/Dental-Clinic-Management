# SQLite persistence & data-integrity audit — Freebuff Desktop

**Date:** 2026-10-06 · **Scope:** every persistence path in the app — schema, migrations,
engine, repos, the React→SQLite sync, autosave, backup/restore, `.sql` export & import,
integrity checks.
**Verdict:** the SQLite layer is structurally sound and genuinely transactional. Seven
defects were found; **all seven are fixed and regression-tested**. Two known divergences
remain open and are documented rather than hidden.

---

## 1. How persistence actually works (verified, not assumed)

| Layer | Fact | Evidence |
|---|---|---|
| Engine | `sql.js` WASM, database lives **in memory**; Rust does file I/O only | [engine.ts](src/db/engine.ts), [lib.rs](src-tauri/src/lib.rs) |
| Transactions | Every write path goes through `withTransaction` (SAVEPOINT), nested-safe | [engine.ts:110](src/db/engine.ts#L110) |
| Desktop write | engine bytes → base64 → `db_save_bytes` IPC → tmp + fsync + rename | [persistence.ts:186](src/db/persistence.ts#L186) |
| Browser write | engine bytes → base64 → **IndexedDB** (`dsw_sqlite/snapshots`), localStorage legacy fallback | [persistence.ts:165](src/db/persistence.ts#L165) |
| Collection sync | one debounced SAVEPOINT rebuilds every table from React state | [syncCore.ts:60](src/db/syncCore.ts#L60) |
| Autosave | 400 ms debounce, 5 s checkpoint, flush on hide, awaited flush on window close | [persistence.ts](src/db/persistence.ts) |
| Failure surface | `SaveFailureBanner` / `SyncStatusBanner` — never silent | [SaveFailureBanner.tsx](src/components/common/SaveFailureBanner.tsx) |

**The central risk class:** the collection sync rebuilds tables inside one transaction.
A single UNIQUE / CHECK / FK violation aborts the whole SAVEPOINT, so *one bad row stops
all persistence for the app*. Every finding below is judged by that blast radius.

**Audits run** (all re-runnable, all in `scripts/`):
`audit-untransactional.mjs` (zero hits — the repo layer is genuinely transactional),
`audit-swallows.mjs` (10 hits, all benign read/decoding fallbacks, **no swallowed writes**),
`audit-column-coverage.mjs` (43 tables, 101 write sites, 0 UNKNOWN, 0 REQUIRED, 12 DEAD).

---

## 2. Findings

### F1 — CRITICAL, FIXED · `payment_attachments` FK rejected every advance/adjustment proof
**Schema:** `payment_attachments.payment_id` was declared `FOREIGN KEY … REFERENCES payments(id) ON DELETE CASCADE` ([migrations.ts:294](src/db/migrations.ts#L294)), but all three write sites store an **advance** or **adjustment** id there: [syncCore.ts:474](src/db/syncCore.ts#L474), [syncCore.ts:500](src/db/syncCore.ts#L500), [repos.ts:1049](src/db/repos.ts#L1049), [repos.ts:1085](src/db/repos.ts#L1085), [repos.ts:1168](src/db/repos.ts#L1168), [legacyMigrator.ts:415](src/db/legacyMigrator.ts#L415).

**Reproduction (before the fix):** `FOREIGN KEY constraint failed [sql: INSERT INTO payment_attachments …]`, with `advance_payments: []` and `account_adjustments: []` — the abort rolled back the entire sync.

**Fix:** migration 016 ([migrations.ts:898](src/db/migrations.ts#L898)) rebuilds the table as `payment_attachments_v16` with `owner_type TEXT NOT NULL DEFAULT 'payment' CHECK (owner_type IN ('payment','advance','adjustment'))`, carries existing rows over inferring `owner_type` from `advance_payments`/`account_adjustments`, re-adds the index, and re-implements cascade delete as three AFTER DELETE triggers. Every write site now names `owner_type` explicitly.

**Tests:** [tests/db/moneyAttachmentFk.test.ts](tests/db/moneyAttachmentFk.test.ts) — 10 tests.

### F2 — HIGH, FIXED · pricing overrides written before the rows they reference
`lab_pricing_overrides` (FK → `case_types` ON DELETE CASCADE) was inserted **inside the labs loop, before** `case_types` was rewritten. It either aborted the save on the FK or was cascade-deleted by the catalog rewrite itself.
**Fix:** moved to the catalog block, after the `case_types` insert, with orphan guards.

### F3 — HIGH, FIXED · `advance_allocations` cleared and never rewritten
The up-front `DELETE FROM advance_allocations` had no matching insert, so every advance→invoice allocation was destroyed within one debounce window. The advance wallet read back with its money but none of its history. Now rewritten from state inside the advance loop ([syncCore.ts:465](src/db/syncCore.ts#L465)), guarded by `liveInvoiceIds`.

### F4 — HIGH, FIXED · orphan parents aborted the whole sync
Cases/invoices/advances/adjustments/allocations could reference labs, invoices or case types that no longer existed in state. Any one of them killed all persistence.
**Fix:** `liveLabIds` / `liveCaseIds` / `liveInvoiceIds` / `liveCaseTypeIds` guards skip orphans instead of throwing.

### F5 — MEDIUM, FIXED · unknown `notifications.type` aborted the save
The `CHECK` on `notifications.type` rejects unknown values; legacy/imported rows carried them. Unknown types now degrade to `'system'` instead of failing the transaction.

### F6 — HIGH, FIXED · every reversal was silently undone by the next save
**This was the most damaging data-loss bug found.** The whole-table rebuild named almost every money column — but never `is_reversed`, `reversal_reason`, `reversed_at`, `reversed_by` on `payments`, `advance_payments` and `account_adjustments`. So on every save:
- `is_reversed` fell back to its `DEFAULT 0` → **a reversed payment read back as live money**, and
- the reason, timestamp and actor were dropped **permanently**.

Found by column coverage: 12 columns existed in the schema that no write site ever named (9 reversal columns, plus `users.updated_at`, `case_notes.updated_at`, `ledger_entries.running_balance` — the latter two are cosmetic and `running_balance` is correctly written by the repo layer at [repos.ts:1341](src/db/repos.ts#L1341), so they are non-issues).

**Fix:** all three INSERTs now carry the reversal trail plus `unapplied_amount` and `advance_payment_id` ([syncCore.ts:426](src/db/syncCore.ts#L426), [syncCore.ts:456](src/db/syncCore.ts#L456), [syncCore.ts:495](src/db/syncCore.ts#L495)).
**Tests:** [tests/db/reversalDurability.test.ts](tests/db/reversalDurability.test.ts) — verifies the trail survives a save *and* three repeated saves.

### F7 — CRITICAL, FIXED · browser persistence died at ~3.7 MB and the app got slow
**This is the banner you saw.** The browser snapshot was a single base64 string in `localStorage`, whose per-origin quota is ~5 MB — and base64 inflates the database by 4/3, so the ceiling is hit at a **~3.7 MB database**. Worse, a freshly migrated *empty* database was already **569 KB** (43 tables, their indexes and triggers), i.e. 0.74 MB of quota spent before a single record. (The floor is now **532 KB** across 45 tables — see §4a.)

Once over the line: every save threw `QuotaExceededError`, the dirty flag never cleared, and the 5-second checkpoint **re-serialized the entire database and threw again, forever** — persistence dead and the UI visibly slowing down. Measured at the time: `VACUUM` on a working database does *not* reclaim the sync rebuild churn (999,424 bytes before and after), because those pages are genuinely occupied by live rows — so compaction was rejected as the fix for *that* problem. It is still required for a different one: pages freed by a DROP only reach the freelist, and freelist pages count towards the exported size, which is why `compact()` now runs after any migration that applied (§4a).

**Fixes** ([persistence.ts](src/db/persistence.ts)):
1. **IndexedDB is now the primary browser store** (disk-quota'd, not 5 MB). localStorage is a fallback only; the legacy copy is deleted after a verified IndexedDB write so the origin doesn't carry two databases.
2. **Actionable quota message** — states the snapshot size and points at `.dentalbackup`, instead of the raw `Failed to execute 'setItem'` DOM text.
3. **Failure backoff** (1 s → 5 s → 15 s → 60 s → 5 min) so the checkpoint stops re-encoding megabytes on the UI thread. Backup restore still writes through with `force: true`.
4. `localStorage` access is now defensive — it is *absent* (not just full) in Node, jsdom and some private-mode browsers, and touching it used to throw out of an otherwise successful save.

**Verified in the real browser** (dev server, not just unit tests):
- Fresh boot: `indexedDbSnapshotChars: 775518`, `legacySnapshotChars: 0`, `dirtyFlag: "false"`, no banner.
- Upgrade path: planted a legacy localStorage-only snapshot, cleared IndexedDB, reloaded → loaded correctly, migrated to IndexedDB, legacy copy removed, no banner.

**Tests:** [tests/db/persistenceQuota.test.ts](tests/db/persistenceQuota.test.ts) — IndexedDB round-trip with no legacy copy, actionable quota message, and backoff proven by asserting `engine.export()` is *not* called inside the backoff window.

---

## 3. Also hardened along the way

- **Duplicate healing:** duplicate `payment_number` / document numbers and duplicate ids across multi-invoice slices are healed deterministically (`-D2` suffix) instead of aborting the sync — [tests/db/syncCoreDuplicateHeal.test.ts](tests/db/syncCoreDuplicateHeal.test.ts).
- **Journal rebuild ordering:** the journal rebuild moved ahead of invoices, with a `knownJournalIds` / `issuanceJournalByInvoice` healer, so `invoices.journal_id` no longer dangles.
- **Attachment round-trip:** sync wrote `size_bytes = NULL, checksum = NULL` and parked the human string ("2.34 MB") in `description`. Added `parseBytes()` and carried `size_bytes`/`checksum`/`description` through `domainState.attachmentsByCase`.
- **Integrity check finding #6** — "Money attachment owners", via `ORPHAN_MONEY_ATTACHMENTS_SQL` ([integrityCheck.ts:48](src/db/integrityCheck.ts#L48)), skipped safely on pre-016 schemas.
- **No swallowed writes anywhere.** All 10 `audit-swallows.mjs` hits are read-side fallbacks (corrupt JSON, guarded reads, non-browser `dispatchEvent`).

---

## 4. Open, documented divergences (not defects)

1. **`invoices.journal_id` is plain TEXT with no FK** ([migrations.ts:233](src/db/migrations.ts#L233)). Adding an FK now would be a table rebuild; the AppContext boot sweep heals it instead, and the journal-ordering fix above removes the dangling case.
2. **`payment_allocations` is never populated by the sync** (only `advance_allocations` is). The table is never deleted by the sync either, so repo-written rows survive — but repo- and sync-written allocations are not one unified history.
3. **`nextNumber` skips the first number of every series.** `nextNumber` seeds a new counter with `INSERT … VALUES (?, 2)`, so the first document ever issued for a key is `-0002` and `-0001` is never used (observed first by the round-trip drill — `DS-0002` on a fresh database — and again in the external import check, where two allocations left the counter at 4). Existing databases are unaffected — the insert is `ON CONFLICT DO NOTHING`, so it only fires once per key — and no test codified the behaviour. Left unfixed here because it is a numbering-semantics change, not an export defect, and it was found incidentally; it is a one-character fix (`2` → `1`).
4. **The `.sql` dump is a full copy, not an incremental one.** It contains `users.password_hash` / `password_salt` (like the live database and like `.dentalbackup`) and everything else in the file, so it is as sensitive as a backup and as large as one. The file header says so.

**Closed by the follow-up rounds below:** the export-DDL divergence, the export's row payload, and the empty-database floor.

---

## 4a. Follow-up round: export parity, database footprint, quota drill, failure visibility

### Export DDL is now the live migrations, not a copy

`sqliteStorage.ts` carried its own hand-maintained `SQLITE_DDL_SCHEMA` string (L160-410). It had silently drifted: no `payment_attachments` table at all, no `owner_type` from migration 016, and roughly thirty missing tables. A `.sql` dump exported from Settings > Database & Backup therefore could **not** be replayed into a database this app would recognise — the divergence was in the export path, the one thing a clinic reaches for when the real database is the problem.

`SQLITE_DDL_SCHEMA` is now `schemaScript()` ([migrations.ts:1057](src/db/migrations.ts#L1057)), which renders `MIGRATIONS` verbatim with `-- ── migration N: name ──` headers. Drift is now structurally impossible: a new migration ships and the export picks it up. The engine's own `migrate()` also uses the shared `SCHEMA_MIGRATIONS_DDL` string instead of a duplicate literal.

[Tests/db/exportSchema.test.ts](tests/db/exportSchema.test.ts) executes the generated script against a blank sql.js database and compares it object-for-object (tables, column names/types/NOT NULL, indexes, triggers, row-level round-trip through all eleven hand-written INSERTs) with a `SqliteEngine.migrate()` database.

### Empty-database floor: 569,344 → 532,480 bytes

All 12 indexes dropped by `MIGRATION_017_DROP_UNUSED_INDEXES` ([migrations.ts:990](src/db/migrations.ts#L990)) are chosen by *no* statement the app can issue, verified by extracting every SQL literal from `src/` and planning each with `EXPLAIN QUERY PLAN`. The reason is structural: the app loads whole collections into memory and filters, sorts and searches them in JavaScript, so the only SQL that runs is `SELECT * FROM t` plus id-keyed lookups.

| | empty DB | 2,000 rows/table |
|---|---|---|
| each dropped index | 4,096 B | 20,480 – 45,056 B |
| total, 11 net (12 dropped, 1 replacement) | **45,056 B** | ~9 % of a 4.4 MB working DB |

Measured result: **569,344 → 524,288 bytes** (exactly 11 × 4,096-byte pages reclaimed), and **532,480 bytes** once migration 018 declares `doc_sequences` — the +8,192 for a table that was genuinely missing from the declared schema, described below.

Two details were required to make the drop real:

- **`SqliteEngine.compact()` (VACUUM)** runs at the end of `migrate()` when any migration applied ([engine.ts:185](src/db/engine.ts#L185)). A dropped index only releases its pages to the *freelist*, and freelist pages still count towards the exported byte length. Without the VACUUM the floor did not move at all — the whole point of dropping the indexes was to shrink what the webview re-encodes on every save. It is skipped entirely on an up-to-date database, so the common boot pays nothing.
- **`idx_alloc_source` was replaced, not merely dropped.** It was declared `(source_type, source_id)`, but every lookup constrains `source_id` alone, and a composite index is unusable when only its second column is constrained — the plan was `SCAN payment_allocations`. `idx_alloc_source_id` on `source_id` makes both the read and the delete `SEARCH … USING INDEX`.

`idx_qc_created` is deliberately **kept**: `qcRepo.all()` orders by `created_at` and SQLite does use the index for it.

#### What each table actually costs

Per-table cost was measured by growing one table at a time in a migrated database and diffing the exported byte length after a VACUUM (2000 rows per table), so the numbers are marginal cost, not shares of a total. `dbstat` is not compiled into this sql.js build, which is why it is done by difference.

**Read these as relative, not absolute.** Every text column was filled with a fixed ~48-character value; a real clinic's `cases.instructions` and `attachments.data_url` are far longer, and cost scales linearly with content. The point is the ranking — where the bytes go — not a prediction for a given practice.

| Table | Bytes/row |
|---|---|
| `cases` | 1,219 |
| `payments` | 1,147 |
| `account_adjustments` | 1,090 |
| `ledger_entries` | 1,044 |
| `invoices` | 999 |
| `advance_payments` | 936 |
| `journal_entries` | 864 |
| `qc_inspections` | 762 |
| `reconciliation_items` | 760 |
| `attachments` | 702 |
| `labs` | 651 |
| `saved_vouchers` | 590 |
| `case_types`, `users` | 578 |
| `case_templates`, `email_templates` | 551 |
| `audit_events` | 520 |
| `chairside_appointments` | 518 |
| `notifications` | 465 |
| `payment_allocations` | 457 |
| `payment_attachments` | 438 |
| `lab_addresses`, `lab_contacts` | 381 |
| `case_notes`, `case_status_history` | 332 |
| `journal_lines`, `lab_pricing_overrides` | 301 |
| `advance_allocations` | 283 |
| `print_templates` | 246 |
| `doctor_preferred_labs` | 219 |
| `invoice_items` | 190 |
| `clinical_materials`, `implant_brands`, `sessions`, `clinical_prep_types` | 170 |
| `shade_guides` | 131 |
| `user_preferences` | 117 |
| `schema_migrations` | 108 |
| `app_meta` | 65 |
| `doc_sequences` | 20 |

Two conclusions that matter for the floor work: **rows dominate, indexes do not** (the twelve dropped indexes together cost roughly 9 % of a populated database, while these per-row figures are unbounded), and the cost is concentrated in exactly the tables the audit's F1–F6 fixes protect — cases, money, ledger and journal. `doc_sequences` at 20 bytes/row is the cheapest table in the schema, which is the right shape for a counter table.

Four tables report no growth because a synthetic row cannot satisfy their constraints (`case_teeth`, `lab_reviews`, `legacy_backup`, `settings` — CHECK ranges, reserved namespaces), and `notification_config` holds a single row by design. All five are small and fixed-size in practice, so their omission does not change the picture.

[Tests/db/dbFootprint.test.ts](tests/db/dbFootprint.test.ts) guards the ceiling, the zero-freelist invariant, the absence of every dropped index, the plan for the replacement, and the index count (so a new index must be a deliberate decision). It also proves `compact()` reclaims pages after row deletion.

### Quota-exhaustion drill

[Tests/db/quotaDrill.test.ts](tests/db/quotaDrill.test.ts) grows a **real 16.2 MB database (21.6 MB encoded)** — past the legacy ~5 MiB localStorage ceiling — using 4,000 audit rows, and then proves, in order:

1. the legacy path genuinely cannot hold it: the save fails, `dsw_sqlite_snapshot` is absent, and localStorage holds bookkeeping only (`dsw_persistence_failures`, `dsw_sqlite_dirty`) — under 50 KB total;
2. the IndexedDB snapshot holds the same file;
3. it reloads with an identical content fingerprint across 13 tables and `PRAGMA integrity_check = ok`;
4. the restored database is still **writable** — a new row survives a further save/load cycle;
5. the app does not grind: twelve consecutive checkpoint attempts inside the backoff window perform **zero** re-encodes of the multi-megabyte export.

### Failure visibility: persisted counters + a Settings panel

[src/db/failureLog.ts](src/db/failureLog.ts) is a persisted journal (capped at 50 entries, in localStorage — the one store that still works when the *database* store is what failed). `persistence.ts` and `syncCore.ts` both write to it, and the retry backoff now reads its persisted streak instead of the module variable that used to reset to zero on every launch — a save broken for a week no longer looks healthy each morning.

Each entry carries a classified cause: `storage-full`, `indexeddb`, `no-storage`, `disk-io`, `data-constraint`, `unknown`. Sync failures also carry the failing statement, because `SqliteEngine` embeds it in its message (`[sql: INSERT INTO …]`) — which is what pinpoints the single row that aborts persistence for every table at once. Save failures carry the backend and the snapshot size.

Settings > Database & Backup now renders [PersistenceHealthPanel.tsx](src/components/settings/PersistenceHealthPanel.tsx): save/sync/restore totals, consecutive-failure streaks, the storage backend actually used, last snapshot size, last-success times, the full failure table with causes, and Copy-diagnostics / Clear-log actions. Verified live in the browser in both states — healthy ("ALL SAVES SUCCEEDING", `last save OK 41s ago`) and failing ("FAILING (save streak 2, sync streak 1)" with per-row causes and the offending SQL).

**One real bug found while testing this:** `openIdb()` cached its result forever, so an IndexedDB that was *transiently* blocked (the realistic case — a second app window mid-version-change) degraded the session to the 5 MB localStorage fallback permanently. A failed open is now forgotten so the next save retries. [Tests/db/failureLog.test.ts](tests/db/failureLog.test.ts) covers the classification, persistence across reload, ring-buffer cap, corrupt-log recovery, and both failure paths end-to-end.

### `doc_sequences` was in no migration at all (found by replaying the export in the browser)

Running the **real** `generateSqliteExport()` against the **running** app's schema — rather than reading the code — showed the dump at 44 tables against the live 45. The missing one was `doc_sequences`, the document-number counter, which no migration ever created: it was built lazily by `ensureSequenceTable()` ([sequences.ts:18](src/db/sequences.ts#L18)) and by the seeder, so it was present in every real database and absent from every declared one.

Two consequences, both now fixed by `MIGRATION_018_DOC_SEQUENCES` (an `IF NOT EXISTS` no-op on existing databases):

- A `.sql` dump restored elsewhere had no counter table, so the app would reissue document numbers that already exist — precisely the collision class the sync's duplicate healer exists to paper over.
- The floor moved +8,192 bytes. That is the honest price of the table; the index savings still dominate (net **-36,864 bytes**, -6.5 %).

Verified end-to-end in the browser afterwards: the export produced by the running app is now **45/45 tables, 18/18 indexes, zero differing columns, zero FK violations, dump `schema_version` 18 = live `schema_version` 18**, with `payment_attachments.owner_type` present.

### The dump's row payload was 11 of 45 tables — now it is the database

The schema and the data were fixed in two separate passes, and the second was the larger defect.

`generateSqliteExport` built its INSERTs from an in-memory React snapshot with a hand-written column list. It wrote **11 of the 45 tables** with a subset of their columns, so a dump silently dropped `case_teeth`, `case_notes`, `qc_inspections`, `saved_vouchers`, `reconciliation_items`, `ledger_entries`, `attachments`, `user_preferences`, `settings`, `payment_allocations` and more — including every reversal flag on money documents (`is_reversed`, `reversal_reason`, `reversed_at`, `reversed_by`), i.e. a reversed payment would come back as live money. It also never wrote `schema_migrations`, so importing the file into the app meant replaying migration 1 against tables that already existed: **the dump could not boot at all.**

It now dumps every table from the live database, generically — `SELECT *` per table, column names from `PRAGMA table_info`, parents ordered before children via `PRAGMA foreign_key_list` — so a new table or column ships and it is in the export without anyone maintaining a list. The script is shaped like `sqlite3 .dump` output (`PRAGMA foreign_keys=OFF`, `BEGIN TRANSACTION`, DDL then data, `COMMIT`), so it loads with `sqlite3 clinic.sqlite < dump.sql` as well as through the app's tooling.

Two value-fidelity bugs went with it:

- **Backslashes were corrupted.** The old escaper doubled them (`\` → `\\`), but SQLite string literals have no backslash escape — every Windows path and any free text containing a backslash came back out with the separators doubled. Only `'` needs doubling.
- **`INSERT OR REPLACE` from the live database** is what makes the DDL-seeded `app_meta` rows (`schema_version`, `app_version`) yield to the real values instead of colliding with them.

**A third defect fell out of the same investigation:** `BackupTab` called `exportSqliteFile(getBackupData())`, but `getBackupData()` nests everything under `tables`, while the old implementation read `appData.cases.length` on its *first line* — so the button threw and reported "Failed to generate SQLite SQL dump" on every click, producing no file. That is why nobody noticed the drift: the export had never actually run. The header also now reads the clinic name from `tables.brandingSettings.appName`, and a missing name falls back to "Dental Solutions" rather than an empty header.

#### The proof

[Tests/db/exportRoundTrip.test.ts](tests/db/exportRoundTrip.test.ts) dumps a database populated through the app's own writer (sync + repos + direct inserts across **43 tables**), replays the script into a brand-new SQLite file the way `sqlite3 clinic.sqlite < dump.sql` would, and then asserts:

- **every table, every column, every cell is identical** — one comparison over all 45 tables, storage-class aware (`INTEGER` vs `TEXT` cannot hide) — plus identical column lists and `integrity_check = ok` with zero FK violations;
- values containing backslashes, both quote characters and a newline round-trip byte-for-byte;
- the imported database **boots with `migrate()` applying nothing** (`applied: []`, all 18 skipped) and `schema_version` 18;
- `doc_sequences` continues **exactly** where the source stopped (compared against the source's own next value, not a hardcoded string) and the imported database is still writable.

Verified live in the browser through the real button: the export from a running fresh install produced **71 INSERTs across the 14 tables that actually had rows**, no error, and the success banner. (That count is the honest one for an empty clinic — the other 31 tables legitimately have no rows there.)

#### And imported by a different SQLite build

The round trip above replays the dump through sql.js, the same engine the app runs on — which proves fidelity but not that the file is ordinary SQLite SQL. So the dump was also fed to **Python's bundled libsqlite3 (3.50.4)**, a different build entirely, via `executescript` (the same "run the file's statements" operation as `sqlite3 db.sqlite < dump.sql`):

| Check | Result |
|---|---|
| `PRAGMA integrity_check` on the import | `ok` |
| `PRAGMA foreign_key_check` | 0 violations |
| Tables compared | **45 / 45**, table lists identical |
| Cell-level differences across all 45 tables | **none** (30 rows source = 30 rows import) |
| Backslash/quote/newline payload | byte-identical (`C:\Lab\shared\"O'Brien's" report\nline 2`) |
| Payment reversal state | preserved (`is_reversed=1`, reason `bounced`) |
| `doc_sequences` / `schema_migrations` | counter carried over; 18 migration rows present |

---

## 4b. Follow-up round: in-app `.sql` dump import

The export work above made `.sql` files safe to hand around. But on a **fresh machine** the only way back in was a `.dentalbackup` — if all a clinic had was `clinic.sql` (from `sqlite3 .dump`, from a support ticket, from a previous build of this app), it could not be restored without installing SQLite tooling. That is the exact moment a clinic needs the app most.

[src/services/sqlDumpImport.ts](src/services/sqlDumpImport.ts) adds that path: Settings → Database & Backup → **Restore From a SQL Dump (.sql)**.

### The shape of it

Four steps, in this order, and nothing before the last two touches live data:

1. **Read.** Text in, capped at `MAX_DUMP_BYTES` (64 MB).
2. **Parse.** `parseSqlDumpHeader` pulls the `Export Date` / `Laboratory` / `Tables: N | Rows: N` comments that `generateSqliteExport` writes. Absent headers are not fatal — a dump from bare `sqlite3 .dump` simply reports none.
3. **Replay into a throwaway engine.** `analyzeSqlDump` creates a scratch database (`createScratchEngine` — an engine *without* `migrate()`, so the dump's own schema is what gets measured, not ours), executes the script **one statement at a time**, and records the result. `importSqlDump` returns bytes only when this passes; the live engine is never opened.
4. **Report, then swap.** The panel shows what was found. Only on *Import & Reload* does `importSqlDump` call `saveSafetySnapshot` on the outgoing bytes (aborting the whole import if that write fails) and then hand the validated bytes to the same `applyRestoredBytes` used by the `.dentalbackup` restore — permission check, `PRAGMA integrity_check`, `installAutoPersistence`, `persistEngineNow`, close the old engine. Undo is the safety snapshot, surfaced with its size and timestamp.

### The sql.js facts that shaped the code

Both were found empirically, not from the docs, and both would have silently produced a *successful-looking import of nothing*:

| Trap | Consequence | What the code does |
|---|---|---|
| `db.run(sql, [])` with an **empty** params array executes **nothing** and returns cleanly | a one-shot dump would "import" 0 rows with no error | `SqliteEngine.execScript(sql)` calls `db.run(sql)` with no second argument |
| sql.js **aborts at the first failing statement** and has **no implicit transaction** | a dump with one bad line stops halfway, leaving a plausible-looking partial database | statements are replayed individually; the failing one is captured and reported rather than swallowed, so the report says exactly where it stopped |

The splitter (`splitSqlStatements`) is a real tokenizer rather than a `;` split, because this app's own migrations contain `CASE … END` backfills (migration 016) and three cascade `CREATE TRIGGER` bodies. Both traps were found by the tests and fixed:

- `CASE` / `BEGIN` / `END` were consumed **as bare words**, so the very next character made `\b` match — `cases` became `CASEs`, and `case_types` / `case_number` were rewritten in real data. The guards now look one character further (`i + 7`, `i + 4`, `i + 5`) and re-append the whole keyword.
- A bare `BEGIN;` (a transaction, not a trigger body) was read as "inside a trigger" and swallowed everything up to the next `END`. An `inTriggerStatement` flag now sets that state **only** when the statement begins with `CREATE [TEMP|TEMPORARY] TRIGGER`.

### What is refused, not run

`ATTACH`, `DETACH`, `VACUUM INTO`, `load_extension`, `readfile`/`writefile` — **all of these execute in the sql.js WASM build.** They are the dump equivalent of arbitrary file access, so they are rejected before replay; each one lands in the report's `<details>` list with the reason, rather than being silently dropped. `PRAGMA` is allowed from a small whitelist. `REQUIRED_TABLES` (`schema_migrations`, `users`, `labs`, `cases`, `invoices`) must all be present or the dump is rejected as "not a dump of this app".

### Credentials never reach the screen

A dump carries `users.password_hash` and `password_salt`. The validation report shows **row counts and schema facts only** — no cell values, for any table. The one user-facing warning is explicit: *"This dump contains user accounts and their password hashes. Anyone holding the file can attempt to authenticate — treat it like a password."* The success banner reports `outcome.rowsRestored`, which sums the manifest tables (`cases`, `invoices`, `labs`, `users`) — the clinic-meaningful count — not the dump's total including 18 `schema_migrations` rows.

### The proof

[tests/db/sqlDumpImport.test.ts](tests/db/sqlDumpImport.test.ts) — **34 tests**, seeding real engines with `seededDump()` and running them through the real `generateSqliteExport`:

- splitter regressions for `cases` / `case_types` / `case_number`, quoted `'case …'`, a bare `BEGIN;` transaction, trigger bodies, `--` and `/* */` comments;
- every forbidden statement is refused and named in the report; a dump whose only statement is `ATTACH` restores nothing;
- a missing required table, an empty file, an over-cap file, and a mid-file syntax error each produce a report with a reason instead of a partial import;
- `importSqlDump` on a seeded dump leaves the caller's data **untouched** and produces bytes that boot to the seeded rows — plus a test that `saveSafetySnapshot` rejecting **aborts the import** rather than proceeding unprotected.

Verified live in the browser through the real file input: a 35 KB dump produced

```
sample-dump.sql — Valid dump, ready to import.
schema v18 · 6 tables · 24 rows
app_meta: 2 · cases: 1 · invoices: 1 · labs: 1 · schema_migrations: 18 · users: 1
```

Importing it reported `Imported 4 rows from the SQL dump (schema v18). Reloading…`; after the reload the dashboard showed **DS-0001 / Dr. Rao / Bright Smiles**, 1 active case, and **PKR 23,000** outstanding, and Settings reported `1 cases · 1 invoices · 1 labs` — schema v18 with no upgrade. **Recover previous data** then rolled the IndexedDB snapshot back to 709,982 base64 chars, exactly the 532,480 bytes saved before the import, and the pre-import administrator reappeared. The whole cycle is reversible.

**Known limitation, not a defect:** the sample dump used for this check was hand-seeded, so its invoice has no journal row and the integrity panel correctly reports *"1 invoice(s) without journal"*. A dump produced by the app's own export always carries them; the panel surfaced the discrepancy rather than hiding it, which is the behaviour you want from a restore path.

---

## 4c. Follow-up round: the auto-updater (v2.17)

The complaint was *"only the latest-installer banner shows, it does not update
itself."* Both halves were true, and the cause was in the Rust command, not the
UI.

### What was actually broken

`update_install` spawned the NSIS installer **and** called `app.exit(0)` in the
same invocation. The app therefore closed mid-session with no prompt, no
progress and no chance to decline; and the frontend banner could not ask
anything, because the process it was supposed to talk to was already exiting.
The visible banner ("Download Installer") was a *browser* hand-off — it was
never connected to the native installer path at all.

### The split that replaces it

`update_install` now **only stages**: stream → verify SHA-256 while streaming →
back up the database → write the stage receipt → return. It never executes and
never exits. A second command, `update_apply`, is the only path that closes the
app, and only the "Restart & Apply Updates" button calls it.

| Phase | Owner | What the user sees |
|---|---|---|
| `checking` | webview | nothing (silent) |
| `available` | webview | nothing — the download starts by itself |
| `downloading` | Rust → `update://progress` | progress bar + byte counts |
| `verifying` / `backing_up` | Rust → `update://progress` (`stage` field) | checklist steps ticking over |
| `ready_to_apply` | webview | **Restart &amp; Apply Updates** / *Not now* |
| `applying` | Rust (`app.exit(0)`) | "the installer finishes in the background" |

The `stage` field on the progress event is what turned an opaque spinner into a
readable five-step pipeline — the Settings variant renders it as a checklist
([AutoUpdatePanel.tsx](src/components/common/AutoUpdatePanel.tsx)).

### Why the exit is the last step, not the first

`app.exit(0)` races the debounced SQLite flush (400 ms). Exiting inside the
download path is what previously lost the newest clinic data and raced the IPC
reply. `update_apply` therefore flushes first (`flushNow()` is awaited, not
fire-and-forget), re-hashes the staged file against the receipt checksum —
fail-closed, because the file has been sitting on disk unattended — spawns a
detached waiter, and only then exits after 1.5 s. The waiter waits for *our PID*,
runs `/S`, waits, and relaunches from the **installed** location (resolved from
the NSIS `HKCU\...\Uninstall\Dental Solutions\InstallLocation` key, not
`current_exe`, so a dev or portable build relaunches the real installed app).

### The receipt now has three meanings

Because staging no longer implies applying, the boot-time reconciliation of
[updateInstaller.ts](src/services/updateInstaller.ts) reads the receipt three
ways, and this is where the old behaviour was actively wrong:

- `settled` → record "Updated to vX" **once per version** (a naive re-record
  duplicated the history entry on every boot).
- `pending` + the staged file present → offer the restart, without
  re-downloading. `pending` + the file gone → report it as *interrupted*, not as
  ready; asking a clinic to close the app for an installer that no longer exists
  is worse than saying nothing.
- Declining ("Not now") calls `update_discard`, which deletes both the staged
  file and the receipt so the prompt does not return on every launch.

### Proof

- [tests/services/updateInstaller.test.ts](tests/services/updateInstaller.test.ts) — 11 tests: `isAutoUpdateBusy` across every phase (notably `ready_to_apply` is **not** busy — it is waiting on a person), listener fan-out, and the three-way receipt reconciliation including the once-per-version install record.
- [tests/components/autoUpdatePanel.test.tsx](tests/components/autoUpdatePanel.test.tsx) — 8 tests: the floating panel renders nothing when there is no update, never shows a "download installer" banner, shows the restart prompt once staged, and `Restart & Apply Updates` really invokes `update_apply`; *Not now* invokes `update_discard`.
- `cd src-tauri && cargo test --lib` — 7 passed, including the stage-receipt shape and the magic filter.
- [tests/lib/tauriWindowPermissions.test.ts](tests/lib/tauriWindowPermissions.test.ts) — the ACL scanner's self-guard dropped from 5 window call sites to 4, because the deleted `UpdateStatusPill` owned a `destroy()` that the native `update_apply` now replaces.

---

## 5. Gate status (all green, re-run on the final tree)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npx vitest run` | ✅ **60 files / 529 tests passed** |
| `npm run build` | ✅ built |
| `node scripts/verify-binaries.mjs` | ✅ 10 binaries match |
| `node scripts/version-guard.mjs` | ✅ live 2.16.0 |
| `cd src-tauri && cargo test --lib` | ✅ 7 passed |
