import { APP_VERSION } from './backupService';
// Static, not `await import('../db/crypto')`: `./backupService` below already
// pulls crypto into the graph statically, so the dynamic form deferred nothing
// and only cost Vite a "will not move module into another chunk" warning.
import { sha256Hex } from '../db/crypto';

/**
 * Phase 9 — application update service.
 *
 * Online mode:  polls this repo's GitHub Releases "latest" manifest for a
 *               newer version; the user confirms and the OS browser downloads
 *               the branded installer from the Release page. Nothing is
 *               auto-replaced on disk — the downloaded setup.exe applies the
 *               update, so the app never corrupts itself mid-run.
 *
 * There is no offline/USB import (the `.dentalupdate` package route was
 * removed), so an unconnected machine cannot update itself — an
 * administrator brings the installer from the Releases page instead.
 */

/**
 * Primary update source. The repo's GitHub Pages site was never enabled, so
 * the published pages URL 404s; the raw gh-pages URL serves the same
 * CI-published file over raw.githubusercontent (no CORS issues in the
 * webview, no rate limiting like the Releases API).
 */
export const UPDATE_MANIFEST_URL_DEFAULT =
  'https://raw.githubusercontent.com/beingadil/Dental-Clinic-Management/gh-pages/update-manifest.json';
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
  | { state: 'available'; version: string; notes?: string; released_at?: string; download_url?: string; payload_checksum?: string }
  | { state: 'error'; message: string };

/**
 * Mirror of the Rust `is_trusted_download_url` in src-tauri/src/lib.rs — the
 * same allowlist, evaluated on the webview side so the UI can decide its
 * fallback BEFORE invoking Rust (which re-checks and fails closed either way).
 * Both sides list the hosts that can serve a signed GitHub release asset.
 */
export const TRUSTED_RELEASE_HOSTS = [
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
] as const;

export function isTrustedReleaseUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return (TRUSTED_RELEASE_HOSTS as readonly string[]).includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Parsed form of a dotted numeric version with an optional prerelease tag. */
interface ParsedVersion {
  /** Dotted numeric core, zero-extended by the comparator — any component count. */
  core: number[];
  /** Prerelease identifiers: all-numeric identifiers become numbers. */
  pre: (number | string)[];
}

/**
 * Parses `v?X(.Y(.Z)…)?(-pre.…)?`. Returns null on anything else. Mirrors
 * `parse_semver` in src-tauri/src/lib.rs — the two must agree, and the shared
 * golden fixtures in tests/services/updateService.test.ts and the Rust unit
 * tests in src-tauri/src/lib.rs pin the same cases.
 */
export function parseVersion(raw: string): ParsedVersion | null {
  const m = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/.exec(raw.trim());
  if (!m) return null;
  const core = m[1].split('.').map((p) => Number(p));
  if (core.some((n) => !Number.isFinite(n) || n > Number.MAX_SAFE_INTEGER)) return null;
  const pre = m[2]
    ? m[2].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p))
    : [];
  return { core, pre };
}

function comparePrerelease(a: (number | string)[], b: (number | string)[]): number {
  // A release version outranks any of its own prereleases (2.31.27 > 2.31.27-rc.1).
  if (a.length === 0) return b.length === 0 ? 0 : 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i >= a.length) return -1; // prefix of the longer list sorts first
    if (i >= b.length) return 1;
    const x = a[i];
    const y = b[i];
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x < y ? -1 : 1;
    } else if (typeof x === 'number') {
      return -1; // numeric identifiers sort below alphanumeric ones
    } else if (typeof y === 'number') {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Full-semver comparison used for every update decision.
 *
 * Rules (mirror of `semver_cmp` in src-tauri/src/lib.rs):
 * - the numeric core is compared component-wise and padded with zeros, so a
 *   four-part `2.31.26.1` outranks `2.31.26` instead of truncating to it;
 * - a prerelease sorts BEFORE its release (`2.31.27-rc.1 < 2.31.27`);
 * - prerelease identifiers compare numerically when all-numeric, otherwise in
 *   ASCII order; an all-numeric identifier sorts below an alphanumeric one.
 * - an unparseable `a` sorts below everything (no update is offered);
 *   an unparseable `b` sorts above everything.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  const len = Math.max(pa.core.length, pb.core.length);
  for (let i = 0; i < len; i++) {
    const d = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return comparePrerelease(pa.pre, pb.pre);
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
/**
 * Silence the browser console on unreachable update sources: the boot check
 * runs once per app session and an offline/dev machine would otherwise log
 * CSP + CORS errors for each dead URL on every check. A failed source is the
 * expected steady state, not an error worth surfacing.
 */
const quietFetch = async (url: string): Promise<Response | null> => {
  try {
    // A hung fetch (slow DNS, captive portal, no route) used to leave the
    // spinner on "Checking for updates..." forever, because nothing upstream
    // timed it out. 8 s is long enough for a real GitHub response and short
    // enough that a dead network fails fast into the "up to date / offline"
    // state instead of looking like a stuck loader.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) return res;
  } catch { /* expected offline / blocked — try the next source */ }
  return null;
};

async function fetchLatestManifest(): Promise<UpdateManifest | null> {
  // 1 — the CI-published manifest on the gh-pages branch, via the raw host.
  // The published Pages URL (beingadil.github.io/Dental-Clinic-Management/…)
  // was tried here first and always 404'd: GitHub Pages is not enabled for
  // this repo, so every check burned a request on a URL that cannot work.
  // The raw URL serves the same committed file, so it is the only source now.
  const res = await quietFetch(UPDATE_MANIFEST_URL_DEFAULT);
  if (res) {
    try {
      const manifest = (await res.json()) as UpdateManifest;
      if (manifest?.magic === 'DENTALUPDATE' && manifest.version) return manifest;
    } catch { /* fall through to the Releases API */ }
  }

  // 2 — GitHub Releases API fallback. Same 8 s ceiling as the primary
  //    source — a captive portal must not leave the UI on "Checking" forever.
  try {
    const res = await quietFetch(GITHUB_LATEST_RELEASE_URL);
    if (!res) return null;
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
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!isOnline()) {
    return { state: 'error', message: 'Offline — updates need a network connection. Ask an administrator for the latest installer from the Releases page.' };
  }
  try {
    const m = await fetchLatestManifest();
    if (!m) throw new Error('Update source is unreachable (offline or blocked).');
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
        /* The manifest hash reaches the verifier instead of being dropped on
           the floor here — this is what binds the manifest to the installer
           CI hashed in SHA256SUMS.txt. */
        payload_checksum: m.payload_checksum,
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

/**
 * Parses and validates an offline `.dentalupdate` package file.
 * D2 decision (2026-10-01): the offline import UI was removed — updates are
 * manifest-driven only. Nothing in the repo produces or consumes this
 * package format today; the parser remains because its contract is pinned
 * by unit tests. Do not call it from new code.
 */
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
