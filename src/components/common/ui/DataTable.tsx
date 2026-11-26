import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, Square } from 'lucide-react';

/** One column of a {@link DataTable}. */
export interface DataTableColumn<T> {
  header: React.ReactNode;
  /** Alignment applied to both the header cell and every body cell. */
  align?: 'left' | 'center' | 'right';
  /** Extra classes for the body cells (the header keeps its own style). */
  className?: string;
  render: (row: T) => React.ReactNode;
}

/** State for the optional bulk-selection checkbox column. */
export interface DataTableSelection {
  selectedIds: string[];
  allSelected: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}

/** Opt-in row windowing for tables that can carry thousands of rows. */
export interface DataTableVirtualization {
  /** Initial row height before the real row has been measured. */
  rowHeight?: number;
  /** Extra rows above and below the viewport. */
  overscan?: number;
  /** CSS max-height of the scrolling body. */
  maxHeight?: string | number;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  /** Click anywhere on a row (e.g. open the voucher receipt). */
  onRowClick?: (row: T) => void;
  /** Extra row classes (status tint, reversal highlight, ...). */
  rowClassName?: (row: T) => string;
  selection?: DataTableSelection;
  emptyState?: React.ReactNode;
  /**
   * Rendered INSIDE the `<table>`, as its `<tfoot>` — totals rows that are part
   * of the table rather than chrome below it.
   *
   * `footer` cannot do this job: it lands after `</table>`, so a `<tfoot>` put
   * there is invalid markup and has to be faked by wrapping it in a second
   * one-row `<table>`. That hack left the totals row's columns laid out
   * independently of the columns above, so they drifted out of alignment. One
   * monthly report's total row is also asserted by a test as
   * `within(table).getByText(...)`, which `footer` can never satisfy — that
   * table stayed hand-rolled for exactly this reason.
   *
   * Pass the `<tr>`s (or a whole `<tfoot>`); they render as given.
   */
  tfoot?: React.ReactNode;
  /** Rendered below the table, outside it (e.g. "show more" bar). */
  footer?: React.ReactNode;
  /**
   * Freeze the first column.
   *
   * For the tables that carry more columns than a screen can show: the
   * clinic name stays put while the money scrolls, so a row can still be
   * read against the figure the operator is looking at.
   *
   * A `<tfoot>` is caller-supplied, so its first cell needs the same
   * treatment by hand — `ds-sticky-col`, with an opaque background, or the
   * totals row slides under the frozen column instead of lining up with it.
   */
  stickyFirstColumn?: boolean;
  /** Render only the rows near the viewport. Omit for normal tables. */
  virtualize?: DataTableVirtualization;
}

const ALIGN = {
  left: '',
  center: 'text-center',
  right: 'text-right',
} as const;

/**
 /**
 * Shared list table for the billing views — header row, horizontal-scroll
 * wrapper, optional bulk-selection column, and empty-state/footer slots. Cell
 * content stays view-specific via `columns[].render`.
 *
 * WHY THIS RENDERS A BARE TABLE AND NOT A CARD
 * It used to draw its own `bg-white border rounded-2xl shadow` wrapper, which
 * is why it was only usable in one place. Every other table in the app already
 * sits inside a card its own view owns, so dropping this component in as-is
 * produced a white card inside a white card — doubled hairline, doubled
 * shadow, and a 16px radius fighting the view's 12px. That mismatch, plus the
 * bespoke padding on each cell, is what kept it a 1-of-19 orphan.
 *
 * So the primitive now owns the TABLE and nothing else, and the one existing
 * caller (`BillingView`) keeps its card where it already had one. That makes it
 * safe to adopt anywhere without a visual decision to re-litigate per call.
 */
/**
 * Memoized: the heavy tables mount hundreds of rows, and a parent re-render
 * that only swaps a filter shouldn't force the whole table to reconcile.
 */
export const DataTable = React.memo(DataTableInner) as typeof DataTableInner;

function DataTableInner<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  rowClassName,
  selection,
  emptyState,
  tfoot,
  footer,
  stickyFirstColumn = false,
  virtualize,
}: DataTableProps<T>) {
  const virtual = !!virtualize;
  const estimate = virtualize?.rowHeight ?? 88;
  const overscan = virtualize?.overscan ?? 8;
  const scrollRef = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const pendingMeasure = useRef(false);
  const measureRaf = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const [measureVersion, setMeasureVersion] = useState(0);

  const keys = useMemo(() => (virtual ? data.map(rowKey) : []), [data, rowKey, virtual]);

  useEffect(() => {
    if (!virtual) return;
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewport(el.clientHeight || 600);
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [virtual, virtualize?.maxHeight]);

  useEffect(() => () => {
    if (measureRaf.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(measureRaf.current);
    }
  }, []);

  useEffect(() => {
    if (!virtual) return;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [data, virtual]);

  const offsets = useMemo(() => {
    if (!virtual) return [0];
    const next = new Array<number>(data.length + 1);
    next[0] = 0;
    for (let i = 0; i < data.length; i++) {
      next[i + 1] = next[i] + (heights.current.get(keys[i]) ?? estimate);
    }
    return next;
  }, [virtual, data.length, keys, estimate, measureVersion]);

  let start = 0;
  let end = data.length;
  if (virtual && data.length > 0) {
    const bottom = scrollTop + Math.max(viewport, estimate);
    let lo = 0;
    let hi = data.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= scrollTop) lo = mid;
      else hi = mid - 1;
    }
    start = Math.max(0, Math.min(lo, data.length - 1) - overscan);
    lo = start;
    hi = data.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid] < bottom) lo = mid + 1;
      else hi = mid;
    }
    end = Math.min(data.length, lo + overscan);
    if (end <= start) end = Math.min(data.length, start + 1);
  }

  const visibleRows = virtual ? data.slice(start, end) : data;
  const topPad = virtual ? offsets[start] : 0;
  const bottomPad = virtual ? Math.max(0, offsets[data.length] - offsets[end]) : 0;

  const measureRow = (el: HTMLTableRowElement | null) => {
    if (!virtual || !el) return;
    const index = Number(el.dataset.index);
    const key = keys[index];
    if (!key) return;
    const height = el.getBoundingClientRect().height;
    if (height <= 0 || Math.abs((heights.current.get(key) ?? 0) - height) <= 0.5) return;
    heights.current.set(key, height);
    if (pendingMeasure.current) return;
    pendingMeasure.current = true;
    const schedule = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0);
    measureRaf.current = schedule(() => {
      pendingMeasure.current = false;
      measureRaf.current = null;
      setMeasureVersion((version) => version + 1);
    }) as unknown as number;
  };

  if (data.length === 0) return <>{emptyState ?? null}</>;

  /* The frozen column, when there is one. The header cell goes on top of the
     body cells as they slide under it. */
  const stickyHead = stickyFirstColumn ? 'ds-sticky-col ds-sticky-col-head' : '';
  const stickyBody = stickyFirstColumn ? 'ds-sticky-col' : '';

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={virtual ? (event) => setScrollTop(event.currentTarget.scrollTop) : undefined}
        style={virtual ? { maxHeight: virtualize?.maxHeight ?? '70vh' } : undefined}
        className={virtual ? 'overflow-auto' : 'overflow-x-auto no-scrollbar'}
      >
        <table className="w-full text-left border-collapse text-xs" aria-rowcount={virtual ? data.length + 1 : undefined}>
          <thead className={virtual ? 'sticky top-0 z-10' : undefined}>
            <tr className="ds-th">
              {selection && (
                <th scope="col" className="py-2 px-3 w-10">
                  <button onClick={selection.onToggleAll} className="p-1 text-slate-500 cursor-pointer">
                    {selection.allSelected ? (
                      <CheckSquare className="w-4 h-4 text-indigo-600" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-300" />
                    )}
                  </button>
                </th>
              )}
              {columns.map((col, i) => (
                <th
                  key={i}
                  scope="col"
                  className={`py-2 px-3 ${ALIGN[col.align ?? 'left']} ${col.className ?? ''} ${
                    i === 0 ? stickyHead : ''
                  }`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-medium">
            {topPad > 0 && (
              <tr aria-hidden="true">
                <td colSpan={columns.length + (selection ? 1 : 0)} style={{ height: topPad, padding: 0, border: 0 }} />
              </tr>
            )}
            {visibleRows.map((row, index) => {
              const dataIndex = virtual ? start + index : index;
              const id = rowKey(row);
              const isSelected = selection ? selection.selectedIds.includes(id) : false;
              return (
                <tr
                  key={id}
                  ref={virtual ? measureRow : undefined}
                  data-index={virtual ? dataIndex : undefined}
                  aria-rowindex={virtual ? dataIndex + 2 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`${onRowClick ? 'cursor-pointer' : ''} hover:bg-slate-50/80 transition-colors ${rowClassName?.(row) ?? ''} ${
                    isSelected ? 'bg-indigo-50/40' : ''
                  }`}
                >
                  {selection && (
                    <td className="py-2 px-3">
                      <button onClick={() => selection.onToggle(id)} className="p-1 cursor-pointer">
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-indigo-600" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-300" />
                        )}
                      </button>
                    </td>
                  )}
                  {columns.map((col, i) => (
                    <td
                      key={i}
                      className={`py-2 px-3 ${ALIGN[col.align ?? 'left']} ${col.className ?? ''} ${
                        i === 0 ? stickyBody : ''
                      }`}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {bottomPad > 0 && (
              <tr aria-hidden="true">
                <td colSpan={columns.length + (selection ? 1 : 0)} style={{ height: bottomPad, padding: 0, border: 0 }} />
              </tr>
            )}
          </tbody>
          {tfoot && <tfoot className={virtual ? 'sticky bottom-0 z-10 bg-white' : undefined}>{tfoot}</tfoot>}
        </table>
      </div>
      {footer}
    </>
  );
}
