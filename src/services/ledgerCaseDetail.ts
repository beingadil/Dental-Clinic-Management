/**
 * The "full detailed case" block that a ledger line shows for a case entry.
 *
 * A ledger row is money moving against a job. The operator reading a statement
 * needs to know WHICH job — not just `INV-0042 • Zirconia (DS-0117)` — so the
 * entry spells out the whole case: procedure, doctor, patient, teeth, shade,
 * material, the day the lab received it and the promised delivery day.
 *
 * One formatter, three consumers (general ledger screen, its CSV, its PDF,
 * and the clinic statement) so the on-screen statement and the printed one
 * can never drift apart.
 */

import type { DentalCase, LedgerEntry } from '../types';
import { formatDate, receivedDateFor } from '../utils/dateUtils';

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
 * Every non-empty detail row for a case, in reading order. Never returns null
 * rows — a missing value is simply omitted, so the block stays as short as the
 * case actually is.
 */
export const caseDetailLines = (c: DentalCase): CaseDetailLine[] => {
  const lines: CaseDetailLine[] = [
    { label: 'Procedure', value: c.case_type_name || c.case_type || '' },
    { label: 'Doctor', value: c.doctor_name || '' },
    { label: 'Patient', value: c.patient_name || '' },
    { label: 'Teeth', value: formatTeeth(c) },
    { label: 'Shade', value: c.shade || '' },
    { label: 'Material', value: c.material || '' },
    { label: 'Units', value: c.units_count ? String(c.units_count) : '' },
    { label: 'Received', value: formatDate(receivedDateFor(c)) },
    { label: 'Delivery', value: formatDate(c.delivery_date) },
  ];
  return lines.filter((l) => !!l.value);
};

/** `Procedure: Zirconia · Doctor: Dr. X · …` — the one-line CSV/PDF form. */
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
