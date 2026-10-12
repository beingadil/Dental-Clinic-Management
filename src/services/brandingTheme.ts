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
 * THE `dark` SET IS NOT OPTIONAL
 * `applyBrandColor()` writes the tint tokens as INLINE styles on
 * documentElement. theme.ts toggles `.dark` on that same element, and an
 * inline declaration outranks any stylesheet rule for that element — so the
 * dark-safe `--brand-50/100/200` declared in src/theme/dark.css could never
 * reach the screen. The pale tint survived into dark mode and landed under
 * remapped light ink: the active Settings rail item and the selected accent
 * swatch both measured ~1.06:1 (pale #eef2ff behind #c7d2fe).
 *
 * So each swatch carries its own dark readings. They reuse the exact L/C
 * profile of the indigo reference already shipped in dark.css (a recessed
 * surface a step above the card), re-hued per accent and capped at the
 * accent's own chroma so Graphite stays near-neutral. Every
 * `bg-brand-50 + text-brand-700` / `bg-brand-100 + text-brand-700` pairing
 * clears 6.9:1 against the dark brand ink.
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
  /** Tinted surfaces for the LIGHT theme. */
  tokens: {
    '50': string;
    '100': string;
    '200': string;
    '600': string;
    '700': string;
  };
  /**
   * The same three tints for the DARK theme. `600`/`700` are deliberately
   * absent: those are fills under white ink and hold one tone across the
   * switch (see src/theme/dark.css).
   */
  dark: {
    '50': string;
    '100': string;
    '200': string;
  };
}

export const BRAND_SWATCHES: readonly BrandSwatch[] = [
  {
    id: 'indigo',
    name: 'Indigo',
    note: 'Product default — neutral, clinical.',
    hex: '#4f46e5',
    tokens: { '50': '#eef2ff', '100': '#e0e7ff', '200': '#c7d2fe', '600': '#4f46e5', '700': '#4338ca' },
    dark: { '50': '#202349', '100': '#2a2e5f', '200': '#303567' },
  },
  {
    id: 'violet',
    name: 'Violet',
    note: 'Warmer, more saturated.',
    hex: '#7c3aed',
    tokens: { '50': '#f5f3ff', '100': '#ede9fe', '200': '#ddd6fe', '600': '#7c3aed', '700': '#6d28d9' },
    dark: { '50': '#2a2046', '100': '#372a5b', '200': '#3d3164' },
  },
  {
    id: 'sky',
    name: 'Ocean',
    note: 'Cool blue, reads as calm.',
    hex: '#0369a1',
    tokens: { '50': '#f0f9ff', '100': '#e0f2fe', '200': '#bae6fd', '600': '#0369a1', '700': '#075985' },
    dark: { '50': '#002b46', '100': '#00375c', '200': '#003f64' },
  },
  {
    id: 'teal',
    name: 'Teal',
    note: 'Clinical green-blue.',
    hex: '#0f766e',
    tokens: { '50': '#f0fdfa', '100': '#ccfbf1', '200': '#99f6e4', '600': '#0f766e', '700': '#115e59' },
    dark: { '50': '#00322d', '100': '#00413b', '200': '#004942' },
  },
  {
    id: 'emerald',
    name: 'Emerald',
    note: 'Growth/settled; pairs with the paid badge.',
    hex: '#047857',
    tokens: { '50': '#ecfdf5', '100': '#d1fae5', '200': '#a7f3d0', '600': '#047857', '700': '#065f46' },
    dark: { '50': '#003220', '100': '#004129', '200': '#004930' },
  },
  {
    id: 'slate',
    name: 'Graphite',
    note: 'Near-monochrome for document-first labs.',
    hex: '#475569',
    tokens: { '50': '#f8fafc', '100': '#f1f5f9', '200': '#e2e8f0', '600': '#475569', '700': '#334155' },
    dark: { '50': '#1c283a', '100': '#283547', '200': '#2f3c4f' },
  },
] as const;

export const DEFAULT_BRAND_COLOR: BrandColorId = 'indigo';

/** The fallback accent, used for a missing, malformed or unknown stored value. */
export const FALLBACK_BRAND_SWATCH = BRAND_SWATCHES[0];

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
 * The swatch most recently painted, cached so a THEME CHANGE can re-write the
 * tints without re-reading settings. `--brand-50/100/200` are theme-dependent
 * (see the module header), so toggling light <-> dark has to repaint them or
 * the accent surface keeps the other theme's value.
 */
let paintedSwatch: BrandSwatch | null = null;

/**
 * Write the inline custom properties. Split from applyBrandColor so the theme
 * toggle can repaint the tints without knowing which swatch is stored.
 */
function paint(swatch: BrandSwatch): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  // The tints are theme-DEPENDENT; the fills are not (a saturated slab holds
  // one tone so white ink keeps its contrast either way).
  const dark = root.classList.contains('dark');
  const tint = dark ? swatch.dark : swatch.tokens;
  root.style.setProperty('--brand-50', tint['50']);
  root.style.setProperty('--brand-100', tint['100']);
  root.style.setProperty('--brand-200', tint['200']);
  root.style.setProperty('--brand-600', swatch.tokens['600']);
  root.style.setProperty('--brand-700', swatch.tokens['700']);
  // `data-brand` lets print/CSS opt out of the accent entirely.
  root.setAttribute('data-brand', swatch.id);
}

/**
 * Paint the accent into the document. Called on boot and whenever
 * `branding.primaryColor` changes, so every `brand-*` utility re-resolves.
 * Safe to call with no DOM (tests, node) — it simply does nothing.
 */
export function applyBrandColor(value?: string | null): BrandColorId {
  const swatch = resolveBrandSwatch(value);
  paintedSwatch = swatch;
  paint(swatch);
  return swatch.id;
}

/**
 * Repaint the accent for the CURRENT theme, keeping the chosen swatch.
 *
 * theme.ts calls this after it toggles `.dark`. Without it the tint tokens
 * would be stranded on the other theme's values — the exact failure that had
 * the pale brand surface sitting under remapped light ink in dark mode.
 * Safe to call before an accent has ever been painted: it then paints the
 * fallback, which is what the `:root` defaults already declare.
 */
export function syncBrandColor(): void {
  paint(paintedSwatch ?? FALLBACK_BRAND_SWATCH);
}
