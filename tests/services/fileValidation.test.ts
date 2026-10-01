import { describe, it, expect } from 'vitest';
import { validateFile } from '../../src/services/fileValidation';

describe('validateFile (B5 payment-proof guard)', () => {
  const opts = { maxMB: 2, mimeAllow: ['image/', 'application/pdf'] };

  it('accepts a small image', () => {
    expect(validateFile({ size: 500_000, type: 'image/png', name: 'proof.png' }, opts)).toEqual({ ok: true });
  });

  it('accepts a small pdf', () => {
    expect(validateFile({ size: 1_500_000, type: 'application/pdf', name: 'receipt.pdf' }, opts)).toEqual({ ok: true });
  });

  it('rejects a file over the size cap', () => {
    const r = validateFile({ size: 5 * 1024 * 1024, type: 'image/png', name: 'big.png' }, opts);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/5\.0 MB/);
    expect(r.error).toMatch(/2 MB/);
  });

  it('rejects a disallowed MIME type', () => {
    const r = validateFile({ size: 1000, type: 'application/zip', name: 'archive.zip' }, opts);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/application\/zip/);
  });

  it('allows an unknown type only when the browser reports none (tolerant)', () => {
    // Some Android browsers report '' for unknown; can't sniff client-side.
    expect(validateFile({ size: 1000, type: '', name: 'camera-capture' }, opts)).toEqual({ ok: true });
  });
});
