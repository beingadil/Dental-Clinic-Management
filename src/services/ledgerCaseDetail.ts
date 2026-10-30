/**
 * The "full detailed case" block that a ledger line shows for a case entry.
 *
 * A ledger row is money moving against a job. The operator reading a statement
 * needs to know WHICH job — not just `INV-0042 • Zirconia (DS-0117)` — so the
 * entry spells out the case's identity: patient, procedure, teeth, shade, and
 * the two dates that bracket the job at the bench — the day it came in and the
 * day it is promised back. Anything else about the job (doctor, material,
 * units) belongs to the case record, not the money line.
 *
 * A case with no charting is a product that is not per-tooth work, so it has no
 * tooth list — but it still has a shade and both bench dates. See
 * `caseDetailLines` for why only the teeth row is gated on charting.
 *
 * One formatter, every consumer (general ledger screen, its CSV, its PDF, the
 * clinic statement, the invoice drawer's case card and both printed sheets) so
 * the on-screen statement, the printed one and the invoice can never drift
 * apart. A consumer that already prints one of these facts elsewhere passes
 * `omit` rather than re-deriving the row.
 */

import { formatDate, receivedDateFor } from '../utils/dateUtils';
import { caseHasChartedTeeth, billableUnits } from '../utils/catalogToothRequirement';
import type { DentalCase, Invoice, LedgerEntry } from '../types';

export interface CaseDetailLine {
  label: string;
  value: string;
}

/** The rows `caseDetailLines` can emit, in reading order. */
export type CaseDetailLabel =
  | 'Patient'
  | 'Procedure'
  | 'Units'
  | 'Teeth'
  | 'Shade'
  | 'Received Date'
  | 'Delivery Date';

/**
 * Detail rows a printed INVOICE suppresses.
 *
 * Exported because `statementPagination` must price a row from the same list
 * the renderer prints from. They drifted once — the renderer omitted four rows
 * while the paginator priced all seven — which over-estimated every sheet and
 * pushed runs onto extra pages. Shared, so they cannot drift again.
 *
 * A job slip still wants Teeth; it is not an invoice consumer.
 */
export const INVOICE_DETAIL_OMIT: CaseDetailLabel[] = [
  'Shade',
  'Received Date',
  'Teeth',
  'Delivery Date',
];

/**
 * Detail rows a printed STATEMENT suppresses.
 *
 * Deliberately NOT the invoice list: the invoice prints `Units`, while a
 * statement row shows the tooth list instead, because teeth are what a clinic
 * reconciles against and the unit count is already its own column. The two
 * lists have to be named separately or someone will "fix" the invoice list and
 * silently change what a statement prints.
 *
 * It exists because the printed statement and `statementPagination` drifted:
 * the renderer passed this inline array while the paginator priced rows from
 * INVOICE_DETAIL_OMIT, so the paginator was measuring a one-line cell that
 * printed as a tooth list. A model that prices a different string than the one
 * that prints cannot predict the paper.
 */
export const STATEMENT_DETAIL_OMIT: CaseDetailLabel[] = [
  'Shade',
  'Received Date',
  'Units',
  'Delivery Date',
];

/**
 * The separator for the inline case line — `Ali Raza · Zirconia · #11, #21`.
 *
 * One spelling, shared by the printed statement and the paginator that prices
 * its rows: the paginator counts characters, so a separator it does not know
 * about is a line it does not see.
 */
export const CASE_DETAIL_SEP = ' \u00B7 ';

/** The inline case line: every remaining detail value, joined for one cell. */
export const caseDetailInlineText = (
  c: DentalCase,
  { omit = [] }: CaseDetailOptions = {},
): string =>
  caseDetailLines(c, { omit })
    .map((l) => l.value)
    .join(CASE_DETAIL_SEP);

export interface CaseDetailOptions {
  /**
   * Rows to suppress, for a consumer that already shows that fact somewhere
   * better.
   *
   * The printed statement is the case in point: its `Received` column carries
   * the day the lab took the job in, so repeating it as a row inside the case
   * block printed the same date twice on one line. Suppressing by label keeps
   * ONE formatter in charge of the row order and the formatting, so the ledger,
   * the CSV, the PDF, the clinic statement, the invoice drawer and the print
   * still cannot drift — the difference is which rows a given sheet chooses to
   * print, not how a row is built.
   */
  omit?: readonly CaseDetailLabel[];
}

/**
 * FDI teeth as `#11, #12, #21`. Empty when the case has none — a product that is
 * not per-tooth work is stored with no teeth, and the caller drops the row rather
 * than print a dash that reads as "we forgot to chart this".
 */
export const formatTeeth = (c: DentalCase): string => {
  const teeth = (c.selected_teeth || []).slice().sort((a, b) => a - b);
  return teeth.length ? teeth.map((t) => `#${t}`).join(', ') : '';
};

/**
 * The day the lab took the job in, e.g. `Oct 3, 2026`. Empty when the case
 * carries neither a received date nor a creation date, so the caller can drop
 * the row rather than print a placeholder.
 *
 * Reuses `receivedDateFor`, the same rule the lab card slip prints under
 * "Received Date" — the operator's answer, falling back to the registration day
 * for rows predating that field. Never `delivery_date`: that is a promised
 * future date and would mislabel the row.
 */
export const formatReceivedDate = (c: DentalCase): string => {
  const raw = receivedDateFor(c);
  return raw ? formatDate(raw) : '';
};

/**
 * The day the job is PROMISED back, e.g. `Dec 20, 2026` — the SLA commitment.
 * Empty when the case carries no promised date, so the caller drops the row
 * instead of printing `formatDate`'s `N/A`.
 *
 * Deliberately separate from `formatReceivedDate`: one is history (the job is
 * already on the bench), the other is a promise about the future. Printing them
 * as two rows is what stops the promised day being read as the received one.
 */
export const formatDeliveryDate = (c: DentalCase): string => {
  const raw = (c.delivery_date || '').trim();
  return raw ? formatDate(raw) : '';
};

/**
 * Every non-empty detail row for a case, in reading order. Never returns null
 * rows — a missing value is simply omitted, so the block stays as short as the
 * case actually is.
 */
export const caseDetailLines = (
  c: DentalCase,
  { omit = [] }: CaseDetailOptions = {},
): CaseDetailLine[] => {
  const hidden = new Set<CaseDetailLabel>(omit);

  const lines: CaseDetailLine[] = [
    { label: 'Patient', value: c.patient_name || '' },
    { label: 'Procedure', value: c.case_type_name || c.case_type || '' },
  ];

  // Teeth alone are gated on the case being charted: work that is not per-tooth
  // (a retainer, an aligner, a healing post) commits no charting, so there is
  // genuinely no tooth list to print and an em dash would read as a charting
  // failure rather than a deliberate "this does not apply".
  //
  // Shade and the two bench dates are NOT gated on it. A retainer is still a
  // shade-matched, dated piece of work at the bench — the operator records a
  // received date on every case regardless of product — so dropping them
  // because no teeth were charted hid real data on exactly the rows a clinic
  // most needs. Keyed off the CASE, never the catalog flag, so every consumer
  // reaches the same answer for the same row and none can drift.
  if (caseHasChartedTeeth(c)) {
    lines.push({ label: 'Teeth', value: formatTeeth(c) });
  }
  /* Units, as a count and never as a tooth list.
     A printed invoice wants "4 units", not "Teeth: #35, #36, #45, #46": the
     per-tooth list wraps the row and tells a reader reconciling a bill
     nothing they can act on. Emitted alongside Teeth rather than instead of it
     so a job slip — which DOES need the tooth list for the bench — keeps it,
     and the invoice consumer suppresses Teeth via `omit`. Same reasoning as
     the Teeth gate below: one formatter, consumers choose their rows. */
  const units = billableUnits(c);
  if (units > 0) {
    lines.push({ label: 'Units', value: `${units} unit${units === 1 ? '' : 's'}` });
  }
  lines.push(
    { label: 'Shade', value: c.shade || '' },
    { label: 'Received Date', value: formatReceivedDate(c) },
    { label: 'Delivery Date', value: formatDeliveryDate(c) },
  );

  return lines.filter((l) => !!l.value && !hidden.has(l.label as CaseDetailLabel));
};

/** `Patient: Ali · Procedure: Zirconia · …` — the one-line CSV/PDF form. */
export const caseDetailText = (c: DentalCase, { omit = [] }: CaseDetailOptions = {}): string =>
  caseDetailLines(c, { omit })
    .map((l) => `${l.label}: ${l.value}`)
    .join(' • ');

/* ---------------------------------------------------------------------------
 * The General Ledger PRINT line.
 *
 * The downloadable ledger used to print, for one invoice:
 *
 *   Case Invoice - INV-0056  Invoice for Retainer (DS-0028) - Patient: 3154 -
 *   Procedure: upper Retainer - Teeth: #11, #21 - Shade: A2 -
 *   Received Date: Oct 5, 2026 - Delivery Date: Oct 10, 2026
 *
 * Six facts, of which three are already printed somewhere else on the same
 * page, and one of which (the received date) contradicts the Date column it
 * sits three lines below. It also wraps to four lines, which makes the row
 * tall enough to push entries onto extra sheets.
 *
 * Two rules, applied HERE rather than at each call site so the ledger PDF and
 * any future ledger export cannot disagree:
 *
 *   1. A row that is already a COLUMN does not belong in the description.
 *      Received Date is the Date column; the case number is the CASE/JOB
 *      column; the invoice number is the subject of the whole row.
 *   2. A row that REPEATS the title is noise. `Procedure: upper Retainer`
 *      beside a heading that already says `Retainer` tells the reader nothing
 *      they cannot see two words earlier.
 *
 * What is left is what the columns do NOT already say:
 *   Retainer - Patient: 3154 - Teeth: #11, #21 - Shade: A2
 *
 * Deliberately NOT applied to the on-screen preview: the preview is the
 * working surface where an operator looks up one case and wants the full
 * record, and it has no Date column competing with a Received Date row.
 * ------------------------------------------------------------------------- */

/**
 * Rows the ledger PDF never prints inside a description.
 *
 * Only the two dates. Procedure is deliberately NOT here: it is dropped
 * conditionally by `repeatsHeading`, so a procedure that genuinely differs
 * from the heading still reaches the page. Listing it unconditionally made
 * that check dead code.
 */
export const LEDGER_PRINT_OMIT: CaseDetailLabel[] = [
  'Received Date',
  'Delivery Date',
];
/**
 * True when `value` says the same thing as `heading`, ignoring case,
 * punctuation and filler words.
 */
const repeatsHeading = (heading: string, value: string): boolean => {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !['upper', 'lower', 'of', 'the', 'for', 'a', 'an'].includes(w));
  const h = norm(heading);
  const v = norm(value);
  if (!h.length || !v.length) return false;
  return h.some((w) => v.includes(w)) || v.some((w) => h.includes(w));
};

/**
 * The one-line case description used by the General Ledger PRINT.
 *
 * `title` is the ledger entry's own description ("Invoice for Retainer"),
 * used both as the leading text and to decide whether Procedure is a repeat.
 */
export const ledgerPrintDescription = (c: DentalCase | null, title?: string): string => {
  if (!c) return (title || '').trim();

  /* Reduce the entry description to the product it names.
     GeneralLedgerView hands over "INV-0056  Invoice for Retainer (DS-0028)":
     a document reference, a sentence of framing, the product, and a case
     number that is already its own column. All four are removed. */
  let heading = (title || c.case_type_name || c.case_type || '').trim();
  heading = heading
    /* leading document reference: INV-0056, PAY-0042, "RCPT/9", ... */
    .replace(/^[A-Z]{2,}[\w-]*[\s/:]*\d+[\s:-]*/i, '')
    .replace(/^invoice\s+for\s+/i, '')
    /* trailing "(DS-0028)" */
    .replace(/\s*\([^)]*\)\s*$/, '')
    /* collapse the whitespace the strips above left behind */
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!heading) heading = c.case_type_name || c.case_type || 'Case work';

  const facts = caseDetailLines(c)
    .filter((l) => !LEDGER_PRINT_OMIT.includes(l.label as CaseDetailLabel))
    /* Procedure survives only when it says something the heading does not. */
    .filter((l) => l.label !== 'Procedure' || !repeatsHeading(heading, l.value))
    /* Units repeats what Teeth already imply; it is the only count on the
       page when the case is uncharted. */
    .filter((l) => !(l.label === 'Units' && caseHasChartedTeeth(c)))
    .map((l) => `${l.label}: ${l.value}`);

  return [heading, ...facts].join(' \u2022 ');
};


/**
 * The matching rule, shared by both lookup helpers below.
 *
 * Id first, case number second. The id is the reliable join; the case number
 * is the fallback for rows whose stored id went stale (an invoice written
 * before the case row was re-imported), which is a real state here rather
 * than a defensive nicety.
 */
const matchCase = (
  ref: { case_id?: string | null; case_number?: string | null } | null | undefined,
  cases: DentalCase[],
): DentalCase | null => {
  if (!ref?.case_id && !ref?.case_number) return null;
  return (
    cases.find((c) => c.id === ref.case_id) ||
    cases.find((c) => c.case_number === ref.case_number) ||
    null
  );
};

/**
 * The case an entry belongs to, matched by id first and case number second.
 * Returns null for payments and other entries that belong to no case.
 */
export const findCaseForEntry = (
  entry: LedgerEntry,
  cases: DentalCase[],
): DentalCase | null => matchCase(entry, cases);

/**
 * The case an INVOICE bills, same rule as a ledger entry.
 *
 * The batch print sheet walks invoices rather than ledger entries, so it
 * needs its own entry point — but the rule must not drift, or a printed
 * invoice and the ledger line behind it would resolve to different jobs.
 */
export const findCaseForInvoice = (
  invoice: Invoice,
  cases: DentalCase[],
): DentalCase | null => matchCase(invoice, cases);
