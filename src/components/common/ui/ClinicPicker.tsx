import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ChevronDown, CheckCircle2 } from 'lucide-react';
import type { DentalLab } from '../../../types';
import { formatDoctorName } from '../../../utils/doctorName';

/**
 * A searchable clinic chooser.
 *
 * This exists because a `<select>` of every clinic stops being usable the moment
 * a practice has more than a handful — the operator has to scroll a list to
 * find the one they already know the name of, and they often know it by doctor or
 * city rather than by the name the app stores. The General Ledger and the batch
 * print dialog both needed this, and each grew its own copy before a third
 * surface (the payment recorder) wanted one too; one component, three callers.
 *
 * Searchable on name, doctor, city, code and phone — a front desk identifying a
 * patient by any of those should find the clinic.
 */

export interface ClinicPickerProps {
  clinics: DentalLab[];
  /** Selected clinic id, or null for "nothing chosen yet". */
  value: string | null;
  onChange: (clinicId: string) => void;
  /** Text on the closed trigger when nothing is selected. */
  placeholder?: string;
  /** Shown when the filter matches nothing. `name` is the live query. */
  emptyLabel?: (name: string) => string;
  /** Accent for the open trigger and the selected row. */
  tone?: 'blue' | 'indigo';
  /** `true` for the full-height filter-bar variant, `false` for a form field. */
  compact?: boolean;
  id?: string;
  className?: string;
}

const TONES = {
  blue: {
    open: 'border-blue-500 ring-2 ring-blue-100 bg-white',
    filterFocus: 'focus:border-blue-500',
    selected: 'bg-blue-50 text-blue-900 font-bold',
    check: 'text-ink-info',
  },
  indigo: {
    open: 'border-indigo-500 ring-2 ring-indigo-100 bg-white',
    filterFocus: 'focus:border-indigo-500',
    selected: 'bg-indigo-50 text-indigo-900 font-bold',
    check: 'text-indigo-600',
  },
} as const;

export const ClinicPicker: React.FC<ClinicPickerProps> = ({
  clinics,
  value,
  onChange,
  placeholder = 'Select clinic…',
  emptyLabel = (q) => `No saved clinic matching "${q}"`,
  tone = 'blue',
  compact = false,
  id,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = TONES[tone];

  const selected = clinics.find((c) => c.id === value) ?? null;

  /* Closes on an outside click so it behaves like a real picker rather than a
     panel that stays open until something is chosen. */
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

  const pick = (clinicId: string) => {
    onChange(clinicId);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Select dental clinic"
        tabIndex={0}
        onClick={() => {
          setOpen(true);
          // Let the panel mount before focusing, or the input never receives it.
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }
        }}
        className={`w-full rounded-xl flex items-center justify-between cursor-pointer transition-all ${
          compact ? 'p-2.5' : 'px-3 py-2.5'
        } ${open ? t.open : 'ds-glass-select'}`}
      >
        <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
          <Search className="w-4 h-4 text-slate-500 shrink-0" />
          {selected ? (
            <div className="truncate min-w-0">
              <span className="text-xs font-bold text-slate-900">{selected.name}</span>
              {selected.doctor_name && (
                <span className="text-[11px] text-slate-500 ml-1.5">
                  ({formatDoctorName(selected.doctor_name)})
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs font-bold text-ink-muted truncate">{placeholder}</span>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-500 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}
        />
      </div>

      {open && (
        <div
          role="listbox"
          className="ds-popover absolute left-0 right-0 mt-1.5 z-50 max-h-72 overflow-y-auto p-2 space-y-1"
        >
          <div className="p-1.5 sticky top-0 bg-white border-b border-slate-100 mb-1">
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

          {filtered.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500">{emptyLabel(query)}</div>
          ) : (
            filtered.map((clinic) => {
              const isSelected = clinic.id === value;
              return (
                <button
                  key={clinic.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => pick(clinic.id)}
                  className={`w-full text-left p-2.5 rounded-lg text-xs transition-colors ${
                    isSelected ? t.selected : 'hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-bold text-slate-900 truncate">{clinic.name}</div>
                    <div className="text-[11px] text-slate-500 font-normal flex items-center gap-2 mt-0.5 truncate">
                      {clinic.doctor_name && <span>{formatDoctorName(clinic.doctor_name)}</span>}
                      {clinic.city && <span>• {clinic.city}</span>}
                      {clinic.phone && <span>• {clinic.phone}</span>}
                    </div>
                  </div>
                  {isSelected && <CheckCircle2 className={`w-4 h-4 shrink-0 ${t.check}`} />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default ClinicPicker;