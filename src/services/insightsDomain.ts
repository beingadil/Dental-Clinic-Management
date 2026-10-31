import type { DentalCase, DentalLab, Invoice, CaseType } from '../types';
import { formatPKR } from './financeDomain';

/* ─────────────────────────────────────────────────────────────────────── */
/* Types — the contract between the service and the widget layer. Widgets    */
/* never touch the DB; they only read these metric objects.                */
/* ─────────────────────────────────────────────────────────────────────── */

export type PeriodKind = 'thisMonth' | 'lastMonth' | 'thisYear' | 'allTime';

export interface PeriodSpec {
  kind: PeriodKind;
  /** Reference "now" — injectable for deterministic tests. */
  now?: Date;
}

export interface DateRange {
  start: number; // epoch ms, inclusive
  end: number;   // epoch ms, exclusive
  label: string;
}

export interface InsightsFilters {
  clinicIds: string[];
  doctorNames: string[];
  caseTypeIds: string[];
}

export interface KpiMetrics {
  invoiced: number;
  collected: number;
  outstanding: number;
  cases: number;
  invoicedPrev: number;
  collectedPrev: number;
  outstandingPrev: number;
  casesPrev: number;
}

export interface FlowPoint {
  label: string;
  invoiced: number;
  collected: number;
  ts: number;
}

export interface FlowSeries {
  points: FlowPoint[];
}

export interface ProductMixItem {
  name: string;
  value: number;
  color: string;
}

export interface ProductMix {
  items: ProductMixItem[];
  total: number;
}

export interface ClinicStanding {
  id: string;
  name: string;
  revenue: number;
  balance: number;
  cases: number;
}

export interface ClinicStandings {
  rows: ClinicStanding[];
}

export interface ThroughputPoint {
  label: string;
  received: number;
  delivered: number;
}

export interface ThroughputSeries {
  points: ThroughputPoint[];
}

export interface RingMetrics {
  collectionRate: number; // 0..100
  deliveryRate: number;   // 0..100
  revisionRate: number;   // 0..100
  totalCases: number;
}

export interface DayHeat {
  days: { dow: number; label: string; count: number }[];
  total: number;
}

export interface DoctorRadarItem {
  doctor: string;
  cases: number;
  revenue: number;
}

export interface DoctorRadar {
  items: DoctorRadarItem[];
}

export interface InsightsMetrics {
  period: DateRange;
  prevPeriod: DateRange;
  kpi: KpiMetrics;
  flow: FlowSeries;
  productMix: ProductMix;
  clinicStandings: ClinicStandings;
  throughput: ThroughputSeries;
  rings: RingMetrics;
  dayHeat: DayHeat;
  doctorRadar: DoctorRadar;
  /** IDs of invoices inside the current period + filters (for drill-in). */
  inScopeInvoiceIds: string[];
  /** IDs of cases inside the current period + filters (for drill-in). */
  inScopeCaseIds: string[];
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Date helpers — local midnight, never UTC (the +05:00 lesson).          */
/* ─────────────────────────────────────────────────────────────────────── */

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function toLocalDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const head = String(s).slice(0, 10);
  const m = head.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

export function periodRange(spec: PeriodSpec): DateRange {
  const now = spec.now ?? new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  let start: Date;
  let end: Date;
  let label: string;
  switch (spec.kind) {
    case 'lastMonth': {
      start = new Date(y, m - 1, 1);
      end = new Date(y, m, 1);
      label = start.toLocaleString('en-US', { month: 'long', year: 'numeric' });
      break;
    }
    case 'thisYear': {
      start = new Date(y, 0, 1);
      end = new Date(y + 1, 0, 1);
      label = String(y);
      break;
    }
    case 'allTime': {
      start = new Date(1970, 0, 1);
      end = new Date(y + 1, 11, 31, 23, 59, 59, 999);
      label = 'All time';
      break;
    }
    case 'thisMonth':
    default: {
      start = new Date(y, m, 1);
      end = new Date(y, m + 1, 1);
      label = start.toLocaleString('en-US', { month: 'long', year: 'numeric' });
      break;
    }
  }
  return { start: start.getTime(), end: end.getTime(), label };
}

/** Previous equal-length window immediately before `range`. */
export function prevRange(range: DateRange): DateRange {
  const span = range.end - range.start;
  const end = range.start;
  const start = end - span;
  const s = new Date(start);
  const e = new Date(end);
  return { start, end, label: `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` };
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Filtering helpers                                                      */
/* ─────────────────────────────────────────────────────────────────────── */

function inRange(ts: number, range: DateRange): boolean {
  return ts >= range.start && ts < range.end;
}

function caseDate(c: DentalCase): number {
  const d = toLocalDate(c.received_date || c.created_at);
  return d ? d.getTime() : 0;
}

function invoiceDate(inv: Invoice): number {
  const d = toLocalDate(inv.issue_date || inv.created_at);
  return d ? d.getTime() : 0;
}

function caseTypeOf(c: DentalCase, caseTypes: CaseType[]): string {
  const ct = caseTypes.find((t) => t.id === c.case_type_id);
  return ct?.name || c.case_type_name || 'Other';
}

function matchesFilters(
  c: DentalCase,
  filters: InsightsFilters,
): boolean {
  if (filters.clinicIds.length && !filters.clinicIds.includes(c.lab_id)) return false;
  if (filters.doctorNames.length && !filters.doctorNames.includes(c.doctor_name)) return false;
  if (filters.caseTypeIds.length && !filters.caseTypeIds.includes(c.case_type_id)) return false;
  return true;
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Aggregation                                                            */
/* ─────────────────────────────────────────────────────────────────────── */

const PRODUCT_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4', '#64748b', '#ec4899'];

export function buildInsightsSnapshot(
  input: {
    cases: DentalCase[];
    invoices: Invoice[];
    labs: DentalLab[];
    caseTypes: CaseType[];
  },
  spec: PeriodSpec,
  filters: InsightsFilters = { clinicIds: [], doctorNames: [], caseTypeIds: [] },
): InsightsMetrics {
  const period = periodRange(spec);
  const prev = prevRange(period);

  const cases = input.cases || [];
  const invoices = input.invoices || [];
  const labs = input.labs || [];
  const caseTypes = input.caseTypes || [];

  // invoices by case id for joins
  const invoicesByCase = new Map<string, Invoice[]>();
  for (const inv of invoices) {
    if (!inv.case_id) continue;
    const arr = invoicesByCase.get(inv.case_id) || [];
    arr.push(inv);
    invoicesByCase.set(inv.case_id, arr);
  }

  const filteredCases = cases.filter((c) => matchesFilters(c, filters));

  // ── KPI ──
  const kpiInvoices = invoices.filter((inv) => {
    const ts = invoiceDate(inv);
    if (!inRange(ts, period)) return false;
    if (filters.clinicIds.length && !filters.clinicIds.includes(inv.lab_id)) return false;
    // doctor/caseType filters via case lookup
    const c = cases.find((x) => x.id === inv.case_id || x.case_number === inv.case_number);
    if (c) {
      if (filters.doctorNames.length && !filters.doctorNames.includes(c.doctor_name)) return false;
      if (filters.caseTypeIds.length && !filters.caseTypeIds.includes(c.case_type_id)) return false;
    }
    return true;
  });

  const sumInvoiced = (list: Invoice[]) => list.reduce((s, i) => s + (i.final_amount || 0), 0);
  const sumCollected = (list: Invoice[]) => list.reduce((s, i) => s + (i.amount_paid || 0), 0);

  const invoiced = sumInvoiced(kpiInvoices);
  const collected = sumCollected(kpiInvoices);
  const outstanding = Math.max(0, invoiced - collected);

  const periodCases = filteredCases.filter((c) => inRange(caseDate(c), period));
  const casesCount = periodCases.length;

  // prev
  const prevInvoices = invoices.filter((inv) => {
    const ts = invoiceDate(inv);
    if (!inRange(ts, prev)) return false;
    if (filters.clinicIds.length && !filters.clinicIds.includes(inv.lab_id)) return false;
    const c = cases.find((x) => x.id === inv.case_id || x.case_number === inv.case_number);
    if (c) {
      if (filters.doctorNames.length && !filters.doctorNames.includes(c.doctor_name)) return false;
      if (filters.caseTypeIds.length && !filters.caseTypeIds.includes(c.case_type_id)) return false;
    }
    return true;
  });
  const prevCases = filteredCases.filter((c) => inRange(caseDate(c), prev));
  const invoicedPrev = sumInvoiced(prevInvoices);
  const collectedPrev = sumCollected(prevInvoices);
  const outstandingPrev = Math.max(0, invoicedPrev - collectedPrev);

  const kpi: KpiMetrics = {
    invoiced, collected, outstanding, cases: casesCount,
    invoicedPrev, collectedPrev, outstandingPrev, casesPrev: prevCases.length,
  };

  // ── Flow series (money in over time) ──
  // Granularity: weekly for month views, monthly otherwise.
  const monthly = spec.kind === 'thisYear' || spec.kind === 'allTime';
  const bucketKey = (ts: number) => {
    const d = new Date(ts);
    if (monthly) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    // week index within period
    const week = Math.floor((ts - period.start) / (7 * 24 * 60 * 60 * 1000));
    return `W${week + 1}`;
  };
  const bucketLabel = (key: string, ts: number) => {
    const d = new Date(ts);
    if (monthly) return d.toLocaleString('en-US', { month: 'short' });
    return `W${key.slice(1)}`;
  };

  const flowMap = new Map<string, { invoiced: number; collected: number; firstTs: number }>();
  for (const inv of kpiInvoices) {
    const ts = invoiceDate(inv);
    if (ts === 0) continue;
    const key = bucketKey(ts);
    const e = flowMap.get(key) || { invoiced: 0, collected: 0, firstTs: ts };
    e.invoiced += inv.final_amount || 0;
    e.collected += inv.amount_paid || 0;
    if (ts < e.firstTs) e.firstTs = ts;
    flowMap.set(key, e);
  }
  const flowPoints: FlowPoint[] = Array.from(flowMap.entries())
    .map(([key, v]) => ({ label: bucketLabel(key, v.firstTs), invoiced: v.invoiced, collected: v.collected, ts: v.firstTs }))
    .sort((a, b) => a.ts - b.ts);
  const flow: FlowSeries = { points: flowPoints };

  // ── Product mix (revenue by case type) ──
  const mixMap = new Map<string, number>();
  for (const inv of kpiInvoices) {
    const c = cases.find((x) => x.id === inv.case_id || x.case_number === inv.case_number);
    const name = c ? caseTypeOf(c, caseTypes) : (inv.case_type_name || 'Other');
    mixMap.set(name, (mixMap.get(name) || 0) + (inv.final_amount || 0));
  }
  // cases without invoices in period still count as revenue potential
  for (const c of periodCases) {
    const hasInv = kpiInvoices.some((i) => i.case_id === c.id || i.case_number === c.case_number);
    if (!hasInv) {
      const name = caseTypeOf(c, caseTypes);
      mixMap.set(name, (mixMap.get(name) || 0) + (c.final_price || 0));
    }
  }
  const mixItems: ProductMixItem[] = Array.from(mixMap.entries())
    .map(([name, value], i) => ({ name, value, color: PRODUCT_COLORS[i % PRODUCT_COLORS.length] }))
    .sort((a, b) => b.value - a.value);
  const productMix: ProductMix = { items: mixItems, total: mixItems.reduce((s, i) => s + i.value, 0) };

  // ── Clinic standings ──
  const standingMap = new Map<string, { name: string; revenue: number; balance: number; cases: number }>();
  for (const lab of labs) {
    standingMap.set(lab.id, { name: lab.name, revenue: 0, balance: 0, cases: 0 });
  }
  for (const inv of kpiInvoices) {
    const e = standingMap.get(inv.lab_id);
    if (e) { e.revenue += inv.final_amount || 0; e.balance += Math.max(0, (inv.final_amount || 0) - (inv.amount_paid || 0)); }
  }
  for (const c of periodCases) {
    const e = standingMap.get(c.lab_id);
    if (e) e.cases += 1;
  }
  const rows: ClinicStanding[] = Array.from(standingMap.entries())
    .map(([id, v]) => ({ id, name: v.name, revenue: v.revenue, balance: v.balance, cases: v.cases }))
    .filter((r) => filters.clinicIds.length === 0 || filters.clinicIds.includes(r.id))
    .sort((a, b) => b.revenue - a.revenue);
  const clinicStandings: ClinicStandings = { rows };

  // ── Throughput (received vs delivered per bucket) ──
  const tpMap = new Map<string, { received: number; delivered: number; firstTs: number }>();
  for (const c of filteredCases) {
    const rts = caseDate(c);
    if (inRange(rts, period) && rts > 0) {
      const key = bucketKey(rts);
      const e = tpMap.get(key) || { received: 0, delivered: 0, firstTs: rts };
      e.received += 1;
      if (rts < e.firstTs) e.firstTs = rts;
      tpMap.set(key, e);
    }
    // delivered: cases whose status is delivered — count in the week they were delivered (use updated_at)
    if (c.status === 'delivered') {
      const dts = toLocalDate(c.updated_at)?.getTime() ?? 0;
      if (dts > 0 && inRange(dts, period)) {
        const key = bucketKey(dts);
        const e = tpMap.get(key) || { received: 0, delivered: 0, firstTs: dts };
        e.delivered += 1;
        if (dts < e.firstTs) e.firstTs = dts;
        tpMap.set(key, e);
      }
    }
  }
  const tpPoints: ThroughputPoint[] = Array.from(tpMap.entries())
    .map(([key, v]) => ({ label: bucketLabel(key, v.firstTs), received: v.received, delivered: v.delivered }))
    .sort((a, b) => a.label.localeCompare(b.label));
  // sort by firstTs not available after map; re-sort by label index fallback — keep insertion order via array
  const throughput: ThroughputSeries = { points: tpPoints };

  // ── Rings ──
  const totalCases = periodCases.length;
  const deliveredCount = periodCases.filter((c) => c.status === 'delivered').length;
  const revisionCount = periodCases.filter((c) => c.status === 'revision').length;
  const rings: RingMetrics = {
    collectionRate: invoiced > 0 ? Math.round((collected / invoiced) * 100) : 0,
    deliveryRate: totalCases > 0 ? Math.round((deliveredCount / totalCases) * 100) : 0,
    revisionRate: totalCases > 0 ? Math.round((revisionCount / totalCases) * 100) : 0,
    totalCases,
  };

  // ── Day heat (day of week) ──
  const dowCounts = new Array(7).fill(0);
  for (const c of periodCases) {
    const ts = caseDate(c);
    if (ts > 0) dowCounts[new Date(ts).getDay()] += 1;
  }
  const dayHeat: DayHeat = {
    days: dowCounts.map((count, dow) => ({ dow, label: DOW_LABELS[dow], count })),
    total: periodCases.length,
  };

  // ── Doctor radar ──
  const docMap = new Map<string, { cases: number; revenue: number }>();
  for (const c of periodCases) {
    if (filters.doctorNames.length && !filters.doctorNames.includes(c.doctor_name)) continue;
    const e = docMap.get(c.doctor_name) || { cases: 0, revenue: 0 };
    e.cases += 1;
    e.revenue += c.final_price || 0;
    docMap.set(c.doctor_name, e);
  }
  const doctorRadar: DoctorRadar = {
    items: Array.from(docMap.entries())
      .map(([doctor, v]) => ({ doctor, cases: v.cases, revenue: v.revenue }))
      .sort((a, b) => b.cases - a.cases)
      .slice(0, 8),
  };

  return {
    period, prevPeriod: prev,
    kpi, flow, productMix, clinicStandings, throughput, rings, dayHeat, doctorRadar,
    inScopeInvoiceIds: kpiInvoices.map((i) => i.id),
    inScopeCaseIds: periodCases.map((c) => c.id),
  };
}

export { formatPKR };
