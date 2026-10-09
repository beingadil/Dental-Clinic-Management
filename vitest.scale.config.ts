import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

/**
 * Wall-clock budget suite.
 *
 * `tests/db/syncScale.test.ts` and `tests/db/autosaveScale.test.ts` assert that
 * a 10k-case sync and one autosave fit inside a main-thread budget. Both
 * budgets are wall-clock, so they measure the machine, not just the code: run
 * alongside the other 84 files they share the box with 86 Vitest workers and
 * report ~2x their true cost — a genuine 1233 ms sync reads as 2631 ms and a
 * 223 ms autosave as 480 ms, i.e. they fail on contention they cannot control
 * and pass the moment they get a core to themselves.
 *
 * So they run here, alone, on one fork with no sibling workers. The assertions
 * themselves are untouched — same budgets, same measurements.
 *
 * Wired into `npm test` (which runs this after the main suite), so CI still
 * gets them on every build.
 *
 * Merged from vite.config.ts exactly like vitest.config.ts does, for the same
 * reason: the React plugin, the `@` alias and the `__APP_VERSION__` define
 * have to apply to these tests too.
 */
export default defineConfig(async (env) => {
  const base = typeof viteConfig === 'function' ? await viteConfig(env) : viteConfig;

  return mergeConfig(base, {
    test: {
      include: [
        'tests/db/syncScale.test.ts',
        'tests/db/autosaveScale.test.ts',
      ],
      // One worker, one file at a time: the whole point is an uncontended CPU.
      pool: 'forks',
      minWorkers: 1,
      maxWorkers: 1,
      fileParallelism: false,
      // These budgets are the slowest thing in the suite by design.
      testTimeout: 120_000,
      hookTimeout: 120_000,
    },
  });
});