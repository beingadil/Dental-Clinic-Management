// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * "It saves locally, but with 0 bytes."
 *
 * Reproduced headlessly. showSaveFilePicker() CREATES the file at the chosen
 * path immediately — empty. createWritable() then opens a stream on it, and
 * that call needs write permission on the handle. Without it Chromium throws
 *
 *     NotAllowedError: Failed to execute 'createWritable' on
 *     'FileSystemFileHandle': The request is not allowed by the user agent or the
 *     platform in the current context.
 *
 * so the write never happens, the catch reports an error, and the operator is
 * left holding a file that EXISTS and is ZERO BYTES. The file was never the
 * problem; the permission was.
 *
 * Two guards, because either alone still loses:
 *   - ask for readwrite before opening the stream (fixes it), and
 *   - read the file back after close() and refuse to call an empty result a
 *     success (catches the same class of failure from any other cause).
 */
const desktopState = vi.hoisted(() => ({ desktop: false }));
vi.mock('../../src/db/persistence', () => ({
  isDesktop: () => desktopState.desktop,
}));

type HandleOpts = {
  name?: string;
  /** 'prompt' models a handle that has not been granted yet. */
  permission?: 'granted' | 'denied' | 'prompt';
  writeThrows?: string;
  landedSize?: number;
};

/** A handle that models Chromium's permission gate and its staged write. */
const stubHandle = (o: HandleOpts) => {
  const calls: string[] = [];
  return {
    calls,
    handle: {
      name: o.name ?? 'Chosen.pdf',
      queryPermission: async () => {
        calls.push('queryPermission');
        // 'prompt' models a handle that has not been granted yet.
        return o.permission === 'denied' ? 'denied' : o.permission ?? 'prompt';
      },
      requestPermission: async () => {
        calls.push('requestPermission');
        // The operator approves the prompt.
        return o.permission === 'denied' ? 'denied' : 'granted';
      },
      createWritable: async () => {
        calls.push('createWritable');
        if (o.writeThrows) throw new Error(o.writeThrows);
        return {
          write: async () => {
            calls.push('write');
          },
          close: async () => {
            calls.push('close');
          },
        };
      },
      getFile: async () => {
        calls.push('getFile');
        return { size: o.landedSize ?? 3 };
      },
    },
  };
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

describe('write permission', () => {
  it('opens the stream directly, without re-asking for permission', async () => {
    /* A handle from showSaveFilePicker() already carries write permission.
       requestPermission() is for directory/drag-drop handles and answers
       'denied' on a save handle — which is what refused a legitimate save. */
    const s = stubHandle({});
    (window as never as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => s.handle);
    const { saveFile } = await import('../../src/lib/saveFile');

    const result = await saveFile('Ledger.pdf', new Uint8Array([1, 2, 3]), saveOpts);

    expect(s.calls).not.toContain('requestPermission');
    expect(s.calls).not.toContain('queryPermission');
    expect(s.calls).toContain('createWritable');
    expect(result.status).toBe('saved');
  });

  it('falls back to a download when the stream is refused, rather than losing the file', async () => {
    /* The chooser path failing must not cost the operator their save. */
    const s = stubHandle({ writeThrows: 'NotAllowedError: stream refused' });
    (window as never as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => s.handle);
    const { saveFile } = await import('../../src/lib/saveFile');

    const result = await saveFile('Ledger.pdf', new Uint8Array([1, 2, 3]), saveOpts);

    expect(result.status).toBe('saved');
    if (result.status === 'saved') expect(result.path).toBe('Ledger.pdf');
  });
});

describe('the 0-byte result', () => {
  it('does not report an empty file as a successful save', async () => {
    const s = stubHandle({ landedSize: 0 });
    (window as never as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => s.handle);
    const { saveFile } = await import('../../src/lib/saveFile');

    const result = await saveFile('Ledger.pdf', new Uint8Array([1, 2, 3]), saveOpts);

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.message).toMatch(/nothing was written/i);
  });

  it('reads the file back rather than trusting close()', async () => {
    const s = stubHandle({ landedSize: 3140 });
    (window as never as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => s.handle);
    const { saveFile } = await import('../../src/lib/saveFile');

    const result = await saveFile('Ledger.pdf', new Uint8Array(3140), saveOpts);

    expect(s.calls).toContain('getFile');
    expect(result.status).toBe('saved');
    if (result.status === 'saved') expect(result.bytes).toBe(3140);
  });

  it('falls back to a download when the write itself fails, so the file is not lost', async () => {
    /* A refused stream used to surface as an error and cost the operator their
       save. The chooser is a convenience; the file is the point. */
    const s = stubHandle({ writeThrows: 'disk full' });
    (window as never as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => s.handle);
    const { saveFile } = await import('../../src/lib/saveFile');

    const result = await saveFile('Ledger.pdf', new Uint8Array([1, 2, 3]), saveOpts);

    expect(result.status).toBe('saved');
    if (result.status === 'saved') expect(result.path).toBe('Ledger.pdf');
  });

  it('treats a dismissed chooser as a choice, not a fault', async () => {
    (window as never as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    });
    const { saveFile } = await import('../../src/lib/saveFile');

    expect((await saveFile('Ledger.pdf', new Uint8Array([1]), saveOpts)).status).toBe(
      'cancelled',
    );
  });

  it('does not call a file that came out short a success', async () => {
    /* A file that is SHORT is as broken as one that is empty, and it is worse:
       a truncated PDF still opens, so the operator finds out later that the
       document is damaged. */
    const s = stubHandle({ landedSize: 900 });
    (window as never as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => s.handle);
    const { saveFile } = await import('../../src/lib/saveFile');

    const result = await saveFile('Ledger.pdf', new Uint8Array(3140), saveOpts);

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.message).toMatch(/incomplete/i);
  });

  it('says which of the two paths the file took', async () => {
    /* "Saved" is not enough when one path writes where the operator chose and
       the other writes to the browser's download folder. The second one has no
       dialog, so nothing else tells them where to look. */
    const s = stubHandle({});
    (window as never as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => s.handle);
    const { saveFile } = await import('../../src/lib/saveFile');

    const chosen = await saveFile('Ledger.pdf', new Uint8Array([1, 2, 3]), saveOpts);
    expect(chosen.status).toBe('saved');
    if (chosen.status === 'saved') expect(chosen.location).toBe('chosen');

    /* A chooser that fails for a reason that is not a cancel falls through to
       the plain download, and that has to be reported as such. */
    const broken = stubHandle({ writeThrows: 'stream refused' });
    (window as never as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => broken.handle);
    const fell = await saveFile('Ledger.pdf', new Uint8Array([1, 2, 3]), saveOpts);
    expect(fell.status).toBe('saved');
    if (fell.status === 'saved') expect(fell.location).toBe('downloads');
  });
});

describe('the blob URL lifetime', () => {
  it('is not revoked on a timer while a download may still be reading it', async () => {
    /* A blob URL points at a snapshot the browser holds, not at the bytes.
       The download reads them when it STARTS, which can be long after the
       click — after the operator has answered a "Save as" dialog. Revoking on
       a timer races that, and a revoked blob arrives as a ZERO-BYTE file.

       That is exactly what the operator got: a PDF in Downloads that would
       not open, because it was empty. */
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    (window as never as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => {
      const e = new Error('chooser unavailable');
      e.name = 'NotAllowedError';
      throw e;
    });
    const { saveFile } = await import('../../src/lib/saveFile');

    const result = await saveFile('Ledger.pdf', new Uint8Array([1, 2, 3]), saveOpts);
    expect(result.status).toBe('saved');

    // Nothing has been revoked yet: the download may still be starting.
    expect(revoke).not.toHaveBeenCalled();

    // It is released when the document goes away, which is the last moment
    // anything could still need it.
    const before = revoke.mock.calls.length;
    window.dispatchEvent(new Event('pagehide'));
    expect(revoke.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('the source contract', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/lib/saveFile.ts'), 'utf8');

  it('never re-requests permission on a save handle', () => {
    /* The guard that asked for it answered 'denied' on a handle the operator
       had already granted, and refused a legitimate save. Matched on the call
       site — the interface still declares the method, which is harmless. */
    expect(src).not.toMatch(/handle\.requestPermission/);
    expect(src).not.toMatch(/handle\.queryPermission/);
  });

  it('falls through to the download when the chooser path throws', () => {
    expect(src).toMatch(/falls through to the plain download/);
  });

  it('verifies the result after close rather than assuming it', () => {
    expect(src).toMatch(/getFile/);
    expect(src).toMatch(/nothing was written/);
  });

  it('keeps the dotted extension the File System Access API demands', () => {
    /* "pdf" is rejected outright: "Extension 'pdf' must start with '.'". */
    expect(src).toMatch(/opts\.extension\.startsWith\('\.'\)/);
  });
});