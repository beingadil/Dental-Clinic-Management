/**
 * WCAG contrast audit over the tokens the app ACTUALLY uses.
 *
 * WHY THIS IS NOT A TOKEN LINTER
 * The dark theme is a remap of ~2,969 utility call sites, so a contrast
 * failure cannot be found by reading one component — it lives in the PAIRING
 * of two utilities. `bg-slate-50 text-slate-900` is fine on white and may be
 * invisible on a remapped dark canvas. So this script does not grade tokens in
 * isolation. It mines the real class strings out of src/, resolves each to the
 * colour it will ACTUALLY paint in each theme, and reports every bg>text
 * pairing that appears in the source and fails WCAG AA.
 *
 * WHERE THE COLOURS COME FROM — all three layers are read, not assumed:
 *   1. light tokens   ← the Tailwind SOURCE (theme.css + index.css). Reading
 *      the source rather than `dist/` means the audit needs no prior build; see
 *      scripts/light-palette.mjs for the equivalence check against the
 *      compiled output. Tailwind v4 declares `--color-slate-*` in an `@theme`
 *      block, so this is the real palette rather than a guess at v4's defaults.
 *   2. dark tokens    ← src/theme/dark.css, the `.dark` remap block.
 *   3. role overrides ← the `.dark .bg-*` / `.dark .text-*` rules at the
 *      bottom of dark.css. These sit ABOVE both token sets and exist exactly
 *      for utilities whose value is a token shared with the opposite role
 *      (`bg-white` the surface vs `text-white` the ink), so they must win.
 *
 * Usage: node scripts/contrast-audit.mjs
 * Exits 1 if any pairing fails, so it can gate CI. Needs no build step.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
// Shared with scripts/role-picker.mjs and scripts/ink-picker.mjs: one reader,
// one source list, so the audit and the solvers can never disagree about what
// the palette is. See that file for why the source is read instead of `dist/`.
import { lightPalette } from './light-palette.mjs'

// fileURLToPath, not `new URL(..).pathname`: the workspace path contains
// spaces, which pathname leaves percent-encoded and fs cannot open.
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')

/* ----------------------------------------------------------------- parsing */

/**
 * Turn a raw `[^{}]+` capture into the selector it actually names.
 *
 * Two artefacts have to be removed, both of which silently drop whole blocks
 * when they survive:
 *
 *  1. LEADING AT-RULE STATEMENTS. `@import "./theme/dark.css";` has no braces,
 *     so the scan glues it onto the front of the next block's "selector" and
 *     `index.css`'s first `:root` arrives as `@import … :root`. Every matcher
 *     here is anchored (`/^:root$/`, `/^\.dark \./`), so the block is dropped
 *     without a word — which is how all five `--brand-*` tokens, and with them
 *     five `bg-brand-*` pairings, went ungraded and were reported as gaps.
 *  2. A STRAY `}` from a nested at-rule. The compiled bundle contains
 *     `@media(…){ .dark .x{…} }`, matched as an empty at-rule block with the
 *     INNER rule captured and the media query's closing brace left at the front
 *     of the next capture, so the selector reads `}:root` instead of `:root`.
 *
 * Hence: delete statements first, then take only what follows the last `}`.
 */
function selectorOf(rawSel) {
  const stripped = rawSel.replace(/@[a-z-]+[^;{]*;/gi, '')
  return stripped.slice(stripped.lastIndexOf('}') + 1).trim()
}

/**
 * Every `--name: <hex|rgb()>` declaration in the CSS, keyed by name, for all
 * blocks whose selector passes `matches`. Later blocks overwrite earlier ones,
 * which is the correct precedence for a cascade of overrides.
 */
function tokensFrom(css, matches) {
  const out = {}
  const blocks = stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)
  for (const [, rawSel, body] of blocks) {
    const sel = selectorOf(rawSel)
    if (!matches(sel)) continue
    for (const d of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      const value = d[2].trim()
      if (/^#|^(?:rgb|rgba|oklch|color)\(/i.test(value)) out[d[1]] = value
      // `@theme inline` emits `--color-brand-600: var(--brand-600)`; follow the
      // indirection onto the runtime brand token or the brand utilities would
      // all resolve to nothing and be silently skipped as gaps.
      else {
        const v = /^var\((--[a-z0-9-]+)\)$/i.exec(value)
        if (v) out[d[1]] = `ref:${v[1]}`
      }
    }
  }
  return out
}

/** Follow `ref:` indirections within a token map (one hop is enough here). */
function deref(map, key) {
  const v = map[key]
  if (typeof v === 'string' && v.startsWith('ref:')) return map[v.slice(4)] ?? null
  return v ?? null
}

/**
 * Strip comments BEFORE block parsing.
 *
 * This is not cosmetic. `dark.css` explains each override with a comment
 * directly above it, and `[^{}]+\{` happily swallows that comment text into the
 * captured "selector". The selector then fails `.dark .` prefix matching and the
 * override is silently dropped from the audit — which reads as a contrast bug
 * that does not exist in the browser, because the browser discards comments
 * too. Strip them here so the audit sees what the cascade sees.
 */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Top-level CSS blocks, WITH brace depth.
 *
 * `tokensFrom`'s `[^{}]+` scan cannot read Tailwind's own `theme.css`: the
 * `@theme default { … }` block has `@keyframes spin { to { … } }` nested inside
 * it, so the flat scan matches the INNER keyframe rules and throws the palette
 * away. Measured on the current tree, that drops 114 of the 288 `--color-*`
 * tokens — and the audit does not notice, because every token it fails to read
 * simply becomes a "gap" row rather than an error. It only surfaced when
 * building the palette from source exposed the shortfall.
 *
 * So this returns each top-level block's selector, body, and depth, and the
 * caller decides what to keep. Keyframe steps come back at depth 2 and are
 * ignored, while the palette arrives intact at depth 1.
 */
function topLevelBlocks(css) {
  const out = []
  let depth = 0
  let open = -1
  // Index just past the end of the previous top-level block. The selector of
  // the next block is everything from there to its `{`.
  let selStart = 0
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch === '{') {
      if (depth === 0) open = i + 1
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && open >= 0) {
        out.push({ sel: css.slice(selStart, open - 1).replace(/;\s*$/, '').trim(), body: css.slice(open, i), depth: 1 })
        open = -1
        selStart = i + 1
      }
    }
  }
  return out
}

const lightTokens = lightPalette()

if (!Object.keys(lightTokens).some((k) => k.startsWith('--color-'))) {
  console.error('No `--color-*` tokens found. Expected node_modules/tailwindcss/theme.css (the v4 palette) and src/index.css. Run `npm ci` if node_modules is missing.')
  process.exit(2)
}

const darkCss = readFileSync(join(SRC, 'theme', 'dark.css'), 'utf8')
// The `.dark` remap block.
const darkTokens = tokensFrom(darkCss, (s) => /(^|\s)\.dark\s*$/.test(s))

/*
 * The brand accent. `@theme inline` inlines the var at the utility, so Tailwind
 * never emits `--color-brand-600` on `:root` and every `bg-brand-*` pairing
 * fell through as an unresolvable gap — five call sites silently ungraded,
 * including the paid badge. The defaults ARE written by hand in index.css
 * `:root` (the indigo swatch, so the app is correct before boot applies a
 * stored choice), so read them from there.
 *
 * The accent is NOT wholly theme-independent. `applyBrandColor()` writes the
 * same five values on boot, but the `.dark` block RE-DEFINES `--brand-50`,
 * `--brand-100` and `--brand-200` as dark surfaces — the pale swatches have no
 * business being a page background in a dark UI. So the 50–200 steps are
 * resolved per theme and only the saturated 600/700 fills are shared.
 *
 * Reading the light map for every brand utility (as this once did) graded a
 * dark-mode `bg-brand-50` as pale indigo, and every translucent child of a
 * brand surface came out with a light backdrop and a confident fake number
 * attached — two false failures in JournalEntryModal before this was fixed.
 */
const brandTokens = (() => {
  const src = readFileSync(join(SRC, 'index.css'), 'utf8')
  const out = {}
  for (const [, rawSel, body] of stripComments(src).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = selectorOf(rawSel)
    if (!/(^|,)\s*:root\s*$/.test(sel)) continue
    for (const d of body.matchAll(/(--brand-\d+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[d[1]] = d[2]
  }
  return out
})()
const BRAND = (util, theme = 'light') => {
  const key = `--brand-${util.slice(util.lastIndexOf('-') + 1)}`
  if (theme === 'dark') return darkTokens[key] ?? brandTokens[key] ?? null
  return brandTokens[key] ?? null
}

/**
 * Role overrides: the hand-pinned `.dark .bg-*` / `.dark .text-*` rules. Keyed
 * by the bare utility name, because that is how they are authored and how they
 * are matched against a mined className.
 */
function roleOverrides() {
  const out = {}
  for (const [, rawSel, body] of stripComments(darkCss).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = selectorOf(rawSel)
    if (!selector.startsWith('.dark .')) continue
    // Only single-utility selectors, no `hover`/`group-hover` variants.
    const cls = selector.slice('.dark .'.length)
    if (!/^(bg|text)-(white|black|[a-z]+-\d{2,3})$/.test(cls)) continue
    for (const d of body.matchAll(/(?:background-color|color)\s*:\s*([^;]+);/g)) {
      out[cls] = d[1].trim()
    }
  }
  return out
}
const overrides = roleOverrides()

/**
 * Role ALIASES: the unlayered utility rules in index.css that repoint a
 * two-hats utility at an ink/fill primitive.
 *
 *   .text-slate-400 { color: var(--color-ink-muted); }
 *   .bg-rose-600    { background-color: var(--color-fill-danger); }
 *
 * These are unlayered, so they outrank the generated Tailwind utilities at equal
 * specificity — they are what the browser actually paints in BOTH themes, since
 * `.dark` only ever redefines the primitive's VALUE rather than re-pinning the
 * utility. Resolving `text-slate-400` to `--color-slate-400` instead would
 * grade a colour that never reaches the screen: the audit reported the ink/fill
 * split as passing while measuring the palette values it had replaced, which is
 * the same silent-gap failure as an unresolved token, just with a plausible
 * number attached.
 *
 * Keyed by the FULL utility name INCLUDING any variant prefix, so
 * `hover:bg-rose-600` and `bg-rose-600` are separate entries.
 *
 * That distinction is the whole point. The rules were previously keyed by the
 * bare utility, which meant the variant selectors were either dropped (this
 * filter rejected them) or folded into the resting entry — and since `.dark`
 * re-pins nothing for them, a hover pairing was graded against the RESTING
 * token. `hover:bg-rose-600` reported 4.58:1 on the strength of
 * `--color-fill-danger` while the browser painted raw palette #ec003f, which is
 * 4.33:1. The variant is a separate colour with its own solved step
 * (`--color-fill-danger-hover`), generated by scripts/role-picker.mjs; it has to
 * be read under its own key or the audit grades a colour that never reaches the
 * screen.
 */
function roleAliases() {
  const src = readFileSync(join(SRC, 'index.css'), 'utf8')
  const out = {}
  for (const [, rawSel, body] of stripComments(src).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // `.hover\:bg-rose-600:hover` → `hover:bg-rose-600`. The escaped colon is
    // unescaped first so one pattern covers both spellings.
    const cls = selectorOf(rawSel)
      .replace(/^\./, '')
      .replace(/\\/g, '')
      .replace(/:(?:hover|active|focus|focus-visible|focus-within)$/, '')
    // Unlayered and unscoped by anything OTHER than the interaction variant:
    // a `.dark` or media-scoped rule here is theme- or viewport-dependent,
    // which the flat map cannot represent.
    if (!/^(?:(?:hover|focus|focus-visible|active|group-hover):)?(?:bg|text)-(?:white|black|[a-z]+-\d{2,3})$/.test(cls)) continue
    const v = /(?:background-color|color)\s*:\s*var\((--[a-z0-9-]+)\)\s*;/.exec(body)
    if (v) out[cls] = v[1]
  }
  return out
}
const aliases = roleAliases()

/* ----------------------------------------------------------------- colour */

function toRgb(value) {
  const s = String(value).trim()
  let m = /^#([0-9a-f]{3,8})$/i.exec(s)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  // Tailwind v4 emits its whole palette as oklch(), so this is the common case,
  // not an edge case. Convert via OKLab: oklch -> oklab -> LMS -> linear sRGB.
  m = /^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)/i.exec(s)
  if (m) {
    const L = Number(m[1]) / 100
    const C = Number(m[2])
    const hDeg = Number(m[3])
    const hRad = (hDeg * Math.PI) / 180
    const a = C * Math.cos(hRad)
    const bb = C * Math.sin(hRad)
    const lp = L + 0.3963377774 * a + 0.2158037573 * bb
    const mp = L - 0.1055613458 * a - 0.0638541728 * bb
    const sp = L - 0.0894841775 * a - 1.291485548 * bb
    const l3 = lp * lp * lp
    const m3 = mp * mp * mp
    const s3 = sp * sp * sp
    const lr = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
    const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
    const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3
    return [lr, lg, lb].map((v) => {
      const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055
      return Math.min(255, Math.max(0, c * 255))
    })
  }
  return null
}

function luminance(value) {
  const rgb = toRgb(value)
  if (!rgb) return null
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  if (la === null || lb === null) return null
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/* ------------------------------------------------- mine real class strings */

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(tsx?|jsx?)$/.test(name)) acc.push(p)
  }
  return acc
}

const files = walk(SRC)

/**
 * A class is: optional interaction state, a `bg`/`text` kind, and either a
 * named colour (`white`, `black`, `transparent`) or a `hue-step` pair.
 *
 * `transparent` is rejected by the caller: it paints nothing, so there is no
 * contrast to grade.
 */
const STATE = '(?:(hover|focus|focus-visible|active|visited|disabled|group-hover|dark|focus-within):)?'
const COLOUR_UTIL = new RegExp(
  `^${STATE}(bg|text)-(?:(white|black|transparent)|(?:(?:([a-z]+)-))?(\\d{2,3}))(?:\\/(\\d{1,3}))?$`,
)

/**
 * The surface a translucent utility is composited over.
 *
 * `bg-indigo-400/10` is not a solid indigo slab — it is a 10% wash on the
 * card behind it, and grading it as solid produced the worst false positives
 * in an earlier run (`bg-amber-400 > text-amber-300` at 1.19:1, when the
 * element is in fact a near-invisible amber tint behind light amber text and
 * passes comfortably). A tint is only judgeable against its backdrop, so both
 * themes need one: the light card is white, the dark card is `--color-white`
 * as the remap redefines it.
 */
const BACKDROP = {
  light: '#ffffff',
  dark: null, // resolved from darkTokens below, once that map exists.
}

/* There is deliberately NO hand-maintained parent-surface table here any more.
 * The backdrop for a translucent utility is derived from the markup by
 * jsxElementsWithBackground()/ancestorBackgroundAt() below, so a new
 * translucent chip on a non-standard parent is graded correctly the moment it
 * is written, with no annotation to add and none to keep in sync. */

/** Blend a possibly-translucent colour over its theme backdrop. */
function composite(value, alpha, backdrop) {
  if (alpha === undefined || alpha >= 100) return value
  const fg = toRgb(value)
  const bg = toRgb(backdrop)
  if (!fg || !bg) return value
  const a = alpha / 100
  const [r, g, b] = fg.map((v, i) => Math.round(v * a + bg[i] * (1 - a)))
  return `rgb(${r} ${g} ${b})`
}

/** Utility name → `--color-<name>`, e.g. `bg-slate-900` → `--color-slate-900`. */
const tokenOf = (util) => `--color-${util.slice(util.startsWith('bg-') ? 3 : 5)}`

/**
 * Parse one class token into `{ state, kind, util }`, or null if it is not a
 * background/text colour utility.
 */
function parseClass(c) {
  const m = COLOUR_UTIL.exec(c)
  if (!m) return null
  const [, state, kind, named, hue, step, alpha] = m
  const tail = named ?? (hue ? `${hue}-${step}` : step)
  if (!tail || tail === 'transparent') return null
  return { state: state ?? '', kind, util: `${kind}-${tail}`, alpha: alpha === undefined ? undefined : Number(alpha) }
}

/**
 * Mine the pairings that can actually reach the screen.
 *
 * THE MODEL — this is the whole point of the two-state version.
 *
 * An element's effective background and effective foreground each resolve
 * independently by interaction state: if `hover:bg-*` is present it wins on
 * hover, otherwise the base `bg-*` stays. So for a class list with base and
 * hover variants there are exactly TWO real renderings, not a cross-product:
 *
 *   bg-slate-100 hover:bg-slate-700 hover:text-white text-slate-700
 *   resting: bg-slate-100 × text-slate-700
 *   hover:   bg-slate-700 × text-white
 *
 * An earlier run discarded the state prefixes and cross-productped all four
 * classes, inventing `bg-slate-700 × text-slate-700` (1.00:1) — a pairing the
 * browser never renders. That is the failure mode worth guarding: a report
 * full of vivid false positives buries the real ones.
 */
function* renderings(classes) {
  const baseBg = classes.find((c) => c.kind === 'bg' && c.state === '')
  const baseFg = classes.find((c) => c.kind === 'text' && c.state === '')
  for (const st of ['', 'hover', 'focus', 'focus-visible', 'active']) {
    // `state` is stored WITHOUT the colon (the regex keeps it outside the
    // capture), so compare against the bare state — not `${st}:`. Matching
    // with the colon silently missed every variant class, which meant hover
    // and active pairs such as `active:bg-indigo-800 text-white` were never
    // mined at all: a whole class of regression was invisible to this report.
    const bg = (st && classes.find((c) => c.kind === 'bg' && c.state === st)) || baseBg
    const fg = (st && classes.find((c) => c.kind === 'text' && c.state === st)) || baseFg
    if (!bg || !fg) continue
    // A state with NO variant of its own renders identically to rest, so
    // emitting it too filed every resting pair once per state — `bg-amber-500
    // > text-white` appeared five times, and a fix could not be told apart
    // from its four identical twins. Only a state that actually CHANGES a
    // colour gets a row of its own.
    if (st && bg === baseBg && fg === baseFg) continue
    yield { bg, fg, state: st || 'rest' }
  }
}

/**
 * The hover/active variants the earlier version silently dropped.
 *
 * `renderings()` already resolved a separate rendering per state, but the
 * caller keyed pairings on `bg|fg` ALONE, so `hover:bg-rose-700 text-white`
 * collapsed into the same row as its resting counterpart and the verdict was
 * whichever happened to be computed first. Interaction states are where
 * contrast regressions actually hide — a chip whose resting fill passes and
 * whose hover fill fails is invisible until someone hovers it — so the state
 * is now part of the identity of a row and each state is graded on its own.
 *
 * The state used for grading is the one that produced the pair: a hover-only
 * variant is judged as a hover rendering, never as a resting one.
 */
const GRADED_STATES = ['rest', 'hover', 'focus', 'focus-visible', 'active']

/**
 * Is this class list a DISABLED control?
 *
 * WCAG 1.4.3 exempts "inactive user interface components" from the contrast
 * minimum, because the user cannot act on them. Three real sites depend on
 * that exemption and were being filed as regressions:
 *   ConfirmDialog.tsx:71  `bg-slate-300 cursor-not-allowed` + `text-white`
 *   TestingTab.tsx:265   `bg-slate-200 text-slate-400 cursor-not-allowed`
 *   DatePickerSingle     out-of-range days, `text-slate-300` + `cursor-pointer`
 *
 * The marker is read from the SAME className list, never from a guess about
 * the file. `cursor-not-allowed` is the app's consistent disabled signal;
 * `aria-disabled`/`disabled:` variants are accepted too.
 */
function isDisabledList(cls) {
  return /(^|\s)(cursor-not-allowed|aria-disabled)(\s|$)/.test(cls) ||
    /(^|\s)disabled:/.test(cls)
}

const pairings = new Map()

/**
 * Recover every full className list from a file, INCLUDING ones split across
 * template-literal branches.
 *
 * The naive approach — regex each quoted string and pair within it — silently
 * loses pairs whenever the classes live in different string fragments. The
 * app writes these constantly:
 *
 *   className={`px-4 py-2 text-white ${
 *     isDanger ? 'bg-rose-600 active:bg-rose-800' : 'bg-brand-600'
 *   }`}
 *
 * Here `text-white` and `active:bg-rose-800` are the element's real class list,
 * but they sit in separate literals, so the old miner never paired them — which
 * is why a catastrophic `bg-rose-800` + `text-white` regression in dark mode
 * was invisible until this was fixed.
 *
 * STRATEGY
 *   • attribute value is read with brace/quote balancing, not a naive match
 *   • template mode: literal chunks are SHARED; string literals inside `${}`
 *     are ALTERNATIVE branches (a ternary), so each is emitted alongside the
 *     shared text, never merged with a sibling branch
 *   • expression mode: a `? :` ternary means alternatives (emitted separately);
 *     otherwise every literal applies (a `cn('a','b')` call) and they combine
 */
function classNameListsIn(src) {
  const out = []
  const re = /className\s*=\s*/g
  let m
  while ((m = re.exec(src))) {
    const at = re.lastIndex
    const c = src[at]
    let raw = null
    if (c === '"' || c === "'" || c === '`') {
      const end = src.indexOf(c, at + 1)
      if (end < 0) continue
      raw = src.slice(at + 1, end)
      re.lastIndex = end + 1
    } else if (c === '{') {
      let depth = 0
      let quote = null
      let i = at
      for (; i < src.length; i++) {
        const ch = src[i]
        if (quote) {
          if (ch === '\\') i++
          else if (ch === quote) quote = null
          continue
        }
        if (ch === '"' || ch === "'" || ch === '`') quote = ch
        else if (ch === '{') depth++
        else if (ch === '}') {
          depth--
          if (depth === 0) break
        }
      }
      raw = src.slice(at + 1, i)
      re.lastIndex = i + 1
    } else continue
    // `at` is the offset of the className VALUE, which is what lets
    // ancestorBackgroundAt() locate this occurrence inside the JSX tree.
    // `path` records WHICH ternary branch this occurrence is, so a
    // translucent child is only ever graded against a parent branch that can
    // render at the same time as it.
    for (const c of expandClassName(raw)) out.push({ text: c.text, path: c.path, at: at + 1 })
  }
  return out
}

const unquote = (s) => s.replace(/^(?:"|'|`)/, '').replace(/(?:"|'|`)$/, '').replace(/\\(['"`])/g, '$1')

/**
 * Every JSX element in a file, with its opaque background utility.
 *
 * Replaces the hand-maintained PARENT_SURFACE allowlist. A translucent
 * utility can only be judged against the surface behind it, and the old table
 * had to be annotated by hand for every new one — so a translucent element
 * added to a non-standard parent was graded against a white card it never
 * floats on, which is a false PASS as surely as a false failure.
 *
 * This walks the JSX tags and records, per element, EVERY solid `bg-*` it can
 * paint. A solid `bg-*` starts a new surface; anything translucent or absent
 * inherits the one already open. So a `bg-white/20` chip inside a `bg-rose-600`
 * banner resolves to rose-600 with no annotation at all.
 *
 * A parent set can hold SEVERAL backgrounds when its own className is a
 * ternary (`isActive ? 'bg-rose-600' : 'bg-slate-100'`). Each is remembered with
 * the branch that selects it, so the caller grades against the backgrounds that
 * can actually be live AT THE SAME TIME as the child being graded — not the
 * harshest of them, and not a pool that mixes mutually exclusive renders. A chip
 * inside that button reads the button's ACTIVE fill when the chip is active, and
 * its INACTIVE fill when it is not.
 *
 * Deliberately NOT a JSX parser. It is a tag scanner: it tracks open/close and
 * self-closing tags, and reads each element's className via the same
 * `className=` recovery the miner already uses. A malformed edge case yields a
 * MISSING ancestor (falls back to the theme default) rather than an invented
 * one, because a wrong parent is a silent wrong grade.
 */
function jsxElementsWithBackground(src) {
  const out = []
  const stack = []
  // Hand-rolled tag scan, not a regex. A tag's attribute region routinely
  // contains `>` — every `onClick={() => ...}` — so a `[^<>]` character class
  // ends the tag at the arrow and silently drops the className that follows,
  // which is exactly the className this function exists to read. This scanner
  // skips `{...}` expressions and quoted strings instead.
  const nameRe = /^<\/?([A-Za-z][\w.]*)?/
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '<' || src[i + 1] === '/') {
      if (src[i] !== '<') continue
    }
    const nameMatch = nameRe.exec(src.slice(i))
    if (!nameMatch) continue
    const isClose = src[i + 1] === '/'
    const name = nameMatch[1] ?? ''
    let j = i + nameMatch[0].length
    let braces = 0
    let quote = null
    for (; j < src.length; j++) {
      const ch = src[j]
      if (quote) {
        if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch
      else if (ch === '{') braces++
      else if (ch === '}') braces--
      else if (ch === '>' && braces === 0) break
    }
    if (j >= src.length) break // unterminated tag; nothing reliable left
    const whole = src.slice(i, j + 1)
    const selfClosing = /\/\s*>$/.test(whole)
    if (isClose) {
      // Close the innermost matching open tag. Tags can repeat, so this pops
      // the LAST opener of that name rather than the first.
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].name === name && !stack[s].closed) {
          stack[s].closed = true
          stack[s].end = i
          stack.splice(s + 1)
          break
        }
      }
      i = j
      continue
    }
    const el = { name, start: i, end: selfClosing ? j + 1 : -1, bgPaths: new Map(), closed: selfClosing }
    const attrs = whole.slice(nameMatch[0].length, whole.length - 1)
    for (const list of classNameListsIn(attrs)) {
      for (const cls of list.text.split(/\s+/)) {
        const parsed = parseClass(cls)
        // A SOLID background only — `bg-*` with no opacity modifier. A
        // translucent ancestor does not become the backdrop; it tints it.
        if (parsed && parsed.kind === 'bg' && parsed.alpha === undefined) {
          // Keep the path per utility so a repeated background does not
          // inherit whichever branch happened to be seen last.
          const seen = el.bgPaths.get(parsed.util)
          if (!seen || !pathsCompatible(seen, list.path)) el.bgPaths.set(parsed.util, list.path)
        }
      }
    }
    out.push(el)
    if (!selfClosing) stack.push(el)
    i = j
  }
  // An element left open is implicitly closed at EOF, so its children still
  // resolve. Sorting by `start` and taking the LAST containing element gives
  // the innermost ancestor, which is the nearest backdrop.
  return out.sort((a, b) => a.start - b.start)
}

/**
 * The nearest enclosing SOLID background to `offset`, or null for the theme
 * default. Returns the innermost element whose span contains `offset` and
 * which paints a solid background.
 */
function ancestorBackgroundAt(elements, offset, path = []) {
  const spans = (el) => el.start <= offset && (el.end === -1 || el.end >= offset)
  const innermost = (list) => (list.length ? list.reduce((a, b) => (b.start > a.start ? b : a)) : null)
  // Only branches that can co-render with `path` are real candidates. A child
  // inside a `isActive`-switching parent inherits that parent's active fill
  // ONLY in the child's own active branch; grading the inactive fill against
  // the active child is a fabricated pairing that fails or passes for no
  // reason. When nothing survives the filter the element contributes no
  // backdrop and the search falls through to the next one out.
  const live = (el) => [...el.bgPaths].filter(([, p]) => pathsCompatible(path, p)).map(([u]) => u)
  // `host` is the element whose own className this occurrence came from.
  const host = innermost(elements.filter(spans))
  const paints = (el) => el.bgPaths.size && spans(el) && live(el).length
  const best = innermost(elements.filter(paints))
  // A host that paints its own SOLID background is not its own backdrop: in
  // `active ? 'bg-slate-900' : done ? 'bg-indigo-600/10' : 'bg-white'` those
  // backgrounds are SIBLING branches of the same ternary, so reading one as the
  // backdrop grades the stepper chip against the active pill's black. Its real
  // surface is the next element OUTSIDE it.
  // A host with no solid background of its own (a bare `bg-black/20` scrim
  // chip) IS transparent about it, so the parent chain still starts there.
  if (best && best !== host) return live(best)
  const outer = innermost(elements.filter((el) => el !== host && paints(el)))
  return outer ? live(outer) : []
}

/** Split a string into its quoted literals plus the code between them. */
function splitQuoted(s) {
  const parts = []
  const re = /(['"`])[^]*?\1/g
  let last = 0
  let m
  while ((m = re.exec(s))) {
    parts.push({ code: s.slice(last, m.index) })
    parts.push({ str: unquote(m[0]) })
    last = m.index + m[0].length
  }
  parts.push({ code: s.slice(last) })
  return parts
}

/**
 * Index of a `?` and its MATCHING `:` at nesting depth 0, skipping strings.
 * Returns null when the expression has no ternary.
 *
 * Ternaries associate right, so `a ? x : b ? y : z` splits into `a ? x :`
 * (b ? y : z) — the outer colon is the one at depth 0 with no `?` still
 * pending. Scanning for the next `?` or the next `:` alike gets this wrong
 * and silently shifts every branch after the first, which is what turned the
 * FilterBar pill's three dark active fills into one.
 */
function findTernary(code) {
  const walk = (from, mode) => {
    let depth = 0
    let pending = 0
    let quote = null
    for (let i = from; i < code.length; i++) {
      const ch = code[i]
      if (quote) {
        if (ch === '\\') i++
        else if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
      if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') depth--
      else if (depth !== 0) continue
      else if (ch === '?') {
        if (mode === 'question') return i
        pending++
      } else if (ch === ':') {
        if (mode === 'colon' && pending === 0) return i
        if (pending > 0) pending--
      }
    }
    return -1
  }
  const q = walk(0, 'question')
  if (q === -1) return null
  const c = walk(q + 1, 'colon')
  if (c === -1) return null
  return { q, c }
}

/** Every string literal in an expression, in source order. */
const literalsIn = (s) => splitQuoted(s).filter((p) => p.str !== undefined).map((p) => p.str)

/**
 * Split a `${}` expression into its reachable leaves, each tagged with the
 * chain of ternary tests that select it.
 *
 * `path` is what makes a chip and its parent commensurable. In FilterBar the
 * chip is `isActive ? 'bg-black/20 text-white' : 'bg-white/80 text-slate-700'`
 * and its parent button switches on the SAME `isActive`, so the chip's real
 * backdrop is one of the parent's ACTIVE fills — never its inactive
 * `bg-slate-100`. Pooling every parent branch graded that working scrim as a
 * light-mode failure, so the branch each side selected has to be recorded, not
 * flattened.
 *
 * `pos` is 'c' for a consequent and 'a' for an alternate, because the same
 * test selects opposite branches.
 */
function ternaryLeaves(expr) {
  const t = findTernary(expr)
  if (!t) {
    const lits = literalsIn(expr)
    return lits.length ? [{ path: [], lits }] : []
  }
  // The test is the raw source text, whitespace-normalised. Two sites correlate
  // only when they switch on the SAME expression, so this must be the source
  // itself rather than a literal-extracted approximation of it.
  const test = expr.slice(0, t.q).trim().replace(/\s+/g, ' ')
  const rec = (chunk, path) => {
    const inner = findTernary(chunk)
    if (inner) return ternaryLeaves(chunk).map((l) => ({ path: [...path, ...l.path], lits: l.lits }))
    const lits = literalsIn(chunk)
    return lits.length ? [{ path, lits }] : []
  }
  return [...rec(expr.slice(t.q + 1, t.c), [{ test, pos: 'c' }]), ...rec(expr.slice(t.c + 1), [{ test, pos: 'a' }])]
}

/**
 * Two branch paths can co-render only if they never disagree about a test.
 * Same test with opposite `pos` means one side took the consequent and the
 * other the alternate — impossible in a single render.
 */
function pathsCompatible(a, b) {
  for (const x of a) {
    for (const y of b) {
      if (x.test === y.test && x.pos !== y.pos) return false
    }
  }
  return true
}

function expandClassName(raw) {
  const text = raw.trim()
  if (!text) return []

  // Template literal: literal chunks are SHARED by every branch; each string
  // literal inside `${}` is one ALTERNATIVE branch (a ternary). Emitting
  // shared+branch pairs — never branch+branch — is what keeps a conditional
  // from manufacturing a class list no element ever has.
  if (text.startsWith('`')) {
    const inner = text.slice(1, text.endsWith('`') && text.length > 1 ? -1 : undefined)
    const parts = []
    const re = /\$\{([\s\S]*?)\}/g
    let last = 0
    let m
    while ((m = re.exec(inner))) {
      parts.push({ lit: inner.slice(last, m.index) })
      parts.push({ expr: m[1] })
      last = m.index + m[0].length
    }
    parts.push({ lit: inner.slice(last) })
    const shared = parts
      .filter((p) => p.lit !== undefined)
      .map((p) => p.lit)
      .join(' ')

    // Each `${}` block contributes one or more fragments; with more than one
    // block the real class list is the CROSS-PRODUCT across blocks (every
    // combination is a reachable rendering), so accumulate rather than flatten.
    let combos = [{ path: [], text: '' }]
    for (const p of parts) {
      if (p.expr === undefined) continue
      const leaves = ternaryLeaves(p.expr)
      if (!leaves.length) continue
      combos = combos.flatMap((c) =>
        leaves.map((l) => ({
          path: [...c.path, ...l.path],
          text: l.lits.join(' '),
        })),
      )
      combos = combos.map((c) => ({ ...c, text: c.text ? `${c.text} ` : '' }))
    }
    return combos.map((c) => ({ text: `${shared} ${c.text}`.trim(), path: c.path }))
  }

  const parts = splitQuoted(text)
  const strings = parts.filter((p) => p.str !== undefined).map((p) => p.str)
  const code = parts
    .filter((p) => p.code !== undefined)
    .map((p) => p.code)
    .join('')

  if (strings.length === 0) return [{ text, path: [] }]
  // A `?`/`:` in the code means a ternary: the literals are ALTERNATIVES.
  if (/[?:]/.test(code)) return strings.map((s) => ({ text: s, path: [] }))
  // Otherwise every literal is applied together (`cn('a', cond && 'b')`).
  return [{ text: strings.join(' '), path: [] }]
}

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const elements = jsxElementsWithBackground(src)
  for (const { text: cls, at, path } of classNameListsIn(src)) {
    const classes = cls.split(/\s+/).map(parseClass).filter(Boolean)
    const disabled = isDisabledList(cls)
    for (const { bg, fg, state } of renderings(classes)) {
      // Opacity belongs in the key: `bg-indigo-400/10` and `bg-indigo-400`
      // are different surfaces with different contrast, not the same row. So
      // does the interaction state (see GRADED_STATES).
      const key = `${bg.util}${bg.alpha !== undefined ? `/${bg.alpha}` : ''}|${fg.util}${fg.alpha !== undefined ? `/${fg.alpha}` : ''}|${state}`
      if (!pairings.has(key)) {
        // Seed with `disabled` itself, NOT false: this is an AND-fold over
        // every class list that produces this pairing, and seeding it with
        // false makes the fold permanently false.
        pairings.set(key, { where: new Set(), alpha: { bg: bg.alpha, fg: fg.alpha }, states: new Set(), disabled, parents: new Set() })
      }
      const meta = pairings.get(key)
      meta.where.add(relative(ROOT, file))
      // The derived backdrop for THIS occurrence, so a pairing reused across
      // files can sit on different surfaces without being averaged or guessed.
      if (meta.alpha.bg !== undefined && meta.alpha.bg < 100) {
        const found = ancestorBackgroundAt(elements, at, path)
        // No solid ancestor anywhere out there: the theme default, recorded
        // as '' so it still reaches `parentOf` and is not confused with a
        // backdrop that merely failed to resolve.
        for (const p of found.length ? found : ['']) meta.parents.add(p)
      }
      meta.states.add(state)
      // A pairing is exempt only if EVERY class list that produces it is a
      // disabled control. One enabled use anywhere re-arms the requirement.
      meta.disabled = meta.disabled && disabled
    }
  }
}

/* --------------------------------------------------------------- resolving */

/**
 * What a utility paints in the LIGHT theme: its Tailwind token, full stop.
 *
 * Deliberately does NOT consult `overrides`. Every override parsed out of
 * dark.css sits inside a `.dark` rule, so it only applies once the dark class
 * is painted — feeding those values into the light column would score the
 * light theme against the dark palette and invert the regression verdicts
 * this report is built on.
 */
function resolveLight(util, state = '') {
  // Prefer the STATE's own alias. A state with no alias of its own genuinely
  // renders as the resting colour, so falling back is correct here — not a
  // shortcut.
  const alias = (state && aliases[`${state}:${util}`]) || aliases[util]
  if (alias) return deref(lightTokens, alias)
  return deref(lightTokens, tokenOf(util)) ?? (util.startsWith('text-') || util.startsWith('bg-') ? BRAND(util) : null)
}

/**
 * What a utility paints in the DARK theme.
 *
 * Note the fallback to the light token: a token the remap never declared is NOT
 * absent from dark mode, it still resolves to its light value from
 * `@layer theme` and paints in the dark UI unchanged. That is a real defect —
 * a pale `text-rose-700` on a dark remapped `bg-rose-50` — so it is graded, not
 * skipped. `remapped` records which utilities were left out of the remap so
 * the report can name them.
 */
function resolveDark(util, state = '') {
  const override = overrides[util]
  if (override !== undefined) return { value: override, remapped: true }
  // The alias is checked BEFORE the utility's own dark token, because the alias
  // is an UNLAYERED rule and therefore outranks the generated utility in dark
  // mode too — `.dark` deliberately re-pins nothing for these utilities, it only
  // redefines the primitive's value. So an ink lightens here, a fill holds.
  const alias = (state && aliases[`${state}:${util}`]) || aliases[util]
  if (alias) return { value: deref(darkTokens, alias) ?? deref(lightTokens, alias), remapped: true }
  const own = deref(darkTokens, tokenOf(util))
  if (own !== null) return { value: own, remapped: true }
  // `--color-brand-*` is a `var(--brand-*)` indirection, so the remap reaches
  // it through the primitive. Without this branch every `bg-brand-*` pairing
  // was a gap; taking it from the LIGHT map instead graded a dark-only
  // surface as pale.
  const brand = BRAND(util, 'dark')
  if (brand) return { value: brand, remapped: true }
  return { value: deref(lightTokens, tokenOf(util)), remapped: false }
}

const rows = []
const gaps = []

// The dark backdrop, once darkTokens exists. Resolved lazily so `composite`
// callers never see a null backdrop.
BACKDROP.dark = darkTokens['--color-white'] ?? '#0f1826'

/**
 * Resolve the surface a row's translucent background sits on.
 *
 * `meta.parents` holds every backdrop the markup allows for this pairing, read
 * by ancestorBackgroundAt(). An occurrence with no solid ancestor keeps the
 * theme default.
 *
 * This collects the candidates; worstRatio() does the grading.
 */
function parentsOf(meta, side) {
  const resolve = side === 'light' ? (p) => resolveLight(p) : (p) => resolveDark(p).value
  const fallback = side === 'light' ? BACKDROP.light : BACKDROP.dark
  const seen = new Set()
  const out = []
  for (const p of meta.parents) {
    const value = (p ? resolve(p) : null) ?? fallback
    if (!seen.has(value)) { seen.add(value); out.push(value) }
  }
  return out.length ? out : [fallback]
}

/**
 * Grade one theme against every candidate backdrop and keep the WORST ratio.
 *
 * A pairing can be reached from several places with different parents — a chip
 * reused inside both a white card and a saturated banner — and a parent that
 * switches on a ternary expands into one candidate per branch. Which branch is
 * live is a runtime fact this static scan cannot know, so the honest reading is
 * the minimum across the branches the markup actually allows.
 *
 * Not the DARKEST backdrop either: for a translucent wash, a very dark parent
 * can be the gentle one (white on black) and a mid one the harsh one
 * (indigo ink on slate-100). Grading by luminance ranked them backwards and
 * invented both a false pass and a false failure. Ranking by the ratio itself
 * cannot: the worst case IS the worst case.
 */
function worstRatio(meta, side, bg, fg) {
  let worst = Infinity
  for (const parent of parentsOf(meta, side)) {
    const bgc = composite(bg, meta.alpha.bg, parent)
    worst = Math.min(worst, ratio(bgc, composite(fg, meta.alpha.fg, bgc)))
  }
  return worst
}

for (const [key, meta] of pairings) {
  // Strip the opacity suffix that the key may carry before token lookup, and
  // peel off the trailing `|state` so a hover rendering is graded as a hover.
  const [bgU, fgU, state] = key.split('|').map((u) => u.split('/')[0])
  // `rest` is the absence of a variant, not a variant named "rest".
  const st = state === 'rest' ? '' : state
  const bgL = resolveLight(bgU, st)
  const fgL = resolveLight(fgU, st)
  const bgD = resolveDark(bgU, st)
  const fgD = resolveDark(fgU, st)

  if (!bgL || !fgL || !bgD.value || !fgD.value) {
    gaps.push({ key, where: [...meta.where][0] })
    continue
  }
  rows.push({
    key,
    where: [...meta.where],
    light: worstRatio(meta, 'light', bgL, fgL),
    dark: worstRatio(meta, 'dark', bgD.value, fgD.value),
    unremapped: [bgU, fgU].filter((u) => !resolveDark(u, st).remapped),
    translucent: meta.alpha.bg !== undefined && meta.alpha.bg < 100,
    state,
    states: [...meta.states],
    disabled: meta.disabled,
  })
}

rows.sort((a, b) => Math.min(a.dark ?? 99, a.light ?? 99) - Math.min(b.dark ?? 99, b.light ?? 99))

if (process.env.DEBUG_PARENTS) {
  for (const [k, m] of pairings) {
    if (m.parents.size) {
      console.log(`PARENT ${k} -> ${[...m.parents].map((p) => p || '(default)').join(', ')} @ ${[...m.where][0]}`)
    }
  }
  process.exit(0)
}

const AA_BODY = 4.5

/**
 * WCAG 2.1 SC 1.4.3 CONTRAST (MINIMUM) — conformance requirement 3:
 *
 *   "Text or images of text that are part of an inactive user interface
 *    component [...] have no contrast requirement."
 *
 * An inactive control is one the user cannot operate. Two behaviours in this
 * app depend on that exemption and were being scored as failures:
 *
 *   ConfirmDialog.tsx:71  disabled confirm button, `bg-slate-300` + `text-white`
 *   TestingTab.tsx:265    disabled run-tests button, `bg-slate-200` + `text-slate-400`
 *
 * Both are detected from the `cursor-not-allowed` marker on the same class
 * list (see isDisabledList), not from a hardcoded file list, so the exemption
 * moves with the markup instead of silently going stale. The pairing is only
 * exempt if EVERY class list producing it is disabled — a single enabled use
 * of `bg-slate-300 > text-white` anywhere re-arms the requirement, which is
 * what stops this from becoming a blanket waiver.
 *
 * Disabled rows are still REPORTED (deduped, counted, listed separately) —
 * dropping them silently would hide a disabled state that later becomes
 * enabled without anyone re-running the check by eye.
 */
const disabledRows = rows.filter((r) => r.disabled)
const graded = rows.filter((r) => !r.disabled)
const fails = graded.filter((r) => r.dark < AA_BODY || r.light < AA_BODY)

/**
 * Split the failures by WHO OWNS THEM.
 *
 * Only the `.dark` block was written here, so the light column is a control
 * group: a pairing that already fails in light is pre-existing and out of
 * scope for a dark-mode change (flagging it as "dark is broken" would be
 * wrong, and "fixing" it would touch unrelated light styling). A pairing that
 * PASSES in light but fails in dark is a regression the remap introduced —
 * those are the ones this change must close.
 */
const darkRegressions = fails.filter((r) => r.light >= AA_BODY)
const preexisting = fails.filter((r) => r.light < AA_BODY)

/** Rows that fail ONLY in an interaction state — the class this tool missed. */
const stateOnlyFails = fails.filter((r) => r.state !== 'rest')
const restFails = fails.filter((r) => r.state === 'rest')

const pad = (s, n) => String(s).padEnd(n)
const num = (v) => (v === null ? '  n/a' : v.toFixed(2))

console.log(`\nMined ${pairings.size} distinct bg>text pairings from ${files.length} source files.`)
console.log(`Light palette read from the Tailwind SOURCE (no build required); dark from src/theme/dark.css (${Object.keys(overrides).length} role overrides, ${Object.keys(aliases).length} ink/fill aliases applied).`)
console.log(`Translucent utilities composited over their theme backdrop (light #fff, dark var(--color-white)).`)
console.log(`Threshold: WCAG AA body text, ${AA_BODY}:1. Graded states: ${GRADED_STATES.join(', ')}.`)
console.log(
  disabledRows.length
    ? `${disabledRows.length} pairing(s) exempt under WCAG 1.4.3 conformance requirement 3 (inactive component).\n`
    : '',
)
console.log(pad('pairing', 40) + pad('state', 9) + pad('light', 8) + pad('dark', 8) + 'verdict')
console.log('-'.repeat(78))
for (const r of rows) {
  const bad = !r.disabled && (r.dark < AA_BODY || r.light < AA_BODY)
  console.log(
    pad(r.key.replace(/\|([a-z-]+)$/, ' > $1').replace('|', ' > '), 40) +
      pad(r.state, 9) +
      pad(num(r.light), 8) +
      pad(num(r.dark), 8) +
      (r.disabled ? 'skip(disabled)' : bad ? 'FAIL' : 'ok'),
  )
  if (bad) {
    const tags = r.unremapped.length ? `  [not remapped: ${r.unremapped.join(', ')}]` : ''
    console.log(`      ${r.where.slice(0, 3).join(', ')}${r.where.length > 3 ? ` +${r.where.length - 3} more` : ''}${tags}`)
  }
}

if (gaps.length) {
  console.log(`\n${gaps.length} pairing(s) could not be resolved in BOTH themes and were skipped:`)
  for (const g of gaps.slice(0, 50)) console.log(`  ${g.key.replace('|', ' > ')}  (${g.where})`)
}

const unremapped = new Set(rows.flatMap((r) => r.unremapped))
if (unremapped.size) {
  console.log(`\n${unremapped.size} utility/ies used in the source but absent from the dark remap:`)
  console.log(`  ${[...unremapped].sort().join(', ')}`)
}

console.log(
  fails.length
    ? `\n${fails.length} pairing(s) below ${AA_BODY}:1 — ${darkRegressions.length} introduced by the dark remap, ${preexisting.length} pre-existing in light mode (${restFails.length} at rest, ${stateOnlyFails.length} only in an interaction state).`
    : `\nAll ${graded.length} graded pairings clear ${AA_BODY}:1 in both themes, across rest + ${GRADED_STATES.length - 1} interaction state(s).`,
)

if (darkRegressions.length) {
  console.log(`\n${'='.repeat(70)}\nDARK-ONLY REGRESSIONS (pass in light, fail in dark) — must fix\n${'='.repeat(70)}`)
  for (const r of darkRegressions) {
    console.log(`  ${r.key.replace(/\|([a-z-]+)$/, ' > $1').replace('|', ' > ')}  light ${r.light.toFixed(2)} → dark ${r.dark.toFixed(2)}${r.unremapped.length ? `  [not remapped: ${r.unremapped.join(', ')}]` : ''}`)
    console.log(`      ${r.where.slice(0, 2).join(', ')}${r.where.length > 2 ? ` +${r.where.length - 2} more` : ''}`)
  }
}

if (preexisting.length) {
  console.log(`\n${'='.repeat(70)}\nPRE-EXISTING IN LIGHT MODE (fails in both) — out of scope, reported only\n${'='.repeat(70)}`)
  for (const r of preexisting) {
    console.log(`  ${r.key.replace(/\|([a-z-]+)$/, ' > $1').replace('|', ' > ')}  light ${r.light.toFixed(2)} → dark ${r.dark.toFixed(2)}`)
  }
}

if (stateOnlyFails.length) {
  console.log(`\n${'='.repeat(70)}\nFAILING ONLY IN AN INTERACTION STATE — invisible to the old audit\n${'='.repeat(70)}`)
  for (const r of stateOnlyFails) {
    console.log(`  ${r.key.replace(/\|([a-z-]+)$/, ' > $1').replace('|', ' > ')}  light ${r.light.toFixed(2)} → dark ${r.dark.toFixed(2)}`)
    console.log(`      ${r.where.slice(0, 2).join(', ')}${r.where.length > 2 ? ` +${r.where.length - 2} more` : ''}`)
  }
}

if (disabledRows.length) {
  console.log(`\n${'='.repeat(70)}\nEXEMPT — inactive controls (WCAG 1.4.3 req. 3), reported not graded\n${'='.repeat(70)}`)
  for (const r of disabledRows) {
    console.log(`  ${r.key.replace(/\|([a-z-]+)$/, ' > $1').replace('|', ' > ')}  light ${r.light.toFixed(2)} → dark ${r.dark.toFixed(2)}`)
    console.log(`      ${r.where.slice(0, 2).join(', ')}${r.where.length > 2 ? ` +${r.where.length - 2} more` : ''}`)
  }
}

process.exit(fails.length || gaps.length ? 1 : 0)