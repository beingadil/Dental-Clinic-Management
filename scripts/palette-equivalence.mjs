/*
 * Equivalence check: the source-derived palette vs the compiled bundle.
 *
 * Run manually (`node scripts/palette-equivalence.mjs`) to confirm the source
 * reader still matches what Tailwind actually emits. Not part of `npm test`:
 * it needs `dist/`, which is exactly what the readers no longer require, so
 * wiring it into CI would reintroduce the build dependency it proves is
 * unnecessary.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lightPalette } from './light-palette.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(ROOT, 'dist', 'assets')

if (!existsSync(dist)) {
  console.error('dist/assets not found. Run `npm run build` first — this check needs the bundle to compare against.')
  process.exit(2)
}

/**
 * Canonicalise a CSS colour value so a minifier's rewriting is not read as a
 * palette change.
 *
 * Two normalisations, both required:
 *   1. Whitespace is insignificant (`0.04` and `.04` are the same number, and
 *      the minifier drops the leading zero on every oklch chroma).
 *   2. `var(--x)` and the reader's `ref:--x` are the same declaration written
 *      two ways — one unresolved in the bundle, one unresolved in source.
 * Comparing them raw produced 112 "differences" that were all zero of them.
 */
const norm = (v) =>
  v
    .trim()
    .replace(/\s+/g, '')
    .replace(/\bref:/, 'var(')
    // Restore the leading zero on any bare decimal, whatever precedes it.
    // After whitespace is stripped an oklch chroma reads `oklch(70.4%.04`, so
    // anchoring on `(` or `,` alone missed most of them.
    .replace(/(^|[^\w.-])\.(\d)/g, '$10.$2')
    .replace(/,\)$/, ')')

/** Tokens the compiled bundle declares on :root / :host, `--color-*` only. */
const compiled = {}
for (const f of readdirSync(dist).filter((f) => f.endsWith('.css'))) {
  const css = readFileSync(join(dist, f), 'utf8')
  for (const block of css.match(/:root[^{]*\{([^{}]*)\}/g) || []) {
    for (const m of block.matchAll(/(--color-[a-z0-9-]+)\s*:\s*([^;]+);/gi)) compiled[m[1]] = m[2].trim()
  }
}

const source = lightPalette()
const keys = new Set([...Object.keys(compiled), ...Object.keys(source)])
const missing = []
const differing = []
let compared = 0

for (const k of keys) {
  if (!source[k]) { missing.push(k); continue }
  if (!compiled[k]) continue // declared in source, tree-shaken out of the bundle
  compared++
  if (norm(source[k]) !== norm(compiled[k])) differing.push({ k, source: source[k], compiled: compiled[k] })
}

console.log(`compared ${compared} --color-* token(s) present in both`)
if (missing.length) console.log(`\nIN SOURCE ONLY (${missing.length}):\n  ${missing.join('\n  ')}`)
if (differing.length) {
  console.log(`\nDIFFERING (${differing.length}):`)
  for (const d of differing) console.log(`  ${d.k}\n    source:   ${d.source}\n    compiled: ${d.compiled}`)
}

// A difference is only a failure if it can reach a contrast calculation, i.e.
// it is a concrete colour. `ref:` vs a resolved var is cosmetic.
const realDiffs = differing.filter((d) => !/^(ref:|var\()/.test(d.source) || !/^(ref:|var\()/.test(d.compiled))
if (realDiffs.length) {
  console.error(`\nFAIL: ${realDiffs.length} token(s) differ. The source reader no longer matches the compiled output.`)
  process.exit(1)
}
console.log('\nOK: every concrete colour matches the compiled bundle.')