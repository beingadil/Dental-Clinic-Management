/**
 * Save-as-PDF for print surfaces — desktop (Tauri) only.
 *
 * One entry point for every print modal: asks for a destination file via the
 * native save dialog, then asks the Rust side to render the CURRENT document
 * — the open print modal, with the shared `@media print` CSS applied — into
 * it via WebView2's PrintToPdfStream. The saved PDF is what the browser print
 * dialog would have produced.
 *
 * On the web build (vite preview / plain browser) there is no Tauri IPC, so
 * the helper reports `unsupported` and callers keep their print button.
 */
import { isDesktop } from '../db/persistence';

let dialogApi: typeof import('@tauri-apps/plugin-dialog') | null = null;
let invokeFn: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;

async function loadTauriApis(): Promise<boolean> {
  if (!isDesktop()) return false;
  if (dialogApi && invokeFn) return true;
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

export type SaveAsPdfResult =
  | { status: 'saved'; path: string }
  | { status: 'cancelled' }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

const DEFAULT_FILE_NAME = 'document.pdf';

/**
 * Ask where to save, then print the current document to that file.
 * `suggestedName` should include the .pdf extension.
 */
export async function saveAsPdf(suggestedName: string = DEFAULT_FILE_NAME): Promise<SaveAsPdfResult> {
  const ok = await loadTauriApis();
  if (!ok || !dialogApi || !invokeFn) return { status: 'unsupported' };

  try {
    const path = await dialogApi.save({
      title: 'Save as PDF',
      defaultPath: suggestedName,
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    });
    if (!path) return { status: 'cancelled' };
    const safePath = path.toLowerCase().endsWith('.pdf') ? path : `${path}.pdf`;

    await invokeFn('save_webview_as_pdf', { path: safePath });
    return { status: 'saved', path: safePath };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

/** True when the current environment can actually save (desktop build). */
export async function canSaveAsPdf(): Promise<boolean> {
  return loadTauriApis();
}
