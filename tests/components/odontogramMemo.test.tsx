// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { useCallback, useMemo, useState } from 'react';
import { render, cleanup, act } from '@testing-library/react';

/**
 * Perf: the odontogram memo boundary.
 *
 * ── What this pins ────────────────────────────────────────────────────────
 * A parent re-render that does not touch the chart must cost ZERO chart
 * renders. Before the fix, `CreateCaseModal` rebuilt `initialRestorations` /
 * `initialShades` / `initialMaterials` as inline object literals and passed a
 * fresh `onChange` on every render, so React.memo's shallow prop comparison
 * always missed and all 28 teeth re-rendered for keystrokes that had nothing
 * to do with the chart.
 *
 * ── Why the benchmark is shaped the way it is ──────────────────────────────
 *
 * 1. THE RENDER-COUNT GATE IS THE REAL ASSERTION, and it is load-independent.
 *    It counts `getClinicalSpecs()` calls, which Odontogram invokes exactly
 *    once per render (`useState(getClinicalSpecs())` — see line 314). A count
 *    cannot be moved by CPU contention, a GC pause or a co-scheduled cargo
 *    build, so this is what decides pass/fail.
 *
 * 2. THE WALL-CLOCK RATIO IS KEPT, because it is the property that actually
 *    matters to an operator and it is not knife-edge: the two sides scale
 *    together under load (measured below), so a 5x ratio survives contention
 *    that a fixed budget would not.
 *
 * 3. `clinicalSpecsService` is MOCKED. Two reasons, one correctness and one
 *    cost:
 *      - correctness: in a jsdom test the SQLite engine is not initialised, so
 *        the real getClinicalSpecs() throws DB_OPEN, catches it, falls back to
 *        localStorage and console.errors a full stack trace — on every single
 *        render. The production app hits the SQLite path and does none of
 *        that. The benchmark was measuring an Error object and its stack, not
 *        the chart.
 *      - cost: that Error + stack formatting was the single largest term in
 *        the old measurement and it scaled badly under contention.
 *    The mock returns the module's own DEFAULT_* catalogs, i.e. the same
 *        material/prep/shade/implant counts the localStorage fallback produced,
 *        so the chart still renders a realistic amount of work.
 *
 * ── Flakiness, honestly ───────────────────────────────────────────────────
 * The previous version of this test failed intermittently in full-suite runs
 * and never failed in isolation. It was NOT the ratio assertion: measured
 * isolated, stable 0.22ms vs churned 26.93ms (122x). Measured under 16x CPU
 * contention, stable 1.53ms vs churned 250.52ms — a 163x ratio, which passes
 * `stable < churned / 5` comfortably — yet the test still went red with
 *     Error: Test timed out in 5000ms.
 * Vitest's default testTimeout is 5s of ABSOLUTE wall clock, and the churned
 * arm had to grind 20 renders x ~27ms (5.4s at rest, 5.0s+ under load). So the
 * test was, without meaning to, a load test of the machine. The fixes are
 * below; none of them touch what the test asserts.
 */

const specProbe = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../../src/services/clinicalSpecsService', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/services/clinicalSpecsService')>();
  return {
    ...actual,
    getClinicalSpecs: () => {
      specProbe.calls++;
      return {
        materials: actual.DEFAULT_MATERIALS,
        prepTypes: actual.DEFAULT_PREP_TYPES,
        shadeGuides: actual.DEFAULT_SHADE_GUIDES,
        implantBrands: actual.DEFAULT_IMPLANT_BRANDS,
      };
    },
  };
});

// Imported after the mock so Odontogram picks up the instrumented module.
import Odontogram from '../../src/components/cases/Odontogram';

const TEETH = [11, 12, 13, 14, 15, 16, 21, 22, 23, 24, 25, 26, 31, 32, 33, 34, 35, 36];

const make = () => ({
  restorations: TEETH.reduce((acc, t) => { acc[t] = 'crown'; return acc; }, {} as Record<number, string>),
  shades: TEETH.reduce((acc, t) => { acc[t] = 'A2'; return acc; }, {} as Record<number, string>),
  materials: TEETH.reduce((acc, t) => { acc[t] = 'Zirconia'; return acc; }, {} as Record<number, string>),
});

function Harness({ stable }: { stable: boolean }) {
  const [n, setN] = useState(0);
  const derived = useMemo(make, []);
  const onChange = useCallback(() => {}, []);
  const churned = make();

  return (
    <>
      <button onClick={() => setN((v) => v + 1)}>bump {n}</button>
      <Odontogram
        initialSelected={TEETH}
        initialRestorations={stable ? derived.restorations : churned.restorations}
        initialShades={stable ? derived.shades : churned.shades}
        initialMaterials={stable ? derived.materials : churned.materials}
        onChange={stable ? onChange : (() => {})}
      />
    </>
  );
}

const ITERATIONS = 20;
/** The liveness probe counts renders, it does not measure them, so it needs
 *  only enough iterations to prove the counter moves — and staying small keeps
 *  it far away from any wall-clock budget. */
const PROBE_ITERATIONS = 5;

type Bench = {
  msPerRender: number;
  chartRenders: number;
  mountRenders: number;
};

function bench(stable: boolean, iterations: number = ITERATIONS): Bench {
  specProbe.calls = 0;
  const view = render(<Harness stable={stable} />);
  const mountRenders = specProbe.calls;

  // warm up (JIT + first-paint work that should not be measured)
  for (let i = 0; i < 3; i++) act(() => { view.rerender(<Harness stable={stable} />); });

  specProbe.calls = 0;
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) act(() => { view.rerender(<Harness stable={stable} />); });
  const ms = performance.now() - t0;

  const chartRenders = specProbe.calls;
  view.unmount();
  cleanup();
  return { msPerRender: ms / iterations, chartRenders, mountRenders };
}

describe('perf: odontogram memo boundary', () => {
  it('is exported memoised', () => {
    expect((Odontogram as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
  });

  it('the render probe is live: churned props DO re-render the chart', () => {
    // Guard the guard. `getClinicalSpecs()` is a plain (non-lazy) argument to
    // useState, so it runs on every Odontogram render — that is the render
    // counter this file relies on. If someone "fixes" it to
    // `useState(() => getClinicalSpecs())`, the count would read 0 in BOTH arms
    // and the memoisation test below would pass no matter what the code did.
    // This assertion fails the moment the probe goes blind.
    const churned = bench(false, PROBE_ITERATIONS);
    expect(churned.mountRenders).toBeGreaterThanOrEqual(1);
    expect(churned.chartRenders).toBe(PROBE_ITERATIONS);
  }, 15_000);

  it('a parent re-render that does not touch the chart should not cost a chart render', () => {
    const stable = bench(true);
    const churned = bench(false);

    console.log(
      `[perf] per parent re-render -> stable props: ${stable.msPerRender.toFixed(2)}ms ` +
        `(${stable.chartRenders} chart renders) · churning props (pre-fix): ` +
        `${churned.msPerRender.toFixed(2)}ms (${churned.chartRenders} chart renders)`,
    );

    // PRIMARY, load-independent: exactly zero chart renders across 20 parent
    // re-renders. A count, so no amount of CPU contention can flip it, and it
    // is a strictly stronger claim than "it rendered but fast".
    expect(stable.chartRenders).toBe(0);

    // SECONDARY, the user-facing property: the memoised path is dramatically
    // cheaper. A ratio, not a fixed budget, because both arms degrade together
    // under load — measured 122x idle and 163x under 16x contention.
    expect(stable.msPerRender).toBeLessThan(churned.msPerRender / 5);

    // Sanity, so the ratio above cannot be satisfied by both arms collapsing to
    // zero (which a broken render would also produce).
    expect(churned.chartRenders).toBe(ITERATIONS);
    expect(churned.msPerRender).toBeGreaterThan(0);
    // Explicit headroom over Vitest's 5s default, with a reason rather than a
    // number chosen by watching it fail. The ratio assertion above is the real
    // gate and is load-independent; this budget only has to cover the ARM that
    // does real work (20 chart renders, ~7.5ms each idle, ~31ms each measured
    // under 16x CPU contention). 30s is ~6x the worst observed contention case,
    // so the test can only time out on something genuinely wrong.
  }, 30_000);
});
