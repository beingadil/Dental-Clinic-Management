import { describe, it, expect } from 'vitest';
import {
  compareVersions,
  parseOfflineUpdate,
  currentVersion,
  isTrustedReleaseUrl,
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

// The same golden fixtures are pinned by the Rust unit tests in
// src-tauri/src/lib.rs (parse_semver / semver_cmp) — the two parsers must
// never drift apart.
describe('version comparison (full semver, mirrors Rust)', () => {
  it('a four-part core outranks its three-part prefix', () => {
    expect(compareVersions('2.31.26.1', '2.31.26')).toBe(1);
    expect(compareVersions('2.31.26', '2.31.26.1')).toBe(-1);
  });

  it('a prerelease sorts before its release', () => {
    expect(compareVersions('2.31.27-rc.1', '2.31.27')).toBe(-1);
    expect(compareVersions('2.31.27', '2.31.27-rc.1')).toBe(1);
  });

  it('prerelease identifiers compare numerically when all-numeric', () => {
    expect(compareVersions('2.31.27-rc.2', '2.31.27-rc.10')).toBe(-1);
    // Numeric identifiers sort below alphanumeric ones.
    expect(compareVersions('2.31.27-1', '2.31.27-a')).toBe(-1);
    // A shorter prerelease list sorts before a longer one that extends it.
    expect(compareVersions('2.31.27-rc', '2.31.27-rc.1')).toBe(-1);
  });

  it('accepts a leading v and any component count', () => {
    expect(compareVersions('v2.31.27', '2.31.27')).toBe(0);
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
  });

  it('an unparseable version never offers an update', () => {
    expect(compareVersions('garbage', '2.31.26')).toBe(-1);
    expect(compareVersions('2.31.26', 'garbage')).toBe(1);
    expect(compareVersions('garbage', 'also-garbage')).toBe(0);
  });
});

describe('isTrustedReleaseUrl', () => {
  it('allows the GitHub release hosts', () => {
    expect(isTrustedReleaseUrl('https://github.com/beingadil/Dental-Clinic-Management/releases/download/v2.31.29/x-setup.exe')).toBe(true);
    expect(isTrustedReleaseUrl('https://objects.githubusercontent.com/x')).toBe(true);
    expect(isTrustedReleaseUrl('https://release-assets.githubusercontent.com/x')).toBe(true);
  });

  it('rejects lookalike hosts, non-https and junk', () => {
    expect(isTrustedReleaseUrl('https://github.com.evil.com/x')).toBe(false);
    expect(isTrustedReleaseUrl('https://githubapp.com/x')).toBe(false);
    expect(isTrustedReleaseUrl('http://github.com/x')).toBe(false);
    expect(isTrustedReleaseUrl('javascript:alert(1)')).toBe(false);
    expect(isTrustedReleaseUrl('https://raw.githubusercontent.com/x')).toBe(false); // not a release-asset host
    expect(isTrustedReleaseUrl('')).toBe(false);
    expect(isTrustedReleaseUrl(undefined)).toBe(false);
    expect(isTrustedReleaseUrl(null)).toBe(false);
    expect(isTrustedReleaseUrl('not a url')).toBe(false);
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
