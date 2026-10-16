import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Two of the ledger's three output buttons were wired to nothing the operator
 * could see, and both failed silently:
 *
 *   - PRINT. The ledger's printable content is `.print-flow`, and it is only
 *     mounted once the preview is open. Print called window.print() regardless,
 *     so pressing it before Preview printed a BLANK page — and the on-screen
 *     `@media print` rule drops every child of `.print-page` that is not
 *     `.print-flow`, so blank was the correct rendering of what was in the DOM.
 *     Two unrelated gates for one action, and the failure was invisible.
 *
 *   - EXPORT. Same shape: live, but with no clinic chosen it did nothing.
 *
 * Read from source: the component needs the whole AppContext, and what matters
 * is which DOM nodes each button mounts before acting.
 */
const src = readFileSync(
  resolve(process.cwd(), 'src/components/billing/GeneralLedgerView.tsx'),
  'utf8',
);

/** The ledger print button's onClick body. */
const printHandler = (): string => {
  const i = src.indexOf('void printCurrentDocument()');
  expect(i).toBeGreaterThan(-1);
  return src.slice(Math.max(0, i - 700), i + 40);
};

describe('ledger print', () => {
  it('opens the preview before printing, so the printable DOM exists', () => {
    const h = printHandler();
    expect(h).toMatch(/setIsPreviewActive\(true\)/);
  });

  it('orders it before the print call, not after', () => {
    const h = printHandler();
    const open = h.indexOf('setIsPreviewActive(true)');
    const print = h.indexOf('void printCurrentDocument()');
    expect(open).toBeGreaterThan(-1);
    expect(open).toBeLessThan(print);
  });

  it('still refuses without a clinic, and says so', () => {
    const h = printHandler();
    expect(h).toMatch(/if \(!selectedClinic\)/);
    expect(h).toMatch(/NEEDS_CLINIC/);
  });
});

describe('ledger export', () => {
  it('reports a successful save on the page rather than only alerting on error', () => {
    expect(src).toMatch(/kind: 'saved'/);
    expect(src).toMatch(/role="status"/);
  });

  it('names the file so "did it save?" is answerable', () => {
    expect(src).toMatch(/outcome\.path/);
    expect(src).toMatch(/isAbsolutePath/);
  });

  it('stays silent when the operator cancels the save dialog', () => {
    // Cancelling is a choice, not an error, and saying so would train the
    // operator to ignore the message.
    expect(src).toMatch(/status === 'cancelled'[\s\S]{0,40}return;/);
  });
});

describe('no second payments surface', () => {
  it('does not import or render a payments register', () => {
    const billing = readFileSync(
      resolve(process.cwd(), 'src/components/billing/BillingView.tsx'),
      'utf8',
    );
    expect(billing).not.toContain('TransactionRegister');
  });

  it('the register component itself is gone from the tree', () => {
    expect(() =>
      readFileSync(
        resolve(process.cwd(), 'src/components/billing/TransactionRegister.tsx'),
        'utf8',
      ),
    ).toThrow();
  });

  it('keeps the voucher controls on the invoice row, which is the only place now', () => {
    const billing = readFileSync(
      resolve(process.cwd(), 'src/components/billing/BillingView.tsx'),
      'utf8',
    );
    expect(billing).toMatch(/header: 'Vouchers'/);
    expect(billing).toMatch(/setVoucherToEdit/);
    expect(billing).toMatch(/setPaymentToDelete/);
  });
});