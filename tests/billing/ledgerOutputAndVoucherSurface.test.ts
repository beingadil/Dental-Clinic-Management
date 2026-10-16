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

describe('print and export are different actions', () => {
  it('Print opens the Windows print dialog', () => {
    expect(ledger).toMatch(/void printCurrentDocument\(\)/);
  });

  it('Export PDF is the one that saves a file', () => {
    expect(ledger).toMatch(/const handleExportPDF = \(\) => saveStatement\(/);
  });

  it('Print opens the preview first, so the printable DOM exists', () => {
    /* The blank-page bug: `.print-flow` is only mounted with the preview, and
       the print stylesheet drops every sibling of it. */
    const i = ledger.indexOf('const handlePrint');
    const body = ledger.slice(i, i + 600);
    expect(body).toMatch(/setIsPreviewActive\(true\)/);
    expect(body.indexOf('setIsPreviewActive(true)')).toBeLessThan(
      body.indexOf('printCurrentDocument'),
    );
  });

  it('Print still refuses without a clinic', () => {
    const i = ledger.indexOf('const handlePrint');
    expect(ledger.slice(i, i + 400)).toMatch(/NEEDS_CLINIC/);
  });

  it('builds the exported PDF in one place', () => {
    const builds = ledger.match(/buildLedgerPdf\(/g) ?? [];
    expect(builds).toHaveLength(1);
    expect(ledger).toMatch(/const buildStatement = \(\) =>/);
  });
});

describe('the browser saves by downloading', () => {
  it('hands the file to the browser download', () => {
    expect(saveFile).toMatch(/URL\.createObjectURL\(blob\)/);
    expect(saveFile).toMatch(/link\.download/);
    expect(saveFile).toMatch(/link\.click\(\)/);
  });

  it('reports the byte count it wrote', () => {
    expect(saveFile).toMatch(/status: 'saved', path: fileName, bytes: bytes\.length/);
  });

  it('does NOT fall back to a download inside the desktop shell', () => {
    /* WebView2 routes the download event away, so a Blob here discards the
       bytes and used to report success anyway. The shell must fail loudly. */
    expect(saveFile).toMatch(/if \(isDesktop\(\)\)/);
    expect(saveFile).toMatch(/nothing was written/);
  });

  it('still uses the native dialog and Rust write on desktop', () => {
    expect(saveFile).toMatch(/dialogApi\.save\(/);
    expect(saveFile).toMatch(/invokeFn\('save_file_bytes'/);
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