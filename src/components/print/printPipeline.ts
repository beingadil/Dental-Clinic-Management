/**
 * Print pipeline — ONE owner of print-output behavior shared by the batch
 * (BulkPrintModal) and single-slip (CaseJobSlipModal) modals.
 *
 * Owns exactly three things:
 *   1. the isolation class names the print CSS files key on (single source
 *      of truth — a rename here updates the CSS contract the tests assert),
 *   2. collecting all app CSS as text (for standalone files),
 *   3. serializing a print container + that CSS into a standalone HTML
 *      document that reproduces the preview 1:1 when opened or printed.
 *
 * NOT owned here: mode selection (which preview prints), voucher recording,
 * or the window.print() call itself — those stay in the modals that know
 * their own preview state.
 */

/** Class on <body> while slip printing/Save-PDF is active — jobSlipPrint.css keys on it. */
export const SLIP_PRINT_BODY_CLASS = 'job-slip-printing-on';
/** Class on the modal root while slip printing/Save-PDF is active. */
export const SLIP_PRINT_ROOT_CLASS = 'job-slip-printing';
/** Container whose outerHTML the batch standalone serializer captures. */
export const PRINT_CONTAINER_SELECTOR = '.space-y-8';

/**
 * Isolation + page CSS for the batch standalone file. Contract with
 * jobSlipPrint.css: visibility-isolation reveals ONLY .job-slip-print-root
 * subtrees (the compact slip cards); lab cards carry no such node, so
 * routing them through this block would print blank paper — the bug class
 * this module documents and the regression tests assert.
 */
export const BATCH_STANDALONE_CSS = `
    body { margin: 0; background: #ffffff; }
    .no-print { display: none !important; }
    @page { size: A4 portrait; margin: 0; }
    body * { visibility: hidden !important; }
    .job-slip-print-root, .job-slip-print-root * { visibility: visible !important; }
    .job-slip-print-root { margin: 0 !important; }
    .job-slip-mode-a4 { transform: none !important; height: auto !important; overflow: visible !important; margin: 0 !important; }
`;

/**
 * Collect all stylesheet text from document.styleSheets. Cross-origin
 * sheets (CORS-protected) throw on cssRules access — skip those; a
 * standalone file never loads them anyway.
 */
export function collectInlineStyles(): string {
  return Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
      } catch {
        return ''; // cross-origin sheet — skip
      }
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Assemble a standalone HTML document: all app CSS inlined (styles survive
 * outside the app, unlike relative <link>s that 404) plus `extraCss` as the
 * print-isolation block, with `containerHtml` as the body. `styles` lets
 * tests inject stylesheet text instead of reading document.styleSheets.
 */
export function buildStandaloneHtml(
  containerHtml: string,
  opts?: { title?: string; extraCss?: string; styles?: string },
): string {
  const title = opts?.title || 'Print Document';
  const styles = opts?.styles ?? collectInlineStyles();
  const extra = opts?.extraCss ? `\n  <style>${opts.extraCss}</style>` : '';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    ${styles}
  </style>${extra}
</head>
<body>
  ${containerHtml}
</body>
</html>`;
}

/** Download a standalone HTML document via a temporary object URL. */
export function downloadStandaloneHtml(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
