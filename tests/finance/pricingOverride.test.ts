/**
 * Pricing overrides — which one governs a case, TODAY.
 *
 * WHY THIS TEST EXISTS
 * `lab_pricing_overrides.effective_date` was collected by Lab Pricing Manager,
 * persisted and displayed in its own table, and then ignored: the case wizard
 * resolved overrides with a bare `.find(...)`, i.e. first match wins, with no
 * date in the condition at all. So an override an operator deliberately dated
 * for the first of next month was charging today's cases immediately and
 * nothing on screen said so.
 *
 * These pin the replacement rule, including the two cases that are easy to get
 * wrong: an undated override must keep working forever (every row that predates
 * the column has no date), and a dated one must beat an undated one when both
 * qualify.
 */
import { describe, expect, it } from 'vitest';
import { resolvePricingOverride, overrideIsEffective } from '../../src/services/pricingOverride';

const TODAY = '2026-10-15';

const override = (over: Partial<{ lab_id: string; case_type_id: string; custom_price: number; discount_percentage: number; effective_date: string | null }> = {}) => ({
  lab_id: 'lab-1',
  case_type_id: 'ct-1',
  custom_price: 5000,
  discount_percentage: 0,
  effective_date: null as string | null,
  ...over,
});

describe('overrideIsEffective', () => {
  it('applies an override with no date at all, forever', () => {
    // Every row written before effective_date existed has no date. Dropping
    // those would silently delete every price override in an upgraded database.
    expect(overrideIsEffective(override(), TODAY)).toBe(true);
    expect(overrideIsEffective(override({ effective_date: null }), TODAY)).toBe(true);
    expect(overrideIsEffective(override({ effective_date: '' }), TODAY)).toBe(true);
  });

  it('applies an override dated today', () => {
    expect(overrideIsEffective(override({ effective_date: TODAY }), TODAY)).toBe(true);
  });

  it('applies an override dated in the past', () => {
    expect(overrideIsEffective(override({ effective_date: '2026-01-01' }), TODAY)).toBe(true);
  });

  it('does NOT apply an override dated in the future', () => {
    // This is the bug. The date was collected, stored, shown in the table and
    // then not consulted, so a future-dated price change applied immediately.
    expect(overrideIsEffective(override({ effective_date: '2026-11-01' }), TODAY)).toBe(false);
  });

  it('treats an unparseable date as undated rather than blocking the price', () => {
    // Better a price that may be stale than a case that cannot be priced.
    expect(overrideIsEffective(override({ effective_date: 'soon' }), TODAY)).toBe(true);
  });
});

describe('resolvePricingOverride', () => {
  it('returns undefined when nothing matches, so the base price stands', () => {
    expect(resolvePricingOverride([override({ lab_id: 'other' })], 'lab-1', 'ct-1', TODAY)).toBeUndefined();
    expect(resolvePricingOverride([], 'lab-1', 'ct-1', TODAY)).toBeUndefined();
  });

  it('matches on lab AND case type together', () => {
    const rows = [override({ case_type_id: 'ct-2' })];
    expect(resolvePricingOverride(rows, 'lab-1', 'ct-1', TODAY)).toBeUndefined();
  });

  it('skips a future-dated override and uses the in-force one instead', () => {
    const current = override({ custom_price: 4000, effective_date: '2026-01-01' });
    const future = override({ custom_price: 9000, effective_date: '2026-12-01' });
    expect(resolvePricingOverride([future, current], 'lab-1', 'ct-1', TODAY)?.custom_price).toBe(4000);
  });

  it('ignores a future override even when it is the only row', () => {
    const future = override({ effective_date: '2026-12-01' });
    expect(resolvePricingOverride([future], 'lab-1', 'ct-1', TODAY)).toBeUndefined();
  });

  it('lets the most recently effective override win, not row order', () => {
    // `.find` took whichever row SQLite happened to return first. A correction
    // has to supersede the row it corrects regardless of insertion order.
    const older = override({ custom_price: 4000, effective_date: '2026-01-01' });
    const newer = override({ custom_price: 4500, effective_date: '2026-06-01' });
    expect(resolvePricingOverride([older, newer], 'lab-1', 'ct-1', TODAY)?.custom_price).toBe(4500);
    expect(resolvePricingOverride([newer, older], 'lab-1', 'ct-1', TODAY)?.custom_price).toBe(4500);
  });

  it('lets a dated override outrank an undated one', () => {
    const undated = override({ custom_price: 3000 });
    const dated = override({ custom_price: 3500, effective_date: '2026-02-01' });
    expect(resolvePricingOverride([undated, dated], 'lab-1', 'ct-1', TODAY)?.custom_price).toBe(3500);
    expect(resolvePricingOverride([dated, undated], 'lab-1', 'ct-1', TODAY)?.custom_price).toBe(3500);
  });

  it('ignores a discount on a future-dated override', () => {
    const future = override({ custom_price: 9000, discount_percentage: 50, effective_date: '2027-01-01' });
    expect(resolvePricingOverride([future], 'lab-1', 'ct-1', TODAY)).toBeUndefined();
  });
});
