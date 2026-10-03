/**
 * Delivery calendar modal.
 *
 * Wraps the existing InteractiveDeliveryCalendar — a month grid with a dot on
 * every day that has deliveries, plus the cases due on whichever day is
 * selected. It was orphaned when the dashboard was redesigned, and is revived
 * here rather than replaced: it is already the calendar this app needs, and
 * rebuilding an equivalent would be code for no new behaviour.
 */
import React, { useEffect } from 'react';
import { X, CalendarDays } from 'lucide-react';
import type { DentalCase } from '../../types';
import { InteractiveDeliveryCalendar } from './InteractiveDeliveryCalendar';

interface DeliveryCalendarModalProps {
  isOpen: boolean;
  cases: DentalCase[];
  todayStr: string;
  onSelectCase: (c: DentalCase) => void;
  onOpenNewCase: () => void;
  onUpdateCaseStatus: (caseId: string, status: any, note?: string) => void;
  onClose: () => void;
}

export const DeliveryCalendarModal: React.FC<DeliveryCalendarModalProps> = ({
  isOpen,
  cases,
  todayStr,
  onSelectCase,
  onOpenNewCase,
  onUpdateCaseStatus,
  onClose,
}) => {
  // Escape closes, and the body stops scrolling behind the sheet — same
  // behaviour as the app's other modals.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const upcoming = cases.filter((c) => c.delivery_date && c.status !== 'cancelled').length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Delivery calendar"
    >
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />

      <div className="relative w-full max-w-md my-8 bg-white rounded-3xl border border-ds-line shadow-ds-lift">
        <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-ds-line">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="ds-icon-tile bg-ds-accent-soft text-ds-accent">
              <CalendarDays className="w-[18px] h-[18px]" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <h2 className="ds-panel-title truncate">Delivery Calendar</h2>
              <p className="ds-panel-sub truncate">
                {upcoming} {upcoming === 1 ? 'case' : 'cases'} with a delivery date
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close delivery calendar"
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-4">
          <InteractiveDeliveryCalendar
            cases={cases}
            todayStr={todayStr}
            onSelectCase={(c) => {
              onSelectCase(c);
              onClose();
            }}
            onOpenNewCase={onOpenNewCase}
            onUpdateCaseStatus={onUpdateCaseStatus}
          />
        </div>
      </div>
    </div>
  );
};