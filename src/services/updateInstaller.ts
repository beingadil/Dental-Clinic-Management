/**
 * Auto-update engine — shared phase store consumed by the dashboard pill and
 * the Settings card. Flow: check manifest → (desktop) fetch the installer
 * bytes → verify SHA-256 in Rust → execute silently (NSIS /S) → the installer
 * replaces the app and relaunches it on the new version. The web build falls
 * back to the system-browser download.
 *
 * Verification happens in Rust *before* anything is executed; a checksum
 * mismatch aborts the update with the file left untouched.
 */
import { settingsRepo } from '../db/repos';
import { checkForUpdates, UpdateStatus, currentVersion } from './updateService';

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
    const row = settingsRepo.get('updates', 'last_check');
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

function setLastUpdateCheck(version: string, state: string): void {
  try {
    settingsRepo.set('updates', 'last_check', JSON.stringify({ at: new Date().toISOString(), version, state }));
  } catch { /* non-fatal */ }
}

/**
 * Resolves the installer checksum: prefer the Pages manifest, fall back to
 * the SHA256SUMS.txt asset CI uploads with every release. No checksum →
 * refuse to auto-install (fail closed).
 */
async function resolveChecksum(version: string, fromManifest?: string): Promise<string> {
  if (fromManifest) return fromManifest;
  const url = `https://github.com/beingadil/Dental-Clinic-Management/releases/download/v${version}/SHA256SUMS.txt`;
  const res = await fetch(url, { cache: 'no-store' });
  if (res.ok) {
    for (const line of (await res.text()).split('\n')) {
      if (!/-setup\.exe/i.test(line)) continue;
      const hash = line.trim().split(/\s+/)[0];
      if (/^[a-f0-9]{64}$/i.test(hash)) return 'sha256:' + hash;
    }
  }
  throw new Error('No checksum available for this release — refusing to auto-install.');
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
    // desktop download path is unavailable.
    setLastUpdateCheck(version, 'available');
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
      // 1 — fetch the installer bytes
      setPhase({ state: 'downloading', version, received: 0, total: 0 });
      const res = await fetch(downloadUrl || '', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
      const total = Number(res.headers.get('content-length') || 0);
      const reader = res.body?.getReader();
      let bytes: Uint8Array;
      if (reader && total > 0) {
        const chunks: Uint8Array[] = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          setPhase({ state: 'downloading', version, received, total });
        }
        bytes = new Uint8Array(received);
        let off = 0;
        for (const c of chunks) {
          bytes.set(c, off);
          off += c.length;
        }
      } else {
        bytes = new Uint8Array(await res.arrayBuffer());
      }

      // 2 — verify in Rust (checksum from the manifest or the release's SHA256SUMS.txt)
      setPhase({ state: 'verifying', version });
      const checksum = await resolveChecksum(version, (status as any).payload_checksum as string | undefined);
      const api = tauri()!;
      const ok = await api.invoke('auto_install_update', {
        bytes: Array.from(bytes),
        version,
        checksum,
        notes: notes || null,
      });
      if (ok !== true) throw new Error(String(ok || 'Installer verification failed'));

      // 3 — verified installer is running; it will replace and relaunch us
      setPhase({ state: 'installing', version });
      const phase: AutoUpdatePhase = { state: 'installing', version };
      setPhase(phase);
      return phase;
    } catch (e: any) {
      const phase: AutoUpdatePhase = { state: 'failed', message: e?.message || String(e) };
      setPhase(phase);
      return phase;
    }
  })();
  inflight.finally(() => { inflight = null; });
  return inflight;
}
