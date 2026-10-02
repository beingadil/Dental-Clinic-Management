// Pure node tests — no DOM environment needed (vitest default = node).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SLIP_PRINT_BODY_CLASS,
  SLIP_PRINT_ROOT_CLASS,
  PRINT_CONTAINER_SELECTOR,
  BATCH_STANDALONE_CSS,
  buildStandaloneHtml,
} from '../../src/components/print/printPipeline';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const slipCss = read('src/components/print/jobSlipPrint.css');
const genericCss = read('src/components/print/printStyles.css');
const indexCss = read('src/index.css');

/**
 * Print CSS contract tests. These pin the load-bearing rules of the two
 * print pipelines — regression here means broken paper output (blank pages,
 * merged pages, clipped sheets), which no unit test on components can see.
 */

describe('print CSS contract — slip pipeline isolation', () => {
  it('blanket-hides the document only while the slip body class is active', () => {
    // Scoped to body.job-slip-printing-on: must NEVER blanket-hide globally,
    // or invoice/report surfaces would print blank.
    expect(slipCss).toMatch(
      new RegExp(`body\\.${SLIP_PRINT_BODY_CLASS} \\*\\s*\\{\\s*visibility: hidden`),
    );
  });

  it('reveals only .job-slip-print-root subtrees (and nothing else)', () => {
    expect(slipCss).toMatch(
      new RegExp(`body\\.${SLIP_PRINT_BODY_CLASS} \\.job-slip-print-root,\\s*body\\.${SLIP_PRINT_BODY_CLASS} \\.job-slip-print-root \\*\\s*\\{\\s*visibility: visible`),
    );
  });

  it('strips screen-fit preview transforms from A4 sheets on paper', () => {
    expect(slipCss).toMatch(
      new RegExp(`body\\.${SLIP_PRINT_BODY_CLASS} \\.job-slip-mode-a4\\s*\\{[^}]*transform: none`),
    );
  });

  it('neutrals the batch root .print-area rule so sheets keep flowing', () => {
    // Without this, the generic .print-area absolute-position rule collapses
    // every A4 sheet onto page 1 — pages 2+ print blank.
    expect(slipCss).toMatch(
      new RegExp(`body\\.${SLIP_PRINT_BODY_CLASS} \\.job-slip-printing\\.print-area\\s*\\{[^}]*position: static`),
    );
  });

  it('defines every named @page it references', () => {
    // Regression: the batch named its page `job-slip-a4` in two places but
    // never defined it, so the sheets silently fell back to the generic
    // 12mm-margin page and printed clipped/overflowed instead of as previewed.
    const referenced = new Set(
      Array.from(slipCss.matchAll(/page:\s*job-slip-[a-z0-9-]+/g)).map((m) => m[0].split(':')[1].trim()),
    );
    referenced.add('job-slip-single');
    for (const name of referenced) {
      expect(slipCss).toMatch(new RegExp(`@page\\s+${name.replace(/[-]/g, '\\-')}\\s*\\{`));
    }
  });

  it('keeps the single-slip preview zoom out of paper', () => {
    // The 0.9 screen zoom must be screen-only: as an inline style it was
    // never stripped, so "Print Card" produced a 90mm × 85.5mm tag.
    const screenBlock = slipCss.slice(slipCss.indexOf('.job-slip-preview-zoom'));
    const mediaQuery = slipCss.lastIndexOf('@media print', slipCss.indexOf('.job-slip-preview-zoom'));
    expect(mediaQuery).toBeLessThan(slipCss.indexOf('.job-slip-preview-zoom'));
    expect(screenBlock).toContain('transform: scale(0.9)');
    expect(slipCss).toMatch(/\.job-slip-preview-zoom\s*\{[^}]*transform: scale/);
  });

  it('does not size the single-slip wrapper as a second page box', () => {
    expect(slipCss).toMatch(/\.job-slip-mode-single \.job-slip-page\s*\{[^}]*width: auto/);
  });

  it('names a page for the single slip so it does not inherit the batch A4 page', () => {
    // <body> gets page: job-slip-a4 during slip printing. Without a
    // single-slip override the 100 × 95 mm tag printed small in the corner
    // of a full A4 sheet.
    expect(slipCss).toMatch(
      new RegExp(`body\\.${SLIP_PRINT_BODY_CLASS}:has\\(\\.job-slip-mode-single[^)]*\\)\\s*\\{[^}]*page: job-slip-single`),
    );
  });
});

describe('single slip print wiring (CaseJobSlipModal)', () => {
  const modal = read('src/components/cases/CaseJobSlipModal.tsx');

  it('runs the same scoped isolation as the batch modal', () => {
    // The card used to stay a generic .print-area, so the tag printed
    // through the app-wide 12mm-margin page instead of its own geometry.
    expect(modal).toContain(SLIP_PRINT_BODY_CLASS);
    expect(modal).toContain(SLIP_PRINT_ROOT_CLASS);
  });

  it('marks the compact slip preview as a print root', () => {
    expect(modal).toMatch(/job-slip-print-root/);
    expect(modal).toMatch(/job-slip-mode-single/);
  });

  it('does not inline a print-time transform on the slip', () => {
    expect(modal).not.toMatch(/transform:\s*'scale\(/);
    expect(modal).toContain('job-slip-preview-zoom');
  });
});

describe('print CSS contract — generic pipeline (lab cards, invoices, batch)', () => {
  it('gives each batch document a real page break', () => {
    // .page-break was referenced by the modals but defined nowhere — pages
    // silently merged on paper. Guard the definition itself.
    expect(genericCss).toMatch(/\.page-break\s*\{[^}]*break-after: page/);
  });

  it('neutralizes the batch modal height cap and inner scroller on paper', () => {
    expect(genericCss).toMatch(/\.batch-panel\s*\{[^}]*max-height: none/);
    expect(genericCss).toMatch(/\.batch-scroll-area\s*\{[^}]*overflow: visible/);
  });

  it('resets global UI zoom so paper keeps true sizes', () => {
    expect(indexCss).toMatch(/html\s*\{[^}]*zoom: 1 !important/);
  });
});

describe('standalone HTML serializer', () => {
  it('embeds container HTML, injected styles, extra CSS and title', () => {
    const html = buildStandaloneHtml('<div class="sheet">SHEET</div>', {
      title: 'Job Slips 2026-09-30',
      extraCss: BATCH_STANDALONE_CSS,
      styles: '.app-css { color: red; }',
    });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<title>Job Slips 2026-09-30</title>');
    expect(html).toContain('<div class="sheet">SHEET</div>');
    expect(html).toContain(BATCH_STANDALONE_CSS);
    expect(html).toContain('.app-css { color: red; }');
  });

  it('batch isolation CSS hides everything except slip roots', () => {
    expect(BATCH_STANDALONE_CSS).toContain('body * { visibility: hidden !important; }');
    expect(BATCH_STANDALONE_CSS).toContain('.job-slip-print-root, .job-slip-print-root * { visibility: visible !important; }');
    expect(BATCH_STANDALONE_CSS).toContain('.job-slip-mode-a4 { transform: none !important;');
  });
});

describe('pipeline constants', () => {
  it('isolation class names match the CSS contract', () => {
    expect(SLIP_PRINT_BODY_CLASS).toBe('job-slip-printing-on');
    expect(SLIP_PRINT_ROOT_CLASS).toBe('job-slip-printing');
    expect(slipCss).toContain(`.${SLIP_PRINT_ROOT_CLASS}.print-area`);
    expect(PRINT_CONTAINER_SELECTOR).toBe('.space-y-8');
  });
});
