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
  it('asks for readwrite before opening the stream', async () => {
    const s = stubHandle({});
    (window as never as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => s.handle);
    const { saveFile } = await import('../../src/lib/saveFile');

    await saveFile('Ledger.pdf', new Uint8Array([1, 2, 3]), saveOpts);

    // Checked against the recorded call order, not the source text.
    expect(s.calls.indexOf('queryPermission')).toBeGreaterThanOrEqual(0);
    expect(s.calls.indexOf('queryPermission')).toBeLessThan(s.calls.indexOf('createWritable'));
  });

  it('requests it when the handle does not already grant it', async () => {
    const s = stubHandle({ permission: 'prompt' });
    (window as never as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => s.handle);
    const { saveFile } = await import('../../src/lib/saveFile');

    const result = await saveFile('Ledger.pdf', new Uint8Array([1, 2, 3]), saveOpts);

    expect(s.calls).toContain('requestPermission');
    expect(result.status).toBe('saved');
  });

  it('refuses to write when access is denied, and says so', async () => {
    const s = stubHandle({ permission: 'denied' });
    (window as never as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => s.handle);
    const { saveFile } = await import('../../src/lib/saveFile');

    const result = await saveFile('Ledger.pdf', new Uint8Array([1, 2, 3]), saveOpts);

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.message).toMatch(/refused write access/i);
    // Never opened a stream it could not write through.
    expect(s.calls).not.toContain('createWritable');
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

  it('surfaces a write that fails, instead of reporting success', async () => {
    const s = stubHandle({ writeThrows: 'disk full' });
    (window as never as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => s.handle);
    const { saveFile } = await import('../../src/lib/saveFile');

    const result = await saveFile('Ledger.pdf', new Uint8Array([1, 2, 3]), saveOpts);

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.message).toMatch(/disk full/);
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
});

describe('the source contract', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/lib/saveFile.ts'), 'utf8');

  it('asks for readwrite on the handle before createWritable', () => {
    /* Ordering is asserted behaviourally above (against the recorded call log).
       Here only that both exist — measuring source offsets would compare
       interface declarations, not the order the code runs in. */
    expect(src).toMatch(/requestPermission/);
    expect(src).toMatch(/createWritable/);
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