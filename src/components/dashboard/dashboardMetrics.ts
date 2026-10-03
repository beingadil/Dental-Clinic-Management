/**
 * Dashboard metric derivations.
 *
 * Every figure the dashboard shows is computed here from live rows, in pure
 * functions with no React and no database access. Two reasons:
 *
 *  1. It is the only way the panels stay honest. A panel that reaches for a
 *     literal when the dataset is empty is lying, and this module has no way
 *     to reach for one — it can only return `null`, which the panels render
 *     as an em dash.
 *  2. It is testable without a DOM. See tests/dashboard/dashboardMetrics.test.ts.
 *
 * Date rule, inherited from the rest of the app: business dates are local-day
 * `YYYY-MM-DD` strings compared lexically. Never `toISOString()` — during PKT's
 * small hours that shifts a stored date a day into the past.
 */
import type { DentalCase, DentalLab, Invoice, PaymentRecord, CaseStatus } from '../../types';
import { getTodayStr, daysDiff } from '../../utils/dateUtils';

export interface MetricsInput {
  cases: DentalCase[];
  invoices: Invoice[];
  payments: PaymentRecord[];
  labs: DentalLab[];
  /** Local-day YYYY-MM-DD. Injected so tests can freeze the clock. */
  todayStr?: string;
}

/* ── small shared helpers ─────────────────────────────────────────────── */

const ACTIVE_STATUSES: CaseStatus[] = ['draft', 'received', 'in_progress', 'qc', 'ready', 'revision'];

export const isActive = (c: DentalCase) => ACTIVE_STATUSES.includes(c.status);
export const isBench = (c: DentalCase) =>
  c.status === 'in_progress' || c.status === 'qc' || c.status === 'ready';

/** Remaining balance on an invoice, floored at zero (credits can overpay). */
const balanceOf = (inv: Invoice) => Math.max(0, inv.final_amount - (inv.amount_paid || 0));

/** Local-day portion of a `YYYY-MM-DD HH:mm:ss` stamp. */
const dayOf = (stamp?: string) => (stamp || '').slice(0, 10);

/** `14:07` from a `YYYY-MM-DD HH:mm:ss` stamp — the clock time only. */
const clockOf = (stamp?: string) => {
  const raw = (stamp || '').slice(11, 16);
  return /^\d{2}:\d{2}$/.test(raw) ? raw : null;
};

/**
 * `today` shifted by `days`, as a local-day string.
 *
 * `getDaysOffsetStr` reads the wall clock directly, which would make every
 * window below untestable. Offsetting from the injected `today` keeps the whole
 * module deterministic under a frozen clock.
 */
function offsetDay(today: string, days: number): string {
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

const inMonth = (dateStr: string | undefined, monthPrefix: string) =>
  !!dateStr && dateStr.slice(0, 7) === monthPrefix;

const uniq = <T,>(xs: T[]) => Array.from(new Set(xs));

/** Material label for a case, falling back to the case type when unset. */
const materialOf = (c: DentalCase) =>
  (c.material || '').trim() || (c.case_type_name || '').trim() || 'Unspecified';

/** Title-cases a snake/lower material string for display ("e_max" → "E Max"). */
const titleCase = (s: string) =>
  s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (m) => m.toUpperCase());

/* ── 1 · KPI row ──────────────────────────────────────────────────────── */

export interface KpiRow {
  activeCases: number;
  /** Net change in new cases, this week vs the week before. */
  activeDelta: number;
  inProduction: number;
  inProductionDueToday: number;
  deliveriesToday: number;
  /** Case number of the next thing leaving the bench, if there is one. */
  nextDeliveryRef: string | null;
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
  totalBilled: number;
  totalCollected: number;
}

export function computeKpis(input: MetricsInput): KpiRow {
  const today = input.todayStr ?? getTodayStr();
  const { cases, invoices } = input;

  const active = cases.filter(isActive);

  // Active-case growth compares the last 7 days of creation against the 7
  // before it. Comparing against "last week's snapshot" would need a stored
  // snapshot we do not have, so this is the honest version of the delta.
  const weekStart = offsetDay(today, -7);
  const priorStart = offsetDay(today, -14);
  const recent = cases.filter((c) => dayOf(c.created_at) >= weekStart).length;
  const prior = cases.filter(
    (c) => dayOf(c.created_at) >= priorStart && dayOf(c.created_at) < weekStart
  ).length;

  const totalBilled = invoices.reduce((s, i) => s + i.final_amount, 0);
  const totalCollected = invoices.reduce((s, i) => s + (i.amount_paid || 0), 0);
  const overdueInvoices = invoices.filter(
    (i) => i.payment_status !== 'paid' && i.due_date && i.due_date < today
  );

  const dueToday = cases.filter((c) => c.delivery_date === today);
  // "Next" is the soonest open delivery, today first. Sorted by date so the
  // answer is deterministic; ties fall back to case number.
  const nextOpen = [...active]
    .filter((c) => !!c.delivery_date)
    .sort(
      (a, b) =>
        (a.delivery_date || '').localeCompare(b.delivery_date || '') ||
        a.case_number.localeCompare(b.case_number)
    )[0];

  return {
    activeCases: active.length,
    activeDelta: recent - prior,
    inProduction: cases.filter(isBench).length,
    inProductionDueToday: cases.filter(
      (c) => c.delivery_date === today && isBench(c)
    ).length,
    deliveriesToday: dueToday.length,
    nextDeliveryRef: nextOpen?.case_number ?? null,
    outstanding: invoices.reduce((s, i) => s + balanceOf(i), 0),
    overdueAmount: overdueInvoices.reduce((s, i) => s + balanceOf(i), 0),
    overdueCount: overdueInvoices.length,
    totalBilled,
    totalCollected,
  };
}

/* ── 2 · Production workflow ──────────────────────────────────────────── */

export interface WorkflowStage {
  key: CaseStatus | 'dispatched';
  label: string;
  count: number;
  /** Unit word under the figure — "cases", "today" — matches the design. */
  unit: string;
  tone: 'muted' | 'accent' | 'qc' | 'pos' | 'dispatch';
}

export function computeWorkflow(input: MetricsInput): WorkflowStage[] {
  const today = input.todayStr ?? getTodayStr();
  const by = (s: CaseStatus) => input.cases.filter((c) => c.status === s).length;
  return [
    { key: 'received', label: 'Received', count: by('received'), unit: 'cases', tone: 'muted' },
    { key: 'in_progress', label: 'In Production', count: by('in_progress'), unit: 'cases', tone: 'accent' },
    { key: 'qc', label: 'QC', count: by('qc'), unit: 'cases', tone: 'qc' },
    { key: 'ready', label: 'Ready', count: by('ready'), unit: 'cases', tone: 'pos' },
    {
      key: 'dispatched',
      label: 'Dispatched',
      count: input.cases.filter((c) => c.status === 'delivered' && c.delivery_date === today)
        .length,
      unit: 'today',
      tone: 'dispatch',
    },
  ];
}

/* ── 3 · Needs attention ──────────────────────────────────────────────── */

export type AttentionTone = 'risk' | 'warn' | 'qc' | 'pos';
export interface AttentionRow {
  key: string;
  count: number;
  title: string;
  /** Second line — real case ids and why they need attention. */
  detail: string;
  /** Short qualifier rendered after the detail ("2 days late", "Today"). */
  qualifier: string | null;
  tone: AttentionTone;
}

export function computeAttention(input: MetricsInput): AttentionRow[] {
  const today = input.todayStr ?? getTodayStr();
  const { cases } = input;

  const overdue = cases
    .filter((c) => isActive(c) && c.delivery_date && c.delivery_date < today)
    .sort((a, b) => (a.delivery_date || '').localeCompare(b.delivery_date || ''));

  const dueToday = cases.filter((c) => isActive(c) && c.delivery_date === today);
  const qcPending = cases.filter((c) => c.status === 'qc' || c.status === 'revision');
  const readyForDispatch = cases.filter((c) => c.status === 'ready');

  const refs = (xs: DentalCase[], max = 3) => {
    if (xs.length === 0) return '';
    const shown = xs.slice(0, max).map((c) => `#${c.case_number}`).join(', ');
    return xs.length > max ? `${shown} +${xs.length - max} more` : shown;
  };

  const worstOverdue = overdue[0];
  const overdueDays = worstOverdue?.delivery_date
    ? daysDiff(worstOverdue.delivery_date, today)
    : 0;

  return [
    {
      key: 'overdue',
      count: overdue.length,
      title: 'Overdue Cases',
      detail: refs(overdue),
      qualifier: overdueDays > 0 ? `${overdueDays} ${overdueDays === 1 ? 'day' : 'days'} late` : null,
      tone: 'risk',
    },
    {
      key: 'due_today',
      count: dueToday.length,
      title: 'Due Today',
      detail: refs(dueToday),
      qualifier: null,
      tone: 'warn',
    },
    {
      key: 'qc',
      count: qcPending.length,
      title: 'QC Pending',
      detail: qcPending.length ? refs(qcPending) : 'Nothing awaiting inspection',
      qualifier: qcPending.length === 1 ? 'Awaiting inspection' : null,
      tone: 'qc',
    },
    {
      key: 'ready',
      count: readyForDispatch.length,
      title: 'Ready for Dispatch',
      detail: refs(readyForDispatch),
      qualifier: readyForDispatch.length ? 'Today' : null,
      tone: 'pos',
    },
  ];
}

/* ── 4 · Today's schedule ─────────────────────────────────────────────── */

export type StageStatus = 'Ready' | 'QC Complete' | 'In Production' | 'Received' | 'Revision';
export interface ScheduleRow {
  id: string;
  /** Clock time the case entered its current stage. Null when unrecorded. */
  clock: string | null;
  caseNumber: string;
  patient: string;
  caseType: string;
  status: StageStatus;
  tone: 'pos' | 'qc' | 'accent' | 'muted' | 'risk';
}

const STATUS_TO_STAGE: Record<CaseStatus, ScheduleRow['status']> = {
  draft: 'Received',
  received: 'Received',
  in_progress: 'In Production',
  qc: 'QC Complete',
  ready: 'Ready',
  delivered: 'Ready',
  revision: 'Revision',
  cancelled: 'Received',
};

const STATUS_TONE: Record<CaseStatus, ScheduleRow['tone']> = {
  draft: 'muted',
  received: 'accent',
  in_progress: 'accent',
  qc: 'qc',
  ready: 'pos',
  delivered: 'pos',
  revision: 'risk',
  cancelled: 'muted',
};

/** Timestamp of the most recent status transition recorded on the case. */
function lastTransition(c: DentalCase): string | undefined {
  const h = c.history || [];
  return h.length ? h[h.length - 1].timestamp : c.updated_at;
}

export function computeTodaySchedule(input: MetricsInput, limit = 4): ScheduleRow[] {
  const today = input.todayStr ?? getTodayStr();
  return input.cases
    .filter((c) => c.delivery_date === today && c.status !== 'cancelled')
    .sort(
      (a, b) =>
        (lastTransition(a) || '').localeCompare(lastTransition(b) || '') ||
        a.case_number.localeCompare(b.case_number)
    )
    .slice(0, limit)
    .map((c) => ({
      id: c.id,
      clock: clockOf(lastTransition(c)),
      caseNumber: `#${c.case_number}`,
      patient: c.patient_name || c.doctor_name || 'Unassigned',
      caseType: c.case_type_name || 'Case',
      status: STATUS_TO_STAGE[c.status],
      tone: STATUS_TONE[c.status],
    }));
}

/* ── 5 · Revenue & collections ────────────────────────────────────────── */

export interface RevenuePoint {
  label: string;
  value: number;
}
export interface RevenueSummary {
  monthLabel: string;
  monthPrefix: string;
  /**
   * True when the requested month had no billing at all and the panel walked
   * back to the most recent month that did. The UI says so out loud — the
   * window is never silently swapped under the user.
   */
  isFallbackPeriod: boolean;
  billed: number;
  collected: number;
  outstanding: number;
  overdue: number;
  /** Percentages of `billed`; null when nothing was billed (no divide by 0). */
  collectedPct: number | null;
  outstandingPct: number | null;
  overduePct: number | null;
  /** Cumulative collections across the month — the chart's series. */
  series: RevenuePoint[];
  /** Month-over-month collections growth, or null when there is no baseline. */
  momPct: number | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Oct 2026` for a `YYYY-MM-DD` string. */
function monthLabel(prefix: string): string {
  const [y, m] = prefix.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function computeRevenue(input: MetricsInput, points = 6): RevenueSummary {
  const today = input.todayStr ?? getTodayStr();
  const currentPrefix = today.slice(0, 7);

  const billedIn = (prefix: string) =>
    input.invoices
      .filter((i) => inMonth(i.issue_date || i.created_at, prefix))
      .reduce((s, i) => s + i.final_amount, 0);

  // A calendar month can be legitimately empty — cases dated for delivery in
  // October are often registered in September. Rather than render a dead panel,
  // walk back to the most recent month that actually had billing, and flag it
  // so the header can say "last billed month" instead of pretending.
  let monthPrefix = currentPrefix;
  let isFallbackPeriod = false;
  if (billedIn(currentPrefix) === 0) {
    const prior = uniq(
      input.invoices
        .map((i) => (i.issue_date || i.created_at || '').slice(0, 7))
        .filter((p) => /^\d{4}-\d{2}$/.test(p) && p < currentPrefix)
    )
      .sort()
      .pop();
    if (prior) {
      monthPrefix = prior;
      isFallbackPeriod = true;
    }
  }

  const monthInvoices = input.invoices.filter((i) => inMonth(i.issue_date || i.created_at, monthPrefix));
  const billed = monthInvoices.reduce((s, i) => s + i.final_amount, 0);

  // Collections come from the payment register, not from `amount_paid` — that
  // column has no date on it, so a payment made last month would otherwise be
  // counted against this month.
  const monthPayments = input.payments.filter((p) => inMonth(p.payment_date, monthPrefix));
  const collected = monthPayments.reduce((s, p) => s + p.amount, 0);

  const outstanding = monthInvoices.reduce((s, i) => s + balanceOf(i), 0);
  const overdue = input.invoices
    .filter((i) => i.payment_status !== 'paid' && i.due_date && i.due_date < today)
    .reduce((s, i) => s + balanceOf(i), 0);

  const [y, m] = monthPrefix.split('-').map(Number);
  // Day-of-month the period was measured to: "today" for the current month,
  // end-of-month for a walked-back one.
  const elapsed = isFallbackPeriod
    ? new Date(y, m, 0).getDate()
    : Math.min(Number(today.slice(8, 10)), new Date(y, m, 0).getDate());

  // Cumulative collections sampled evenly across the elapsed part of the month.
  const series: RevenuePoint[] = [];
  if (monthPayments.length > 0) {
    const step = Math.max(1, Math.floor(elapsed / (points - 1)));
    for (let day = step; day <= elapsed; day += step) {
      const upto = `${monthPrefix}-${String(day).padStart(2, '0')}`;
      series.push({
        label: `${MONTHS[m - 1]} ${day}`,
        value: monthPayments
          .filter((p) => (p.payment_date || '').slice(0, 10) <= upto)
          .reduce((s, p) => s + p.amount, 0),
      });
    }
    // Always terminate on the current day so the line reaches "now".
    const last = series[series.length - 1];
    if (last.label !== `${MONTHS[m - 1]} ${elapsed}`) {
      series.push({ label: `${MONTHS[m - 1]} ${elapsed}`, value: collected });
    }
  }

  // Previous month, for the MoM delta.
  const prevPrefix = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const prevCollected = input.payments
    .filter((p) => inMonth(p.payment_date, prevPrefix))
    .reduce((s, p) => s + p.amount, 0);

  const pct = (part: number) => (billed > 0 ? Math.round((part / billed) * 100) : null);

  return {
    monthLabel: monthLabel(monthPrefix),
    monthPrefix,
    isFallbackPeriod,
    billed,
    collected,
    outstanding,
    overdue,
    collectedPct: pct(collected),
    outstandingPct: pct(outstanding),
    overduePct: pct(overdue),
    series,
    momPct: prevCollected > 0 ? Math.round(((collected - prevCollected) / prevCollected) * 100) : null,
  };
}

/* ── 6 · Cases at risk ────────────────────────────────────────────────── */

export type RiskLevel = 'Behind' | 'At Risk' | 'On Track';
export interface RiskRow {
  id: string;
  caseNumber: string;
  caseType: string;
  doctor: string;
  /** Days until delivery — negative means already past due. */
  daysOut: number;
  level: RiskLevel;
}

export function computeAtRisk(input: MetricsInput, limit = 4): RiskRow[] {
  const today = input.todayStr ?? getTodayStr();
  return input.cases
    .filter((c) => isActive(c) && c.delivery_date)
    .map((c) => {
      const daysOut = daysDiff(c.delivery_date, today);
      const level: RiskLevel =
        daysOut < 0 || c.status === 'revision'
          ? 'Behind'
          : daysOut <= 2 || c.priority === 'urgent' || c.priority === 'high'
            ? 'At Risk'
            : 'On Track';
      return {
        id: c.id,
        caseNumber: `#${c.case_number}`,
        caseType: c.case_type_name || 'Case',
        doctor: c.doctor_name || '—',
        daysOut,
        level,
      };
    })
    .sort((a, b) => a.daysOut - b.daysOut || a.caseNumber.localeCompare(b.caseNumber))
    .slice(0, limit);
}

/* ── 7 · Recent activity ──────────────────────────────────────────────── */

export interface ActivityRow {
  id: string;
  /** Past-tense sentence, e.g. "moved to Quality Check". */
  text: string;
  stamp: string;
  tone: 'accent' | 'qc' | 'pos' | 'warn' | 'risk';
}

const STAGE_PHRASE: Record<CaseStatus, string> = {
  draft: 'created as a draft',
  received: 'received at the bench',
  in_progress: 'moved to Production',
  qc: 'moved to Quality Check',
  ready: 'marked Ready for Dispatch',
  delivered: 'marked delivered',
  revision: 'sent back for revision',
  cancelled: 'cancelled',
};

export function computeRecentActivity(input: MetricsInput, limit = 5): ActivityRow[] {
  const rows: ActivityRow[] = [];

  for (const c of input.cases) {
    const history = c.history || [];
    const last = history[history.length - 1];
    if (!last) continue;
    rows.push({
      id: `${c.id}-${last.id || rows.length}`,
      text: `${c.case_number} ${STAGE_PHRASE[last.status] || 'updated'}`,
      stamp: last.timestamp,
      tone:
        last.status === 'revision' || last.status === 'cancelled'
          ? 'risk'
          : last.status === 'delivered' || last.status === 'ready'
            ? 'pos'
            : last.status === 'qc'
              ? 'qc'
              : last.status === 'received'
                ? 'warn'
                : 'accent',
    });
  }

  for (const p of input.payments) {
    rows.push({
      id: `${p.id}-pay`,
      text: `PKR ${Math.round(p.amount).toLocaleString()} payment received`,
      stamp: `${p.payment_date} 12:00`,
      tone: 'pos',
    });
  }

  // `YYYY-MM-DD HH:mm:ss` sorts correctly as a plain string.
  return rows
    .filter((r) => !!r.stamp)
    .sort((a, b) => b.stamp.localeCompare(a.stamp))
    .slice(0, limit);
}

/* ── 8 · Workload ─────────────────────────────────────────────────────── */

export interface WorkloadRow {
  label: string;
  pct: number;
  tone: 'accent' | 'qc' | 'pos' | 'warn' | 'dispatch';
}

/**
 * Share of on-bench work per material.
 *
 * The reference mock shows bench-department utilisation (CAD/CAM, Waxing,
 * Sintering…), which needs a per-case department assignment the schema does
 * not have. Rather than invent five constant percentages, this reports the
 * split that IS real: which materials are sitting on the bench, and how much
 * of the bench each one is. Same shape, same reading, no fiction.
 */
export function computeWorkload(input: MetricsInput): { rows: WorkloadRow[]; overallPct: number | null } {
  const today = input.todayStr ?? getTodayStr();
  const bench = input.cases.filter((c) => isActive(c) && c.status !== 'draft');
  if (bench.length === 0) return { rows: [], overallPct: null };

  const counts = new Map<string, number>();
  for (const c of bench) {
    const key = titleCase(materialOf(c));
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const toneCycle: WorkloadRow['tone'][] = ['accent', 'qc', 'pos', 'warn', 'dispatch'];
  const rows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([label, count], i) => ({
      label,
      // Share of the bench, never a share of a made-up capacity ceiling.
      pct: Math.round((count / bench.length) * 100),
      tone: toneCycle[i % toneCycle.length],
    }));

  // "Overall load": the share of the bench that is due within seven days.
  const horizon = offsetDay(today, 7);
  const dueSoon = bench.filter((c) => c.delivery_date && c.delivery_date <= horizon).length;
  return { rows, overallPct: Math.round((dueSoon / bench.length) * 100) };
}

/* ── 9 · Lab performance ──────────────────────────────────────────────── */

export interface PerformanceRow {
  label: string;
  value: string;
}

export function computePerformance(input: MetricsInput): PerformanceRow[] {
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

  // Rework = every revision transition ever recorded against a completed case.
  const reworkEvents = cases.reduce(
    (s, c) => s + (c.history || []).filter((h) => h.status === 'revision').length,
    0
  );
  const reworkRate =
    completed.length > 0 ? Math.round((reworkEvents / completed.length) * 1000) / 10 : null;

  const monthInvoices = invoices.filter((i) => inMonth(i.issue_date || i.created_at, monthPrefix));
  const monthBilled = monthInvoices.reduce((s, i) => s + i.final_amount, 0);
  const revenuePerCase = monthCompleted.length > 0 ? Math.round(monthBilled / monthCompleted.length) : null;

  const topMaterial = (() => {
    const counts = new Map<string, number>();
    for (const i of monthInvoices) {
      const key = titleCase(i.case_type_name || 'Case');
      counts.set(key, (counts.get(key) || 0) + i.final_amount);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
  })();

  const topClinic = (() => {
    const byLab = new Map<string, number>();
    for (const i of monthInvoices) {
      byLab.set(i.lab_name, (byLab.get(i.lab_name) || 0) + i.final_amount);
    }
    const top = [...byLab.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
  })();

  const dash = '—';
  return [
    { label: 'Avg. Turnaround', value: avgTurnaround === null ? dash : `${avgTurnaround} days` },
    {
      label: 'On-Time Delivery',
      value: completed.length === 0 ? dash : `${Math.round((onTime.length / completed.length) * 100)}%`,
    },
    { label: 'Cases Completed', value: monthCompleted.length ? monthCompleted.length.toString() : dash },
    { label: 'Rework Rate', value: reworkRate === null ? dash : `${reworkRate}%` },
    { label: 'Revenue / Case', value: revenuePerCase === null ? dash : `PKR ${revenuePerCase.toLocaleString()}` },
    { label: 'Top Material', value: topMaterial ?? dash },
    { label: 'Top Clinic', value: topClinic ?? dash },
  ];
}

/* ── 10 · Upcoming deliveries ─────────────────────────────────────────── */

export interface UpcomingRow {
  id: string;
  caseNumber: string;
  patient: string;
  caseType: string;
  /** Clock time of the current-stage transition, when one is recorded. */
  clock: string | null;
  dateLabel: string;
  status: string;
  tone: ScheduleRow['tone'];
}

export function computeUpcoming(input: MetricsInput, limit = 4): UpcomingRow[] {
  const today = input.todayStr ?? getTodayStr();
  return input.cases
    .filter((c) => isActive(c) && c.delivery_date && c.delivery_date >= today)
    .sort(
      (a, b) =>
        (a.delivery_date || '').localeCompare(b.delivery_date || '') ||
        a.case_number.localeCompare(b.case_number)
    )
    .slice(0, limit)
    .map((c) => ({
      id: c.id,
      caseNumber: `#${c.case_number}`,
      patient: c.patient_name || c.doctor_name || 'Unassigned',
      caseType: c.case_type_name || 'Case',
      clock: clockOf(lastTransition(c)),
      dateLabel: c.delivery_date === today ? 'Today' : c.delivery_date.slice(5).replace('-', '/'),
      status: c.status === 'ready' ? 'Ready' : STATUS_TO_STAGE[c.status],
      tone: STATUS_TONE[c.status],
    }));
}

/* ── 11 · Aggregate ───────────────────────────────────────────────────── */

export interface DashboardMetrics {
  kpis: KpiRow;
  workflow: WorkflowStage[];
  attention: AttentionRow[];
  schedule: ScheduleRow[];
  revenue: RevenueSummary;
  atRisk: RiskRow[];
  activity: ActivityRow[];
  workload: { rows: WorkloadRow[]; overallPct: number | null };
  performance: PerformanceRow[];
  upcoming: UpcomingRow[];
  /** Distinct clinics with any activity — the "across N clinics" line. */
  clinicCount: number;
  activeClinics: string[];
}

export function computeDashboardMetrics(input: MetricsInput): DashboardMetrics {
  const active = input.cases.filter(isActive);
  return {
    kpis: computeKpis(input),
    workflow: computeWorkflow(input),
    attention: computeAttention(input),
    schedule: computeTodaySchedule(input),
    revenue: computeRevenue(input),
    atRisk: computeAtRisk(input),
    activity: computeRecentActivity(input),
    workload: computeWorkload(input),
    performance: computePerformance(input),
    upcoming: computeUpcoming(input),
    clinicCount: uniq(active.map((c) => c.lab_id)).length,
    activeClinics: uniq(active.map((c) => c.lab_name)),
  };
}