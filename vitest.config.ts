import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

/**
 * Test configuration.
 *
 * The suite previously ran on Vitest's bare defaults, with no config file at
 * all. That worked, but it meant every run re-transformed every module from
 * scratch — roughly a third of wall-clock time spent redoing identical work,
 * which Vitest reported on each run ("re-done on every run").
 *
 * MERGED, not standalone: a bare vitest.config.ts would take over from
 * vite.config.ts entirely and silently drop the React plugin, the `@` alias
 * and the `__APP_VERSION__` define, changing how tests compile. Importing the
 * app config and merging keeps one source of truth for both pipelines.
 *
 * `fsModuleCache` persists transforms to node_modules/.vitest-cache (gitignored
 * via node_modules/) and is safe here: the cache key includes file content, so
 * editing a source file invalidates its own transform automatically.
 *
 * jsdom stays opt-in per file via `@vitest-environment jsdom` docblocks. Only
 * the two DOM suites need it, and making it the default would slow every other
 * suite and hide accidental DOM usage in node-environment tests.
 */
export default defineConfig(async (env) => {
  const base = typeof viteConfig === 'function' ? await viteConfig(env) : viteConfig;

  return mergeConfig(base, {
    test: {
      include: ['tests/**/*.test.{ts,tsx}'],
      // Wall-clock budget tests. They need an uncontended CPU or they measure
      // the other 84 files competing for it; vitest.scale.config.ts runs them
      // alone and `npm test` chains both configs.
      exclude: [
        '**/node_modules/**',
        'tests/db/syncScale.test.ts',
        'tests/db/autosaveScale.test.ts',
        'tests/db/syncScale100k.test.ts',
      ],
      // Persist transforms between runs. ~30% of the suite was re-transforming
      // identical modules; this reuses them across processes.
      fsModuleCache: true,
      // Fail loudly on a stray unhandled rejection rather than letting it pass
      // silently as an unrelated later failure.
      dangerouslyIgnoreUnhandledErrors: false,
    },
  });
});