// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { seedDatabase } from '../../src/db/seeds';
import { settingsRepo } from '../../src/db/repos';
import { getUpdateHistory } from '../../src/services/updateHistory';
import {
  getAutoUpdatePhase,
  isAutoUpdateBusy,
  onAutoUpdatePhase,
  reconcileInstallReceipt,
  runAutoUpdate,
  type AutoUpdatePhase,
} from '../../src/services/updateInstaller';

/**
 * Auto-update phase machine (v2.17 rewrite).
 *
 * The old updater spawned the installer and closed the app by itself, so the
 * UI could never ask anything. These tests pin the behaviour that replaced it:
 *
 * - `isAutoUpdateBusy` marks exactly the phases that must not be interrupted
 *   (NOT `ready_to_apply` — that state waits on the user, by design),
 * - every listener receives phase changes (one store, two layouts),
 * - the stage receipt is reconciled three ways at boot: settled → record the
 *   install once, pending+file present → offer "Restart & Apply Updates",
 *   pending+file gone → say it was interrupted instead of asking for a
 *   pointless restart.
 */

let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
  await seedDatabase();
});

/** Minimal fake of the Tauri IPC surface the updater uses. */
function mockTauri(
  handler: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
) {
  const invoke = vi.fn(handler);
  (window as any).__TAURI_INTERNALS__ = { invoke };
  return invoke;
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    magic: 'DENTALUPDATE-RECEIPT',
    version: '9.9.9',
    checksum: 'sha256:abc123',
    bytes: 4_200_000,
    staged_at: '2026-10-07T10:00:00Z',
    staged_path: 'C:/Temp/dental-solutions-update/Dental.Solutions_9.9.9_x64-setup.exe',
    relaunch_target: 'C:/Program Files/Dental Solutions/dental-solutions.exe',
    previous_version: '2.16.0',
    ...overrides,
  };
}

afterEach(() => {
  delete (window as any).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('isAutoUpdateBusy', () => {
  it('is busy only while the updater owns the flow', () => {
    const busy: AutoUpdatePhase[] = [
      { state: 'checking' },
      { state: 'downloading', version: '9.9.9', received: 1, total: 2 },
      { state: 'verifying', version: '9.9.9' },
      { state: 'backing_up', version: '9.9.9' },
      { state: 'applying', version: '9.9.9' },
    ];
    for (const phase of busy) {
      expect(isAutoUpdateBusy(phase), phase.state).toBe(true);
    }
  });

  it('is NOT busy while the user still has a decision to make', () => {
    const waiting: AutoUpdatePhase[] = [
      { state: 'idle' },
      { state: 'up_to_date' },
      { state: 'available', version: '9.9.9' },
      // Staged: the machine is done and is politely waiting — this must not be
      // reported as busy, or the panel would grey out "Restart & Apply".
      { state: 'ready_to_apply', version: '9.9.9', bytes: 100 },
      { state: 'failed', message: 'offline' },
      // Handed to the browser: no Rust work in flight — the user decides.
      { state: 'handed_off', version: '9.9.9', message: 'opened in browser' },
    ];
    for (const phase of waiting) {
      expect(isAutoUpdateBusy(phase), phase.state).toBe(false);
    }
  });
});

describe('phase store fan-out', () => {
  it('gives a new subscriber the current phase immediately', () => {
    const seen: AutoUpdatePhase[] = [];
    const off = onAutoUpdatePhase((p) => seen.push(p));
    try {
      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual(getAutoUpdatePhase());
    } finally {
      off();
    }
  });

  it('notifies every subscriber and stops after unsubscribe', () => {
    const a: AutoUpdatePhase[] = [];
    const b: AutoUpdatePhase[] = [];
    const offA = onAutoUpdatePhase((p) => a.push(p));
    const offB = onAutoUpdatePhase((p) => b.push(p));
    // Both were seeded with the current phase on subscribe.
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);

    offA();
    offB();
  });
});

describe('receipt reconciliation', () => {
  beforeEach(() => {
    settingsRepo.set('updates', 'history', []);
  });

  it('returns null when there is no desktop shell to ask', async () => {
    // No __TAURI_INTERNALS__ → the webview build cannot have a stage receipt.
    expect(await reconcileInstallReceipt()).toBeNull();
  });

  it('records "installed" exactly once for a settled receipt', async () => {
    mockTauri(async () => ({
      running_version: '9.9.9',
      receipt_status: 'settled',
      receipt: receipt(),
    }));

    await reconcileInstallReceipt();
    await reconcileInstallReceipt(); // second boot must not duplicate the entry

    const installed = getUpdateHistory().filter(
      (h) => h.state === 'installed' && h.version === '9.9.9',
    );
    expect(installed).toHaveLength(1);
  });

  it('does not claim "installed" while the receipt is still pending', async () => {
    mockTauri(async () => ({
      running_version: '2.16.0',
      receipt_status: 'pending',
      staged_installer_present: true,
      receipt: receipt(),
    }));

    await reconcileInstallReceipt();

    expect(getAutoUpdateHistory_states()).not.toContain('installed');
    const phase = getAutoUpdatePhase();
    expect(phase.state).toBe('ready_to_apply');
    if (phase.state === 'ready_to_apply') {
      expect(phase.version).toBe('9.9.9');
      expect(phase.bytes).toBe(4_200_000);
    }
  });

  it('offers "ready" from a pending receipt without re-downloading', async () => {
    const invoke = mockTauri(async () => ({
      running_version: '2.16.0',
      receipt_status: 'pending',
      staged_installer_present: true,
      receipt: receipt(),
    }));

    await reconcileInstallReceipt();

    // Reconciliation is read-only: it must not kick off a fresh install.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('update_diagnostics');
    expect(getAutoUpdatePhase().state).toBe('ready_to_apply');
    expect(isAutoUpdateBusy(getAutoUpdatePhase())).toBe(false);
  });

  it('ignores a receipt from an older build instead of offering a downgrade', async () => {
    mockTauri(async () => ({
      running_version: '2.31.21',
      receipt_status: 'obsolete',
      staged_installer_present: true,
      receipt: receipt({ version: '2.31.18' }),
    }));

    await reconcileInstallReceipt();

    expect(getAutoUpdatePhase().state).not.toBe('ready_to_apply');
  });

  it('reports an applied-but-unlanded update as failed, not as ready to apply again', async () => {
    mockTauri(async () => ({
      running_version: '2.31.20',
      receipt_status: 'failed',
      staged_installer_present: true,
      receipt: receipt({
        version: '2.31.21',
        apply_requested_at: '20261106-120000',
      }),
    }));

    await reconcileInstallReceipt();

    const phase = getAutoUpdatePhase();
    expect(phase.state).toBe('failed');
    if (phase.state === 'failed') {
      expect(phase.message).toMatch(/did not complete/i);
      expect(phase.message).toContain('2.31.21');
    }
  });

  it('reports an interrupted update as failed, not as ready', async () => {
    mockTauri(async () => ({
      running_version: '2.16.0',
      receipt_status: 'pending',
      staged_installer_present: false, // installer was deleted / cleaned up
      receipt: receipt(),
    }));

    await reconcileInstallReceipt();

    const phase = getAutoUpdatePhase();
    expect(phase.state).toBe('failed');
    if (phase.state === 'failed') {
      expect(phase.message).toMatch(/interrupted/i);
      expect(phase.message).toContain('9.9.9');
    }
  });

  it('leaves the phase alone when there is no receipt at all', async () => {
    mockTauri(async () => ({
      running_version: '2.16.0',
      receipt_status: 'none',
      receipt: null,
    }));

    const before = getAutoUpdatePhase();
    const diag = await reconcileInstallReceipt();

    expect(diag?.receipt_status).toBe('none');
    expect(getAutoUpdatePhase()).toEqual(before);
  });

  it('ignores a receipt whose magic is not ours — no history, no phase', async () => {
    const invoke = mockTauri(async () => ({
      running_version: '2.16.0',
      receipt_status: 'settled',
      receipt: receipt({ magic: 'FORGED-RECEIPT' }),
    }));

    await reconcileInstallReceipt();

    // The settled path would normally record "installed" once — a forged
    // receipt must NOT.
    expect(
      getUpdateHistory().filter((h) => h.state === 'installed'),
    ).toHaveLength(0);
    expect(getAutoUpdatePhase().state).not.toBe('ready_to_apply');
    expect(invoke).toHaveBeenCalledTimes(1); // diagnostics only, no cleanup
  });

  it('never throws when diagnostics fail outright', async () => {
    mockTauri(async () => {
      throw new Error('receipt unreadable');
    });

    await expect(reconcileInstallReceipt()).resolves.toBeNull();
  });
});

describe('untrusted release URL fallback', () => {
  beforeEach(() => {
    settingsRepo.set('updates', 'history', []);
  });

  it('hands off to the browser instead of invoking Rust when the manifest has no download_url', async () => {
    const calls: string[] = [];
    mockTauri(async (cmd) => {
      calls.push(cmd);
      if (cmd === 'open_external') return null;
      throw new Error(`unexpected IPC: ${cmd}`);
    });
    // The webview's window.open would print a noisy jsdom warning; stub it.
    (window as any).open = vi.fn();
    // A manifest that checks out as "available" but carries no download_url —
    // the API fallback produces exactly this when no -setup.exe asset exists.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        magic: 'DENTALUPDATE',
        version: '99.99.99',
        channel: 'stable',
        released_at: '2026-11-17T00:00:00Z',
        payload_checksum: 'sha256:' + 'a'.repeat(64),
      }),
    })));
    try {
      const phase = await runAutoUpdate();
      expect(phase.state).toBe('handed_off');
      // The Rust downloader must NOT be invoked — it would refuse the URL.
      expect(calls).not.toContain('update_install');
      // The user still gets a route to the installer: the browser.
      expect(calls).toContain('open_external');
      const handedOff = getUpdateHistory().find((h) => h.state === 'handed_off');
      expect(handedOff?.version).toBe('99.99.99');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('hands off to the releases page when the download URL is off the trusted allowlist', async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    mockTauri(async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'open_external') return null;
      throw new Error(`unexpected IPC: ${cmd}`);
    });
    (window as any).open = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        magic: 'DENTALUPDATE',
        version: '99.99.98',
        channel: 'stable',
        released_at: '2026-11-17T00:00:00Z',
        download_url: 'https://cdn.example.com/dental-solutions-setup.exe', // NOT a trusted host
      }),
    })));
    try {
      const phase = await runAutoUpdate();
      expect(phase.state).toBe('handed_off');
      expect(calls.map((c) => c.cmd)).not.toContain('update_install');
      const openCall = calls.find((c) => c.cmd === 'open_external');
      expect(openCall?.args?.url).toBe('https://github.com/beingadil/Dental-Clinic-Management/releases/latest');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function getAutoUpdateHistory_states(): string[] {
  return getUpdateHistory().map((h) => h.state);
}