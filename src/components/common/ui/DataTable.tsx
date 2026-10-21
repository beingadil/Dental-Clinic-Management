import React from 'react';
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

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
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
export function DataTable<T>({
  columns,
  data,
  rowKey,
  rowClassName,
  selection,
  emptyState,
  tfoot,
  footer,
  stickyFirstColumn = false,
}: DataTableProps<T>) {
  if (data.length === 0) return <>{emptyState ?? null}</>;

  /* The frozen column, when there is one. The header cell goes on top of the
     body cells as they slide under it. */
  const stickyHead = stickyFirstColumn ? 'ds-sticky-col ds-sticky-col-head' : '';
  const stickyBody = stickyFirstColumn ? 'ds-sticky-col' : '';

  return (
    <>
      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
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
            {data.map((row) => {
              const id = rowKey(row);
              const isSelected = selection ? selection.selectedIds.includes(id) : false;
              return (
                <tr
                  key={id}
                  className={`hover:bg-slate-50/80 transition-colors ${rowClassName?.(row) ?? ''} ${
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
          </tbody>
          {tfoot && <tfoot>{tfoot}</tfoot>}
        </table>
      </div>
      {footer}
    </>
  );
}
