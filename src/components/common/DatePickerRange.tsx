import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';

/**
 * Enhanced date-range picker: text inputs with a proper calendar popup —
 * month navigation, year jump, weekday header, today/out-of-month styling,
 * quick-range chips, and an explicit Clear. Values are plain `YYYY-MM-DD`
 * strings so it drops into any filter without type conversion.
 */

interface DatePickerRangeProps {
  from: string; // '' = unset
  to: string;
  onChange: (from: string, to: string) => void;
  /** Optional quick chips; defaults to Today / This Week / This Month / All Time. */
  quickRanges?: { label: string; from: string; to: string }[];
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

export const todayISO = () => toISODate(new Date());

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
          <span key={w} className="text-center text-[10px] font-bold text-slate-400 py-1">{w}</span>
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
                  : 'text-slate-300 hover:bg-slate-50'
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
  quickRanges,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const today = todayISO();
  const defaults = quickRanges || [
    { label: 'Today', from: today, to: today },
    {
      label: 'This Week',
      from: toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - new Date().getDay())),
      to: today,
    },
    { label: 'This Month', from: toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: today },
    { label: 'All Time', from: '', to: '' },
  ];

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

  // Keep the calendar view anchored to the active selection when opened
  useEffect(() => {
    if (open) {
      const anchor = picking === 'from' ? from : to;
      const base = anchor || today;
      setViewYear(Number(base.slice(0, 4)));
      setViewMonth(Number(base.slice(5, 7)) - 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, picking]);

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

  const label = from || to
    ? `${from || '…'} → ${to || '…'}`
    : 'All Time';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer shadow-2xs active:scale-[0.98] ${
          from || to
            ? 'bg-indigo-50 border-indigo-200 text-indigo-800'
            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
        title="Filter by date range"
      >
        <CalendarDays className={`w-4 h-4 shrink-0 ${from || to ? 'text-indigo-600' : 'text-slate-400'}`} />
        <span className="tabular-nums">{label}</span>
        {(from || to) && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onChange('', '');
              setPicking('from');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                onChange('', '');
                setPicking('from');
              }
            }}
            className="p-0.5 rounded hover:bg-indigo-100 text-indigo-500 hover:text-indigo-700"
            title="Clear dates"
          >
            <X className="w-3.5 h-3.5" />
          </span>
        )}
      </button>

      {/* Popup */}
      {open && (
        <div className="absolute right-0 top-full mt-2 z-40 bg-white rounded-2xl border border-slate-200 shadow-xl p-4 w-[300px] space-y-3">
          {/* Quick ranges */}
          <div className="flex flex-wrap gap-1">
            {defaults.map((q) => {
              const isActive = (from || '') === q.from && (to || '') === q.to;
              return (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => {
                    onChange(q.from, q.to);
                    if (q.from) {
                      setViewYear(Number(q.from.slice(0, 4)));
                      setViewMonth(Number(q.from.slice(5, 7)) - 1);
                    }
                    setPicking('from');
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {q.label}
                </button>
              );
            })}
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
                className="text-xs font-bold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i}>{m}</option>
                ))}
              </select>
              <select
                value={viewYear}
                onChange={(e) => setViewYear(Number(e.target.value))}
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
              type="date"
              value={from}
              onChange={(e) => handleManual('from', e.target.value)}
              className="flex-1 min-w-0 px-2 py-1.5 text-[11px] bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-400 cursor-pointer"
              aria-label="From date"
            />
            <span className="text-[10px] text-slate-400">to</span>
            <input
              type="date"
              value={to}
              onChange={(e) => handleManual('to', e.target.value)}
              className="flex-1 min-w-0 px-2 py-1.5 text-[11px] bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-400 cursor-pointer"
              aria-label="To date"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400">
              {picking === 'from' ? 'Pick start date' : 'Pick end date'}
            </span>
            <button
              type="button"
              onClick={() => {
                onChange(today, today);
                setPicking('from');
                setOpen(false);
              }}
              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold rounded-lg cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
