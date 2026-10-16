// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * "Export PDF does not open a Save As window."
 *
 * The file was downloading correctly all along — it landed in the browser's
 * Downloads folder. What was missing was the *dialog*. An earlier note claimed
 * a web page cannot open one; that was wrong. Chromium's File System Access API
 * (`showSaveFilePicker`) does exactly this, and `http://127.0.0.1` is a secure
 * context, so it is available in the dev server as well as a hosted page.
 *
 * Three tiers, in the order that gives the operator the most control:
 *   1. Desktop  — native dialog plugin, bytes written by Rust.
 *   2. Browser  — showSaveFilePicker, a real Save As window, stream written.
 *   3. Browser without the API (Firefox, Safari) — the anchor download the
 *      page has always used. Still a working save, just not a chooser.
 *
 * A chooser the operator cannot see is worse than no chooser, because they
 * cannot tell a silent save from a failed one — so tier 3 must not masquerade
 * as tier 2, and the result has to say which path ran.
 */
const desktopState = vi.hoisted(() => ({ desktop: false }));

vi.mock('../../src/db/persistence', () => ({
  isDesktop: () => desktopState.desktop,
}));

type PickerResult =
  | { kind: 'ok'; name: string }
  | { kind: 'cancel' }
  | { kind: 'error'; reason: string };

/** Installs a fake showSaveFilePicker and records what was written to it. */
const stubPicker = (result: PickerResult, written?: { blob: Blob | null }) => {
  const calls: unknown[] = [];
  (window as never as Record<string, unknown>).showSaveFilePicker = vi.fn(async (opts: unknown) => {
    calls.push(opts);
    if (result.kind === 'cancel') {
      const err = new Error('The user aborted a request.');
      err.name = 'AbortError';
      throw err;
    }
    if (result.kind === 'error') throw new Error(result.reason);
    return {
      name: result.name,
      createWritable: async () => ({
        write: async (blob: Blob) => { written!.blob = blob; },
        close: async () => {},
      }),
    };
  });
  return calls;
};

const saveOpts = { extension: '.pdf', mimeType: 'application/pdf', dialogTitle: 'Save PDF' };

beforeEach(() => {
  desktopState.desktop = false;
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
});

afterEach(() => {
  delete (window as never as Record<string, unknown>).showSaveFilePicker;
  vi.restoreAllMocks();
});

describe('browser save uses a real Save As window', () => {
  it('calls showSaveFilePicker so a location can be chosen', async () => {
    const written = { blob: null as Blob | null };
    const calls = stubPicker({ kind: 'ok', name: 'Chosen.pdf' }, written);
    const { saveFile } = await import('../../src/lib/saveFile');

    const result = await saveFile('Ledger.pdf', new Uint8Array([1, 2, 3]), saveOpts);

    expect(calls).toHaveLength(1);
    expect(result.status).toBe('saved');
    if (result.status === 'saved') expect(result.path).toBe('Chosen.pdf');
  });

  it('writes the bytes it was given to the chosen file', async () => {
    const written = { blob: null as Blob | null };
    stubPicker({ kind: 'ok', name: 'Chosen.pdf' }, written);
    const { saveFile } = await import('../../src/lib/saveFile');

    await saveFile('Ledger.pdf', new Uint8Array([1, 2, 3]), saveOpts);

    expect(written.blob).toBeTruthy();
    expect(written.blob!.type).toBe('application/pdf');
    expect(written.blob!.size).toBe(3);
  });

  it('offers the file type filter, so the window is labelled correctly', async () => {
    const written = { blob: null as Blob | null };
    const calls = stubPicker({ kind: 'ok', name: 'Chosen.pdf' }, written);
    const { saveFile } = await import('../../src/lib/saveFile');

    await saveFile('Ledger.pdf', new Uint8Array([1]), saveOpts);

    const opts = calls[0] as { suggestedName?: string; types?: unknown[] };
    expect(opts.suggestedName).toBe('Ledger.pdf');
    expect(opts.types?.[0]).toMatchObject({
      accept: { 'application/pdf': ['pdf'] },
    });
  });

  it('reports a cancelled chooser as cancelled, not as a failure', async () => {
    stubPicker({ kind: 'cancel' });
    const { saveFile } = await import('../../src/lib/saveFile');

    const result = await saveFile('Ledger.pdf', new Uint8Array([1]), saveOpts);

    expect(result.status).toBe('cancelled');
  });

  it('surfaces a chooser that fails, rather than saving nothing quietly', async () => {
    stubPicker({ kind: 'error', reason: 'disk on fire' });
    const { saveFile } = await import('../../src/lib/saveFile');

    const result = await saveFile('Ledger.pdf', new Uint8Array([1]), saveOpts);

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.message).toMatch(/disk on fire/);
  });
});

describe('browsers without the File System Access API', () => {
  it('still saves, via the anchor download the page has always used', async () => {
    delete (window as never as Record<string, unknown>).showSaveFilePicker;
    const created: string[] = [];
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = ((b: Blob) => { created.push(b.type); return origCreate(b); }) as never;

    const { saveFile } = await import('../../src/lib/saveFile');
    const result = await saveFile('Ledger.pdf', new Uint8Array([1, 2, 3]), saveOpts);

    URL.createObjectURL = origCreate;

    expect(result.status).toBe('saved');
    expect(created).toContain('application/pdf');
  });
});