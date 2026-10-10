#!/usr/bin/env node
/**
 * Dead-utility check.
 *
 * A Tailwind class that does not exist in the built CSS styles NOTHING, and
 * nothing complains: no build error, no test failure, no console warning. The
 * element silently falls back to the inherited value. That is exactly how the
 * whole `text-ink-*` / `bg-fill-*` layer shipped broken for weeks -- the tokens
 * were declared in a plain `:root` block, which emits the custom property but no
 * utility class.
 *
 * Both the test suite and the contrast audit passed while 490 call sites were
 * styled by nothing, because both of them reason about TOKENS. Only the emitted
 * CSS knows whether a class exists. So this walks the built stylesheet and
 * asks the one question the others cannot: for every custom-looking class in
 * the source, is there a rule that could match it?
 *
 * Usage:  node scripts/dead-utility-check.mjs [dist/assets/*.css]
 * Exits non-zero and lists the classes when any are missing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist', 'assets');
const SRC = join(ROOT, 'src');

/** Read every built CSS file. Accepts explicit paths for easier testing. */
function builtCss(args) {
  const files = args.length
    ? args
    : readdirSync(DIST)
        .filter((f) => f.endsWith('.css'))
        .map((f) => join(DIST, f));
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

/** Every .tsx/.ts under src, so a rename is caught, not just a new file. */
function sourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(p);
  }
  return acc;
}

/**
 * Class names we can never expect in the stylesheet: template interpolation
 * and dynamic construction. If these slipped through, the check would report
 * noise and get switched off, which is worse than having no check.
 */
const IGNORED = /^(?:[a-z]+:)*[a-z]*\$|\{|\[|.*\\\$\{/;

const STATIC_TAILWIND = new Set([
  'flex', 'grid', 'block', 'inline', 'hidden', 'relative', 'absolute',
  'fixed', 'sticky', 'static', 'container', 'truncate', 'italic', 'uppercase',
  'lowercase', 'capitalize', 'underline', 'sr-only',
]);

/** A class is "ours to check" if it looks custom, not standard Tailwind. */
function isCustom(cls) {
  if (IGNORED.test(cls)) return false;
  if (STATIC_TAILWIND.has(cls)) return false;
  // Only colours, spacing-ish scales and states are worth auditing; layout and
  // typography utilities are generated on demand and are covered by the
  // framework's own purge step.
  return /(?:^|:)(?:bg|text|border|from|to|via|ring|shadow|fill|stroke|divide|outline|accent|caret|decoration)-/.test(cls);
}

/** Collect candidate classes from className="..." and clsx('...') call sites. */
function collectClasses(files) {
  const found = new Map(); // class -> Set(file)
  const add = (raw, file) => {
    for (const tok of raw.split(/\s+/)) {
      // Strip quotes and trailing JS punctuation. `bg-slate-200'}` and
      // `bg-blue-500'}` are template-literal tails, not class names; without
      // this they are reported as dead and bury the real findings in noise.
      const cls = tok
        .replace(/^[`'"]+/, '')
        .replace(/[`'"}:,)\]}]+$/g, '')
        .trim();
      if (!cls || !isCustom(cls)) continue;
      if (!found.has(cls)) found.set(cls, new Set());
      found.get(cls).add(file);
    }
  };
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const rel = file.slice(ROOT.length + 1);
    // className="a b c"  /  className={'a b'}  /  className={`a ${x}`}
    for (const m of text.matchAll(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g)) {
      add(m[1] ?? m[2] ?? m[3] ?? '', rel);
    }
    // clsx('a', cond && 'b') / cn('a b')
    for (const m of text.matchAll(/\b(?:clsx|cn|classNames?)\s*\(([^)]*)\)/g)) {
      for (const s of m[1].matchAll(/['"`]([^'"`]*)['"`]/g)) add(s[1], rel);
    }
  }
  return found;
}

/**
 * Every class name that has a rule in the built CSS, as a SET.
 *
 * The first version of this check tested each class with a hand-built regex and
 * reported 271 "dead" classes -- including `bg-indigo-50/60`, which is plainly
 * present in the output as `.bg-indigo-50\/60`. Tailwind escapes `:`, `/` and
 * `%` inside class selectors, so a literal string match finds nothing and the
 * check reports noise. A check that cries wolf gets switched off, which is
 * worse than having none, so instead of guessing at escapes we enumerate the
 * selectors, unescape them once, and compare sets.
 */
function emittedClasses(css) {
  const set = new Set();
  // Match the class-selector portion of each selector list: `.foo`, `.a\.b`.
  for (const m of css.matchAll(/\.((?:[A-Za-z0-9_-]|\\.)+)/g)) {
    // Undo CSS escaping, in the order the spec defines:
    //   1. a backslash escapes the next character (`\/` -> `/`, `\:` -> `:`)
    //   2. a digit-led segment is a hex escape (`\32xl` -> `2xl`), which is how
    //      Tailwind writes any class starting with a digit.
    // Skipping the hex step made `2xl:border-ds-line` look dead; it is emitted
    // as `.\32xl\:border-ds-line` and was reported missing when it was not.
    const name = m[1].replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    ).replace(/\\(.)/g, '$1');
    set.add(name);
  }
  return set;
}

/** Does the built CSS contain a rule for this class? */
function hasRule(emitted, cls) {
  if (emitted.has(cls)) return true;
  // A bare `bg-x` rule also covers `hover:bg-x` only if the escaped form was
  // captured separately; enumerated above, so a direct hit is the only test.
  return false;
}

const args = process.argv.slice(2);
const emitted = emittedClasses(builtCss(args));
const files = sourceFiles(SRC);
const classes = collectClasses(files);

const missing = [];
for (const [cls, where] of classes) {
  if (!hasRule(emitted, cls)) {
    missing.push({ cls, files: [...where].slice(0, 3) });
  }
}

const total = classes.size;
if (!missing.length) {
  console.log(`✓ all ${total} colour/state utility classes used in source have a rule in the built CSS`);
  process.exit(0);
}

console.error(`✗ ${missing.length} of ${total} utility classes used in source have NO rule in the built CSS`);
console.error('  These style nothing: the element silently falls back to its inherited value.\n');
for (const m of missing.sort((a, b) => a.cls.localeCompare(b.cls))) {
  console.error(`  ${m.cls}`);
  for (const f of m.files) console.error(`      ${f}`);
}
process.exit(1);