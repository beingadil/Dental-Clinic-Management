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

## Suggested order

`Modal primitive` → `aria-label sweep` → `DataTable/status badge` →
`ledger/audit line audit` → `RecordTransactionModal split`.
