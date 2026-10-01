// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import {
  BRAND_SWATCHES,
  DEFAULT_BRAND_COLOR,
  FALLBACK_BRAND_SWATCH,
  applyBrandColor,
  resolveBrandColorId,
  resolveBrandSwatch,
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
