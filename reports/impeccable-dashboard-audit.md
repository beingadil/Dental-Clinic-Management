# Dashboard Audit — `$impeccable audit`

**Target:** the Dashboard surface (`src/components/dashboard/`, `src/components/common/Sidebar.tsx`)
**Mode:** Operate (clinic admin completing a task)
**Date:** 2026-10-09
**Verified on:** live render at 1440×900 and 390×844, plus static source analysis

---

## Audit Health Score

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | **2/4** | 46 rendered text nodes below WCAG AA contrast, 31 touch targets under 44px |
| 2 | Performance | **3/4** | Route-level code splitting in place; no `will-change` abuse |
| 3 | Responsive Design | **2/4** | Works at both widths, but the fixed bottom nav occludes content and touch targets are undersized |
| 4 | Theming | **3/4** | Strong three-layer token system, undermined by one dead alias and 4 raw palette escapes |
| 5 | Implementation Integrity | **3/4** | Genuinely product-specific, but the bundled detector is non-functional |
| **Total** | | **13/20** | **Acceptable (significant work needed)** |

**Issue count:** P0 = 0 · P1 = 4 · P2 = 4 · P3 = 3

---

## Implementation Integrity Verdict

**PASS — coherent and product-specific.**

The dashboard is not interchangeable with an unrelated product. Evidence:

- [dashboard-tokens.css:1-14](src/components/dashboard/dashboard-tokens.css#L1-L14) documents a deliberate
  three-layer token architecture *and the reason for it* — "repointing `--ds-accent` at a different
  primitive repaints every accent surface in the dashboard without touching a single component class."
- [panelRegistry.ts:1-9](src/components/dashboard/panelRegistry.ts#L1-L9) exists specifically because a
  layout saved from Settings used to be filtered by a different key set than the dashboard rendered,
  silently dropping panels out of a saved arrangement. The file's reason for existing is a real past bug.
- Domain vocabulary is precise and correct for the domain: **Bench Workload**, **Production Workflow**
  (Received → In Production → QC → Ready → Dispatched), **Clinic Accounts**, **Revenue & Collections**.
- [ShadeGuideModal.tsx](src/components/dashboard/ShadeGuideModal.tsx) is a genuine dental-artifact feature
  (A1–D4 shade selection), not decoration.

**False positives called out explicitly:**

- The 25 hex literals in `ShadeGuideModal.tsx` are **not** hard-coded theme colors. They are dental
  shade-guide values describing physical tooth colors. Flagging these as theming violations would be wrong.
- The hex literals in `dashboard-tokens.css` are the primitive layer — the correct place for them.
- `bg-ds-sunken` in [dashboard-panels.tsx:67](src/components/dashboard/dashboard-panels.tsx#L67) **looks**
  like a typo for `bg-ds-surface-sunken` but is correct: `--color-ds-sunken` is aliased to
  `--ds-surface-sunken` in the `@theme inline` block. Verified working at runtime.

**Detector limitation — disclosed:** the bundled Impeccable detector returned an empty result set
(`[]`) even when pointed at a deliberately non-compliant probe file created for this audit. Its
all-clear is therefore **not evidence**, and none of the findings below rely on it. Every finding was
confirmed by direct source reading plus measurement in a live browser.

---

## Executive Summary

- **Audit Health Score: 13/20 (Acceptable)**
- **11 issues:** 0 P0 · 4 P1 · 4 P2 · 3 P3
- **Top issues:**
  1. `--ds-muted` renders at **2.43–2.54:1** across 38 text nodes — a single-token fix clears most of them.
  2. `bg-ds-surface-sunken` is a **silently dead utility** in 7 places; panel and sidebar hover states have no visual feedback.
  3. **31 interactive elements are under 44×44px**, including every KPI card's primary action (17px tall).
  4. The fixed mobile bottom nav **occludes page content** — `body` has `padding-bottom: 0`.
  5. `h1 → h3` heading jump and no skip link.

**Recommended order:** fix the contrast token (one line, clears 38 findings) → repair the dead alias →
fix touch targets and nav occlusion → then semantics.

---

## Detailed Findings by Severity

### P1 — Major

#### **[P1] `--ds-muted` fails WCAG AA across 38 text nodes**
- **Location:** [dashboard-tokens.css:82](src/components/dashboard/dashboard-tokens.css#L82) — `--ds-muted: var(--p-slate-400)` = `#9aa3b2`
- **Category:** Accessibility
- **Measured:** `2.43:1` on canvas, `2.54:1` on white — against a 4.5:1 requirement
- **Impact:** Every secondary label on the dashboard is washed out at 10–11px, the hardest size to read.
  Users with low vision or on a washed-out clinic monitor cannot read the KPI eyebrows, panel captions,
  sidebar section labels, or the `•••` panel menus.
- **WCAG:** 1.4.3 Contrast (Minimum) — AA failure
- **Recommendation:** `--p-slate-400 #9aa3b2` needs to reach ≥ 4.5:1 on white. `#6b7687` (`--p-slate-500`)
  gives 4.60:1 and is already defined. Repoint `--ds-muted` at `--p-slate-500`; if the visual weight is
  too heavy at eyebrow sizes, lighten the *weight* rather than the color. Note `--ds-body` already uses
  slate-500, so re-tune `--ds-body` to slate-600 to keep the two steps distinct.
- **Suggested command:** `$impeccable colorize`

#### **[P1] `bg-ds-surface-sunken` is a dead utility — hover states render nothing**
- **Location:** 7 occurrences across [Sidebar.tsx:127](src/components/common/Sidebar.tsx#L127),
  [Sidebar.tsx:149](src/components/common/Sidebar.tsx#L149), [Sidebar.tsx:195](src/components/common/Sidebar.tsx#L195),
  [Sidebar.tsx:213](src/components/common/Sidebar.tsx#L213),
  [PanelControls.tsx:51](src/components/dashboard/PanelControls.tsx#L51),
  [PanelLayoutBar.tsx:64](src/components/dashboard/PanelLayoutBar.tsx#L64),
  [PanelLayoutBar.tsx:76](src/components/dashboard/PanelLayoutBar.tsx#L76)
- **Category:** Implementation Integrity / Theming
- **Root cause:** `@theme inline` aliases `--color-ds-sunken` ([dashboard-tokens.css:154](src/components/dashboard/dashboard-tokens.css#L154))
  but **not** `--color-ds-surface-sunken`. Tailwind never emits
  a utility for an unaliased name, and it fails silently.
- **Verified at runtime** by injection test:

  | class | computed `background-color` |
  |---|---|
  | `bg-ds-sunken` | `rgb(246, 247, 249)` ✅ |
  | `bg-ds-surface-sunken` | `rgba(0, 0, 0, 0)` ❌ |
  | `bg-ds-surface` (control) | `rgb(255, 255, 255)` ✅ |

- **Impact:** The "Locked — unlock in Settings → Preferences" pill renders with no fill, and four
  menu items lose their hover feedback entirely — the user gets no confirmation the pointer is over a
  clickable row. This is a real accessibility problem, not just a visual one.
- **WCAG:** 1.4.11 Non-text Contrast (affected affordances), and 2.1.1-adjacent interaction feedback
- **Recommendation:** Rename all 7 usages to `bg-ds-sunken` (the alias that already exists and is
  already used once in the codebase). Alternatively add `--color-ds-surface-sunken` to `@theme inline`.
  Renaming is safer — one canonical name, and the existing alias has a proven working track record.
- **Suggested command:** `$impeccable polish`

#### **[P1] 31 interactive elements are below the 44×44px touch target**
- **Location:** app-wide; concentrated in the dashboard
- **Category:** Accessibility / Responsive
- **Measured:** KPI card actions `55×17` ("View all"), `92×17` ("View schedule"), `87×17` ("View invoices");
  panel `•••` menus `51×25`; header nav `32×32` and `40×40`; sidebar items `231×36`
- **Impact:** On the 390px viewport every primary card action is a 17px-tall sliver at the card's bottom
  edge. That is the single hardest target on the page and it is the main navigation affordance.
- **WCAG:** 2.5.8 Target Size (Minimum) — AA; 2.5.5 Target Size (Enhanced) — AAA
- **Recommendation:** Give text-only card links vertical padding to reach 44px without changing their
  visual position, e.g. `py-2 -my-2` on `.ds-link`. Raise the `•••` menus to 44×44. `--ds-control-h: 36px`
  is the declared control height — raise it rather than patching each site.
- **Suggested command:** `$impeccable adapt`

#### **[P1] Fixed mobile bottom nav occludes page content**
- **Location:** `body` / `main` padding vs. the `lg:hidden fixed bottom-0` nav (58px tall)
- **Category:** Responsive
- **Measured:** `body padding-bottom: 0`, `main padding-bottom: 12px`, nav height `58px`
- **Impact:** Confirmed in the 390×844 capture — the **Outstanding** card is cut off behind the nav and its
  "View invoices" action is unreachable at the scroll position shown. Users cannot reach the last card's CTA.
- **Recommendation:** Add bottom padding equal to nav height plus the safe-area inset on small screens,
  e.g. `padding-bottom: calc(58px + env(safe-area-inset-bottom))` below the `lg` breakpoint.
- **Suggested command:** `$impeccable adapt`

---

### P2 — Minor

#### **[P2] Heading hierarchy jumps `h1` → `h3`**
- **Location:** all 10 dashboard panel titles render as `h3`; the greeting is the only `h1`
- **Category:** Accessibility
- **Measured:** `h1 "Good morning, Audit Admin"` → `h3 "Cases At Risk"`
- **WCAG:** 1.3.1 Info and Relationships — heading levels should descend by one
- **Impact:** Screen-reader heading navigation skips the level that would group the panels.
- **Recommendation:** Add a visually-hidden `h2` that groups the panel region.

#### **[P2] No skip link**
- **Location:** `index.html`, before the sidebar
- **Category:** Accessibility
- **Measured:** 55 tabbable elements; the sidebar nav is first in DOM order
- **WCAG:** 2.4.1 Bypass Blocks — keyboard users tab through the whole sidebar on every navigation
- **Recommendation:** Add a visually-hidden-until-focused "Skip to main content" anchor targeting `#main`.

#### **[P2] `--ds-dispatch` fails both text and non-text contrast**
- **Location:** `--ds-dispatch: var(--p-cyan-500)` = `#06b6d4`
  ([dashboard-tokens.css:106](src/components/dashboard/dashboard-tokens.css#L106)); used at
  [dashboard-panels.tsx:71](src/components/dashboard/dashboard-panels.tsx#L71),
  [:81](src/components/dashboard/dashboard-panels.tsx#L81), [:92](src/components/dashboard/dashboard-panels.tsx#L92)
- **Category:** Accessibility
- **Measured:** **2.43:1** on white — fails the 4.5:1 text threshold *and* the 3:1 threshold for
  meaningful non-text graphics (the workload bar fill)
- **Note:** The other status tones are handled correctly — `TONE_CHIP` uses the `-ink` variants
  (emerald-700 5.21:1, rose-700 5.91:1, amber-700 4.84:1, violet-600 5.20:1, all passing).
  `dispatch` is the lone holdout.
- **WCAG:** 1.4.3 and 1.4.11
- **Recommendation:** Add `--ds-dispatch-ink: var(--p-cyan-600)` (`#0891b2`) and use it for text the way
  the other four tones do. `cyan-500` remains correct for the bar fill only if the bar is also given a
  darker outline, or switch the bar to `cyan-600`.

#### **[P2] Raw palette values escape the token layer**
- **Location:** exactly two entries — [dashboard-panels.tsx:77](src/components/dashboard/dashboard-panels.tsx#L77)
  `bg-slate-100 text-slate-500` (in `TONE_ICON_BG`) and [dashboard-panels.tsx:87](src/components/dashboard/dashboard-panels.tsx#L87)
  `bg-slate-300` (in `TONE_BAR`)
- **Category:** Theming
- **Impact:** Both `muted` entries in the tone maps reference Tailwind's default slate ramp instead of
  `--ds-*`. A brand or density change repoints the tokens but leaves these two untouched. Low severity —
  the muted tone is the least semantically loaded of the seven, so the visual divergence is small.
- **Recommendation:** Repoint to `--ds-surface-sunken` / `--ds-body` / `--ds-line-strong`. This is also
  the same latent inconsistency that produced the P1 dead-alias bug — fixing the maps fixes both.

---

### P3 — Polish

#### **[P3] "Freebuff" badge sits at 4.46:1**
White on `rgb(115,92,255)` = **4.46:1**, 0.04 short of AA. Not a dashboard file and not on the audited
surface, but it sits in the shared chrome. Darken the badge by one step.

#### **[P3] `--ds-body` captions at 4.2:1 on tinted workflow tiles**
`rgb(107,118,135)` on `rgb(241,245,249)` = **4.20:1** for the small "cases" captions under each
Production Workflow tile. Marginal; resolves if `--ds-muted` is re-tuned (see P1).

#### **[P3] No live regions on a surface with a ticking clock**
`aria-live` count is 0, yet the header renders a live "12:12 AM" clock. Low impact — the clock is not
task-critical — but if any panel count is ever meant to announce an update, it needs a live region.

---

## Patterns & Systemic Issues

1. **One token caused 38 of 46 contrast failures.** The contrast debt is not distributed — it is a single
   `--ds-muted` value chosen too light. Fixing one line clears the majority of the accessibility findings.
2. **The `@theme` bridge is an unguarded seam.** `--color-ds-*` aliases must exist for every `--ds-*` token
   a component names, and nothing enforces that. Seven call sites referenced a name that was never
   aliased and failed silently with no build error and no visual signal beyond a missing hover.
   **Recommendation:** add a lint rule or a unit test that asserts every `ds-*` utility class used in
   source resolves to a defined token. This class of bug is invisible to CI as it stands — which is
   directly relevant to the request that CI check this later.