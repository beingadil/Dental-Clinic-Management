import { describe, it, expect, beforeAll } from 'vitest';
import {
  compareVersions,
  parseOfflineUpdate,
  currentVersion,
} from '../../src/services/updateService';
import { sha256Hex } from '../../src/db/crypto';

/**
 * Update-service verification (Phase 10):
 * - semver comparison incl. downgrade protection
 * - offline .dentalupdate package validation:
 *     magic header, newer-version requirement, SHA-256 payload integrity
 * - tampered / corrupt packages are rejected
 * (Online manifest fetch is intentionally NOT tested here — the app must
 * never require network; checkForUpdates() is exercised manually.)
 */

describe('version comparison (semver)', () => {
  it('orders versions correctly', () => {
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('2.0.1', '2.0.0')).toBe(1);
    expect(compareVersions('2.1.0', '2.0.9')).toBe(1);
    expect(compareVersions('3.0.0', '2.9.9')).toBe(1);
    expect(compareVersions('2.0.0', '2.1.0')).toBe(-1);
    expect(compareVersions('1.9.9', '2.0.0')).toBe(-1);
  });

  it('protects against downgrades', () => {
    // parseOfflineUpdate rejects packages not newer than the installed version
    const installed = currentVersion();
    expect(compareVersions(installed, installed)).toBe(0); // equal → rejected by caller
  });
});

// Fixture version is always one minor ahead of the installed version so the
// suite keeps passing no matter how APP_VERSION moves.
const FUTURE_VERSION = (() => {
  const [maj, min] = currentVersion().split('.');
  return `${maj}.${Number(min) + 1}.0`;
})();

function makeManifest(overrides: Partial<any> = {}) {
  return {
    magic: 'DENTALUPDATE',
    version: FUTURE_VERSION,
    channel: 'stable',
    released_at: '2026-09-17T00:00:00Z',
    notes: 'test update',
    ...overrides,
  };
}

describe('offline .dentalupdate package validation', () => {
  it('accepts a valid, newer package without payload', async () => {
    const result = await parseOfflineUpdate(JSON.stringify(makeManifest()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.version).toBe(FUTURE_VERSION);
  });

  it('rejects a package with the wrong magic header', async () => {
    const result = await parseOfflineUpdate(JSON.stringify(makeManifest({ magic: 'NOPE' })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Dental Solutions/i);
  });

  it('rejects downgrades (version not newer than installed)', async () => {
    const older = await parseOfflineUpdate(JSON.stringify(makeManifest({ version: '1.0.0' })));
    expect(older.ok).toBe(false);
    if (!older.ok) expect(older.error).toMatch(/not newer/i);

    const same = await parseOfflineUpdate(JSON.stringify(makeManifest({ version: currentVersion() })));
    expect(same.ok).toBe(false);
  });

  it('verifies SHA-256 payload integrity', async () => {
    const payload = new TextEncoder().encode('fake-update-payload-bytes');
    const checksum = 'sha256:' + (await sha256Hex(payload));
    const b64 = Buffer.from(payload).toString('base64');
    const result = await parseOfflineUpdate(
      JSON.stringify(makeManifest({ payload_b64: b64, payload_checksum: checksum }))
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a tampered payload via checksum mismatch', async () => {
    const payload = new TextEncoder().encode('original-payload');
    const checksum = 'sha256:' + (await sha256Hex(payload));
    const tampered = Buffer.from(new TextEncoder().encode('tampered-payload!!')).toString('base64');
    const result = await parseOfflineUpdate(
      JSON.stringify(makeManifest({ payload_b64: tampered, payload_checksum: checksum }))
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/checksum|tamper/i);
  });

  it('rejects malformed JSON safely', async () => {
    const result = await parseOfflineUpdate('{not json at all');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/parse/i);
  });
});
