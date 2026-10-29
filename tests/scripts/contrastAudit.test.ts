import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * The contrast audit's own contract.
 *
 * It is the only thing in the repo that can see a colour FAIL, and its
 * blind spots are invisible by construction: a pairing it does not mine
 * cannot fail. The gap that mattered was the placeholder — a field's hint,
 * which is ink on a surface, graded by nothing, and `placeholder-slate-400`
 * on white measured 2.63:1 while the whole suite stayed green.
 *
 * So the audit is exercised here the way it is used: run it, and read what
 * it says. A regression in the scanner shows up as a missing pairing, and a
 * regression in the coverage shows up as a missing FAIL.
 */
const ROOT = resolve(__dirname, '../..');
const AUDIT = resolve(ROOT, 'scripts/contrast-audit.mjs');

/** Run the audit and capture its output (it exits 1 when something fails). */
function runAudit(): { out: string; code: number } {
  try {
    const out = execFileSync(process.execPath, [AUDIT], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { out, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, code: err.status ?? 1 };
  }
}

describe('the contrast audit', () => {
  it('grades a placeholder as ink on the field it is painted in', () => {
    const { out } = runAudit();
    // The app's login fields are the one place with a placeholder, and the
    // pairing must be mined and reported with its own state.
    expect(out).toMatch(/bg-slate-100 > placeholder-slate-600 > placeholder/);
  });

  it('says how many pairings it mined, so a silent drop is visible', () => {
    const { out } = runAudit();
    const mined = out.match(/Mined (\d+) distinct bg>text pairings/);
    expect(mined).not.toBeNull();
    expect(Number(mined![1])).toBeGreaterThan(100);
    // A placeholder is a rendering in its own right, so the count must be
    // higher than it was before placeholders were graded.
    expect(Number(mined![1])).toBeGreaterThan(134);
  });

  it('passes on the source as it stands', () => {
    const { out, code } = runAudit();
    expect(code, out.slice(-800)).toBe(0);
    expect(out).toMatch(/All \d+ graded pairings clear 4\.5:1/);
  });

  it('would fail a placeholder that is too faint', () => {
    /* The strongest proof that the coverage is real: a placeholder that
       cannot be read must turn the audit red. If this ever stops failing,
       the gap has reopened. */
    const loginPage = resolve(ROOT, 'src/components/auth/LoginPage.tsx');
    const original = readFileSync(loginPage, 'utf8');
    try {
      const weakened = original.replace(/placeholder-slate-600/g, 'placeholder-slate-400');
      expect(weakened).not.toBe(original);
      writeFileSync(loginPage, weakened, 'utf8');

      const { out, code } = runAudit();
      expect(code, out.slice(-600)).toBe(1);
      expect(out, out.slice(-600)).toMatch(/placeholder-slate-400/);
      expect(out, out.slice(-600)).toMatch(/FAIL/);
    } finally {
      writeFileSync(loginPage, original, 'utf8');
    }
  });
});
