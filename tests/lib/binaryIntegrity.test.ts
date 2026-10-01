// Node-environment test (no DOM): validates the binary-integrity anchor and the
// lifecycle wiring that makes it run.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Supply-chain anchor contract.
 *
 * On 2026-10-01 a tampered `@esbuild/win32-x64/esbuild.exe` was planted in
 * node_modules and the genuine binary renamed `gesbuild.exe` beside it, which
 * hung every vite/vitest run. `scripts/verify-binaries.mjs` now compares
 * installed binaries against hashes captured from the official npm tarball.
 *
 * That guard is only as good as the anchor it reads and the scripts that call
 * it, neither of which tsc or vitest would otherwise notice: a malformed anchor
 * or a dropped script entry would silently disable the check. This test pins
 * both. It needs no network — the anchor is generated offline and committed.
 */

const root = resolve(__dirname, '../..');
const anchorPath = resolve(root, 'scripts/binary-integrity.json');
const guardPath = resolve(root, 'scripts/verify-binaries.mjs');

describe('binary integrity anchor', () => {
  it('reads as a well-formed inventory of SHA-256 hashes', () => {
    expect(existsSync(anchorPath)).toBe(true);
    const anchor = JSON.parse(readFileSync(anchorPath, 'utf8'));
    expect(Array.isArray(anchor.binaries)).toBe(true);
    expect(anchor.binaries.length).toBeGreaterThan(0);

    for (const row of anchor.binaries) {
      expect(row.package, `entry ${row.file} has a package`).toBeTruthy();
      expect(row.file, `entry for ${row.package} has a file`).toBeTruthy();
      expect(row.sha256, `${row.file} sha256 format`).toMatch(/^[a-f0-9]{64}$/);
      // Paths are node_modules-relative and must not escape the tree.
      expect(row.file, `${row.file} is node_modules-relative`).not.toMatch(/^[/\\]|\.\./);
    }

    const files = anchor.binaries.map((r: { file: string }) => r.file);
    expect(new Set(files).size, 'no duplicate file entries').toBe(files.length);
  });

  it('covers the esbuild binary whose substitution caused the incident', () => {
    const anchor = JSON.parse(readFileSync(anchorPath, 'utf8'));
    const esbuild = anchor.binaries.filter((r: { file: string }) =>
      /@esbuild\/win32-x64\/esbuild\.exe$/.test(r.file),
    );
    expect(esbuild.length, 'at least one @esbuild/win32-x64/esbuild.exe anchored').toBeGreaterThan(0);
  });

  it('is enforced by the guard script', () => {
    expect(existsSync(guardPath)).toBe(true);
    const source = readFileSync(guardPath, 'utf8');
    // Planted files (shipped by no tarball) must be reported, not ignored.
    expect(source).toMatch(/NOT IN OFFICIAL TARBALL/);
    expect(source).toMatch(/HASH MISMATCH/);
  });
});

describe('binary integrity wiring', () => {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

  // The original symptom was a hang in `npm test` / `npm run dev`; every entry
  // point that spawns esbuild has to run the guard first.
  for (const script of ['dev', 'build', 'test', 'lint']) {
    it(`${script} verifies binaries before running`, () => {
      expect(pkg.scripts[script], `scripts.${script}`).toContain('verify-binaries.mjs');
    });
  }
});