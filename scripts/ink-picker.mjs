/*
 * Generate dark.css' chromatic role overrides, graded against real surfaces.
 *
 * WHY A GENERATOR
 * The chromatic ramps in this app wear TWO hats. `bg-indigo-600` is a
 * saturated fill under white text; `text-indigo-600` is ink on a card. They
 * resolve to the SAME `--color-indigo-600`, so no token remap can serve both —
 * dark.css pins them per UTILITY instead. Those pins each carry a 4.5:1
 * claim, so they are derived and graded here rather than typed from memory.
 *
 * SCOPE — exactly what scripts/contrast-audit.mjs flagged as a DARK-ONLY
 * regression, nothing more. Two earlier drafts rewrote all 24 chromatic
 * fills; the audit never asked for that, and it actively damaged
 * `active:bg-indigo-800`, where darkening toward "passes white ink" turned a
 * button's active state into a black hole.
 *
 * Run: node scripts/ink-picker.mjs
 */

import { lightPaletteByName } from './light-palette.mjs'

/* ------------------------------------------------ oklch <-> sRGB (Tailwind v4) */
/*
 * The LIGHT palette is read from the Tailwind SOURCE rather than recalled. A
 * previous draft of this script hardcoded lightness guesses for the 800/900/950
 * fills and repainted them near-black; the real values pass AA under white ink
 * in light (6.78–15.01:1), so those utilities were never meant to change colour
 * at all. Guessing produced a fix for a bug that did not exist and buried the
 * one that did.
 */
const LIGHT = lightPaletteByName()

if (Object.keys(LIGHT).length === 0) {
  console.error('No `--color-*` tokens found in the Tailwind source. Run `npm ci` if node_modules is missing.')
  process.exit(2)
}

/** A light-palette token as hex, whether Tailwind wrote it as hex or oklch. */
function lightHex(name) {
  const v = LIGHT[name]
  if (!v) return null
  if (v.startsWith('#')) return v
  const m = v.match(/oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)/)
  if (!m) return null
  return toHex(oklchToRgb(Number(m[1]) / 100, Number(m[2]), Number(m[3])))
}
function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return [lr, lg, lb].map((v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055
    return Math.min(255, Math.max(0, Math.round(c * 255)))
  })
}
const toHex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
const parseHex = (h) => h.replace('#', '').match(/../g).map((p) => parseInt(p, 16))
const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const la = lum(parseHex(a))
  const lb = lum(parseHex(b))
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
const AA = 4.5

/** Alpha wash composited over a backdrop — what `bg-x/10` actually paints. */
const composite = (fg, alpha, bg) =>
  toHex(parseHex(fg).map((c, i) => Math.round(alpha * c + (1 - alpha) * parseHex(bg)[i])))

/* ------------------------------------------------------------------ palette */
const HUES = {
  indigo: 264, rose: 15, emerald: 163, amber: 76, blue: 254, purple: 303,
  sky: 199, violet: 294, cyan: 201, teal: 173, orange: 55, red: 25,
}

/* ═══════════════════════════════════════════════════════════════════════
 * 1. INK ON A CARD — steps 500/600/700.
 *
 * dark.css deliberately leaves 400–700 alone ("500/600 are saturated fills
 * that must stay dark"), so `text-indigo-700` is still Tailwind's deep indigo
 * on a dark card. That is the single largest dark-only cluster in the audit.
 *
 * Hues are the six it flagged. All THREE steps ship even where only 600/700
 * were flagged, because 500/600/700 are one emphasis ladder — lighting up
 * 700 while 500 stays deep would make a quiet label louder than a loud one.
 * ═══════════════════════════════════════════════════════════════════════ */
const CARD_HUES = ['indigo', 'rose', 'emerald', 'amber', 'blue', 'purple']

/** Dark card/tint surfaces, straight from dark.css' own remap. */
const CARD_SURFACES = [
  '#0b1220', // slate-50
  '#111a2b', // slate-100
  '#1b2637', // slate-200
  '#0f1826', // white card
  '#1b2549', // indigo-100
  '#3a1a20', // rose-100
  '#0f3220', // emerald-100
  '#3a2a08', // amber-100
  '#0f2745', // blue-100
  '#281d43', // purple-100
]

/* ═══════════════════════════════════════════════════════════════════════
 * 2. INK ON A DARK INVERSE SURFACE — step 300.
 *
 * dark.css maps 300 to a dark TINT (it is used as a border/fill), which is
 * wrong for `text-*-300`. Every -300 ink call site sits on a dark surface:
 * the audit-log <pre>, the statement tfoot, the severity chips in the case
 * header. Hues are the six the census found in that role.
 * ═══════════════════════════════════════════════════════════════════════ */
const DARK_SURFACE_HUES = ['sky', 'indigo', 'emerald', 'amber', 'rose', 'violet']

const HEADER = '#0d1523' // dark.css `.dark .bg-slate-900`
const INVERSE_SURFACES = [
  HEADER,
  '#0d1523', // bg-slate-900/95 composites to effectively this
  '#1b2330', // bg-white/[0.06] over the header  (CaseDetailModal empty states)
  composite('#38bdf8', 0.1, HEADER), // bg-sky-400/10 over the header (severity chip)
  composite('#fbbf24', 0.1, HEADER), // bg-amber-400/10 over the header
  composite('#fb7185', 0.1, HEADER), // bg-rose-400/10 over the header
  '#0f1826', // white card — BillingReportsView:188 "Advance Held"
]

/* ═══════════════════════════════════════════════════════════════════════
 * 3. FILLS UNDER WHITE INK.
 *
 * dark.css maps 800/900/950 to pale ink, so an inverse surface — the rose
 * "Cancelled" banner, the amber Backup button, the slate-900 toolbar —
 * collapsed to a near-white slab carrying white text at ~1.05:1. Those are
 * re-pinned as saturated darks that clear white ink, keeping the hue.
 *
 * `bg-rose-600` and `bg-indigo-500` are a different fault: light mode sits
 * right on the line (4.51 / 4.58) and dark slips a hair under it. Same
 * solver, but these two start from their own light-mode lightness so the
 * shift is a nudge, not a repaint.
 *
 * Two DIFFERENT faults, and conflating them is what made an earlier draft of
 * this file wrong:
 *
 *   (a) The 800/900/950 steps were remapped to PALE INK, because those same
 *       tokens are also `text-rose-800` on a `bg-rose-50` chip. As a FILL
 *       they collapsed to a near-white slab carrying white text at 1.05–1.43.
 *       These were already fine as fills in light (6.78–15.01), so the fix is
 *       to RESTORE the light value, not to invent a new one.
 *
 *   (b) `bg-rose-600` / `bg-indigo-500` sit right on the line in light and slip
 *       a hair under it in dark. Only these two need to move, and only as far
 *       as the bar demands.
 * ═══════════════════════════════════════════════════════════════════════ */

/** (a) fills to restore verbatim — dark.css must stop lightening them. */
const RESTORE_FILLS = ['bg-rose-950', 'bg-rose-900', 'bg-rose-800', 'bg-indigo-800', 'bg-amber-800']

/** (b) fills to nudge down until they clear white ink. */
const NUDGE_FILLS = { 'bg-rose-600': 'rose-600', 'bg-indigo-500': 'indigo-500' }

const WHITE_INK = '#f8fafc' // what dark.css pins text-white to

/** Chroma tapers at both ends so a tone never clips out of sRGB. */
const chromaAt = (L, peak = 0.19) =>
  Math.max(0.04, Math.min(peak, peak * Math.max(0.3, 1 - Math.abs(L - 0.62) / 0.55)))

/**
 * Walk lightness in `dir` until the tone clears `bar` on EVERY surface.
 * Returns the first passing tone, or null if the ramp runs out.
 */
function solve(hDeg, startL, dir, surfaces, bar = AA, peak = 0.19) {
  for (let i = 0; i <= 200; i++) {
    const L = startL + dir * i * 0.005
    if (L > 0.99 || L < 0.05) return null
    const hex = toHex(oklchToRgb(L, chromaAt(L, peak), hDeg))
    if (surfaces.every((bg) => ratio(hex, bg) >= bar)) return { hex, L }
  }
  return null
}
const minOn = (hex, surfaces) => Math.min(...surfaces.map((bg) => ratio(hex, bg)))

const out = []
const failures = []

/* ── 1. ink on a card: 500 < 600 < 700 in contrast, as in light theme ── */
/*
 * Contrast MUST rise with the step number — 700 is the loudest ink, 500 the
 * quietest, the same emphasis order the light theme has expressed as
 * darkness instead of lightness. (An earlier draft asserted the opposite and
 * rejected its own correct output.)
 */
const INK_LADDER = { 500: 0.72, 600: 0.78, 700: 0.84 }
for (const hue of CARD_HUES) {
  let prevWorst = -Infinity
  for (const step of [500, 600, 700]) {
    const util = `text-${hue}-${step}`
    const got = solve(HUES[hue], INK_LADDER[step], +1, CARD_SURFACES)
    if (!got) {
      failures.push(`${util}: no tone clears ${AA} on every card surface`)
      continue
    }
    const w = minOn(got.hex, CARD_SURFACES)
    if (w < prevWorst - 0.001) {
      failures.push(`${util}: emphasis order inverted (${w.toFixed(2)} < ${prevWorst.toFixed(2)})`)
    }
    prevWorst = w
    out.push({ util, prop: 'color', hex: got.hex, kind: 'INK_ON_CARD', worst: w })
  }
}

/* ── 2. ink on a dark inverse surface: the pale end, so it must LIGHTEN ── */
for (const hue of DARK_SURFACE_HUES) {
  const util = `text-${hue}-300`
  const got = solve(HUES[hue], 0.72, +1, INVERSE_SURFACES)
  if (!got) {
    failures.push(`${util}: no tone clears ${AA} on every inverse surface`)
    continue
  }
  out.push({
    util, prop: 'color', hex: got.hex, kind: 'INK_ON_DARK_SURFACE',
    worst: minOn(got.hex, INVERSE_SURFACES),
  })
}

/* ── 3a. restore the fills dark.css wrongly lightened ── */
for (const util of RESTORE_FILLS) {
  const token = util.slice(3) // strip the `bg-`
  const hex = lightHex(token)
  if (!hex) {
    failures.push(`${util}: no light token "${token}" in dist — cannot restore`)
    continue
  }
  const w = ratio(hex, WHITE_INK)
  if (w < AA) {
    failures.push(`${util}: light value ${hex} is only ${w.toFixed(2)}:1 under white — needs a nudge, not a restore`)
    continue
  }
  out.push({ util, prop: 'background-color', hex, kind: 'FILL_RESTORED', worst: w })
}

/* ── 3b. nudge the two fills that sit on the line ── */
for (const [util, token] of Object.entries(NUDGE_FILLS)) {
  const hex = lightHex(token)
  if (!hex) {
    failures.push(`${util}: no light token "${token}" in the Tailwind source`)
    continue
  }
  const [hue, step] = token.split('-')
  const oklch = LIGHT[token].match(/oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)/)
  if (!oklch) {
    failures.push(`${util}: light token is hex, cannot derive a ramp to walk`)
    continue
  }
  const got = solve(Number(oklch[3]), Number(oklch[1]) / 100, -1, [WHITE_INK], AA, Number(oklch[2]))
  if (!got) {
    failures.push(`${util}: no tone clears ${AA} under white ink`)
    continue
  }
  out.push({
    util, prop: 'background-color', hex: got.hex, kind: 'FILL_NUDGED',
    worst: minOn(got.hex, [WHITE_INK]),
  })
  void hue; void step
}

/* ── self-check: replay every rule and refuse to emit a sub-AA pair ── */
for (const r of out) {
  if (r.worst < AA) failures.push(`${r.util}: emits ${r.hex} at ${r.worst.toFixed(2)}:1`)
}

console.log(`✓ ${out.length} rules, worst case ${Math.min(...out.map((r) => r.worst)).toFixed(2)}:1\n`)
for (const kind of [...new Set(out.map((r) => r.kind))]) {
  console.log(`  /* ${kind} */`)
  for (const r of out.filter((x) => x.kind === kind)) {
    console.log(`  .dark .${r.util} {\n    ${r.prop}: ${r.hex};\n  }`)
  }
}
if (failures.length) {
  console.error('✗ UNRESOLVED — fix by hand before pasting:')
  for (const f of failures) console.error(`  ${f}`)
  process.exit(1)
}