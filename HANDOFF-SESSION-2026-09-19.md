# Dental Solutions — Session Handoff (2026-09-19)

Repo: `beingadil/Dental-Clinic-Management` (branch `master`) · local folder renamed to `DENTAL CLINIC`
App: React + TypeScript + Vite + Tailwind, sql.js (SQLite/WASM) persistence, Tauri v2 desktop target.
Dev server: `npm run dev` (port 3000) · Typecheck: `npx tsc --noEmit` (also `npm run lint` in CI) · Tests: `npm test` (vitest, 63 tests) · Desktop build: `npm run tauri:build`

---

## State at handoff

- **Version bumped 2.0.1 → 2.1.0** everywhere: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`.
- Two commits pushed to `master`:
  - `0d5d363` feat: case lifecycle, print studio, voucher-backed billing, DB-backed clinical specs (v2.1.0) — 20 files, +3904/−2321
  - `7ef0c32` fix(ci): repair Cargo.lock corrupted by version bump
- Tag **`v2.1.0`** pushed, points at `7ef0c32`.
- **CI run #14 was IN PROGRESS at handoff**: https://github.com/beingadil/Dental-Clinic-Management/actions/runs/35445731575
  - Web job (typecheck/tests/build) passed on the previous run of the same code — expect green.
  - Desktop job = Tauri NSIS installer build (~15–30 min on CI's warm cache). **FIRST TASK TOMORROW: confirm run #14 is green and the v2.1.0 GitHub Release has the .exe + SHA256SUMS.txt attached.** If desktop failed, read the "Build Tauri installers" step log; the lockfile corruption that broke run #13 is already fixed in `7ef0c32`.
- Release pipeline exists in `.github/workflows/ci.yml`: every master push builds an installer artifact; a `v*` tag additionally creates the GitHub Release with installer + checksum.

## What was built today (all verified: tsc clean, 63/63 tests, live preview checks)

### Phase 0 — Quick fixes
- Removed duplicate VITA shade panel from Create New Case wizard step 2 (per-tooth picker in the Tooth Specification inspector is the single source of truth).
- **Catalog → new "Restoration Types" tab** with full add/edit/delete. Backed by `clinicalSpecsService`, which is what the odontogram's prep-type dropdown reads, so new types appear in the wizard instantly. Files: `src/components/catalog/CatalogView.tsx`.

### Phase 1 — Case Job lifecycle
- New **`src/components/cases/CaseDetailPanel.tsx`**: case view modal (status/SLA header, FDI tooth chips, tooth table with prep/material/shade/notes, financial panel, attachments, notes timeline).
- **Edit** button opens the wizard in edit mode; **Delete** with confirm dialog (warns when an invoice/payment references the case); **Record Payment** shortcut; row action menus in `CaseListView.tsx`.
- Earlier same-day fix kept: wizard submit guard in `CaseDetailModal.tsx` — a submit on any non-final step advances the wizard instead of creating the case (step 4 "Attach & Review" is the only place a case is created).

### Phase 2 — Print Studio
- New module (nav item "Print Studio"): document picker (Job Slip / Lab Card / Invoice / Receipt), **per-section toggles**, live A4 preview, **saved templates per doc type**.
- Files: `src/components/print/PrintStudioView.tsx`, `printRenderer.tsx`, `printStyles.css`. Wired into `src/App.tsx` + `src/components/common/Sidebar.tsx`.
- Known shortcut: templates reuse the `saved_vouchers` table (works; a dedicated `print_templates` table would be cleaner).

### Phase 3 — Billing & vouchers
- Every billing entry auto-logs a **voucher + journal entry**: `recordPayment`, `recordTransactionV2`, credit notes (in `src/context/AppContext.tsx`).
- Fixed pre-existing bug: `saveVoucherToSystem` only wrote React state — now persists to SQLite.
- **`InvoiceDetailDrawer.tsx` rebuilt person-centric** (patient/doctor/case/lab/lines/payments/balance) with the JV collapsed into a "Journal Entries" section.

### Phase 3.5 — Clinical specs in SQLite
- `src/services/clinicalSpecsService.ts` migrated from localStorage to the existing `clinical_prep_types` / `clinical_materials` / `shade_guides` / `implant_brands` tables. Static import of `../db/repos` (NOT `require()` — Vite/ESM), DB-first reads, seeds defaults when tables are empty, same facade so no consumer changed.
- Verified through the UI: add prep type → survives reload (served from DB) → delete → deletion persists.

### Also today (earlier session)
- **Odontogram replaced** with a true 32-tooth FDI SVG chart: curved arch geometry, 8 anatomical tooth types, per-tooth selection, clinical overlays (caries, filling, crown, root canal, implant, missing), FDI/Universal toggle, arch presets. Files: `src/components/cases/Odontogram.tsx` + `Odontogram.css`. Zero painted-pixel overlaps verified via DOM hit-testing.
- **syncCore fix** (`src/db/syncCore.ts`): child tables (`case_teeth`, `case_status_history`, `case_notes`, `attachments`, `payments`, `payment_attachments`) are now explicitly wiped before parent rebuild — kills the `UNIQUE constraint failed: case_teeth` error that fired on every case sync.
- Wizard restyle to the app's slate/indigo system (no cream/brown).

## Data notes
- Real case **DS-0001 (Asiyaa)** remains in the local DB — do not delete.
- One prep type named "as" exists (user's own live test) — left in place intentionally.
- All other agent test cases were cleaned up.

## Pitfalls / lessons for the next agent
1. **Never bump versions in Cargo.lock with broad sed ranges** — `sed -i 's/version = "2.0.1"/version = "2.1.0"/g'` hits dependency pins (adler2 etc.) and breaks cargo resolution. Correct form: `sed -i '/^name = "dental-solutions"$/{n;s/version = "2.0.1"/version = "2.1.0"/}'`.
2. `code_search`/ripgrep was unavailable this session — fall back to `grep -rn` in the terminal.
3. Preview tooling: the dev server sometimes reloads between evaluate calls; drive multi-step UI verification as **one atomic `preview_evaluate` script** with internal waits. Snapshots may lag after navigation — re-snapshot before clicking.
4. `preview_evaluate` has a ~10s budget — split long verification scripts into small steps.
5. Freebuff restarts kill background commands (dev server, watchers) but not files; re-run `npm run dev` and re-register the preview after a restart.
6. CI's `npm run lint` = `tsc --noEmit` — run it locally before every push.
7. Local full Tauri builds are slow (cold target dir); rely on CI for installer verification.

## Suggested next work (not started)
- Dedicated `print_templates` table (migrate Print Studio storage off `saved_vouchers`).
- Printable odontogram SVG on job slips.
- Dashboard analytics (turnaround time, revenue by restoration type, clinic payment behavior).
- App-wide audit for remaining localStorage-only data → SQLite.
- installer identifier note: `tauri.conf.json` identifier `pk.dentalsolutions.app` triggers a harmless macOS-bundle warning; consider renaming to avoid confusion.
