# LOOPS.md

Reusable, bounded agent loops for this project. Each entry records what the
loop does, the exact prompt that runs it, and when it was saved.

---

## Dashboard design-fidelity

Rebuilds or restyles a dashboard panel against a reference image, then measures
the rendered DOM for overflowing containers and clipped strings at the target
viewport and at one narrower viewport, fixing the worst finding and
re-measuring until both counts reach zero.

**Why it exists:** eyeballing a screenshot reliably misses label clipping and
the breakpoint at which a grid gets too narrow — the sidebar eats ~300px, so an
`xl:` layout can fire while only ~980px of content remains. Counting
`scrollWidth > clientWidth` in the live DOM catches both. During the v2.15
dashboard rebuild this loop caught "PKR PKR 67,000" and four clipped labels
that no screenshot review had flagged.

**Save date:** 2026-10-03

Prompt:
> Restyle the named dashboard panel to match the attached reference. After each
> change, load the page and count elements where `scrollWidth > clientWidth` —
> once at the target viewport and once ~25% narrower — plus any horizontal
> scroll on the scroll container. Fix the worst finding and re-measure. Stop
> when both counts are zero at both widths. Keep every figure backed by real
> data: if the reference shows a value the schema cannot supply, substitute the
> real equivalent and say which one you swapped. Ask before editing files
> outside the panel.

---

## Notes

These are this project's own loops, not entries from the public Loop Library.