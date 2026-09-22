# ARCHITECTURE AUDIT — Dental Solutions Web

Audit date: 2026-09-17 (Phase 0 discovery, read-only)
Source of truth: actual repository contents. No functionality was modified during this audit.

---

## 1. Executive Summary

"Dental Solutions Web" is a **client-only React SPA** prototyped in Google AI Studio. It is a
substantial dental laboratory ERP (~80 source files, ~3,000-line central state manager) covering
case production, clinic (lab) management, and a double-entry financial engine. There is **no
backend**: all persistence is browser `localStorage`. A service layer *claims* to be SQLite
(`sqliteDbService.ts` / `sqliteStorage.ts`) but is actually a localStorage JSON store using SQL
terminology and generating `.sql` text exports — no real SQLite engine exists at runtime.

The app is already offline-capable in the network sense (zero runtime `fetch` calls were found),
but it is **not** offline-durable: data lives in browser storage with a ~5 MB quota, is
instance-bound (cleared by clearing browser data), and binary attachments are stored as base64
data URLs inside localStorage.

---

## 2. Stack (discovered)

| Layer | Technology | Evidence |
|---|---|---|
| Framework | React 19 + TypeScript 5.8 | `package.json`, `src/main.tsx` |
| Bundler / dev server | Vite 6, port 3000 | `vite.config.ts`, `package.json` scripts |
| Styling | Tailwind CSS v4 (via `@tailwindcss/vite`), custom CSS in `src/index.css` | |
| Icons | lucide-react 0.546 | |
| Charts | recharts 3.10 | |
| Animation | motion 12.23 | |
| QR codes | qrcode.react 4.2 | used on payment receipts |
| Fonts | **Plus Jakarta Sans + JetBrains Mono from Google Fonts CDN** (`index.html`) | ⚠ offline blocker |
| AI Studio remnant | `@google/genai` in deps, dotenv, express, `metadata.json` server-capability flag | ⚠ **zero usage in `src/`** — removable |
| Package manager | `bun.lock` present; **only node v24 + npm available on this machine** | → use npm |
| Runtime environment | Desktop browser via `npm run dev` / `npm run build` (no Tauri/Electron shell) | |
| Git | **No repository initialized** (`fatal: not a git repository`) | Phase 13 task |
| Tests | **None** (0 test files) | Phase 11 task |
| Backend | None. `express` is a dependency but no server code exists in `src/` or scripts | |

Entry point: `index.html` → `src/main.tsx` → `src/App.tsx` → `AppProvider` (context) + view switch.

---

## 3. Actual Runtime Data Flow (audited)

```
React components (57 .tsx files)
        │  useApp() hook — 100+ actions/state fields
        ▼
AppContext.tsx (3,075 lines — monolithic state manager + business logic)
        │  useState(...) initialized from →
        ▼
sqliteDbService.ts  ──(misnomer)──►  localStorage JSON blobs  (dsw_sqlite_* keys)
   plus ~20 parallel raw localStorage keys (dsw_*) written by useEffect sync loops
        │
        ▼
Binary attachments (case files, payment screenshots, logos) = base64 data URLs inside JSON
```

**Persistence inventory (all localStorage):**

| Storage key(s) | Entity | Via service? |
|---|---|---|
| `dsw_sqlite_cases`, `dsw_cases` | Dental cases (dup 2×) | sqliteDbService + context sync |
| `dsw_sqlite_labs`, `dsw_labs` | Clinics/labs (dup 2×) | same |
| `dsw_sqlite_case_types`, `dsw_casetypes` | Catalog | same |
| `dsw_sqlite_invoices`, `dsw_invoices` | Invoices incl. embedded payments (dup 2×) | same |
| `dsw_sqlite_notifications`, `dsw_notifications` | Notifications (dup 2×) | same |
| `dsw_sqlite_advance_payments`, `dsw_advance_payments` | Advance deposits (dup 2×) | same |
| `dsw_sqlite_adjustments`, `dsw_account_adjustments` | Credit notes/adjustments (dup 2×) | same |
| `dsw_sqlite_journal_entries`, `dsw_journal_entries` | Journal (dup 2×) | same |
| `dsw_sqlite_audit_events`, `dsw_audit_events` | Audit log (dup 2×) | same |
| `dsw_sqlite_users`, `dsw_users` | Users (dup 2×) | same |
| `dsw_sqlite_branding`, `dsw_branding` | Branding | same |
| `dsw_sqlite_preferences`, `dsw_user_prefs` | Preferences | same |
| `dsw_sqlite_vouchers`, `dsw_saved_vouchers` | Saved vouchers | same |
| `dsw_sqlite_case_notes`, `dsw_case_notes` | Case notes (Record-map) | context-only |
| `dsw_sqlite_case_attachments`, `dsw_case_attachments` | Case attachments base64 | context-only |
| `dsw_templates`, `dsw_lab_contacts`, `dsw_lab_addresses`, `dsw_pricing_overrides`, `dsw_lab_reviews`, `dsw_doctor_preferences`, `dsw_notif_config`, `dsw_email_templates`, `dsw_reconciliation_items` | Misc config/relations | context-only |
| `dental_solutions_clinical_specs` | Materials, prep types, shade guides, implant brands | clinicalSpecsService |
| `dsw_custom_chairside_appts` | Chairside calendar appointments | ChairsideCalendarModal |
| `dentlab_workstation_view_mode` | UI view mode | CaseListView |
| `dsw_remember_user`, `dsw_auth_user`, `dsw_user` | Session/remember-me | AppContext |

**Dual-write defect confirmed:** AppContext hydrates from `sqliteDb` *or* falls back to
`dsw_*` keys, then writes *every* state change back to *both* storages via `useEffect`.
Two divergent copies of business data exist in the same browser profile.

---

## 4. Authentication (current)

- Local username/password against user records; **plaintext passwords** in `src/data/initialData.ts`.
- **Hardcoded super-admin backdoor** in `login()`: `adil` / `███████` bypasses the user list.
- Session persisted as full user object (incl. password) in localStorage; remember-me supported.
- Roles: `Super Admin`, `Lab Admin`, `Technician`, `Billing Manager` with view-level gating.
- On login, non-Technician users are auto-logged-in as `INITIAL_USERS[0]` if nothing persisted.

---

## 5. Module Inventory (discovered from source — 10 view modules + shared)

| Module | Main components | Notes |
|---|---|---|
| Auth | `auth/LoginPage` | role-based routing on login |
| Dashboard | `dashboard/DashboardView`, `InteractiveDeliveryCalendar`, `ChairsideCalendarModal`, `PaymentCollectionModal`, `BatchBillingModal`, `ShadeGuideModal`, `ClinicNotesModal`, `ClinicStatementModal` | metrics derived in-memory from context collections |
| Cases / Workstation | `cases/CaseListView` (kanban/list/floor views), `CaseDetailModal` (1,700+ lines: odontogram, teeth details, notes, attachments), `Odontogram`, `CaseProgressIndicator`, `CaseTemplateModal`, `CaseAttachmentsPanel`, `CaseNotesPanel`, `BulkPrintModal`, `CaseJobSlipModal`, `LabCardSlip` | FDI tooth numbering; status lifecycle draft→received→in_progress→qc→ready→delivered (+revision, cancelled) |
| Labs / Clinics | `labs/LabListView`, `LabDetailModal`, `LabContactsManager`, `LabPricingManager`, `LabReviewsManager` | contacts, addresses, price overrides, reviews |
| Billing | 18 components: `BillingView`, `AccountsFinancialHome`, `TransactionRegister`, `LedgerView`, `GeneralLedgerView`, `BillingReportsView`, `AuditLogView`, `InvoiceDetailDrawer`, `InvoiceStatementModal`, `ClinicStatementModal`, `PaymentModal`, `PaymentReceiptModal`, `PaymentProofModal`, `PaymentProofUploader`, `RecordTransactionModal`, `AdvancePaymentModal`, `AccountAdjustmentModal`, `JournalEntryModal`, `ReversalModal` | full AR engine: allocations, advances, credit notes, reversals, reconciliation, double-entry journal |
| Catalog | `catalog/CatalogView` | case types + pricing matrix (printable) |
| Analytics | `analytics/AnalyticsView` | charts from in-memory collections |
| Notifications | `notifications/NotificationsView` | read/archive/bulk ops |
| Settings | `settings/SettingsView` | branding, users, notification config, email templates, clinical specs, **backup/restore (JSON download/upload)**, SQLite dump export, demo reset/wipe |
| Common | Header (global search), Sidebar, Toast, ConfirmationModal, ErrorBoundary, ui primitives | |

**Financial domain logic** lives in `src/services/financeDomain.ts` (journal builders, invoice
status derivation, aging buckets) — pure functions, reusable against any storage layer.

---

## 6. External / Network Dependencies

| Dependency | Runtime? | Required for core workflow? |
|---|---|---|
| Google Fonts CDN | Yes (index.html) | No — self-hostable |
| `@google/genai` | **No** (unused in src) | No — remove |
| Firebase / Supabase / any API | **None found** | — |
| `fetch`/XHR calls | **None found** | — |
| npm registry | Only at install/build time | — |

Offline risk list: fonts CDN (P0), browser-storage fragility (P0 — the actual persistence risk),
AI Studio tooling files (P2 hygiene).

---

## 7. Security Findings (Phase 0 scan)

1. Plaintext passwords in seed data (`initialData.ts`, duplicated in `AppContext.tsx`).
2. Hardcoded credential backdoor (`adil/███████`) in `AppContext.login()`.
3. Full user object (with password) persisted in localStorage session keys.
4. Attachments embedded as base64 in JSON — no size/type validation beyond UI; quota failures are swallowed with `console.warn` (silent data loss on quota breach).
5. `metadata.json` advertises a server-side Gemini capability the code does not use (stale).
6. No secrets/API keys found in source. No `.env` file of any kind exists in the
   repository (all env variants, including examples, are git-ignored and were
   removed); the Gemini dependency was deleted with the AI Studio remnants.
7. SQL-ish export uses string interpolation, but it is export-only text, not an executed query engine (no injection surface today — keep it that way).

---

## 8. Known Defects / Risks Register

| # | Severity | Finding |
|---|---|---|
| D1 | Critical | Persistence is localStorage under a false "SQLite" identity; ~5 MB quota; per-browser-profile; wiped by "clear browsing data" |
| D2 | Critical | Dual storage (dsw_sqlite_* + dsw_*) can diverge; fallback hydration order is inconsistent |
| D3 | High | Base64 attachments inside JSON risk quota exhaustion → silent write failures |
| D4 | High | Plaintext passwords + credential backdoor |
| D5 | Medium | `reconciliationItems`, templates, lab contacts/addresses/pricing/reviews/doctor prefs, email templates, notification config, clinical specs, chairside appointments live only in raw localStorage (no service, no backup inclusion in some paths) |
| D6 | Medium | No tests, no lint, no CI, no git history |
| D7 | Medium | Fonts require network on first load; no offline cache |
| D8 | Low | `Invoice` embeds `payments[]` array inside the invoice record (denormalized, dup of payment data) |
| D9 | Low | Backup (Settings) is ad-hoc JSON; no schema version, no validation, no attachments packaging guarantee |
| D10 | Low | Unused deps (@google/genai, express, dotenv) + AI Studio artifacts (metadata.json, assets/.aistudio) |
| D11 | Low | Ledger `running_balance` is derived client-side per render (must become derived-on-read or persisted-with-transaction under SQLite) |

---

## 9. Constraints Imposed by This Audit

- UI/UX, module structure, and the `AppContext` public API are **preserved**; migration swaps the
  storage engine beneath the same interface (components keep calling `useApp()`).
- Seed/demo data arrays in `initialData.ts` are empty-by-design (production-clean deployment);
  users are the only seeded records. This makes SQLite seeding trivial and keeps patient data out of Git.
- All module routes/components listed above must remain functional after migration — the module
  inventory above is the acceptance checklist.
