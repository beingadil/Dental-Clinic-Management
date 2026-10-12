// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import {
  BRAND_SWATCHES,
  DEFAULT_BRAND_COLOR,
  FALLBACK_BRAND_SWATCH,
  applyBrandColor,
  resolveBrandColorId,
  resolveBrandSwatch,
  syncBrandColor,
} from '../../src/services/brandingTheme';

afterEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-brand');
});

/**
 * D7 — `branding.primaryColor` used to be a free-form value nobody read. These
 * pin the two things that matter now: only known swatches can be applied, and
 * anything else falls back to indigo instead of painting an unreadable accent.
 */
describe('brand colour (D7)', () => {
  it('offers exactly six swatches, all valid white-on-600 picks', () => {
    expect(BRAND_SWATCHES).toHaveLength(6);
    for (const swatch of BRAND_SWATCHES) {
      expect(swatch.hex).toBe(swatch.tokens['600']);
      expect(swatch.tokens['50']).toMatch(/^#[0-9a-f]{6}$/);
      expect(swatch.tokens['700']).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('resolves a stored swatch id or hex, case-insensitively', () => {
    expect(resolveBrandColorId('teal')).toBe('teal');
    expect(resolveBrandColorId('#0F766E')).toBe('teal');
    expect(resolveBrandColorId('  #0f766e  ')).toBe('teal');
  });

  it('falls back to indigo for missing, legacy or malformed values', () => {
    for (const value of [undefined, null, '', 'rebeccapurple', '#ff00ff', 'chartreuse']) {
      expect(resolveBrandSwatch(value)).toBe(FALLBACK_BRAND_SWATCH);
    }
    expect(resolveBrandColorId(undefined)).toBe(DEFAULT_BRAND_COLOR);
  });

  it('writes the whole token set onto the document and marks the swatch', () => {
    const applied = applyBrandColor('emerald');

    expect(applied).toBe('emerald');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--brand-600')).toBe('#047857');
    expect(root.style.getPropertyValue('--brand-700')).toBe('#065f46');
    expect(root.style.getPropertyValue('--brand-50')).toBe('#ecfdf5');
    expect(root.getAttribute('data-brand')).toBe('emerald');
  });

  it('repaints to indigo when a stored value stops being valid', () => {
    applyBrandColor('slate');
    applyBrandColor('not-a-colour');

    expect(document.documentElement.style.getPropertyValue('--brand-600')).toBe('#4f46e5');
    expect(document.documentElement.getAttribute('data-brand')).toBe('indigo');
  });
});

/**
 * The tints are written INLINE on documentElement, and `.dark` is toggled on
 * that same element — so the `.dark` remap in src/theme/dark.css could never
 * win for `--brand-50/100/200`. The pale light tint shipped into dark mode and
 * sat under remapped light ink: the active Settings rail item and the selected
 * accent swatch both read ~1.06:1. These pin the per-theme behaviour.
 */
describe('brand colour, dark theme', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark');
    syncBrandColor();
  });

  it('writes the dark tints when the dark class is already on', () => {
    document.documentElement.classList.add('dark');
    applyBrandColor('emerald');

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--brand-50')).toBe('#003220');
    expect(root.style.getPropertyValue('--brand-100')).toBe('#004129');
    expect(root.style.getPropertyValue('--brand-200')).toBe('#004930');
    // Fills hold their tone across the switch — that is what keeps white ink
    // readable on them.
    expect(root.style.getPropertyValue('--brand-600')).toBe('#047857');
  });

  it('follows a theme toggle without losing the chosen swatch', () => {
    applyBrandColor('teal');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--brand-50')).toBe('#f0fdfa');

    // What theme.ts does: flip the class, then repaint the tints.
    root.classList.add('dark');
    syncBrandColor();

    expect(root.style.getPropertyValue('--brand-50')).toBe('#00322d');
    expect(root.style.getPropertyValue('--brand-600')).toBe('#0f766e');
    expect(root.getAttribute('data-brand')).toBe('teal');

    // ...and back again, so the toggle is not one-way.
    root.classList.remove('dark');
    syncBrandColor();
    expect(root.style.getPropertyValue('--brand-50')).toBe('#f0fdfa');
  });

  it('gives every swatch a dark tint that clears 4.5:1 under the dark brand ink', () => {
    // The two inks the dark theme puts on an accent surface:
    // --color-ink-brand (#a5b4ff) and --color-ink-brand-strong (#c7d2fe).
    const ink = '#a5b4fc';
    const inkStrong = '#c7d2fe';

    const luminance = (hex: string) => {
      const n = hex.replace('#', '')
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
      const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    };
    const contrast = (a: string, b: string) => {
      const [x, y] = [luminance(a), luminance(b)]
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
    };

    for (const swatch of BRAND_SWATCHES) {
      expect(contrast(swatch.dark['50'], inkStrong)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(swatch.dark['50'], ink)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(swatch.dark['100'], inkStrong)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(swatch.dark['200'], inkStrong)).toBeGreaterThanOrEqual(4.5);
      // The regression itself: a light tint under light ink.
      for (const step of ['50', '100', '200'] as const) {
        expect(contrast(swatch.dark[step], inkStrong)).toBeGreaterThan(
          contrast(swatch.tokens[step], inkStrong),
        )
      }
    }
  });

  it('keeps every swatch dark tint genuinely dark', () => {
    const luminance = (hex: string) => {
      const n = hex.replace('#', '')
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
      const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }
    const card = luminance('#0f1826') // --color-white in dark
    for (const swatch of BRAND_SWATCHES) {
      for (const step of ['50', '100', '200'] as const) {
        // A tint must stay a surface: near-black, and only a step off the card.
        expect(luminance(swatch.dark[step])).toBeLessThan(card * 6)
        expect(luminance(swatch.dark[step])).toBeGreaterThan(card)
      }
    }
  });
});
