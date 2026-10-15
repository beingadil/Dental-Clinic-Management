import React from 'react';
import { Search } from 'lucide-react';
import { DatePickerRange } from '../DatePickerRange';
import { DentalLab } from '../../../types';

export interface FilterBarSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export interface FilterBarDateRange {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

export interface FilterBarClinics {
  labs: DentalLab[];
  value: string;
  onChange: (labId: string) => void;
}

interface FilterBarProps {
  search?: FilterBarSearch;
  dateRange?: FilterBarDateRange;
  /** Action buttons grouped with the date range (export, ...). */
  actions?: React.ReactNode;
}

/**
 * The one filter band above a billing list: search, date range + actions, clinic.
 *
 * This used to carry a second row of sub-filter pills. They were removed along
 * with the payments register's own copy of this whole bar: a status or category
 * is something the operator reads off the rows and the counts on the dashboard,
 * not a control they reset before every glance, and two stacked filter bands
 * above two tables made the page look like two pages.
 */
export function FilterBar({
  search,
  dateRange,
  actions,
}: FilterBarProps) {
  return (
    <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        {search && (
          <div className="relative flex-1 min-w-[260px] basis-full md:basis-auto">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              type="text"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500"
            />
          </div>
        )}

        {(dateRange || actions) && (
          <div className="flex items-center gap-2 shrink-0">
            {dateRange && (
              <DatePickerRange
                from={dateRange.from}
                to={dateRange.to}
                onChange={dateRange.onChange}
              />
            )}
            {actions}
          </div>
        )}

      </div>
    </div>
  );
}
