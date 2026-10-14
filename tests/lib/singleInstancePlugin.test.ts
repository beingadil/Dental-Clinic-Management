// Node-environment test (no DOM): text/table parsing of Cargo.toml + lib.rs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Single-instance protection contract.
 *
 * Desktop persistence is whole-file read-modify-write:
 *   db_read_bytes  -> load the entire .sqlite as base64
 *   (sql.js mutates it in memory)
 *   db_save_bytes  -> rewrite the ENTIRE file from that in-memory copy
 *
 * So a second process is not a harmless second window. It opens the same file,
 * diverges in memory from the first, and its next save is last-writer-wins: the
 * first process's case, invoice or payment disappears with no error anywhere.
 * A test that empirically launched the app twice found BOTH instances ran to
 * completion, each with its own sql.js engine.
 *
 * `tauri-plugin-single-instance` closes this with an OS-level named mutex, so
 * the second launch is told "you are not first", focuses the first window and
 * exits before it ever touches the database. Two things about it are load-
 * bearing and both are asserted below:
 *
 *   a) the dependency must be present, and
 *   b) the registration must come FIRST in the builder chain. The hook has to
 *      answer "am I the first process?" before any other plugin initialises
 *      against state the second process would then clobber. Reordering is a
 *      real, plausible edit ("alphabetise the plugins", "move dialog next to
 *      opener") that produces a compiling, warning-free binary in which two
 *      engines run again.
 *
 * Note: the plugin registers NO IPC command — it uses an OS named mutex — so
 * there is deliberately NO `single-instance:default` entry in
 * src-tauri/capabilities/default.json. Adding one fails the build with
 * `Permission single-instance:default not found`, and adding a JUSTIFIED entry
 * for it in tests/lib/tauriWindowPermissions.test.ts would make that table
 * describe a permission that does not exist.
 */
const root = resolve(__dirname, '../..');

const cargoToml = readFileSync(resolve(root, 'src-tauri/Cargo.toml'), 'utf8');
const cargoLock = readFileSync(resolve(root, 'src-tauri/Cargo.lock'), 'utf8');
const libRs = readFileSync(resolve(root, 'src-tauri/src/lib.rs'), 'utf8');

/** Body of one TOML table, e.g. `[dependencies]`. Stops at the next `[table]`. */
function tomlSection(header: string): string {
  const lines = cargoToml.split(/\r?\n/);
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (/^\s*\[/.test(line)) {
      inside = line.trim() === header;
      continue;
    }
    if (inside) out.push(line);
  }
  if (!out.length) throw new Error(`no [${header}] table in src-tauri/Cargo.toml`);
  return out.join('\n');
}

/**
 * Blanks out comments while preserving every character offset, so string
 * literals can still be searched for but a prose comment can never satisfy —
 * or break — a position assertion. Handles line and block comments in Rust and
 * JS, and respects ordinary quoted strings so a `//` inside a string literal
 * (a URL, say) does not swallow the rest of the line.
 */
function blankComments(src: string): string {
  const out = src.split('');
  let i = 0;
  let quote: '"' | "'" | '`' | null = null;
  let inLine = false;
  let inBlock = false;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLine) {
      if (ch === '\n') inLine = false;
      else blank(i, i + 1);
      i++;
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        blank(i, i + 2);
        i += 2;
        inBlock = false;
        continue;
      }
      blank(i, i + 1);
      i++;
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i += 2;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** 1-based line number of an offset, for readable failure messages. */
function lineOf(src: string, offset: number): number {
  return src.slice(0, offset).split('\n').length;
}

const libCode = blankComments(libRs);
const SINGLE_INSTANCE = 'tauri_plugin_single_instance::init(';
const DIALOG = 'tauri_plugin_dialog::init()';

describe('single-instance protection', () => {
  describe('dependency declaration (src-tauri/Cargo.toml)', () => {
    const deps = tomlSection('[dependencies]');

    it('declares tauri-plugin-single-instance under [dependencies]', () => {
      // In [dependencies], not under [target.'cfg(windows)'.dependencies]: the
      // plugin must be linked on every platform so the window-focus behaviour
      // and the mutex are both unconditional.
      expect(deps).toMatch(/^\s*tauri-plugin-single-instance\s*=/m);
    });

    it('pins it to Tauri v2', () => {
      const line = deps
        .split(/\r?\n/)
        .find((l) => /^\s*tauri-plugin-single-instance\s*=/.test(l))!;
      expect(line).toBeTruthy();
      expect(line).toMatch(/tauri-plugin-single-instance\s*=\s*"2/);
    });

    it('is resolved in Cargo.lock, so it is really linked and not just declared', () => {
      // A Cargo.toml edit that was never followed by a `cargo build` leaves the
      // lockfile untouched; the next build then fetches it, but a vendored /
      // offline build would not. Asserting the lock entry keeps the dependency
      // honest without needing to shell out to cargo (which is not available
      // from a vitest run, and would fight the release build for the target/
      // directory lock).
      expect(cargoLock).toMatch(/name = "tauri-plugin-single-instance"/);
    });

    it('the dependency carries a comment explaining why it exists', () => {
      // Prose in the manifest is not decoration: the next dependency added to
      // a desktop app with read-modify-write persistence needs this reasoning.
      const raw = cargoToml.slice(0, cargoToml.indexOf('tauri-plugin-single-instance'));
      const preceding = raw.slice(raw.lastIndexOf('[dependencies]'));
      expect(preceding).toMatch(/#.*(second|rival|instance|concurrent)/i);
    });
  });

  describe('registration order (src-tauri/src/lib.rs)', () => {
    const single = libCode.indexOf(SINGLE_INSTANCE);
    const dialog = libCode.indexOf(DIALOG);

    it('registers tauri_plugin_single_instance::init(', () => {
      // If this throws/misses, every ordering assertion below would be
      // comparing -1 and pass vacuously.
      expect(single, 'no tauri_plugin_single_instance::init( in lib.rs').toBeGreaterThanOrEqual(0);
    });

    it('still registers tauri_plugin_dialog::init()', () => {
      expect(dialog, 'no tauri_plugin_dialog::init() in lib.rs').toBeGreaterThanOrEqual(0);
    });

    it('registers single-instance BEFORE every other plugin in the builder chain', () => {
      // THE assertion. Order is semantic here: the plugin's job is to decide
      // "am I the first process?" and, if not, focus and exit. Anything
      // initialised above it has already touched state the second process
      // would then overwrite — which is precisely the data-loss window the
      // plugin was added to close. Alphabetising or "grouping the dialog next
      // to the opener" refactors would silently reopen it while still
      // compiling cleanly.
      expect(
        single,
        `single-instance must be registered before tauri_plugin_dialog::init() ` +
          `(single at line ${lineOf(libCode, single)}, dialog at line ${lineOf(libCode, dialog)})`,
      ).toBeLessThan(dialog);
    });

    it('registers it first among ALL .plugin(...) calls in run()', () => {
      // Broader than the dialog comparison, so adding a new plugin cannot be
      // slipped in above the single-instance hook. The chain is compared at the
      // `.plugin(` token that *owns* the single-instance init — the init name
      // itself sits a few characters to the right of it, so comparing raw
      // indexes would flag the registration as preceding itself.
      const siChainStart = libCode.lastIndexOf('.plugin(', single);
      expect(siChainStart).toBeGreaterThanOrEqual(0);

      const plugins = [...libCode.matchAll(/\.plugin\(/g)].map((m) => m.index!);
      expect(plugins.length).toBeGreaterThanOrEqual(2);
      const above = plugins
        .filter((at) => at < siChainStart)
        .map((at) => `line ${lineOf(libCode, at)}`);
      expect(
        above,
        `these .plugin() registrations precede single-instance (line ${lineOf(libCode, siChainStart)}): ${above.join(', ')}`,
      ).toEqual([]);
    });

    it('both plugins are inside run(), before .run(generate_context!())', () => {
      // Guards against the ordering test passing because the calls moved into
      // a helper or a comment that happens to be textually first.
      const runStart = libCode.indexOf('pub fn run()');
      const runEnd = libCode.indexOf('.run(tauri::generate_context!())');
      expect(runStart).toBeGreaterThanOrEqual(0);
      expect(runEnd).toBeGreaterThan(runStart);
      expect(single).toBeGreaterThan(runStart);
      expect(dialog).toBeLessThan(runEnd);
    });

    it('the handler focuses and un-minimises the existing main window', () => {
      // A window that is minimised or hidden reads to the operator as "the app
      // did not start", so they click again — straight back to two engines.
      // Errors are intentionally ignored inside the handler; what must not
      // happen is the handler silently losing its window lookup.
      const handler = libCode.slice(single, single + 900);
      expect(handler).toMatch(/get_webview_window\(\s*"main"\s*\)/);
      expect(handler).toMatch(/\.unminimize\(\)/);
      expect(handler).toMatch(/\.show\(\)/);
      expect(handler).toMatch(/\.set_focus\(\)/);
    });

    it('ignores argv/cwd, because nothing passes a file to the second process', () => {
      // `_argv` / `_cwd` are intentionally discarded. Handling them (opening
      // the file, say) would be a new attack surface: a second launch carrying
      // a path would re-open the exact hole this plugin's dependency chain
      // spends three files closing.
      const handler = libCode.slice(single, single + 300);
      expect(handler).toMatch(/\|\s*app\s*,\s*_argv\s*,\s*_cwd\s*\|/);
    });
  });
});
