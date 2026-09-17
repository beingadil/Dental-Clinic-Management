/**
 * Local password hashing via WebCrypto PBKDF2-SHA256 (fully offline, no dependencies).
 * Format: pbkdf2$<iterations>$<salt-b64>$<hash-b64>
 */

const ITERATIONS = 150_000;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
}

function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error('Password must not be empty');
  const salt = randomSalt();
  const bits = await deriveBits(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toBase64(salt.buffer as ArrayBuffer)}$${toBase64(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iterStr, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'pbkdf2' || !iterStr || !saltB64 || !hashB64) return false;
    const iterations = parseInt(iterStr, 10);
    if (!Number.isFinite(iterations) || iterations <= 0) return false;
    const salt = fromBase64(saltB64);
    const expected = fromBase64(hashB64);
    const bits = await deriveBits(password, salt, iterations);
    const actual = new Uint8Array(bits);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}

/** SHA-256 checksum for attachment integrity. */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Deterministic legacy password hash (SHA-256), used only to import pre-migration plaintext. */
export async function legacyHashForMigration(plaintext: string, salt: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const combined = new Uint8Array(encoder.encode(plaintext).length + salt.length);
  combined.set(encoder.encode(plaintext));
  combined.set(salt, encoder.encode(plaintext).length);
  const digest = await crypto.subtle.digest('SHA-256', combined as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const PBKDF2_ITERATIONS = ITERATIONS;
