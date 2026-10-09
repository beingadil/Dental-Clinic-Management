/**
 * Find ink tokens used on an INHERITED dark bar.
 *
 * scripts/contrast-audit.mjs pairs a `bg-*` utility with a `text-*` utility
 * only when both appear in the SAME className. That misses the common case
 * where a parent paints `bg-slate-900` and a child sets the ink colour —
 * `text-ink-muted` (light #68707b) on the slate-900 bar is 3.56:1, under AA.
 *
 * So walk the real JSX tree instead of grepping lines: for every element whose
 * className contains one of the ink utilities, look up the ancestor chain for
 * an element whose className contains `bg-slate-900` / `bg-slate-950`.
 *
 * Usage: node scripts/find-darkbar-ink.mjs [--list] [subdir]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const INK = /^text-(ink-muted|ink-body|slate-400|slate-500)$/
// Opaque only. `bg-slate-900/60` is a scrim over the page, not a surface the
// ink actually sits on — the modal card under it is opaque white, so grading
// ink against the scrim invents failures that are not on screen.
const DARK_BG = /\bbg-slate-(900|950)(?![\w/])/
// An opaque light background ends the inherited-dark-bar chain: ink below it
// is graded against that surface by contrast-audit.mjs, which already passes.
const LIGHT_BG = /\bbg-(white|slate-(50|100|200)|brand-(50|100|200))\b/

/**
 * The literal strings of a className expression, one per mutually exclusive
 * branch. Concatenating branches — as an earlier version did — makes a
 * state-conditional element look like it wears all of its branch colours at
 * once: `isActive ? 'bg-slate-900 …' : 'bg-white …'` became "dark AND light",
 * so its children were graded against a bar that only exists in one state.
 */
function classBranches(node, sf) {
  // JSX attributes hang off the OPENING element, not the JsxElement wrapper.
  // Reading `node.attributes` yields undefined for every element, so this
  // function silently returned '' everywhere and the scan reported a clean
  // zero — the worst failure mode for an audit.
  const attrs = node.openingElement?.attributes?.properties ?? []
  const attr = attrs.find(
    (a) => a.name && ts.isIdentifier(a.name) && a.name.text === 'className',
  )
  if (!attr?.initializer) return []
  const init = attr.initializer
  if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return [init.text]
  if (ts.isTemplateExpression(init)) return classBranchesFromExpression(init)
  if (ts.isTemplateExpression(init)) {
    // An interpolation can carry its own conditional class set:
    //   className={`base ${isActive ? 'bg-slate-900' : 'bg-white'}`}
    // Those branches are mutually exclusive in exactly the same way, so expand
    // each interpolation into the cartesian product of its branches. Bounded
    // so a pathological className cannot blow up the scan.
    let combos = [init.head.text]
    for (const span of init.templateSpans) {
      const inner = span.expression
      const alternatives =
        inner && !ts.isIdentifier(inner) && !ts.isCallExpression(inner)
          ? classBranchesFromExpression(inner)
          : ['']
      combos = combos.flatMap((prefix) => alternatives.map((alt) => `${prefix} ${alt}`))
      if (combos.length > 16) combos = [combos.join(' ')]
      combos = combos.map((c) => `${c} ${span.literal.text}`)
    }
    return combos
  }
  return classBranchesFromExpression(init)
}

/** The branch literals of a non-template className expression. */
function classBranchesFromExpression(init) {
  // `{cond ? 'a b' : 'c'}` — one entry per branch literal.
  const out = []
  const walk = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      out.push(n.text)
      return
    }
    ts.forEachChild(n, walk)
  }
  walk(init)
  return out.length ? out : ['']
}

/**
 * True when the element is an opaque dark bar in AT LEAST one state. A bar
 * that is dark only when a toggle is active still puts ink on dark in that
 * state, so `some` — not `every` — is the correct test. The `length` guard is
 * load-bearing: `[].some()` is `false`, so a className-less element must not
 * be walked into as if it were a surface of its own.
 */
const isOpaqueDark = (branches) => branches.some((b) => DARK_BG.test(b))
/**
 * True only when EVERY branch paints a light surface. A conditionally-light
 * element does NOT reset the chain, because its dark branch inherits from the
 * same dark ancestor the chain is already tracking.
 */
const isOpaqueLight = (branches) => branches.length > 0 && branches.every((b) => LIGHT_BG.test(b))

/**
 * The ink utilities that actually land on a dark surface, pairing each ink
 * branch with the bar branch that can co-occur with it.
 *
 * When both sides are the same ternary — `isActive ? 'bg-slate-900 …' :
 * 'bg-white …'` under `isActive ? 'text-slate-300' : 'text-ink-muted'` — the
 * branches are positionally aligned, so branch i of the ink is only ever on
 * branch i of the bar. Crossing them invents a pairing the code cannot
 * produce: dark ink on a white card. When the shapes differ, fall back to the
 * cross product, which over-reports rather than misses a real failure.
 */
function inksFor(inkBranches, barBranches) {
  const aligned =
    inkBranches.length === barBranches.length && barBranches.some((b) => DARK_BG.test(b))
  const pairs = []
  if (aligned) {
    for (let i = 0; i < inkBranches.length; i++) {
      if (!DARK_BG.test(barBranches[i])) continue
      for (const c of inkBranches[i].split(/\s+/)) if (INK.test(c)) pairs.push(c)
    }
    return new Set(pairs)
  }
  const inks = new Set()
  for (const b of inkBranches) {
    for (const c of b.split(/\s+/)) if (INK.test(c)) inks.add(c)
  }
  return inks
}

const hits = []

function scanFile(file) {
  const src = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const darkAncestors = []

  function visit(node) {
    // A `JsxFragment` has no `openingElement` and no className, but it sits
    // BETWEEN a dark bar and the ink inside it — it must pass the ancestry
    // through, not break it. Guarded separately from the element branch below.
    if (ts.isJsxFragment(node)) {
      ts.forEachChild(node, visit)
      return
    }
    // `forEachChild` on a JSX element also yields the bare `JsxOpeningElement`,
    // which has no `openingElement` of its own — so test for that field
    // instead of for the node kinds, which lets the stray opening element fall
    // through to the generic branch.
    if (node.openingElement && ts.isJsxOpeningElement(node.openingElement)) {
      const branches = classBranches(node, sf)
      const cls = branches.join(' | ')
      const tag = node.openingElement.tagName.getText(sf)
      const isDark = isOpaqueDark(branches)
      if (isDark) {
        darkAncestors.push({
          tag,
          cls,
          branches,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        })
      } else if (isOpaqueLight(branches)) {
        darkAncestors.length = 0
      } else if (darkAncestors.length) {
        const bar = darkAncestors[darkAncestors.length - 1]
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        for (const ink of inksFor(branches, bar.branches)) {
          hits.push({ file, line, tag, ink, bar, barLine: bar.line })
        }
      }
      ts.forEachChild(node, visit)
      // Pop on the SAME condition that pushed. An earlier version re-derived
      // this from `ts.isJsxElement(node)` — which is false for self-closing
      // elements — so every self-closing dark bar (a stepper dot, a badge)
      // stayed on the stack forever and poisoned every later sibling as if it
      // sat inside it. Record the decision instead of recomputing it.
      if (isDark) darkAncestors.pop()
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

function walkDir(d, acc = []) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) walkDir(p, acc)
    else if (e.name.endsWith('.tsx')) acc.push(p)
  }
  return acc
}

const args = process.argv.slice(2)
const root = args.find((a) => !a.startsWith('-')) ?? 'src'
const list = args.includes('--list')

for (const f of walkDir(root)) scanFile(f)

hits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))

if (list) {
  for (const h of hits) {
    console.log(
      `${h.file}:${h.line}  <${h.tag}> ${h.ink}\n      bar <${h.bar.tag}> @${h.barLine}: ${h.bar.cls.replace(/\s+/g, ' ').slice(0, 100)}`,
    )
  }
} else {
  const byFile = new Map()
  for (const h of hits) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1)
  console.log(`${hits.length} ink-on-dark-bar sites in ${byFile.size} files`)
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${f}`)
}
