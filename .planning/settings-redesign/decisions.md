# Settings Redesign — Decisions (2026-10-01)

Answers to the plan's §11 decisions table. Status: **decided** — Phase 0+ can
proceed without guesswork. Source plan: user-provided "Settings Module —
Combined Redesign Plan" (§1 findings F1–F13, V-1–V-12; §7 phases; §11
decisions). Decisions D6–D9 were not explicitly answered and default to the
plan's recommendation, per standing instruction.

| # | Decision | Choice |
|---|----------|--------|
| D1 | Notification config + email templates | **Wire both** — config UI + editable templates with live preview; delivery is in-app with copy-to-clipboard (offline). Reminder sweep reads the config. |
| D2 | Offline `.dentalupdate` import | **Remove the claim** — delete the UpdatesTab copy pointing at a nonexistent import and remove `parseOfflineUpdate` (updateService.ts:186-215) and its tests. Updates stay manifest-driven. |
| D3 | Wipe scope | **Purge data + settings + templates; keep user accounts.** Confirm dialog lists exactly what is kept/deleted; typed phrase + pre-wipe snapshot + audit entry; purge test enumerates every table. |
| D4 | Per-user preferences | **New `user_preferences` table** (migration 014; PK user_id FK→users ON DELETE CASCADE, value TEXT, updated_at). Boot hydrates the logged-in user; login switch rehydrates; legacy global row migrates to the current user. |
| D5 | Component test deps | **Yes** — add `@testing-library/react` + `jsdom` (dev-only) to lock the permission matrix and dialog a11y in CI. |
| D6 | Currency change | *(default = plan recommendation)* **Admin-only + confirmation** naming affected surfaces, plus audit entry. |
| D7 | Brand colour | *(default)* **Wire `primaryColor` as `--brand-600`** via 6 contrast-checked swatches; free color input removed; invalid stored value falls back to indigo; print ink untouched. |
| D8 | PreviewFrame | *(default)* **Yes** — one labelled preview canvas for invoice / job-slip / workstation-card artefacts; replaces the unlabelled slate-900 block. |
| D9 | Settings layout | *(default)* **Rail + panel ≥1280px, segmented control below** — 240px grouped permission-aware rail; one screenshot review before shipping. |

## Consequences to carry into implementation

- D1 adds real work to Phase 5 (notifications/templates section) and gives
  F5's dead `UserPreferences` fields readers; do not delete those fields.
- D2 removes dead code instead of building UX for it: CHANGELOG note
  required (the capability was documented in CHANGELOG.md:327).
- D3 extends the wipe purge list beyond today's no-op (settings namespace,
  notification_config, email_templates, templates) while accounts survive.
- D5 unblocks component-level tests named in §8
  (tests/services/permissions.test.ts + a11y assertions).
- Phase ordering in §7 stands: Phase 0 (F1 persistence fix, role gates,
  restore snapshot, reset-to-demo, import validation) ships first,
  independently.
