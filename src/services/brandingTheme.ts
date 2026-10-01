/**
 * D7 — brand colour theming.
 *
 * `branding.primaryColor` used to be a free-form colour input that painted
 * nothing: the value was stored and then ignored by every surface. This module
 * turns it into the single source of truth for the app's accent, limited to a
 * fixed swatch list so an unreadable accent can never reach the UI.
 *
 * Every `600` below has been contrast-checked for white text on top
 * (>= 4.5:1, WCAG AA for body text); `700` is the hover/pressed shade and `50`
 * / `100` / `200` are the tinted surfaces (chips, callouts, borders).
 *
 * Print ink is deliberately untouched: nothing here is read by the print
 * stylesheets, so changing the accent never changes paper.
 */

export type BrandColorId =
  | 'indigo'
  | 'violet'
  | 'sky'
  | 'teal'
  | 'emerald'
  | 'slate';

export interface BrandSwatch {
  id: BrandColorId;
  /** Human label shown in Settings → Branding. */
  name: string;
  /** Short description of what this accent reads as. */
  note: string;
  /** The stored `primaryColor` value (the 600 shade). */
  hex: string;
  tokens: {
    '50': string;
    '100': string;
    '200': string;
    '600': string;
    '700': string;
  };
}

export const BRAND_SWATCHES: readonly BrandSwatch[] = [
  {
    id: 'indigo',
    name: 'Indigo',
    note: 'Product default — neutral, clinical.',
    hex: '#4f46e5',
    tokens: { '50': '#eef2ff', '100': '#e0e7ff', '200': '#c7d2fe', '600': '#4f46e5', '700': '#4338ca' },
  },
  {
    id: 'violet',
    name: 'Violet',
    note: 'Warmer, more saturated.',
    hex: '#7c3aed',
    tokens: { '50': '#f5f3ff', '100': '#ede9fe', '200': '#ddd6fe', '600': '#7c3aed', '700': '#6d28d9' },
  },
  {
    id: 'sky',
    name: 'Ocean',
    note: 'Cool blue, reads as calm.',
    hex: '#0369a1',
    tokens: { '50': '#f0f9ff', '100': '#e0f2fe', '200': '#bae6fd', '600': '#0369a1', '700': '#075985' },
  },
  {
    id: 'teal',
    name: 'Teal',
    note: 'Clinical green-blue.',
    hex: '#0f766e',
    tokens: { '50': '#f0fdfa', '100': '#ccfbf1', '200': '#99f6e4', '600': '#0f766e', '700': '#115e59' },
  },
  {
    id: 'emerald',
    name: 'Emerald',
    note: 'Growth/settled; pairs with the paid badge.',
    hex: '#047857',
    tokens: { '50': '#ecfdf5', '100': '#d1fae5', '200': '#a7f3d0', '600': '#047857', '700': '#065f46' },
  },
  {
    id: 'slate',
    name: 'Graphite',
    note: 'Near-monochrome for document-first labs.',
    hex: '#475569',
    tokens: { '50': '#f8fafc', '100': '#f1f5f9', '200': '#e2e8f0', '600': '#475569', '700': '#334155' },
  },
] as const;

export const DEFAULT_BRAND_COLOR: BrandColorId = 'indigo';

/** The fallback accent, used for a missing, malformed or unknown stored value. */
export const FALLBACK_BRAND_SWATCH = BRAND_SWATCHES[0];

/** Every CSS custom property `applyBrandColor` writes. */
export const BRAND_TOKEN_KEYS = ['--brand-50', '--brand-100', '--brand-200', '--brand-600', '--brand-700'] as const;

const SWATCH_BY_ID = new Map(BRAND_SWATCHES.map((s) => [s.id, s]));
const SWATCH_BY_HEX = new Map(BRAND_SWATCHES.map((s) => [s.hex.toLowerCase(), s]));

/**
 * Map whatever is stored in `branding.primaryColor` back to a known swatch.
 * Accepts the swatch id or its hex (case/whitespace insensitive); anything
 * else — including the old free-form colours and `''` — falls back to indigo
 * so the UI is never painted with an unknown accent.
 */
export function resolveBrandSwatch(value?: string | null): BrandSwatch {
  if (!value) return FALLBACK_BRAND_SWATCH;
  const raw = value.trim().toLowerCase();
  return SWATCH_BY_ID.get(raw as BrandColorId) || SWATCH_BY_HEX.get(raw) || FALLBACK_BRAND_SWATCH;
}

/** Narrow `primaryColor` to a `BrandColorId`, for `<input type="radio">` state. */
export function resolveBrandColorId(value?: string | null): BrandColorId {
  return resolveBrandSwatch(value).id;
}

/**
 * Paint the accent into the document. Called on boot and whenever
 * `branding.primaryColor` changes, so every `brand-*` utility re-resolves.
 * Safe to call with no DOM (tests, node) — it simply does nothing.
 */
export function applyBrandColor(value?: string | null): BrandColorId {
  const swatch = resolveBrandSwatch(value);
  if (typeof document === 'undefined') return swatch.id;
  const root = document.documentElement;
  root.style.setProperty('--brand-50', swatch.tokens['50']);
  root.style.setProperty('--brand-100', swatch.tokens['100']);
  root.style.setProperty('--brand-200', swatch.tokens['200']);
  root.style.setProperty('--brand-600', swatch.tokens['600']);
  root.style.setProperty('--brand-700', swatch.tokens['700']);
  // `data-brand` lets print/CSS opt out of the accent entirely.
  root.setAttribute('data-brand', swatch.id);
  return swatch.id;
}
