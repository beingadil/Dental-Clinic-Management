# MIGRATION AUDIT — localStorage → SQLite (Dental Solutions Web)

Companion to `ARCHITECTURE_AUDIT.md`. Every module traced: **UI → state → service → storage → result → UI**.
No code modified yet (Phase 0). Status vocabulary: `NOT STARTED / IN PROGRESS / MIGRATED / VERIFIED`.

---

## A. How data currently flows (traced)

Every module renders from `useApp()` state collections (React `useState` hydrated once at boot
from `sqliteDb` (localStorage) or legacy `dsw_*` keys). Mutations call context actions that:
1. mutate React state,
2. write to `sqliteDb` (localStorage) for entities that support it,
3. write a parallel `dsw_*` localStorage key via `useEffect`.

Result: business data lives in **two divergent localStorage copies**; several config collections
live in raw localStorage with no service at all. No module touches a real database.

---

## B. Module inventory & migration status

### 1. Auth & Users — `LoginPage`, `SettingsView` (user management)
- **Features:** login (username/email + password), remember-me, logout, role-based routing
  (Technician → cases), add/edit/delete users, change password, hidden super-admin.
- **Current data source:** `dsw_sqlite_users` + `dsw_users` (dup), plaintext passwords, hardcoded
  `adil/███████` backdoor, session user object (with password) in localStorage.
- **Entities:** `users` (+ future `sessions`, password hashes).
- **Migration status:** NOT STARTED — **Offline status:** OFFLINE (network-free already).
- **Problems:** plaintext secrets (D4); backdoor must be replaced by hashed credential check +
  forced setup; password hashing needed (WebCrypto PBKDF2 — no new dependency).

### 2. Dashboard — `DashboardView` + 7 modals
- **Features:** operational stat cards (active fabrication, pending billing, receivables,
  rush/overdue, deliveries, chairside cases), delivery calendar, chairside appointment manager,
  payment collection entry point, batch billing, shade guide reference, clinic notes, statement print.
- **Current data source:** all metrics computed in-memory from context collections (cases, invoices,
  payments); chairside appointments in `dsw_custom_chairside_appts`.
- **Entities:** reads `cases`, `invoices`, `payments`, `deliveries`(derived); `chairside_appointments`.
- **Migration status:** NOT STARTED — **Offline:** OFFLINE.
- **Problems:** metrics are derived from possibly-divergent duplicate stores; no hardcoding found
  (good); chairside appts outside service layer (D5).

### 3. Cases / Dental Workstation — `CaseListView`, `CaseDetailModal`, Odontogram, slips
- **Features:** kanban/list/floor views, global + column search, filters (status, lab, priority,
  overdue, due-today/week), create/edit/delete cases, FDI odontogram with per-tooth details
  (shade, prep type, material, implant brand/size), status transitions with history, case notes
  (add/edit/delete), attachments (upload/preview/download/delete), case templates (save/use/delete),
  job slip + lab card printing, bulk print, QR on slips.
- **Current data source:** `dsw_sqlite_cases` + `dsw_cases` (dup); notes/attachments in
  `dsw_case_notes` / `dsw_case_attachments` (Record maps, base64); templates in `dsw_templates`;
  clinical specs (materials, prep types, shade guides, implant brands) in
  `dental_solutions_clinical_specs` via `clinicalSpecsService`.
- **Entities:** `cases`, `case_teeth` (from tooth_details), `case_status_history`, `case_notes`,
  `attachments`, `case_templates`, `clinical_materials`, `clinical_prep_types`, `shade_guides`,
  `implant_brands`, `chairside` n/a.
- **Migration status:** NOT STARTED — **Offline:** OFFLINE.
- **Problems:** history embedded as JSON in case row (dup); attachments base64 (D3); no size/type
  validation at service level; notes/attachments not in `sqliteDb` backup paths consistently (D5).

### 4. Labs / Referring Clinics — `LabListView`, `LabDetailModal`, contacts/pricing/reviews managers
- **Features:** CRUD labs (clinics), detail drawer with financial summary, contacts CRUD, addresses
  CRUD, pricing overrides CRUD, reviews CRUD, doctor→preferred-lab mapping, search.
- **Current data source:** `dsw_sqlite_labs` + `dsw_labs` (dup); contacts/addresses/overrides/
  reviews/doctor-prefs in raw `dsw_*` keys.
- **Entities:** `labs` (clinics), `lab_contacts`, `lab_addresses`, `lab_pricing_overrides`,
  `lab_reviews`, `doctor_preferred_labs`.
- **Migration status:** NOT STARTED — **Offline:** OFFLINE.
- **Problems:** five related collections outside service layer (D5); deleting a lab does not
  cascade to cases/invoices (orphan risk — needs FK policy decision).

### 5. Billing & Invoices (financial core) — 18 components
- **Features:** invoice list/detail/create (from cases or manual), invoice numbering (INV-),
  line items, discounts, payment status derivation, partial payments, payment allocation across
  invoices, multiple payments per invoice, payment proof images (multiple per payment), receipts
  with QR, payment numbering (PAY-) and receipt numbering (REC-), advance deposits (ADV-) with
  allocation to invoices, credit notes / debit adjustments / refunds / write-offs (ADJ-/CR-),
  reversals with reason, transaction register, clinic ledger + general (double-entry) ledger with
  journal entries (JE-), aging buckets, billing reports, clinic statements, audit log view,
  reconciliation (match/verify/exception), batch billing, print.
- **Current data source:** `dsw_sqlite_invoices` (payments embedded in invoice JSON) + `dsw_invoices`
  (dup); advance payments/adjustments/journal entries/audit events duplicated likewise;
  reconciliation items raw localStorage. Financial math in `financeDomain.ts` (pure, good).
- **Entities:** `invoices`, `invoice_items`, `payments`, `payment_allocations`, `payment_attachments`,
  `advance_payments`, `advance_allocations`, `account_adjustments`, `journal_entries`,
  `journal_lines`, `ledger_entries` (or derived), `reconciliation_items`, `audit_events`.
- **Migration status:** NOT STARTED — **Offline:** OFFLINE.
- **Problems:** payments denormalized inside invoices (D8); balance math must be authoritative at
  DB level (sum of allocations); no transactionality across payment+journal+allocation writes.

### 6. Ledger / General Ledger — `LedgerView`, `GeneralLedgerView`
- **Features:** per-clinic ledger with running balance, debit/credit entries, source traceability
  (invoice/payment/advance/adjustment), attachments count, general ledger with journal lines by
  account, print.
- **Current data source:** derived on-the-fly in AppContext (`getLedgerEntries`) from invoices +
  payments + advances + adjustments; journal from `dsw_sqlite_journal_entries`.
- **Entities:** `ledger_entries` (derive or persist), `journal_entries`, `journal_lines`.
- **Migration status:** NOT STARTED — **Offline:** OFFLINE.
- **Problems:** running_balance recomputed per render; must be deterministic under SQLite ordering.

### 7. Catalog — `CatalogView`
- **Features:** case-type CRUD (name, base price, category, lead time, warranty), printable price
  list.
- **Current data source:** `dsw_sqlite_case_types` + `dsw_casetypes` (dup).
- **Entities:** `case_types`.
- **Migration status:** NOT STARTED — **Offline:** OFFLINE.

### 8. Analytics & Reports — `AnalyticsView`
- **Features:** revenue/collection charts, status distribution, top clinics, material share, aging.
- **Current data source:** computed from context collections (recharts).
- **Entities:** reads only.
- **Migration status:** NOT STARTED — **Offline:** OFFLINE.
- **Problems:** inherits divergence risk; will be correct once sources are single SQLite truth.

### 9. Notifications — `NotificationsView`, header bell
- **Features:** in-app notification feed, unread counts, read/unread/archive/restore/delete/bulk,
  overdue & payment reminder generation, notification config (frequencies, escalation), email
  templates editor (offline stub — no SMTP; kept as document store).
- **Current data source:** `dsw_sqlite_notifications` + `dsw_notifications` (dup); config +
  email templates raw localStorage.
- **Entities:** `notifications`, `notification_config` (settings), `email_templates`.
- **Migration status:** NOT STARTED — **Offline:** OFFLINE.
- **Problems:** email sending does not exist (UI-only) — documented as out-of-scope for offline core.

### 10. Settings — `SettingsView`
- **Features:** branding (logo upload base64, colors, bank details), user management, notification
  config, email templates, clinical specs editors, backup export/import (ad-hoc JSON), SQLite .sql
  dump export, demo reset, wipe data, storage usage display.
- **Current data source:** `dsw_sqlite_branding`/`dsw_branding`, `dsw_sqlite_preferences`/
  `dsw_user_prefs`, clinical specs key; backup paths assemble from context state.
- **Entities:** `settings` (key/value or typed), `attachments` (logo), backup manifests.
- **Migration status:** NOT STARTED — **Offline:** OFFLINE.
- **Problems:** backup has no schema version/validation; restore replaces state without safety
  copy beyond undo (D9).

### 11. Cross-cutting: global search (Header), toasts, confirmation modal, error boundary
- **Search:** filters cases/labs/invoices/notifications in memory across context collections.
- **Migration status:** NOT STARTED — should query SQLite (indexed LIKE) post-migration.
- **Offline:** OFFLINE.

---

## C. Entity → table mapping plan (target schema v1)

| Table | Source (today) | Notes |
|---|---|---|
| `users` | INITIAL_USERS + dsw users | add `password_hash`, `password_salt`, `is_super_admin` |
| `sessions` | dsw_auth_user | token, user_id, created_at, expires_at |
| `labs` | dsw labs | clinic master |
| `lab_contacts`, `lab_addresses`, `lab_pricing_overrides`, `lab_reviews`, `doctor_preferred_labs` | raw dsw keys | FK → labs |
| `case_types` | dsw casetypes | catalog |
| `cases` | dsw cases | tooth_details JSON → also normalize |
| `case_teeth` | cases.tooth_details | one row per tooth |
| `case_status_history` | cases.history | one row per transition |
| `case_notes` | dsw_case_notes | FK → cases |
| `case_templates` | dsw_templates | |
| `clinical_materials`, `clinical_prep_types`, `shade_guides`, `implant_brands` | clinicalSpecsService | seeded defaults |
| `invoices` | dsw invoices | drop embedded payments |
| `invoice_items` | (UI computes) | line items |
| `payments` | invoice.payments | standalone rows, PAY-/REC- numbers |
| `payment_allocations` | allocations V2 | payment→invoice split |
| `payment_attachments` | payment.attachments | metadata + blob ref |
| `advance_payments`, `advance_allocations` | dsw advance_payments | |
| `account_adjustments` | dsw adjustments | credit notes etc. |
| `journal_entries`, `journal_lines` | dsw journal entries | lines normalized |
| `reconciliation_items` | dsw reconciliation | |
| `notifications` | dsw notifications | |
| `notification_config`, `email_templates` | raw dsw | single-row config / template rows |
| `settings` | branding + prefs | key/value JSON per namespace |
| `attachments` | case attachments + logo | metadata rows; blobs on disk |
| `audit_events` | dsw audit | append-only |
| `schema_migrations` | — | version bookkeeping |
| `app_meta` | dsw_sqlite metadata | db version, seeded flags |

---

## D. Data migration (Phase 3) source inventory

Legacy localStorage keys to import on first run (idempotent, flagged in `app_meta`):
`dsw_sqlite_*` (authoritative where present), `dsw_*` fallbacks, `dental_solutions_clinical_specs`,
`dsw_custom_chairside_appts`. Records failing validation → logged to migration report, preserved in
`legacy_backup` table; never silently dropped. Fresh installs skip import and get seed users +
catalog + clinical defaults only.

---

## E. Offline status summary

All 11 modules: **OFFLINE today** (no network calls). The only runtime network dependency is the
Google Fonts CDN on first paint. Migration therefore changes *durability* (SQLite file vs
localStorage), not connectivity. Post-migration offline verification checklist is defined in
`MIGRATION_PROGRESS.md`.
