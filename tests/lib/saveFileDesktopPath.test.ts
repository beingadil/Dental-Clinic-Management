// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * "Export PDF did nothing" was reported as an export bug. It was three separate
 * things, and the file each landed in a different place:
 *
 *   1. The button was `disabled` until a clinic was chosen. A disabled control
 *      cannot be clicked and cannot explain itself, so pressing it produced no
 *      file, no message and no visible change — indistinguishable from broken.
 *
 *   2. Inside the desktop shell, `saveFile` fell back to a Blob + <a download>
 *      when the Tauri helpers failed to load. WebView2 routes the download event
 *      away, so the bytes were discarded — and the web branch returned
 *      `saved`, so the app reported success while writing nothing.
 *
 *   3. A permanent latch meant one transient import failure disabled every
 *      export for the rest of the session, with no way back short of a restart.
 *
 * `isDesktop` is the seam: it is the only thing that distinguishes the shell
 * from a browser, and every one of these decisions turns on it.
 */
const desktopState = vi.hoisted(() => ({ desktop: false }));

vi.mock('../../src/db/persistence', () => ({
  isDesktop: () => desktopState.desktop,
}));

import { saveFile } from '../../src/lib/saveFile';

afterEach(() => {
  vi.resetModules();
  desktopState.desktop = false;
});

describe('saveFile on the web build', () => {
  beforeEach(() => desktopState.desktop = false);

  it('hands the file to the browser and says where it went', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = ((b: Blob) => {
      created.push(b.type);
      return origCreate(b);
    }) as never;
    URL.revokeObjectURL = ((u: string) => revoked.push(u)) as never;

    const result = await saveFile('Ledger_A.pdf', new Uint8Array([1, 2, 3]), {
      extension: '.pdf',
      mimeType: 'application/pdf',
    });

    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;

    if (result.status !== 'saved') {
      const detail = result.status === 'error' ? result.message : '(no detail)';
      throw new Error(`expected saved, got ${result.status}: ${detail}`);
    }
    expect(created).toContain('application/pdf');
  });
});

describe('saveFile inside the desktop shell', () => {
  it('never reports a save it could not perform', async () => {
    desktopState.desktop = true;
    // Force the helper import to fail, which is what a stale chunk after an
    // app update looks like.
    vi.doMock('@tauri-apps/plugin-dialog', () => {
      throw new Error('chunk load failed');
    });

    const result = await saveFile('Ledger_A.pdf', new Uint8Array([1, 2, 3]), {
      extension: '.pdf',
      mimeType: 'application/pdf',
    });

    /* The old code fell through to the Blob download here and returned
       `saved`. In WebView2 that download is discarded, so the operator was told
       the export worked while no file existed anywhere. */
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toMatch(/nothing was written/i);
    }
  });
});

describe('the ledger export button', () => {
  it('is never disabled — a control that cannot be clicked cannot explain itself', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').resolve(process.cwd(), 'src/components/billing/GeneralLedgerView.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/onClick=\{handleExportPDF\}[\s\S]{0,200}?disabled=/);
  });

  it('explains a missing clinic instead of returning silently', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').resolve(process.cwd(), 'src/components/billing/GeneralLedgerView.tsx'),
      'utf8',
    );
    // The old guard was a bare `return`.
    expect(src).not.toMatch(/if \(!selectedClinic\) return;/);
    expect(src).toMatch(/NEEDS_CLINIC/);
  });

  it('reports a successful save on the page, naming the path', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').resolve(process.cwd(), 'src/components/billing/GeneralLedgerView.tsx'),
      'utf8',
    );
    // A successful save used to say nothing at all; only the error case raised
    // an alert, which is behind the window the operator was looking at.
    expect(src).toMatch(/kind: 'saved'/);
    expect(src).toMatch(/role="status"/);
  });
});