import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The invoices table is read on a phone-sized window as often as on the desk,
 * and it had grown columns that cost width without answering a question the
 * operator asked:
 *
 *   - CASE MATERIAL: the material is on the case, and the invoice breakdown
 *     drawer opens on the same click as every other detail about the job.
 *   - DUE DATE & TERMS: the widest column in the table, and it duplicated the
 *     Payment Status column beside it.
 *   - RECEIVE: a per-row payment button, which put a second way of recording a
 *     payment next to the register that is the first way.
 *
 * These are read out of the source rather than by rendering. The table's
 * columns are a literal array in a component that needs the whole AppContext to
 * mount, so a rendered test would be testing the mock, not the columns. What
 * matters here is the header list itself, and it is plain text.
 */
const source = readFileSync(
  resolve(process.cwd(), 'src/components/billing/BillingView.tsx'),
  'utf8',
);

/** Header captions of the invoices table, in declaration order. */
const invoiceTableHeaders = (): string[] =>
  Array.from(source.matchAll(/header:\s*'([^']+)'/g)).map((m) => m[1]);

describe('invoices table columns', () => {
  it('does not carry a Case Material column', () => {
    expect(invoiceTableHeaders()).not.toContain('Case Material');
  });

  it('does not carry a Due Date & Terms column', () => {
    expect(invoiceTableHeaders()).not.toContain('Due Date & Terms');
  });

  it('keeps the columns an operator actually reconciles against', () => {
    // Removing for width must not remove the money. These three are the table's
    // reason to exist: what was billed, what came in, what is still owed.
    for (const heading of ['Final Amount', 'Amount Paid', 'Remaining Due']) {
      expect(invoiceTableHeaders()).toContain(heading);
    }
  });

  it('still names the clinic and the patient, so a search resolves to a row', () => {
    const headers = invoiceTableHeaders();
    expect(headers).toContain('Dental Clinic');
    expect(headers).toContain('Patient');
  });

  it('has no per-row Receive button', () => {
    // The button label itself, and the handler that opened the recorder.
    expect(source).not.toMatch(/Receive Overdue/);
    expect(source).not.toMatch(/>\s*Receive\s*</);
  });

  it('reaches the payment recorder from the header button instead', () => {
    // Removing the row button must not remove the capability. The register that
    // used to sit below the table is gone too, so the header button is now the
    // only entry point and has to stay wired.
    expect(source).toMatch(/setUnifiedModalMode\('payment'\)/);
    expect(source).toMatch(/Receive Payment/);
  });

  it('carries no second payments surface', () => {
    // Vouchers live on the invoice row and nowhere else. The register repeated
    // every payment a second time, so a mistyped amount had two places to fix.
    expect(source).not.toContain('TransactionRegister');
  });

  it('lists adjustments in the same Vouchers cell as payments, with their own serial', () => {
    // Adjustments are money documents too. They belong beside the payment
    // vouchers on the invoice row — CR-/DR-/REF- serials, not a second panel.
    expect(source).toMatch(/adjustmentsByInvoice\.get\(inv\.id\)/);
    expect(source).toMatch(/adj\.adjustment_number/);
    expect(source).not.toContain('Adjustments &amp; Credit Notes');
    expect(source).not.toMatch(/header:\s*'Adjustment #'/);
  });

  it('reads no payment-terms countdown off any invoice row', () => {
    // "Due in 6d" and friends are gone from the badge helper, so nothing in
    // the table restates how many days remain.
    expect(source).not.toMatch(/Within Terms/);
    expect(source).not.toMatch(/No Terms/);
    expect(source).not.toMatch(/EXPIRED/);
  });
});