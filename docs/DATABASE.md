# DATABASE.md — SQLite Architecture

## Engine

- **sql.js 1.13.0** — SQLite compiled to WebAssembly, bundled at build time (`dist/assets/sql-wasm-*.wasm`).
  No CDN, no server, no native modules: the entire database runs and persists locally, fully offline.
- Persistence: the full SQLite file (`engine.export()`) is snapshotted to **IndexedDB** (`dsw_sqlite/snapshots`,
  a single binary-safe base64 key), debounced 400 ms after any write and flushed on page hide/unload.
  IndexedDB is primary on purpose — a localStorage origin quota is ~5 MB and base64 inflates the
  database by 4/3, so a real clinic database hits the ceiling and every save then throws.
  localStorage (`dsw_sqlite_snapshot`, `DSDB1:` header) is a fallback, kept for databases that predate
  the IndexedDB store and deleted once a verified IndexedDB write succeeds. Corrupt/foreign snapshots
  are detected by header and safely discarded.
- In the shipped desktop build (Tauri 2), `src/db/persistence.ts` is the single seam that changes:
  the same bytes go to a real file in the OS app-data directory instead of browser storage.
  Zero engine/repository changes.

## Migrations

- `src/db/migrations.ts` — ordered, append-only; each runs inside a transaction.
- Applied versions recorded in `schema_migrations`; re-runs skip applied versions (idempotent).
- Current: 23 applied migrations — `001_initial_schema`, `002_pragmas_and_fts` (ledger table),
  `003_demo_fixtures` (reserved), `004_app_version`, `005_print_templates`,
  `006_qc_inspections` (append-only quality stream), … `021_catalog_needs_teeth`,
  `022_drop_ledger_entries`, `023_catalog_categories`. See `src/db/migrations.ts` for the full
  numbered list.
- **Never edit an applied migration.** Add a new numbered one.
- `PRAGMA foreign_keys = ON` is set on every connection open.
- **023 rebuilds `case_types`** to drop the five-value `CHECK` on `category`. A migration that
  rebuilds a table must declare `rebuildsTable: true`; the runner then suspends FK enforcement
  for that migration only and runs `PRAGMA foreign_key_check` before committing. `DROP TABLE`
  on a referenced parent otherwise fires the child's `ON DELETE CASCADE` — and
  `PRAGMA foreign_keys` is a no-op inside a transaction, so it cannot be suspended by a
  statement in `statements`.
- `case_types.category` points at `catalog_categories.id` but is **plain TEXT, not a foreign
  key**. That is deliberate: a real FK would refuse a delete with an opaque constraint error
  instead of one the UI can explain and offer remedies for. The cost is that
  `PRAGMA foreign_key_check` is structurally blind to a dangling category, so
  `integrityCheck.ts` carries a targeted query for it.

## Schema (v23)

```
users ─┬─< sessions
       └─(role gating in app code)
labs (clinics) ─┬─< lab_contacts / lab_addresses / lab_pricing_overrides / lab_reviews
                ├─< cases ─┬─< case_teeth (FDI per-tooth detail)
                │          ├─< case_status_history
                │          ├─< qc_inspections (append-only quality stream)
                │          ├─< case_notes
                │          └─< attachments (metadata + blob)
                ├─< invoices ─┬─< invoice_items
                │             ├─< payments ─┬─< payment_attachments
                │             │             └─< payment_allocations (payment→invoice splits)
                │             └─< advance_payments >─ advance_allocations
                │             └─< account_adjustments (credit notes, write-offs…)
                └─< doctor_preferred_labs
journal_entries ─< journal_lines (double entry)

reconciliation_items, notifications, saved_vouchers, audit_events (append-only)
settings (namespaced K/V), notification_config, email_templates
clinical_materials / clinical_prep_types / shade_guides / implant_brands
catalog_categories (operator-managed; case_types.category is a soft reference)
chairside_appointments, case_templates, legacy_backup (quarantine), app_meta, doc_sequences
```

Key integrity rules: FKs with CASCADE on child tables; CHECK constraints on all enums and money
(> 0 on payments, ≥ 0 on invoices); UNIQUE on all document numbers and clinic names
(case-insensitive); `doc_sequences` guarantees gap-free-ish numbering (DS-, INV-, PAY-, ADV-, CR-…)
without collisions. `qc_inspections` is append-only with `UNIQUE(dedupe_key)` as the retry
guard: an inspection is never updated in place — a mistake is amended by a `correction`
row carrying `supersedes_id`, and QC state/metrics are derived from the stream.

## Migration from old localStorage data (Phase 3)

`src/db/legacyMigrator.ts` runs once per profile at boot (guarded by `app_meta.legacy_import_done`):

1. Reads all legacy keys (`dsw_sqlite_*`, `dsw_*`, `dental_solutions_clinical_specs`,
   `dsw_custom_chairside_appts`).
2. Validates each record; valid → imported into SQLite; invalid → preserved in `legacy_backup`
   and counted in the report. **Nothing is silently dropped.**
3. Embedded invoice payments become standalone `payments` rows with their proof attachments.
4. Plaintext legacy user passwords are re-hashed with PBKDF2 on import.
5. Document counters re-aligned past imported numbers.
6. Full report stored in `app_meta.legacy_import_report`; originals remain in localStorage until
   the user deletes them from Settings (nothing is auto-destroyed).

## Backup / restore

Phase 8 deliverable (Settings UI): export the DB snapshot bytes + attachments as a versioned
`.dentalbackup` package; restore validates the header, takes a safety snapshot of current data,
then swaps atomically. That export/restore path is proven by `tests/services/backup.test.ts`,
`tests/services/backupRestore.test.ts` and `tests/services/backupRestoreSafety.test.ts`; the
engine-level snapshot round-trip underneath it is `tests/db/persistence.test.ts`.

## Seeding

`src/db/seeds.ts` — idempotent; only fills empty tables. **It seeds no users at all:** the app
ships zero accounts, and the operator's Super Admin is created through the login screen's
first-run setup flow (`src/components/auth/LoginPage.tsx`), so the operator chooses that
credential rather than inheriting a documented default. What it does seed is the 8-item catalog,
clinical specs, branding, notification config, and email templates. Synthetic demo data only;
no real patient data ships with the repo.
