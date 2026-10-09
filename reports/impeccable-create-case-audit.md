# Impeccable Audit — Create New Case (`CaseDetailModal`)

**Surface:** [CaseDetailModal.tsx](../src/components/cases/CaseDetailModal.tsx) (1635 lines) + [Odontogram.tsx](../src/components/cases/Odontogram.tsx) (1100 lines) + [Header.tsx](../src/components/common/Header.tsx)
**Date:** 2026-10-10
**Platform:** Web — desktop-first dental lab management SPA (Tauri/Vite + React 19 + Tailwind v4)
**Scope:** The create-mode branch of the case modal (3-step wizard), the odontogram it embeds, and the app chrome it renders over.

---

## Audit Health Score

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | **1** | The flagship modal has no `role="dialog"`, no `aria-modal`, no Escape, no focus trap — WCAG 4.1.2 |
| 2 | Performance | **2** | 19× `transition-all duration-500` on hover, nested `backdrop-blur`, full 32-tooth SVG re-render per keystroke |
| 3 | Responsive Design | **2** | Odontogram scales to ~20px tap targets at 375px; two actions are `hidden md:inline-flex` with no mobile route |
| 4 | Theming | **3** | Strong token system exists, but this surface bypasses it with hard-coded `slate-*`/`indigo-*`; light-mode header text fails contrast at 2.67:1 |
| 5 | Implementation Integrity | **2** | Bypasses the project's own documented "one dialog shell" invariant; dead `z-60` class; native `alert()`/`confirm()`; 12 unused imports |
| **Total** | | **10/20** | **Acceptable — significant work needed** |

**Rating band:** 10–13 Acceptable. The surface is visually strong and clearly domain-specific, but it is the one dialog in the app that does not use the app's dialog primitive, and it inherits that primitive's guarantees nowhere.

---

## Implementation Integrity Verdict

**FAIL — the surface is product-specific and well-crafted in isolation, but it is architecturally detached from the system it sits in.**

Evidence:

- **It bypasses the one documented invariant.** [Modal.tsx](../src/components/common/ui/Modal.tsx) opens with an explicit mission statement: *"V-19 — The one dialog shell. Eight billing modals grew their own backdrop, header and footer, so animation durations, elevation, radius, Escape handling and focus all drifted apart. This owns that chrome."* `CaseDetailModal` — the largest, most-used dialog in the product — does not import `Modal` and hand-rolls its chrome. Confirmed by grep: `<Modal` does not appear in the file.
- **Dead CSS class.** `z-60` is used at [CaseDetailModal.tsx:1492](../src/components/cases/CaseDetailModal.tsx#L1492), [:1579](../src/components/cases/CaseDetailModal.tsx#L1579), [CaseAttachmentsPanel.tsx:253](../src/components/cases/CaseAttachmentsPanel.tsx#L253), [CaseListView.tsx:1148](../src/components/cases/CaseListView.tsx#L1148), [LabDetailModal.tsx:859](../src/components/labs/LabDetailModal.tsx#L859). Tailwind v4 has no `zIndex` extension in this project and the built stylesheet contains **zero** `.z-60{…}` rules (verified against `dist/assets/index-*.css`). The overlays paint above the card only by DOM order. Any future fixed-position element appended after them will cover them.
- **Native browser dialogs inside a designed app.** `alert()` at [:393](../src/components/cases/CaseDetailModal.tsx#L393) and [:578](../src/components/cases/CaseDetailModal.tsx#L578); `confirm()` at [:1376](../src/components/cases/CaseDetailModal.tsx#L1376) (delete attachment) and [:1427](../src/components/cases/CaseDetailModal.tsx#L1427) (permanent case delete). These are unstyled, unbranded, and impossible to make keyboard-consistent with the rest of the flow.
- **Labels that are not labels.** The local `FieldLabel` renders a `<span>`, not a `<label htmlFor>` — so no input in this form has a programmatic accessible name. Its accessible name comes from the `placeholder` ("e.g. Sarah Jenkins (optional)"), which is a WCAG 3.3.2 failure and disappears once typed.
- **Conflicting numbering.** Card eyebrows read `01 · Referral`, `02 · Scans & photos`, `03 · Financial · PKR`. The stepper directly above already numbers 01/02/03. The second card is not step 2's content, so the same "02" labels two different things on screen simultaneously.
- **Dead imports.** 12 symbols imported once and never referenced: `Clock`, `MessageSquare`, `DollarSign`, `User`, `Save`, `Palette`, `Sparkles`, `File`, `SHADE_COLORS`, `ClinicalMaterial`, `CaseAttachmentsPanel`, `applyShadeToSelection`.

**False positives checked and dismissed:** the `dental-grid-bg` / dotted-texture layer and the dot-matrix texture are genuine Odontogram anatomy, not filler. The four-choice stat row, kiln-cycle timeline, shade-guide picker and lab-vs-doctor split are all real domain data with no decorative filler. This is a real dental product, not a generic template.

---

## Executive Summary

- **Audit Health Score: 10/20 (Acceptable)**
- **Issues found: 0 P0 · 5 P1 · 7 P2 · 5 P3**
- **Top issues:**
  1. The create-case modal is not a dialog — no role, no Escape, no focus trap, no focus restore.
  2. No input in the form has a label; validation errors are not programmatically tied to their field.
  3. Light-mode app-header text sits at 2.67:1 contrast.
  4. Reduced-motion support covers 2 of ~30 animations in this flow; the infinite "recording" ping keeps running.
  5. Mobile loses two primary actions entirely and shrinks odontogram targets below threshold.

**Recommended next steps:** resolve the dialog-integrity and form-semantics P1s first (they are one refactor each), then the contrast fix, then the motion/perf pass.

---

## Detailed Findings by Severity

### P1 — Major (WCAG AA violations / significant difficulty)

---

#### **[P1] The create-case modal is not programmatically a dialog**
- **Location:** [CaseDetailModal.tsx:1043](../src/components/cases/CaseDetailModal.tsx#L1043) (root overlay), plus nested overlays at [:1492](../src/components/cases/CaseDetailModal.tsx#L1492) and [:1579](../src/components/cases/CaseDetailModal.tsx#L1579)
- **Category:** Accessibility / Implementation Integrity
- **Impact:** `grep -n "Escape\|focus()\|role=\"dialog\"\|aria-modal"` over the file returns **nothing**. The overlay has no `role="dialog"`, no `aria-modal="true"`, no Escape handler, no focus trap, no focus restore, and no body scroll lock. A screen-reader user is not told a modal opened and can wander into the inert dashboard behind it; a keyboard user's Tab escapes the dialog entirely; closing it drops focus to `<body>` and they must re-traverse the page. Escape-to-close is the single most-expected dialog affordance and it is absent on the form the user spends the most time in.
- **WCAG:** 4.1.2 Name, Role, Value (A); 2.1.2 No Keyboard Trap (inverse — this is a *keyboard leak*); 2.4.3 Focus Order (A)
- **Recommendation:** Adopt the existing `Modal` primitive (or at minimum `useDialogBehavior` from [useDialogBehavior.ts](../src/components/common/ui/useDialogBehavior.ts)) for the root overlay and the two preview overlays. The primitive already owns role/aria-modal/Escape/focus-trap/focus-restore; this is an adoption, not a new build.
- **Suggested command:** `$impeccable harden`

---

#### **[P1] No form control has a label; errors are unassociated**
- **Location:** the local `FieldLabel` component and every error branch it accompanies — [CaseDetailModal.tsx](../src/components/cases/CaseDetailModal.tsx)
- **Category:** Accessibility
- **Impact:** `FieldLabel` renders a `<span>`, so nothing is bound to its input. Accessible names fall back to `placeholder` (e.g. "e.g. Sarah Jenkins (optional)"), which vanishes the moment the user types — the field then has no name at all. Required fields are marked with a bare `*` glyph with no text alternative. Errors render as red text with no `aria-invalid`, no `aria-describedby`, and no `role="alert"`, so a screen reader announces nothing when validation fails, and error text is not in the accessibility tree as an error. Validation fires only on "Continue" with no error summary and no focus move.
- **WCAG:** 1.3.1 Info and Relationships (A); 3.3.2 Labels or Instructions (A); 3.3.1 Error Identification (A); 4.1.3 Status Messages (AA)
- **Recommendation:** Make `FieldLabel` render a real `<label htmlFor>` with a generated id, mark required fields with `required` + visually-hidden "required" text, and give error nodes `id`/`role="alert"` + `aria-describedby` on the control. Add an error summary at the top of the step that takes focus on failed Continue.
- **Suggested command:** `$impeccable clarify`

---

#### **[P1] Light-mode app header text fails contrast at 2.67:1**
- **Location:** [Header.tsx:114](../src/components/common/Header.tsx#L114) (`bg-slate-900/95` bar) and its `text-ink-muted` children (breadcrumb at [:347](../src/components/common/Header.tsx#L347), the four notification buttons at [:365](../src/components/common/Header.tsx#L365))
- **Category:** Theming / Accessibility
- **Impact:** In light mode the bar background resolves to `#1e293b` while `--color-ink-muted` is `#68707b`. Measured relative-luminance ratio: **2.67:1** — well below the 4.5:1 AA floor for the 11–13px text used there. The header is persistent on every screen, including behind the create-case modal, so this is the app's most-repeated contrast failure. Dark mode is fine (`#7f8792` on `#0d1523` = 6.8:1).
- **WCAG:** 1.4.3 Contrast (Minimum) (AA)
- **Recommendation:** In light mode the dark bar needs its own muted token (≈`#c3cbd7` on `#1e293b` ≈ 9:1) rather than reusing the light-canvas `--color-ink-muted`. Add a `[data-surface="dark-bar"]` ink token pair and a contrast-audit assertion so it cannot regress.
- **Suggested command:** `$impeccable colorize`

---

#### **[P1] Reduced-motion support covers 2 of ~30 animations**
- **Location:** [index.css:406](../src/index.css#L406) is the only global rule and names exactly `.animate-step-in` and `.animate-fadeIn`; [dashboard-tokens.css:413](../src/components/dashboard/dashboard-tokens.css#L413) covers three dashboard classes
- **Category:** Accessibility / Performance
- **Impact:** Everything else keeps animating under `prefers-reduced-motion: reduce`. In this flow that includes the infinite `animate-ping` recording dot at [CaseDetailModal.tsx:1071](../src/components/cases/CaseDetailModal.tsx#L1071) and seven `animate-pulse` instances ([CaseDetailModal.tsx:881](../src/components/cases/CaseDetailModal.tsx#L881), [Odontogram.tsx:575](../src/components/cases/Odontogram.tsx#L575), [CaseProgressIndicator.tsx:74](../src/components/cases/CaseProgressIndicator.tsx#L74), [CaseProgressIndicator.tsx:152](../src/components/cases/CaseProgressIndicator.tsx#L152), plus three in CaseListView). The step's entrance transition is handled, so state change and hierarchy survive — but the perpetual loops do not, and a 1s infinite ping is exactly the pattern that triggers vestibular discomfort.
- **WCAG:** 2.3.3 Animation from Interactions (AAA); 2.2.2 Pause, Stop, Hide (A)
- **Recommendation:** Add a global reduced-motion block that neutralises `animate-ping`, `animate-pulse`, `animate-bounce` and constrains `transition-duration` on the app shell, while keeping the existing `.animate-step-in` opacity-preserving override. The "recording" and "urgent" states must keep a non-motion affordance (static ring, static dot) so meaning survives.
- **Suggested command:** `$impeccable animate`

---

#### **[P1] Icon-only buttons have no accessible name**
- **Location:** [CaseDetailModal.tsx:871](../src/components/cases/CaseDetailModal.tsx#L871) (step chip ×3), the header action cluster, and the close button — contrast with [Modal.tsx:107](../src/components/common/ui/Modal.tsx#L107), which correctly emits `aria-label={`Close ${label}`}`
- **Category:** Accessibility
- **Impact:** Several controls are icon-only with only a `title` attribute or nothing at all. `title` is not a reliable accessible name — it is skipped on touch, inconsistently exposed, and frequently overridden. The primary/secondary header actions (print, save, fullscreen) and the modal close button announce as "button" with no name.
- **WCAG:** 4.1.2 Name, Role, Value (A); 2.4.6 Headings and Labels (AA)
- **Recommendation:** Add explicit `aria-label` to every icon-only control; keep `title` only as a visual tooltip supplement.
- **Suggested command:** `$impeccable clarify`

---

### P2 — Minor (workaround exists)

---

#### **[P2] Odontogram tooth targets shrink below threshold on mobile**
- **Location:** [Odontogram.tsx:587-591](../src/components/cases/Odontogram.tsx#L587)
- **Category:** Responsive
- **Impact:** The SVG uses `viewBox="0 0 1000 690"` with `preserveAspectRatio="xMidYMid meet"` and no intrinsic width, so it scales to container width. At a 375px viewport the whole chart is 375×259 and each of the 32 FDI teeth collapses to roughly 20×28px — under the 44×44px touch minimum and close to the 24×24px WCAG 2.2 AA floor (2.5.8). Tapping the wrong tooth on a phone is a real risk, and mis-taps silently attach materials to the wrong tooth.
- **Recommendation:** Give the chart a `min-width` with horizontal scroll on small screens, or collapse to a single-arch vertical layout below `sm`. The per-tooth `<g>` already carries `aria-label` and `tabIndex={0}`, so a roving-tabindex pattern would also cut the 32-tab-stop problem below.
- **Suggested command:** `$impeccable adapt`

---

#### **[P2] 32 unlabelled-state tab stops before the tooth inspector**
- **Location:** [Odontogram.tsx](../src/components/cases/Odontogram.tsx) — every tooth group rendered with `tabIndex={0}`
- **Category:** Accessibility
- **Impact:** Each tooth is a separate tab stop, so a keyboard user presses Tab ~32 times to reach the inspector panel that is the whole reason they selected a tooth. The selected tooth exposes no state — no `aria-pressed`/`aria-selected`, and the name is only the FDI number ("Tooth 11"), with no indication of its material, shade, or preparation.
- **WCAG:** 2.4.3 Focus Order (A); 4.1.2 Name, Role, Value (A)
- **Recommendation:** Implement roving tabindex (one tab stop, arrow keys within the grid, `aria-selected` on the active tooth) and extend each tooth's accessible name to include material and shade.
- **Suggested command:** `$impeccable adapt`

---

#### **[P2] Two primary actions are unavailable below `md`**
- **Location:** "Save preset" and "Job Slip" buttons, both `hidden md:inline-flex` in the header action cluster
- **Category:** Responsive
- **Impact:** Below 768px these vanish with no alternative entry point anywhere in the modal — job slip generation and case-template saving simply cannot be reached on a tablet or phone.
- **Recommendation:** Move them into an overflow menu that is present at every breakpoint, rather than deleting them from the layout.
- **Suggested command:** `$impeccable adapt`

---

#### **[P2] Native `alert()` / `confirm()` inside the designed flow**
- **Location:** [CaseDetailModal.tsx:393](../src/components/cases/CaseDetailModal.tsx#L393), [:578](../src/components/cases/CaseDetailModal.tsx#L578), [:1376](../src/components/cases/CaseDetailModal.tsx#L1376), [:1427](../src/components/cases/CaseDetailModal.tsx#L1427)
- **Category:** Implementation Integrity
- **Impact:** Success feedback for "Template saved" and both destructive confirmations use OS dialogs. They cannot carry the app's type, spacing, or focus treatment, and — critically — a native modal stacked over a custom modal blocks the custom modal's own keyboard handling entirely, producing inconsistent Escape/tab behaviour between the two confirm paths in the same screen.
- **Recommendation:** Replace with a small in-app confirm/confirm-destructive component built on the existing `Modal` primitive.
- **Suggested command:** `$impeccable polish`

---

#### **[P2] `z-60` is a dead utility — overlays stack by accident, not by design**
- **Location:** 5 sites listed under the Integrity Verdict
- **Category:** Implementation Integrity
- **Impact:** Verified against the built stylesheet: `.z-60{…}` is never emitted because Tailwind v4's default z-index scale stops at 50 and this project adds no `zIndex` theme extension. The overlays currently paint above the card only because they come later in DOM order inside the same stacking context. Nothing enforces that relationship, so the first fixed-position element appended after them — a toast, a new drawer, a future preview — will silently cover the image preview.
- **Recommendation:** Use `z-[60]`, or add a proper `--z-*` scale to the theme and use `z-modal-preview`. `z-[60]` is the smaller change; the theme scale is the durable one.
- **Suggested command:** `$impeccable harden`

---

#### **[P2] Nested `backdrop-blur` on stacked overlays**
- **Location:** [CaseDetailModal.tsx:1043](../src/components/cases/CaseDetailModal.tsx#L1043) (`bg-slate-950/60 backdrop-blur-sm`), with `:1492` and `:1579` each adding a second full-screen `backdrop-blur-sm`
- **Category:** Performance
- **Impact:** Opening an image preview stacks a blurred backdrop over an already-blurred backdrop. Backdrop filters are composited per frame and cannot be composited on the GPU as a cached layer, so this is a full-viewport repaint on every scroll and hover inside the preview. On a 4K display this is the single most expensive paint in the modal.
- **Recommendation:** Drop the blur on nested overlays to a plain scrim — the visual difference is negligible once the parent is already blurred.
- **Suggested command:** `$impeccable optimize`

---

#### **[P2] Whole chart re-renders on every keystroke**
- **Location:** [CaseDetailModal.tsx](../src/components/cases/CaseDetailModal.tsx) → [Odontogram.tsx:343](../src/components/cases/Odontogram.tsx#L343)
- **Category:** Performance
- **Impact:** The 32-tooth reduction inside `Odontogram` *is* correctly memoized, so the expensive part is already fine — but the component itself is not wrapped in `React.memo`, and the parent re-renders on every keystroke in the case-number or patient-name fields. Each of those keystrokes reconciles the full SVG: 32 tooth groups of roughly 8 paths each, plus arch guides and midline — on the order of 250 SVG elements reconciled per character typed. The two heaviest fields sit directly above the chart, so this is on the hottest path in the form.
- **Recommendation:** Wrap the chart in `React.memo` and pass a stable `onChange` (the existing `useCallback` on the parent's change handler covers the callback half).
- **Suggested command:** `$impeccable optimize`

---

### P3 — Polish (no real user impact)

---

#### **[P3] `transition-all duration-500` on 19 hover states**
- **Location:** 19 occurrences in [CaseDetailModal.tsx](../src/components/cases/CaseDetailModal.tsx)
- **Category:** Performance
- **Impact:** `transition-all` animates *every* animatable property, including layout-affecting ones, at a half-second duration. Most of these targets only change colour and shadow. At 500ms the colour ramps are also slow enough to read as lag rather than response. Naming the properties explicitly (`transition-colors duration-150`) is both cheaper and crisper.
- **Suggested command:** `$impeccable optimize`

---

#### **[P3] Section numbering collides with the stepper**
- **Location:** card eyebrows `01 · Referral`, `02 · Scans & photos`, `03 · Financial · PKR`
- **Category:** Implementation Integrity
- **Impact:** The stepper immediately above already labels these three sections 01/02/03. The second card is not step 2's content, so "02" identifies two different things on one screen. Section numbers here carry no information the stepper does not already carry.
- **Suggested command:** `$impeccable distill`

---

#### **[P3] Card dividers are near-invisible in light mode**
- **Location:** `shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]` used as the only separator between cards
- **Category:** Theming
- **Impact:** A 5%-white inset shadow on a white card is effectively invisible in light mode, so the cards read as one undifferentiated block. The intended separation comes from the whitespace between them, which works, but the divider is dead CSS in the dominant theme.
- **Suggested command:** `$impeccable polish`

---

#### **[P3] Twelve unused imports**
- **Location:** [CaseDetailModal.tsx](../src/components/cases/CaseDetailModal.tsx) lines 1–40
- **Category:** Implementation Integrity
- **Impact:** `Clock`, `MessageSquare`, `DollarSign`, `User`, `Save`, `Palette`, `Sparkles`, `File`, `SHADE_COLORS`, `ClinicalMaterial`, `CaseAttachmentsPanel`, `applyShadeToSelection` are each referenced exactly once — at their own import site. `CaseAttachmentsPanel` in particular suggests a panel that was wired and then removed, leaving the dead import as the only trace.
- **Suggested command:** `$impeccable distill`

---

#### **[P3] Dense uppercase micro-labels**
- **Location:** card eyebrows (`text-[10px] uppercase tracking-widest`)
- **Category:** Accessibility
- **Impact:** 10px uppercase with `tracking-widest` sits at the edge of legibility, and `tracking-widest` on an all-caps string costs more horizontal space than the letterforms use. Contrast is fine (5.01:1 on the white card), so this is a legibility/comfort note rather than a WCAG issue.
- **Suggested command:** `$impeccable typeset`

---

## Patterns & Systemic Issues

1. **The dialog invariant is documented but not enforced.** `Modal.tsx` states its reason for existing in a doc comment, and nine other call sites use it — but nothing stops the tenth-largest dialog from bypassing it. This is an enforcement gap, not a knowledge gap: the fix is a lint rule or a test that fails when a `fixed inset-0` overlay appears without `role="dialog"`, not a reminder.
2. **Reduced-motion coverage is opt-in per feature.** Two rules in [index.css:406](../src/index.css#L406), three in [dashboard-tokens.css:413](../src/components/dashboard/dashboard-tokens.css#L413). Every new animation silently escapes it. A single global neutraliser at the app shell would make the whole class of problem disappear.
3. **Labels are visual, not semantic.** The pattern "styled `<span>` above an input" recurs wherever a form is built in this codebase. Since this is the highest-value form in the product, fixing it here sets the pattern; other forms should follow.
4. **Dense, information-rich UI with no density escape hatch.** The dashboard exposes `--ds-density-compact` / `--ds-density-roomy`; the case modal exposes nothing. A technician on a laptop is the primary user, and this is the densest screen in the app.

---

## Positive Findings

- **Genuinely domain-specific, not templated.** Theodontogram, the kiln-cycle progress timeline, the four-choice tooth-condition stat row, the dental shade-guide picker with named VITA shades, the lab-vs-doctor referrer split, the PKR-currency financial step, and the "Auto-select … from last case" affordances are all real dental-lab workflow. Nothing here is filler or a reskinned admin template.
- **The three-step wizard is well-shaped.** Linear `1 → 2 → 3`, forward-only unlock, persistent Back/Continue in the footer, contextual primary-button labels ("Create case", not "Submit"), and auto-advance from Continue into the odontogram. This is the right structure for the task.
- **Preference recall is thoughtful.** Six distinct "use last case" defaults (lab, due date, shade, prep, implant, discount) turn the form from a data-entry chore into a review step. This is real workflow design, not decoration.
- **Print and job-slip affordances are already there.** Batch print, job slip preview, and save-as-template mean the form is understood as the *start* of a production pipeline rather than a standalone record.
- **Theodontogram memoization is correct.** The 32-tooth reduction, the selected-set lookup, and the active-spec filters are all `useMemo`'d — the expensive work was identified and cached properly.
- **Reduced motion is already considered** for the step transition, with a state-preserving override. The pattern is right; it just is not extended.
- **Token infrastructure is real.** `--ds-*` primitives plus dark overrides plus a scripted contrast audit plus `tests/design-tokens.test.ts` already exist. Theming is a discipline problem here, not a missing-system problem.

---

## Recommended Actions

1. **[P1] `$impeccable harden`** — adopt `Modal` / `useDialogBehavior` for the case modal and its two preview overlays. Fixes the missing role, `aria-modal`, Escape, focus trap, focus restore and scroll lock in one refactor, and closes the integrity gap at the same time.
2. **[P1] `$impeccable clarify`** — real `<label htmlFor>` on every field, `aria-label` on every icon-only control, and `aria-invalid` / `aria-describedby` / `role="alert"` plus a focusable error summary on the validation path.
3. **[P1] `$impeccable colorize`** — give the dark header bar its own ink token pair so light mode clears 4.5:1, and add a regression assertion to `tests/design-tokens.test.ts`.
4. **[P1] `$impeccable animate`** — one global reduced-motion neutraliser covering `animate-ping`/`animate-pulse`/`animate-bounce`, with non-motion substitutes for the recording and urgent states.
5. **[P2] `$impeccable adapt`** — roving tabindex across the odontogram with `aria-selected`, a min-width/scroll or single-arch fallback below `sm`, and an overflow menu so "Save preset" and "Job Slip" exist at every breakpoint.
6. **[P2] `$impeccable optimize`** — `React.memo` the odontogram, drop the nested backdrop blurs, and replace the 19 `transition-all duration-500` with named transitions at ~150ms.
7. **[P2] `$impeccable polish`** — replace `alert()`/`confirm()` with an in-app confirm built on the `Modal` primitive; fix the dead `z-60` stacking.
8. **[P3] `$impeccable distill`** — remove the 12 unused imports and drop the redundant `01/02/03` card numbering.
9. **[P3] `$impeccable typeset`** — revisit the 10px uppercase eyebrows for legibility.
10. **`$impeccable polish`** — final pass over the P3 items above.

You can ask me to run these one at a time, all at once, or in any order you prefer.

Re-run `$impeccable audit` after fixes to see the score improve.