import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, sha256Hex } from '../../src/db/crypto';

describe('password hashing (WebCrypto PBKDF2)', () => {
  it('produces a verifiable hash', async () => {
    const hash = await hashPassword('adil123');
    expect(hash.startsWith('pbkdf2$')).toBe(true);
    expect(await verifyPassword('adil123', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('generates unique salts per call', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });

  it('rejects empty passwords', async () => {
    await expect(hashPassword('')).rejects.toThrow();
  });

  it('handles malformed stored hashes safely', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2$abc$$$')).toBe(false);
  });
});

describe('sha256 checksums', () => {
  it('hashes strings deterministically', async () => {
    const h1 = await sha256Hex('dental');
    const h2 = await sha256Hex('dental');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });
});
