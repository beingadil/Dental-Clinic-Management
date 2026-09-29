# Findings — System Audit (evidence, file:line)

## Architecture
- Stack: React 19 + Vite 6 SPA, Tauri 2 (Rust), SQLite via sql.js WASM (in-memory, snapshot persistence).
- Persistence contract: React state = mirror; `syncCollectionsToDb` (debounce 150ms) DELETE+re-INSERT of ~17 whole tables in ONE transaction (src/db/syncCore.ts).
- Desktop: engine bytes → `db_save_bytes` IPC → atomic file (tmp+fsync+rename). Browser: base64 snapshot in localStorage (quota ~5MB — fails at scale, console-only error).
- Two parallel legacy layers kept: sqliteDbService.ts (985 LOC, localStorage-backed "service layer") + sqliteStorage.ts (467 LOC, SQL dump exporter). db/repos.ts (1904 LOC) is the live layer.

## DB integrity — good bones
- Migrations 001-011, ledger assert tests; FKs ON at open (engine.ts:65 `PRAGMA foreign_keys=ON`); CHECK constraints on money ≥0, rating 0-5, status enums; UNIQUE on invoice_number, adjustment_number, journal_number (migrations.ts).
- Cascade deletes verified in casesRepo.deleteCascade (repos.ts:1457).
- Money = REAL, not INTEGER cents; no rounding policy found anywhere.

## Business logic / finance
- Double-entry model exists (journal_entries + journal_lines, migrations.ts:369-395) with validateBalanced (financeDomain.ts:39) — but: buildInvoiceJournal has ZERO production callers (grep: only financeDomain + tests). Invoices post NO journal.
- Only ~3 payment journal builders invoked, from inside AppContext UI flow (2081, 2180, 2620) — business logic living in UI context.
- `saveVoucherToSystem` side effect inside payment flow; `payVoucher.journal_id` mutation after save (AppContext:2096).
- Notification generators in AppContext (1095-1174) = business rules in UI (already partially fixed 564e871: dedupe + sync heal).
- status_v2 derived on read (deriveInvoiceStatus) — good; payment_status also stored = dual truth.

## State management
- AppContext.tsx = 3479 LOC, 8 useEffects, ~17 collections in one provider. Known scale fix pattern exists (clinicAccounts Map index) but BillingView/clinics-grid/ledger still mount-all.

## Auth / security
- PBKDF2-SHA256, WebCrypto, salted (crypto.ts) — solid. Sessions table with expiry (repos.ts:105-122).
- NO brute-force lockout/delay found (grep attempt/lockout: none in login flow).
- tauri.conf.json:24 `"csp": null` — dev default shipped.
- Role checks: only 5 `role ===`/isSuperAdmin matches in components; backend repos have no per-role authorization (single-user desktop context, but master prompt asks to flag).
- Rust: file_sha256(path) reads ANY path (lib.rs:209); backup_delete takes arbitrary name — no path canonicalization seen (check remaining lines); open_external + update hosts allowlisted (good); fail-closed SHA256SUMS verify (good).

## Testing
- 17 test files / 112 tests: migrations ledger, FK cascade, QC, restore drill, backup roundtrip, first-run admin, persistence. Strong for a desktop app.

## UI
- window.print() for all print/PDF (6 modals) — no jsPDF/html2canvas deps (lean, correct choice).
- No breadcrumbs; 8-view switch; mobile bottom nav exists; SettingsView 2282 LOC with many tabs.
