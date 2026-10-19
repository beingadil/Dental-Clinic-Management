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
 * 2. THE WALL-CLOCK COMPARISON IS A SANITY CHECK, not a gate, and it is
 *    measured RELATIVE TO THE ARM THAT DID THE WORK.
 *
 *    The previous version asserted `stable < churned / 5` and failed in CI on
 *    commit 676c076 with "expected 1.3222812500000032 to be less than
 *    1.2089114300000006" — the stable arm took 1.32ms and the churned arm
 *    6.04ms, a 4.6x ratio, so the /5 threshold missed by 9%.
 *
 *    Two separate things had to be wrong for that to happen.
 *
 *    (a) THE ARMS WERE MEASURED IN THE WRONG ORDER. `bench(true)` ran first
 *        and paid the entire cold-start cost of the chart's render path —
 *        the JIT compiling it, React's first pass, the shapes being cached —
 *        while `bench(false)` ran against a warm path. In the broken-memo case
 *        that showed up as the STABLE arm measuring 111ms against the CHURNED
 *        arm's 36ms: the "fast" arm looking three times slower than the
 *        "slow" one, which is the opposite of the truth. benchBoth() now
 *        warms BOTH arms before measuring either, and interleaves the trials.
 *
 *    (b) A FIXED DIVISOR MEASURES THE MACHINE. The stable arm does almost no
 *        work — 12 parent re-renders that React.memo short-circuits — so its
 *        measured time is the FLOOR: the fixed cost of a render pass plus the
 *        harness's own per-iteration overhead. That floor does not shrink
 *        under contention; it is what is left when the real work is skipped.
 *        The churned arm's time, by contrast, is 12 full chart renders. So
 *        under load the RATIO SHRINKS even though the absolute saving grows.
 *        On a contended runner the ratio fell to 4.6x, which is why /5 failed.
 *        The old claim that the two sides "scale together under load" was
 *        wrong, and CI is what proved it.
 *
 *    The fix keeps the claim and drops the machine dependency. The comparison
 *    is now made against the churned arm, with a 2x floor: a broken memo
 *    boundary makes the two arms EQUAL by construction — both render the chart
 *    12 times — and measured that way the ratio sits at 1.0 (0.87-1.22
 *    across runs), so 2x is a wide, safe margin below the real value
 *    (100x+ on a quiet machine, 4.6x on the contended CI runner). The
 *    absolute saving is asserted too, in units of one chart render measured
 *    from the churned arm's own cost, so that threshold moves with the
 *    machine. The render-count gate below catches the regression regardless
 *    of what any clock says.
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

const ITERATIONS = 12;
/** The liveness probe counts renders, it does not measure them, so it needs
 *  only enough iterations to prove the counter moves — and staying small keeps
 *  it far away from any wall-clock budget. */
const PROBE_ITERATIONS = 5;
/** Wall-clock samples are noisy under load, and noise only ever makes a sample
 *  SLOWER. So the FASTEST sample of several is the closest estimate of the
 *  true cost, and a minimum is the right statistic here — a mean would fold
 *  the contention the runner happened to be under into the measurement. */
const TRIALS = 3;

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

/**
 * Measures BOTH arms together, interleaved, and returns the fastest trial of
 * each.
 *
 * Measuring the arms one after the other (the obvious way) is what made this
 * test lie. Whichever arm ran FIRST paid the entire cold-start cost of the
 * chart's render path — the JIT compiling it, React's first-pass work, the
 * shapes being cached — while the second arm ran against a warm path. In the
 * broken-memo case that showed up as the STABLE arm measuring 111ms and the
 * CHURNED arm 36ms, i.e. the "fast" arm looking three times slower than the
 * "slow" one, which is the opposite of the truth and made the comparison a
 * coin flip.
 *
 * So: warm BOTH arms before either is measured, then interleave the trials so
 * that neither arm systematically benefits from running first, and take the
 * minimum of each (contention can only make a trial slower, never faster).
 * With that, a broken memo boundary makes the two arms equal — which is what
 * the assertions below are built to catch.
 */
function benchBoth(): { stable: Bench; churned: Bench } {
  const stableView = render(<Harness stable />);
  const churnedView = render(<Harness stable={false} />);

  // Warm BOTH arms before measuring either one.
  for (let i = 0; i < 3; i++) {
    act(() => { stableView.rerender(<Harness stable />); });
    act(() => { churnedView.rerender(<Harness stable={false} />); });
  }

  const best = { stable: Infinity, churned: Infinity };
  const counts = { stable: 0, churned: 0 };

  for (let trial = 0; trial < TRIALS; trial++) {
    // Stable arm.
    specProbe.calls = 0;
    let t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) act(() => { stableView.rerender(<Harness stable />); });
    let ms = performance.now() - t0;
    if (ms < best.stable) { best.stable = ms; counts.stable = specProbe.calls; }

    // Churned arm.
    specProbe.calls = 0;
    t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) act(() => { churnedView.rerender(<Harness stable={false} />); });
    ms = performance.now() - t0;
    if (ms < best.churned) { best.churned = ms; counts.churned = specProbe.calls; }
  }

  stableView.unmount();
  churnedView.unmount();
  cleanup();

  return {
    stable: { msPerRender: best.stable / ITERATIONS, chartRenders: counts.stable, mountRenders: 0 },
    churned: { msPerRender: best.churned / ITERATIONS, chartRenders: counts.churned, mountRenders: 0 },
  };
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
    const { stable, churned } = benchBoth();

    console.log(
      `[perf] per parent re-render -> stable props: ${stable.msPerRender.toFixed(2)}ms ` +
        `(${stable.chartRenders} chart renders) · churning props (pre-fix): ` +
        `${churned.msPerRender.toFixed(2)}ms (${churned.chartRenders} chart renders)`,
    );

    // PRIMARY, load-independent: exactly zero chart renders across 12 parent
    // re-renders. A count, so no amount of CPU contention can flip it, and it
    // is a strictly stronger claim than "it rendered but fast".
    expect(stable.chartRenders).toBe(0);

    // SECONDARY, the user-facing property: the memoised path is measurably
    // cheaper, and the saving is at least one whole chart render's worth of
    // work.
    //
    // Both halves are relative to the churned arm, never to a fixed
    // constant, because a fixed constant is a property of the machine:
    //
    //   (a) at least 2x cheaper. A broken memo boundary makes the two arms
    //       EQUAL by construction — both render the chart 12 times — and
    //       measured that way the ratio sits at 1.0 (0.87-1.22 across
    //       runs), so a 2x floor is a wide, safe margin below the real
    //       value. It is also far below the ratio a WORKING memo boundary
    //       produces: 100x+ on a quiet machine, and 4.6x on the contended
    //       CI runner that failed the old /5 assertion, because there the
    //       per-iteration harness overhead is what inflates the stable arm.
    //       That gap is why the old threshold was knife-edge and this one
    //       is not.
    //   (b) the absolute saving must be at least one chart render. This is
    //       what the old ratio was really trying to say, and it is what
    //       distinguishes "the chart was skipped" from "the chart was
    //       skipped and the harness overhead happened to be similar". One
    //       chart render is measured as the churned arm's own per-render
    //       cost, so the threshold moves with the machine.
    expect(stable.msPerRender).toBeLessThan(churned.msPerRender / 2);
    expect(churned.msPerRender - stable.msPerRender).toBeGreaterThanOrEqual(
      churned.msPerRender / ITERATIONS
    );

    // Sanity, so the comparison above cannot be satisfied by both arms collapsing to
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
