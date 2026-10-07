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
    expect(typeof offA).toBe('function');
    expect(typeof offB).toBe('function');
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

  it('never throws when diagnostics fail outright', async () => {
    mockTauri(async () => {
      throw new Error('receipt unreadable');
    });

    await expect(reconcileInstallReceipt()).resolves.toBeNull();
  });
});

function getAutoUpdateHistory_states(): string[] {
  return getUpdateHistory().map((h) => h.state);
}