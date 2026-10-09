import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { todayISO } from './DatePickerRange';

/**
 * Enhanced single-date picker — the same calendar affordances as
 * `DatePickerRange` (month navigation, year jump, today chip, manual entry,
 * clear) for a form field that holds ONE day.
 *
 * Deliberately unconstrained: it has no `min`, so a past date is always
 * selectable. It is used for the case Received Date, which is a historical
 * fact about a job that has already arrived — clamping it would be wrong.
 */

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const toISODate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

interface DatePickerSingleProps {
  label: string;
  /** `YYYY-MM-DD`, or '' when unset. */
  value: string;
  onChange: (iso: string) => void;
  /** Text when nothing is picked; defaults to "Not set". */
  placeholder?: string;
  className?: string;
}

export const DatePickerSingle: React.FC<DatePickerSingleProps> = ({
  label,
  value,
  onChange,
  placeholder = 'Not set',
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const today = todayISO();

  const [viewYear, setViewYear] = useState(() => (value ? Number(value.slice(0, 4)) : new Date().getFullYear()));
  const [viewMonth, setViewMonth] = useState(() => (value ? Number(value.slice(5, 7)) - 1 : new Date().getMonth()));

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Anchor the visible month to the stored value each time the popup opens.
  useEffect(() => {
    if (open) {
      const base = value || today;
      setViewYear(Number(base.slice(0, 4)));
      setViewMonth(Number(base.slice(5, 7)) - 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const out: { iso: string; day: number; inMonth: boolean }[] = [];
    const prevDays = new Date(viewYear, viewMonth, 0).getDate();
    for (let i = startPad - 1; i >= 0; i--) {
      const d = new Date(viewYear, viewMonth - 1, prevDays - i);
      out.push({ iso: toISODate(d), day: d.getDate(), inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      out.push({ iso: toISODate(new Date(viewYear, viewMonth, day)), day, inMonth: true });
    }
    let nextDay = 1;
    while (out.length % 7 !== 0 || out.length < 35) {
      const d = new Date(viewYear, viewMonth + 1, nextDay++);
      out.push({ iso: toISODate(d), day: d.getDate(), inMonth: false });
      if (out.length >= 42) break;
    }
    return out;
  }, [viewYear, viewMonth]);

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        className={`w-full flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-left text-sm transition-all cursor-pointer ${
          value
            ? 'bg-indigo-50 border-indigo-200 text-indigo-900 font-semibold pr-9'
            : 'bg-slate-50 border-slate-200 text-ink-body hover:bg-slate-100'
        }`}
      >
        <CalendarDays className={`w-4 h-4 shrink-0 ${value ? 'text-indigo-600' : 'text-ink-muted'}`} />
        <span className={`flex-1 tabular-nums ${value ? '' : 'italic'}`}>{value || placeholder}</span>
      </button>
      {/* Kept a SIBLING of the trigger, not a nested control: nesting an
          interactive element inside a <button> is invalid HTML and makes the
          trigger's accessible name ambiguous. */}
      {value && (
        <button
          type="button"
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={() => onChange('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-indigo-100 text-indigo-500 hover:text-indigo-700 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {open && (
        <div className="absolute left-0 top-full mt-2 z-[60] bg-white rounded-2xl border border-slate-200 shadow-xl p-4 w-[300px] space-y-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="p-1.5 rounded-lg text-ink-body hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1.5">
              <select
                value={viewMonth}
                onChange={(e) => setViewMonth(Number(e.target.value))}
                aria-label="Month"
                className="text-xs font-bold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i}>{m}</option>
                ))}
              </select>
              <select
                value={viewYear}
                onChange={(e) => setViewYear(Number(e.target.value))}
                aria-label="Year"
                className="text-xs font-bold text-slate-800 bg-transparent focus:outline-none cursor-pointer tabular-nums"
              >
                {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 5 + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="p-1.5 rounded-lg text-ink-body hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div>
            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map((w) => (
                <span key={w} className="text-center text-[10px] font-bold text-ink-muted py-1">{w}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((c) => (
                <button
                  key={c.iso}
                  type="button"
                  onClick={() => pick(c.iso)}
                  aria-current={c.iso === today ? 'date' : undefined}
                  className={`h-8 text-xs rounded-lg transition-colors cursor-pointer tabular-nums ${
                    c.iso === value
                      ? 'bg-indigo-600 text-white font-bold'
                      : c.inMonth
                      ? 'text-slate-700 hover:bg-slate-100'
                      : 'text-ink-muted hover:bg-slate-50'
                  } ${c.iso === today && c.iso !== value ? 'ring-1 ring-indigo-300' : ''}`}
                >
                  {c.day}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            <input
              type="date"
              value={value}
              onChange={(e) => pick(e.target.value)}
              aria-label={`${label} value`}
              className="flex-1 min-w-0 px-2 py-1.5 text-[11px] bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-400 cursor-pointer"
            />
            <button
              type="button"
              onClick={() => pick(today)}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold rounded-lg cursor-pointer whitespace-nowrap"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
};