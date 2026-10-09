/**
 * Dead-class guard for the design system.
 *
 * The bug this exists to prevent: `bg-ds-surface-sunken`. `@theme inline` only
 * ever exposed `--color-ds-sunken`, so Tailwind silently compiled that class to
 * nothing and eight call sites rendered on a transparent background. Nothing in
 * tsc, Vite or the existing tests noticed — an unknown utility is not an error
 * in Tailwind, it is simply absent from the output.
 *
 * So the rule is enforced where the silence is: every class in `src/` that names
 * a token we own must resolve to something that actually exists, either a
 * `--<slot>-<name>` declaration in an `@theme` block or a hand-written class
 * selector in project CSS. This covers the whole class of bug rather than the
 * one instance: renamed tokens, typo'd tokens, tokens dropped from the theme,
 * and component classes (`ds-*`) deleted from the stylesheet.
 *
 * Scope is deliberately narrow. Only two kinds of class are checked:
 *
 *   1. values in a namespace this project owns (`ds-`, `brand-`), and
 *   2. stock palette entries (`<hue>-<number>`), e.g. `bg-slate-550` against a
 *      ramp that stops at 500.
 *
 * Everything else is left alone: `text-sm`, `border-2` and `rounded-lg` are
 * generated from scale slots that theme.css does not enumerate per value, and
 * utilities such as `border-t-2` or `ring-offset-1` only look like palette
 * entries. Gating rule 2 on the hue actually being a stock palette namespace
 * is what keeps those false positives out while still catching the typo.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const TAILWIND_THEME = join(ROOT, 'node_modules', 'tailwindcss', 'theme.css');

/**
 * Utility prefixes we resolve, mapped to the theme slots their value could come
 * from. `text-` and `shadow-` can mean two different things (colour vs. size,
 * shadow vs. shadow-coloured), so a class is valid if ANY of its slots knows the
 * name. Prefixes absent from this table are never checked.
 */
const PREFIX_SLOTS: Record<string, string[]> = {
  accent: ['color'],
  bg: ['color'],
  border: ['color'],
  caret: ['color'],
  decoration: ['color'],
  divide: ['color'],
  fill: ['color'],
  font: ['font'],
  from: ['color'],
  outline: ['color'],
  placeholder: ['color'],
  ring: ['color'],
  rounded: ['radius'],
  shadow: ['shadow', 'color'],
  stroke: ['color'],
  text: ['color'],
  to: ['color'],
  via: ['color'],
};

/** Physical/logical side modifiers that may sit between prefix and token. */
const SIDES = new Set(['t', 'r', 'b', 'l', 'x', 'y', 's', 'e']);

interface Violation {
  /** The full class as authored, e.g. `hover:bg-ds-nope/20`. */
  token: string;
  /** File and 1-based line, for a message a human can act on. */
  where: string;
  /** Why it is dead — a missing token name reads much better than "unknown". */
  reason: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Remove comments so documentation about the design system is never mistaken
 * for usage of it. Block comments always; line comments only in TS/TSX (CSS has
 * no `//`, and a URL such as `url(https://…)` must survive intact).
 */
function stripComments(code: string, isCss: boolean): string {
  let out = code.replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (!isCss) {
    out = out
      .replace(/^[ \t]*\/\/.*$/gm, ' ')
      // Trailing `// …` only when the comment cannot contain a quote, and only
      // after whitespace/brace/paren — so `https://` is left alone.
      .replace(/(^|[\s{;,(])\/\/[^\n'"]*$/gm, '$1');
  }
  return out;
}

/** `--color-ds-ink: …` inside `@theme` blocks → slot `color`, name `ds-ink`. */
function parseThemeSlots(sources: string[]): Map<string, Set<string>> {
  const slots = new Map<string, Set<string>>();
  for (const code of sources) {
    // @theme blocks hold custom-property declarations only, so the block ends at
    // the first `}`.
    for (const block of code.matchAll(/@theme\s+(?:inline\s+)?\{([^}]*)\}/g)) {
      for (const decl of block[1].matchAll(/--([a-z0-9-]+)\s*:/g)) {
        const dash = decl[1].indexOf('-');
        if (dash < 1) continue;
        const slot = decl[1].slice(0, dash);
        const name = decl[1].slice(dash + 1);
        if (!slots.has(slot)) slots.set(slot, new Set());
        slots.get(slot)!.add(name);
      }
    }
  }
  return slots;
}

/** Every class selector defined by hand in project CSS. */
function parseDefinedClasses(sources: string[]): Set<string> {
  const defined = new Set<string>();
  for (const code of sources) {
    for (const sel of code.matchAll(/\.(-?[_a-z][\w-]*)/g)) defined.add(sel[1]);
  }
  return defined;
}

/**
 * Split a class into its resolvable pieces, or return null when it is not a
 * candidate. Tailwind class syntax: `[variants:]utility-value[/opacity]`.
 */
function parseUtility(token: string): { prefix: string; value: string } | null {
  let body = token;
  if (body.startsWith('-')) body = body.slice(1); // strip the negative marker only
  const slash = body.indexOf('/');
  if (slash !== -1) body = body.slice(0, slash); // strip `/30`, `/[.06]`
  const dash = body.indexOf('-');
  if (dash < 1) return null;
  const prefix = body.slice(0, dash);
  let value = body.slice(dash + 1);

  // `border-t-ds-line` puts the side before the token, which would otherwise
  // hide the namespace. Peel it off and check the remainder as a token.
  const segments = value.split('-');
  if (SIDES.has(segments[0]) && segments.length > 1) value = segments.slice(1).join('-');

  return { prefix, value };
}

/**
 * Split a run of class-list text into individual candidate tokens, dropping
 * arbitrary-value brackets (`data-[state=open]:bg-…`, `w-[calc(1px+2px)]`) so
 * their contents cannot masquerade as token names.
 */
function splitCandidates(chunk: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of chunk) {
    if (char === '[') depth++;
    else if (char === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens.filter((t) => /^[a-z0-9:!_\-./[\]#%]+$/i.test(t) && !t.includes('..'));
}

/** `bg-ds-ink/40` → `bg-ds-ink`; arbitrary suffixes are dropped. */
function baseToken(token: string): string {
  const slash = token.indexOf('/');
  return (slash === -1 ? token : token.slice(0, slash)).replace(/[^a-z0-9:\-_[\].]/gi, '');
}

export function findViolations(
  code: string,
  opts: {
    slots: Map<string, Set<string>>;
    ownedNamespaces: Set<string>;
    stockNamespaces: Set<string>;
    definedClasses: Set<string>;
    label: string;
  },
): Violation[] {
  const { slots, ownedNamespaces, stockNamespaces, definedClasses, label } = opts;
  const out: Violation[] = [];
  const lines = code.split('\n');
  const lineOf = (index: number) => code.slice(0, index).split('\n').length;

  const report = (start: number, token: string, reason: string) => {
    // Report the start of the line's class run rather than the token's own
    // column, which is close enough to act on and keeps the message short.
    const line = lines[lineOf(start) - 1];
    out.push({ token, where: `${label}:${lineOf(start)}`, reason: `${reason} — in: ${line.trim()}` });
  };

  for (const util of code.matchAll(/\b([a-z0-9:!_\-./[\]#%]+)/gi)) {
    for (const token of splitCandidates(util[0])) {
      // Take the last variant segment: `hover:bg-ds-x` → `bg-ds-x`.
      const parts = token.split(':');
      const utility = parts[parts.length - 1];
      if (!utility) continue;

      const parsed = parseUtility(baseToken(utility));
      if (!parsed) continue;
      const { prefix, value } = parsed;
      const allowedSlots = PREFIX_SLOTS[prefix];
      if (!allowedSlots) continue;

      const namespace = value.split('-')[0];
      const owned = ownedNamespaces.has(namespace);
      // A stock palette entry is a known Tailwind hue plus a numeric step.
      // Requiring BOTH keeps `border-t-2`, `border-l-4` and `ring-offset-1`
      // out: their first segment (`t`, `l`, `offset`) is not a hue.
      const isPaletteStep = stockNamespaces.has(namespace) && /-\d+$/.test(value);
      // Stock utilities we cannot enumerate (text-sm, border-2, rounded-lg).
      if (!owned && !isPaletteStep) continue;

      const known = allowedSlots.some((slot) => slots.get(slot)?.has(value));
      if (!known) {
        report(util.index, token, `no \`--${allowedSlots.join('/')}-${value}\` token is exposed`);
      }
    }
  }

  // Hand-written component classes live in the stylesheet, not the theme, so
  // they get their own check: every `ds-*` class used must be defined somewhere.
  // Lowercase and class-delimited only — case numbers like 'DS-0001' and inline
  // custom properties like '--ds-i' must never match.
  const ids = new Set<string>();
  for (const id of code.matchAll(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)'|\{\s*['"]([^'"]+)['"]\s*\})/g)) {
    ids.add(id[1] ?? id[2] ?? id[3]);
  }

  for (const cls of code.matchAll(/(?<=[\s"'`{(:])ds-[a-z0-9]+(?:-[a-z0-9]+)*/g)) {
    const token = cls[0];
    // `id="ds-rev-fill"` on an SVG gradient def is an identifier, not a class.
    if (ids.has(token)) continue;

    const after = code.slice(cls.index + token.length);
    if (/^-?\$\{/.test(after)) {
      // Built at runtime (`ds-density-${density}`). The literal half cannot be
      // checked against the stylesheet, so require that at least one defined
      // class starts with it — otherwise the whole family is dead.
      const family = [...definedClasses].some((c) => c.startsWith(`${token}-`));
      if (!family) {
        report(cls.index, `${token}-\${…}`, `no class in project CSS starts with \`${token}-\``);
      }
      continue;
    }

    if (!definedClasses.has(token)) {
      report(cls.index, token, 'no matching class selector in project CSS');
    }
  }

  return out;
}

// ── Shared context ──────────────────────────────────────────────────────────

const sourceFiles = walk(SRC).filter((f) => /\.(tsx?|css)$/.test(f));
const tsFiles = sourceFiles.filter((f) => /\.tsx?$/.test(f));
const cssFiles = sourceFiles.filter((f) => f.endsWith('.css'));
const read = (f: string) => stripComments(readFileSync(f, 'utf8'), f.endsWith('.css'));

const cssSources = cssFiles.map(read);

/** Our own `@theme` blocks, merged with the stock Tailwind palette. */
const slots = parseThemeSlots(cssSources);
const stockColors = new Set<string>();
for (const decl of readFileSync(TAILWIND_THEME, 'utf8').matchAll(/--color-([a-z0-9-]+)\s*:/g)) {
  stockColors.add(decl[1]);
}
if (stockColors.size === 0) throw new Error('tailwindcss/theme.css exposed no --color-* names; the palette check would be a no-op');
slots.set('color', new Set([...(slots.get('color') ?? []), ...stockColors]));

/** Namespaces this project owns: first segment of every theme name we declare. */
const ownedNamespaces = new Set<string>();
for (const names of parseThemeSlots(cssSources).values()) {
  for (const name of names) ownedNamespaces.add(name.split('-')[0]);
}

/** Stock hues (`slate`, `rose`, …) — the namespace half of `slate-500`. */
const stockNamespaces = new Set<string>();
for (const name of stockColors) stockNamespaces.add(name.split('-')[0]);

const definedClasses = parseDefinedClasses(cssSources);

// ── Tests ───────────────────────────────────────────────────────────────────

describe('design-token guard', () => {
  const ctx = { slots, ownedNamespaces, stockNamespaces, definedClasses, label: 'fixture' };

  it('detects the exact class that shipped broken', () => {
    const found = findViolations(`<div className="bg-ds-surface-sunken" />`, ctx);
    expect(found).toHaveLength(1);
    expect(found[0].token).toBe('bg-ds-surface-sunken');
    expect(found[0].reason).toContain('--color-ds-surface-sunken');
  });

  it('does not flag classes the theme really exposes', () => {
    const code =
      `<div className="bg-ds-sunken text-ds-ink-soft border-ds-line hover:bg-ds-accent/30 ` +
      `focus-visible:ring-ds-accent/30 rounded-ds-card shadow-ds-card ds-panel ds-hit ` +
      `bg-white text-sm border-2 rounded-lg bg-slate-500 border-t-2 border-l-4 ` +
      `focus:ring-offset-1 focus-visible:outline-offset-2 print:border-black" />`;
    expect(findViolations(code, ctx)).toEqual([]);
  });

  it('accepts a class assembled at runtime when its family exists', () => {
    expect(findViolations('className={`ds-density-${density}`}', ctx)).toEqual([]);
    expect(
      findViolations('className={`ds-densityy-${density}`}', ctx).map((v) => v.reason),
    ).toEqual(['no class in project CSS starts with `ds-densityy-` — in: className={`ds-densityy-${density}`}']);
  });

  it('does not mistake an SVG id for a component class', () => {
    // `ds-rev-fill` is an <linearGradient> id used by fill="url(#ds-rev-fill)";
    // the sibling's dead class must still be caught.
    const code = '<linearGradient id="ds-rev-fill" x1="0"><stop className="ds-pannel" /></linearGradient>';
    expect(findViolations(code, ctx).map((v) => v.token)).toEqual(['ds-pannel']);
  });

  it('ignores arbitrary values, inline CSS vars and JS identifiers', () => {
    const code =
      `style={{ ['--ds-i' as string]: 2 }} data-[state=open]:bg-ds-ink ` +
      `className="w-[calc(1px+2px)] text-ds-nope"`;
    // `text-ds-nope` is genuinely dead; the bracket and var cases must not add
    // findings of their own.
    const found = findViolations(code, ctx);
    expect(found.map((f) => f.token)).toContain('text-ds-nope');
    expect(found).toHaveLength(1);
  });

  it('does not mistake case numbers for component classes', () => {
    const code = `<input placeholder="e.g. DS-0001" /> const fallback = 'DS-0001'; ds-fmt`;
    expect(findViolations(code, ctx).map((f) => f.token)).toEqual(['ds-fmt']);
  });

  it('flags a typo in a stock palette step', () => {
    const found = findViolations(`<div className="bg-slate-550 border-red-600" />`, ctx);
    expect(found.map((f) => f.token)).toEqual(['bg-slate-550']);
  });

  it('sees through a side modifier', () => {
    expect(findViolations('<div className="border-t-ds-nope rounded-t-lg border-t-2" />', ctx).map((f) => f.token)).toEqual([
      'border-t-ds-nope',
    ]);
  });

  it('flags a ds-* component class with no selector', () => {
    const found = findViolations(`<div className="ds-pannel" />`, ctx);
    expect(found.map((f) => f.token)).toEqual(['ds-pannel']);
  });

  it('finds no dead classes anywhere in src/', () => {
    const violations = tsFiles.flatMap((file) =>
      findViolations(read(file), {
        slots,
        ownedNamespaces,
        stockNamespaces,
        definedClasses,
        label: relative(ROOT, file).split(sep).join('/'),
      }),
    );
    const report = violations.map((v) => `  ${v.where}  ${v.token} — ${v.reason}`).join('\n');
    expect(violations, `Dead design-system classes:\n${report}`).toEqual([]);
  });

  it('has no leftovers from the original regression', () => {
    const offenders = tsFiles.filter((f) => read(f).includes('bg-ds-surface-sunken'));
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('owns the namespaces it claims to', () => {
    // The guard is only meaningful if it actually resolved the project's own
    // theme; if dashboard-tokens.css moved, this fails loudly.
    expect(ownedNamespaces.has('ds')).toBe(true);
    expect(slots.get('color')?.has('ds-sunken')).toBe(true);
  });
});