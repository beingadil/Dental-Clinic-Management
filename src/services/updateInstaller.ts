/**
 * Auto-update engine — shared phase store consumed by the dashboard pill and
 * the Settings card. Flow: check manifest → (desktop) the native `update_install`
 * command streams the installer to disk, verifies SHA-256, takes a database
 * backup, runs the NSIS installer silently and exits so it can replace files.
 * The web build falls back to the system-browser download.
 *
 * Verification happens in Rust *before* anything is executed; a checksum
 * mismatch aborts the update with the file left untouched.
 */
import { settingsRepo } from '../db/repos';
import { checkForUpdates, UpdateStatus, currentVersion } from './updateService';
import { recordUpdateHistory } from './updateHistory';

export type AutoUpdatePhase =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up_to_date' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; received: number; total: number }
  | { state: 'verifying'; version: string }
  | { state: 'installing'; version: string }
  | { state: 'failed'; message: string };

interface TauriApi {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<any>;
  event?: {
    listen: (name: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>;
  };
}

function tauri(): TauriApi | null {
  const w = window as any;
  const api = w.__TAURI_INTERNALS__ || w.__TAURI__;
  return api && typeof api.invoke === 'function' ? api : null;
}

export function isDesktopShell(): boolean {
  return tauri() !== null;
}

type Listener = (phase: AutoUpdatePhase) => void;

let current: AutoUpdatePhase = { state: 'idle' };
const listeners = new Set<Listener>();

function setPhase(p: AutoUpdatePhase): void {
  current = p;
  for (const l of listeners) l(p);
}

/** Subscribe to auto-update progress (dashboard pill, Settings card). */
export function onAutoUpdatePhase(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

export function getAutoUpdatePhase(): AutoUpdatePhase {
  return current;
}

/** Last completed check, persisted for the dashboard pill. */
export function getLastUpdateCheck(): { at: string; version: string; state: string } | null {
  try {
    // settingsRepo already JSON-parses values — no second parse here.
    const row = settingsRepo.get('updates', 'last_check');
    return row ? (row as { at: string; version: string; state: string }) : null;
  } catch {
    return null;
  }
}

function setLastUpdateCheck(version: string, state: string): void {
  try {
    settingsRepo.set('updates', 'last_check', { at: new Date().toISOString(), version, state });
  } catch { /* non-fatal */ }
}

export interface UpdateDiagnostics {
  running_version: string;
  receipt_status: 'none' | 'settled' | 'pending';
  receipt: {
    magic: string;
    version: string;
    checksum: string;
    bytes: number;
    staged_at: string;
    staged_path?: string;
    relaunch_target?: string;
    previous_version?: string;
  } | null;
}

/**
 * Boot-time reconciliation — consumes the Rust stage receipt.
 *
 * When `update_install` exits the app, the IPC reply may never reach the
 * webview, so the installing run cannot record history itself. The receipt
 * (written by Rust before the waiter spawns) is the durable record: on the
 * next boot a `pending` receipt means "the install this receipt describes
 * has landed on this now-running build" → record `installed` history once,
 * then the receipt reads as `settled` forever after.
 */
export async function reconcileInstallReceipt(): Promise<UpdateDiagnostics | null> {
  if (!isDesktopShell()) return null;
  try {
    const api = tauri()!;
    const diag = (await api.invoke('update_diagnostics')) as UpdateDiagnostics;
    if (diag.receipt_status === 'pending' && diag.receipt) {
      recordUpdateHistory({
        version: diag.receipt.version,
        state: 'installed',
        message: `Staged ${diag.receipt.staged_at} from v${diag.receipt.previous_version || '?'}`,
      });
    }
    return diag;
  } catch {
    return null; // diagnostics are best-effort; never block boot
  }
}

/**
 * Runs the full update pipeline. Called on app start (dashboard mount) and
 * manually from Settings. Safe to call again while running — returns the
 * in-flight promise.
 */
let inflight: Promise<AutoUpdatePhase> | null = null;

export function runAutoUpdate(): Promise<AutoUpdatePhase> {
  if (inflight) return inflight;
  inflight = (async (): Promise<AutoUpdatePhase> => {
    setPhase({ state: 'checking' });
    const status: UpdateStatus = await checkForUpdates();
    if (status.state === 'error') {
      setLastUpdateCheck(currentVersion(), 'offline');
      recordUpdateHistory({ version: currentVersion(), state: 'failed', message: status.message });
      const phase: AutoUpdatePhase = { state: 'failed', message: status.message };
      setPhase(phase);
      return phase;
    }
    if (status.state !== 'available') {
      setLastUpdateCheck(currentVersion(), 'up_to_date');
      const phase: AutoUpdatePhase = { state: 'up_to_date' };
      setPhase(phase);
      return phase;
    }

    const { version, notes } = status as { version: string; notes?: string };
    const downloadUrl = (status as any).download_url as string | undefined;

    // Record availability immediately so the pill can show it even if the
    // download or install later fails.
    setLastUpdateCheck(version, 'available');
    recordUpdateHistory({ version, state: 'available' });
    setPhase({ state: 'available', version });

    if (!isDesktopShell()) {
      // Web build: hand off to the system browser (user completes download).
      const { downloadUpdate } = await import('./updateService');
      await downloadUpdate(downloadUrl);
      const phase: AutoUpdatePhase = { state: 'failed', message: 'Web build cannot auto-install — installer download opened in your browser.' };
      setPhase(phase);
      return phase;
    }

    try {
      setPhase({ state: 'downloading', version, received: 0, total: 0 });

      // Native side streams the download, verifies the checksum, backs up the
      // database and launches the installer. The release-asset CDN sends no
      // CORS headers, so this must run in Rust — a webview fetch of the
      // installer throws and the update silently dies (seen on v2.3.1).
      const api = tauri()!;
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<{ version?: string; received?: number; total?: number }>(
        'update://progress',
        (event) => {
          const p = event.payload;
          if (p && typeof p.received === 'number' && typeof p.total === 'number') {
            setPhase({ state: 'downloading', version, received: p.received, total: p.total });
          }
        },
      );

      let phase: AutoUpdatePhase;
      try {
        // Flush any pending SQLite writes BEFORE handing off to the installer:
        // app.exit(0) on the Rust side races the 400 ms debounced flush, and an
        // exit mid-write would lose the newest clinic data. Flush is awaited,
        // not fire-and-forget.
        try {
          const { flushNow } = await import('../db/persistence');
          await flushNow();
        } catch { /* non-fatal — the pre-update backup still protects data */ }

        const ok = await api.invoke('update_install', {
          version,
          downloadUrl: downloadUrl ?? null,
          expectedChecksum: (status as any).payload_checksum ?? null,
        });
        if (ok !== true) {
          phase = { state: 'failed', message: String(ok || 'Update installation failed') };
        } else {
          // Verified installer is running; the Rust side exits this app so the
          // installer can replace files, then relaunches the new version.
          phase = { state: 'installing', version };
        }
      } finally {
        if (unlisten) unlisten();
      }

      if (phase.state === 'installing') {
        // The Rust side already called app.exit(0) — nothing after this line
        // is guaranteed to run, which is why history/pill updates happen on
        // the NEXT boot from the update-install receipt, not here.
        try {
          sessionStorage.setItem('update-installed', version);
        } catch { /* non-fatal */ }
        phase = { state: 'installing', version };
      } else {
        recordUpdateHistory({ version, state: 'failed', message: (phase as any).message });
      }
      setPhase(phase);
      return phase;
    } catch (e: any) {
      const phase: AutoUpdatePhase = { state: 'failed', message: e?.message || String(e) };
      recordUpdateHistory({ version, state: 'failed', message: phase.message });
      setPhase(phase);
      return phase;
    }
  })();
  inflight.finally(() => { inflight = null; });
  return inflight;
}
