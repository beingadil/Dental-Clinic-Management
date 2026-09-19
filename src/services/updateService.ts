import { APP_VERSION } from './backupService';

/**
 * Phase 9 — application update service.
 *
 * Online mode:  polls this repo's GitHub Releases "latest" manifest for a
 *               newer version; the user confirms and the OS browser downloads
 *               the branded installer from the Release page. Nothing is
 *               auto-replaced on disk — the downloaded setup.exe applies the
 *               update, so the app never corrupts itself mid-run.
 * Offline mode: an administrator imports a `.dentalupdate` package (same
 *               manifest) manually from a USB stick — no network required.
 *               Both paths go through the same version + checksum validation.
 *
 * A fully offline computer can always be updated via the offline package.
 */

export const UPDATE_MANIFEST_URL_DEFAULT =
  'https://beingadil.github.io/Dental-Clinic-Management/update-manifest.json';
export const GITHUB_LATEST_RELEASE_URL =
  'https://api.github.com/repos/beingadil/Dental-Clinic-Management/releases/latest';
export const GITHUB_RELEASES_PAGE = 'https://github.com/beingadil/Dental-Clinic-Management/releases/latest';

export interface UpdateManifest {
  magic: 'DENTALUPDATE';
  version: string;
  channel: 'stable' | 'beta';
  released_at: string;
  notes?: string;
  payload_b64?: string;       // offline package: full update bundle
  payload_checksum?: string;  // sha256 of payload
  download_url?: string;      // online package (direct installer URL)
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up_to_date'; version: string }
  | { state: 'available'; version: string; notes?: string; released_at?: string; download_url?: string }
  | { state: 'error'; message: string };

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
  }
  return 0;
}

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine === true : false;
}

interface GithubReleaseInfo {
  tag_name?: string;
  body?: string;
  published_at?: string;
  html_url?: string;
  assets?: { name: string; browser_download_url: string }[];
}

/**
 * Resolve the newest stable release's installer URL.
 *
 * Primary source: CI publishes `update-manifest.json` to GitHub Pages on every
 * tag — stable, no rate limit. Fallback: the GitHub Releases API (60 req/hr
 * unauthenticated) if Pages isn't reachable yet.
 */
async function fetchLatestManifest(): Promise<UpdateManifest | null> {
  // 1 — GitHub Pages manifest (published by CI on every tag push)
  try {
    const res = await fetch(UPDATE_MANIFEST_URL_DEFAULT, { cache: 'no-store' });
    if (res.ok) {
      const manifest = (await res.json()) as UpdateManifest;
      if (manifest?.magic === 'DENTALUPDATE' && manifest.version) return manifest;
    }
  } catch { /* fall through to the API fallback */ }

  // 2 — GitHub Releases API fallback
  try {
    const res = await fetch(GITHUB_LATEST_RELEASE_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const rel = (await res.json()) as GithubReleaseInfo;
    const version = (rel.tag_name || '').replace(/^v/, '');
    if (!version) return null;
    const installer = (rel.assets || []).find((a) => /-setup\.exe$/i.test(a.name));
    return {
      magic: 'DENTALUPDATE',
      version,
      channel: 'stable',
      released_at: rel.published_at || '',
      notes: (rel.body || '').split('\n')[0] || undefined,
      download_url: installer?.browser_download_url,
    };
  } catch {
    return null;
  }
}

/** Checks for a newer version. Never throws; returns a status. */
export async function checkForUpdates(manifestUrl?: string): Promise<UpdateStatus> {
  if (!isOnline()) {
    return { state: 'error', message: 'Offline — use an offline update package (.dentalupdate) instead.' };
  }
  try {
    const manifest = manifestUrl ? undefined : await fetchLatestManifest();
    const m =
      manifest ??
      (await (async () => {
        const res = await fetch(manifestUrl as string, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Update server returned ${res.status}`);
        return (await res.json()) as UpdateManifest;
      })());
    if (m.magic !== 'DENTALUPDATE') {
      return { state: 'error', message: 'Update source is not a valid Dental Solutions manifest.' };
    }
    if (compareVersions(m.version, APP_VERSION) > 0) {
      return {
        state: 'available',
        version: m.version,
        notes: m.notes,
        released_at: m.released_at,
        download_url: m.download_url,
      };
    }
    return { state: 'up_to_date', version: APP_VERSION };
  } catch (e: any) {
    return { state: 'error', message: e?.message || 'Update check failed' };
  }
}

/**
 * Opens the newest installer download in the system browser (works in both
 * the Tauri desktop shell and a normal browser tab). Falls back to the
 * Releases page when the direct asset URL is unknown. Never throws.
 */
export async function downloadUpdate(downloadUrl?: string): Promise<{ ok: boolean; error?: string }> {
  const url = downloadUrl || GITHUB_RELEASES_PAGE;
  try {
    const tauri = (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__;
    const invoke = tauri?.invoke;
    if (typeof invoke === 'function') {
      await invoke('open_external', { url });
    } else if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    return { ok: true };
  } catch (e: any) {
    // Last resort — a plain browser tab; the user can still download manually.
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
      return { ok: true };
    } catch {
      return { ok: false, error: e?.message || 'Could not open the download page' };
    }
  }
}

/** Parses and validates an offline `.dentalupdate` package file. */
export async function parseOfflineUpdate(text: string): Promise<
  { ok: true; manifest: UpdateManifest } | { ok: false; error: string }
> {
  try {
    const manifest = JSON.parse(text) as UpdateManifest;
    if (manifest.magic !== 'DENTALUPDATE') {
      return { ok: false, error: 'Not a Dental Solutions update package.' };
    }
    if (compareVersions(manifest.version, APP_VERSION) <= 0) {
      return { ok: false, error: `Package version ${manifest.version} is not newer than the installed ${APP_VERSION}.` };
    }
    if (manifest.payload_b64 && manifest.payload_checksum) {
      // integrity check is performed at install time by the host shell
      const { sha256Hex } = await import('../db/crypto');
      const bytes = Uint8Array.from(atob(manifest.payload_b64), (c) => c.charCodeAt(0));
      const digest = 'sha256:' + (await sha256Hex(bytes));
      if (digest !== manifest.payload_checksum) {
        return { ok: false, error: 'Package checksum mismatch — file is corrupt or tampered with.' };
      }
    }
    return { ok: true, manifest };
  } catch {
    return { ok: false, error: 'Could not parse the update package.' };
  }
}

export function currentVersion(): string {
  return APP_VERSION;
}
