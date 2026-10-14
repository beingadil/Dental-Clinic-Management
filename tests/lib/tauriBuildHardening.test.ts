// Node-environment test (no DOM): JSON.parse of the Tauri config plus real
// filesystem checks on the resources it references.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';

/**
 * Tauri build/packaging contract.
 *
 * Three separate silent-failure modes are pinned here. None of them break
 * `tsc`, `vitest`, or `npm run build`; each one only shows up on a clean
 * Windows machine that the developer's own box has already taught the wrong
 * lesson.
 */
const root = resolve(__dirname, '../..');
const confPath = resolve(root, 'src-tauri/tauri.conf.json');

const conf = JSON.parse(readFileSync(confPath, 'utf8')) as {
  productName: string;
  version: string;
  identifier: string;
  build: Record<string, unknown> & { frontendDist?: string; beforeBuildCommand?: string };
  bundle: {
    active?: boolean;
    targets?: string[];
    resources?: string[];
    windows?: {
      webviewInstallMode?: unknown;
      nsis?: Record<string, unknown> & { webviewInstallMode?: unknown };
    };
  };
};

describe('build hardening: src-tauri/tauri.conf.json + src-tauri/build.rs', () => {
  /**
   * Static VC runtime — set in the BUILD SCRIPT, deliberately not in the config.
   *
   * Why it matters: without a static CRT the shipped exe carries imports on
   * VCRUNTIME140.dll / MSVCP140.dll. On a clinic workstation that has never had
   * the Visual C++ Redistributable installed, the app does not launch at all —
   * a silent "nothing happens when I double-click", with no installer to point
   * at and nothing useful in the event log. With it, the exe links the
   * `api-ms-win-crt-*` API sets that ship inside Windows 10/11 and needs
   * nothing external.
   *
   * WHY IT LIVES IN build.rs AND NOT tauri.conf.json — the expensive lesson:
   * `STATIC_VCRUNTIME` is deprecated in favour of `build.windows.staticVCRuntime`
   * in the config, so that is where it was first put. It does not work with the
   * CLI this project builds with (`@tauri-apps/cli` 2.11.4 against
   * `tauri-build` 2.7.0 — the CLI's schema has no `windows` property under
   * `build`), and `tauri build` hard-fails on it:
   *
   *   error on `build`: Additional properties are not allowed
   *                        ('windows' was unexpected)
   *
   * That aborts a release build AFTER the full release-profile LTO compile, so
   * the mistake costs tens of minutes to discover and the "fix" is always
   * tempting (move it back / delete it / assume it was a fluke). Both halves of
   * the contract are pinned below: the setting must be present in the build
   * script, and the config key that breaks the release must stay absent.
   */
  describe('static VC runtime (set in src-tauri/build.rs, NOT in the config)', () => {
    const buildRs = readFileSync(resolve(root, 'src-tauri/build.rs'), 'utf8');

    it('src-tauri/build.rs exists and is readable', () => {
      expect(buildRs.length).toBeGreaterThan(0);
    });

    it('builds WindowsAttributes::new().static_vc_runtime(true)', () => {
      // The whole point, stated as the API call that performs it. Anchored on
      // the full chained expression so `static_vc_runtime(false)` — which
      // silently reintroduces the clean-machine launch failure — cannot pass.
      expect(buildRs).toMatch(/WindowsAttributes::new\(\)\s*\.static_vc_runtime\(\s*true\s*\)/);
      expect(buildRs).not.toMatch(/static_vc_runtime\(\s*false\s*\)/);
    });

    it('wires those attributes into the try_build call', () => {
      // Half the setting is not the setting: an unattached WindowsAttributes
      // struct compiles cleanly and does nothing.
      expect(buildRs).toMatch(/Attributes::new\(\)\s*\.windows_attributes\(/);
      expect(buildRs).toMatch(/tauri_build::try_build\(\s*attrs\s*\)/);
    });

    it('keeps the CLI-skew explanation in the file', () => {
      // The next person to read a deprecation notice pointing at
      // `build.windows.staticVCRuntime` will conclude the config is wrong and
      // "fix" it. That is the exact loop that cost a release build; the
      // rationale has to live where they will read it.
      expect(buildRs).toMatch(/staticVCRuntime/);
      expect(buildRs).toMatch(/Additional properties are not allowed/);
      expect(buildRs).toMatch(/tauri-build/);
    });

    it('tauri.conf.json does NOT declare build.windows (this breaks the release build)', () => {
      // THE regression guard. The mistake is silent until `tauri build` reaches
      // its config parse — after the whole LTO compile — and then it is fatal.
      expect(
        conf.build?.windows,
        'build.windows is not a valid key for @tauri-apps/cli 2.11.4 and fails ' +
          '`tauri build` with "Additional properties are not allowed (\'windows\' was unexpected)". ' +
          'Set the static VC runtime in src-tauri/build.rs instead.',
      ).toBeUndefined();
    });

    it('tauri.conf.json contains no static-VC-runtime key under any spelling', () => {
      // Catches the alias spellings (`static-vc-runtime`, `staticVcRuntime`)
      // and the key being moved somewhere else in the file, which the object
      // check above would miss if it landed outside `build`.
      const confText = readFileSync(confPath, 'utf8');
      expect(confText).not.toMatch(/staticVCRuntime/);
      expect(confText).not.toMatch(/static-vc-runtime/);
      expect(confText).not.toMatch(/staticVcRuntime/);
      expect(confText).not.toMatch(/static_vc_runtime/);
    });

    it('build.windows is not smuggled in as an empty object either', () => {
      // `"windows": {}` parses fine here and still fails the CLI's schema, with
      // a diff that looks harmless.
      const buildTable = conf.build as unknown as Record<string, unknown>;
      expect(Object.keys(buildTable)).not.toContain('windows');
    });

    it('the build table itself still parses and is non-empty (guards vacuity)', () => {
      // If tauri.conf.json ever stopped being valid JSON the checks above would
      // all pass for the wrong reason; JSON.parse at module scope would already
      // have thrown, so this asserts the table survived.
      expect(conf.build).toBeTypeOf('object');
      expect(conf.build.frontendDist).toBe('../dist');
      expect(conf.build.beforeBuildCommand).toBe('npm run build');
    });
  });

  describe('WebView2 install mode', () => {
    it('is left unset, so Tauri keeps its small downloadBootstrapper default', () => {
      // DELIBERATE PRODUCT DECISION — do not "improve" this without asking.
      //
      // Setting `webviewInstallMode: { type: 'offlineInstaller' }` bundles the
      // full WebView2 runtime so an offline clinic can install. It works, and it
      // was measured end to end. It was reverted because it takes the installer
      // from 3.75 MB to 210 MB, which the owner judged too large to distribute.
      //
      // The accepted consequence: the installer downloads the WebView2 Runtime
      // at install time, so an install with no internet fails. That is a known
      // trade, not an oversight, and it is what this assertion pins.
      //
      // If it is ever set again, two things must be revisited together, because
      // they were changed as a pair: the 600s updater timeout in
      // src-tauri/src/lib.rs (210 MB needs ~2.81 Mbps to finish inside 600s, so
      // a clinic on a slower link would time out mid-download), and the size
      // expectation for the release pipeline.
      expect(conf.bundle.windows?.webviewInstallMode).toBeUndefined();
    });

    it('is not smuggled in under an alias or as an empty object', () => {
      const w = conf.bundle.windows as Record<string, unknown>;
      const aliases = [
        'webviewInstallMode',
        'webview-install-mode',
        'webview_install_mode',
        'webviewInstallType',
      ];
      for (const a of aliases) expect(w[a], a).toBeUndefined();
    });

    it('is NOT nested under nsis, where the previous attempt put it', () => {
      // Documented Tauri gotcha kept as a regression test: `nsis` owns
      // installerIcon/installMode/language, and `webviewInstallMode` is a
      // sibling of it under `bundle.windows`. A copy under nsis is an unknown
      // field, so the build dies — and if a future Tauri relaxes that, the
      // runtime behaviour would silently stay at the default (downloader),
      // which needs internet at first launch.
      expect(conf.bundle.windows?.nsis?.webviewInstallMode).toBeUndefined();
    });

    it('the default bundle target is the NSIS installer (Windows-only app)', () => {
      // offlineInstaller only means anything for a .exe installer.
      expect(conf.bundle.active).toBe(true);
      expect(conf.bundle.targets).toContain('nsis');
    });
  });

  describe('bundled resources', () => {
    it('includes ../THIRD_PARTY_NOTICES.md', () => {
      // Apache-2.0 (sql.js) and MIT/BSD notice obligations travel with a
      // distributed binary; shipping the notices inside the installer is how a
      // redistributable stays compliant.
      expect(conf.bundle.resources).toContain('../THIRD_PARTY_NOTICES.md');
    });

    it('every declared resource actually exists on disk', () => {
      // The silent one. A resources entry pointing at a missing file is NOT a
      // build error in every Tauri version: the installer is produced, the
      // notices are simply absent from it, and nobody notices until an
      // auditor asks. `../x` in tauri.conf.json is relative to src-tauri/.
      const missing = (conf.bundle.resources ?? []).filter((rel) => {
        const abs = isAbsolute(rel) ? rel : resolve(root, 'src-tauri', rel);
        return !existsSync(abs) || !statSync(abs).isFile();
      });
      expect(missing).toEqual([]);
    });

    it('the notices file is real, at the repo root, and not empty', () => {
      const notices = resolve(root, 'THIRD_PARTY_NOTICES.md');
      expect(existsSync(notices)).toBe(true);
      expect(statSync(notices).isFile()).toBe(true);
      expect(statSync(notices).size).toBeGreaterThan(0);
    });

    it('resolves ../THIRD_PARTY_NOTICES.md to exactly that repo-root file', () => {
      // Pins the relative path itself: `../../THIRD_PARTY_NOTICES.md` or a
      // copy under src-tauri/ would also satisfy "exists", but only this one
      // keeps the entry in step with the file the repo actually maintains.
      expect(resolve(root, 'src-tauri', '../THIRD_PARTY_NOTICES.md')).toBe(
        resolve(root, 'THIRD_PARTY_NOTICES.md'),
      );
    });
  });

  /**
   * Bundle identifier — DO NOT "fix" the `.app` suffix.
   *
   * Tauri warns that an identifier ending in `.app` collides with the macOS
   * bundle extension. That warning is deliberate and must never be acted on:
   * this is a Windows-only app (`bundle.targets: ["nsis"]`), and the
   * identifier is load-bearing on Windows in four places at once —
   *
   *   1. HKCU Uninstall registry key written by NSIS. Change it and the new
   *      installer installs alongside the old one; the old entry keeps
   *      advertising a stale version forever.
   *   2. The auto-update path. updateService compares + downloads per
   *      identifier; a change orphans every existing install on the update
   *      channel, so they never see another update again.
   *   3. %APPDATA%\pk.dentalsolutions.app — where resolve_db_path puts
   *      dental_solutions.sqlite. A different identifier means a different
   *      folder, so EVERY existing clinic opens an app with an empty database
   *      and no error: the "first run" wizard, as if they had reinstalled.
   *      Their cases, invoices and audit trail look gone.
   *   4. The WebView2 user-data folder and the updater's downloaded-installer
   *      staging directory.
   *
   * There is no migration that makes (3) safe on a desktop app people do not
   * re-install but simply keep launching. So the value is pinned, and this
   * comment exists so the next person who sees the warning does not act on it.
   */
  describe('bundle identifier', () => {
    it('is still pk.dentalsolutions.app — see the warning above', () => {
      expect(conf.identifier).toBe('pk.dentalsolutions.app');
    });

    it('has NOT been "fixed" to drop the .app suffix', () => {
      // Spelled out so the failure message names the specific tempting edit
      // rather than printing two unrelated-looking strings.
      expect(conf.identifier.endsWith('.app')).toBe(true);
      expect(conf.identifier).not.toBe('pk.dentalsolutions');
    });

    it('matches the version in package.json (one release channel, one identity)', () => {
      // version-guard.mjs covers the Rust/JS halves; this covers the config,
      // which is a third copy and the one the installer stamps into the
      // registry.
      const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
        version: string;
      };
      expect(conf.version).toBe(pkg.version);
    });
  });
});
