#!/usr/bin/env node
/**
 * App patch packer — builds `update-patch.json` for the hot-patch channel.
 *
 * Given a freshly built `dist/` tree it writes a manifest with a file table
 * (path relative to `dist/`, sha256 hex, byte size) that Rust's
 * `apply_app_patch` verifies after writing each file. Nothing in `src/`,
 * `src-tauri/` or `dist/` itself is committed — the manifest lives on
 * gh-pages and travels through `git push origin master:gh-pages`.
 *
 * Usage (from repo root, after `npm run build`):
 *   node scripts/make-app-patch.mjs --base 2.31.34 [--notes "..."]
 *     --base  The installed JS app version the patch targets (required).
 *             The TS-side gate is manifest.base_version == currentVersion(),
 *             and Rust gates it against the identity version — so set it to
 *             what the desktop app currently reports.
 *     --display-version  Optional display_version override (the panel's
 *             "applied — vX" text). Defaults to --base; bump it by hand to
 *             reflect what the patch actually changes.
 *     --dist  dist/ directory to scan. Defaults to <repo>/dist.
 *     --out   Manifest path. Defaults to <repo>/update-patch.json.
 *     --notes Optional free-text shown by the panel.
 *
 * Real mutations get a patch manifest from a real diff; this script is the
 * honest scanner — the file table is exactly what the apply side hashes.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_DIST = join(REPO_ROOT, 'dist');
const DEFAULT_OUT = join(REPO_ROOT, 'update-patch.json');

/**
 * Walk `dir` and return the file table: [{ path, sha256, size }], `path`
 * POSIX-style, relative to the scan root. Deterministic (sorted) — two runs
 * over the same tree produce byte-identical manifests.
 */
export async function scanDir(dir) {
  const out = [];
  const walk = async (abs, rel) => {
    const names = (await readdir(abs, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of names) {
      if (entry.isDirectory()) {
        await walk(join(abs, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
      } else {
        const buf = await readFile(join(abs, entry.name));
        out.push({
          path: rel ? `${rel}/${entry.name}` : entry.name,
          sha256: createHash('sha256').update(buf).digest('hex'),
          size: buf.length,
        });
      }
    }
  };
  await walk(dir, '');
  return out;
}

/**
 * Build the manifest object from a `dist/` directory. `buildPatchManifest`
 * is the pure testable surface; `main()` is the CLI (below).
 */
export async function buildPatchManifest({ baseVersion, distDir, displayVersion, notes } = {}) {
  if (!baseVersion) throw new Error('base_version is required');
  if (!distDir) throw new Error('distDir is required');
  const files = await scanDir(distDir);
  return {
    magic: 'DENTALUPDATE-PATCH',
    base_version: baseVersion,
    display_version: displayVersion || baseVersion,
    released_at: new Date().toISOString(),
    notes: notes || '',
    files,
    deleted: [],
  };
}

function parseArgs(argv) {
  const values = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') break;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        values[key] = next;
        i++;
      } else {
        values[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { values, positional };
}

function usage() {
  console.log(
    [
      'Usage: node scripts/make-app-patch.mjs --base <app version> [options]',
      '',
      'Options:',
      '  --base <version>           Installed app version this patch targets (required)',
      '  --display-version <ver>    Optional override for the panel’s “applied — vX”',
      '  --dist <dir>               dist/ dir to scan (default: <repo>/dist)',
      '  --out <path>               Manifest output (default: <repo>/update-patch.json)',
      '  --notes <text>             Optional free text shown by the panel',
    ].join('\n'),
  );
}

async function main() {
  const { values } = parseArgs(process.argv.slice(2));
  if (!values.base) {
    usage();
    process.exitCode = 1;
    return;
  }
  const baseVersion = values.base;
  const displayVersion = values['display-version'] || values.displayVersion;
  const distDir = values.dist || DEFAULT_DIST;
  const outPath = values.out || DEFAULT_OUT;
  const notes = values.notes || '';

  const manifest = await buildPatchManifest({ baseVersion, distDir, displayVersion, notes });
  const payload = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(outPath, payload);

  const totalBytes = manifest.files.reduce((acc, f) => acc + f.size, 0);
  console.log(
    [
      `Packer: wrote ${outPath}`,
      `  base_version=${manifest.base_version} display_version=${manifest.display_version}`,
      `  ${manifest.files.length} files, ${totalBytes} bytes → sha256 of each file in files[]`,
      '',
      'Next: push to gh-pages (`git push origin master:gh-pages`) so the update channel finds it.',
    ].join('\n'),
  );
}

const isScriptInvocation = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isScriptInvocation) main().catch((e) => {
  console.error(`make-app-patch: ${e?.message || e}`);
  process.exit(1);
});
