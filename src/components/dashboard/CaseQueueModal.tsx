/**
 * Case queue — the one place a dashboard panel sends you when you ask to see
 * the cases behind a number.
 *
 * Previously every "Review" / "View" link on the dashboard jumped to the Case
 * Workstation, which lists everything and then makes you re-find the subset
 * you were just looking at. This is that subset, already filtered, with the
 * same Job Slip the workstation opens.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { X, ExternalLink, ChevronRight } from 'lucide-react';
import type { DentalCase, CaseStatus } from '../../types';
import { EmptyState, Badge, CaseStatusBadge } from '../common/ui';
import { Search, ShieldAlert, CheckCircle2, TrendingUp } from 'lucide-react';
import { getTodayStr, daysDiff } from '../../utils/dateUtils';

export type QueueId =
  | 'overdue'
  | 'due_today'
  | 'due_week'
  | 'qc'
  | 'ready'
  | 'revision'
  | 'open'
  /* Production Workflow tiles drill into the stage they name. These mirror the
     stage counts in computeWorkflow exactly — including the archived/draft
     exclusion — so a tile's number and the list behind it never disagree. */
  | 'stage_received'
  | 'stage_in_progress'
  | 'stage_qc'
  | 'stage_ready'
  | 'stage_dispatched';

export const QUEUE_TITLES: Record<QueueId, { title: string; subtitle: string }> = {
  overdue: { title: 'Overdue Cases', subtitle: 'Past the promised delivery date and still open' },
  due_today: { title: 'Due Today', subtitle: 'Promised for delivery today' },
  due_week: { title: 'Due This Week', subtitle: 'Promised within the next seven days' },
  qc: { title: 'Awaiting Quality Check', subtitle: 'On the bench or back from revision' },
  ready: { title: 'Ready for Dispatch', subtitle: 'Cleared and waiting to leave' },
  revision: { title: 'Sent for Revision', subtitle: 'Sent back for rework' },
  open: { title: 'Open Cases', subtitle: 'Every active case, soonest delivery first' },
  stage_received: { title: 'Received', subtitle: 'Registered at the bench and waiting to start' },
  stage_in_progress: { title: 'In Production', subtitle: 'On the bench right now' },
  stage_qc: { title: 'Quality Check', subtitle: 'Awaiting inspection' },
  stage_ready: { title: 'Ready', subtitle: 'Cleared and waiting to leave' },
  stage_dispatched: { title: 'Dispatched Today', subtitle: 'Delivered on their promised date today' },
};

const isOpen = (c: DentalCase) => c.status !== 'delivered' && c.status !== 'cancelled';

/** Mirrors the `live` filter in computeWorkflow: archived and draft cases are
 *  not part of the live pipeline, so they never appear behind a stage tile. */
const isLive = (c: DentalCase) => !c.archived_at && c.status !== 'draft';

const inQueue = (c: DentalCase, queue: QueueId, today: string, horizon: string): boolean => {
  if (queue === 'stage_dispatched') {
    return isLive(c) && c.status === 'delivered' && c.delivery_date === today;
  }
  if (!isOpen(c)) return false;
  switch (queue) {
    case 'overdue':
      return !!c.delivery_date && c.delivery_date < today;
    case 'due_today':
      return c.delivery_date === today;
    case 'due_week':
      return !!c.delivery_date && c.delivery_date >= today && c.delivery_date <= horizon;
    case 'qc':
      return c.status === 'qc';
    case 'ready':
      return c.status === 'ready';
    case 'revision':
      return c.status === 'revision';
    case 'open':
      return true;
    /* A stage queue is exactly one status, and "Received" is still an open
       case — so isOpen is correct here, unlike the count which ignores
       delivered entirely. */
    case 'stage_received':
      return isLive(c) && c.status === 'received';
    case 'stage_in_progress':
      return isLive(c) && c.status === 'in_progress';
    case 'stage_qc':
      return isLive(c) && c.status === 'qc';
    case 'stage_ready':
      return isLive(c) && c.status === 'ready';
    default:
      return false;
  }
};

interface CaseQueueModalProps {
  queue: QueueId | null;
  cases: DentalCase[];
  onSelectCase: (c: DentalCase) => void;
  onOpenWorkstation: () => void;
  onClose: () => void;
}

export const CaseQueueModal: React.FC<CaseQueueModalProps> = ({
  queue,
  cases,
  onSelectCase,
  onOpenWorkstation,
  onClose,
}) => {
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!queue) return;
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
  }, [queue, onClose]);

  const today = getTodayStr();
  const horizon = (() => {
    const [y, m, d] = today.split('-').map(Number);
    const dt = new Date(y, m - 1, d + 7);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  })();

  const rows = useMemo(() => {
    if (!queue) return [];
    const term = search.trim().toLowerCase();
    return cases
      .filter((c) => inQueue(c, queue, today, horizon))
      .filter(
        (c) =>
          !term ||
          c.case_number.toLowerCase().includes(term) ||
          (c.patient_name || '').toLowerCase().includes(term) ||
          (c.doctor_name || '').toLowerCase().includes(term) ||
          (c.lab_name || '').toLowerCase().includes(term)
      )
      .sort(
        (a, b) =>
          (a.delivery_date || '9999').localeCompare(b.delivery_date || '9999') ||
          a.case_number.localeCompare(b.case_number)
      );
  }, [cases, queue, search, today, horizon]);

  if (!queue) return null;
  const meta = QUEUE_TITLES[queue];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={meta.title}
    >
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />

      <div className="relative w-full max-w-2xl my-8 bg-white rounded-3xl border border-ds-line shadow-ds-lift overflow-hidden">
        <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-ds-line">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="ds-icon-tile bg-ds-risk-soft text-ds-risk">
              <ShieldAlert className="w-[18px] h-[18px]" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <h2 className="ds-panel-title truncate">{meta.title}</h2>
              <p className="ds-panel-sub truncate">{meta.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close case queue"
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-5 py-3 border-b border-ds-line flex items-center justify-between gap-3">
          <div className="relative flex-1 min-w-0 max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search case, patient, doctor, clinic…"
              aria-label={`Search ${meta.title}`}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:border-blue-400 focus:outline-none"
            />
          </div>
          <span className="text-[11px] font-bold text-slate-500 tabular-nums shrink-0">
            {rows.length} {rows.length === 1 ? 'case' : 'cases'}
          </span>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title={search ? 'No match' : 'Nothing here'}
            description={
              search
                ? `No case in this queue matches “${search}”.`
                : 'This queue is clear — there is nothing waiting.'
            }
            className="border-0"
          />
        ) : (
          <ul className="divide-y divide-slate-100 max-h-[46vh] overflow-y-auto">
            {rows.map((c) => {
              const late = c.delivery_date ? daysDiff(c.delivery_date, today) : null;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectCase(c);
                      onClose();
                    }}
                    className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-slate-50 transition cursor-pointer group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[12px] font-bold text-ds-accent group-hover:underline shrink-0">
                          #{c.case_number}
                        </span>
                        <span className="text-[12px] font-bold text-slate-900 truncate">
                          {c.patient_name || c.doctor_name}
                        </span>
                        <CaseStatusBadge status={c.status as CaseStatus} size="xs" />
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500 min-w-0">
                        <span className="truncate">{c.case_type_name}</span>
                        <span className="text-slate-300">•</span>
                        <span className="truncate">{c.lab_name}</span>
                        <span className="text-slate-300">•</span>
                        <span className="shrink-0">{c.delivery_date || 'No date'}</span>
                      </div>
                    </div>

                    {late !== null && (
                      <Badge
                        variant={late < 0 ? 'danger' : late <= 2 ? 'warning' : 'neutral'}
                        className="shrink-0"
                      >
                        {late < 0
                          ? `${Math.abs(late)}d late`
                          : late === 0
                            ? 'Today'
                            : `${late}d`}
                      </Badge>
                    )}

                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <footer className="px-5 py-3 border-t border-ds-line flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5 min-w-0 truncate">
            <TrendingUp className="w-3.5 h-3.5 shrink-0" />
            Opens the Job Slip, same as the Case Workstation.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenWorkstation}
              className="text-[11px] font-bold text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition cursor-pointer flex items-center gap-1.5"
            >
              Workstation
              <ExternalLink className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] font-bold text-white bg-slate-900 hover:bg-slate-800 px-3 py-1.5 rounded-xl transition cursor-pointer"
            >
              Done
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};