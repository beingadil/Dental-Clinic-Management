/**
 * Which pricing override applies to a case, TODAY.
 *
 * WHY THIS IS ITS OWN MODULE
 * `lab_pricing_overrides` rows carry an `effective_date`. The Lab Pricing
 * Manager collects it, stores it, and displays it in its own table — and the
 * case wizard ignored it entirely, resolving with a bare
 *
 *     pricingOverrides.find((po) => po.lab_id === labId && po.case_type_id === caseTypeId)
 *
 * which is `.find`, i.e. first match wins. So an override an operator had
 * deliberately dated for the first of next month was charging today's cases
 * immediately, and nothing on screen said so. The date was decoration.
 *
 * The rule here is the obvious one and is now the only one:
 *
 *   - an override with NO effective date applies always (that is how every
 *     override written before this field existed must keep behaving);
 *   - an override dated today or earlier applies;
 *   - an override dated in the future does NOT apply yet.
 *
 * When several qualify, the most recently effective one wins — that is the only
 * sensible ordering, and it makes a correction supersede the row it corrects
 * instead of depending on row order in SQLite.
 */
import type { LabPricingOverride } from '../types';

/** Anything the resolver needs. Narrower than the row type on purpose, so the
 *  rule is testable without constructing a whole override. */
export interface PricedOverride {
  lab_id: string;
  case_type_id: string;
  custom_price: number;
  discount_percentage?: number | null;
  effective_date?: string | null;
}

/** ISO date for `d`, local day — the same helper the SLA module uses, so the
 *  two cannot disagree about what "today" is. */
const localDay = (d: Date): string => {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** True when the override is in force on `todayStr`. */
export const overrideIsEffective = (po: PricedOverride, todayStr: string): boolean => {
  // Undated = always in force. Rows written before effective_date existed, and
  // rows synced from an older database, land here.
  if (!po.effective_date) return true;
  // ISO dates compare correctly as strings, which also keeps this free of Date
  // parsing and its timezone edge cases. Anything unparseable is treated as
  // undated rather than silently blocking a price.
  if (!/^\d{4}-\d{2}-\d{2}/.test(po.effective_date)) return true;
  return po.effective_date.slice(0, 10) <= todayStr;
};

/**
 * The override that governs this lab + case type today, or `undefined` when the
 * catalogue base price stands.
 */
export function resolvePricingOverride<T extends PricedOverride>(
  overrides: readonly T[],
  labId: string,
  caseTypeId: string,
  todayStr: string = localDay(new Date()),
): T | undefined {
  let winner: T | undefined;
  for (const po of overrides) {
    if (po.lab_id !== labId || po.case_type_id !== caseTypeId) continue;
    if (!overrideIsEffective(po, todayStr)) continue;
    if (!winner) {
      winner = po;
      continue;
    }
    // Most recently effective wins. Undated rows rank below any dated row,
    // because a dated row is the deliberate one.
    const winnerDate = winner.effective_date?.slice(0, 10) ?? '';
    const thisDate = po.effective_date?.slice(0, 10) ?? '';
    if (thisDate > winnerDate) winner = po;
  }
  return winner;
}

/** Convenience wrapper over the row type, for call sites holding real state. */
export const resolveOverrideForCase = (
  overrides: readonly LabPricingOverride[],
  labId: string,
  caseTypeId: string,
  todayStr?: string,
): LabPricingOverride | undefined =>
  resolvePricingOverride(overrides, labId, caseTypeId, todayStr);
