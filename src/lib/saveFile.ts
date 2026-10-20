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
// Static, unlike the dialog below: `@tauri-apps/api/core` is already in the
// entry chunk because window.js re-exports it statically, so the dynamic form
// deferred nothing. The dialog plugin stays lazy — it is a genuine split point.
import { invoke } from '@tauri-apps/api/core';

export type SaveFileResult =
  | { status: 'saved'; path: string; bytes: number }
  | { status: 'cancelled' }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

/** Loaded once, lazily — the Tauri modules do not exist in the web bundle. */
let dialogApi: typeof import('@tauri-apps/plugin-dialog') | null = null;
let invokeFn: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;

async function loadTauriApis(): Promise<boolean> {
  if (!isDesktop()) return false;
  if (dialogApi && invokeFn) return true;
  /* No permanent latch on failure. The dynamic import can fail transiently —
     a chunk 404 right after an app update, a service worker mid-swap — and
     latching it made every later export in that session take the browser path
     for good, with no way back short of a restart. */
  try {
    dialogApi = await import('@tauri-apps/plugin-dialog');
    invokeFn = invoke;
    return true;
  } catch {
    dialogApi = null;
    invokeFn = null;
    return false;
  }
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

/* The narrow slice of the File System Access API this uses. Declared here rather
 * than pulled from a lib because TypeScript's DOM lib does not type the picker
 * uniformly across TS versions, and the browser feature-detects it anyway. */
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}
interface FileHandleLike {
  name: string;
  createWritable: (opts?: { keepExistingData?: boolean }) => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
  /** Read-back, to confirm the bytes landed rather than trusting close(). */
  getFile?: () => Promise<{ size: number }>;
  queryPermission?: (d: { mode: string }) => Promise<string>;
  requestPermission?: (d: { mode: string }) => Promise<string>;
}
type PickerFn = (opts?: SaveFilePickerOptions) => Promise<FileHandleLike>;

/** Chromium-only, and only in a secure context. `127.0.0.1` counts as one, so
    this is available in the dev server, not just on a hosted page. */
function savePicker(): PickerFn | null {
  if (!window.isSecureContext) return null;
  const fn = (window as unknown as { showSaveFilePicker?: PickerFn }).showSaveFilePicker;
  return typeof fn === 'function' ? fn : null;
}

/**
 * Save in a plain browser, in the two ways it can.
 *
 * With the File System Access API the operator gets a real Save As window and
 * picks the location. Without it (Firefox, Safari) there is no chooser at all,
 * so the file goes to the browser's downloads folder via an anchor click —
 * which is a working save, but not one the operator chose, and it is reported
 * as such so nobody goes hunting through the filesystem for a dialog that was
 * never going to appear.
 */
async function saveInBrowser(
  bytes: Uint8Array,
  fileName: string,
  opts: { extension: string; mimeType: string; dialogTitle?: string },
): Promise<SaveFileResult> {
  const blob = new Blob([bytes as BlobPart], { type: opts.mimeType });

  const picker = savePicker();
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: fileName,
        types: [
          {
            description: opts.dialogTitle ?? 'File',
            /* The two save APIs disagree on extensions and both are strict.
               The Tauri dialog plugin wants them bare ("pdf"); the File System
               Access API rejects anything not starting with a dot, and says so:
               "Extension 'pdf' must start with '.'". `opts.extension` is already
               dotted, so it goes across as-is rather than being normalised the
               way the dialog plugin's filters are. */
            accept: {
              [opts.mimeType]: [
                opts.extension.startsWith('.') ? opts.extension : `.${opts.extension}`,
              ],
            },
          },
        ],
      });

      /* A handle from showSaveFilePicker() ALREADY carries write permission — the
         operator granted it by picking the location. Do not ask again.

         The prompt-for-access call exists for handles from showDirectoryPicker()
         and drag-and-drop, where the app must ask. On a save handle it answers
         'denied' for a location the operator has already been granted, which is
         exactly the "refused write access" the operator hit: the guard refused
         a save it was entitled to make.

         So open the stream directly. If the platform still refuses, the catch
         below falls through to the plain download rather than losing the file. */

      /* createWritable() stages into a temp file and swaps it in on close(), so
         anything that goes wrong between here and the close leaves the chosen
         file at zero bytes — created, empty, and reported as a success. Explicit
         options, then a read-back so the outcome is checked rather than assumed. */
      const writable = await handle.createWritable({ keepExistingData: false });
      await writable.write(blob);
      await writable.close();

      const written = await handle.getFile?.();
      const landed = typeof written?.size === 'number' ? written.size : bytes.length;
      if (bytes.length > 0 && landed === 0) {
        return {
          status: 'error',
          message:
            'The file was created but nothing was written to it. It is probably open in another program — close it and save again.',
        };
      }
      /* A file that is SHORT is as broken as one that is empty, and it is
         worse: a truncated PDF still opens, so the operator finds out later
         that the document is damaged. The read-back is the only place this
         can be seen, so it is checked here rather than trusted. */
      if (typeof written?.size === 'number' && written.size !== bytes.length) {
        return {
          status: 'error',
          message:
            `The file was written but only ${written.size} of ${bytes.length} bytes landed, ` +
            'so it is incomplete. Close anything that has the file open and save again.',
        };
      }
      return { status: 'saved', path: handle.name, bytes: landed };
    } catch (err) {
      /* Dismissing the chooser is a choice, not a failure. Reporting it as an
         error would train the operator to ignore the message. Matched on the
         error NAME rather than on DOMException, because the abort surfaces as a
         plain Error in some embedders and would otherwise read as a real fault. */
      if (err instanceof Error && err.name === 'AbortError') {
        return { status: 'cancelled' };
      }
      /* Anything else — a refused stream, a locked file, a sync folder fighting
         the swap — falls through to the plain download below. The operator
         still gets their file; losing the chooser is a lesser loss than losing
         the save. */
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
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

/**
 * Save `content` as `fileName`, asking the operator where it goes.
 *
 * Desktop gets the native dialog; a browser gets a Save As window via the File
 * System Access API, falling back to a plain download where that is missing.
 *
 * `extension` drives both the file-type filter and the filename fallback;
 * `mimeType` only matters on the browser paths.
 */
export async function saveFile(
  fileName: string,
  content: string | Uint8Array,
  opts: { extension: string; mimeType: string; dialogTitle?: string },
): Promise<SaveFileResult> {
  const bytes =
    typeof content === 'string' ? new TextEncoder().encode(content) : content;

  const native = await loadTauriApis();

  if (!native) {
    /* Inside the desktop shell there is NO browser to fall back to. WebView2
       routes the download event away, so a Blob + <a download> here silently
       discards the bytes — and it used to report `saved`, which is how an
       export could vanish with the app reporting success. Fail loudly instead;
       the operator is far better served by a message than by silence. */
    if (isDesktop()) {
      return {
        status: 'error',
        message:
          'The file-save helper could not be loaded in the desktop app, so nothing was written. Restart Dental Solutions and try again.',
      };
    }
    return saveInBrowser(bytes, fileName, opts);
  }

  if (!dialogApi || !invokeFn) {
    return {
      status: 'error',
      message: 'The file-save helper is not available in the desktop app.',
    };
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
    /* The Rust side decodes the base64 and writes the bytes; it reports back
       how many it wrote. A number other than the number sent means the file
       on disk is not the file we built — for a PDF that is a document that
       opens and is broken, so it is caught here rather than by the operator. */
    if (typeof result?.bytes === 'number' && result.bytes !== bytes.length) {
      return {
        status: 'error',
        message:
          `Only ${result.bytes} of ${bytes.length} bytes reached the file, ` +
          'so it is incomplete. Close anything that has the file open and save again.',
      };
    }
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
