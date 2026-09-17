import { PriorityLevel } from '../types';

/**
 * Priority → SLA mapping. Each priority level carries an explicit turnaround
 * commitment (in days) used to auto-compute target delivery dates and to
 * communicate the SLA in the UI. Single source of truth for the whole app.
 *
 * Production values (configurable later via Settings if needed):
 *   urgent → next business day (1 day)
 *   high   → 2 days
 *   normal → 4 days (standard lab turnaround)
 *   low    → 7 days
 */

export const PRIORITY_SLA_DAYS: Record<PriorityLevel, number> = {
  urgent: 1,
  high: 2,
  normal: 4,
  low: 7,
};

export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  low: 'Low',
  normal: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const PRIORITY_ORDER: PriorityLevel[] = ['urgent', 'high', 'normal', 'low'];

/** "Urgent — 1 day", "Normal — 4 days" (for buttons, selects, badges). */
export function prioritySlaLabel(p: PriorityLevel): string {
  const days = PRIORITY_SLA_DAYS[p];
  return `${PRIORITY_LABELS[p]} — ${days} day${days === 1 ? '' : 's'}`;
}

/** Due date = today + SLA days (YYYY-MM-DD). */
export function computeSlaDueDate(priority: PriorityLevel, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + PRIORITY_SLA_DAYS[priority]);
  return d.toISOString().split('T')[0];
}

/**
 * Non-negative days until due (0 when overdue). Consistent with the app's
 * date-string comparisons (YYYY-MM-DD sorts lexicographically).
 */
export function daysUntilDue(dueDate: string, today: string): number {
  if (!dueDate) return 0;
  const diff = Math.round(
    (new Date(dueDate).getTime() - new Date(today).getTime()) / (24 * 60 * 60 * 1000)
  );
  return Math.max(0, diff);
}

export const PRIORITY_BADGE_CLASS: Record<PriorityLevel, string> = {
  urgent: 'bg-rose-100 text-rose-800 border-rose-200',
  high: 'bg-amber-100 text-amber-800 border-amber-200',
  normal: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  low: 'bg-blue-100 text-blue-800 border-blue-200',
};
