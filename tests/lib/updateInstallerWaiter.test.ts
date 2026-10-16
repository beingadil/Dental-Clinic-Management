import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The in-app updater reports its failures to the operator as a one-line toast,
 * so "which thing broke" has to be carried by that one line.
 *
 * This failure was: `Could not start the installer: program not found`. That
 * names the installer, which was present and fine. What was missing was the
 * PowerShell interpreter the waiter script runs in — the code spawned
 * `powershell` by bare name and let the OS resolve it against PATH. On any
 * PATH that does not carry the WindowsPowerShell directory there was nothing to
 * resolve, and the update aborted with a message pointing at the wrong
 * component entirely.
 *
 * The source is asserted rather than the behaviour: spawning a real detached
 * process inside a test is not something a test suite should do, and the bug
 * was a name-resolution decision, which is exactly what the source states.
 */
const lib = readFileSync(
  resolve(process.cwd(), 'src-tauri/src/lib.rs'),
  'utf8',
);

/** The `spawn_install_waiter` body for Windows. */
const spawnWaiter = (): string => {
  const start = lib.indexOf('fn spawn_install_waiter');
  expect(start).toBeGreaterThan(-1);
  const end = lib.indexOf('\n#[cfg(not(windows))]', start);
  return lib.slice(start, end === -1 ? undefined : end);
};

describe('update installer waiter', () => {
  it('resolves PowerShell to an absolute path instead of a bare name', () => {
    // A bare program name is the bug. The spawn must use a resolved path.
    expect(spawnWaiter()).not.toMatch(/Command::new\("powershell/);
    expect(spawnWaiter()).toMatch(/Command::new\(&shell\)/);
  });

  it('looks PowerShell up under the Windows install roots', () => {
    const fn = lib.slice(lib.indexOf('fn powershell_exe'));
    // SystemRoot / WINDIR with a hardcoded fallback, so a stripped
    // environment still resolves.
    expect(fn).toMatch(/SystemRoot/);
    expect(fn).toMatch(/WINDIR/);
    expect(fn).toMatch(/r"C:\\Windows"/);
    expect(fn).toMatch(/WindowsPowerShell/);
  });

  it('checks the Sysnative view first so a 32-bit build finds it too', () => {
    const fn = lib.slice(lib.indexOf('fn powershell_exe'));
    const native = fn.indexOf('Sysnative');
    const redirected = fn.indexOf('System32');
    expect(native).toBeGreaterThan(-1);
    expect(redirected).toBeGreaterThan(-1);
    expect(native).toBeLessThan(redirected);
  });

  it('only spawns once it has confirmed the interpreter exists', () => {
    // `ok_or_else` before the spawn: an absent PowerShell must produce the
    // actionable message, not a spawn error.
    expect(spawnWaiter()).toMatch(/powershell_exe\(\)\.ok_or_else/);
    expect(spawnWaiter()).not.toMatch(/powershell_exe\(\)\.expect/);
  });

  it('names the actual failure, and offers the manual route out', () => {
    const fn = spawnWaiter();
    // The reported path must be the interpreter that failed, not the installer.
    expect(fn).toMatch(/shell\.display\(\)/);
    expect(fn).toMatch(/releases page/);
    expect(fn).not.toMatch(/Could not start the installer: \{e\}/);
  });

  it('escapes quotes in the paths it hands to PowerShell', () => {
    // A `'` in a path is legal on NTFS. Unescaped, it closes the PowerShell
    // string literal early and the waiter script becomes a syntax error.
    expect(lib).toMatch(/fn ps_quote/);
    expect(lib).toMatch(/replace\('\\'', "''"\)/);
    const fn = spawnWaiter();
    expect(fn).toMatch(/ps_quote\(staged\)/);
    expect(fn).toMatch(/ps_quote\(relaunch_target\)/);
    expect(fn).not.toMatch(/staged\.display\(\)/);
    expect(fn).not.toMatch(/relaunch_target\.display\(\)\)/);
  });

  it('still waits for this process to exit before running the installer', () => {
    // NSIS cannot overwrite the files of a running app; the ordering is the
    // reason the waiter exists at all.
    const fn = spawnWaiter();
    expect(fn).toMatch(/Wait-Process -Id \{\}/);
    expect(fn).toMatch(/std::process::id\(\)/);
  });
});