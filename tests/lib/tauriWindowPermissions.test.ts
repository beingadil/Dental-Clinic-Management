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
    // ONE call site now: the flush-then-destroy in persistence.ts, which
    // finishes the pending SQLite write before the window goes. It used to be
    // four — the header's own minimise / maximise / close buttons went with
    // the duplicate window controls, because the OS title bar already owns
    // them and the web build has neither.
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const methods = new Set(calls.map((c) => c.method));
    // The close path has two halves: the request handler and the force-destroy.
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
    // `core:default` already expands to `core:window:default`, so the
    // read-only window access is granted either way; dropping the explicit
    // entry must not take it with it.
    expect(granted.has('core:default') || granted.has('core:window:default')).toBe(true);
  });

  /* ---------------------------------------------------------------------
   * Least privilege, enforced in the direction that actually bites.
   *
   * The test above proves a called API is granted. It cannot prove the
   * reverse, and the reverse is where risk accumulates: a capability that
   * nothing calls still widens what an injected script can reach, and it
   * looks like a deliberate security decision in review.
   *
   * `core:webview:allow-internal-toggle-devtools` sat in the shipped 2.23.0
   * capability file for exactly that reason - zero call sites in src/, no
   * entry in the CHANGELOG, no comment explaining it. Every added
   * permission must now name the code that needs it.
   */
  const JUSTIFIED: Record<string, string> = {
    'core:default': 'baseline Tauri core set (which includes the read-only core:window access)',
    'core:event:default': 'listen/emit for update://progress and window events',
    'core:window:allow-destroy': 'close-request flush in persistence.ts',
    'dialog:default': 'native save dialog behind save_file_bytes and PDF export',
  };

  it('grants no permission that has no named justification', () => {
    const unjustified = [...granted]
      .filter((p) => !(p in JUSTIFIED))
      .sort();
    expect(unjustified).toEqual([]);
  });

  it('keeps the justification table honest (no stale entries)', () => {
    // Guards the guard: if a permission is revoked above but left in JUSTIFIED,
    // this table would quietly stop describing the real capability file.
    const stale = Object.keys(JUSTIFIED)
      .filter((p) => !granted.has(p))
      .sort();
    expect(stale).toEqual([]);
  });

  it('does not ship webview devtools access', () => {
    // Spelled out separately from the generic check so the failure names the
    // actual risk rather than just printing the permission string.
    expect(granted.has('core:webview:allow-internal-toggle-devtools')).toBe(false);
  });
});
