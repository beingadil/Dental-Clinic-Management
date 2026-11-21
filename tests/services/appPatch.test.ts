// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeAll, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { seedDatabase } from '../../src/db/seeds';
import { settingsRepo } from '../../src/db/repos';
import { getUpdateHistory } from '../../src/services/updateHistory';
import {
  applyPatch,
  runAutoUpdate,
} from '../../src/services/updateInstaller';
import { checkPatch, fetchPatchManifest, currentVersion } from '../../src/services/updateService';

/**
 * Hot-patch channel (TS side, Phase C). The Rust side (`app_patch.rs`)
 * downloads + verifies + writes + reloads; this layer gates discovery and
 * offers one-click apply. Trust: a patch is only OFFERED when its
 * base_version matches the running app's JS version — the JS-only window.
 */

let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
  await seedDatabase();
});

function stubFetch(handler: (url: string) => Promise<Response | null>): void {
  vi.stubGlobal('fetch', vi.fn((url: any) => handler(String(url))));
}
function mockTauri(
  handler: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
): void {
  (window as any).__TAURI_INTERNALS__ = { invoke: vi.fn(handler) };
}
afterEach(() => {
  delete (window as any).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makePatchManifest(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    magic: 'DENTALUPDATE-PATCH',
    base_version: currentVersion(),
    display_version: `v${currentVersion()}-patch`,
    released_at: '2026-11-21T09:00:00Z',
    notes: 'Aligner form small fixes',
    files: [{ path: 'assets/index-xyz.js', sha256: 'a'.repeat(64), size: 1234 }],
    deleted: [],
    ...overrides,
  };
}

function responseJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

describe('checkPatch — discovery', () => {
  it('is none when gh-pages has no patch for this version', async () => {
    stubFetch(async () => ({ ok: false, status: 404 } as Response));
    expect(await checkPatch()).toEqual({ state: 'none' });
    expect(await fetchPatchManifest()).toBeNull();
  });

  it('is none when the manifest targets a different base version (stale or app moved)', async () => {
    stubFetch(async () => responseJson(makePatchManifest({ base_version: '0.0.1-not-this-app' })));
    expect(await checkPatch()).toEqual({ state: 'none' });
  });

  it('is none when the manifest is garbage', async () => {
    stubFetch(async () => responseJson({ nope: true }));
    expect(await checkPatch()).toEqual({ state: 'none' });
  });

  it('is none when there are no files to apply', async () => {
    stubFetch(async () => responseJson(makePatchManifest({ files: [], base_version: currentVersion() })));
    expect(await checkPatch()).toEqual({ state: 'none' });
  });

  it('returns available when base_version == currentVersion()', async () => {
    stubFetch(async () => responseJson(makePatchManifest()));
    const m = await fetchPatchManifest();
    expect(m?.magic).toBe('DENTALUPDATE-PATCH');
    expect(await checkPatch()).toMatchObject({
      state: 'available',
      base_version: currentVersion(),
      display_version: expect.any(String),
    });
  });
});

describe('runAutoUpdate — discovers patches', () => {
  beforeEach(() => {
    settingsRepo.set('updates', 'history', []);
    mockTauri(async (cmd) => {
      if (cmd === 'update_diagnostics') {
        return { running_version: currentVersion(), receipt_status: 'none', receipt: null };
      }
      throw new Error('unexpected invoke: ' + cmd);
    });
  });

  it('sets patch_available when a patch targets the running version, without invoking Rust', async () => {
    stubFetch(async (url) => {
      if (url.includes('update-patch.json')) return responseJson(makePatchManifest());
      return null; // no real installer updates served
    });

    const phase = await runAutoUpdate();
    expect(phase.state).toBe('patch_available');
    if (phase.state === 'patch_available') {
      expect(phase.base_version).toBe(currentVersion());
      expect(phase.display_version).toContain(currentVersion().split('-')[0]);
    }
    expect(getUpdateHistory().some((x) => x.state === 'patch_available')).toBe(true);
  });

  it('offers the installer path when the patch is stale', async () => {
    stubFetch(async (url) => {
      if (url.includes('update-patch.json')) {
        return responseJson(makePatchManifest({ base_version: '0.0.1-not-this-app' }));
      }
      if (url.includes('api.github.com')) return { ok: false, status: 404 } as Response;
      return responseJson({ magic: 'DENTALUPDATE', version: currentVersion(), channel: 'stable' }); // up_to_date
    });

    const phase = await runAutoUpdate();
    expect(phase.state).toBe('up_to_date');
  });
});

describe('applyPatch — one-click apply', () => {
  beforeEach(async () => {
    settingsRepo.set('updates', 'history', []);
    stubFetch(async () => responseJson(makePatchManifest()));
  });

  it('invokes apply_app_patch and moves the phase to patched on success', async () => {
    mockTauri(async (cmd) => {
      expect(cmd).toBe('apply_app_patch');
      return { files_applied: 3, deleted_applied: 0 };
    });
    const discovered = await runAutoUpdate();
    expect(discovered.state).toBe('patch_available');

    const phase = await applyPatch();
    expect(phase?.state).toBe('patched');
    const h = getUpdateHistory().find((x) => x.state === 'patch_applied');
    expect(h?.message).toContain('applied');
  });

  it('records patch_failed and returns the phase when Rust refuses', async () => {
    mockTauri(async () => {
      throw new Error('hash mismatch — refusing');
    });
    const discovered = await runAutoUpdate();
    expect(discovered.state).toBe('patch_available');

    const phase = await applyPatch();
    expect(phase.state).toBe('patch_failed');
    if (phase.state === 'patch_failed') {
      expect(phase.message).toContain('hash mismatch');
    }
    const h = getUpdateHistory().find((x) => x.state === 'patch_failed');
    expect(h).toBeTruthy();
  });
});
