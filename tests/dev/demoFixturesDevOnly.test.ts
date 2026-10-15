/**
 * Structural guard for the dev-only demo fixtures.
 *
 * WHY THIS TEST EXISTS — `src/dev/demoFixtures.ts` is excluded from production
 * bundles by exactly one mechanism: the `if (import.meta.env.DEV)` guard around
 * the only `import()` of it, in App.tsx. Vite substitutes that flag with
 * `false` at build time, the branch becomes dead code, and because nothing else
 * references the module, Rollup never emits its chunk.
 *
 * That guarantee is invisible and one commit wide. A top-level
 * `import { installDemoFixtures } from './dev/demoFixtures'`, or the tempting
 * `const X = lazy(() => import('./dev/demoFixtures'))`, are both real calls that
 * Rollup keeps regardless of any `DEV` check nearby — and the fixture dataset
 * (clinic names, patient names, prices) would ship to every clinic.
 *
 * So the arrangement is asserted rather than remembered. This test reads the
 * source tree; it never imports the fixture module, so it cannot itself pull it
 * into a build.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const FIXTURE_MODULE = 'src/dev/demoFixtures.ts';

/** Every .ts/.tsx file under src/, as forward-slash paths relative to the repo. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(relative(ROOT, full).split('\\').join('/'));
    }
  }
  return out;
}

/** A static import of the fixture — the form that defeats the guard. */
const STATIC_IMPORT = /(^|\n)[ \t]*import\s[^;'"]*from\s+['"][^'"]*dev\/demoFixtures['"]/;

/** A dynamic import of the fixture — the allowed form. */
const DYNAMIC_IMPORT = /import\(\s*['"][^'"]*dev\/demoFixtures['"]\s*\)/;

describe('dev demo fixtures cannot reach a production bundle', () => {
  const files = sourceFiles(SRC);

  it('the fixture module exists and is declared dev-only', () => {
    expect(existsSync(join(ROOT, FIXTURE_MODULE))).toBe(true);
    const src = readFileSync(join(ROOT, FIXTURE_MODULE), 'utf8');
    // The grep target that proves absence from dist/ after a build.
    expect(src).toMatch(/DEMO_FIXTURE_MARKER\s*=/);
  });

  it('is referenced from exactly one file, which is the dev-guarded shell', () => {
    const referrers = files.filter((f) => {
      if (f === FIXTURE_MODULE) return false;
      return readFileSync(join(ROOT, f), 'utf8').includes('dev/demoFixtures');
    });

    // One reference site is the whole safety argument. A second one — a test
    // helper, a settings row, a story file — is the moment it becomes easy to
    // import unconditionally, so adding one should require a deliberate edit
    // here after checking the build output.
    expect(referrers).toEqual(['src/App.tsx']);
  });

  it('is only ever reached through a dynamic import', () => {
    for (const f of files) {
      if (f === FIXTURE_MODULE) continue;
      const src = readFileSync(join(ROOT, f), 'utf8');
      if (!src.includes('dev/demoFixtures')) continue;

      expect(src, `${f} statically imports the dev fixture`).not.toMatch(STATIC_IMPORT);
      expect(src, `${f} does not use a dynamic import()`).toMatch(DYNAMIC_IMPORT);
    }
  });

  it('every reference sits behind an import.meta.env.DEV check', () => {
    for (const f of files) {
      if (f === FIXTURE_MODULE) continue;
      const src = readFileSync(join(ROOT, f), 'utf8');
      if (!src.includes('dev/demoFixtures')) continue;

      expect(
        src.includes('import.meta.env.DEV'),
        `${f} references the dev fixture but never checks import.meta.env.DEV`,
      ).toBe(true);
    }
  });

  it('never hides the dynamic import inside a module-level lazy()', () => {
    for (const f of files) {
      if (f === FIXTURE_MODULE) continue;
      const src = readFileSync(join(ROOT, f), 'utf8');
      if (!src.includes('dev/demoFixtures')) continue;

      // `lazy(() => import(...))` is a real call at module scope; Rollup keeps
      // it even if the resulting component is never rendered, so the chunk is
      // emitted and the fixture ships.
      expect(
        /lazy\([^)]*import\(\s*['"][^'"]*dev\/demoFixtures/.test(src),
        `${f} wraps the dev fixture in lazy() — that call survives tree-shaking`,
      ).toBe(false);
    }
  });
});
