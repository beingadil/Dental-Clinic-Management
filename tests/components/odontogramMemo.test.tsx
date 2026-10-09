// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { useCallback, useMemo, useState } from 'react';
import { render, cleanup, act } from '@testing-library/react';
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

function bench(stable: boolean) {
  const view = render(<Harness stable={stable} />);
  // warm up
  for (let i = 0; i < 3; i++) act(() => { view.rerender(<Harness stable={stable} />); });
  const N = 20;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) act(() => { view.rerender(<Harness stable={stable} />); });
  const ms = performance.now() - t0;
  view.unmount();
  cleanup();
  return ms / N;
}

describe('perf: odontogram memo boundary', () => {
  it('is exported memoised', () => {
    expect((Odontogram as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
  });

  it('a parent re-render that does not touch the chart should not cost a chart render', () => {
    const churned = bench(false);
    const stable = bench(true);
    console.log(`[perf] per parent re-render -> stable props: ${stable.toFixed(2)}ms · churning props (pre-fix): ${churned.toFixed(2)}ms`);
    // The gap is ~100x, so this is not a knife-edge timing assertion; it fails
    // if someone reintroduces inline prop objects and the memo silently rots.
    expect(stable).toBeLessThan(churned / 5);
  });
});