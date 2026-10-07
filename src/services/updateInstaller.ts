/**
 * Auto-update engine — one shared phase store for every update surface in the
 * app (the floating installer panel and Settings → Updates render the same
 * state, so they can never disagree).
 *
 * Flow: check manifest → download (native, checksum-verified, database backed
 * up) → **staged** → the user is asked to restart. Only then does the app close
 * and let the installer replace files.
 *
 * The split between "stage" and "apply" is deliberate: an updater that decides
 * by itself to close a clinic's running application mid-session loses the
 * user's place (and risks unflushed work) for a change they never asked for.
 * Downloading and verifying is automatic; closing the app is always a click.
 */
import { settingsRepo } from '../db/repos';
import { checkForUpdates, UpdateStatus, currentVersion } from './updateService';
import { recordUpdateHistory, getUpdateHistory } from './updateHistory';

export type AutoUpdatePhase =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up_to_date' }
  | { state: 'available'; version: string; notes?: string; released_at?: string }
  | { state: 'downloading'; version: string; received: number; total: number }
  | { state: 'verifying'; version: string }
  | { state: 'backing_up'; version: string }
  /** Installer downloaded, checksum-verified and on disk; nothing has run yet. */
  | { state: 'ready_to_apply'; version: string; bytes: number; staged_path?: string; checksum?: string }
  | { state: 'applying'; version: string }
  | { state: 'failed'; message: string };

interface TauriApi {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<any>;
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

/** Subscribe to auto-update progress (installer panel, Settings card). */
export function onAutoUpdatePhase(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

export function getAutoUpdatePhase(): AutoUpdatePhase {
  return current;
}

/** True while the updater is doing work that must not be interrupted. */
export function isAutoUpdateBusy(phase: AutoUpdatePhase): boolean {
  return (
    phase.state === 'checking' ||
    phase.state === 'downloading' ||
    phase.state === 'verifying' ||
    phase.state === 'backing_up' ||
    phase.state === 'applying'
  );
}

/** Last completed check, persisted for the Settings tab. */
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
  /** True when the staged installer file itself still exists on disk — a pending
      receipt without it can NEVER be applied and must be re-downloaded. */
  staged_installer_present?: boolean;
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

/** Reads the stage receipt without touching the phase store. */
export async function readUpdateDiagnostics(): Promise<UpdateDiagnostics | null> {
  if (!isDesktopShell()) return null;
  try {
    const api = tauri()!;
    return (await api.invoke('update_diagnostics')) as UpdateDiagnostics;
  } catch {
    return null; // diagnostics are best-effort; never block boot
  }
}

/**
 * Boot-time reconciliation — consumes the Rust stage receipt.
 *
 * Because staging no longer implies applying, the receipt has three meanings:
 * - `settled`  → the install this receipt describes landed on the build now
 *                running. Record "Updated to vX" once, then it is history.
 * - `pending` + the staged file present → an update is downloaded and waiting
 *                for the user to restart. Surface it (the panel must offer
 *                "Restart & Apply Updates" without re-downloading).
 * - `pending` + the staged file gone → it was interrupted. Say so instead of
 *                asking the user to close the app for nothing.
 */
export async function reconcileInstallReceipt(): Promise<UpdateDiagnostics | null> {
  const diag = await readUpdateDiagnostics();
  if (!diag) return null;

  if (diag.receipt_status === 'settled' && diag.receipt) {
    // Record once per version: `installed` is only meaningful for the build
    // that actually landed, and it must never be claimed while still pending.
    const alreadyRecorded = getUpdateHistory().some(
      (h) => h.state === 'installed' && h.version === diag.receipt!.version,
    );
    if (!alreadyRecorded) {
      recordUpdateHistory({
        version: diag.receipt.version,
        state: 'installed',
        message: `Staged ${diag.receipt.staged_at} from v${diag.receipt.previous_version || '?'}`,
      });
    }
    return diag;
  }

  if (diag.receipt_status === 'pending' && diag.receipt) {
    if (diag.staged_installer_present) {
      setPhase({
        state: 'ready_to_apply',
        version: diag.receipt.version,
        bytes: diag.receipt.bytes ?? 0,
        staged_path: diag.receipt.staged_path,
        checksum: diag.receipt.checksum,
      });
    } else {
      setPhase({
        state: 'failed',
        message: `The v${diag.receipt.version} update was interrupted — its installer is no longer on disk. Check for updates to download it again.`,
      });
    }
  }
  return diag;
}



/**
 * Runs check → download → verify → backup, stopping at "ready to apply".
 * Safe to call again while running — returns the in-flight promise.
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

    const { version, notes, released_at } = status as {
      version: string;
      notes?: string;
      released_at?: string;
    };
    const downloadUrl = (status as any).download_url as string | undefined;

    // Record availability immediately so the panel can show it even if the
    // download or verification later fails.
    setLastUpdateCheck(version, 'available');
    recordUpdateHistory({ version, state: 'available' });
    setPhase({ state: 'available', version, notes, released_at });

    if (!isDesktopShell()) {
      // Web build: hand off to the system browser (the user completes it).
      const { downloadUpdate } = await import('./updateService');
      await downloadUpdate(downloadUrl);
      const phase: AutoUpdatePhase = {
        state: 'failed',
        message: 'This build cannot install updates by itself — the installer download opened in your browser.',
      };
      recordUpdateHistory({ version, state: 'failed', message: phase.message });
      setPhase(phase);
      return phase;
    }

    try {
      setPhase({ state: 'downloading', version, received: 0, total: 0 });

      // Native side streams the download, verifies the checksum and backs up
      // the database. The release-asset CDN sends no CORS headers, so this
      // must run in Rust — a webview fetch of the installer throws and the
      // update silently dies (seen on v2.3.1).
      const api = tauri()!;
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<{
        version?: string;
        received?: number;
        total?: number;
        stage?: string;
      }>('update://progress', (event) => {
        const p = event.payload;
        if (!p) return;
        if (p.stage === 'verifying') {
          setPhase({ state: 'verifying', version });
        } else if (p.stage === 'backup') {
          setPhase({ state: 'backing_up', version });
        } else if (typeof p.received === 'number' && typeof p.total === 'number') {
          setPhase({ state: 'downloading', version, received: p.received, total: p.total });
        }
      });

      let phase: AutoUpdatePhase;
      try {
        // Flush any pending SQLite writes BEFORE the app may be closed:
        // app.exit(0) on the Rust side races the 400 ms debounced flush, and an
        // exit mid-write would lose the newest clinic data. Flush is awaited,
        // not fire-and-forget.
        try {
          const { flushNow } = await import('../db/persistence');
          await flushNow();
        } catch { /* non-fatal — the pre-update backup still protects data */ }

        // Returns the stage receipt; nothing is executed and nothing exits yet.
        const receipt = await api.invoke('update_install', {
          version,
          downloadUrl: downloadUrl ?? null,
          expectedChecksum: (status as any).payload_checksum ?? null,
        });
        phase = {
          state: 'ready_to_apply',
          version,
          bytes: Number(receipt?.bytes) || 0,
          staged_path: typeof receipt?.staged_path === 'string' ? receipt.staged_path : undefined,
          checksum: typeof receipt?.checksum === 'string' ? receipt.checksum : undefined,
        };
      } finally {
        if (unlisten) unlisten();
      }

      recordUpdateHistory({
        version,
        state: 'available',
        message: 'Downloaded and verified — waiting for you to restart and apply.',
      });
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

/**
 * Restarts and applies the staged update. This is the only path that closes
 * the app — Rust re-verifies the staged checksum, spawns the silent installer
 * on our exit and relaunches on the new version.
 */
export function applyStagedUpdate(): Promise<AutoUpdatePhase> {
  return (async (): Promise<AutoUpdatePhase> => {
    const phase = current;
    if (phase.state !== 'ready_to_apply') return phase;
    const { version } = phase;
    if (!isDesktopShell()) {
      const failed: AutoUpdatePhase = {
        state: 'failed',
        message: 'This build cannot apply updates by itself — open the installer from the download page.',
      };
      setPhase(failed);
      return failed;
    }
    setPhase({ state: 'applying', version });
    try {
      // Last flush: the installer replaces the app on the very next tick.
      try {
        const { flushNow } = await import('../db/persistence');
        await flushNow();
      } catch { /* non-fatal — the pre-update backup still protects data */ }
      await tauri()!.invoke('update_apply');
      // The Rust side exits the app a moment later; this state is what the UI
      // shows in the meantime so the button never looks unresponsive.
      const applying: AutoUpdatePhase = { state: 'applying', version };
      setPhase(applying);
      return applying;
    } catch (e: any) {
      const failed: AutoUpdatePhase = { state: 'failed', message: e?.message || String(e) };
      recordUpdateHistory({ version, state: 'failed', message: failed.message });
      setPhase(failed);
      return failed;
    }
  })();
}

/**
 * Throws the staged installer away ("Not now"). Declining must not leave a
 * multi-MB file on disk or a receipt that nags on every boot.
 */
export async function discardStagedUpdate(): Promise<void> {
  if (!isDesktopShell()) {
    setPhase({ state: 'idle' });
    return;
  }
  try {
    await tauri()!.invoke('update_discard');
  } catch { /* best-effort: the temp file is disposable either way */ }
  setPhase({ state: 'idle' });
}

/** One automatic check per app session; Settings can still force a re-check. */
let sessionChecked = false;

export function ensureAutoUpdateCheck(): void {
  if (sessionChecked) return;
  sessionChecked = true;
  void reconcileInstallReceipt().finally(() => {
    void runAutoUpdate();
  });
}