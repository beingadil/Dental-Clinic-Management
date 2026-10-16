import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * "Export PDF does not open a Save As window" and "Print renders nothing."
 *
 * Both came from the same place: the ledger had two output paths that had
 * drifted apart.
 *
 *   PRINT went through window.print(), which asks the browser to render the
 *   on-screen HTML. The printable content lives in `.print-flow`, mounted only
 *   when the preview is open, so printing before Preview produced a BLANK page.
 *   Even when it worked it was a different document from the exported file — an
 *   HTML printout rather than the generated PDF — which is what "render the
 *   same pdf as pdf export" is objecting to. It now builds and saves the very
 *   same PDF, through the same function.
 *
 *   EXPORT produced the PDF correctly all along and downloaded it — into the
 *   browser's Downloads folder, silently. The file was never missing; the
 *   missing thing was the CHOOSER. An earlier note claimed a web page cannot
 *   open one. That was wrong: Chromium's File System Access API does, and
 *   127.0.0.1 is a secure context, so the dev server gets it too.
 *
 * And the green "saved" banner is gone: the chooser is the confirmation, and
 * repeating it on the page afterwards was noise.
 */
const ledger = readFileSync(
  resolve(process.cwd(), 'src/components/billing/GeneralLedgerView.tsx'),
  'utf8',
);
const saveFile = readFileSync(resolve(process.cwd(), 'src/lib/saveFile.ts'), 'utf8');

describe('print and export produce the same document', () => {
  it('both buttons go through one save path', () => {
    expect(ledger).toMatch(/const handlePrint = \(\) => saveStatement\(/);
    expect(ledger).toMatch(/const handleExportPDF = \(\) => saveStatement\(/);
  });

  it('neither button calls the browser print dialog any more', () => {
    // window.print() rendered the on-screen HTML, not the generated PDF.
    expect(ledger).not.toMatch(/window\.print\(/);
    expect(ledger).not.toContain('printCurrentDocument');
  });

  it('builds the statement in one place, so the two cannot diverge', () => {
    const builds = ledger.match(/buildLedgerPdf\(/g) ?? [];
    expect(builds).toHaveLength(1);
    expect(ledger).toMatch(/const buildStatement = \(\) =>/);
  });

  it('offers the PDF file type in the chooser for both', () => {
    expect(ledger).toMatch(/saveStatement\('PDF document'\)/);
    expect(ledger).toMatch(/saveStatement\('Ledger statement PDF'\)/);
  });
});

describe('the browser gets a real Save As window', () => {
  it('uses showSaveFilePicker when the browser has it', () => {
    expect(saveFile).toMatch(/showSaveFilePicker/);
  });

  it('requires a secure context, so it is never half-available', () => {
    // The API throws in an insecure context; gating on it means the fallback is
    // a deliberate choice rather than a crash.
    expect(saveFile).toMatch(/isSecureContext/);
  });

  it('writes the bytes to the chosen file rather than downloading', () => {
    expect(saveFile).toMatch(/createWritable\(\)/);
    expect(saveFile).toMatch(/writable\.write\(blob\)/);
    expect(saveFile).toMatch(/writable\.close\(\)/);
  });

  it('treats a dismissed chooser as a choice, not a fault', () => {
    expect(saveFile).toMatch(/AbortError/);
    expect(saveFile).toMatch(/status: 'cancelled'/);
  });

  it('keeps the plain download for browsers without the API', () => {
    // Firefox and Safari have no chooser; they still get a working save.
    expect(saveFile).toMatch(/link\.download/);
    expect(saveFile).toMatch(/URL\.createObjectURL\(blob\)/);
  });
});

describe('no success banner', () => {
  it('has no saved state left to render', () => {
    expect(ledger).not.toMatch(/kind: 'saved'/);
    expect(ledger).not.toMatch(/'bg-emerald-50 border-emerald-200 text-emerald-800'/);
  });

  it('still reports the two cases where the operator would be guessing', () => {
    expect(ledger).toMatch(/NEEDS_CLINIC/);
    expect(ledger).toMatch(/Could not save the PDF/);
  });

  it('still renders a notice region for those', () => {
    expect(ledger).toMatch(/role="status"/);
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