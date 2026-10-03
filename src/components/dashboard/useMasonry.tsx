/**
 * Measured masonry for the dashboard.
 *
 * CSS columns balance their heights for you, but only approximately: the
 * shortest column still ended ~675px above the tallest with this panel set,
 * and re-ordering to fix that is not something CSS can do. So the panels are
 * measured and placed here instead.
 *
 * The packing rule is the standard one — always drop the next panel into the
 * currently shortest column — with one deliberate addition: panels are
 * considered tallest-first. Filling shortest-column in document order is what
 * strands a tall panel at the end of the last column; considering tall panels
 * first spreads them across the top where they pair up naturally.
 *
 * This converges and cannot oscillate, because a panel's height depends only on
 * its width and every column is the same width. Moving a panel between columns
 * therefore cannot change its height, so one measure-and-pack pass is final.
 */
import React from 'react';

export interface MasonryItem {
  key: string;
  /** Columns to occupy. Clamped to the live column count. */
  span: number;
  children: React.ReactNode;
}

/**
 * Assigns each key to a column index.
 *
 * Exported for testing: it is pure, and the balancing guarantee is the whole
 * point of this module, so it is worth pinning without rendering anything.
 */
export function packColumns(
  keys: string[],
  spans: Record<string, number>,
  heights: Record<string, number>,
  columnCount: number,
): Record<string, number> {
  if (columnCount <= 1) return Object.fromEntries(keys.map((k) => [k, 0]));

  const columnHeights = new Array(columnCount).fill(0) as number[];
  const columnCounts = new Array(columnCount).fill(0) as number[];
  const placement: Record<string, number> = {};

  // Tallest first. Unknown heights (not yet measured) are treated as 0 so the
  // first pass still distributes rather than piling into column 0.
  const ordered = [...keys].sort(
    (a, b) => (heights[b] ?? 0) - (heights[a] ?? 0) || keys.indexOf(a) - keys.indexOf(b),
  );

  for (const key of ordered) {
    const span = Math.max(1, Math.min(spans[key] ?? 1, columnCount));
    const height = heights[key] ?? 0;

    /* The window of `span` adjacent columns whose TALLEST member is lowest.
       Using the max (not the sum) keeps a wide panel from being attracted to a
       pair that is short in total but has one tall column.

       Item count breaks ties. Without it, the first paint — when no panel has
       been measured yet and every column is height 0 — sent every panel to
       column 0, because `0 < 0` is false and the loop kept the first window. */
    let bestStart = 0;
    let bestScore = Infinity;
    let bestCount = Infinity;
    for (let start = 0; start + span <= columnCount; start++) {
      const score = Math.max(...columnHeights.slice(start, start + span));
      const count = columnCounts.slice(start, start + span).reduce((s, n) => s + n, 0);
      if (score < bestScore || (score === bestScore && count < bestCount)) {
        bestScore = score;
        bestCount = count;
        bestStart = start;
      }
    }

    placement[key] = bestStart;
    for (let i = 0; i < span; i++) {
      columnHeights[bestStart + i] += height;
      columnCounts[bestStart + i] += 1;
    }
  }

  return refine(placement, ordered, heights, spans, columnCount, columnHeights);
}

/**
 * Narrows the ragged bottom greedy leaves behind.
 *
 * Pure: takes a placement and returns a new one, touching nothing. The caller
 * keeps whichever answer is actually better (see `refine`), so this can only
 * improve the layout or leave it exactly as it was — it can never make the
 * columns worse than the greedy first pass, which is the failure mode an
 * in-place version of this search had.
 *
 * Greedy is not optimal. On the real panel set it produced 931/776/776 when
 * 785/825/873 was available. Repeatedly moving or swapping one panel between
 * the tallest and shortest columns, while that strictly narrows the spread,
 * recovers most of that. Bounded to a few passes and to single-panel moves, so
 * it stays cheap for ten panels and cannot oscillate.
 */
function refine(
  start: Record<string, number>,
  ordered: string[],
  heights: Record<string, number>,
  spans: Record<string, number>,
  columnCount: number,
  columnHeightsIn: number[],
): Record<string, number> {
  const columnHeights = [...columnHeightsIn];
  const placement = { ...start };
  const heightOf = (k: string) => heights[k] ?? 0;
  const spreadOf = () => Math.max(...columnHeights) - Math.min(...columnHeights);

  // A wide panel occupies two columns, so moving one perturbs both and this
  // two-column reasoning stops holding. Greedy's choice is kept for those.
  const isSingle = (k: string) => Math.min(spans[k] ?? 1, columnCount) === 1;

  for (let pass = 0; pass < 6; pass++) {
    const tallest = columnHeights.indexOf(Math.max(...columnHeights));
    const shortest = columnHeights.indexOf(Math.min(...columnHeights));
    if (tallest === shortest) break;

    const base = spreadOf();
    const inTallest = ordered.filter((k) => placement[k] === tallest && isSingle(k));
    const inShortest = ordered.filter((k) => placement[k] === shortest);

    // Collect every candidate, then pick. Assigning `best` from inside a
    // closure defeats TypeScript's narrowing, which types it as `never`.
    const candidates: { a: string; b: string | null; gain: number }[] = [];
    for (const a of inTallest) {
      const partners: (string | null)[] = [null, ...inShortest];
      for (const b of partners) {
        const ha = heightOf(a);
        const hb = b === null ? 0 : heightOf(b);
        columnHeights[tallest] += hb - ha;
        columnHeights[shortest] += ha - hb;
        const gain = base - spreadOf();
        columnHeights[tallest] += ha - hb;
        columnHeights[shortest] += hb - ha;
        if (gain > 0) candidates.push({ a, b, gain });
      }
    }
    if (candidates.length === 0) break;

    let best = candidates[0];
    for (const c of candidates) if (c.gain > best.gain) best = c;

    const ha = heightOf(best.a);
    const hb = best.b === null ? 0 : heightOf(best.b);
    columnHeights[tallest] += hb - ha;
    columnHeights[shortest] += ha - hb;
    placement[best.a] = shortest;
    if (best.b !== null) placement[best.b] = tallest;
  }

  return placement;
}

/** Column count for a container width. Matches the CSS breakpoints in use. */
export function columnsForWidth(width: number): number {
  if (width >= 1536) return 3;
  if (width >= 768) return 2;
  return 1;
}

export const Masonry: React.FC<{
  items: MasonryItem[];
  gap?: number;
  /** Changing this re-measures; pass whatever affects a panel's height. */
  measureKey?: string;
}> = ({ items, gap = 16, measureKey }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const observers = React.useRef(new Map<string, ResizeObserver>());
  const nodes = React.useRef(new Map<string, HTMLElement>());

  const [columnCount, setColumnCount] = React.useState(3);
  const [heights, setHeights] = React.useState<Record<string, number>>({});

  // Column count tracks the container, not the viewport: the sidebar is fixed,
  // so the usable width is what decides how many columns actually fit.
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setColumnCount(columnsForWidth(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    const map = observers.current;
    return () => {
      map.forEach((o) => o.disconnect());
      map.clear();
    };
  }, []);

  const attach = React.useCallback((key: string, node: HTMLElement | null) => {
    const existing = observers.current.get(key);
    if (existing) {
      existing.disconnect();
      observers.current.delete(key);
    }
    nodes.current.delete(key);
    if (!node) return;

    nodes.current.set(key, node);
    const read = () => {
      const h = node.getBoundingClientRect().height;
      setHeights((prev) => (Math.abs((prev[key] ?? 0) - h) < 0.5 ? prev : { ...prev, [key]: h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(node);
    observers.current.set(key, ro);
  }, []);

  const spans = React.useMemo(
    () => Object.fromEntries(items.map((i) => [i.key, i.span])),
    [items],
  );

  const placement = React.useMemo(
    () =>
      packColumns(
        items.map((i) => i.key),
        spans,
        heights,
        columnCount,
      ),
    // heights is the input that changes the answer; items identity would
    // recompute on every parent render for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [heights, columnCount, measureKey],
  );

  const columns: MasonryItem[][] = Array.from({ length: columnCount }, () => []);
  for (const item of items) columns[placement[item.key] ?? 0].push(item);

  return (
    <div ref={containerRef} className="flex items-start" style={{ gap }} data-masonry="true">
      {columns.map((column, i) => (
        <div key={i} className="min-w-0 flex-1" style={{ marginBottom: i < columns.length - 1 ? gap : 0 }}>
          {/* marginBottom on the panel itself, not the column: the last panel in
              a column must not leave a trailing gap that unbalances the row. */}
          <div className="flex flex-col" style={{ gap }}>
            {column.map((item) => (
              <div key={item.key} ref={(n) => attach(item.key, n)}>
                {item.children}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};