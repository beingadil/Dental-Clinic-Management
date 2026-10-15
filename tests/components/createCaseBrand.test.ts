/**
 * The Create Case form must obey the operator's brand.
 *
 * The product is white-label: each lab picks an accent from `BRAND_SWATCHES`
 * (indigo, violet, sky, teal, ...), and `applyBrandColor()` repoints the
 * `--brand-*` tokens that `bg-brand-600` / `text-brand-700` resolve against.
 *
 * The form carried 32 hardcoded `indigo-*` utilities. Indigo happens to be the
 * FIRST swatch and its hex (`#4f46e5`) is also the default `--brand-600`, so
 * nothing looked wrong in development and every screenshot passed review — the
 * form was indigo, which is exactly right for a lab that had picked indigo and
 * exactly wrong for every other lab. The failure was invisible until someone
 * chose a different colour, at which point the most-used screen in the product
 * quietly stopped being theirs.
 *
 * This test is a source-level guard because the failure mode is invisible: there
 * is no runtime error, no failing assertion anywhere else, and the contrast
 * audit passes, because it grades whatever colour is actually painted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BRAND_SWATCHES } from '../../src/services/brandingTheme';

const FORM = resolve(__dirname, '../../src/components/cases/CaseDetailModal.tsx');
const CHART_TSX = resolve(__dirname, '../../src/components/cases/Odontogram.tsx');
const CHART_CSS = resolve(__dirname, '../../src/components/cases/Odontogram.css');

const source = readFileSync(FORM, 'utf8');
const chartTsx = readFileSync(CHART_TSX, 'utf8');
const chartCss = readFileSync(CHART_CSS, 'utf8');

/** The raw indigo values that were hardcoded in the chart's paint rules. */
const INDIGO_HEX = ['#eef2ff', '#e0e7ff', '#4f46e5', '#4338ca'];

/** Every `indigo-<n>` utility occurrence, with the line it sits on. */
function indigoUsages(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  src.split('\n').forEach((raw, i) => {
    // Strip line comments so a comment explaining the rule is not a violation.
    const line = raw.replace(/\/\/.*$/, '');
    if (/\bindigo-\d/.test(line)) out.push({ line: i + 1, text: raw.trim() });
  });
  return out;
}

describe('Create Case form — brand obedience', () => {
  it('hardcodes no palette colour anywhere in the form', () => {
    const found = indigoUsages(source);
    expect(
      found.map((f) => `line ${f.line}: ${f.text}`).join('\n')
    ).toBe('');
  });

  it('actually has more than one brand to choose between', () => {
    // The guard above is only meaningful because the product is white-label.
    // If BRAND_SWATCHES ever collapses to a single swatch this whole file is
    // protecting nothing, and should be deleted rather than left looking safe.
    expect(BRAND_SWATCHES.length).toBeGreaterThan(1);
    const hexes = new Set(BRAND_SWATCHES.map((s) => s.hex));
    expect(hexes.size).toBe(BRAND_SWATCHES.length);
  });

  it('paints its focus ring with a brand token, not a fixed colour', () => {
    // A form whose focus ring ignores the brand is still a brand-violating form
    // even when every other accent is correct.
    const focusRings = source.match(/focus:ring-[a-z]+-\d+(?:\/\d+)?/g) || [];
    expect(focusRings.length).toBeGreaterThan(0);
    expect(focusRings.filter((f) => f.startsWith('focus:ring-brand-')).length).toBe(
      focusRings.length
    );
  });

  it('only uses brand shades the design system actually defines', () => {
    // `--color-brand-*` exists for 50, 100, 200, 600 and 700 ONLY. A blind
    // `indigo-300` -> `brand-300` rewrite emits a class that does not exist,
    // and Tailwind emits no rule for it — so the element silently falls back to
    // unstyled. That failure is as invisible as the hardcoding itself.
    const DEFINED = new Set(['50', '100', '200', '600', '700']);
    const used = (source.match(/brand-(\d{2,3})\b/g) || []).map((u) => u.replace('brand-', ''));
    const undefinedShades = [...new Set(used.filter((u) => !DEFINED.has(u)))];
    expect(undefinedShades).toEqual([]);
  });

  it('does not paint a brand token onto a permanently dark surface', () => {
    // `brand-700` is a dark ink for LIGHT surfaces. On a fixed `bg-slate-900`
    // plate or the dark attachment overlay it is invisible, and the brand tint
    // set is solved against the app's own backgrounds, not an arbitrary dark
    // one. Those places must use neutral ink instead.
    //
    // Checked per LINE, not across a character window: a window cannot tell a
    // real nesting from two mutually-exclusive branches of one ternary, which
    // is how the first version of this test reported a false positive on
    // `active ? 'bg-slate-900 text-white' : 'bg-brand-600/10 text-brand-700'`.
    // The dark plates below are fixed surfaces, so a brand class on the SAME
    // line as the dark fill is always the violation.
    const lines = source.split('\n');
    const violations = lines
      .map((raw, i) => ({ line: i + 1, text: raw.trim() }))
      // `bg-slate-900/10`-style translucent rings are not a dark plate.
      .filter((l) => /\bbg-slate-900\b(?![\/\w-])/.test(l.text) && /text-brand-/.test(l.text));

    expect(violations.map((v) => `line ${v.line}: ${v.text}`).join('\n')).toBe('');
  });

  it('keeps the two known fixed-dark plates on neutral ink', () => {
    // The final-price plate and the CAD/stl preview stage. Both are hardcoded
    // dark regardless of theme, so their ink is pinned to a neutral and must
    // stay that way even though the label above them is now brand-adjacent.
    const pricePlate = source.slice(source.indexOf('bg-slate-900 p-5'), source.indexOf('bg-slate-900 p-5') + 900);
    expect(pricePlate).not.toMatch(/text-brand-\d/);
    expect(pricePlate).toMatch(/text-slate-\d/);
  });
});

/**
 * The same bug lived in the odontogram, in both the component and the CSS that
 * paints the chart — so the chart, the single most-seen element in the product,
 * ignored the lab's brand even after the form around it had been fixed.
 */
describe('Odontogram — brand obedience', () => {
  it('hardcodes no palette colour in the chart component', () => {
    const found = indigoUsages(chartTsx);
    expect(found.map((f) => `line ${f.line}: ${f.text}`).join('\n')).toBe('');
  });

  it('paints light-mode chart states through the brand tokens', () => {
    // The selected / hovered / focused tooth fills and strokes. These were raw
    // indigo hex, which is what kept "All 32 Units" indigo after the form was
    // fixed.
    //
    // Comments are stripped first: the rules below this test explain the change
    // in the file itself and necessarily quote the old values, so an unstripped
    // scan fails on its own documentation.
    const bare = chartCss.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
    for (const hex of INDIGO_HEX) {
      const lines = bare
        .split('\n')
        .map((raw, i) => ({ line: i + 1, text: raw }))
        .filter((l) => l.text.toLowerCase().includes(hex));
      expect(lines.map((l) => `line ${l.line}: ${l.text.trim()}`).join('\n')).toBe('');
    }
  });

  it('does not override the accent chip in dark mode', () => {
    // `dark.css` already repoints --brand-50/100/200 per swatch, so a dark
    // override here can only subtract from that. The pair that existed
    // hardcoded indigo-dark and silently un-fixed the bug in dark mode.
    expect(chartCss).not.toMatch(/\.dark\s+\.dsp-chip-accent\s*\{/);
  });

  it('leaves no dead rules behind for a class that no longer exists', () => {
    expect(chartCss).not.toMatch(/dsp-chip-danger/);
    expect(chartTsx).not.toMatch(/dsp-chip-danger/);
  });

  it('documents the one dark-mode accent it cannot yet resolve', () => {
    // `.dark .dsp-fdi-active` still hardcodes a light brand ink: the token set
    // has no dark-mode light brand slot (600/700 are theme-invariant by design).
    // It is commented as a known gap rather than quietly left, so the next
    // person finds the reason instead of re-discovering it.
    expect(chartCss).toMatch(/KNOWN GAP/);
  });
});