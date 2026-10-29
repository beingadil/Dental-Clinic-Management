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

## BATCH D (in flight) — primary CTAs → ds-glass-pill
- [x] Sweep script converted 53 solid bg-brand/indigo/blue-600 CTAs app-wide (buttons only)
- [x] Hand-converted CaseDetailModal floating action pills (Continue / Create Dental Case / Open in browser / Save Preset / Auto-select)
- [x] ConfirmDialog cancel + confirm (solid fill only when enabled)
- [x] Reverted 2 mangled soft hover-fill chips (CaseListView job-slip, NotificationsView details) — soft bg-tint hover-fill idiom is NOT a CTA; handle in a later pass if asked
- [x] Dropped leftover colored/square shadow tokens on converted pills (12 lines)
- [x] Gates (lint ✓ theme ✓ test ✓ 1337) — commit pending after filter removals round

## USER ROUND 3 (dropdowns: open-menu + removals)
- [x] Removed the two toolbar filters the user pointed at: Priority (All Priorities) and Dental Clinics (All Dental Clinics) — select blocks + state + filter-chain conditions + deps + resetKey + Clear-All handler; toolbar grid 5→3 cols
- [ ] THE OPEN DROPDOWN MENU IS STILL NATIVE/OS-STYLE: replace native <select> with a custom glass dropdown component (searchable like ClinicPicker) app-wide — ~45 selects: toolbar, archive clinic, DatePickers month/year, Settings tabs (Preferences x9, Print x5), UsersTab role, RecordTransaction/EditPayment method, BillingReportsView month, CaseQueueModal sort, LabPricingManager caseType, CatalogView dialog selects, CaseDetailModal lab/case-type (selectCls), CaseQcPanel reason-code. Build ONE shared .ds-glass-menu component, then swap surface by surface. NEVER blur inside glass panes/lists — fill-only rows, white-plate selected row.
- SKIP by design: TabsNav, Pagination pages, DatePicker day cells, DeliveryCalendar tiles, PrintTab toggles — toggle chips, not CTAs

## BATCHES AFTER D
- [x] View-head/filter/toolbars + content/table cards → `.ds-glass-card` roll-out: CatalogView (head, 2 section cards, table container, product rows `bg-ds-surface/55`, empty), LabListView (toolbar, lab rows, table container, empty), NotificationsView (filter toolbar, list container; test-notif modal → ds-glass-pane), BillingView (secondary white toolbar buttons → ds-glass-pill, density label chip translucent, table container)
- CASE RULE learned: never leave a `border`/`border-*` utility on a ds-glass-card — the utility's border-color/width overrides the glass rim (utilities layer wins). Drop them entirely.
- [x] LoginPage — already fully glass-built (`auth-glass` console + title card + stage lighting, dark themed); audit find retired
- [x] CaseListView dark sticky CTA bar → `.ds-glass-dark` (new material: 82/66% slate scrim, blur 20, white/12 rim; badge + ghost buttons go translucent white/10; gross deliverable keeps semantic fill-success); the bulk-status confirm button and the archive restore button become glass pills
- [ ] Modals' inner header/footer buttons → glass pill (they come from callers)
- [ ] DESIGN.md: document glass system + no-nested-blur rule
- [ ] Release v2.31.3: bump versions (package.json, package-lock.json, src-tauri/Cargo.toml, Cargo.lock, tauri.conf.json), CHANGELOG, gates, tag, push, verify installers + update-manifest.json
