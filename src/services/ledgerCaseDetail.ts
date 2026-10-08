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
 * One formatter, every consumer (general ledger screen, its CSV, its PDF, the
 * clinic statement, and the invoice drawer's case card) so the on-screen
 * statement, the printed one and the invoice can never drift apart.
 */

import { formatDate, receivedDateFor } from '../utils/dateUtils';
import type { DentalCase, LedgerEntry } from '../types';

export interface CaseDetailLine {
  label: string;
  value: string;
}

/** FDI teeth as `#11, #12, #21`, or a dash when the case has none. */
export const formatTeeth = (c: DentalCase): string => {
  const teeth = (c.selected_teeth || []).slice().sort((a, b) => a - b);
  return teeth.length ? teeth.map((t) => `#${t}`).join(', ') : '—';
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
export const caseDetailLines = (c: DentalCase): CaseDetailLine[] => {
  const lines: CaseDetailLine[] = [
    { label: 'Patient', value: c.patient_name || '' },
    { label: 'Procedure', value: c.case_type_name || c.case_type || '' },
    { label: 'Teeth', value: formatTeeth(c) },
    { label: 'Shade', value: c.shade || '' },
    { label: 'Received Date', value: formatReceivedDate(c) },
    { label: 'Delivery Date', value: formatDeliveryDate(c) },
  ];
  return lines.filter((l) => !!l.value);
};

/** `Patient: Ali · Procedure: Zirconia · …` — the one-line CSV/PDF form. */
export const caseDetailText = (c: DentalCase): string =>
  caseDetailLines(c).map((l) => `${l.label}: ${l.value}`).join(' • ');

/**
 * The case an entry belongs to, matched by id first and case number second.
 * Returns null for payments and other entries that belong to no case.
 */
export const findCaseForEntry = (
  entry: LedgerEntry,
  cases: DentalCase[],
): DentalCase | null => {
  if (!entry?.case_id && !entry?.case_number) return null;
  return (
    cases.find((c) => c.id === entry.case_id) ||
    cases.find((c) => c.case_number === entry.case_number) ||
    null
  );
};
