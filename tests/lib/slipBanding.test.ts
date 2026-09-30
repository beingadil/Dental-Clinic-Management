import { describe, it, expect } from 'vitest';
import { slipBandFor, guessCategory } from '../../src/lib/slipBanding';

/**
 * Slip banding contract: every case-type category maps to a distinct band
 * (color + grayscale-distinguishable luminance), unknown/missing categories
 * fall back to neutral, and the name guesser covers the catalog vocabulary.
 */

describe('slipBandFor', () => {
  it('maps all five categories to distinct backgrounds', () => {
    const cats = ['crown_bridge', 'implant', 'denture', 'orthodontic', 'veneers'];
    const bg = new Set(cats.map((c) => slipBandFor(c).background));
    expect(bg.size).toBe(5);
  });

  it('falls back to a neutral band for unknown and missing categories', () => {
    expect(slipBandFor(null).label).toBe('JOB');
    expect(slipBandFor(undefined).label).toBe('JOB');
    expect(slipBandFor('mystery').label).toBe('JOB');
  });
});

describe('guessCategory', () => {
  it('recognizes the real catalog names', () => {
    expect(guessCategory('Zirconia Crown')).toBe('crown_bridge');
    expect(guessCategory('Zirconia Bridge (3-Unit)')).toBe('crown_bridge');
    expect(guessCategory('Acrylic Denture (Complete)')).toBe('denture');
    expect(guessCategory('Implant Crown')).toBe('implant');
    expect(guessCategory('Veneer E-max')).toBe('veneers');
    expect(guessCategory('Orthodontic Aligner')).toBe('orthodontic');
  });

  it('is case-insensitive and rejects empty names', () => {
    expect(guessCategory('ZIRCONIA CROWN')).toBe('crown_bridge');
    expect(guessCategory('')).toBeNull();
    expect(guessCategory(null)).toBeNull();
  });
});
