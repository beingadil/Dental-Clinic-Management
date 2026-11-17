#!/usr/bin/env node
/**
 * npm audit gate — fails the build on high/critical advisories that are not
 * explicitly allowlisted below.
 *
 * Why this exists: `npm audit` has no --ignore flag, so the repo used to gate
 * on `npm audit --audit-level=high`. When GHSA-fc5q-39xc-vjpf was reviewed on
 * 2026-11-17 (picomatch ReDoS, every released version affected, NO patched
 * version available), that step began failing every build on master — and the
 * only "fix" npm offers is a `--force` downgrade of vite, which breaks the
 * toolchain and still reports picomatch as affected. A gate that cannot ever
 * pass is not a gate, it is a stalled release train.
 *
 * Allowlist (each entry requires a written justification, same bar as the
 * cargo-audit ignores in .github/workflows/ci.yml):
 *
 *   GHSA-fc5q-39xc-vjpf — picomatch ReDoS via single-branch repeated extglobs
 *   (CVE-2026-112366). Affects picomatch <= 4.0.7; no patched release exists
 *   as of 2026-11-17 (published 2026-10-19, reviewed 2026-11-17).
 *   REACHABILITY: picomatch is used only by vite/vitest at build and test
 *   time in CI and on dev machines. The shipped installer contains no bundled
 *   picomatch runtime, and the glob patterns parsed are this repo's own
 *   config and file lists — no clinic, customer or attacker-supplied input
 *   ever reaches them. ReDoS requires a crafted glob string; there is no path
 *   for one. `npm audit fix --force` downgrades vite (breaking) and does NOT
 *   resolve the advisory. Revisit when a patched picomatch ships; do not add
 *   anything to this list that is reachable at runtime or build-reachable
 *   from untrusted input.
 *
 * Anything NOT in the list fails the gate — including any new advisory on a
 * package that has an allowlisted parent. Dependents of an allowlisted
 * advisory are explained only while they carry NO OTHER advisory of their own.
 */

import { spawnSync } from 'node:child_process';

/** GHSA ids (matched against the advisory URL in each `via` entry). */
const ALLOWLIST = new Set(['GHSA-fc5q-39xc-vjpf']);

const SEVERITIES = new Set(['high', 'critical']);

function isAllowlistedAdvisory(via) {
  // via entries are either the name of an affected dependency (string) or an
  // advisory object (source/url/name/title).
  const url = typeof via === 'object' && via ? String(via.url ?? '') : '';
  return [...ALLOWLIST].some((id) => url.includes(id));
}

function main() {
  const out = spawnSync('npm audit --json', {
    shell: true,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const raw = `${out.stdout ?? ''}${out.stderr ?? ''}`;
  let report;
  try {
    report = JSON.parse(out.stdout);
  } catch {
    console.error('npm-audit-gate: could not parse `npm audit --json` output — failing closed.');
    console.error(raw.slice(-2000));
    process.exit(1);
  }

  const vulns = report?.vulnerabilities ?? {};
  const names = Object.keys(vulns);
  if (out.error) {
    console.error(`npm-audit-gate: the audit command itself failed (${out.error.message}) — failing closed.`);
    process.exit(1);
  }
  if (names.length === 0) {
    console.log('npm-audit-gate: OK — no high/critical advisories.');
    return;
  }

  // Pass 1 — packages carrying an unallowlisted advisory object of their own.
  const unexplained = new Set();
  const explained = new Set();
  for (const [name, info] of Object.entries(vulns)) {
    if (!SEVERITIES.has(info.severity)) continue;
    const advisories = (info.via ?? []).filter((v) => typeof v === 'object' && v !== null);
    if (advisories.length === 0) continue; // transitive echo, resolved in pass 2
    const bad = advisories.filter((v) => !isAllowlistedAdvisory(v));
    if (bad.length > 0) unexplained.add(name);
    else explained.add(name);
  }

  // Pass 2 — a package is unexplained if any of its dependency-path via
  // entries names an unexplained package (fixpoint).
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, info] of Object.entries(vulns)) {
      if (!SEVERITIES.has(info.severity) || unexplained.has(name)) continue;
      for (const v of info.via ?? []) {
        if (typeof v === 'string' && unexplained.has(v)) {
          unexplained.add(name);
          grew = true;
          break;
        }
      }
    }
  }

  const allowlistedHits = [...explained];
  if (allowlistedHits.length > 0) {
    console.log(`npm-audit-gate: allowlisted advisories encountered (see header for justification):`);
    for (const n of allowlistedHits.sort()) console.log(`  ${n} — via ${[...ALLOWLIST].join(', ')}`);
  }

  if (unexplained.size > 0) {
    console.error('npm-audit-gate: FAILED — high/critical advisories that are not allowlisted:');
    for (const name of [...unexplained].sort()) {
      const info = vulns[name];
      const advisories = (info.via ?? [])
        .map((v) => (typeof v === 'object' && v ? `${v.name ?? name} ${v.url ?? ''}` : `via ${v}`))
        .join('; ');
      console.error(`  ${name} (${info.severity}): ${advisories}`);
    }
    console.error('Fix, or add a justified allowlist entry in scripts/npm-audit-gate.mjs.');
    process.exit(1);
  }
  console.log('npm-audit-gate: OK — all high/critical advisories are allowlisted and justified.');
}

main();
