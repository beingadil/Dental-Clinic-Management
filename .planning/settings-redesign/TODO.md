# Billing / Settings redesign — remaining work

Status after **v2.14.2**, plus the unreleased working-tree work: the desktop
close fix, session revocation on privilege change, `EmptyState` coverage in the
audit log and reports tabs, and the meta-text contrast raise in billing and
settings.

## Release gate — red since the job was introduced in v2.12.2

Established on 2026-10-01, from the Actions API and readable check-run
annotations (job logs need repo admin rights; `gh` is not installed locally):

- `verify-release` was **added in the v2.12.2 commit** and has failed on every
  tag since — v2.12.2, v2.12.3, v2.12.4, v2.13.0, v2.14.0, v2.14.1, v2.14.2.
  The earlier tags read "success" only because the job did not exist yet.
- It dies in **0–1 s** with `Process completed with exit code 1` and **no
  `::error::` annotation**, so it never reaches its own `fail()` helper — this
  is true of the *original* version too, whose second command was `sleep 30`.
- That means the death is at the first command, `gh release view "$TAG"`. A
  temporary `release-probe` job on master proves `gh` exists
  (`/usr/bin/gh`, 2.101.0), is authenticated through `GH_TOKEN`, and that the
  *identical* `gh release view … --jq …` call returns `{"draft":false,"exe":1}`
  with exit 0.
- The artifacts are healthy on every tag. v2.14.1 was verified by hand:
  3,872,478 bytes, `96ecb3c3…`, matching the manifest and `SHA256SUMS.txt`.

Two earlier changes (2.14.0's field-index parse, 2.14.1's `sed` group) fixed
real defects in the digest comparison, but **neither is why the gate fails**: a
bad digest prints `fail()` diagnostics seconds in, it does not exit silently in
0 s. The remaining suspects are the two things that differ between the passing
master probe and the failing tag job — the `TAG`/`github.ref_name` value and
the token scope on a tag event. An `ERR` trap (commit `366380c`) now echoes the
failing command and line as an annotation, so the next tag run names it.

## Landed in v2.14.0

| Item | Where | Proof |
| --- | --- | --- |
| D1 notifications config + templates | `settings/NotificationsTab.tsx`, `services/notificationSettings.ts` | live click-through |
| D1 cadence drives the sweeps | `services/notificationDomain.ts` (`cadenceOffsets`, `shouldRemind`), `AppContext` sweeps | `tests/services/reminderCadence.test.ts` (7) |
| D5 component test deps | `@testing-library/react` + `dom` + `jsdom` (dev-only) | `tests/components/dialogPrimitives.test.tsx` (11) |
| D6 currency guard | `settings/PreferencesTab.tsx` + `currency:edit` action | live click-through |
| D7 brand accent | `services/brandingTheme.ts`, `index.css` (`:root` + `@theme inline`), `BrandingTab` | `tests/services/brandingTheme.test.ts` (5) |
| D8 PreviewFrame | `common/ui/PreviewFrame.tsx`, used by Branding + Print tabs | `PrintTab` layout preview |
| D9 rail + panel | `settings/SettingsView.tsx` (one tab registry, 240px rail at `xl`) | live click-through |
| V-19 Modal / Drawer / ConfirmDialog | `common/ui/{Modal,Drawer,ConfirmDialog,useDialogBehavior}.tsx`; **all 8 billing dialogs + the invoice drawer migrated** | `tests/components/dialogPrimitives.test.tsx` |
| V-18 invoice status chip | `common/ui/Badge.tsx` (`InvoiceStatusBadge`) | component test |
| aria-label sweep (billing icon-only) | 12 sites across billing views | grep |
| aria-live filter counts + `aria-pressed` | `BillingView` status pills, `TransactionRegister` | live click-through |
| Dead Pages URL removed from the update path | `services/updateService.ts` | `tests/services/update.test.ts` |

## Landed after 2.14.0 (unreleased)

| Item | Where | Proof |
| --- | --- | --- |
| Desktop close button / close flush work again | `src-tauri/capabilities/default.json` grants the four window mutations | `tests/lib/tauriWindowPermissions.test.ts`; both permissions checked against `gen/schemas/acl-manifests.json` |
| Sessions revoked when a user's authority changes (audit S5) | `useAuthDomain`, `sessionsRepo.revokeForUser` | `tests/db/repos.test.ts` (+3) |
| EmptyState coverage (was item 5) | `AuditLogView` empty row, both `BillingReportsView` tabs | tsc + suite |
| 11px meta contrast (was item 6, billing + settings) | 27 sites `text-slate-400` → `text-slate-500` | tsc + suite |

## Still open — deliberately deferred

These are refactors of working code, not defects.

1. **DataTable extraction (V-13/V-16/V-17)** — the invoice table and the
   register still render their own `<table>` markup. The status *chip* is now
   shared, so the remaining duplication is structural (header/row/scroll
   affordances), not semantic. The register's 12-column horizontal-scroll
   affordance (V-22) also still needs work.
2. **FilterBar extraction (V-22)** — invoices and register duplicate filter
   chrome; the register's sticky bulk bar is still hand-rolled.
3. **`RecordTransactionModal` split** — 807 LOC, four modes in one component.
   Its shell now uses the shared Modal; splitting payment vs advance vs credit
   note vs refund would make the permission/latch logic testable without a DOM,
   but it is a behaviour-preserving rewrite that deserves its own change set.
4. **`GeneralLedgerView` (965 LOC) / `AuditLogView` (511) / `BillingReportsView`
   (340) line audit** — still never line-audited for the same class of findings
   as B1–B10 (closure-minted state, unguarded actions). They now share the
   dialog, empty-state and label primitives, so anything found is a logic fix
   rather than a chrome fix.
5. **Contrast outside billing + settings** — the remaining ~120
   `text-slate-400` sites on 10px/11px text are in case, dashboard, catalog,
   analytics and shared chrome. Not swept on purpose: several sit on dark or
   user-chosen backgrounds (`BrandingTab`'s previews use the configured
   `cardBgColor`, the reports month header is `bg-slate-900`), where slate-400
   is the *correct*, higher-contrast choice. This needs per-site judgement, not
   a find-and-replace.

## Notes for the next reader

- `--brand-600` is the app accent. Print CSS never reads the brand tokens, so a
  swatch change cannot alter paper. `data-brand` on `<html>` exposes the active
  swatch if a future style needs to opt out.
- The reminder config is read straight from `notification_config` by the
  sweeps; the Settings tab announces a change through
  `announceNotificationConfigChanged()` so the sweeps re-run without waiting
  for the next case/invoice edit.
- `useDialogBehavior` registers dialogs on a module-level stack: only the
  topmost dialog answers Escape or Tab. Do not add local Escape listeners to a
  dialog — that is exactly the bug the stack fixes.
- A `.print-area` must stay the outermost printable element. The Settings
  print preview is a hand-built miniature for this reason; do not embed
  `PrintDocument` in Settings, or `body:has(.print-area)` will hijack print
  isolation for the document dialogs.
- Tauri v2 ACL: `core:window:default` is read-only plus
  `internal-toggle-maximize`. Any window mutation needs its own
  `core:window:allow-*` grant or it fails only at runtime.
  `tests/lib/tauriWindowPermissions.test.ts` enforces that.
- `release-probe` in `.github/workflows/ci.yml` is **temporary scaffolding**
  (it only reports environment facts as annotations on master). Delete it once
  `verify-release` is green.
