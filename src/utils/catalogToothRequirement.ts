/**
 * The catalog's per-tooth flag, resolved in exactly one place.
 *
 * `needs_teeth` is deliberately OPTIONAL on the domain type. Migration 021 adds
 * the column with `NOT NULL DEFAULT 1`, so every row that existed before it
 * carries 1, but a hand-built CaseType, a partial payload, or a row that came
 * from state without the property has nothing at all. Both of those must read
 * as "required" — that is the behaviour every product had before the flag
 * existed — so the absent case is never treated as an opt-out.
 *
 * There are two separate resolutions, and conflating them is how this drifts:
 *
 *   1. WHAT THE PRODUCT IS — `catalogNeedsTeeth(row)`, from the catalog.
 *      Drives whether the case wizard may skip charting.
 *   2. WHAT THE CASE ACTUALLY IS — `caseHasChartedTeeth(case)`, from the
 *      committed teeth array. Drives every printed/ledger surface.
 *
 * Outputs deliberately use (2), not (1): a product flagged "no teeth" commits
 * an EMPTY teeth array, so the outputs stay correct without knowing about the
 * catalog flag at all. That contract only holds if the wizard commits
 * emptiness, so the two resolutions are named here together and nowhere else.
 */

/** The catalog shape this helper reads. Structural, so partials still typecheck. */
export interface ToothRequirementFlag {
  needs_teeth?: boolean | null;
}

/** A case's committed charting. Only the teeth array matters here. */
export interface ChartedCase {
  selected_teeth?: number[] | null;
}

/**
 * Whether a catalog product is per-tooth work.
 *
 * Absent, null, or otherwise-not-false means REQUIRED. Only an explicit
 * `false` is an opt-out — that is the single value the operator can set in
 * CatalogView and the only one migration 021 writes as 0.
 */
export function catalogNeedsTeeth(catalog: ToothRequirementFlag | null | undefined): boolean {
  return catalog?.needs_teeth !== false;
}

/**
 * Encode the flag for SQLite.
 *
 * Anything that is not exactly `false` stores 1. This is the inverse of
 * `catalogNeedsTeeth` and must stay its exact mirror: if the two ever disagree,
 * a round-trip through the database flips the product's meaning.
 */
export function toStoredNeedsTeeth(value: boolean | null | undefined): 0 | 1 {
  return value === false ? 0 : 1;
}

/**
 * Decode the flag read back from SQLite.
 *
 * Lives beside `toStoredNeedsTeeth` rather than being spelled out at each read
 * site, because the raw column is an INTEGER that may be 1, 0, or — on a row
 * written before migration 021 or by a legacy importer — NULL. `=== 0` is the
 * ONLY opt-out; NULL and any unexpected value read as required, which is the
 * pre-021 behaviour. Reading it as `!!value` would make a NULL row skip teeth
 * charting.
 */
export function fromStoredNeedsTeeth(value: number | null | undefined): boolean {
  return value !== 0;
}

/**
 * Whether a committed case carries tooth charting.
 *
 * This is the rule every output surface uses to decide whether to print teeth,
 * a shade, an odontogram, or a per-unit line. It reads the CASE, never the
 * catalog, so a slip, invoice, lab card and ledger entry cannot disagree with
 * each other or with what the operator actually charted.
 */
export function caseHasChartedTeeth(kase: ChartedCase | null | undefined): boolean {
  return Array.isArray(kase?.selected_teeth) && kase.selected_teeth.length > 0;
}

/**
 * Billable units for a product.
 *
 * Work that is not per-tooth (a retainer) has no charting to count, but it is
 * still one billable unit of lab work — not zero. Printing "0" would read as a
 * charting failure on a case that is complete.
 */
export function billableUnits(kase: ChartedCase | null | undefined): number {
  return caseHasChartedTeeth(kase) ? kase!.selected_teeth!.length : 1;
}