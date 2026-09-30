/**
 * Slip color banding — case-type category → edge band color.
 *
 * The compact job slip carries a 3mm colored band on its left edge so
 * physical job bags are sortable at a glance. Palette is drawn from the
 * app's brand-agnostic status colors, chosen to stay distinguishable when
 * printed in black-and-white: the bands pair color with DIFFERENT luminance
 * levels (light pastel → deep saturated), so grayscale output preserves the
 * grouping even though the hue is gone.
 *
 * Unknown/missing categories fall back to neutral slate — never break the
 * slip layout over a missing optional field.
 */

export type CaseTypeCategory = 'crown_bridge' | 'implant' | 'denture' | 'orthodontic' | 'veneers';

export interface SlipBand {
  /** Inline background for the band (hex, prints with backgrounds on). */
  background: string;
  /** Tailwind text tone for a tiny category label (screen hint only). */
  text: string;
  /** Human label shown on the band. */
  label: string;
}

/** Ordered by grayscale luminance: light → mid → deep → mid → darkest. */
const PALETTE: Record<CaseTypeCategory, SlipBand> = {
  crown_bridge: { background: '#fde68a', text: 'text-amber-800', label: 'CROWN' },   // amber-200 — light
  implant:      { background: '#93c5fd', text: 'text-blue-900',  label: 'IMPLANT' }, // blue-300 — mid
  denture:      { background: '#86efac', text: 'text-green-900', label: 'DENTURE' }, // green-300 — light-mid
  veneers:      { background: '#f9a8d4', text: 'text-pink-900', label: 'VENEER' },  // pink-300 — mid
  orthodontic:  { background: '#a78bfa', text: 'text-violet-950', label: 'ORTHO' },  // violet-400 — deep
};

const FALLBACK: SlipBand = { background: '#cbd5e1', text: 'text-slate-800', label: 'JOB' }; // slate-300

export function slipBandFor(category?: string | null): SlipBand {
  if (category && category in PALETTE) return PALETTE[category as CaseTypeCategory];
  return FALLBACK;
}

/** Best-effort category guess from a free-text case-type name (no DB hit). */
export function guessCategory(caseTypeName?: string | null): CaseTypeCategory | null {
  const n = (caseTypeName || '').toLowerCase();
  if (!n) return null;
  if (/implant/.test(n)) return 'implant';
  if (/denture|acrylic|full arch|complete/.test(n)) return 'denture';
  if (/ortho|aligner|retainer|bracket/.test(n)) return 'orthodontic';
  if (/veneer|e-?max|laminate/.test(n)) return 'veneers';
  if (/crown|bridge|zirconia|copin|pfm/.test(n)) return 'crown_bridge';
  return null;
}
