import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { getTodayStr } from '../../utils/dateUtils';

/**
 * Enhanced date-range picker: text inputs with a proper calendar popup —
 * month navigation, year jump, weekday header, today/out-of-month styling,
 * one standard set of quick ranges, and an explicit Clear. Values are plain
 * `YYYY-MM-DD` strings so it drops into any filter without type conversion.
 *
 * The presets are deliberately IDENTICAL in every module: an operator who
 * learns "Last Month" in Billing must not find a different menu in the ledger.
 */

export interface QuickRange {
  label: string;
  /** '' = unset (All Time). */
  from: string;
  to: string;
}

interface DatePickerRangeProps {
  from: string; // '' = unset
  to: string;
  onChange: (from: string, to: string) => void;
  /** Stretch the trigger to the container (for grid/form columns). */
  fullWidth?: boolean;
  className?: string;
}

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

const parseISODate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const todayISO = () => getTodayStr();

/** Add calendar days to a `YYYY-MM-DD` value without leaving the local day. */
export const addDaysISO = (iso: string, days: number) => {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
};

const monthStart = (iso: string, offset: number) => {
  const d = parseISODate(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth() + offset, 1));
};

const monthEnd = (iso: string, offset: number) => {
  const d = parseISODate(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth() + offset + 1, 0));
};

/**
 * The one preset list every module shares.
 *
 * "This Month" and "Last Month" are the full calendar month — the range an
 * operator means when they say "print last month", not "the 1st until today".
 * "Last 7 Days" is today plus the six days before it (seven days total).
 */
export const standardQuickRanges = (today = todayISO()): QuickRange[] => [
  { label: 'Today', from: today, to: today },
  { label: 'Yesterday', from: addDaysISO(today, -1), to: addDaysISO(today, -1) },
  { label: 'Last 7 Days', from: addDaysISO(today, -6), to: today },
  { label: 'This Month', from: monthStart(today, 0), to: monthEnd(today, 0) },
  { label: 'Last Month', from: monthStart(today, -1), to: monthEnd(today, -1) },
  { label: 'All Time', from: '', to: '' },
];

/** Human label for a range: the preset name when it matches, else the dates. */
export const describeQuickRange = (from: string, to: string, today = todayISO()): string => {
  const match = standardQuickRanges(today).find(
    (p) => (from || '') === p.from && (to || '') === p.to
  );
  if (match) return match.label;
  if (from && to && from === to) return from;
  if (from || to) return `${from || '…'} → ${to || '…'}`;
  return 'All Time';
};

function CalendarGrid({
  viewYear,
  viewMonth,
  from,
  to,
  onPick,
}: {
  viewYear: number;
  viewMonth: number;
  from: string;
  to: string;
  onPick: (iso: string) => void;
}) {
  const today = todayISO();

  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startPad = first.getDay(); // 0 = Sunday
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    const out: { iso: string; day: number; inMonth: boolean }[] = [];
    // leading days from previous month
    const prevDays = new Date(viewYear, viewMonth, 0).getDate();
    for (let i = startPad - 1; i >= 0; i--) {
      const d = new Date(viewYear, viewMonth - 1, prevDays - i);
      out.push({ iso: toISODate(d), day: d.getDate(), inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      out.push({ iso: toISODate(new Date(viewYear, viewMonth, day)), day, inMonth: true });
    }
    // trailing days to fill the last week (6 rows max = 42 cells)
    let nextDay = 1;
    while (out.length % 7 !== 0 || out.length < 35) {
      const d = new Date(viewYear, viewMonth + 1, nextDay++);
      out.push({ iso: toISODate(d), day: d.getDate(), inMonth: false });
      if (out.length >= 42) break;
    }
    return out;
  }, [viewYear, viewMonth]);

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((w) => (
          <span key={w} className="text-center text-[10px] font-bold text-ink-muted py-1">{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((c) => {
          const isToday = c.iso === today;
          const isEdge = c.iso === from || c.iso === to;
          const inRange = from && to && c.iso > from && c.iso < to;
          return (
            <button
              key={c.iso}
              type="button"
              onClick={() => onPick(c.iso)}
              className={`h-8 text-xs rounded-lg transition-colors cursor-pointer tabular-nums ${
                isEdge
                  ? 'bg-indigo-600 text-white font-bold'
                  : inRange
                  ? 'bg-indigo-50 text-indigo-900'
                  : c.inMonth
                  ? 'text-slate-700 hover:bg-slate-100'
                  : 'text-ink-muted hover:bg-slate-50'
              } ${isToday && !isEdge ? 'ring-1 ring-indigo-300' : ''}`}
            >
              {c.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const DatePickerRange: React.FC<DatePickerRangeProps> = ({
  from,
  to,
  onChange,
  fullWidth = false,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fromInputRef = useRef<HTMLInputElement>(null);

  const today = todayISO();
  const presets = useMemo(() => standardQuickRanges(today), [today]);

  const [viewYear, setViewYear] = useState(() => (from ? Number(from.slice(0, 4)) : new Date().getFullYear()));
  const [viewMonth, setViewMonth] = useState(() => (from ? Number(from.slice(5, 7)) - 1 : new Date().getMonth()));
  // Which endpoint the calendar edits next: 'from' first, then 'to'.
  const [picking, setPicking] = useState<'from' | 'to'>('from');

  // Close on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Escape closes the popup without touching the selected range.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Anchor the calendar to the active selection when the popup OPENS. Not on
  // every pick: choosing a start date in another month must not jump the view
  // back to today when the calendar switches to the end date.
  useEffect(() => {
    if (!open) return;
    setPicking('from');
    const base = from || to || todayISO();
    setViewYear(Number(base.slice(0, 4)));
    setViewMonth(Number(base.slice(5, 7)) - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const handlePick = (iso: string) => {
    if (picking === 'from') {
      if (to && iso > to) {
        // Picked a later day first — treat as a single-day selection.
        onChange(iso, iso);
        setPicking('to');
      } else {
        onChange(iso, to);
        setPicking('to');
      }
    } else {
      if (from && iso < from) {
        onChange(iso, from);
      } else {
        onChange(from, iso);
        setPicking('from');
      }
    }
  };

  const handleManual = (which: 'from' | 'to', raw: string) => {
    const iso = raw; // input type=date already yields YYYY-MM-DD
    if (which === 'from') {
      onChange(iso, to && iso && iso > to ? iso : to);
      if (iso) setPicking('to');
    } else {
      onChange(from && iso && iso < from ? iso : from, iso);
    }
  };

  const applyPreset = (preset: QuickRange) => {
    onChange(preset.from, preset.to);
    if (preset.from) {
      setViewYear(Number(preset.from.slice(0, 4)));
      setViewMonth(Number(preset.from.slice(5, 7)) - 1);
    }
    setPicking('from');
    // One click on a preset is a complete decision — no second "Done" step.
    setOpen(false);
  };

  const focusCustom = () => {
    setPicking('from');
    // The calendar and the two date fields are already open; this just puts
    // the caret where a custom range starts.
    requestAnimationFrame(() => fromInputRef.current?.focus());
  };

  const activePreset = presets.find(
    (p) => (from || '') === p.from && (to || '') === p.to
  );
  const isCustom = !activePreset && Boolean(from || to);

  const label = describeQuickRange(from, to, today);
  const exactRange = from || to ? `${from || '…'} → ${to || '…'}` : 'All Time';

  const chipBase =
    'px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer';
  const chipActive = 'bg-slate-900 text-white border-slate-900';
  const chipIdle = 'bg-slate-100 text-slate-600 border-transparent hover:bg-slate-200';

  return (
    <div ref={containerRef} className={`relative ${fullWidth ? 'w-full' : ''} ${className}`}>
      {/* Trigger — a pill split into two real buttons (open + clear), never a
          control nested inside another control. */}
      <div
        title={exactRange}
        className={`flex items-center overflow-hidden rounded-xl text-xs font-semibold border transition-all shadow-2xs ${
          from || to
            ? 'bg-indigo-50 border-indigo-200 text-indigo-800'
            : 'bg-white border-slate-200 text-slate-600'
        } ${fullWidth ? 'w-full' : ''}`}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={`flex min-w-0 flex-1 items-center justify-start gap-2 py-1.5 pl-3 ${
            from || to ? 'pr-1.5' : 'pr-3'
          } cursor-pointer ${from || to ? 'hover:bg-indigo-100/60' : 'hover:bg-slate-50'}`}
        >
          <CalendarDays className={`w-4 h-4 shrink-0 ${from || to ? 'text-indigo-600' : 'text-ink-muted'}`} />
          <span className="truncate tabular-nums">{label}</span>
        </button>
        {(from || to) && (
          <button
            type="button"
            onClick={() => {
              onChange('', '');
              setPicking('from');
              setOpen(false);
            }}
            aria-label="Clear date range"
            title="Clear dates"
            className="mr-1.5 rounded-lg p-1 text-indigo-500 hover:bg-indigo-100 hover:text-indigo-700 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Popup */}
      {open && (
        <div
          role="dialog"
          aria-label="Choose date range"
          className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-[60] bg-white rounded-2xl border border-slate-200 shadow-xl p-3.5 w-[300px] space-y-2.5"
        >
          {/* Quick ranges — same list in every module. */}
          <div className="flex flex-wrap gap-1">
            {presets.map((q) => {
              const isActive = (from || '') === q.from && (to || '') === q.to;
              return (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => applyPreset(q)}
                  aria-pressed={isActive}
                  className={`${chipBase} ${isActive ? chipActive : chipIdle}`}
                >
                  {q.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={focusCustom}
              aria-pressed={isCustom}
              className={`${chipBase} ${
                isCustom
                  ? chipActive
                  : 'border-dashed border-slate-300 bg-transparent text-slate-600 hover:bg-slate-50'
              }`}
            >
              Custom Range
            </button>
          </div>

          {/* Month header */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
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
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <CalendarGrid
            viewYear={viewYear}
            viewMonth={viewMonth}
            from={from}
            to={to}
            onPick={handlePick}
          />

          {/* Manual inputs */}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            <input
              ref={fromInputRef}
              type="date"
              value={from}
              onChange={(e) => handleManual('from', e.target.value)}
              onFocus={() => setPicking('from')}
              className="flex-1 min-w-0 px-2 py-1.5 text-[11px] bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-400 cursor-pointer"
              aria-label="From date"
            />
            <span className="text-[10px] text-ink-muted">to</span>
            <input
              type="date"
              value={to}
              onChange={(e) => handleManual('to', e.target.value)}
              onFocus={() => setPicking('to')}
              className="flex-1 min-w-0 px-2 py-1.5 text-[11px] bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-400 cursor-pointer"
              aria-label="To date"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink-muted">
              {picking === 'from' ? 'Pick start date' : 'Pick end date'}
            </span>
            <button
              type="button"
              onClick={() => {
                // Apply whatever the user has selected (from/to props or picks),
                // then close. Do NOT reset to today — Done is a confirm-action.
                setOpen(false);
              }}
              className="px-2.5 py-1 bg-brand-600 hover:bg-brand-700 text-white text-[11px] font-bold rounded-lg cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
