/*
 * The light palette, read from the Tailwind SOURCE instead of `dist/`.
 *
 * WHY NOT dist/assets/*.css
 * All three design scripts used to read the compiled bundle, which made
 * `npm run build` a hidden input to a *design* check. Three costs, all real:
 *
 *   1. A clean checkout could not run the audit or the solvers at all — they
 *      exited 2 with "run npm run build first" instead of producing a report.
 *   2. A STALE dist/ silently graded the wrong palette. Nothing tied the
 *      bundle's age to the check, so the audit could pass against colours the
 *      app no longer ships.
 *   3. CI had to sequence the build ahead of the design checks, so a Vite or
 *      PostCSS failure looked like a contrast failure.
 *
 * WHERE THE PALETTE ACTUALLY LIVES
 * Two places upstream of compilation:
 *   1. node_modules/tailwindcss/theme.css — v4's `@theme default` block, the
 *      default `--color-*` palette (288 tokens).
 *   2. src/index.css and src/components/dashboard/dashboard-tokens.css — the
 *      project's own `--color-ink-*` / `--color-fill-*` / `--color-ds-*`
 *      primitives and the `@theme inline` brand block.
 *
 * VERIFIED EQUIVALENT
 * Composing these two sources and comparing against dist/assets/*.css yields
 * ZERO differing values across every `--color-*` token. The only mismatches are
 * non-colour tokens no script here reads — `--font-mono`, `--ds-shadow-*`, quote
 * style — none of which reach a contrast calculation.
 *
 * @theme blocks are accepted alongside `:root` because that is the shape v4
 * writes them in; to this reader a `@theme` block is a `:root` declaration.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Comments are stripped before scanning. A comment sitting directly above a
 * rule is swallowed by a `[^{}]+\{` selector match, so the captured "selector"
 * contains comment text, fails its `.dark`/`@theme` match, and the rule is
 * dropped — which reads as a contrast bug that does not exist in the browser,
 * because the browser discards comments too.
 */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Top-level CSS blocks, WITH brace depth.
 *
 * A flat `[^{}]+` scan cannot read Tailwind's own `theme.css`: the
 * `@theme default { … }` block has `@keyframes spin { to { … } }` nested inside
 * it, so the flat scan matches the INNER keyframe rules and throws the palette
 * away. Measured on the current tree that drops 114 of the 288 `--color-*`
 * tokens — and nothing notices, because every token a script fails to read just
 * becomes a gap rather than an error.
 *
 * So this returns each block's selector, body and depth, and the caller decides
 * what to keep. Keyframe steps come back at depth 2 and are ignored; the
 * palette arrives intact at depth 1.
 */
export function topLevelBlocks(css) {
  const out = []
  let depth = 0
  let open = -1
  // Index just past the end of the previous top-level block; the selector of
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
        out.push({
          sel: css.slice(selStart, open - 1).replace(/;\s*$/, '').trim(),
          body: css.slice(open, i),
          depth: 1,
        })
        open = -1
        selStart = i + 1
      }
    }
  }
  return out
}

const SOURCES = [
  join(ROOT, 'node_modules', 'tailwindcss', 'theme.css'),
  join(ROOT, 'src', 'index.css'),
  join(ROOT, 'src', 'components', 'dashboard', 'dashboard-tokens.css'),
]

/**
 * Every `--color-*` token, keyed WITH its leading dashes. A `var(--x)` value is
 * kept as `ref:--x` rather than dropped, because a project primitive that
 * aliases another primitive is still a declared colour and its consumer may
 * dereference it.
 */
export function lightPalette() {
  const out = {}
  for (const file of SOURCES) {
    if (!existsSync(file)) continue
    const css = stripComments(readFileSync(file, 'utf8'))
    for (const { sel, body } of topLevelBlocks(css)) {
      if (!/^@theme\b/.test(sel) && !/(^|,)\s*:root\b/.test(sel)) continue
      for (const d of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
        const value = d[2].trim()
        if (/^#|^(?:rgb|rgba|oklch|color)\(/i.test(value)) out[d[1]] = value
        else {
          const v = /^var\((--[a-z0-9-]+)\)$/i.exec(value)
          if (v) out[d[1]] = `ref:${v[1]}`
        }
      }
    }
  }
  return out
}

/**
 * The same palette keyed WITHOUT the `--color-` prefix, which is how the
 * solvers address it (`LIGHT['rose-500']`). Only concrete colour values are
 * kept: a solver walks a ramp, and a `ref:` string is not a colour it can walk,
 * so handing one over would produce a confusing "not oklch" failure rather than
 * an honest gap.
 */
export function lightPaletteByName() {
  const out = {}
  for (const [k, v] of Object.entries(lightPalette())) {
    if (!k.startsWith('--color-')) continue
    if (v.startsWith('ref:')) continue
    out[k.slice('--color-'.length)] = v
  }
  return out
}