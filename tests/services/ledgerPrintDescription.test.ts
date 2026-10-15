import { describe, it, expect } from 'vitest';
import type { DentalCase } from '../../src/types';
import { ledgerPrintDescription, LEDGER_PRINT_OMIT } from '../../src/services/ledgerCaseDetail';

/*
 * The General Ledger PRINT description.
 *
 * The printed line used to be:
 *
 *   Case Invoice - INV-0056  Invoice for Retainer (DS-0028) - Patient: 3154 -
 *   Procedure: upper Retainer - Teeth: #11, #21 - Shade: A2 -
 *   Received Date: Oct 5, 2026 - Delivery Date: Oct 10, 2026
 *
 * Three of those facts were already columns on the same row, and one of them
 * (Received Date) contradicted the Date column above it. The rules under test:
 *
 *   1. what a column already says does not belong in the description
 *   2. what the heading already says does not belong in the description
 *   3. everything else does
 */

/* The ledger joins on the same separator as every other ledger description
   in the app. Not the invoice print's middle dot. */
const SEP = ' \u2022 ';

const mkCase = (over: Partial<DentalCase> = {}): DentalCase =>
  ({
    id: 'case-1',
    case_number: 'DS-0028',
    patient_name: '3154',
    case_type_name: 'Retainer',
    doctor_name: 'Dr Ali',
    lab_id: 'lab-1',
    lab_name: 'Cases Clinic',
    selected_teeth: [11, 21],
    tooth_details: {},
    units_count: 2,
    shade: 'A2',
    received_date: '2026-10-05',
    delivery_date: '2026-10-10',
    status: 'received',
    ...over,
  }) as unknown as DentalCase;

describe('ledgerPrintDescription', () => {
  it('keeps only the facts the columns do not already carry', () => {
    const out = ledgerPrintDescription(mkCase(), 'Invoice for Retainer (DS-0028)');

    expect(out).toBe(
      ['Retainer', 'Patient: 3154', 'Teeth: #11, #21', 'Shade: A2'].join(SEP),
    );
  });

  it('drops the received date, which is the Date column', () => {
    const out = ledgerPrintDescription(mkCase(), 'Invoice for Retainer (DS-0028)');

    expect(out).not.toContain('Oct 5, 2026');
    expect(out).not.toContain('Received Date');
  });

  it('drops the delivery date, which is a bench date and not an accounts fact', () => {
    const out = ledgerPrintDescription(mkCase(), 'Invoice for Retainer (DS-0028)');

    expect(out).not.toContain('Oct 10, 2026');
    expect(out).not.toContain('Delivery Date');
  });

  it('drops the case number, which is the CASE/JOB column', () => {
    const out = ledgerPrintDescription(mkCase(), 'Invoice for Retainer (DS-0028)');

    expect(out).not.toContain('DS-0028');
  });

  it('drops the invoice reference the caller may have prefixed', () => {
    // GeneralLedgerView's narration arrives as "INV-0056  Invoice for Retainer
    // (DS-0028)". The reference is the subject of the whole row, not of the
    // case, so it must not survive into the case description.
    const out = ledgerPrintDescription(mkCase(), 'INV-0056  Invoice for Retainer (DS-0028)');

    expect(out).not.toContain('INV-0056');
    expect(out.startsWith('Retainer')).toBe(true);
  });

  it('drops a Procedure that only repeats the heading', () => {
    const out = ledgerPrintDescription(mkCase(), 'Invoice for Retainer (DS-0028)');

    expect(out).not.toContain('Procedure');
    expect(out).not.toContain('upper');
  });

  it('keeps a Procedure that says something the heading does not', () => {
    // A genuinely different procedure is information, not noise.
    // The title names an Implant Crown while the CASE records a Retainer
    // procedure: two different words, so the procedure is information.
    const out = ledgerPrintDescription(mkCase(), 'Invoice for Implant Crown (DS-0028)');

    expect(out).toContain('Procedure: Retainer');
  });

  it('never prints the unit count beside a tooth list', () => {
    // Teeth already says how many.
    const out = ledgerPrintDescription(mkCase(), 'Invoice for Retainer (DS-0028)');
    expect(out).not.toContain('Units');
  });

  it('prints the unit count when there is no tooth list', () => {
    // An uncharted retainer: the count is the only quantity on the page.
    const out = ledgerPrintDescription(
      mkCase({ selected_teeth: [], units_count: 1 }),
      'Invoice for Retainer (DS-0028)',
    );

    expect(out).toContain('Units: 1 unit');
  });

  it('falls back to the case type when the caller has no description', () => {
    const out = ledgerPrintDescription(mkCase());
    expect(out.startsWith('Retainer')).toBe(true);
  });

  it('does not crash on a case-less entry', () => {
    expect(ledgerPrintDescription(null, 'Opening balance')).toBe('Opening balance');
    expect(ledgerPrintDescription(null)).toBe('');
  });

  it('omits exactly the two dates, and nothing conditional', () => {
    // Procedure is NOT in this list. It is dropped conditionally by
    // repeatsHeading, so pinning it here would pin the bug where a genuinely
    // different procedure was silently removed.
    expect(LEDGER_PRINT_OMIT).toEqual(['Received Date', 'Delivery Date']);
  });
});
