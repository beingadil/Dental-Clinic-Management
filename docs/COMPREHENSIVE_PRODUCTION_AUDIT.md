# Comprehensive Production Audit — Dental Solutions v2.2.0

**Audit Date:** 2026-09-22  
**Target Environment:** Single-user Tauri 2 desktop app, local SQLite, no server  
**Scope:** Security, Hardcoded Values, UI/UX (forms, buttons/icons, navigation, accessibility), Testing & Reliability, Code Quality, Deployment, Data Integrity, Compliance  
**Source:** `src/`, `tests/`, `docs/`, `package.json`, `vite.config.ts`, `tsconfig.json`, `src-tauri/tauri.conf.json`, `.github/workflows/ci.yml`

---

## 1. Executive Summary

| Dimension | Status | Critical | High | Medium | Low |
|---|---|---|---|---|---|
| Security | ⚠ BLOCKED | 15 | 10 | 15 | 8 |
| UI/UX | ⚠ REQUIRES WORK | 0 | 0 | 12 | 18 |
| Testing & Reliability | ⚠ PARTIAL | 0 | 0 | 8 | 6 |
| Code Quality & Deployment | ⚠ PARTIAL | 1 | 3 | 4 | 3 |
| Data Integrity | ⚠ PARTIAL | 2 | 2 | 3 | 2 |
| Compliance | ⚠ NOT MET | 3 | 2 | 4 | 2 |
| **Overall** | **NOT PRODUCTION READY** | **21** | **17** | **46** | **39** |

**Bottom Line:** The app has a solid core (SQLite engine, typed repos, PBKDF2 auth, 63 automated tests). However, **critical blocking issues remain** — hardcoded bootstrap passwords, uncommitted user DB changes, disabled CSP, missing safety snapshot on restore, and pervasive UI/UX accessibility failures. A production release requires addressing the Critical items first, then the High/Medium items in order.

---

## 2. Security Audit

### 2.1 Critical (must fix before release)

| # | File | Line | Finding |
|---|---|---|---|
| S-01 | `src/db/defaults.ts` | 16 | **Hardcoded plaintext bootstrap passwords:** `███████`, `███████`, `███████`, `███████`. These are hashed at boot, but the source file exposes them. Must rotate or remove. |
| S-02 | `src/db/defaults.ts` | 13, 23, 33, 43 | **Hardcoded bootstrap emails:** `adil@dentalsolutions.pk`, `admin@dentalsolutions.pk`, etc. |
| S-03 | `src/context/AppContext.tsx` | 856 | **Default password `'███████'`** when creating users without password: `await hashPassword(newUser.password || '███████')`. |
| S-04 | `src/context/AppContext.tsx` | 876-888 | **`addUser`, `updateUser`, `deleteUser` do NOT persist to SQLite.** Updates only React state; `usersRepo.update()/delete()` never called. User deletions and changes are invisible to DB. |
| S-05 | `src/context/AppContext.tsx` | 885-888 | **`deleteUser` filter condition is inverted** — may fail to delete the intended user. |
| S-06 | `src/components/settings/SettingsView.tsx` | 1855-1903 | **Password reset via Settings does not persist** — calls `updateUser()` which has no DB write. Old hash remains in SQLite. |
| S-07 | `src/context/AppContext.tsx` | 775-791 | **`createInitialAdmin` uses hardcoded domain** `${username}@dentalsolutions.pk` — reveals lab identity. |
| S-08 | `src/components/auth/LoginPage.tsx` | 79-83 | **`handleQuickFill` injects arbitrary username/password pairs** with no validation. Combined with bootstrap values, enables quick auth bypass. |
| S-09 | `src/context/AppContext.tsx` | 853-874 | **No brute-force protection** on login — rapid attempts possible. PBKDF2 is CPU-heavy but not rate-limited. |
| S-10 | `src-tauri/tauri.conf.json` | 23-25 | **CSP explicitly disabled** (`"csp": null`). Allows arbitrary script injection if renderer compromised. |
| S-11 | `index.html` | 1-21 | **No CSP meta tag** and no security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`). |
| S-12 | `src/services/sqliteStorage.ts` | 37-251 | **Schema mismatch in SQL export** — `SQLITE_DDL_SCHEMA` uses `password` column; actual DB uses `password_hash`/`password_salt`. SQL exports fail to restore auth data correctly. |
| S-13 | `src/services/sqliteStorage.ts` | 286-291 | **Potential plaintext password leak in SQL export** — accesses `u.password` instead of `u.password_hash`. |
| S-14 | `src/services/updateService.ts` | 18-22 | **Hardcoded external URLs** for update manifest (`beingadil.github.io`) and GitHub Releases API. No domain validation; compromised account = malicious updates. |
| S-15 | `src/components/settings/SettingsView.tsx` | 1293-1353 | **No file size limit** on `.dentalbackup` import — `file.text()` reads entire file into memory. Large files cause memory exhaustion (DoS). |

### 2.2 High

| # | File | Line | Finding |
|---|---|---|---|
| S-16 | `src/db/defaults.ts` | 59-77 | **Hardcoded bank/account details** in `DEFAULT_BRANDING_SETTINGS` (`bankAccountNumber`, `bankIban`). |
| S-17 | `src/context/AppContext.tsx` | 146-164 | **Hardcoded branding/identity values** — same bank details, phone `0333-0473797`, email `info@dentalsolutions.pk`, address `Batala Street...`. |
| S-18 | `src/components/settings/SettingsView.tsx` | 183-197 | **No MIME type validation** for logo upload — only size check (2MB). Malicious HTML disguised as `.jpg` could be uploaded. |
| S-19 | `src/services/backupService.ts` | 88-92 | **No file structure depth validation** before `JSON.parse` — deeply nested JSON could cause stack overflow. |
| S-20 | `src/services/updateService.ts` | 161-186 | **No SHA-256 algorithm enforcement** — checksum comparison exists but doesn't verify algorithm is SHA-256. |
| S-21 | `src/services/updateService.ts` | 103-159 | **No TLS certificate pinning** for external update URLs. Standard browser TLS only. |
| S-22 | `package.json` | 19-46 | **Dependency vulnerabilities:** `sql.js ^1.13.0` (WASM buffer issues), `lucide-react ^0.546.0` (very recent), `react ^19.0.1` (major version). Loose versions (`^`) allow drift. No `package-lock.json` verification in CI. |
| S-23 | `vite.config.ts` | 1-22 | **No production build hardening** — missing `build.minify`, `build.sourcemap: false`, `build.cssCodeSplit`. Source maps could leak source code. |
| S-24 | `src/components/settings/SettingsView.tsx` | 1569-1570 | **Data wipe requires only `"DELETE"` typed** — any admin (including newly created ones) can wipe all data without additional authorization. |
| S-25 | `src/components/settings/SettingsView.tsx` | 334-346 | **Wipe only clears React state + localStorage** — does not purge SQLite tables. Data persists on disk after "wipe". |

### 2.3 Medium

| # | File | Line | Finding |
|---|---|---|---|
| S-26 | `src/db/repos.ts` | 14 | **Weak random ID generation** (`Math.random()` + timestamp) — predictable IDs. |
| S-27 | `src/context/AppContext.tsx` | 694-695 | **Session token fallback uses `Math.random()`** instead of cryptographic random. |
| S-28 | `src/services/updateService.ts` | 71-100 | **No timeout on `fetch()` calls** to GitHub/Pages — could hang indefinitely on slow/offline networks. |
| S-29 | `src/services/updateService.ts` | 139-159 | **`window.open` external URL without validation** of `downloadUrl` domain. |
| S-30 | `src/components/settings/SettingsView.tsx` | 1288-1291 | **Restore doesn't enforce `.dentalbackup` extension** — a `.json` file passing `parseBackupFile` can be restored. |
| S-31 | `src/services/backupService.ts` | 94-119 | **Checksum comparison not constant-time** — timing attack possible (low risk for local file). |
| S-32 | `src/components/settings/SettingsView.tsx` | 1256-1272 | **Export `.dentalbackup` files are unencrypted** — physical access grants full data access. |
| S-33 | `src/components/auth/LoginPage.tsx` | 43-49 | **Remember-me stores plaintext username in `localStorage`** (`dsw_remember_user`). |
| S-34 | `src/db/crypto.ts` | 6 | **Hardcoded PBKDF2 iterations (`150_000`)** — should be in config for future rotation. |
| S-35 | `src/services/sqliteStorage.ts` | 415-452 | **Only parses JSON starting with `{`** — ignores `.sql` dumps entirely. `generateSqliteExport` output cannot be restored via `parseSqliteDumpToState`. |

### 2.4 Low / Best Practices

| # | File | Line | Finding |
|---|---|---|---|
| S-36 | `src/components/auth/LoginPage.tsx` | 222 | **Placeholder leaks bootstrap identity** — `placeholder="e.g. adil or adil@dentalsolutions.pk"`. |
| S-37 | `src/components/auth/LoginPage.tsx` | 395 | **Hardcoded support contact** in forgot-password modal (`support@dentalsolutions.pk`). |
| S-38 | `src/components/settings/SettingsView.tsx` | 378 | **Hardcoded user display text** (`Dr. Zeeshan (Admin)`) in settings header. |
| S-39 | `src/data/initialData.ts` | 122-163 | **Deprecated `INITIAL_USERS` still exported** — contains hardcoded bootstrap usernames/roles. |
| S-40 | `src/services/backupService.ts` | 17-19 | **App version hardcoded** (`'2.2.0'`) — must update manually; risk of version drift vs `package.json`. |
| S-41 | `src/components/settings/SettingsView.tsx` | 1569 | **Wipe does not create audit log entry** — backup/restore actions not audited. |
| S-42 | `src/main.tsx` | 9 | **No integrity check for WASM file** — `public/vendor/sql-wasm-*.wasm` could be replaced. |

---

## 3. Hardcoded Values & Config Audit

### 3.1 Must Be Configurable or Rotated

| Value | Location | Severity | Note |
|---|---|---|---|
| Bootstrap passwords (`███████`, etc.) | `src/db/defaults.ts` | Critical | Rotate immediately or remove plaintext |
| Default password `███████` | `src/context/AppContext.tsx:856` | Critical | Remove or force-set |
| Default bank account numbers | `src/db/defaults.ts:59-77` | High | Must be user-configurable |
| Default phone `0333-0473797` | `src/context/AppContext.tsx:146-164` | High | Must be user-configurable |
| Default email `info@dentalsolutions.pk` | Multiple files | High | Must be user-configurable |
| Hardcoded "today" date `'2026-08-02'` | `DashboardView.tsx:89`, `AnalyticsView.tsx:42-43` | High | Must use `new Date()` |
| Hardcoded `monthlyRevenueData` array | `AnalyticsView.tsx:51-59` | High | Charts should derive from DB, not hardcoded |
| Hardcoded welcome name `'Dr. Adil'` | `DashboardView.tsx:151` | Medium | Fallback to `user?.name` |
| Hardcoded version `'Enterprise Workstation • Release 2026.4'` | `LoginPage.tsx:181` | Medium | Should pull from `package.json` |
| App version `'2.2.0'` | `src/services/backupService.ts:17` | Low | Must sync with `package.json` |

### 3.2 Missing Production Build Config

| File | Issue | Fix |
|---|---|---|
| `vite.config.ts` | No `build.minify`, `build.sourcemap: false` | Add production hardening |
| `tsconfig.json` | `skipLibCheck: true` hides type errors in deps | Add `declaration: false` |
| `package.json` | No `test:coverage` script, no `vitest.config.*` | Add coverage config |
| `.github/workflows/ci.yml` | No dependency audit step | Add `npm audit` |

---

## 4. UI/UX Module Audit

### 4.1 Form Usability

| Module | File | Issue | Severity |
|---|---|---|---|
| **Auth** | `src/components/auth/LoginPage.tsx` | Labels not linked to inputs (no `htmlFor`/`id`); setup inputs have no visible label (only `placeholder`); `alert()` for errors | High |
| **Billing** | `src/components/billing/RecordTransactionModal.tsx` | All labels unlinked; `alert()` for errors; no `aria-describedby` for file upload | High |
| **Cases** | `src/components/cases/CaseDetailModal.tsx` | `FieldLabel` renders `<span>` (not `<label>`); no `aria-invalid` on errored inputs; errors not linked via `aria-describedby` | High |
| **Labs** | `src/components/labs/LabListView.tsx` | Labels unlinked; errors stored but not always linked | Medium |
| **Notifications** | `src/components/notifications/NotificationsView.tsx` | Labels unlinked; `aria-required` missing on required fields | Medium |
| **Settings** | `src/components/settings/SettingsView.tsx` | Branding/account/password form labels unlinked; wipe confirm input unlabeled | Medium |
| **All Forms** | — | **No centralized validation schema** (no `zod`/`yup`); mix of native `required`, `alert()`, inline `errors` objects | Medium |
| **All Forms** | — | **No `aria-invalid` on any input** when validation fails | Medium |
| **All Forms** | — | **No `aria-describedby` linking** error messages to inputs | Medium |

### 4.2 Buttons & Icons

| Module | File | Issue | Severity |
|---|---|---|---|
| **All** | — | **Focus rings missing** on most interactive buttons (`focus:outline-none` without `focus:ring` replacement) | High |
| **All** | — | **Icon-only buttons lack `aria-label`** — clear, print, delete, edit, notification actions, mobile bottom bar | High |
| **All** | — | **Inconsistent button styles** — no `Button` component; every module defines its own `className` (different padding, border-radius, shadows) | Medium |
| **Billing** | `BillingView.tsx` | Status filter buttons have no `focus:ring`; bulk action buttons lack `aria-label` | Medium |
| **Cases** | `CaseListView.tsx` | Kanban card actions lack focus styles; checkboxes unlabeled | Medium |
| **Dashboard** | `DashboardView.tsx` | Quick action buttons, KPI cards, module buttons all lack `focus:ring` | Medium |
| **Settings** | `SettingsView.tsx` | Tab buttons, backup/restore buttons, danger-zone buttons lack `focus:ring` | Medium |
| **All** | — | **Modal close buttons often lack `aria-label`** | Medium |

### 4.3 Navigation & Layout

| Module | File | Issue | Severity |
|---|---|---|---|
| **All** | — | **No module loading states** — only `main.tsx` boot spinner and `SettingsView.busy` exist | High |
| **All** | — | **Very sparse success states** — most actions close silently; no confirmation toast | Medium |
| **All** | — | **No `aria-live` regions** for dynamic counts (`unreadCount`, `overdueCount`) | Medium |
| **Mobile** | `Sidebar.tsx` | **Mobile bottom bar covers only 5 of 9 views** — `catalog` and `print` not discoverable on mobile | Medium |
| **All** | — | **No responsive loading skeleton** | Low |
| **Charts** | `DashboardView.tsx`, `AnalyticsView.tsx` | **No `alt` text, `aria-label`, or text alternatives** for charts; screen readers receive nothing | Medium |
| **Drag-and-drop** | `CaseListView.tsx:564` | **Kanban drag-and-drop has no keyboard equivalent** — status dropdown provides fallback only | Medium |
| **All Modals** | — | **No `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus trap, or `Escape` handler** | High |
| **All** | — | **Color contrast failures** — `text-slate-400` (~2.8:1) fails WCAG AA for small text | Medium |
| **All** | — | **Small text (`text-[10px]`, `text-[11px]`)** — can fail WCAG minimum size at default zoom | Medium |

### 4.4 Accessibility (WCAG 2.1)

| Issue | File | Severity |
|---|---|---|
| **No form label associations** (`htmlFor`/`id`) | `LoginPage.tsx`, `RecordTransactionModal.tsx`, `CaseDetailModal.tsx`, `LabListView.tsx`, `SettingsView.tsx`, `NotificationsView.tsx` | **High** |
| **Focus visibility removed without replacement** | `Sidebar.tsx`, `Header.tsx`, `DashboardView.tsx`, `BillingView.tsx`, all buttons | **High** |
| **Modals lack `role="dialog"` + `aria-modal`** | All modals (`CaseDetailModal`, `RecordTransactionModal`, `LabListView` create-modal, `SettingsView` wipe-modal, `NotificationsView` test-modal, etc.) | **High** |
| **Icon-only buttons lack `aria-label`** | `Header.tsx` (search, notif bell, user menu), `BillingView.tsx` (Eye/Printer/Trash), `CaseListView.tsx` (print/view/edit), mobile bottom bar | **High** |
| **Charts lack accessibility** | `DashboardView.tsx` donut, `AnalyticsView.tsx` bar/pie | **Medium** |
| **No `aria-live` for dynamic counts** | `Header.tsx` (unreadCount), `CaseListView.tsx` (selected count), `DashboardView.tsx` (KPIs) | **Medium** |
| **Color-only indicators** | Status badges, priority badges, row borders, filter badges | **Medium** |
| **`text-slate-400` fails contrast** | Every module (sub-text, placeholders, badges, subtitles) | **Medium** |
| **No `role="region"`/`aria-label` on table wrappers** | `BillingView.tsx`, `CaseListView.tsx` | **Medium** |
| **No `scope` on table headers** | `BillingView.tsx` invoice table | **Low** |
| **No keyboard trap in modals** | All modals lack `Escape` close + focus trap | **High** |
| **Drag-and-drop no keyboard equivalent** | `CaseListView.tsx` kanban | **Medium** |
| **No `aria-current="page"` on active nav** | `Sidebar.tsx` | **Low** |
| **No `aria-expanded` on dropdown menus** | `Header.tsx` (notif/user menus) | **Low** |

---

## 5. Testing & Reliability Audit

### 5.1 Current State

- **63 automated tests** across **8 suites** (engine, repos, crypto, seeds, persistence, boot, backup pipeline, update service)
- **No coverage measurement** — no `vitest.config.*`, no `test:coverage` script, `.gitignore` excludes `coverage/`
- **CI pipeline** (`.github/workflows/ci.yml`) runs `npm run lint`, `npm test`, `npm run build`, `npm run tauri:build`

### 5.2 Missing Tests (Critical Paths)

| Area | Gap | File |
|---|---|---|
| **Login / Auth** | No `AppContext.login()` integration test; only `crypto.test.ts` tests PBKDF2 | `src/context/AppContext.tsx` |
| **User Management** | No test for `addUser`/`updateUser`/`deleteUser` DB persistence failures | `src/context/AppContext.tsx` |
| **Payment/Billing E2E** | Repo-level covered; no `AppContext.recordPayment()` integration test | `src/context/AppContext.tsx` |
| **Backup/Restore Pipeline** | `backup.test.ts` covers service layer; **SettingsView restore UI not covered** | `src/components/settings/SettingsView.tsx` |
| **Migration Rollback** | **No rollback mechanism exists** — migrations are append-only | `src/db/migrations.ts` |
| **Update Service (Online)** | **Explicitly excluded from automated tests** | `tests/services/update.test.ts` |
| **Desktop Persistence** | **All tests use in-memory `sql.js`**; Tauri `db_save_bytes`/`db_read_bytes` path untested | `src/db/persistence.ts` |
| **Error Boundary** | **Zero automated tests** | `src/components/common/ErrorBoundary.tsx` |
| **State Persistence Failure** | No test for corrupt snapshot, quota exceeded, or `beforeunload` flush failure | `src/db/persistence.ts` |
| **Login Auth Flow** | No end-to-end test for session restore + login | `src/components/auth/LoginPage.tsx` |
| **Settings Restore** | Restore UI (`handleConfirmRestore`) not covered by integration test | `src/components/settings/SettingsView.tsx` |

### 5.3 Reliability Gaps

| Gap | Evidence | Severity |
|---|---|---|
| **`createSafetySnapshot()` never invoked by restore pipeline** | `backupService.ts:136` defines it; `SettingsView.tsx:261` restore does NOT call it | **Critical** |
| **No downgrade mechanism for migrations** | `engine.ts:migrate()` uses `BEGIN IMMEDIATE`/`ROLLBACK` on failure, but no reverse DDL for applied migrations | **High** |
| **Backup corruption → no repair mechanism** | Corruption rejected; no partial DB recovery | **High** |
| **No automated test for `ErrorBoundary`** | `ErrorBoundary.tsx` exists but has zero tests | **Medium** |
| **No automated test for desktop persistence path** | All tests use in-memory `sql.js` | **Medium** |
| **Manual smoke tests remaining** | 4 items in `PRODUCTION_RELEASE_REPORT.md`: offline pass, installer smoke, cross-machine restore, printer test | **Medium** |
| **No vitest coverage config** | `package.json` no `test:coverage`; no `vitest.config.*` | **Low** |

### 5.4 Manual Tests Required (from `docs/PRODUCTION_RELEASE_REPORT.md`)

1. Full offline pass with Wi-Fi/ethernet physically disabled on clinic PC
2. Install from NSIS `.exe` → full smoke checklist (create case → restart → data persists → payment + screenshot → restart → backup → restore → search)
3. Cross-machine backup restore (`.dentalbackup` on machine A → fresh install on machine B)
4. Physical printer test (invoice, receipt, job slip, lab card, statements)

---

## 6. Code Quality & Deployment Audit

### 6.1 Code Quality

| Issue | File | Severity |
|---|---|---|
| **No centralized `Button` component** — inconsistent styles across all modules | `src/components/**/*.tsx` | **Medium** |
| **No centralized `Modal` component** — every modal implements its own backdrop/focus logic | `src/components/**/*.tsx` | **Medium** |
| **No centralized validation schema** — mix of `required`, `alert()`, inline `errors` | `src/components/**/*.tsx` | **Medium** |
| **`FieldLabel` renders `<span>`** — breaks label association | `src/components/cases/CaseDetailModal.tsx:58-63` | **High** |
| **Deprecated `INITIAL_USERS` still exported** | `src/data/initialData.ts:122-163` | **Low** |
| **`tsconfig.json` `skipLibCheck: true`** | `tsconfig.json` | **Low** |
| **No `package-lock.json` verification in CI** | `.github/workflows/ci.yml` | **Medium** |
| **`Math.random()` for IDs and session tokens** | `src/db/repos.ts:14`, `src/context/AppContext.tsx:694-695` | **Medium** |

### 6.2 Deployment (Tauri)

| Issue | File | Severity |
|---|---|---|
| **CSP disabled** (`"csp": null`) | `src-tauri/tauri.conf.json:23-25` | **Critical** |
| **No security headers** | `index.html` | **High** |
| **No `build.sourcemap: false`** | `vite.config.ts` | **High** |
| **No `npm audit` in CI** | `.github/workflows/ci.yml` | **Medium** |
| **No integrity check for WASM file** | `src/main.tsx:9` | **Medium** |
| **No automated installer verification** | `.github/workflows/ci.yml` | **Medium** |
| **`vite.config.ts` missing `minify`** | `vite.config.ts` | **Low** |
| **No `tauri:build` artifact verification** | `.github/workflows/ci.yml` | **Low** |
| **`tauri.conf.json` capabilities not fully audited** | `src-tauri/tauri.conf.json` | **Low** |

---

## 7. Data Integrity Audit

### 7.1 Critical

| # | File | Line | Finding |
|---|---|---|---|
| D-01 | `src/context/AppContext.tsx` | 876-888 | **`updateUser` doesn't call `usersRepo.update()`** — user profile changes are invisible to SQLite |
| D-02 | `src/context/AppContext.tsx` | 885-888 | **`deleteUser` doesn't call `usersRepo.delete()`** — deleted users persist in DB |
| D-03 | `src/context/AppContext.tsx` | 885-888 | **`deleteUser` filter condition is inverted** — may not delete the intended user |
| D-04 | `src/services/sqliteStorage.ts` | 37-251 | **`SQLITE_DDL_SCHEMA` uses outdated `users` table (`password` column)** — actual DB uses `password_hash`/`password_salt`. SQL exports/imports will corrupt authentication data |

### 7.2 High

| # | File | Line | Finding |
|---|---|---|---|
| D-05 | `src/components/settings/SettingsView.tsx` | 334-346 | **`wipeAllData()` only clears React state + localStorage** — does not purge SQLite tables |
| D-06 | `src/services/backupService.ts` | 88-92 | **No JSON structure depth validation** — deeply nested JSON causes stack overflow |
| D-07 | `src/services/sqliteStorage.ts` | 415-452 | **Only parses JSON starting with `{`** — `.sql` dumps ignored; `generateSqliteExport` output can't be restored |

### 7.3 Medium

| # | File | Line | Finding |
|---|---|---|---|
| D-08 | `src/db/repos.ts` | 14 | **Weak random ID generation** (`Math.random()` + timestamp) |
| D-09 | `src/db/repos.ts` | 209-216 | **`labsRepo.search` LIKE with `%` wildcards** — no length limit on query input |
| D-10 | `src/context/AppContext.tsx` | 682-710 | **Session token stored in `localStorage` (`dsw_session_token`)** — no expiration check on load |
| D-11 | `src/services/sqliteStorage.ts` | 290-291 | **SQL export uses `escapeSqlString` but doesn't sanitize backslashes/null bytes** |
| D-12 | `src/db/crypto.ts` | 48-65 | **Salt extraction from hash string (`hash.split('$')[2]`)** — fragile; no format version check in `verifyPassword` |

### 7.4 Low

| # | File | Line | Finding |
|---|---|---|---|
| D-13 | `src/components/settings/SettingsView.tsx` | 1256-1272 | **Export `.dentalbackup` files unencrypted** |
| D-14 | `src/db/legacyMigrator.ts` | 107-133 | **Legacy migration uses `'███████'` fallback** for missing plaintext passwords |
| D-15 | `src/components/settings/SettingsView.tsx` | 1288-1291 | **Restore doesn't enforce `.dentalbackup` extension** |
| D-16 | `src/services/backupService.ts` | 94-119 | **Checksum comparison not constant-time** |

---

## 8. Compliance Audit

### 8.1 Data Protection (HIPAA/GDPR-style for dental clinic data)

| Requirement | Status | Finding |
|---|---|---|
| **Encryption at rest** | ❌ **Not Met** | SQLite DB and `.dentalbackup` files are unencrypted. Physical access grants full data access. |
| **Audit trails for data access/export** | ⚠ **Partial** | Audit log exists for case/invoice/payments; **backup/restore/wipe actions NOT audited**. |
| **Data minimization** | ⚠ **Partial** | `dsw_*` legacy localStorage keys retained; no automatic cleanup of deprecated keys. |
| **Right to erasure** | ❌ **Not Met** | `wipeAllData()` only clears React state + localStorage — SQLite tables NOT purged. |
| **Session management** | ⚠ **Partial** | Opaque tokens in `sessions` table; no token expiration check on load; session can be restored indefinitely. |
| **Password policy** | ⚠ **Partial** | PBKDF2 hashing used, but **no minimum complexity requirements** (only length ≥ 8); **bootstrap passwords are weak** (`███████`, etc.). |
| **Breach notification** | ❌ **Not Met** | No logging/alerting mechanism for unauthorized access attempts. |
| **Data retention** | ❌ **Not Met** | No automated data retention or archiving policy. |

### 8.2 Regulatory

| Requirement | Status | Finding |
|---|---|---|
| **HIPAA Security Rule** | ❌ **Not Met** | No encryption, no audit logging for backup/restore, no access controls beyond role gating. |
| **GDPR (if applicable)** | ❌ **Not Met** | No right-to-erasure (wipe doesn't clear SQLite), no data portability export, no breach notification. |
| **PCI-DSS** | ⚠ **Partial** | Payment data stored in SQLite; no encryption at rest; no card data stored (assumed). |
| **WCAG 2.1 AA** | ❌ **Not Met** | Color contrast failures, missing form labels, no focus management, modals inaccessible, charts inaccessible. |
| **Software Supply Chain** | ⚠ **Partial** | No `npm audit` in CI, no dependency pinning, no SBOM generation. |

---

## 9. Prioritized Action Plan

### Phase 1 — CRITICAL (block release)

| # | Action | File(s) | Effort |
|---|---|---|---|
| P1-1 | **Rotate/remove bootstrap passwords** — change to random strings or remove plaintext entirely | `src/db/defaults.ts` | 1h |
| P1-2 | **Fix `updateUser`, `addUser`, `deleteUser` to persist to SQLite** — call `usersRepo.update()/delete()` | `src/context/AppContext.tsx` | 4h |
| P1-3 | **Fix `resetPwdUserId` to persist password changes** — use `changePassword` or direct DB update | `src/components/settings/SettingsView.tsx` | 2h |
| P1-4 | **Enable CSP in `tauri.conf.json`** — set `"csp"` to a restrictive policy; add `Content-Security-Policy` meta tag in `index.html` | `src-tauri/tauri.conf.json`, `index.html` | 2h |
| P1-5 | **Fix `createSafetySnapshot()` — invoke it before destructive restore** | `src/components/settings/SettingsView.tsx` | 1h |
| P1-6 | **Fix SQL export schema** — update `SQLITE_DDL_SCHEMA` in `sqliteStorage.ts` to use `password_hash`/`password_salt` | `src/services/sqliteStorage.ts` | 2h |
| P1-7 | **Remove `███████` default password** — force new users to set a password on creation | `src/context/AppContext.tsx:856` | 1h |
| P1-8 | **Add file size limits** to `.dentalbackup` and `.dentalupdate` imports | `src/components/settings/SettingsView.tsx` | 2h |
| P1-9 | **Add MIME validation** to logo upload | `src/components/settings/SettingsView.tsx:183-197` | 1h |
| P1-10 | **Add rate limiting / brute-force protection** to login | `src/components/auth/LoginPage.tsx` | 3h |

### Phase 2 — HIGH (must fix before first production release)

| # | Action | File(s) | Effort |
|---|---|---|---|
| P2-1 | **Add `focus:ring` to all interactive elements** — global CSS fix or per-element | All `.tsx` files | 8h |
| P2-2 | **Add `aria-label` to all icon-only buttons** | `Header.tsx`, `BillingView.tsx`, `CaseListView.tsx`, `Sidebar.tsx`, `DashboardView.tsx`, etc. | 4h |
| P2-3 | **Link all form labels to inputs** (`htmlFor`/`id`) | `LoginPage.tsx`, `RecordTransactionModal.tsx`, `CaseDetailModal.tsx`, `LabListView.tsx`, `SettingsView.tsx`, `NotificationsView.tsx` | 8h |
| P2-4 | **Add `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus trap, and `Escape` handler** to all modals | `CaseDetailModal.tsx`, `RecordTransactionModal.tsx`, `LabListView.tsx`, `SettingsView.tsx`, `NotificationsView.tsx`, `DashboardView.tsx` | 8h |
| P2-5 | **Replace `alert()` with inline accessible errors** (`aria-describedby`, `aria-invalid`) | `RecordTransactionModal.tsx`, `CaseDetailModal.tsx`, `LabListView.tsx` | 4h |
| P2-6 | **Improve color contrast** — replace `text-slate-400` with `text-slate-600` (or darker) for all small text | All `.tsx` files | 4h |
| P2-7 | **Add `build.sourcemap: false` and `build.minify`** to `vite.config.ts` | `vite.config.ts` | 1h |
| P2-8 | **Add `npm audit` to CI** and pin dependency versions with lockfile | `.github/workflows/ci.yml`, `package.json` | 2h |
| P2-9 | **Add `role="region"`/`aria-label` to table wrappers** | `BillingView.tsx`, `CaseListView.tsx` | 2h |
| P2-10 | **Add keyboard support for drag-and-drop** (status dropdown fallback is good; add arrow-key navigation) | `CaseListView.tsx` | 4h |
| P2-11 | **Add `aria-label`/`aria-roledescription` to charts** | `DashboardView.tsx`, `AnalyticsView.tsx` | 2h |
| P2-12 | **Fix `wipeAllData()` to purge SQLite tables** | `src/components/settings/SettingsView.tsx:334-346` | 2h |
| P2-13 | **Add hardcoded date fix** — replace `'2026-08-02'` with `new Date()` | `DashboardView.tsx:89`, `AnalyticsView.tsx:42-43` | 1h |
| P2-14 | **Fix hardcoded `monthlyRevenueData`** — derive from DB | `AnalyticsView.tsx:51-59` | 4h |
| P2-15 | **Add `npm audit` CI step** and create `vitest.config.*` with coverage | `package.json`, `.github/workflows/ci.yml` | 2h |

### Phase 3 — MEDIUM (before second release)

| # | Action | File(s) | Effort |
|---|---|---|---|
| P3-1 | **Add centralized `Button`, `Modal`, `FormField`, `Input` components** | `src/components/common/ui/` | 16h |
| P3-2 | **Add centralized validation schema** (`zod` or `yup`) | All form components | 12h |
| P3-3 | **Add loading states** to all modules | All `.tsx` files | 8h |
| P3-4 | **Add success toast notifications** after create/update/delete/pay actions | All `.tsx` files | 8h |
| P3-5 | **Add `aria-live` regions** for dynamic counts | `Header.tsx`, `CaseListView.tsx`, `DashboardView.tsx` | 2h |
| P3-6 | **Add migration rollback mechanism** (down scripts) | `src/db/migrations.ts` | 4h |
| P3-7 | **Add automated tests** for ErrorBoundary, desktop persistence, login flow, settings restore, backup/restore pipeline UI | `tests/` | 20h |
| P3-8 | **Add vitest coverage config** and `test:coverage` script | `package.json`, new `vitest.config.ts` | 2h |
| P3-9 | **Add audit logging** for backup/restore/wipe/update actions | `src/services/backupService.ts`, `src/components/settings/SettingsView.tsx` | 4h |
| P3-10 | **Add `npm audit` to CI** and create SBOM | `.github/workflows/ci.yml` | 2h |
| P3-11 | **Add `escapeSqlString` improvement** — escape backslashes and null bytes | `src/services/sqliteStorage.ts:25-35` | 1h |
| P3-12 | **Add file extension enforcement** for `.dentalbackup` import | `src/components/settings/SettingsView.tsx:1288-1291` | 1h |
| P3-13 | **Add constant-time checksum comparison** | `src/services/backupService.ts:94-119` | 1h |
| P3-14 | **Add `role="button"`, `tabIndex` to clickable cards** | `LabListView.tsx`, `DashboardView.tsx` | 2h |
| P3-15 | **Add `aria-current="page"` to active Sidebar nav item** | `src/components/common/Sidebar.tsx` | 1h |

### Phase 4 — LOW / HYGIENE

| # | Action | File(s) | Effort |
|---|---|---|---|
| P4-1 | **Add `npm audit` to pre-commit hook** | `package.json` | 1h |
| P4-2 | **Remove deprecated `INITIAL_USERS` export** | `src/data/initialData.ts` | 1h |
| P4-3 | **Remove `tsconfig.json` `skipLibCheck: true` or audit deps** | `tsconfig.json` | 1h |
| P4-4 | **Replace `Math.random()` with `crypto.randomUUID()`** | `src/db/repos.ts:14`, `src/context/AppContext.tsx:694-695` | 1h |
| P4-5 | **Move hardcoded branding defaults to config file** | `src/db/defaults.ts`, `src/context/AppContext.tsx` | 2h |
| P4-6 | **Add `Content-Security-Policy` headers to Tauri** | `src-tauri/tauri.conf.json` | 1h |
| P4-7 | **Add `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`** | `index.html` | 1h |
| P4-8 | **Encrypt `.dentalbackup` files** at rest | `src/services/backupService.ts` | 8h |
| P4-9 | **Add data retention policy** | `src/db/` | 4h |
| P4-10 | **Add SBOM generation** | `.github/workflows/ci.yml` | 2h |

---

## 10. Module-by-Module Status

| Module | Status | Key Issues |
|---|---|---|
| **Auth** | ⚠ Needs Work | Labels unlinked, `alert()` errors, no rate limiting, bootstrap passwords |
| **Dashboard** | ⚠ Needs Work | Focus rings missing, hardcoded "today" date, hardcoded welcome name, charts inaccessible, no loading states |
| **Cases** | ⚠ Needs Work | `FieldLabel` renders `<span>`, drag-and-drop no keyboard, focus rings missing, modals inaccessible |
| **Labs** | ⚠ Needs Work | Labels unlinked, no `role="button"` on cards, no `Escape` in create-modal |
| **Billing** | ⚠ Needs Work | `alert()` errors, labels unlinked, icon-only buttons unlabeled, table headers no `scope` |
| **Catalog** | ⚠ Needs Work | Edit/delete icons unlabeled, `type="color"` unlabeled |
| **Analytics** | ⚠ Needs Work | Hardcoded `monthlyRevenueData`, hardcoded "today" date, charts inaccessible, no validation on date range |
| **Notifications** | ⚠ Needs Work | Labels unlinked, no `aria-required`, bulk actions no `aria-live` |
| **Settings** | ⚠ Needs Work | Labels unlinked, wipe doesn't persist to SQLite, restore doesn't call safety snapshot, file size limits missing |
| **Common/Shared** | ⚠ Needs Work | No `Button`/`Modal` components, `ErrorBoundary` untested, `Sidebar` mobile bottom bar incomplete |
| **Tauri/Desktop** | ⚠ Needs Work | CSP disabled, no security headers, no `sourcemap: false`, no `npm audit` in CI, no WASM integrity check |
| **Data Layer** | ⚠ Needs Work | `updateUser`/`deleteUser` don't persist, SQL export schema mismatch, no migration rollback, no encryption |

---

## 11. Final Recommendation

**The app is NOT production-ready as-is.** The core architecture is sound (SQLite engine, typed repos, PBKDF2 auth, 63 automated tests, Tauri packaging works). However:

1. **Critical security issues block release** — hardcoded passwords, uncommitted DB changes, disabled CSP, missing safety snapshot on restore
2. **UI/UX accessibility is pervasive** — forms unlabeled, focus rings missing, modals inaccessible, charts unreadable, color contrast fails WCAG AA
3. **Testing gaps exist** — no coverage, no critical-path integration tests (login, payment, restore, desktop persistence)
4. **Data integrity risks** — user changes don't persist to DB, wipe doesn't clear SQLite, SQL export schema is broken
5. **Compliance is not met** — no encryption at rest, no audit logging for backup/restore/wipe, no data retention policy

**Recommended release timeline:**
- **Phase 1 (Critical):** 1-2 weeks
- **Phase 2 (High):** 2-3 weeks
- **Phase 3 (Medium):** 3-4 weeks
- **Phase 4 (Low):** Ongoing

After Phase 1-2, the app can be considered **beta-production**. After Phase 3, it can be considered **production-ready**.

---

*Audit performed by automated subagent analysis of source code, tests, config files, and documentation. All file paths are absolute. Line numbers may shift with code changes.*

---

## 12. Remediation Status

**Phase 1 (Critical) — implemented.** Every claim below was re-verified against the
current source before changing anything; several findings were already stale and are
marked as such. Verification at the bottom of this section.

| Item | Status | What changed |
|---|---|---|
| S-01 / S-02 / P1-1 | ✅ Fixed | `BOOTSTRAP_USERS` (plaintext `███████`, `███████`, `███████`, `███████` + the lab's real emails) **deleted**. `seeds.ts` no longer creates accounts; `legacyMigrator` no longer fabricates an `adil` super-admin. A fresh profile starts with an empty users table and provisions its first Super Admin through the login screen's setup flow. `INITIAL_USERS` in `AppContext.tsx` is now `[]`. |
| S-03 / P1-7 | ✅ Fixed | `addUser` rejects a missing/short password (`< 8` chars) instead of defaulting to `███████`; `createInitialAdmin` enforces the same minimum; the add-user form validates length before submitting. |
| S-04 / S-05 / S-06 / D-01 / D-02 / D-03 / P1-2 / P1-3 | ✅ Fixed | `updateUser` now writes through `usersRepo.update()` (profile fields, and PBKDF2 re-hash + salt when a password is supplied — which is what the Settings "reset password" path calls). `deleteUser` calls `usersRepo.delete()` and protects the Super Admin by role instead of the hardcoded username `'adil'`. |
| S-07 | ✅ Fixed | `createInitialAdmin` no longer fabricates `@dentalsolutions.pk` addresses (uses `@localhost`); the add-user form does the same. |
| S-08 | ✅ Fixed | The unused `handleQuickFill` credential-filling helper was removed from `LoginPage.tsx`. |
| S-10 / S-11 / P1-4 | ✅ Fixed | `tauri.conf.json` ships a restrictive CSP (offline-first: no remote scripts/frames/forms, `object-src 'none'`, allowed connect-src limited to the update endpoints); `index.html` carries the same policy plus `referrer: no-referrer`. **Note:** a live click-through smoke test of the packaged app is still required — CSP mistakes only surface at runtime, and this sandbox cannot run the desktop shell. |
| S-12 / S-13 / D-04 / D-11 / P1-6 | ✅ Fixed | `SQLITE_DDL_SCHEMA` users table now matches the real schema (`password_hash`/`password_salt`, `is_active`, `updated_at`); the SQL export writes the PBKDF2 hash read **from the database** (never `u.password`, which the UI profiles do not carry) and `escapeSqlString` now escapes backslashes and strips NUL bytes. |
| S-15 / P1-8 / S-30 / P3-12 | ✅ Fixed | Restore enforces the `.dentalbackup` extension and a 512 MB cap; offline update import caps at 64 MB. |
| S-18 / P1-9 | ✅ Fixed | Logo upload validates an image MIME allow-list (PNG/JPEG/WebP/GIF), not just size. |
| S-25 / P2-12 | ✅ Fixed | `wipeAllData` now also purges the SQLite tables the collection sync does not own (`chairside_appointments`, `clinical_materials`, `clinical_prep_types`, `shade_guides`, `implant_brands`); the synced tables are emptied by the write-through rebuild it already triggers. |
| S-26 / S-27 / D-08 / P4-4 | ✅ Fixed | `genId` (repos + context) and the session-token fallback use `crypto.randomUUID()` / `crypto.getRandomValues()`; `Math.random()` remains only as a last-resort fallback where no WebCrypto exists. |
| S-23 / P2-7 | ✅ Fixed | `vite.config.ts` sets `build.sourcemap: false` and an explicit `minify: 'esbuild'`. |
| 5.3 (Critical) / P1-5 | ✅ Fixed | Restore now calls `createSafetySnapshot()` **before** `applyRestoredBytes`, so the pre-restore database stays recoverable. |
| S-09 / P1-10 (login rate limiting) | ⏳ Open | Not implemented in this pass — needs a lockout policy decision (attempts, window, lockout duration) from the owner. |
| S-14 / S-20 / S-21 / S-29, P2-1…P2-11, P2-13…P2-15, Phases 3–4 (accessibility, `Button`/`Modal` primitives, validation schema, coverage config, migration rollback, encryption at rest, audit logging, SBOM) | ⏳ Open | Untouched by this pass; the audit's own phasing still applies. |

### Verification executed

- `npm run lint` (`tsc --noEmit`, strict): **PASS**.
- **Full test suite: 86/86 passing** (63 pre-existing + 23 QC tests), executed file-by-file
  against the real engine and services. Because the esbuild native binary hangs in this
  sandbox (which prevents `vitest`/`vite` from booting — proven with an untouched test file),
  the suite was compiled with `tsc` and run with plain `node` through a minimal
  vitest-API shim. Run `npm test` on a normal machine to reproduce the same result.
- Tests updated where the security fix intentionally changed behaviour:
  `seeds.test.ts` (no accounts seeded), `boot.test.ts` (fresh profile ships no accounts and
  the legacy import fabricates none), `engine.test.ts` (migration list is now `1–5`).
- Two **pre-existing** failures were fixed while verifying: `tests/services/update.test.ts`
  pinned its update fixtures to `2.1.0`, so every fixture was correctly rejected as "not
  newer" once the app version reached 2.2.0 — the fixtures now derive a version above the
  installed one, so they cannot go stale again.

