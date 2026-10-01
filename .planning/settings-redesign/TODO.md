# Billing / Settings redesign — remaining work

Status after **v2.14.0**. Everything the v2.13.0 handoff listed as open has
either landed or is listed below with the reason it is still open. Nothing
here is a correctness defect.

## Release gate (2.14.2)

The `verify-release` job had been failing since v2.12.2 on healthy artifacts —
never a CDN race. Two parsing bugs in the same line, in sequence: first
`cut -d: -f2` on `"payload_checksum": "sha256:<hex>"` returned the literal
` sha256`; the 2.14.1 fix then used `sed` with an unescaped BRE group, so `\1`
was an invalid reference and the variable came back empty. 2.14.2 reads the
digest with `[[ … =~ … ]]` and guards on 64 characters. Replayed end-to-end
against the live 2.14.1 release before tagging: manifest, downloaded asset and
`SHA256SUMS.txt` all agree on `96ecb3c3…`.

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

## Still open — deliberately deferred

These are refactors of working code. Each one rewrites a large surface, so they
were kept out of a release that already restructured every billing dialog.

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
5. **EmptyState coverage** — invoices, register and the ledger have real empty
   states; the audit and reports tabs still render ad-hoc text.
6. **Contrast of 11px meta text** — `text-slate-400` on small meta text still
   sits under AA in places. Only load-bearing text (money, dates, IDs) was
   raised.

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
