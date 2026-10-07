// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { seedDatabase } from '../../src/db/seeds';
import { AutoUpdatePanel } from '../../src/components/common/AutoUpdatePanel';
import {
  applyStagedUpdate,
  discardStagedUpdate,
  getAutoUpdatePhase,
  reconcileInstallReceipt,
} from '../../src/services/updateInstaller';

/**
 * Auto-installer UI (v2.17).
 *
 * The requirement this pins: NO installer banner anywhere. When an update is
 * detected the app downloads and verifies it by itself and then asks for a
 * single, explicit "Restart & Apply Updates" click. Clicking it must reach the
 * native `update_apply` command — that is the only path that closes the app.
 */

afterEach(cleanup);

let engine: SqliteEngine;
beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
  await seedDatabase();
});

function pendingReceipt() {
  return {
    running_version: '2.16.0',
    receipt_status: 'pending',
    staged_installer_present: true,
    receipt: {
      magic: 'DENTALUPDATE-RECEIPT',
      version: '9.9.9',
      checksum: 'sha256:abc123',
      bytes: 5_242_880,
      staged_at: '2026-10-07T10:00:00Z',
      staged_path: 'C:/Temp/dental-solutions-update/setup.exe',
      previous_version: '2.16.0',
    },
  };
}

describe('AutoUpdatePanel — floating installer', () => {
  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it('says nothing while there is no update to talk about', async () => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn(async () => ({
        running_version: '2.16.0',
        receipt_status: 'none',
        receipt: null,
      })),
    };
    await reconcileInstallReceipt();

    const { container } = render(<AutoUpdatePanel />);
    expect(container.innerHTML).toBe('');
  });

  it('never shows a "download the installer" banner', async () => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn(async () => pendingReceipt()),
    };
    await reconcileInstallReceipt();

    render(<AutoUpdatePanel />);
    // The old banner said "Download Installer" and opened a browser. Neither
    // the wording nor the browser hand-off may come back.
    expect(screen.queryByText(/download installer/i)).toBeNull();
    expect(screen.queryByText(/open.*browser/i)).toBeNull();
  });

  it('asks for a restart once the installer is staged, and applies on click', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'update_diagnostics') return pendingReceipt();
      if (cmd === 'update_apply') return true;
      return true;
    });
    (window as any).__TAURI_INTERNALS__ = { invoke };
    await reconcileInstallReceipt();

    render(<AutoUpdatePanel />);

    const restart = await screen.findByRole('button', {
      name: /restart & apply updates/i,
    });
    // Version appears in the panel subtitle and again in the confirmation copy.
    expect(screen.getAllByText(/9\.9\.9/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /not now/i })).toBeTruthy();

    fireEvent.click(restart);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('update_apply');
    });
    // Applying is a terminal, non-interruptible state for the UI.
    expect(getAutoUpdatePhase().state).toBe('applying');
  });

  it('discards the staged installer on "Not now" so boot does not nag again', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'update_diagnostics') return pendingReceipt();
      return true;
    });
    (window as any).__TAURI_INTERNALS__ = { invoke };
    await reconcileInstallReceipt();

    render(<AutoUpdatePanel />);
    fireEvent.click(await screen.findByRole('button', { name: /not now/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('update_discard');
    });
    expect(getAutoUpdatePhase().state).toBe('idle');
  });
});

describe('AutoUpdatePanel — inline (Settings) layout', () => {
  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it('always renders the detail view, even with nothing pending', async () => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn(async () => ({
        running_version: '2.16.0',
        receipt_status: 'none',
        receipt: null,
      })),
    };
    await reconcileInstallReceipt();

    render(<AutoUpdatePanel variant="inline" />);
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeTruthy();
  });

  it('shows the five-step pipeline once an update is downloading', async () => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn(async () => pendingReceipt()),
    };
    await reconcileInstallReceipt();

    render(<AutoUpdatePanel variant="inline" />);
    for (const label of [
      /checking for updates/i,
      /verifying the installer/i,
      /backing up your clinic data/i,
      /ready to apply/i,
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
});

describe('apply / discard guards', () => {
  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it('refuses to apply when nothing is staged', async () => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn(async () => ({
        running_version: '2.16.0',
        receipt_status: 'none',
        receipt: null,
      })),
    };
    await reconcileInstallReceipt(); // phase stays put — nothing pending
    // Discard first so this assertion starts from a known idle store.
    await discardStagedUpdate();

    const invoke = (window as any).__TAURI_INTERNALS__.invoke as ReturnType<typeof vi.fn>;
    const phase = await applyStagedUpdate();

    expect(phase.state).not.toBe('applying');
    expect(invoke).not.toHaveBeenCalledWith('update_apply');
  });

  it('discards cleanly when there is no desktop shell', async () => {
    // Web build: no native commands at all, and the phase resets to idle.
    await expect(discardStagedUpdate()).resolves.toBeUndefined();
    expect(getAutoUpdatePhase().state).toBe('idle');
  });
});