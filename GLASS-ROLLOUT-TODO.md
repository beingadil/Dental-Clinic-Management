# Glass Rollout — Running TODO (memory file)

Whole-software liquid-glass conversion. Loop: audit → plan → apply → test → preview → commit.
Do NOT close this file until every box is checked and v2.31.3 is released.

## Scope rules (learned, keep applying)
- Glass goes to: chrome (rails/headers), action buttons, chips, cards, dialog/drawer panes, dropdown selects.
- Stays solid (functional): table/data-grid cells, form text inputs, semantic status badges (rose/amber/emerald = meaning), anything printed (print contracts on paper).
- NO nested backdrop-filter (jank lesson). Contents of a blur surface carry fill-only materials: `.ds-glass-chip` / `.ds-glass-pill-row` / new `.ds-glass-select` (all blur-free).
- scroller backgrounds must stay flat (rasterization bug lesson).
- Don't hand-edit generated `--p-*` primitives. Dark overrides live in `.dark` blocks + dashboard-dark.css, never re-style via localStorage.
- Gates after every batch: `npm run lint` + `npm test` + `npm run theme:check` (+ `build` before release).

## Shared materials (defined)
- `.ds-glass-pill` — capsule button (dashboard-tokens.css)
- `.ds-glass-pill-row` — sidebar nav rows (shell.css)
- `.ds-glass-chip` — non-interactive hints, blur-free (dashboard-tokens.css)
- `.ds-glass-pane` — modal/drawer shell, print→opaque paper (dashboard-tokens.css)
- `.ds-iconbtn` — circular glass icon buttons (shell.css)
- TODO: `.ds-glass-card` — glass cards on canvas (filter cards, settings cards) — blur on card, none inside
- TODO: `.ds-glass-select` — translucency for `<select>` dropdowns — NO blur (nested rule)

## DONE
- [x] Tahoe rail, floating header, aurora — committed earlier (0b62bfc…49ce1a6)
- [x] Batch A: Modal + Drawer → `.ds-glass-pane`; footers/drawer strips via ds tokens (9b66507)
- [x] Batch B-1: CaseListView view-toggle glass capsule + Preset Templates pill (834f14f)
- [x] Batch B-2: EmptyState (card+icon tile+action pill) → glass/ds tokens; Create New Case → ds-glass-pill
- [x] Batch C: `.ds-glass-card` + `.ds-glass-select` materials; CaseListView filter card + 6 selects; template gallery removal; header admin pill round

## USER REQUESTS (this round, from preview)
- [x] Remove "Preset Templates" button and its code completely (CaseListView) — button + state + modal wiring + the dead appliedTemplate prop/fallbacks in CaseDetailModal
- [x] Glass for filter cards + dropdowns — `.ds-glass-card` + `.ds-glass-select` defined; applied to CaseListView (toolbar card + all 6 selects). ROLLOUT TO OTHER VIEWS still open below.
- [x] Header admin pill rounding — rounded-full + round avatar circle

## REMAINING BATCHES
- [ ] CaseListView filter card → `.ds-glass-card`; status chips → glass chip + white plate active; selects → `.ds-glass-select`
- [ ] Rollout card+select treatment to all views: CatalogView, LabListView, LabDetailModal, NotificationsView, InvoiceDetailDrawer, BillingView, BillingReportsView, GeneralLedgerView, DailyReportView, UsersTab/Settings tabs, CaseDetailModal, Workstation
- [ ] Primary CTAs app-wide (bg-brand-600 / bg-indigo-600 / bg-slate-900 buttons) → `.ds-glass-pill`
- [ ] CaseListView dark sticky CTA bar → `.ds-glass-dark` (defined separately, alpha kept off TSX for the audit)
- [ ] LoginPage auth card → glass pane
- [ ] Modals' inner header/footer buttons → glass pill (they come from callers)
- [ ] DESIGN.md: document glass system + no-nested-blur rule
- [ ] Release v2.31.3: bump versions (package.json, package-lock.json, src-tauri/Cargo.toml, Cargo.lock, tauri.conf.json), CHANGELOG, gates, tag, push, verify installers + update-manifest.json
