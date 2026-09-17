# DATABASE.md — SQLite Architecture

## Engine

- **sql.js 1.13.0** — SQLite compiled to WebAssembly, bundled at build time (`dist/assets/sql-wasm-*.wasm`).
  No CDN, no server, no native modules: the entire database runs and persists locally, fully offline.
- Persistence: the full SQLite file (`engine.export()`) is snapshotted to the single localStorage key
  `dsw_sqlite_snapshot` (base64, `DSDB1:` header), debounced 400 ms after any write and flushed on page hide/unload.
  Corrupt/foreign snapshots are detected by header and safely discarded.
- Under a future desktop shell (Tauri/Electron), `src/db/persistence.ts` is the single seam that changes:
  the same bytes go to a real file instead of localStorage. Zero engine/repository changes.

## Migrations

- `src/db/migrations.ts` — ordered, append-only; each runs inside a transaction.
- Applied versions recorded in `schema_migrations`; re-runs skip applied versions (idempotent).
- Current: `001_initial_schema`, `002_pragmas_and_fts` (ledger table), `003_demo_fixtures` (reserved), `004_app_version`.
- **Never edit an applied migration.** Add a new numbered one.
- `PRAGMA foreign_keys = ON` is set on every connection open.

## Schema (v4)

```
users ─┬─< sessions
       └─(role gating in app code)
labs (clinics) ─┬─< lab_contacts / lab_addresses / lab_pricing_overrides / lab_reviews
                ├─< cases ─┬─< case_teeth (FDI per-tooth detail)
                │          ├─< case_status_history
                │          ├─< case_notes
                │          └─< attachments (metadata + blob)
                ├─< invoices ─┬─< invoice_items
                │             ├─< payments ─┬─< payment_attachments
                │             │             └─< payment_allocations (payment→invoice splits)
                │             └─< advance_payments >─ advance_allocations
                │             └─< account_adjustments (credit notes, write-offs…)
                └─< doctor_preferred_labs
journal_entries ─< journal_lines (double entry)
ledger_entries (materialized, UNIQUE(entry_type, reference_id) = idempotency guard)
reconciliation_items, notifications, saved_vouchers, audit_events (append-only)
settings (namespaced K/V), notification_config, email_templates
clinical_materials / clinical_prep_types / shade_guides / implant_brands
chairside_appointments, case_templates, legacy_backup (quarantine), app_meta, doc_sequences
```

Key integrity rules: FKs with CASCADE on child tables; CHECK constraints on all enums and money
(> 0 on payments, ≥ 0 on invoices); UNIQUE on all document numbers and clinic names
(case-insensitive); `ledger_entries` UNIQUE guard prevents double-posting the same source
transaction; `doc_sequences` guarantees gap-free-ish numbering (DS-, INV-, PAY-, ADV-, CR-…)
without collisions.

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
then swaps atomically. The engine export/restore path is already proven by
`tests/db/persistence.test.ts`.

## Seeding

`src/db/seeds.ts` — idempotent; only fills empty tables. Seeds the four users with **hashed**
passwords (the old plaintext seeds are gone), the 8-item catalog, clinical specs, branding,
notification config, and email templates. Synthetic demo data only; no real patient data ships with the repo.
