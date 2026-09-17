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

  // Next upcoming deliveries if selected date has 0
  const upcomingDeliveries = useMemo(() => {
    return cases
      .filter(c => c.status !== 'delivered' && c.status !== 'cancelled')
      .sort((a, b) => (a.delivery_date || '').localeCompare(b.delivery_date || ''))
      .slice(0, 4);
  }, [cases]);

  return (
    <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs space-y-4 flex flex-col justify-between">
      
      {/* Calendar Header */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <CalendarIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {monthNames[currentMonth]} {currentYear}
              </h3>
              <p className="text-[10px] text-slate-400">Click date to view dispatch runs</p>
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
              className="p-1 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer transition"
              title="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button 
              onClick={handleNextMonth}
              className="p-1 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer transition"
              title="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Days of Week */}
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-slate-400 mb-1">
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
                    : 'text-slate-300 hover:bg-slate-50'
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
                        ? 'bg-rose-500 ring-1 ring-rose-300 animate-pulse'
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
          <div className="flex items-center gap-1.5">
            <Truck className="w-3.5 h-3.5 text-blue-600" />
            <span className="text-xs font-bold text-slate-800">
              Dispatch Runs for {selectedDateStr}
            </span>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
            {casesOnSelectedDate.length} {casesOnSelectedDate.length === 1 ? 'Delivery' : 'Deliveries'}
          </span>
        </div>

        {/* Dispatch Items List */}
        <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
          {casesOnSelectedDate.length > 0 ? (
            casesOnSelectedDate.map((c, i) => {
              const isDelivered = c.status === 'delivered';
              const isUrgent = c.priority === 'urgent' || c.status === 'revision';
              const assignedRider = i % 2 === 0 ? 'Lab Rider 01 (Central)' : 'Lab Rider 02 (North)';
              const timeSlot = i === 0 ? '10:30 AM' : i === 1 ? '02:00 PM' : '04:30 PM';

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
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${isDelivered ? 'bg-emerald-500' : isUrgent ? 'bg-rose-500' : 'bg-blue-500'}`} />
                      <button 
                        onClick={() => onSelectCase(c)}
                        className="font-bold text-blue-700 hover:underline flex items-center gap-1 text-left"
                      >
                        #{c.case_number}
                      </button>
                      <span className="text-slate-400">•</span>
                      <span className="font-semibold text-slate-800 truncate max-w-[120px]">{c.lab_name}</span>
                    </div>

                    <span className="text-[10px] font-bold text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                      {timeSlot}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span className="truncate">{c.case_type_name} ({c.patient_name}) • Shade {c.shade || 'A2'}</span>
                    <span className="text-[10px] font-medium text-slate-400">{assignedRider}</span>
                  </div>

                  {/* Action row */}
                  <div className="pt-1.5 border-t border-slate-200/50 flex items-center justify-between text-[10px]">
                    <button
                      onClick={() => onSelectCase(c)}
                      className="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-0.5 cursor-pointer"
                    >
                      <span>Case Details</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </button>

                    <div className="flex items-center gap-1">
                      {isDelivered ? (
                        <span className="text-emerald-700 font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Delivered</span>
                        </span>
                      ) : (
                        <button
                          onClick={() => onUpdateCaseStatus(c.id, 'delivered', 'Marked delivered via Dispatch Run Schedule')}
                          className="px-2 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition flex items-center gap-1 cursor-pointer shadow-2xs"
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
              <p className="text-xs font-semibold text-slate-600">No dispatches scheduled for {selectedDateStr}</p>
              <p className="text-[11px] text-slate-400">Select another date with delivery dots or view upcoming runs.</p>
              <button
                onClick={onOpenNewCase}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold text-xs transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Schedule New Case</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Upcoming Dispatch Queue Preview */}
      <div className="pt-2 border-t border-slate-100">
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 mb-1.5">
          <span>Upcoming Laboratory Queue</span>
          <span className="text-[10px] text-slate-400">Sorted by Due Date</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {upcomingDeliveries.slice(0, 2).map(c => (
            <div 
              key={c.id}
              onClick={() => onSelectCase(c)}
              className="p-1.5 rounded-lg bg-slate-50 hover:bg-blue-50/60 border border-slate-100 cursor-pointer text-[10px] transition"
            >
              <div className="flex items-center justify-between font-bold text-slate-800">
                <span className="text-blue-700">#{c.case_number}</span>
                <span className="text-slate-500">{c.delivery_date}</span>
              </div>
              <p className="truncate text-slate-500 mt-0.5">{c.lab_name}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
