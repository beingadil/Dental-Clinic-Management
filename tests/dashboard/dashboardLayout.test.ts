/**
 * Layout logic.
 *
 * Both halves of this are pure functions on purpose: the packer's balancing
 * guarantee and the preference round-trip are the parts that would be painful
 * to debug through the DOM, and neither needs a browser to verify.
 */
import { describe, it, expect } from 'vitest';
import { packColumns, columnsForWidth } from '../../src/components/dashboard/useMasonry';
import { parsePrefs, orderPanels, visiblePanels, type PanelPrefs } from '../../src/components/dashboard/useDashboardLayout';

const KEYS = ['a', 'b', 'c', 'd', 'e', 'f'];

/** Total height a column ends up with. A wide panel counts toward EVERY column
 *  it spans — that is the whole point of a span — so this mirrors the packer. */
const columnHeights = (
  placement: Record<string, number>,
  heights: Record<string, number>,
  cols: number,
  spans: Record<string, number> = {},
) => {
  const out = new Array(cols).fill(0) as number[];
  for (const [k, col] of Object.entries(placement)) {
    const span = Math.max(1, Math.min(spans[k] ?? 1, cols));
    for (let i = 0; i < span; i++) out[col + i] += heights[k] ?? 0;
  }
  return out;
};

describe('packColumns', () => {
  it('puts every panel in one column when there is only one', () => {
    const p = packColumns(KEYS, {}, {}, 1);
    expect(Object.values(p)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('fills the shortest column, which balances the row', () => {
    // a is enormous. It cannot be split, so a perfectly even row is impossible;
    // what greedy can guarantee is that the remaining slack is spread, not
    // dumped on one column. 600 + five 200s over three columns floors at
    // 600/600/400.
    const heights = { a: 600, b: 200, c: 200, d: 200, e: 200, f: 200 };
    const p = packColumns(KEYS, {}, heights, 3);
    const [h0, h1, h2] = columnHeights(p, heights, 3);
    expect(Math.max(h0, h1, h2) - Math.min(h0, h1, h2)).toBeLessThanOrEqual(200);
    // No column is left short while another holds nothing.
    expect(Math.min(h0, h1, h2)).toBeGreaterThanOrEqual(400);
  });

  it('pairs tall panels across columns rather than stacking them', () => {
    const heights = { a: 500, b: 500, c: 500, d: 50, e: 50, f: 50 };
    const p = packColumns(KEYS, {}, heights, 3);
    const tall = ['a', 'b', 'c'].map((k) => p[k]);
    expect(new Set(tall).size).toBe(3);
  });

  it('beats the greedy pass it starts from', () => {
    // The refinement pass exists because shortest-column greedy is not optimal.
    // This is the exact set that exposed it: greedy settles at 520/490/440, and
    // the search should pull that down further.
    const heights = { a: 310, b: 280, c: 250, d: 190, e: 150, f: 120, g: 90, h: 60 };
    const keys = Object.keys(heights);
    const hs = columnHeights(packColumns(keys, {}, heights, 3), heights, 3);
    expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(45);
  });

  it('never returns a layout worse than greedy on the real panel set', () => {
    const heights = {
      quickActions: 324, recentActivity: 306, revenue: 303, todaySchedule: 257,
      needsAttention: 254, labPerformance: 238, productionWorkflow: 216,
      casesAtRisk: 216, workload: 207, upcoming: 162,
    };
    const keys = Object.keys(heights);
    const hs = columnHeights(packColumns(keys, {}, heights, 3), heights, 3);
    expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(20);
  });

  it('keeps every column within one panel height of the others', () => {
    const heights = { a: 310, b: 280, c: 250, d: 190, e: 150, f: 120, g: 90, h: 60 };
    const keys = Object.keys(heights);
    const p = packColumns(keys, {}, heights, 3);
    const hs = columnHeights(p, heights, 3);
    expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(310);
  });

  it('clamps a span wider than the available columns', () => {
    const p = packColumns(['a'], { a: 99 }, { a: 100 }, 2);
    expect(p.a).toBe(0);
  });

  it('lets a wide panel claim two columns at once', () => {
    const heights = { wide: 400, x: 100, y: 100, z: 100 };
    const p = packColumns(['wide', 'x', 'y', 'z'], { wide: 2 }, heights, 3);
    const hs = columnHeights(p, heights, 3, { wide: 2 });
    // The wide panel's height lands on BOTH the columns it spans.
    expect(hs.filter((h) => h >= 400).length).toBeGreaterThanOrEqual(2);
  });

  it('distributes evenly before any height is known', () => {
    // First paint, nothing measured: every column is height 0, so the tie-break
    // has to be item count or the whole grid lands in column 0.
    const p = packColumns(KEYS, {}, {}, 3);
    expect(Object.values(p)).toEqual([0, 1, 2, 0, 1, 2]);
  });
});

describe('columnsForWidth', () => {
  it('follows the breakpoints the layout already used', () => {
    expect(columnsForWidth(500)).toBe(1);
    expect(columnsForWidth(900)).toBe(2);
    expect(columnsForWidth(1600)).toBe(3);
  });
});

describe('parsePrefs', () => {
  it('returns defaults for a user who has never saved', () => {
    expect(parsePrefs(undefined, KEYS)).toEqual({ pinned: [], hidden: [], wide: [] });
  });

  it('drops panels this build does not know about', () => {
    const stale = { pinned: ['a', 'removed_panel'], hidden: ['gone'], wide: ['b'] };
    expect(parsePrefs(stale, KEYS)).toEqual({ pinned: ['a'], hidden: [], wide: ['b'] });
  });

  it('survives a corrupted or wrongly-typed blob', () => {
    expect(parsePrefs({ pinned: 'not-an-array' }, KEYS)).toEqual({ pinned: [], hidden: [], wide: [] });
    expect(parsePrefs({ hidden: [1, 2, 'c'] }, KEYS)).toEqual({ pinned: [], hidden: ['c'], wide: [] });
  });
});

describe('orderPanels', () => {
  const prefs = (p: Partial<PanelPrefs>): PanelPrefs => ({ pinned: [], hidden: [], wide: [], ...p });

  it('puts pinned panels first, in the order they were pinned', () => {
    expect(orderPanels(KEYS, prefs({ pinned: ['d', 'a'] }))).toEqual(['d', 'a', 'b', 'c', 'e', 'f']);
  });

  it('keeps canonical order for everything unpinned', () => {
    expect(orderPanels(KEYS, prefs({}))).toEqual(KEYS);
  });

  it('ignores a pin for a panel that no longer exists', () => {
    expect(orderPanels(KEYS, prefs({ pinned: ['nope'] }))).toEqual(KEYS);
  });
});

describe('visiblePanels', () => {
  const prefs = (p: Partial<PanelPrefs>): PanelPrefs => ({ pinned: [], hidden: [], wide: [], ...p });

  it('removes hidden panels and widens the marked ones', () => {
    const { keys, spans } = visiblePanels(KEYS, prefs({ hidden: ['b'], wide: ['a'] }));
    expect(keys).not.toContain('b');
    expect(spans.a).toBe(2);
    expect(spans.c).toBe(1);
  });

  it('hides every panel without crashing when asked to', () => {
    const { keys } = visiblePanels(KEYS, prefs({ hidden: KEYS }));
    expect(keys).toEqual([]);
  });
});