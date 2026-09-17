# DATA MIGRATION REPORT — localStorage → SQLite

**Migration run:** one-time, automatic on first boot after the Phase 2–4 cutover.
**Flag:** stored in `app_meta` (`legacy_import_done = true`) — never runs twice per profile.

## What was migrated

The pre-migration app persisted every module in ~40 `dsw_*` localStorage JSON keys.
The importer (`src/db/legacyMigrator.ts`) reads those keys, validates each record,
and inserts it into SQLite inside transactions:

| Legacy key | Destination table(s) | Validation |
|---|---|---|
| `dsw_sqlite_users`, `dsw_users` | `users` | username dedupe; plaintext passwords re-hashed (PBKDF2); super-admin guaranteed |
| `dsw_labs` | `labs` (+ contacts/addresses/reviews child rows) | required name; child rows linked by FK |
| `dsw_casetypes` | `case_types` | price fields coerced to numeric CHECKs |
| `dsw_cases` | `cases`, `case_teeth`, `case_notes`, `case_status_history` | FDI tooth validation; status history reconstructed |
| `dsw_case_attachments` | `attachments` | metadata only; payloads kept inline where present |
| `dsw_invoices` | `invoices`, `invoice_items` | amounts validated; canonical refs realigned |
| `dsw_payments` | `payments`, `payment_attachments` | amounts > 0; orphan payments skipped to quarantine |
| `dsw_advance_payments` | `advance_payments` | linked to invoice/patient where resolvable |
| `dsw_account_adjustments` | `account_adjustments` | type CHECK enforced |
| `dsw_journal_entries` | `journal_entries`, `journal_lines` | debit/credit balance verified per entry |
| `dsw_ledger_entries` | `ledger_entries` | rebuilt from canonical refs where possible |
| `dsw_reconciliation_items` | `reconciliation_items` | — |
| `dsw_notifications` | `notifications` | — |
| `dsw_audit_events` | `audit_events` | — |
| `dsw_templates` | `case_templates` | — |
| `dsw_saved_vouchers` | `saved_vouchers` | — |
| `dsw_lab_contacts` / `dsw_lab_addresses` / `dsw_pricing_overrides` / `dsw_lab_reviews` / `dsw_doctor_preferences` | lab/doctor child tables | FK to labs/patients |
| `dsw_notif_config` / `dsw_email_templates` / `dsw_user_prefs` / `dsw_branding` / `dsw_clinical_specs` | settings repos (keyed JSON) | defaults used when absent |

## Guarantees

- **No silent loss.** Records failing validation are written verbatim to the
  `legacy_backup` table (quarantine) with a reason, and counted in the report.
- **Report persisted.** The full per-table report (migrated / skipped / warnings)
  is stored in `app_meta` (`legacy_import_report`) and retrievable via
  `getLastLegacyReport()`.
- **Idempotent.** Guarded by the `legacy_import_done` flag; safe across restarts.
- **Counters realigned.** Document sequences (`DS-`, `INV-`, `PAY-`, …) are
  advanced past every imported number, so new records never collide.

## Result (fresh-install baseline)

A brand-new profile imports zero legacy rows (there is nothing to import) and is
seeded instead: default users (hashed), catalog, clinical specs, branding, email
templates. Existing clinic profiles keep every record listed above.

## Notes

- The legacy `dsw_*` keys are **left in place** (not deleted) so a post-migration
  rollback to the pre-migration build remains possible. They can be cleared from
  Settings → System Reset → Total Data Wipe once the clinic has verified its data
  and taken a `.dentalbackup` export.
- Backup files created by the pre-migration JSON exporter can still be parsed
  into the new database via the quarantined-fields path; the authoritative
  restore path is now the `.dentalbackup` package (see `docs/DATABASE.md`).
