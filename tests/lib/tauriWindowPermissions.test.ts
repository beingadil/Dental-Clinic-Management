// Node-environment test (no DOM): parses the capability file and scans src/.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Tauri window-permission contract.
 *
 * In Tauri v2 every window API call from the webview is gated by the
 * capability ACL, and a missing grant fails ONLY at runtime: tsc, vitest and
 * the production build stay silent and the call just rejects with
 * "window.close not allowed by ACL". That is exactly how the header's close
 * button and the close-request flush in persistence.ts shipped dead on
 * 2.14.x — `core:window:default` grants read-only access only, so
 * click-to-close did nothing and the window could not be closed at all while
 * a debounced SQLite write was pending (the flush calls destroy()).
 *
 * This test makes that failure mode impossible to reintroduce silently.
 */

const root = resolve(__dirname, '../..');

/** Window API methods granted by `core:window:default` — read-only probes and
 *  internal helpers. Anything that mutates the window needs an explicit
 *  permission: the default set intentionally excludes all of these. */
const MUTATING_METHODS: Record<string, string> = {
  close: 'core:window:allow-close',
  destroy: 'core:window:allow-destroy',
  minimize: 'core:window:allow-minimize',
  maximize: 'core:window:allow-maximize',
  unmaximize: 'core:window:allow-unmaximize',
  toggleMaximize: 'core:window:allow-toggle-maximize',
  show: 'core:window:allow-show',
  hide: 'core:window:allow-hide',
  startDragging: 'core:window:allow-start-dragging',
  setFullscreen: 'core:window:allow-set-fullscreen',
  setResizable: 'core:window:allow-set-resizable',
  setAlwaysOnTop: 'core:window:allow-set-always-on-top',
};

const capability = JSON.parse(
  readFileSync(resolve(root, 'src-tauri/capabilities/default.json'), 'utf8'),
) as { windows: string[]; permissions: string[] };
const granted = new Set(capability.permissions);

type CallSite = { file: string; method: string };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Every `<tauriWindow>.<method>(` call in src/, where the receiver is either
 *  the inline getCurrentWindow() or a variable named `win`. */
function windowCallSites(): CallSite[] {
  const out: CallSite[] = [];
  for (const file of sourceFiles(resolve(root, 'src'))) {
    const text = readFileSync(file, 'utf8');
    const pattern = /(?:getCurrentWindow\(\)|\bwin)\.(\w+)\(/g;
    for (const match of text.matchAll(pattern)) {
      const method = match[1];
      if (method in MUTATING_METHODS) out.push({ file: file.slice(root.length + 1), method });
    }
  }
  return out;
}

describe('Tauri window permission contract', () => {
  const calls = windowCallSites();

  it('finds the window call sites the app actually makes', () => {
    // Guards the scanner itself: if this ever finds nothing, the regex or the
    // source layout changed and the assertions below would pass vacuously.
    //
    // Four call sites: minimize / toggleMaximize / close in WindowControls,
    // plus the flush-then-destroy in persistence.ts. This used to be five —
    // the old UpdateStatusPill had its own destroy() for "restart now", which
    // the v2.17 updater replaced with the native `update_apply` command (it
    // must exit via Rust so the detached installer waiter gets our PID).
    expect(calls.length).toBeGreaterThanOrEqual(4);
    const methods = new Set(calls.map((c) => c.method));
    // The close path has two halves: the button and the flush-then-destroy.
    expect(methods).toContain('close');
    expect(methods).toContain('destroy');
  });

  it('grants every mutating window method called from src/ (or the call dies at runtime)', () => {
    const missing = calls
      .filter((c) => !granted.has(MUTATING_METHODS[c.method]))
      .map((c) => `${c.file} calls ${c.method}() → needs ${MUTATING_METHODS[c.method]}`);
    expect(missing).toEqual([]);
  });

  it('targets the main window, which is the window those calls run in', () => {
    expect(capability.windows).toContain('main');
  });

  it('keeps the default set (read-only window access) granted', () => {
    // isMaximized()/onResized() in WindowControls rely on it; dropping it
    // would silently hide the window controls instead of erroring loudly.
    expect(granted.has('core:window:default') || granted.has('core:default')).toBe(true);
  });
});
