---
version: 1
slug: "src-components-dashboard"
primary_target: "src/components/dashboard"
related_targets: []
---

# Surface brief — Dashboard

**Scope:** the Dashboard route only (`src/components/dashboard/*`). Replaces the
current card world across every panel on this surface. It does not reach the
Workstation, Billing, Catalog or Settings surfaces in this run.

**Mode:** Operate.

**Audience:** one solo dental-lab operator doing bench work, front desk and the
books in one session, on a 1366px-class screen.

**Task:** answer "what needs me now, and what is late?" without leaving the
screen. Secondary: start the work.

**Content:** real cases, clinics, money. Demonstration data is the live local
database; nothing synthetic ships.

**Constraints:** the accent colour is white-label — the operator picks it, so
every accent surface must resolve through per-hue semantic tokens, never a
palette chosen here. Contrast is enforced in CI in both themes. Dark mode is a
working requirement. Horizontal space is scarce. Colour tokens are generated and
CI fails on hand-edits.

**Chosen direction:** The Open Case Drawer.
**Seed key:** 37353210 · assigned index 7 · code-led (no image generation
available, so the comp round is skipped by contract, not by drift).

**Memorable moment:** an envelope sits higher in the pocket than its neighbours
because it is due — attention is expressed by physical position in the drawer,
never by a badge, a colour wash, or a number turning red.

## Direction contract

**THESIS:** The dashboard is a drawer seen from above, not a control panel. It
refuses the row of equal KPI cards, because in a drawer envelopes are not equal
— some sit higher because they are due.

**OWN-WORLD:** Manila envelopes upright in a wooden tray. A pocket is ruled top
and bottom with a single one-pixel hairline, carries no radius and no shadow,
and sits on a flat paper ground; its name rides a small-caps label on a tab that
protrudes at the left. A case is an envelope: identifier on the spine in
monospace, patient and clinic on the face, its stage shown by how far it is
pulled forward. One accent, drawn from the operator's own brand token, plus a
single due-today red used nowhere else.

**STORY:** The operator sees an open drawer, recognises an envelope pulled proud
of its neighbours as urgent, and knows the number on its spine before reading
anything else. Nothing blinks; position does the work.

**FIRST VIEWPORT:** The drawer fills the frame at 1366px. The greeting collapses
to a drawer label, one line. Four pockets across the top carry the four
questions — active, in production, due today, outstanding — each a ruled strip,
not a card. Below them, the pocket grid, two columns, whole cells. The primary
action ("Log your first case", or the next due envelope) sits at the top-left of
the first pocket, in the reading path.

**FORM:** Candidate 7 of the grounded list, chosen by the roll. Not a challenger.
**Seed key:** 37353210. Assigned index 7.

FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Unresolved

- Whether the drawer metaphor survives on the very first run, where there are no
  envelopes to pull. Untested against a real empty lab.
- Whether the user's saved per-user panel layout should be honoured inside a new
  visual world, or whether the new world supersedes it.
