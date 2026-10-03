/**
 * File export that works on BOTH builds.
 *
 * The web build can hand a file to the user with a Blob URL and a synthetic
 * `<a download>` click. The Tauri shell cannot: it routes the WebView2
 * download event to a Rust-side save dialog, and until `save_file_bytes` was
 * added the app registered no handler for it. Every "download" in the app —
 * job slip HTML, CSV exports, PDF export, database backup — therefore produced
 * no file *and no error* on the installed build.
 *
 * So: desktop asks the operator where to save (dialog plugin `save()`, already
 * permitted by `dialog:default`) and writes the bytes through Rust; web keeps
 * the browser download it always had. Callers use one function and neither
 * build has to know which path it took.
 *
 * Mirrors `saveAsPdf`: same dialog, same Tauri API loading, same result shape.
 */
import { isDesktop } from '../db/persistence';

export type SaveFileResult =
  | { status: 'saved'; path: string; bytes: number }
  | { status: 'cancelled' }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

/** Loaded once, lazily — the Tauri modules do not exist in the web bundle. */
let dialogApi: typeof import('@tauri-apps/plugin-dialog') | null = null;
let invokeFn: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
let loadAttempted = false;

async function loadTauriApis(): Promise<boolean> {
  if (!isDesktop()) return false;
  if (dialogApi && invokeFn) return true;
  if (loadAttempted && !invokeFn) return false;
  loadAttempted = true;
  try {
    const [core, dialog] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/plugin-dialog'),
    ]);
    invokeFn = core.invoke;
    dialogApi = dialog;
    return true;
  } catch {
    return false;
  }
}

/** True when this environment can open a native save dialog (desktop only). */
export async function canSaveFile(): Promise<boolean> {
  return loadTauriApis();
}

/** Bytes → base64 in chunks, so a large export cannot blow the call stack. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Save `content` as `fileName`, asking the operator where it goes on desktop.
 *
 * `extension` drives both the native file-type filter and the filename
 * fallback; `mimeType` only matters to the browser download path.
 */
export async function saveFile(
  fileName: string,
  content: string | Uint8Array,
  opts: { extension: string; mimeType: string; dialogTitle?: string },
): Promise<SaveFileResult> {
  const bytes =
    typeof content === 'string' ? new TextEncoder().encode(content) : content;

  const native = await loadTauriApis();
  if (!native || !dialogApi || !invokeFn) {
    // Web build: the browser download the page has always used.
    try {
      const blob = new Blob([bytes as BlobPart], { type: opts.mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName.toLowerCase().endsWith(opts.extension)
        ? fileName
        : `${fileName}${opts.extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // Revoking immediately can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return { status: 'saved', path: fileName, bytes: bytes.length };
    } catch (err) {
      return {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  try {
    const path = await dialogApi.save({
      title: opts.dialogTitle ?? 'Save file',
      defaultPath: fileName.toLowerCase().endsWith(opts.extension)
        ? fileName
        : `${fileName}${opts.extension}`,
      filters: [{ name: opts.extension.replace('.', '').toUpperCase(), extensions: [opts.extension.replace('.', '')] }],
    });
    if (!path) return { status: 'cancelled' };

    const result = (await invokeFn('save_file_bytes', {
      path,
      bytesB64: toBase64(bytes),
    })) as { path: string; bytes: number };
    return { status: 'saved', path: result.path, bytes: result.bytes };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Convenience wrapper for text exports (CSV, HTML, JSON). */
export function saveTextFile(
  fileName: string,
  text: string,
  opts: { extension: string; mimeType: string; dialogTitle?: string },
): Promise<SaveFileResult> {
  return saveFile(fileName, text, opts);
}