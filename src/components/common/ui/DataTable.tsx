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
  /** Rendered inside the card, below the table (e.g. "show more" bar). */
  footer?: React.ReactNode;
  wrapperClassName?: string;
}

const ALIGN = {
  left: '',
  center: 'text-center',
  right: 'text-right',
} as const;

/**
 * Shared list table for the billing views — styled header row,
 * horizontal-scroll wrapper, optional bulk-selection column, and
 * empty-state/footer slots. Cell content stays view-specific via
 * `columns[].render`.
 */
export function DataTable<T>({
  columns,
  data,
  rowKey,
  rowClassName,
  selection,
  emptyState,
  footer,
  wrapperClassName,
}: DataTableProps<T>) {
  return (
    <div
      className={
        wrapperClassName ??
        'bg-white border border-slate-200/80 rounded-2xl shadow-2xs overflow-hidden'
      }
    >
      {data.length === 0 ? (
        emptyState ?? null
      ) : (
        <>
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200/80 font-bold uppercase text-[11px] text-slate-500 tracking-wider">
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
                      className={`py-2 px-3 ${ALIGN[col.align ?? 'left']} ${col.className ?? ''}`}
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
                          className={`py-2 px-3 ${ALIGN[col.align ?? 'left']} ${col.className ?? ''}`}
                        >
                          {col.render(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {footer}
        </>
      )}
    </div>
  );
}
