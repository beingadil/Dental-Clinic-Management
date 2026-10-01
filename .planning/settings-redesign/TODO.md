# Billing / Settings redesign — remaining work

Status after v2.13.0 (`96ebb0a`): all P0 findings (B1–B6, B9, B10) are fixed and
test-pinned; B7/B8 dead-code resolution is done; the mechanical visual/a11y
sweep is partially complete. Everything below is *intentionally* left for
follow-up — none of it is a correctness defect.

## Done in this release (for the record)

| Finding | Where | Proof |
| --- | --- | --- |
| B1 print settings dead (double-encoded row) | `src/services/printSettings.ts` (`coerce()`), `coerceSections()` | `tests/services/printSettings.test.ts` |
| B2 invoice numbers minted from a render closure | `src/services/invoiceNumbering.ts`, `AppContext.addCase` | `tests/services/invoiceNumbering.test.ts` |
| B3 no role gating | `src/services/permissions.ts` (`canPost`, `canManageSystem`) wired into void, bulk settle, record modal, settings tabs | `tests/services/permissions.billing.test.ts` (45) |
| B4 / B10 native `confirm()` | `src/components/billing/primitives/ConfirmDialog.tsx` (typed `VOID`, consequence list) | live click-through |
| B5 unguarded proof upload | `src/services/fileValidation.ts` (2 MB, image/pdf) + branding logo | `tests/services/fileValidation.test.ts` |
| B6 `alert()` posting errors | `RecordTransactionModal` footer `role="alert"` banner, latch released in `finally` | live click-through |
| B7 unreachable `AccountsFinancialHome` (719 LOC) | deleted; advance-credit apply folded into `InvoiceDetailDrawer` | tsc + click-through |
| B8 two statement modals | `dashboard/ClinicStatementModal` is now an adapter over `billing/` | tsc + click-through |
| B9 fragile CSV writers | `src/services/csvExport.ts` (RFC-4180 CRLF + UTF-8 BOM) | `tests/services/csvExport.test.ts` |
| D4 per-user preferences | migration 014 + `src/db/userPreferencesRepo.ts` + `useSettingsDomain` | `tests/db/migration014.test.ts` |
| F3 restore snapshot not enforced | `BackupTab.handleConfirmRestore` blocks restore on snapshot failure | manual review |
| V-15 / V-16 / V-17 (partial) | no sub-11px text left in `src/components/billing`; `tabular-nums` on money cells; `scope="col"` on all 68 table headers; `role="dialog"` + `aria-modal` on all 8 billing modals; Escape closes the invoice drawer | grep + tsc |

## Remaining — visual normalization (Phase I2 residue)

1. **Modal primitive** — the 8 billing modals still hand-roll backdrop/header/
   footer (only `ConfirmDialog` uses a shared shell). Extract `primitives/Modal.tsx`
   (+ `Drawer` variant for `InvoiceDetailDrawer`) and migrate all of them, so the
   `animate-in` durations and elevation stop drifting. Keep the `print-area`
   card as the outermost element — the print contract depends on the card not
   being nested inside `.no-print` / `overflow-hidden`.
2. **DataTable + InvoiceStatusBadge** — invoice table and register render their
   own `<table>` markup and status chips (V-13, V-18). Extract a table primitive
   and one badge mapping (emerald paid · amber pending · rose overdue · sky
   partial) reusing `common/ui` badges where possible.
3. **Button language** — `bg-slate-900` vs `bg-indigo-600` primaries; indigo
   should win. Destructive is now rose-only inside `src/components/billing`
   (the mechanical `red-*` → `rose-*` sweep landed), but the case/settings
   modules still use `red-*`.
4. **FilterBar extraction** — invoices and register duplicate filter chrome;
   the register's sticky bulk bar and the 12-column table's horizontal-scroll
   affordance (V-22) still need work.
5. **EmptyState / Skeleton in every tab** (V-20) — only the invoices tab uses
   `EmptyState`; ledger / audit / reports / register render ad-hoc text.

## Remaining — accessibility polish

- Icon-only controls in billing still rely on `title=` (12 sites); add
  `aria-label` to each.
- `aria-live` on filter result counts (invoice status pills, register counts).
- The drawer needs focus trapping on open (Escape is wired, focus is not).
- `text-slate-400` on 11px meta text still fails AA in places (92 usages); only
  raise contrast where the text is load-bearing (money, dates, IDs).

## Remaining — audit follow-ups (not started)

- `GeneralLedgerView` (887 LOC), `AuditLogView` (467 LOC) and
  `BillingReportsView` (301 LOC) were never line-audited; the same class of
  findings (closure-minted state, unguarded actions) may exist there.
- `RecordTransactionModal` is still 715 LOC with four modes in one component;
  splitting payment vs advance vs credit-note vs refund would make the
  permission/latch logic testable without a DOM.

## Landed after the release commit (same release, later commits)

- **Every billing tab opens on today's window** (`c7efda2`) — invoices,
  general ledger, audit trail and the saved-voucher report now default to the
  current day like the payments register already did; the shared picker (or its
  `All Time` chip / the reset action) rewinds to older entries, and each empty
  state says so. The ledger's `Today` preset also switched from a UTC
  `toISOString` day to the picker's local day (PKT before 05:00 rolled back a
  day). Display filters only.
- **De-flaked the release gate** — `verify-release` failed on v2.13.0 exactly
  as it did on v2.12.4 and v2.12.2, while every artifact was healthy. The step
  now cache-busts the raw CDN URL, falls back to the gh-pages contents API
  (readable the instant the push lands), and polls 8×30s. The next tag is the
  first run that proves it.

## Suggested order

`Modal primitive` → `aria-label sweep` → `DataTable/status badge` →
`ledger/audit line audit` → `RecordTransactionModal split`.

## Open infrastructure question

`https://beingadil.github.io/Dental-Clinic-Management/…` still 404s (GitHub
Pages is not serving this repo), which is why `updateService.ts` tries the raw
gh-pages URL first and keeps the Pages URL only as a secondary source. Either
enable Pages for the branch or drop the dead URL from the service so the next
reader does not chase it.

## Release facts for v2.13.0 (verified manually)

- Release published with `Dental.Solutions_2.13.0_x64-setup.exe` (3,863,728 B).
- `SHA256SUMS.txt` = `f28e74cd…2ea2d`, matches the downloaded asset byte-for-byte.
- gh-pages manifest reports `version: 2.13.0`, `download_url` → `v2.13.0`,
  `payload_checksum: sha256:f28e74cd…` — the in-app updater's own verification
  path therefore passes even though the CI verify job reported failure.
