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
export const caseDetailText = (c: DentalCase): string =>
  caseDetailLines(c).map((l) => `${l.label}: ${l.value}`).join(' • ');

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
