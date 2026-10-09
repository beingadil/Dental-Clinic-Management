/**
 * Doctor-name normalisation.
 *
 * `cases.doctor_name` is free text typed by whoever registers the case, and
 * the case form's placeholder used to invite `"Dr. Tariq Mahmood"`. Half the
 * print and detail renderers then prepended their own `"Dr. "`, which is how a
 * slip went out reading **"Dr. Dr. Tariq Mahmood"**.
 *
 * The fix is a single canonical stored form with a single formatter:
 *
 *   STORED  — bare: `Tariq Mahmood`
 *   DISPLAY — `Dr. Tariq Mahmood`
 *
 * Both halves are total functions, so a caller never has to know which form a
 * legacy row is in: formatting an already-prefixed name is a no-op, and
 * stripping a bare name is a no-op. That makes it safe to run over every
 * existing row during a migration and over every render site afterwards.
 */

/**
 * A leading honorific, optionally dotted, followed by whitespace.
 *
 * The trailing `\s+` is load-bearing. Without it `Drake` would match `dr` and
 * be stripped to `ake`, and a name of exactly `Dr` would be stripped to empty.
 * Requiring whitespace after the token means only `Dr`/`Dr.`/`DR` used as an
 * honorific is consumed, and never a name that merely starts with those
 * letters.
 *
 * `Prof` is deliberately NOT in this pattern. An academic title is a fact about
 * the person, not decoration: a Professor relabelled `Dr.` on a printed slip is
 * a factual error, and stripping `Prof.` would lose the distinction for good.
 * See `formatDoctorName`, which preserves it.
 */
const LEADING_HONORIFIC = /^(?:dr)\.?\s+/i;

/** A leading academic title, preserved rather than stripped. */
const LEADING_TITLE = /^(?:prof)\.?\s+/i;

/**
 * A name that is nothing but the honorific. There is no one to print here, so
 * the caller gets the fallback instead of a stranded "Dr." — `Dr` alone must
 * not slip through `LEADING_HONORIFIC`, which requires whitespace after it.
 */
const HONORIFIC_ONLY = /^(?:dr)\.?$/i;

/** The honour this app uses when a name carries none of its own. */
const DEFAULT_HONORIFIC = 'Dr.';

/** The default stand-in for a name that resolves to nothing printable. */
const DEFAULT_FALLBACK = '—';

const tidy = (value?: string | null): string => (value ?? '').trim();

/**
 * The bare name — the canonical STORED form.
 *
 * Strips a leading `Dr`/`Dr.` so a value typed against the old placeholder
 * normalises on write and on migration. An academic title survives untouched.
 */
export const stripDoctorHonorific = (name?: string | null): string => {
  // Loop, not a single replace: rows written by the double-prefix bug can carry
  // more than one honorific ("Dr. Dr. Ahmad"), and leaving a second behind
  // would make the normaliser non-idempotent — formatting such a row would put
  // the defect straight back.
  let bare = tidy(name);
  while (LEADING_HONORIFIC.test(bare)) {
    bare = bare.replace(LEADING_HONORIFIC, '');
  }
  return bare;
};

/**
 * The display form — exactly one honorific, never zero and never two.
 *
 * Works from the bare name so the result is the same whether the input was
 * freshly typed or came out of a database written before this existed. A name
 * that is empty, or that is nothing but an honorific, returns `fallback`
 * rather than printing a stranded "Dr.".
 */
export const formatDoctorName = (
  name?: string | null,
  fallback: string = DEFAULT_FALLBACK,
): string => {
  const trimmed = tidy(name);

  // An academic title is the person's own; keep it and add nothing to it.
  // `Prof. Ahmed` and `Prof Ahmed` are normalised to one spelling so the two
  // cannot render differently.
  if (LEADING_TITLE.test(trimmed)) {
    const titled = trimmed.replace(LEADING_TITLE, '').trim();
    return titled ? `Prof. ${titled}` : fallback;
  }

  const bare = stripDoctorHonorific(trimmed);
  if (!bare || HONORIFIC_ONLY.test(bare)) return fallback;

  // `Dr Ahmad` and `Dr. Ahmad` are the same person; normalise the spelling so
  // the two inputs cannot render differently.
  return `${DEFAULT_HONORIFIC} ${bare}`;
};