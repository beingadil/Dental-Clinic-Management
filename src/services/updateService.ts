import { APP_VERSION } from './backupService';

/**
 * Phase 9 — application update service.
 *
 * Online mode:  checks a update manifest (GitHub Releases / any HTTPS host)
 *               for a newer version and reports it; the actual download is
 *               user-confirmed and integrity-checked before install.
 * Offline mode: an administrator imports a `.dentalupdate` package (same
 *               manifest + payload) manually from a USB stick — no network
 *               required. Both paths go through the same validation.
 *
 * A fully offline computer can always be updated via the offline package.
 */

export const UPDATE_MANIFEST_URL_DEFAULT =
  'https://github.com/dental-solutions/app/releases/latest/download/update-manifest.json';

export interface UpdateManifest {
  magic: 'DENTALUPDATE';
  version: string;
  channel: 'stable' | 'beta';
  released_at: string;
  notes?: string;
  payload_b64?: string;       // offline package: full update bundle
  payload_checksum?: string;  // sha256 of payload
  download_url?: string;      // online package
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

/** Checks the configured manifest URL. Never throws; returns a status. */
export async function checkForUpdates(manifestUrl = UPDATE_MANIFEST_URL_DEFAULT): Promise<UpdateStatus> {
  if (!isOnline()) {
    return { state: 'error', message: 'Offline — use an offline update package (.dentalupdate) instead.' };
  }
  try {
    const res = await fetch(manifestUrl, { cache: 'no-store' });
    if (!res.ok) return { state: 'error', message: `Update server returned ${res.status}` };
    const manifest = (await res.json()) as UpdateManifest;
    if (manifest.magic !== 'DENTALUPDATE') {
      return { state: 'error', message: 'Update source is not a valid Dental Solutions manifest.' };
    }
    if (compareVersions(manifest.version, APP_VERSION) > 0) {
      return {
        state: 'available',
        version: manifest.version,
        notes: manifest.notes,
        released_at: manifest.released_at,
        download_url: manifest.download_url,
      };
    }
    return { state: 'up_to_date', version: APP_VERSION };
  } catch (e: any) {
    return { state: 'error', message: e?.message || 'Update check failed' };
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
