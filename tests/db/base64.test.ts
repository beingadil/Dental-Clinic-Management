import { describe, it, expect } from 'vitest';
import { b64encode, b64decode } from '../../src/db/persistence';

/**
 * The snapshot encoder, pinned against the naive implementation it replaced.
 *
 * b64encode is on the autosave hot path: at clinic scale it encodes ~8.8 MB of
 * SQLite bytes on the UI thread every time the debounce fires. It was made
 * faster (table lookup instead of spreading an 8.8 MB typed array into
 * `String.fromCharCode`), which is only acceptable if the OUTPUT is provably
 * identical — a silent difference here would corrupt every saved database.
 */

/** The original implementation, kept verbatim as the reference. */
function referenceEncode(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Deterministic pseudo-random bytes; a pattern would hide ordering bugs. */
function pseudoBytes(n: number, seed = 12345): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = s & 0xff;
  }
  return out;
}

describe('snapshot base64 codec', () => {
  it('matches the naive encoder for every byte value', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect(b64encode(all)).toBe(referenceEncode(all));
  });

  it.each([
    ['empty', 0],
    ['one byte', 1],
    ['two bytes', 2],
    ['three bytes (exact group)', 3],
    ['one byte past a group', 4],
    ['inside the 4096 inner step', 4095],
    ['exactly one inner step', 4096],
    ['one past an inner step', 4097],
  ])('is byte-identical to the reference: %s', (_label, n) => {
    const bytes = pseudoBytes(n);
    expect(b64encode(bytes)).toBe(referenceEncode(bytes));
  });

  it('is identical across the 49152-byte base64 chunk boundary', () => {
    for (const n of [
      49151, // one under
      49152, // exactly one chunk (3-aligned)
      49153, // one over -> proves the trailing partial chunk is encoded whole
      98304, // exactly two chunks
      98305,
    ]) {
      const bytes = pseudoBytes(n);
      expect(b64encode(bytes), `length ${n}`).toBe(referenceEncode(bytes));
    }
  });

  it('agrees with the reference on a multi-megabyte snapshot', () => {
    const bytes = pseudoBytes(3 * 1024 * 1024, 99);
    expect(b64encode(bytes)).toBe(referenceEncode(bytes));
  });

  it('round-trips through decode', () => {
    for (const n of [0, 1, 4096, 49152, 200_000]) {
      const bytes = pseudoBytes(n, n + 7);
      expect(Array.from(b64decode(b64encode(bytes)))).toEqual(Array.from(bytes));
    }
  });
});