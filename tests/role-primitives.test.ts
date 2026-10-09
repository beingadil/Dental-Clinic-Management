/**
 * The ink/fill split guard.
 *
 * The bug: `emerald-600` was one token doing two incompatible jobs.
 * `text-emerald-600` is INK on a card, `bg-emerald-600` is a saturated FILL
 * carrying white ink. Because they shared a value, the light theme could not
 * satisfy both — `bg-emerald-600` under white is 3.67:1 while
 * `text-rose-600` on `bg-rose-50` is 4.10:1 — and every fix for one role broke
 * the other. Each fix was the next failure.
 *
 * So the roles are separate primitives now (`--color-ink-*` and
 * `--color-fill-*`, solved by scripts/role-picker.mjs). This file is the part
 * that makes the bug class unrepeatable rather than merely fixed:
 *
 *   1. every role token is declared in BOTH themes. A token declared only in
 *      `:root` silently resolves to its light value under `.dark`, which is how
 *      a light-theme fix can look correct and still ship broken.
 *   2. every INK clears 4.5:1 on every surface it is ever painted on, in both
 *      themes.
 *   3. every FILL clears 4.5:1 under white ink.
 *
 * Contrast maths is reimplemented here rather than imported from the audit
 * script on purpose: this test reads only committed source CSS and Tailwind's
 * palette, so it runs on a clean checkout with no `dist/`. The audit remains
 * the end-to-end check over real pairings; this is the fast invariant.
 *
 * The three checks are separate `it` blocks on purpose. A new failing ink
 * should report "ink-danger is unreadable on bg-rose-100", not a list of
 * everything else that happens to be wrong in the same theme.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INDEX_CSS = join(ROOT, 'src', 'index.css');
const DARK_CSS = join(ROOT, 'src', 'theme', 'dark.css');
const TAILWIND_THEME = join(ROOT, 'node_modules', 'tailwindcss', 'theme.css');

// ── Colour maths ───────────────────────────────────────────────────────────

const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

/** WCAG 2.x relative luminance from a 3-tuple of 0-1 sRGB channels. */
const luminance = (rgb: [number, number, number]) =>
  0.2126 * srgbToLinear(rgb[0]) +
  0.7152 * srgbToLinear(rgb[1]) +
  0.0722 * srgbToLinear(rgb[2]);

/** WCAG 2.x contrast ratio between two hex colours. Rounded to 2dp for reporting. */
function contrast(a: string, b: string): number {
  const x = luminance(parseHex(a));
  const y = luminance(parseHex(b));
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) {
    throw new Error(`not a hex colour: ${hex}`);
  }
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

/**
 * `oklch()` → sRGB hex, per CSS Color 4.
 *
 * Tailwind v4 writes its palette as oklch, so the light surfaces a light ink
 * has to survive are not available as hex anywhere in this repo. Without this
 * the test could only grade against hand-copied hexes, which drift silently the
 * moment Tailwind re-tunes a ramp.
 *
 * Checked against a known value: Tailwind's `slate-50` is documented as
 * `#f8fafc` and this reproduces it.
 */
function oklchToHex(L: number, C: number, H: number): string {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const encode = (x: number) =>
    x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return (
    '#' +
    [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
      .map((v) =>
        Math.round(Math.max(0, Math.min(1, encode(v))) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

// ── Token extraction ───────────────────────────────────────────────────────

const indexCss = readFileSync(INDEX_CSS, 'utf8');
const darkCss = readFileSync(DARK_CSS, 'utf8');
const tailwindTheme = readFileSync(TAILWIND_THEME, 'utf8');

/**
 * The role primitives, keyed by suffix (`muted`, `danger`, `danger-hover`, …).
 *
 * Split on role because that is the whole point of the split: an ink and a
 * fill are allowed to share a suffix, and are required to have separate
 * tokens. Reading them as one undifferentiated bag would hide a regression
 * where `fill-danger` is quietly removed and the two sets drift apart.
 *
 * The suffix pattern admits a trailing state (`[a-z]+(-(hover|active))?`)
 * because the fills are shipped as three-step ramps. A `[a-z]+`-only pattern
 * matches the resting step and silently drops the other two, which is the
 * same blind spot the audit had before it learned to key on the variant.
 */
function rolePrimitives(css: string, role: 'ink' | 'fill') {
  const found = new Map<string, string>();
  for (const m of css.matchAll(
    new RegExp(`--color-${role}-([a-z]+(?:-[a-z]+)?):\\s*([^;]+)`, 'gi'),
  )) {
    found.set(m[1], m[2].trim());
  }
  return found;
}

/** Split `danger-hover` into its base role and its state step. */
const stateOf = (suffix: string): { base: string; state: 'rest' | 'hover' | 'active' } => {
  const m = /^(.*)-(hover|active)$/.exec(suffix);
  return m ? { base: m[1], state: m[2] as 'hover' | 'active' } : { base: suffix, state: 'rest' };
};

const lightInks = rolePrimitives(indexCss, 'ink');
const lightFills = rolePrimitives(indexCss, 'fill');
const darkInks = rolePrimitives(darkCss, 'ink');
const darkFills = rolePrimitives(darkCss, 'fill');

/**
 * A surface in a given theme, as hex.
 *
 * Light surfaces are Tailwind's palette; dark surfaces are the remap in
 * dark.css. Both are read from source rather than listed here so a tint
 * change in either place is graded immediately.
 */
const lightPaletteHex = (name: string): string => {
  const raw = new RegExp(`--color-${name}:\\s*([^;]+)`).exec(tailwindTheme)?.[1];
  if (!raw) throw new Error(`Tailwind palette has no --color-${name}`);
  const value = raw.trim();
  if (value.startsWith('#')) {
    return value.length === 4
      ? '#' + [...value.slice(1)].map((c) => c + c).join('')
      : value;
  }
  const m = /oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)/.exec(value);
  if (!m) throw new Error(`unsupported colour syntax for ${name}: ${value}`);
  return oklchToHex(Number(m[1]) / 100, Number(m[2]), Number(m[3]));
};

const darkPaletteHex = (name: string): string => {
  const value = new RegExp(`--color-${name}:\\s*([^;]+)`, 'i').exec(darkCss)?.[1];
  if (!value) throw new Error(`dark.css does not remap --color-${name}`);
  return value.trim();
};

/** Every neutral surface an ink is painted on regardless of semantic hue. */
const NEUTRALS = ['white', 'slate-50', 'slate-100'] as const;

/**
 * The tint surfaces each semantic ink is painted on.
 *
 * Deliberately not the full cross-product. A danger ink never sits on an
 * emerald chip; grading it there would force the inks toward black and white
 * to satisfy pairings the UI never renders. These are the sets
 * scripts/role-picker.mjs solves against.
 */
const TINTS: Record<string, readonly string[]> = {
  danger: ['rose-50', 'rose-100'],
  success: ['emerald-50', 'emerald-100'],
  warning: ['amber-50', 'amber-100'],
  info: ['blue-50', 'blue-100'],
};

const AA = 4.5;

// ── Tests ──────────────────────────────────────────────────────────────────

describe('role primitives', () => {
  it('parse as colours in both themes', () => {
    // Guard before any contrast maths: a typo'd value (`removed`, a stray
    // `var()`) otherwise surfaces as an anonymous throw from parseHex with no
    // token name, which is the hardest possible thing to act on.
    const bad: string[] = [];
    const check = (label: string, tokens: Map<string, string>) => {
      for (const [suffix, value] of tokens) {
        if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value.trim())) {
          bad.push(`--color-${label}-${suffix} = ${value}`);
        }
      }
    };
    check('ink', lightInks);
    check('ink', darkInks);
    check('fill', lightFills);
    check('fill', darkFills);

    expect(
      bad,
      `Role primitives must be literal hex (oklch/var() here breaks the picker and the audit):\n  ${bad.join('\n  ')}`,
    ).toEqual([]);
  });

  it('are declared in both themes', () => {
    // A role token present in only one theme is the silent-failure case: the
    // missing theme resolves to the other theme's value via `@layer theme`,
    // so the CSS is valid and the failure only shows up in the UI.
    const problems: string[] = [];
    const compare = (
      label: string,
      light: Map<string, string>,
      dark: Map<string, string>,
    ) => {
      for (const name of light.keys()) {
        if (!dark.has(name)) problems.push(`--color-${label}-${name} missing from dark.css`);
      }
      for (const name of dark.keys()) {
        if (!light.has(name)) problems.push(`--color-${label}-${name} missing from index.css`);
      }
    };
    compare('ink', lightInks, darkInks);
    compare('fill', lightFills, darkFills);

    // `text-ink-warning` is used at eleven call sites; a dropped token there
    // renders as inherited black on a dark card.
    if (!lightInks.has('warning') || !darkInks.has('warning')) {
      problems.push('ink-warning is missing from a theme');
    }

    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('keeps every ink readable on every surface it is painted on, in both themes', () => {
    const failures: string[] = [];
    for (const [suffix, lightValue] of lightInks) {
      const darkValue = darkInks.get(suffix);
      if (!darkValue) continue; // reported by the both-themes check

      // `muted` and `body` are general-purpose text and ride neutrals only;
      // the semantic inks additionally ride their own tint surfaces.
      const surfaces = TINTS[suffix]
        ? [...NEUTRALS, ...TINTS[suffix]]
        : [...NEUTRALS];

      for (const theme of ['light', 'dark'] as const) {
        const ink = theme === 'light' ? lightValue : darkValue;
        for (const surface of surfaces) {
          const bg =
            theme === 'light'
              ? lightPaletteHex(surface)
              : darkPaletteHex(surface);
          const ratio = contrast(ink, bg);
          if (ratio < AA) {
            failures.push(
              `${theme} ink-${suffix} ${ink} on bg-${surface} ${bg} = ${ratio}:1 (needs ${AA}:1)`,
            );
          }
        }
      }
    }

    expect(failures, `Ink below ${AA}:1:\n  ${failures.join('\n  ')}`).toEqual([]);
  });

  it('keeps every fill readable under white ink', () => {
    // A fill is a saturated brand slab; the ink on it is white in both themes
    // (dark.css pins `text-white` to #f8fafc, which is what a fill is graded
    // against below). Fills are not theme-scoped — they hold one tone.
    const WHITE_INK = '#f8fafc';
    const failures: string[] = [];

    for (const [suffix, value] of lightFills) {
      const ratio = contrast(value, WHITE_INK);
      if (ratio < AA) {
        failures.push(`fill-${suffix} ${value} under ${WHITE_INK} = ${ratio}:1`);
      }
      if (darkFills.get(suffix) !== value) {
        failures.push(
          `fill-${suffix} is ${darkFills.get(suffix) ?? 'absent'} in dark.css but ${value} in index.css — a fill must hold one tone across the switch`,
        );
      }
    }

    expect(failures, `Fill below ${AA}:1 or not held:\n  ${failures.join('\n  ')}`).toEqual(
      [],
    );
  });

  it('keeps every fill STATE step readable under white ink and in a coherent ramp', () => {
    // The fills ship as resting → hover → active ramps wired to
    // `hover:bg-*` / `active:bg-*`. A hover or active step that is lighter
    // than its resting step (or that drops under AA) only appears on
    // interaction, so it is invisible to a static read of the resting state —
    // exactly the class of defect the resting-fill check above cannot see.
    const WHITE_INK = '#f8fafc';
    const failures: string[] = [];
    const ramps = new Map<string, Map<string, string>>();

    for (const [suffix, value] of lightFills) {
      const { base, state } = stateOf(suffix);
      if (state === 'rest') continue;
      const step = ramps.get(base) ?? new Map<string, string>();
      step.set(state, value);
      ramps.set(base, step);

      const ratio = contrast(value, WHITE_INK);
      if (ratio < AA) {
        failures.push(`fill-${suffix} ${value} under ${WHITE_INK} = ${ratio}:1`);
      }
      if (darkFills.get(suffix) !== value) {
        failures.push(
          `fill-${suffix} is ${darkFills.get(suffix) ?? 'absent'} in dark.css but ${value} in index.css — a state step must hold one tone across the switch`,
        );
      }
    }

    // Interaction must read as pressable: each step darker than the last.
    for (const [base, step] of ramps) {
      const rest = lightFills.get(base);
      if (!rest) {
        failures.push(`fill-${base}-hover/active exist but --color-fill-${base} does not`);
        continue;
      }
      if (!(step.has('hover') && step.has('active'))) {
        failures.push(
          `fill-${base} is missing the ${!step.has('hover') ? 'hover' : 'active'} step; the ramp must be complete`,
        );
        continue;
      }
      // Ramp direction is a LIGHTNESS property, not a contrast one: a darker
      // fill scores HIGHER against white ink. Comparing contrast ratios here
      // would invert the sign and flag a correct ramp as broken.
      const restL = luminance(parseHex(rest));
      for (const state of ['hover', 'active'] as const) {
        if (luminance(parseHex(step.get(state)!)) >= restL) {
          failures.push(
            `fill-${base}-${state} ${step.get(state)} is not darker than the resting ${rest} — the interaction step is invisible`,
          );
        }
      }
      if (luminance(parseHex(step.get('active')!)) >= luminance(parseHex(step.get('hover')!))) {
        failures.push(
          `fill-${base}-active ${step.get('active')} is not darker than its hover ${step.get('hover')}`,
        );
      }
    }

    expect(failures, `Fill state step below ${AA}:1 or out of ramp:\n  ${failures.join('\n  ')}`).toEqual([]);
  });

  it('does not let a palette step do both jobs again', () => {
    // The original defect, stated as an invariant: no ink value may equal any
    // fill value. Sharing one means the two roles are once again coupled and a
    // future fix to either will break the other — which is how all 20 failures
    // were produced in the first place.
    const inkValues = new Set([...lightInks.values()]);
    const collisions = [...lightFills.entries()]
      .filter(([, value]) => inkValues.has(value))
      .map(([suffix, value]) => `fill-${suffix} and an ink both resolve to ${value}`);

    expect(collisions, collisions.join('\n')).toEqual([]);
  });
});