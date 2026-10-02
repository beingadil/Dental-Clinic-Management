import React from 'react';
import { Search, Building2, AlertTriangle } from 'lucide-react';
import { DatePickerRange } from '../DatePickerRange';
import { DentalLab } from '../../../types';

export type FilterPillTone = 'default' | 'danger' | 'success';

export interface FilterPill {
  id: string;
  label: string;
  count?: number;
  /** danger = rose alert styling with a warning glyph, success = emerald. */
  tone?: FilterPillTone;
}

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
  clinics?: FilterBarClinics;
  /** View-specific selects rendered after the clinic dropdown (method, ...). */
  extra?: React.ReactNode;
  /** Action buttons grouped with the date range (export, ...). */
  actions?: React.ReactNode;
  pills?: FilterPill[];
  activePill?: string;
  onPillChange?: (id: string) => void;
}

/**
 * Shared filter chrome above the billing tables: a search-first row
 * (search → date range + actions → clinic → extra selects) and the
 * sub-filter pill row. The invoice list and the transaction register
 * render exactly this layout through here.
 */
export function FilterBar({
  search,
  dateRange,
  clinics,
  extra,
  actions,
  pills,
  activePill,
  onPillChange,
}: FilterBarProps) {
  return (
    <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-3">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        {search && (
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
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

        {clinics && (
          <div className="relative w-full md:w-64 shrink-0">
            <Building2 className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={clinics.value}
              onChange={(e) => clinics.onChange(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-medium focus:outline-none focus:border-indigo-500 focus:bg-white transition-all appearance-none cursor-pointer"
            >
              <option value="all">All Clinics ({clinics.labs.length})</option>
              {clinics.labs.map((lab) => (
                <option key={lab.id} value={lab.id}>{lab.name}</option>
              ))}
            </select>
          </div>
        )}

        {extra}
      </div>

      {pills && pills.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 no-scrollbar">
          {pills.map((pill) => {
            const isActive = activePill === pill.id;
            const tone = pill.tone ?? 'default';
            return (
              <button
                key={pill.id}
                onClick={() => onPillChange?.(pill.id)}
                aria-pressed={isActive}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                  isActive
                    ? tone === 'danger'
                      ? 'bg-rose-600 text-white shadow-xs'
                      : tone === 'success'
                      ? 'bg-emerald-700 text-white shadow-xs'
                      : 'bg-slate-900 text-white shadow-xs'
                    : tone === 'danger' && (pill.count ?? 0) > 0
                    ? 'bg-rose-100 text-rose-800 hover:bg-rose-200 font-bold'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tone === 'danger' && (pill.count ?? 0) > 0 && (
                  <AlertTriangle className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-rose-600'}`} />
                )}
                <span>{pill.label}</span>
                <span
                  role="status"
                  aria-live="polite"
                  aria-label={`${pill.label}: ${pill.count ?? 0}`}
                  className={`px-1.5 py-0.2 rounded-md text-[11px] tabular-nums ${
                    isActive ? 'bg-black/20 text-white' : 'bg-white/80 text-slate-700'
                  }`}
                >
                  {pill.count ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
