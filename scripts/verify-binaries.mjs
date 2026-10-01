#!/usr/bin/env node
/**
 * Binary-integrity guard — fails if any native binary in node_modules does not
 * match the bytes the official npm tarball ships.
 *
 * Why: on 2026-10-01 a tampered `@esbuild/win32-x64/esbuild.exe` (533 KB, forged
 * PE header, no signature) was planted in node_modules and the genuine 10.6 MB
 * binary renamed to `gesbuild.exe` beside it. Because esbuild's shim spawns
 * `<pkg>/esbuild.exe` and waits for a version handshake that never came, every
 * `vite`/`vitest` invocation hung with "The service was stopped" — a supply-chain
 * compromise that presented as a build bug. Two 0-byte `.ico` markers were added
 * so the directory listing still looked complete.
 *
 * A package-lock hash cannot catch this: `npm ci` only verifies the *tarball*,
 * and `npm` skips re-extraction when the package version already matches, so a
 * post-install substitution survives every install. Anchoring on per-file
 * SHA-256 captured from the official tarball (scripts/binary-integrity.json)
 * does catch it, and it needs no network at build time.
 *
 * Checks:
 *  1. every inventory entry exists and hashes to the recorded value;
 *  2. no binary exists on disk that the official tarball does not ship — this
 *     is what catches a *planted* file under a new name.
 *
 * A dependency bump trips check 1 (moved file -> MISSING, changed bytes ->
 * HASH MISMATCH), so drift cannot pass silently.
 *
 * npm installs only host-matching binaries, so the anchor declares the platform
 * it was captured on and this guard skips (loudly, exit 0) on any other host —
 * CI builds the web job on ubuntu, where every win32 row would otherwise read
 * as MISSING.
 *
 * Regenerating after a legitimate dependency change is deliberate: install,
 * confirm the change is intended, then run
 * `python3 scripts/regenerate-binary-integrity.py` (downloads each registry
 * tarball and re-hashes its members), and commit the updated anchor.
 *
 * Fail-closed by design: an unverifiable binary is treated as a failure.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modules = path.join(root, 'node_modules');
const inventoryPath = path.join(root, 'scripts', 'binary-integrity.json');

const fail = (lines) => {
  console.error(`binary-guard: FAILED — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(l);
  process.exit(1);
};

if (!fs.existsSync(modules)) {
  fail(['node_modules is not installed, so binaries cannot be verified.', '  Run `npm ci` first.']);
}

const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const packages = lock.packages ?? {};

// npm installs only host-matching binaries, so the anchor is per-platform. On a
// different platform the check would report every row as MISSING, so skip
// loudly rather than fail wrongly (CI builds the web job on ubuntu).
const scope = inventory.platform;
if (scope && (scope.os !== process.platform || scope.cpu !== process.arch)) {
  console.log(
    `binary-guard: SKIPPED — anchor targets ${scope.os}/${scope.cpu}; ` +
      `this host is ${process.platform}/${process.arch}.`,
  );
  process.exit(0);
}

const sha256 = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const BI = /\.(exe|node|dll)$/i;
/** Files shipped by packages whose name begins node_modules/, keyed by npm's
 *  own os/cpu/libc declaration — the same filter npm applies when installing. */
function hostMatches(info) {
  const want = (list, actual) => !Array.isArray(list) || list.includes(actual);
  const libc = process.platform === 'linux' ? 'glibc' : undefined;
  return (
    want(info.os, process.platform) &&
    want(info.cpu, process.arch) &&
    (libc === undefined || want(info.libc, libc))
  );
}

/** Every native binary npm would install on this host, as node_modules-relative paths. */
const expectedBinaries = new Set();
for (const [key, info] of Object.entries(packages)) {
  if (!key.startsWith('node_modules/') || !info.resolved || !hostMatches(info)) continue;
  const dir = path.join(modules, key.slice('node_modules/'.length));
  if (!fs.existsSync(dir)) continue;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!BI.test(entry.name)) continue;
      expectedBinaries.add(path.relative(modules, full).split(path.sep).join('/'));
    }
  };
  walk(dir);
}

const problems = [];
const verified = [];
const known = new Set();

for (const row of inventory.binaries) {
  known.add(row.file);
  const file = path.join(modules, ...row.file.split('/'));
  if (!fs.existsSync(file)) {
    problems.push(`${row.file}: MISSING (inventory lists it but it is not installed)`);
    continue;
  }
  const actual = sha256(file);
  if (actual !== row.sha256) {
    problems.push(
      `${row.file}: HASH MISMATCH\n` +
        `      installed: ${actual}\n` +
        `      official : ${row.sha256}\n` +
        `      (package ${row.package}@${row.version}) — the installed binary is not what npm published.`,
    );
    continue;
  }
  verified.push(row.file);
}

// A binary on disk that no official tarball ships is the signature of a planted
// file (the tamper's `gesbuild.exe` / `.ico` markers were exactly this).
for (const file of [...expectedBinaries].sort()) {
  if (known.has(file)) continue;
  problems.push(
    `${file}: NOT IN OFFICIAL TARBALL\n` +
      `      installed but not listed in scripts/binary-integrity.json.`,
  );
}

if (problems.length > 0) {
  fail([
    `${problems.length} native binary/binary-check problem(s):`,
    ...problems.map((p) => `  ${p}`),
    '',
    'The installed bytes differ from the published npm tarball. Do NOT run the',
    'build or tests until this is understood — a substituted binary executes with',
    'your full user privileges on every build. Inspect the file, then reinstall',
    'with `rm -rf node_modules && npm ci`, and only regenerate',
    'scripts/binary-integrity.json (scripts/regenerate-binary-integrity.py) once',
    'you have confirmed the change is intended.',
  ]);
}

console.log(
  `binary-guard: OK — ${verified.length} native binaries match the official npm tarballs.`,
);