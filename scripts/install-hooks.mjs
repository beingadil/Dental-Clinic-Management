#!/usr/bin/env node
/**
 * Point git at `.githooks` so the generated-role-CSS guard is active.
 *
 * Wired to npm's `prepare` lifecycle, which runs after `npm install` / `npm ci`
 * in a local checkout. That is the point where the guard must become active: a
 * fresh clone has the hooks on disk but no way to run them, and until
 * core.hooksPath is set every `git checkout` can silently leave the generated
 * role CSS out of sync with the role-picker source. Requiring a human to
 * remember `npm run hooks:install` is exactly the failure this removes.
 *
 * Deliberately non-fatal. `prepare` also runs on `npm ci` in CI and in
 * production image builds, where there may be no git repo at all and where a
 * non-zero exit would fail an install over a lint guard. A missing repo is a
 * no-op, not an error; anything unexpected is printed so it is visible rather
 * than swallowed.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hooksDir = '.githooks';

function git(args) {
  return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

try {
  // Inside a worktree, git rev-parse resolves the real .git dir; a non-repo
  // (a tarball unpacked for CI, a Docker build context) throws.
  git(['rev-parse', '--git-dir']);

  if (!existsSync(path.join(projectRoot, hooksDir))) {
    console.warn(`[hooks] ${hooksDir}/ is missing — nothing to install.`);
    process.exit(0);
  }

  const current = (() => {
    try {
      return git(['config', '--get', 'core.hooksPath']);
    } catch {
      return '';
    }
  })();

  if (current === hooksDir) {
    console.log(`[hooks] core.hooksPath already ${hooksDir}`);
    process.exit(0);
  }

  git(['config', 'core.hooksPath', hooksDir]);
  console.log(`[hooks] installed ${hooksDir}${current ? ` (was: ${current})` : ''}`);
} catch (err) {
  // Not a git repo, or git is unavailable. Neither should break `npm install`.
  console.log(`[hooks] skipped — ${err?.message?.split('\n')[0] ?? 'no git repository'}`);
}