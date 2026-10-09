import React, { useState, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Truck, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  Plus, 
  User, 
  ExternalLink,
  PackageCheck,
  SendHorizontal
} from 'lucide-react';
import { DentalCase } from '../../types';

interface InteractiveDeliveryCalendarProps {
  cases: DentalCase[];
  todayStr: string;
  onSelectCase: (c: DentalCase) => void;
  onOpenNewCase: () => void;
  onUpdateCaseStatus: (caseId: string, status: any, note?: string) => void;
}

export const InteractiveDeliveryCalendar: React.FC<InteractiveDeliveryCalendarProps> = ({
  cases,
  todayStr,
  onSelectCase,
  onOpenNewCase,
  onUpdateCaseStatus,
}) => {
  // Parse initial date from todayStr or fallback to 2026-09-17
  const initialDate = useMemo(() => {
    if (todayStr) {
      const parts = todayStr.split('-');
      if (parts.length === 3) {
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      }
    }
    return new Date(2026, 8, 17); // Sept 17, 2026
  }, [todayStr]);

  const [currentYear, setCurrentYear] = useState<number>(initialDate.getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(initialDate.getMonth()); // 0-indexed
  const [selectedDateStr, setSelectedDateStr] = useState<string>(todayStr || '2026-09-17');
  const [selectedRiderFilter, setSelectedRiderFilter] = useState<'all' | 'rider1' | 'rider2' | 'courier'>('all');

  // Month navigation
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(prev => prev - 1);
    } else {
      setCurrentMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(prev => prev + 1);
    } else {
      setCurrentMonth(prev => prev + 1);
    }
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Calendar calculations
  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay(); // 0 = Sun
    const totalDaysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();

    const days: Array<{
      dayNum: number;
      dateStr: string;
      isCurrentMonth: boolean;
      isToday: boolean;
      isSelected: boolean;
      casesDue: DentalCase[];
      hasUrgent: boolean;
    }> = [];

    // Previous month padding days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNum = prevMonthDays - i;
      const m = currentMonth === 0 ? 12 : currentMonth;
      const y = currentMonth === 0 ? currentYear - 1 : currentYear;
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const casesDue = cases.filter(c => c.delivery_date === dateStr);
      days.push({
        dayNum,
        dateStr,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        isSelected: dateStr === selectedDateStr,
        casesDue,
        hasUrgent: casesDue.some(c => c.priority === 'urgent' || c.status === 'revision'),
      });
    }

    // Current month days
    for (let dayNum = 1; dayNum <= totalDaysInMonth; dayNum++) {
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const casesDue = cases.filter(c => c.delivery_date === dateStr);
      days.push({
        dayNum,
        dateStr,
        isCurrentMonth: true,
        isToday: dateStr === todayStr,
        isSelected: dateStr === selectedDateStr,
        casesDue,
        hasUrgent: casesDue.some(c => c.priority === 'urgent' || c.status === 'revision'),
      });
    }

    // Next month padding days to complete 35 or 42 grid cells
    const remainingSlots = 42 - days.length;
    if (remainingSlots > 0 && remainingSlots < 14) {
      for (let dayNum = 1; dayNum <= remainingSlots; dayNum++) {
        const m = currentMonth === 11 ? 1 : currentMonth + 2;
        const y = currentMonth === 11 ? currentYear + 1 : currentYear;
        const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        const casesDue = cases.filter(c => c.delivery_date === dateStr);
        days.push({
          dayNum,
          dateStr,
          isCurrentMonth: false,
          isToday: dateStr === todayStr,
          isSelected: dateStr === selectedDateStr,
          casesDue,
          hasUrgent: casesDue.some(c => c.priority === 'urgent' || c.status === 'revision'),
        });
      }
    }

    return days;
  }, [currentYear, currentMonth, selectedDateStr, todayStr, cases]);

  // Cases due on selected date
  const casesOnSelectedDate = useMemo(() => {
    return cases.filter(c => c.delivery_date === selectedDateStr);
  }, [cases, selectedDateStr]);

  /* The "Upcoming Laboratory Queue" strip that used to live here was a second,
     unordered copy of the calendar grid next to it — and because it sorted by
     due date regardless of the selected day, it contradicted the dispatch list
     directly above it. Replaced with a single jump-to-next-busy-day action,
     which is what a user on an empty day actually wants. */
  const nextBusyDay = useMemo(() => {
    return cases
      .filter(c => c.delivery_date && (c.status !== 'cancelled'))
      .reduce<string | null>((best, c) => {
        const d = c.delivery_date as string;
        if (d < selectedDateStr) return best;
        if (best === null || d < best) return d;
        return best;
      }, null);
  }, [cases, selectedDateStr]);

  return (
    <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs space-y-4 flex flex-col justify-between">
      
      {/* Calendar Header */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-ink-info flex items-center justify-center font-bold">
              <CalendarIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {monthNames[currentMonth]} {currentYear}
              </h3>
              <p className="text-[10px] text-ink-muted">Click date to view dispatch runs</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button 
              onClick={() => {
                setSelectedDateStr(todayStr);
                const [y, m] = todayStr.split('-').map(Number);
                setCurrentYear(y);
                setCurrentMonth(m - 1);
              }}
              className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition cursor-pointer"
            >
              Today
            </button>
            <button 
              onClick={handlePrevMonth}
              className="p-1 rounded-lg hover:bg-slate-100 text-ink-body cursor-pointer transition"
              title="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button 
              onClick={handleNextMonth}
              className="p-1 rounded-lg hover:bg-slate-100 text-ink-body cursor-pointer transition"
              title="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Days of Week */}
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-ink-muted mb-1">
          <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {calendarDays.slice(0, 35).map((d, index) => {
            const hasCases = d.casesDue.length > 0;
            return (
              <button
                key={index}
                onClick={() => setSelectedDateStr(d.dateStr)}
                className={`py-1.5 rounded-xl flex flex-col items-center justify-center relative transition cursor-pointer ${
                  d.isSelected 
                    ? 'bg-blue-600 text-white font-bold shadow-xs' 
                    : d.isToday
                    ? 'bg-blue-50 text-blue-700 font-extrabold border border-blue-200'
                    : d.isCurrentMonth
                    ? 'text-slate-700 hover:bg-slate-100 font-medium'
                    : 'text-ink-muted hover:bg-slate-50'
                }`}
              >
                <span>{d.dayNum}</span>
                
                {/* Indicator dot */}
                {hasCases && (
                  <span 
                    className={`w-1.5 h-1.5 rounded-full absolute bottom-0.5 left-1/2 -translate-x-1/2 ${
                      d.isSelected
                        ? 'bg-white'
                        : d.hasUrgent
                        ? 'bg-fill-danger ring-1 ring-rose-300 animate-pulse'
                        : 'bg-blue-500'
                    }`} 
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Date Summary Strip */}
      <div className="pt-3 border-t border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Truck className="w-3.5 h-3.5 text-ink-info shrink-0" />
            <span className="text-xs font-bold text-slate-800 truncate" title={`Dispatch runs for ${selectedDateStr}`}>
              Dispatch Runs for {selectedDateStr}
            </span>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 whitespace-nowrap shrink-0 tabular-nums">
            {casesOnSelectedDate.length} {casesOnSelectedDate.length === 1 ? 'Delivery' : 'Deliveries'}
          </span>
        </div>

        {/* Dispatch Items List */}
        <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
          {casesOnSelectedDate.length > 0 ? (
            casesOnSelectedDate.map((c) => {
              const isDelivered = c.status === 'delivered';
              const isUrgent = c.priority === 'urgent' || c.status === 'revision';
              /* No dispatch time or rider is stored on a case, and the previous
                 implementation invented both from the row's index ("10:30 AM",
                 "Lab Rider 02 (North)"). The clock shown is now the real time
                 the case entered its current stage. */
              const history = c.history || [];
              const lastStamp = history.length ? history[history.length - 1].timestamp : c.updated_at;
              const rawClock = (lastStamp || '').slice(11, 16);
              const timeSlot = /^\d{2}:\d{2}$/.test(rawClock) ? rawClock : null;

              return (
                <div 
                  key={c.id} 
                  className={`p-2.5 rounded-xl border transition flex flex-col gap-1.5 ${
                    isDelivered 
                      ? 'bg-emerald-50/50 border-emerald-100' 
                      : isUrgent 
                      ? 'bg-rose-50/40 border-rose-200' 
                      : 'bg-slate-50 hover:bg-slate-100/80 border-slate-200/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    {/* min-w-0 + truncate on the name, whitespace-nowrap on the
                        id: without them "Muzaffarabad…" swallowed the slot and
                        "#DS-0003" broke across two lines. */}
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className={`w-2 h-2 shrink-0 rounded-full ${isDelivered ? 'bg-fill-success' : isUrgent ? 'bg-fill-danger' : 'bg-blue-500'}`} />
                      <button
                        onClick={() => onSelectCase(c)}
                        className="font-bold text-blue-700 hover:underline whitespace-nowrap shrink-0"
                        title={`Open case #${c.case_number}`}
                      >
                        #{c.case_number}
                      </button>
                      <span className="text-ink-muted shrink-0">•</span>
                      <span className="font-semibold text-slate-800 truncate min-w-0">{c.lab_name}</span>
                    </div>

                    {timeSlot && (
                      <span className="text-[10px] font-bold text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200 whitespace-nowrap shrink-0 tabular-nums">
                        {timeSlot}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span className="truncate min-w-0">
                      {c.case_type_name}
                      {c.patient_name ? ` (${c.patient_name})` : ''}
                      {c.shade ? ` • Shade ${c.shade}` : ''}
                    </span>
                  </div>

                  {/* Action row */}
                  <div className="pt-1.5 border-t border-slate-200/50 flex items-center justify-between text-[10px]">
                    <button
                      onClick={() => onSelectCase(c)}
                      className="text-ink-info hover:text-blue-800 font-semibold flex items-center gap-0.5 cursor-pointer"
                    >
                      <span>Case Details</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </button>

                    <div className="flex items-center gap-1">
                      {isDelivered ? (
                        <span className="text-emerald-700 font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-ink-success" />
                          <span>Delivered</span>
                        </span>
                      ) : (
                        <button
                          onClick={() => onUpdateCaseStatus(c.id, 'delivered', 'Marked delivered via Dispatch Run Schedule')}
                          className="px-2 py-0.5 rounded-lg bg-fill-success hover:bg-emerald-700 text-white font-bold transition flex items-center gap-1 cursor-pointer shadow-2xs"
                        >
                          <PackageCheck className="w-3 h-3" />
                          <span>Mark Delivered</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-4 rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-center space-y-2">
              <p className="text-xs font-semibold text-slate-600">No dispatches scheduled</p>
              <p className="text-[11px] text-ink-muted">Pick a dotted day on the calendar, or jump to the next one.</p>
              <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
                {nextBusyDay && (
                  <button
                    onClick={() => {
                      setSelectedDateStr(nextBusyDay);
                      const [y, m] = nextBusyDay.split('-').map(Number);
                      setCurrentYear(y);
                      setCurrentMonth(m - 1);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-blue-700 border border-blue-200 hover:bg-blue-50 font-bold text-xs transition cursor-pointer whitespace-nowrap"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                    <span>Next: {nextBusyDay}</span>
                  </button>
                )}
                <button
                  onClick={onOpenNewCase}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold text-xs transition cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Schedule New Case</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
};
