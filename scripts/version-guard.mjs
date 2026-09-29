#!/usr/bin/env node
/**
 * Version-drift guard — fails if any hardcoded semver string in src/ could
 * masquerade as the app version.
 *
 * Why: backupService.ts once carried a second, hand-maintained APP_VERSION
 * that the release bumps never touched. Updated 2.12.0 installs still
 * believed they were 2.10.0, so every update check re-downloaded and
 * re-installed in an endless loop. The live version is now injected from
 * package.json (vite.config.ts `define`); this guard makes a recurrence
 * impossible to ship.
 *
 * Heuristic (kept strict to avoid false positives):
 *  - scans src/**\*.{ts,tsx} for `X.Y.Z` string literals (X = 2..9);
 *  - ignores one known historical value: the migration 004 seed that
 *    intentionally stamps fresh databases with the ORIGINAL app version
 *    (it only ever runs on empty DBs);
 *  - anything else matching the current package.json version, or the
 *    immediately preceding patch/minor, is an error (drifted duplicate).
 *  - any other semver literal is allowed (library versions in comments,
 *    protocol versions, fixture dates, etc.).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`version-guard: package.json version "${version}" is not semver`);
  process.exit(1);
}

/** Neighbours of the current version a drifted duplicate would most likely hold. */
function suspiciousVersions(v) {
  const [maj, min, pat] = v.split('.').map(Number);
  const out = new Set([v]);
  if (pat > 0) out.add(`${maj}.${min}.${pat - 1}`);      // bumped patch, forgot a copy
  if (min > 0) {
    out.add(`${maj}.${min - 1}.0`);                       // bumped minor, forgot a copy
    out.add(`${maj}.${min - 1}.${pat}`);
  }
  out.add(`${maj}.${min}.${pat + 1}`);                    // bumped everything but a copy
  return out;
}
const suspicious = suspiciousVersions(version);

/** Historical constant allowed verbatim (migration 004 seeds fresh DBs). */
const ALLOWED_EXACT = new Map([
  // src/db/migrations.ts: fresh-install seed, intentionally the original version
  ['2.0.0', 'src/db/migrations.ts (migration 004 seed stamps the original app version on fresh databases)'],
]);

const SEMVER_IN_STRING = /['"](\d)\.(\d{1,2})\.(\d{1,2})['"]/g;
const offenders = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    const rel = path.relative(root, full).replace(/\\/g, '/');
    const text = fs.readFileSync(full, 'utf8');
    for (const m of text.matchAll(SEMVER_IN_STRING)) {
      const lit = `${m[1]}.${m[2]}.${m[3]}`;
      if (ALLOWED_EXACT.has(lit)) continue;
      if (suspicious.has(lit)) offenders.push({ file: rel, line: text.slice(0, m.index).split('\n').length, lit });
    }
  }
}
walk(path.join(root, 'src'));

// Cross-file consistency: package.json and the Tauri bundle manifest must
// carry the same version (tauri.conf.json is what the installer + registry
// report, package.json is what gets injected as __APP_VERSION__).
const tauriConf = JSON.parse(
  fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'),
);
if (tauriConf.version !== version) {
  offenders.push({
    file: 'src-tauri/tauri.conf.json',
    line: 0,
    lit: `${tauriConf.version} (package.json says ${version})`,
  });
}

if (offenders.length > 0) {
  console.error(`version-guard: FAILED — hardcoded version literals that shadow the live version (${version}):`);
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line} — "${o.lit}"`);
  }
  console.error(`\nImport APP_VERSION from services/backupService (injected from package.json) instead.`);
  console.error(`If a literal is legitimately unrelated (e.g. a protocol version), rename or derive it so it cannot be mistaken for the app version.`);
  process.exit(1);
}

console.log(`version-guard: OK — no hardcoded app-version duplicates in src/ (live: ${version})`);
