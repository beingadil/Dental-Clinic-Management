import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Page sizes offered in the size selector. */
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export const DEFAULT_PAGE_SIZE = 25;

export interface UsePaginationResult<T> {
  /** The rows for the current page. Pass this to the table/grid, not `rows`. */
  pageItems: T[];
  /** Current page, 1-based and always within range. */
  page: number;
  /** Total rows across every page. */
  total: number;
  /** Number of pages, at least 1 even when `rows` is empty. */
  totalPages: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  /** Jump back to page 1. */
  reset: () => void;
  /** Ready-to-render footer node; `null` when everything fits on one page. */
  pagination: React.ReactNode;
  /** True when `rows` does not fit in a single page. */
  isPaginated: boolean;
}

export interface UsePaginationOptions {
  initialPageSize?: number;
  /**
   * When this value changes the hook returns to page 1. Pass whatever the
   * view's filters derive from (a search string, a status pill, a date
   * range) so narrowing a filter never strands the user on a dead page.
   */
  resetKey?: unknown;
}

/**
 * Slicing for a long list. Every list view in the app funnels through here so
 * page size, the "showing X–Y of Z" copy and the clamp-on-shrink rule live in
 * one place instead of being re-derived per view.
 *
 * The clamp is deliberately on the render path rather than in an effect: a
 * filter that narrows 300 rows down to 4 must never paint an empty table for a
 * frame before correcting itself.
 */
export function usePagination<T>(rows: T[], options: UsePaginationOptions = {}): UsePaginationResult<T> {
  const { initialPageSize = DEFAULT_PAGE_SIZE, resetKey } = options;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  // A changed filter means a different list; start it from the top.
  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  // Changing the size can strand the reader on page 9 of 3.
  useEffect(() => {
    setPage(1);
  }, [pageSize]);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, safePage, pageSize]);

  const setPageSize = (size: number) => {
    if (!Number.isFinite(size) || size <= 0) return;
    setPageSizeState(Math.round(size));
  };

  const isPaginated = total > pageSize;
  const rangeStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, total);

  const pagination = isPaginated ? (
    <PaginationBar
      page={safePage}
      totalPages={totalPages}
      pageSize={pageSize}
      total={total}
      rangeStart={rangeStart}
      rangeEnd={rangeEnd}
      onPageChange={setPage}
      onPageSizeChange={setPageSize}
    />
  ) : null;

  return {
    pageItems,
    page: safePage,
    total,
    totalPages,
    pageSize,
    setPage,
    setPageSize,
    reset: () => setPage(1),
    pagination,
    isPaginated,
  };
}

/** Page numbers with ellipses, e.g. 1 … 4 5 6 … 12. Always includes first/last. */
export function pageWindow(page: number, totalPages: number): (number | 'gap')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, totalPages, page]);
  for (const d of [1, 2]) {
    if (page - d >= 1) pages.add(page - d);
    if (page + d <= totalPages) pages.add(page + d);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push('gap');
    out.push(p);
    prev = p;
  }
  return out;
}

interface PaginationBarProps {
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
  rangeStart: number;
  rangeEnd: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function PaginationBar({
  page,
  totalPages,
  pageSize,
  total,
  rangeStart,
  rangeEnd,
  onPageChange,
  onPageSizeChange,
}: PaginationBarProps) {
  const go = (next: number) => {
    if (next < 1 || next > totalPages || next === page) return;
    onPageChange(next);
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-3.5 py-2.5 border-t border-slate-200/80 bg-slate-50/60">
      <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium">
        <span role="status" aria-live="polite" className="tabular-nums">
          Showing <span className="font-bold text-slate-700">{rangeStart}</span>–
          <span className="font-bold text-slate-700">{rangeEnd}</span> of{' '}
          <span className="font-bold text-slate-700">{total}</span>
        </span>
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="px-1.5 py-1 text-[11px] bg-white border border-slate-200 rounded-lg text-slate-700 font-semibold cursor-pointer focus:outline-none focus:border-indigo-500"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
        </label>
      </div>

      <nav aria-label="Pagination" className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => go(page - 1)}
          disabled={page === 1}
          aria-label="Previous page"
          className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        {pageWindow(page, totalPages).map((p, i) =>
          p === 'gap' ? (
            <span key={`gap-${i}`} className="px-1 text-[11px] text-slate-400 select-none">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => go(p)}
              aria-current={p === page ? 'page' : undefined}
              aria-label={`Page ${p}`}
              className={`min-w-[1.75rem] px-1.5 py-1.5 rounded-lg text-[11px] font-bold tabular-nums transition-colors cursor-pointer ${
                p === page
                  ? 'bg-brand-600 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {p}
            </button>
          )
        )}

        <button
          type="button"
          onClick={() => go(page + 1)}
          disabled={page === totalPages}
          aria-label="Next page"
          className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </nav>
    </div>
  );
}