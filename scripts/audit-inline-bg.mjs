/**
 * Find inline style properties that paint a hardcoded hex colour.
 *
 * The dark theme works by remapping design tokens: `.dark .text-slate-900`
 * resolves to a light ink, `.dark .bg-white` to a dark surface. An inline
 * `style={{ backgroundColor: '#ffffff' }}` is invisible to that system — it
 * is a literal that wins over the remap, so the element keeps its light-mode
 * colour in dark mode. That is not a theoretical hazard: the kanban card did
 * exactly this, painting the operator's light-theme `cardBgColor` inline and
 * leaving `#ffffff` under `text-slate-900` at a measured 1.16:1 in dark mode.
 *
 * The fix there was to write a CUSTOM PROPERTY and let a `.dark` rule own the
 * repaint. That is the shape this audit endorses, so the allow-list below
 * permits custom-property writes and rejects only literal paint properties.
 *
 * Walks the real AST rather than grepping lines, so a hex inside a comment, a
 * string constant or a helper's return value is not mistaken for a paint.
 * A hex that reaches `style` through a variable is reported too — that is the
 * common shape of the bug, and the audit cannot prove the variable is themed.
 *
 * Usage: node scripts/audit-inline-bg.mjs [--list] [subdir]
 * Exits 1 when any finding exists, so it can gate a build.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/**
 * Style properties that actually paint. `color` and `background*` paint ink
 * and surfaces; `border*`, `outline*`, `boxShadow`, `fill` and `stroke` paint
 * lines and decoration that follow the surface. Custom properties (`--x`) are
 * excluded on purpose: writing one and letting a `.dark` rule consume it is
 * the sanctioned pattern.
 *
 * Note `borderRadius`/`borderWidth`/`borderStyle` are NOT paint — a radius or
 * thickness holds no colour, so a bare `border.*` regex reports them and the
 * finding list fills with noise that trains the reader to ignore it.
 */
const PAINT_PROPS =
  /^(color|background|backgroundColor|backgroundImage|backgroundSize|border|background|borderTop|borderRight|borderBottom|borderLeft|borderColor|borderColorTop|borderColorRight|borderColorBottom|borderColorLeft|borderTopColor|borderRightColor|borderBottomColor|borderLeftColor|outline|outlineColor|boxShadow|fill|stroke)$/
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** Files that legitimately set literal paint: print styles and canvas output. */
const EXEMPT_FILES = [
  // Printed output and the PDF/canvas renderer have no theme to remap —
  // ink is authored for paper.
  /print/,
  /BrandPreview/,
]

function* walkFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) yield* walkFiles(full)
    else if (/\.tsx?$/.test(entry)) yield full
  }
}

/**
 * The literal strings inside a `style={{ ... }}` value, one entry per
 * mutually exclusive branch. Same reasoning as find-darkbar-ink.mjs: a
 * state-conditional element must not be read as wearing every branch at once.
 */
function styleValueBranches(obj) {
  const branches = []
  const visit = (node) => {
    if (!node) return
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      branches.push({ value: node.text, line: node.getStart() })
      return
    }
    if (ts.isTemplateExpression(node)) {
      // A template with holes is a themed value (`var(--x)`) — the hex there is
      // a default, not the paint. Only the constant head/tail is inspected.
      for (const span of [node.head, ...node.templateSpans.map((s) => s.literal)]) {
        if (span && HEX.test(span.text.trim())) {
          branches.push({ value: span.text, line: span.getStart() })
        }
      }
      return
    }
    if (ts.isConditionalExpression(node)) {
      visit(node.whenTrue); visit(node.whenFalse); return
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
      return visit(node.expression)
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      return visit(node.left)
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const p of node.properties) visit(p)
      return
    }
    if (ts.isPropertyAssignment(node) || ts.isIdentifier(node)) {
      // An identifier/identifier chain: the value is a variable we cannot
      // resolve. Reported by the caller, not here.
      branches.push({ value: null, line: node.getStart() })
      return
    }
    if (ts.isArrayLiteralExpression(node)) node.elements.forEach(visit)
  }
  visit(obj)
  return branches
}

/**
 * The element's `className` literal, or null when it has none. A JsxAttribute's
 * parent is the JsxAttributes LIST, so className is a sibling we can read
 * directly — no need (and no opportunity) to guess from child structure.
 */
function classNameOf(attrNode) {
  const attrs = attrNode.parent
  if (!attrs || !Array.isArray(attrs.properties)) return null
  for (const a of attrs.properties) {
    if (!ts.isJsxAttribute(a) || a.name.text !== 'className' || !a.initializer) continue
    const init = ts.isStringLiteral(a.initializer) ? a.initializer : a.initializer.expression
    if (init && ts.isStringLiteral(init)) return init.text
  }
  return null
}

/**
 * The ONLY sanctioned exception: a colour-coded dot whose hex must match the
 * tooth/stage colour it labels, with no ink riding on it. Remapping such a swatch
 * to a themed value would desynchronise the legend from what it describes.
 *
 * This list is explicit rather than inferred. An earlier version tried to detect
 * "no ink on this element" structurally — walk for a JsxElement/JsxText
 * descendant — and that heuristic was unsound in two independent ways: the
 * JsxElement sits one level ABOVE the attribute's grandparent (that is the
 * JsxOpeningElement, which has no `children` at all), and a self-closing
 * surface has no children either way. Both mis-classify as "inkless mark", so the
 * audit reported clean on BrandingTab.tsx — a live instance of the very bug it
 * exists to catch. A wrong guess here is silent and defeats the guard, so the
 * exception is enumerated where it can be reviewed.
 *
 * Keyed by file + CSS property + the `dsp-dot` class marker, so a new surface
 * in a listed file still fails: only an element that explicitly opts in with
 * `dsp-dot` is exempt. The class is read off the ATTRIBUTE LIST sibling, not by
 * inferring anything from the element's children (see above for why that fails).
 */
const MARK_EXEMPT = new Set([
  // Odontogram clinical legend: the seven stage swatches (lines 619-625).
  'src/components/cases/Odontogram.tsx|background|dsp-dot',
])

const findings = []
const swatches = []
const targets = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const searchDirs = targets.length ? targets.map((t) => join(ROOT, t)) : [SRC]

for (const dir of searchDirs) {
  for (const file of walkFiles(dir)) {
    const rel = relative(ROOT, file)
    if (EXEMPT_FILES.some((re) => re.test(rel))) continue
    const text = readFileSync(file, 'utf8')
    if (!/style\s*=\s*\{\{/.test(text)) continue

    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node) => {
      if (
        ts.isJsxAttribute(node) &&
        node.name.text === 'style' &&
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression &&
        ts.isObjectLiteralExpression(node.initializer.expression)
      ) {
        for (const prop of node.initializer.expression.properties) {
          if (!ts.isPropertyAssignment(prop)) continue
          const name = prop.name.getText(sf)
          if (name.startsWith('--')) continue // custom property: sanctioned
          if (!PAINT_PROPS.test(name)) continue

          const exempt = MARK_EXEMPT.has(
            `${rel.replace(/\\/g, '/')}|${name}|${classNameOf(node) ?? ''}`
          )

          for (const branch of styleValueBranches(prop.initializer)) {
            const entry = {
              file: rel,
              line: sf.getLineAndCharacterOfPosition(branch.line).line + 1,
              prop: name,
              kind: branch.value === null ? 'variable' : 'hex',
              snippet: branch.value ?? name,
            }
            if (exempt) swatches.push(entry)
            else findings.push(entry)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
}

const list = process.argv.includes('--list')
const scope = targets.length ? targets.join(', ') : 'src'

if (!findings.length) {
  console.log(`audit-inline-bg: no inline hardcoded surfaces in ${scope} ✓`)
  if (swatches.length && list) for (const s of swatches) console.log(`  (mark) ${s.file}:${s.line}  ${s.prop} = ${s.snippet}`)
  else if (swatches.length) console.log(`  ${swatches.length} allow-listed colour-coded mark(s) exempt`)
  process.exit(0)
}

console.log(`\n${'='.repeat(70)}\nINLINE HEX SURFACE — bypasses the .dark token remap (${findings.length})\n${'='.repeat(70)}`)
for (const f of findings) {
  const detail = list ? '' : `[${f.kind} ${f.snippet}] `
  console.log(`  ${f.file}:${f.line}  ${f.prop} = ${detail}${f.kind === 'variable' ? 'value comes from a variable — verify it is themed' : 'literal hex'}`)
}
if (swatches.length) {
  console.log(`\n${'-'.repeat(70)}\nEXEMPT — allow-listed colour-coded marks (${swatches.length})\n${'-'.repeat(70)}`)
  for (const s of swatches) console.log(`  ${s.file}:${s.line}  ${s.prop} = ${s.snippet}`)
}
if (!list) {
  console.log([
    '',
    'Write a CSS custom property (--x) in the inline style and let a .dark rule',
    'consume it, so one owner paints the surface per theme. See',
    '.kanban-case-card in src/components/cases/CaseListView.tsx.',
    '',
  ].join('\n'))
}
process.exit(1)