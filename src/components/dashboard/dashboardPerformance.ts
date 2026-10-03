/**
 * Lab performance metrics — which ones the data can actually support.
 *
 * The reference mock shows seven filled rows. A fresh install can only fill
 * two or three of them, and rendering the rest as em dashes made the panel look
 * broken next to its neighbours. Each metric therefore declares whether it has
 * a basis; the panel shows only the supported ones and says how many it is
 * showing, so a short list reads as "this is all there is" rather than
 * "something failed to load".
 */
import type { DentalCase, Invoice } from '../../types';
import { daysDiff, getTodayStr } from '../../utils/dateUtils';
import { isActive } from './dashboardMetrics';

const EM = '—';

export interface PerformanceRow {
  label: string;
  value: string;
  /** False when the metric has no basis — the panel drops it rather than
   *  printing a placeholder next to real numbers. */
  supported: boolean;
}

/** Local-day portion of a `YYYY-MM-DD HH:mm:ss` stamp. */
const dayOf = (stamp?: string) => (stamp || '').slice(0, 10);

const inMonth = (dateStr: string | undefined, monthPrefix: string) =>
  !!dateStr && dateStr.slice(0, 7) === monthPrefix;

const titleCase = (s: string) =>
  s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (m) => m.toUpperCase());

/** Timestamp of the most recent status transition recorded on the case. */
function lastTransition(c: DentalCase): string | undefined {
  const h = c.history || [];
  return h.length ? h[h.length - 1].timestamp : c.updated_at;
}

export function computePerformance(input: {
  cases: DentalCase[];
  invoices: Invoice[];
  todayStr?: string;
}): PerformanceRow[] {
  const today = input.todayStr ?? getTodayStr();
  const monthPrefix = today.slice(0, 7);
  const { cases, invoices } = input;

  const completed = cases.filter((c) => c.status === 'delivered');
  const monthCompleted = completed.filter((c) => inMonth(c.delivery_date, monthPrefix));

  // On-time = reached delivered on or before the promised delivery date.
  const onTime = completed.filter((c) => {
    const t = dayOf(lastTransition(c));
    return !!t && !!c.delivery_date && t <= c.delivery_date;
  });

  const turnarounds = completed
    .filter((c) => c.created_at && c.delivery_date)
    .map((c) => daysDiff(c.delivery_date, dayOf(c.created_at)));
  const avgTurnaround =
    turnarounds.length > 0
      ? Math.round((turnarounds.reduce((s, d) => s + d, 0) / turnarounds.length) * 10) / 10
      : null;

  // Rework = every revision transition ever recorded, against completed cases.
  const reworkEvents = cases.reduce(
    (s, c) => s + (c.history || []).filter((h) => h.status === 'revision').length,
    0
  );
  const reworkRate =
    completed.length > 0 ? Math.round((reworkEvents / completed.length) * 1000) / 10 : null;

  const monthInvoices = invoices.filter((i) => inMonth(i.issue_date || i.created_at, monthPrefix));
  const monthBilled = monthInvoices.reduce((s, i) => s + i.final_amount, 0);
  const revenuePerCase =
    monthCompleted.length > 0 ? Math.round(monthBilled / monthCompleted.length) : null;

  const topOf = <T,>(items: T[], key: (t: T) => string, value: (t: T) => number): string | null => {
    const tally = new Map<string, number>();
    for (const item of items) {
      const k = key(item);
      tally.set(k, (tally.get(k) || 0) + value(item));
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };

  const topMaterial = topOf(monthInvoices, (i) => i.case_type_name || 'Case', (i) => i.final_amount);
  const topClinic = topOf(monthInvoices, (i) => i.lab_name, (i) => i.final_amount);

  const openCases = cases.filter(isActive);
  const readyToShip = openCases.filter((c) => c.status === 'ready').length;

  const row = (label: string, value: string | null): PerformanceRow =>
    value === null ? { label, value: EM, supported: false } : { label, value, supported: true };

  return [
    row('Avg. Turnaround', avgTurnaround === null ? null : `${avgTurnaround} days`),
    row(
      'On-Time Delivery',
      completed.length === 0 ? null : `${Math.round((onTime.length / completed.length) * 100)}%`
    ),
    row('Cases Completed', monthCompleted.length === 0 ? null : monthCompleted.length.toString()),
    row('Rework Rate', reworkRate === null ? null : `${reworkRate}%`),
    row(
      'Revenue / Case',
      revenuePerCase === null ? null : `PKR ${revenuePerCase.toLocaleString()}`
    ),
    row('Ready to Ship', readyToShip === 0 ? null : `${readyToShip} case${readyToShip === 1 ? '' : 's'}`),
    row('Top Material', topMaterial ? titleCase(topMaterial) : null),
    row('Top Clinic', topClinic ?? null),
  ];
}

export { EM as PERFORMANCE_EM_DASH };