import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Search, X } from 'lucide-react';
import type { DentalLab } from '../../../types';
import { formatDoctorName } from '../../../utils/doctorName';

/**
 * A searchable, MULTI-select clinic chooser.
 *
 * The single-select ClinicPicker is right for "which one clinic is this?".
 * A statement wants the opposite question: "which clinics is this report
 * about?" — and the answer is usually a handful out of many, chosen by
 * whoever is reading it, with the rest left out on purpose.
 *
 * So this is a checklist, not a picker: the panel stays open, every clinic
 * is listed with a checkbox, and there is no implicit "one choice wins".
 * "All clinics" and "None" are the two ends of it, and the trigger says
 * plainly how many are in scope, because a filter whose effect is invisible
 * is a filter nobody trusts.
 *
 * Searchable on name, doctor, city, code and phone — the same fields the
 * single-select searches, so an operator who knows a clinic by its doctor
 * finds it here too.
 */

export interface ClinicFilterProps {
  clinics: DentalLab[];
  /** Chosen clinic ids. Empty means "none chosen", which is NOT the same as "all". */
  selected: string[];
  onChange: (clinicIds: string[]) => void;
  /** Label on the closed trigger when nothing is chosen. */
  placeholder?: string;
  /** Shown when the filter matches nothing. `name` is the live query. */
  emptyLabel?: (name: string) => string;
  tone?: 'blue' | 'indigo';
  className?: string;
}

const TONES = {
  blue: {
    open: 'border-blue-500 ring-2 ring-blue-100 bg-white',
    filterFocus: 'focus:border-blue-500',
    check: 'text-ink-info',
    chip: 'bg-blue-50 text-blue-900',
  },
  indigo: {
    open: 'border-indigo-500 ring-2 ring-indigo-100 bg-white',
    filterFocus: 'focus:border-indigo-500',
    check: 'text-indigo-600',
    chip: 'bg-indigo-50 text-indigo-900',
  },
} as const;

export const ClinicFilter: React.FC<ClinicFilterProps> = ({
  clinics,
  selected,
  onChange,
  placeholder = 'All clinics',
  emptyLabel = (q) => `No saved clinic matching "${q}"`,
  tone = 'blue',
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = TONES[tone];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clinics;
    return clinics.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.doctor_name && formatDoctorName(c.doctor_name).toLowerCase().includes(q)) ||
        (c.city && c.city.toLowerCase().includes(q)) ||
        (c.code && c.code.toLowerCase().includes(q)) ||
        (c.phone && c.phone.toLowerCase().includes(q)),
    );
  }, [clinics, query]);

  const chosen = useMemo(() => new Set(selected), [selected]);
  const allChosen = clinics.length > 0 && selected.length === clinics.length;

  const toggle = (clinicId: string) => {
    onChange(
      chosen.has(clinicId) ? selected.filter((id) => id !== clinicId) : [...selected, clinicId],
    );
  };

  const triggerText = (() => {
    if (selected.length === 0) return placeholder;
    if (allChosen) return `All ${clinics.length} clinics`;
    if (selected.length === 1) {
      const only = clinics.find((c) => c.id === selected[0]);
      return only ? only.name : '1 clinic';
    }
    return `${selected.length} of ${clinics.length} clinics`;
  })();

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Filter by dental clinic"
        tabIndex={0}
        onClick={() => {
          setOpen((v) => !v);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
            requestAnimationFrame(() => inputRef.current?.focus());
          }
        }}
        className={`w-full border rounded-xl flex items-center justify-between gap-2 cursor-pointer transition-all p-2.5 ${
          open ? t.open : 'border-slate-300 bg-white hover:bg-slate-50'
        }`}
      >
        <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
          <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
          <span
            className={`text-xs font-bold truncate ${selected.length ? 'text-slate-900' : 'text-ink-muted'}`}
          >
            {triggerText}
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-500 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}
        />
      </div>

      {open && (
        <div className="absolute left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-2">
          <div className="p-1.5 border-b border-slate-100 mb-1">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type to filter clinics…"
                aria-label="Filter clinics"
                className={`w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none ${t.filterFocus}`}
              />
            </div>
          </div>

          {/* The two ends of the range, in one place, so "everything" and
              "nothing" are one click rather than a long unchecking. */}
          <div className="flex items-center gap-1.5 px-1 pb-1.5">
            <button
              type="button"
              onClick={() => onChange(clinics.map((c) => c.id))}
              className="px-2 py-1 text-[11px] font-bold rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              className="px-2 py-1 text-[11px] font-bold rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
            >
              Clear
            </button>
            <span className="ml-auto text-[11px] text-ink-muted tabular-nums">
              {selected.length} of {clinics.length}
            </span>
          </div>

          <div role="listbox" aria-multiselectable="true" className="max-h-64 overflow-y-auto space-y-0.5">
            {filtered.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500">{emptyLabel(query)}</div>
            ) : (
              filtered.map((clinic) => {
                const isSelected = chosen.has(clinic.id);
                return (
                  <button
                    key={clinic.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => toggle(clinic.id)}
                    className={`w-full text-left p-2 rounded-lg text-xs transition-colors flex items-start gap-2.5 ${
                      isSelected ? 'bg-slate-50' : 'hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    <span
                      className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center ${
                        isSelected ? `border-transparent ${t.chip}` : 'border-slate-300 bg-white'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 pr-2 flex-1">
                      <span className="font-bold text-slate-900 truncate block">{clinic.name}</span>
                      {(clinic.doctor_name || clinic.city || clinic.phone) && (
                        <span className="text-[11px] text-slate-500 font-normal flex items-center gap-2 mt-0.5 truncate">
                          {clinic.doctor_name && <span>{formatDoctorName(clinic.doctor_name)}</span>}
                          {clinic.city && <span>&bull; {clinic.city}</span>}
                          {clinic.phone && <span>&bull; {clinic.phone}</span>}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 mt-1 pt-1.5 px-1">
            <span className="text-[11px] text-ink-muted">
              {selected.length ? `${selected.length} selected` : 'Showing every clinic'}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-2 py-1 text-[11px] font-bold rounded-md text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer inline-flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClinicFilter;
