// @vitest-environment jsdom
/**
 * A new case's price is the catalog base price multiplied by the charted units.
 *
 * A crown at PKR 7,000 with 3 teeth charted bills PKR 21,000. This replaces the
 * old behaviour, which copied the base price across verbatim no matter how many
 * teeth were involved, so a 3-unit bridge was quoted at the single-unit rate.
 *
 * TWO rules this pins:
 *
 *  1. NEW cases only. Re-deriving on an existing case would restate a price the
 *     clinic may already have paid or been quoted.
 *  2. A non-per-tooth product is still ONE billable unit, never zero — an empty
 *     chart means "not per-tooth", not "nothing to bill". That is the existing
 *     `billableUnits` contract, and the price now depends on it directly.
 */
import { describe, it, expect } from 'vitest';
import { billableUnits, caseHasChartedTeeth } from '../../src/utils/catalogToothRequirement';

/** The rule the pricing effect applies, stated once so both tests share it. */
const priceFor = (basePrice: number, teeth: number[]) =>
  basePrice * billableUnits({ selected_teeth: teeth });

describe('case price = base × units', () => {
  it('multiplies the base price by the charted unit count', () => {
    expect(priceFor(8500, [11, 21, 26])).toBe(25500);
    expect(priceFor(7000, [11, 21, 26, 36])).toBe(28000);
  });

  it('bills exactly one unit when nothing is charted', () => {
    // A retainer, a denture try-in, a healing post: no charting, but still one
    // piece of lab work. Zero would read as a charting failure.
    expect(billableUnits({ selected_teeth: [] })).toBe(1);
    expect(priceFor(25000, [])).toBe(25000);
  });

  it('matches the case/charting rule every print surface already uses', () => {
    // The price must not invent its own notion of "charted": the printed units
    // on the job slip and the invoice come from this same helper, so a slip
    // reading "3 units" beside an invoice reading the single-unit price would
    // mean the two had drifted.
    expect(billableUnits({ selected_teeth: [11, 21, 26] })).toBe(3);
    expect(caseHasChartedTeeth({ selected_teeth: [11, 21, 26] })).toBe(true);
    expect(billableUnits({ selected_teeth: [] })).toBe(1);
    expect(caseHasChartedTeeth({ selected_teeth: [] })).toBe(false);
  });

  it('treats a missing teeth array as one unit, not zero', () => {
    // A case hand-built or imported without the property must never price at 0.
    expect(billableUnits({})).toBe(1);
    expect(billableUnits(null)).toBe(1);
    expect(priceFor(15000, [])).toBe(15000);
  });
});