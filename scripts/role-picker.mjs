/*
 * Solve the ROLE primitives (ink / fill) that replace the dual-role palette
 * utilities.
 *
 * WHY A GENERATOR, AGAIN
 * ink-picker.mjs solves for the DARK remap. It reads the light palette as a
 * given and only moves values inside `.dark`. The failures this addresses are
 * the opposite end: `text-slate-400` on a white card is 2.63:1 in LIGHT mode,
 * and no dark remap can fix that because the light column is not remapped at
 * all. Those values have to be DESIGNED against the light surfaces, which is
 * what this script does.
 *
 * THE SPLIT
 * One palette step was doing two jobs. `text-emerald-600` is ink on a white
 * card (needs to be dark); `bg-emerald-600` is a saturated fill under white
 * ink (needs to be dark too, but by a different amount, and for a different
 * reason). They happen to agree here, which is exactly why sharing a token
 * kept producing bugs: fix one role, break the other. Each role now has its
 * own token:
 *
 *   INK  — `--color-ink-*`   text on a surface.  graded against every surface
 *                              it is ever painted on, in BOTH themes.
 *   FILL — `--color-fill-*`  a saturated slab under white ink. graded against
 *                              white ink only.
 *
 * THE TOKENS ARE GENERATED, NOT AUTHORED
 * These nine values used to be pasted by hand into index.css and dark.css,
 * which is how they drifted apart: index.css carried `--color-ink-danger:
 * #d20032` while the solver produced `#d50033`, so the file was no longer the
 * output of any check and nobody could tell which number was intended. The
 * same edit path is how a NEW semantic colour gets added in the old dual-role
 * way — pick a palette step, write `text-teal-600` and `bg-teal-600` from the
 * same token, and the original bug returns one hue at a time.
 *
 * So this script owns the declarations:
 *
 *   node scripts/role-picker.mjs            print both blocks (review)
 *   node scripts/role-picker.mjs --write    rewrite them into the two files
 *   node scripts/role-picker.mjs --check    exit 1 if the files have drifted
 *
 * `--write` and `--check` fail loudly rather than silently doing nothing when
 * they cannot find the block to replace, which is the failure mode that lets a
 * stale copy sit next to a fresh solver output for months.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lightPaletteByName } from './light-palette.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const AA = 4.5

const MODE = process.argv.includes('--write')
  ? 'write'
  : process.argv.includes('--check')
    ? 'check'
    : 'print'

/*
 * The palette comes from the Tailwind SOURCE, not `dist/`. `--check` is what
 * gates CI, and a design check that cannot run on a clean checkout is a check
 * people skip locally — but the real cost was the opposite: a STALE dist/ let
 * `--check` pass against a bundle the app no longer ships, so a drifted token
 * went green. See scripts/light-palette.mjs for the equivalence proof.
 */
const LIGHT = lightPaletteByName()

if (Object.keys(LIGHT).length === 0) {
  console.error('No `--color-*` tokens found in the Tailwind source. Run `npm ci` if node_modules is missing.')
  process.exit(2)
}

function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
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
  const la = lum(parseHex(a)), lb = lum(parseHex(b))
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
const minOn = (hex, surfaces) => Math.min(...surfaces.map((s) => ratio(hex, s)))
/** Hex for a light token, whatever notation Tailwind wrote it in. */
function lightHex(name) {
  const v = LIGHT[name]
  if (!v) return null
  if (v.startsWith('#')) {
    // Tailwind writes `--color-white: #fff` — three digits, not six.
    if (v.length === 4) return '#' + v.slice(1).split('').map((c) => c + c).join('')
    return v.slice(0, 7)
  }
  const m = v.match(/oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)/)
  return m ? toHex(oklchToRgb(Number(m[1]) / 100, Number(m[2]), Number(m[3]))) : null
}

/* ------------------------------------------------------------------ surfaces */
/*
 * Read straight off the compiled light palette, not from memory — a guessed
 * surface is how a solver "passes" against a colour the app never paints.
 */
const L = {
  white: lightHex('white'),
  slate50: lightHex('slate-50'),
  slate100: lightHex('slate-100'),
  rose50: lightHex('rose-50'),
  rose100: lightHex('rose-100'),
  emerald50: lightHex('emerald-50'),
  emerald100: lightHex('emerald-100'),
  amber50: lightHex('amber-50'),
  amber100: lightHex('amber-100'),
  blue50: lightHex('blue-50'),
  blue100: lightHex('blue-100'),
}
/*
 * Every surface above must resolve to a hex, or `ratio()` dereferences null
 * and the whole run dies with a stack trace instead of a diagnosis.
 *
 * This is NOT the same as the "no tokens at all" guard above. The project's own
 * `--color-ink-*` / `--color-ds-*` primitives live in src/index.css and
 * dashboard-tokens.css, which are in the repository — so a clone with no
 * node_modules still reports a NON-empty palette and sails past that guard,
 * while every Tailwind step it actually grades against (`slate-50`, `rose-50`,
 * …) is missing. The crash that produced: `parseHex(null)` inside `ratio`,
 * reached from `walk`, with the message
 *
 *   TypeError: Cannot read properties of null (reading 'replace')
 *
 * which says nothing about the actual cause. Since `role:check` now runs
 * inside `dev` and `build`, that is a stack trace on the first command a new
 * developer types.
 *
 * So check the tokens this script DEPENDS ON, not the palette's size, and exit
 * 2 — the same "cannot run here" code the guard script above already uses.
 *
 * The names are listed here rather than derived from the `L` keys, because the
 * key names (`slate50`) are not the token names (`--color-slate-50`) and
 * reconstructing one from the other is how a diagnostic ends up quoting
 * tokens that do not exist.
 */
{
  const REQUIRED = [
    'white', 'slate-50', 'slate-100',
    'rose-50', 'rose-100',
    'emerald-50', 'emerald-100',
    'amber-50', 'amber-100',
    'blue-50', 'blue-100',
  ]
  const missing = REQUIRED.filter((t) => !lightHex(t))
  if (missing.length) {
    console.error(
      `The Tailwind palette is incomplete — ${missing.length} surface token(s) the solver grades against are absent:\n` +
        missing.map((t) => `  --color-${t}`).join('\n') +
        '\n\nThey come from node_modules/tailwindcss/theme.css. Run `npm ci`.',
    )
    process.exit(2)
  }
}
/* The dark counterparts, verbatim from src/theme/dark.css. An ink token is
   only safe if it clears AA on BOTH lists — one is not enough. */
const D = {
  white: '#0f1826',
  slate50: '#0b1220',
  slate100: '#111a2b',
  rose50: '#2b1418',
  rose100: '#3a1a20',
  emerald50: '#0b2418',
  emerald100: '#0f3220',
  amber50: '#2a1d05',
  amber100: '#3a2a08',
  blue50: '#0b1d33',
  blue100: '#0f2745',
}

/* The accent, read from the same place the app reads it.
 *
 * Every other role is solved against the Tailwind palette, but the brand ramp
 * is NOT in it: `applyBrandColor()` writes `--brand-*` at runtime and the
 * default indigo swatch lives in index.css `:root`. The ink that rides on
 * `bg-brand-50` / `bg-brand-100` therefore has to be solved against THAT ramp
 * — solving it against `indigo-50` would grade a colour the app never paints
 * the moment a user picks a different accent.
 *
 * The dark brand surfaces are quoted from the `.dark` block, the same way every
 * other dark surface above is.
 */
const BRAND = (() => {
  const out = {}
  const src = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const [, rawSel, body] of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // `rawSel` is everything between the previous `}` and this `{`, so for the
    // FIRST block in the file it still carries the `@import` preamble. Matching
    // the whole capture against `:root` therefore never matched and BRAND came
    // back empty — a silent failure that only surfaced once anything consumed
    // it. Take the last selector segment instead, which is what actually
    // precedes the brace.
    const sel = rawSel.slice(Math.max(rawSel.lastIndexOf(';'), rawSel.lastIndexOf('}')) + 1).trim()
    if (!/(^|,)\s*:root\s*$/.test(sel)) continue
    for (const d of body.matchAll(/--brand-(\d+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[d[1]] = d[2]
  }
  return out
})()
const BRAND_D = { 50: '#1b2549', 100: '#233060', 200: '#2a3768' }

/** Hue° and lightness of a hex colour, via OKLab. */
function oklchOf(hex) {
  const [r8, g8, b8] = parseHex(hex)
  const lin = [r8, g8, b8].map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  const [lr, lg, lb] = lin
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L_ = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const b2 = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const hue = (Math.atan2(b2, a) * 180) / Math.PI
  return { h: hue < 0 ? hue + 360 : hue, L: L_, C: Math.hypot(a, b2) }
}

const WHITE_INK_LIGHT = '#ffffff'
const WHITE_INK_DARK = '#f8fafc' // what dark.css pins .dark .text-white to

/* Hue + chroma come from the light token itself, not from a recalled angle.
 * A hardcoded hue is how `ink-warning` came out olive: Tailwind's amber-600
 * is oklch(66.8% .114 56.9), not the 95 a lookup table guessed. Same reason
 * the neutrals are walked at chroma 0.016 — slate-400 is oklch(70.7% .013),
 * and at 0.16 the "muted" ink comes out frankly BLUE, which reads as a link. */
const NEUTRAL_C = 0.016
/** [hue°, chroma, L] of a light palette token, or null if it is plain hex. */
function rampAt(token) {
  const v = LIGHT[token]
  const m = v && v.match(/oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)/)
  return m ? [Number(m[3]), Number(m[2]), Number(m[1]) / 100] : null
}

/** Chroma tapers at both ends so a tone never clips out of sRGB. */
const chromaAt = (L_, peak = 0.16) =>
  Math.max(0.02, Math.min(peak, peak * Math.max(0.25, 1 - Math.abs(L_ - 0.55) / 0.5)))

/**
 * Walk lightness from `startL` in `dir` until the tone clears `bar` on EVERY
 * surface. Returns the first passing tone — the least change that works.
 */
function solve(hDeg, startL, dir, surfaces, bar = AA, peak = 0.16) {
  const hit = walk(hDeg, startL, dir, surfaces, bar, peak)
  return hit ? hit.hex : null
}

/** `solve` but also reports the lightness it settled on, for state steps. */
function walk(hDeg, startL, dir, surfaces, bar = AA, peak = 0.16) {
  for (let i = 0; i <= 400; i++) {
    const Lv = startL + dir * i * 0.0025
    if (Lv > 0.99 || Lv < 0.02) return null
    const hex = toHex(oklchToRgb(Lv, chromaAt(Lv, peak), hDeg))
    if (surfaces.every((bg) => ratio(hex, bg) >= bar)) return { hex, L: Lv }
  }
  return null
}

const out = []
const failures = []
const emit = (name, light, dark, surfacesL, surfacesD) => {
  if (!light || !dark) { failures.push(`${name}: solver found no tone`); return }
  grade(name, light, dark, surfacesL, surfacesD)
}

/** Grade an already-chosen pair without solving for it. */
const grade = (name, light, dark, surfacesL, surfacesD) => {
  const wl = minOn(light, surfacesL), wd = minOn(dark, surfacesD)
  if (wl < AA) failures.push(`${name}: light ${light} is ${wl.toFixed(2)}:1`)
  if (wd < AA) failures.push(`${name}: dark ${dark} is ${wd.toFixed(2)}:1`)
  out.push({ name, light, dark, worst: Math.min(wl, wd) })
}

/* ═══════════════════════════════════════════════════════════════════════
 * 1. NEUTRAL INK — replaces `text-slate-400` / `text-slate-500`.
 *
 * These are the app's quietest text and they are the largest failing class:
 * slate-400 on a white card is 2.63:1, on slate-100 2.40:1. Both are below
 * AA. One token cannot serve all four light surfaces AND all four dark ones
 * (light needs DARK ink, dark needs LIGHT ink), so each theme gets its own
 * value from its own surface list.
 *
 * `ink-muted` clears AA on every surface — it is what body-adjacent secondary
 * text becomes. `ink-subtle` is the de-emphasised tier (metadata, timestamps)
 * and is held to the LARGER surface set of the tinted chips.
 * ═══════════════════════════════════════════════════════════════════════ */
{
  const surfacesL = [L.white, L.slate50, L.slate100, L.blue50, L.emerald50, L.rose50, L.amber50]
  const surfacesD = [D.white, D.slate50, D.slate100, D.blue50, D.emerald50, D.rose50, D.amber50]
  const [sHue, sC] = rampAt('slate-400') ?? [247.9, 0.013]
  emit('ink-muted', solve(sHue, 0.55, -1, surfacesL, AA, NEUTRAL_C), solve(sHue, 0.62, +1, surfacesD, AA, NEUTRAL_C),
    surfacesL, surfacesD)
  // The tinted chips are the only place a lighter tier is tolerable, and only
  // on light cards — so the dark side stays pinned to the same tone as
  // `ink-muted` rather than inventing a second ladder that reads as noise.
  const subL = [L.white, L.slate50, L.slate100]
  const subD = [D.white, D.slate50, D.slate100]
  emit('ink-body', solve(sHue, 0.42, -1, subL, AA, NEUTRAL_C), solve(sHue, 0.78, +1, subD, AA, NEUTRAL_C), subL, subD)
}

/* ═══════════════════════════════════════════════════════════════════════
 * 2. STATUS INK ON A TINT — replaces `text-rose-600`, `text-emerald-600`,
 *    `text-blue-600`, `text-amber-600` when they sit on their own tint.
 *
 * `text-rose-600` on `bg-rose-50` is 4.10:1 — under AA by a hair, and on
 * `bg-rose-100` it is 3.75:1. The fix is a darker tone of the SAME hue so the
 * chip still reads as rose; graded against its own tint AND against white,
 * because `text-emerald-600` also appears bare on a white card (3.67:1).
 * ═══════════════════════════════════════════════════════════════════════ */
/*
 * The neutral panels are part of every semantic ink's surface set, not just its
 * own tint. `text-ink-warning` appears as a bare cell value on slate-100 table
 * rows (BillingReportsView, AnalyticsView) and as an icon on slate-50 panels,
 * with no amber tint anywhere near it — solving it against `[white, amber-50]`
 * alone produced #be5500, which is 4.27:1 on slate-100. tests/role-primitives.
 * test.ts grades neutrals PLUS the tint and caught it; this list is now the
 * same union, so the two cannot disagree about which surfaces an ink rides.
 */
const NEUTRAL_L = [L.white, L.slate50, L.slate100]
const NEUTRAL_D = [D.white, D.slate50, D.slate100]

{
  const spec = [
    ['ink-danger', 'rose-600', [...NEUTRAL_L, L.rose50, L.rose100], [...NEUTRAL_D, D.rose50, D.rose100]],
    ['ink-success', 'emerald-600', [...NEUTRAL_L, L.emerald50, L.emerald100], [...NEUTRAL_D, D.emerald50, D.emerald100]],
    // amber-100 is in the set: `bg-amber-100` chips are real
    // (AuditLogView, CaseDetailView, GeneralLedgerView group headers), and the
    // test grades them. Solving to only amber-50 landed ink-warning at 4.49:1
    // there — a rounding-width miss that any future tint change turns into a
    // real one.
    ['ink-warning', 'amber-600', [...NEUTRAL_L, L.amber50, L.amber100], [...NEUTRAL_D, D.amber50, D.amber100]],
    ['ink-info', 'blue-600', [...NEUTRAL_L, L.blue50, L.blue100], [...NEUTRAL_D, D.blue50, D.blue100]],
  ]
  for (const [name, token, sL, sD] of spec) {
    const [h, c] = rampAt(token) ?? [0, 0.16]
    emit(name, solve(h, 0.58, -1, sL, AA, c), solve(h, 0.68, +1, sD, AA, c), sL, sD)
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * 2b. BRAND INK ON THE ACCENT TINTS — replaces `text-brand-600` /
 *     `text-brand-700`.
 *
 * The accent cannot be walked the way a Tailwind ramp is, because the ramp
 * lives at RUNTIME: `applyBrandColor()` writes `--brand-*` from the user's
 * chosen accent. So this pair is declared, not derived — and that is exactly
 * why it belongs to this script. Hand-written, it drifted: the light half sat
 * at brand-600/700 while the dark half stayed on those same values, which
 * `.dark` had already remapped the surfaces UNDER them (text-brand-700 on
 * bg-brand-50 measured 1.60:1). Declared here, the pair is graded on every
 * run and `--check` fails if someone edits either file.
 *
 * LIGHT is SOLVED, not quoted. An earlier version took `--brand-600` /
 * `--brand-700` verbatim on the argument that the accent must not shift, and
 * grading it here is what disproved that: `ink-brand` at the stock indigo
 * measures 4.22:1 on `bg-brand-50`, below AA. Nothing else depends on that
 * value — `.bg-brand-600` is deliberately NOT aliased, so the 36 white-on-brand
 * buttons keep reading the raw swatch — which means walking the hue only moves
 * text-on-chip, which is exactly what was failing.
 *
 * DARK stays a named reading of the default accent. Walking the default hue at
 * the AA boundary lands on #919dff, a step more saturated than the shipped
 * value, and a user whose accent is NOT indigo would then get a colour solved
 * against the wrong ramp.
 * ═══════════════════════════════════════════════════════════════════════ */
{
  const brandL = [BRAND[50], BRAND[100], BRAND[200]].filter(Boolean)
  const brandD = [BRAND_D[50], BRAND_D[100], BRAND_D[200]]
  if (!BRAND[600] || !BRAND[700]) {
    failures.push('ink-brand: index.css :root declares no --brand-600/--brand-700')
  } else if (!brandL.length) {
    failures.push('ink-brand: index.css :root declares no --brand-50/100/200 to grade against')
  } else {
    // Walk down from the stock swatch, so an accent that already passes keeps
    // its own tone and only a failing one is nudged.
    const solveBrand = (hex) => {
      const { h, C, L } = oklchOf(hex)
      return solve(h, L, -1, brandL, AA, C)
    }
    emit('ink-brand', solveBrand(BRAND[600]), '#a5b4fc', brandL, brandD)
    emit('ink-brand-strong', solveBrand(BRAND[700]), '#c7d2fe', brandL, brandD)
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * 3. FILLS UNDER WHITE INK — replaces `bg-emerald-600`, `bg-rose-500`,
 *    `bg-emerald-500`, `bg-amber-500`.
 *
 * A fill is only ever graded against white ink, so this list is short and the
 * constraint is single. `bg-rose-500` is 3.76:1 under white and
 * `bg-emerald-600` is 3.67:1 — both below AA. Nudge down until they clear.
 *
 * EVERY FILL GETS A hover AND active STEP, and this is the part that was
 * missing. Three call sites write `hover:bg-rose-600` — a variant class — and
 * the utility alias (`.bg-rose-600 { background-color: var(--color-fill-*) }`)
 * cannot reach them: a bare class selector does not match `hover:`. So the
 * browser fell through to the raw palette, and `hover:bg-rose-600` painted
 * #ec003f, which is 4.33:1 under dark-theme white ink — below AA, and the
 * contrast audit reported 4.58 for it because IT resolved the variant through
 * the bare alias. A passing report on a colour that never reaches the screen.
 *
 * Solving the states here removes the guesswork: each step is one lightness
 * step down from its resting fill, re-graded against white ink, so it is
 * darker than rest (the point of a hover) AND still legible.
 * ═══════════════════════════════════════════════════════════════════════ */
{
  const spec = [
    ['danger', 'rose-500'],
    ['success', 'emerald-600'],
    ['warning', 'amber-500'],
  ]
  for (const [role, token] of spec) {
    const [h, c, startL] = rampAt(token) ?? [0, 0.16, 0.6]
    // Same tone both themes: a saturated fill is a brand surface, not a role
    // that inverts. Only the INK it carries changes, and that is `text-white`
    // (already pinned per theme). Splitting the fill by role means it never
    // has to be re-pinned again.
    const base = walk(h, startL, -1, [WHITE_INK_LIGHT, WHITE_INK_DARK], AA, c)
    if (!base) {
      failures.push(`fill-${role}: solver found no tone`)
      continue
    }
    emit(`fill-${role}`, base.hex, base.hex, [WHITE_INK_LIGHT], [WHITE_INK_DARK])

    // hover and active walk further down the same hue. Grade each against
    // white ink independently rather than assuming the darker step inherits
    // the resting one — that assumption is what let 4.33:1 through.
    for (const [state, dir] of [['hover', -1], ['active', -1]]) {
      const steps = state === 'hover' ? 16 : 30 // ~0.04 / ~0.075 in L
      const tone = walk(h, base.L + (dir * steps * 0.0025), dir,
        [WHITE_INK_LIGHT, WHITE_INK_DARK], AA, c)
      if (!tone) {
        failures.push(`fill-${role}-${state}: solver found no tone`)
        continue
      }
      emit(`fill-${role}-${state}`, tone.hex, tone.hex, [WHITE_INK_LIGHT], [WHITE_INK_DARK])
    }
  }
}

/* ------------------------------------------------------------------- output */

/** One declaration per role token, at the given indentation. */
const lines = (theme, indent) =>
  out.map((r) => `${indent}--color-${r.name}: ${theme === 'light' ? r.light : r.dark};`)

const ROLE_LINE = /^\s*(--color-(?:ink|fill)-[a-z]+(?:-[a-z]+)?):\s*[^;]+;\s*$/

/**
 * Replace the role declarations in a CSS file, one line at a time.
 *
 * The earlier version replaced everything between the FIRST and LAST role
 * line. That is safe only if the block is nothing but generated declarations —
 * and it is not. index.css interleaves hand-written prose (the accent
 * rationale) and a separate `--brand-*` block between them, so `--write`
 * silently deleted both. It also dropped every token the file had but the
 * script did not, which is a different bug with the same shape.
 *
 * So this walks each role line, looks the token up by NAME, and either
 * rewrites the value in place or — for a token this script no longer emits —
 * leaves the line alone and reports it, because deleting a declaration someone
 * wrote by hand is not this script's call. New tokens are inserted after the
 * last role line, so the generated set still converges on the solver.
 *
 * Returns `{ text, changed, found, orphans }`; `found` is false when the file
 * has no role block at all, which the caller treats as an error.
 */
function regenerate(css, theme, indent) {
  // `core.autocrlf=true` makes every `git checkout` rewrite these files with
  // CRLF, and this check compares generated lines byte-for-byte. A trailing
  // `\r` is not token drift, so normalize before comparing — otherwise the
  // check fails permanently on Windows after any checkout, and `--write` would
  // "fix" it by rewriting the whole file's endings. The file's own endings are
  // restored on write so a CRLF checkout stays CRLF.
  const hadCrlf = css.includes('\r\n')
  css = css.replace(/\r\n/g, '\n')
  const srcLines = css.split('\n')
  const byName = new Map(out.map((r) => [r.name, theme === 'light' ? r.light : r.dark]))
  const orphans = []
  const seen = new Set()
  let last = -1
  let changed = false

  const next = srcLines.map((line, i) => {
    const m = ROLE_LINE.exec(line)
    if (!m) return line
    last = i
    const name = m[1].replace('--color-', '')
    if (!byName.has(name)) {
      orphans.push(name)
      return line
    }
    if (seen.has(name)) {
      // A duplicate from an earlier bad write. Keep the first, drop the rest,
      // and say so — a lone duplicate paints nothing and reads as a second
      // definition of the same token.
      changed = true
      return null
    }
    seen.add(name)
    const want = `${indent}${m[1]}: ${byName.get(name)};`
    if (want === line) return line
    changed = true
    return want
  })

  if (last === -1) return { text: css, changed: false, found: false, orphans }

  // Tokens the solver emits that the file never had. Appended after the last
  // role line so the block stays contiguous in both files.
  const missing = out.filter((r) => !seen.has(r.name))
  if (missing.length) {
    changed = true
    const add = lines(theme, indent).filter((l) =>
      missing.some((r) => l.includes(`--color-${r.name}:`)),
    )
    next.splice(last + 1, 0, ...add)
  }

  const text = next.filter((l) => l !== null).join('\n')
  return {
    // Only a REAL edit counts as changed. On an unchanged file the original
    // bytes are returned untouched, so a CRLF checkout is never rewritten just
    // because it is checked.
    text: text === css ? css : hadCrlf ? text.replace(/\n/g, '\r\n') : text,
    changed: changed || text !== css,
    found: true,
    orphans,
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * ALIAS RULES — generated too, and this is the load-bearing half.
 *
 * The declarations above are only useful because eleven hand-written rules
 * repoint the two-hats utilities at them. Those rules were authored by hand,
 * which made them the one part of the split a contributor could quietly get
 * wrong: a new semantic colour gets its `--color-ink-*` declaration solved,
 * passes every check, and still paints as raw palette because nobody added
 * the alias. So the alias table lives here, beside the solver, and every rule
 * — including the STATE variants — is emitted from it.
 *
 * The variants are the point. `hover:bg-rose-600` appears at three call sites
 * (BrandingTab logo-removal buttons, WindowControls close). `.bg-rose-600`
 * does not match a `hover:` class, so without an explicit variant rule those
 * three buttons painted raw #ec003f — 4.33:1 under dark-theme white ink, below
 * AA. Generating `hover:`/`focus-visible:`/`active:` rules alongside each
 * alias closes the class of bug structurally rather than by adding one more
 * rule to remember.
 *
 * Every variant is graded by the same solve path as its resting tone (see
 * section 3), so a hover fill is both visibly darker and still AA under the
 * white ink it carries.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Utility → role token, per property. Order is the emission order in the file.
 * `ink` rules set `color`, `fill` rules set `background-color`.
 */
const ALIASES = [
  { util: 'text-slate-400', prop: 'color', token: '--color-ink-muted' },
  { util: 'text-slate-500', prop: 'color', token: '--color-ink-body' },
  { util: 'text-rose-600', prop: 'color', token: '--color-ink-danger' },
  { util: 'text-emerald-600', prop: 'color', token: '--color-ink-success' },
  { util: 'text-blue-600', prop: 'color', token: '--color-ink-info' },
  { util: 'text-amber-600', prop: 'color', token: '--color-ink-warning' },
  // The accent's ink half. `.bg-brand-600` is deliberately absent — it is the
  // fill under white ink at 36 call sites, and aliasing it to the brand ink
  // would put dark ink on a saturated slab.
  { util: 'text-brand-600', prop: 'color', token: '--color-ink-brand' },
  { util: 'text-brand-700', prop: 'color', token: '--color-ink-brand-strong' },
  { util: 'bg-rose-500', prop: 'background-color', token: '--color-fill-danger' },
  { util: 'bg-rose-600', prop: 'background-color', token: '--color-fill-danger' },
  { util: 'bg-emerald-500', prop: 'background-color', token: '--color-fill-success' },
  { util: 'bg-emerald-600', prop: 'background-color', token: '--color-fill-success' },
  { util: 'bg-amber-500', prop: 'background-color', token: '--color-fill-warning' },
  // Hover/active FILLS point at their own solved step, so a hovered button is
  // darker than it was at rest — which is what makes the hover legible — and
  // the white ink on it still clears AA.
  { util: 'hover:bg-rose-600', prop: 'background-color', token: '--color-fill-danger-hover' },
  { util: 'hover:bg-rose-500', prop: 'background-color', token: '--color-fill-danger-hover' },
  { util: 'hover:bg-emerald-600', prop: 'background-color', token: '--color-fill-success-hover' },
  { util: 'hover:bg-emerald-500', prop: 'background-color', token: '--color-fill-success-hover' },
  { util: 'hover:bg-amber-500', prop: 'background-color', token: '--color-fill-warning-hover' },
  { util: 'active:bg-rose-600', prop: 'background-color', token: '--color-fill-danger-active' },
  { util: 'active:bg-rose-500', prop: 'background-color', token: '--color-fill-danger-active' },
  { util: 'active:bg-emerald-600', prop: 'background-color', token: '--color-fill-success-active' },
  { util: 'active:bg-emerald-500', prop: 'background-color', token: '--color-fill-success-active' },
  { util: 'active:bg-amber-500', prop: 'background-color', token: '--color-fill-warning-active' },
]

/** `.hover\:bg-rose-600:hover` — a Tailwind-style variant needs escaping. */
function aliasSelector(util) {
  if (!util.includes(':')) return `.${util}`
  const [variant, base] = util.split(':')
  if (variant === 'group-hover') return `.group:hover .group-hover\\:${base}`
  return `.${variant}\\:${base}:${variant}`
}

/** The generated alias block, ready to splice into index.css. */
function aliasBlock() {
  const rules = ALIASES.map((a) => {
    const sel = aliasSelector(a.util)
    const indent = a.util.includes(':') ? '  ' : ''
    return `${sel} {\n${indent}  ${a.prop}: var(${a.token});\n${indent}}`
  })
  return rules.join('\n')
}

/**
 * Replace the contiguous run of alias rules in a CSS file.
 *
 * Detection is anchored on the rule BODY, not the selector. An earlier
 * version matched `^\.(hover|…)?\\?(text|bg)-[a-z]+-\d{2,3}…\{$` and that
 * regex matched NOTHING — the generated variants carry a `\:` escape and a
 * trailing `:hover`, neither of which the pattern spelled correctly. With no
 * selector matched there were no indices, so the code quietly fell through and
 * `--write` APPENDED a second copy of the block below the real one while
 * `--check` reported drift that `--write` then "fixed" forever. A selector
 * pattern that fails to match is the worst possible failure mode here: it
 * looks like drift, not like a bug in the matcher.
 *
 * So: any top-level rule whose body references `var(--color-ink-` or
 * `var(--color-fill-)` IS an alias rule, by definition. That is the property
 * the generated block actually has, it needs no maintenance when a variant is
 * added to ALIASES, and it cannot silently match nothing.
 */
const ROLE_REF = /var\(--color-(?:ink|fill)-/

/** Index ranges [start, end] of the top-level rules that wire a role token. */
function aliasRuleRanges(lines) {
  const ranges = []
  for (let i = 0; i < lines.length; i++) {
    // Top-level rule opening: starts in column 0 and opens a block. The
    // generated block is entirely unindented, which is what separates it from
    // the `:root` declaration block just above (2-space indent).
    if (!/^\S[^{]*\{\s*$/.test(lines[i])) continue
    let end = i
    while (end < lines.length && lines[end].trim() !== '}') end++
    if (end >= lines.length) break // unterminated rule; stop rather than guess
    if (ROLE_REF.test(lines.slice(i, end + 1).join('\n'))) ranges.push([i, end])
    i = end
  }
  return ranges
}

/** Is this line blank, or part of a `/* … *\/` comment? */
const isFiller = (l) => {
  const t = l.trim()
  return t === '' || t.startsWith('/*') || t.startsWith('*') || t.endsWith('*/')
}

/** Drop `/* … *\/` comments so a span can be checked for foreign rules. */
const withoutComments = (arr) => {
  let inComment = false
  return arr.filter((l) => {
    const t = l.trim()
    if (inComment) {
      if (t.endsWith('*/')) inComment = false
      return false
    }
    if (t.startsWith('/*') && !t.endsWith('*/')) {
      inComment = true
      return false
    }
    return t !== '' && !(t.startsWith('/*') && t.endsWith('*/'))
  })
}

function regenerateAliases(css) {
  // Same CRLF reasoning as regenerate(): an autocrlf checkout must not read as
  // alias drift, and an unchanged file must keep its own line endings.
  const hadCrlf = css.includes('\r\n')
  css = css.replace(/\r\n/g, '\n')
  const srcLines = css.split('\n')
  const ranges = aliasRuleRanges(srcLines)
  if (ranges.length === 0) return { text: css, changed: false, found: false }

  // The generated block is ONE span from the first alias rule to the last,
  // INCLUDING any comment between them — the `.bg-brand-600` note sits between
  // the ink rules and the fill rules, so a run-based split saw two runs and
  // rewrote only the second, duplicating the first.
  const a = ranges[0][0]
  const b = ranges[ranges.length - 1][1]

  // Guard the span. Comments and blank lines may legitimately live inside it,
  // but an unrelated RULE must not: replacing across one would delete it.
  const covered = new Set()
  for (const [s, e] of ranges) for (let i = s; i <= e; i++) covered.add(i)
  const foreign = []
  srcLines.slice(a, b + 1).forEach((l, k) => {
    if (!isFiller(l) && !covered.has(a + k)) foreign.push(`${a + k + 1}: ${l.trim()}`)
  })
  if (foreign.length) {
    return { text: css, changed: false, found: false, blocked: foreign }
  }

  const next = [...srcLines.slice(0, a), ...aliasBlock().split('\n'), ...srcLines.slice(b + 1)]
  const text = next.join('\n')
  if (text === css) return { text: css, changed: false, found: true }
  return { text: hadCrlf ? text.replace(/\n/g, '\r\n') : text, changed: true, found: true }
}

const TARGETS = [
  { file: join(ROOT, 'src', 'index.css'), theme: 'light', indent: '  ', label: 'src/index.css :root' },
  { file: join(ROOT, 'src', 'theme', 'dark.css'), theme: 'dark', indent: '    ', label: 'src/theme/dark.css .dark' },
]

if (MODE === 'print') {
  console.log(`✓ ${out.length} role primitives, worst case ${Math.min(...out.map((r) => r.worst)).toFixed(2)}:1\n`)
  console.log('/* index.css :root */')
  for (const l of lines('light', '  ')) console.log(l)
  console.log('\n/* dark.css .dark */')
  for (const l of lines('dark', '    ')) console.log(l)
  console.log('\nrun `node scripts/role-picker.mjs --write` to apply, or --check to gate CI')
}

if (MODE === 'write' || MODE === 'check') {
  const drifted = []
  for (const t of TARGETS) {
    const current = readFileSync(t.file, 'utf8')
    const res = regenerate(current, t.theme, t.indent)
    if (!res.found) {
      console.error(`✗ ${t.label} has no --color-ink-* / --color-fill-* block to update`)
      process.exit(2)
    }
    if (res.changed) drifted.push({ ...t, current })
    if (res.orphans.length) {
      // Left in place on purpose. A `--color-ink-*` / `--color-fill-*` the
      // solver does not emit is either a token this script lost track of or a
      // hand-written one; either way `--write` must not delete it silently.
      console.warn(
        `⚠ ${t.label}: ${res.orphans.length} role declaration(s) this script does not ` +
          `emit, left untouched: ${[...new Set(res.orphans)].join(', ')}`,
      )
    }
    if (MODE === 'write' && res.changed) writeFileSync(t.file, res.text, 'utf8')
  }
  if (MODE === 'write') {
    console.log(
      drifted.length
        ? `✓ rewrote ${drifted.length} block(s): ${drifted.map((d) => d.label).join(', ')}`
        : '✓ both blocks already match the solver',
    )
  } else if (drifted.length) {
    console.error(
      `✗ ${drifted.length} role block(s) have drifted from the solver:\n` +
        drifted.map((d) => `    ${d.label}`).join('\n') +
        '\n\n  run `node scripts/role-picker.mjs --write` (npm run role:write)',
    )
    process.exit(1)
  } else {
    console.log('✓ role primitives in index.css and dark.css match the solver')
  }

  // The alias rules are a separate target: index.css only. They are what make
  // the solved tokens actually reach the screen, so they drift just as silently
  // as the declarations did.
  const CSS = TARGETS[0]
  const current = readFileSync(CSS.file, 'utf8')
  const aliasRes = regenerateAliases(current)
  if (aliasRes.blocked) {
    // Refusing is the point: the generated span runs from the first alias rule
    // to the last, so a hand-written rule parked in between would be deleted.
    console.error(
      '✗ the alias block in src/index.css contains rules this script did not\n' +
        '  generate. It rewrites that whole span, so it will not touch the file\n' +
        '  until they move above or below it:\n' +
        aliasRes.blocked.map((l) => `    ${l}`).join('\n'),
    )
    process.exit(2)
  }
  if (!aliasRes.found) {
    console.error('✗ src/index.css has no alias rule block to regenerate')
    process.exit(2)
  }
  if (MODE === 'write' && aliasRes.changed) writeFileSync(CSS.file, aliasRes.text, 'utf8')
  if (MODE === 'write') {
    console.log(aliasRes.changed
      ? `✓ rewrote the alias rules in ${CSS.label}`
      : '✓ alias rules already match the table')
  } else if (aliasRes.changed) {
    console.error(
      '✗ src/index.css alias rules have drifted from the ALIASES table in\n' +
        '  scripts/role-picker.mjs. Either re-run `npm run role:write`, or — if a\n' +
        '  rule was edited by hand — add it to ALIASES so it survives the next write.\n\n' +
        '  An alias that is missing here is not a cosmetic gap: the utility falls\n' +
        '  through to the raw palette colour and the solved token never paints.',
    )
    process.exit(1)
  } else {
    console.log('✓ alias rules in index.css match the picker table')
  }
}

if (failures.length) {
  console.error('\n✗ UNRESOLVED — the solver could not satisfy every surface:')
  for (const f of failures) console.error(`  ${f}`)
  process.exit(1)
}