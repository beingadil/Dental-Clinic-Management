import { getDatabase } from '../db';
import { PRIORITY_SLA_DAYS, PRIORITY_ORDER } from './prioritySla';
import { PriorityLevel } from '../types';

/**
 * SQL-backed operational analytics. Every figure is computed from SQLite —
 * no component-side filtering of transient React state.
 *
 * Queries stay small and readable; aggregation happens in JS over the (small)
 * result sets instead of dense SQL CTEs. Cases migrated from the legacy app
 * may have sparse status history — missing data renders as "—" upstream,
 * never as a fake number.
 */

export interface TurnaroundRow {
  priority: PriorityLevel;
  avgDays: number | null;
  onTimePct: number | null;
  sample: number;
}

export interface RestorationRevenueRow {
  material: string;
  cases: number;
  revenue: number;
}

export interface ClinicPaymentRow {
  labId: string;
  labName: string;
  invoices: number;
  billed: number;
  collected: number;
  outstanding: number;
  avgDaysToPay: number | null;
  advances: number;
}

export interface AnalyticsBundle {
  turnaround: TurnaroundRow[];
  restorationRevenue: RestorationRevenueRow[];
  paymentBehavior: ClinicPaymentRow[];
  overall: { avgDays: number | null; onTimePct: number | null; delivered: number };
  generatedAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (a: string, b: string): number =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY_MS);

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10;

export function computeAnalytics(): AnalyticsBundle {
  const db = getDatabase();

  // ---- Turnaround per priority (delivery vs. created / SLA due date) ----
  const delivered = db.all<{ priority: string; created_at: string; delivery_date: string | null; first_delivery: string | null }>(`
    SELECT c.priority, c.created_at, c.delivery_date,
      (SELECT MIN(h.timestamp) FROM case_status_history h WHERE h.case_id = c.id AND h.status = 'delivered') AS first_delivery
    FROM cases c
    WHERE c.status = 'delivered' AND c.created_at IS NOT NULL
  `);

  const byPriority = new Map<PriorityLevel, { days: number[]; onTime: number[] }>();
  const allDays: number[] = [];
  const allOnTime: number[] = [];
  let deliveredCount = 0;
  for (const r of delivered) {
    const p: PriorityLevel = (PRIORITY_ORDER as string[]).includes(r.priority) ? (r.priority as PriorityLevel) : 'normal';
    if (!r.first_delivery) continue;
    const bucket = byPriority.get(p) ?? { days: [], onTime: [] };
    const days = Math.max(0, daysBetween(r.created_at, r.first_delivery));
    // On-time = delivered by the case's promised date, or by its SLA date when
    // no explicit delivery date was set. Cases with neither are skipped.
    let onTime: number;
    if (r.delivery_date) {
      onTime = r.first_delivery.slice(0, 10) <= r.delivery_date ? 1 : 0;
    } else {
      const slaDue = new Date(new Date(r.created_at).getTime() + PRIORITY_SLA_DAYS[p] * DAY_MS)
        .toISOString()
        .slice(0, 10);
      onTime = r.first_delivery.slice(0, 10) <= slaDue ? 1 : 0;
    }
    bucket.days.push(days);
    bucket.onTime.push(onTime);
    byPriority.set(p, bucket);
    allDays.push(days);
    allOnTime.push(onTime);
    deliveredCount += 1;
  }

  const turnaround: TurnaroundRow[] = PRIORITY_ORDER.map((p) => {
    const b = byPriority.get(p);
    return {
      priority: p,
      avgDays: b ? mean(b.days) : null,
      onTimePct: b && b.onTime.length > 0 ? Math.round((b.onTime.reduce((s, x) => s + x, 0) / b.onTime.length) * 100) : null,
      sample: b ? b.days.length : 0,
    };
  });

  // ---- Revenue by restoration material (case_teeth × invoices) ----
  const materials = db.all<{ case_id: string; material: string }>(
    `SELECT case_id, COALESCE(NULLIF(TRIM(material), ''), 'Unspecified') AS material
     FROM case_teeth GROUP BY case_id, material`
  );
  const caseRevenue = new Map(
    db.all<{ case_id: string; amt: number }>(
      `SELECT case_id, SUM(final_amount) AS amt FROM invoices WHERE case_id IS NOT NULL GROUP BY case_id`
    ).map((r) => [r.case_id, r.amt])
  );
  const byMaterial = new Map<string, { cases: number; revenue: number }>();
  for (const m of materials) {
    const b = byMaterial.get(m.material) ?? { cases: 0, revenue: 0 };
    b.cases += 1;
    b.revenue += caseRevenue.get(m.case_id) ?? 0;
    byMaterial.set(m.material, b);
  }
  const restorationRevenue: RestorationRevenueRow[] = [...byMaterial.entries()]
    .map(([material, b]) => ({ material, cases: b.cases, revenue: Math.round(b.revenue) }))
    .sort((a, b) => b.revenue - a.revenue || b.cases - a.cases);

  // ---- Payment behavior per clinic ----
  const labAgg = db.all<{ lab_id: string; lab_name: string; invoices: number; billed: number; collected: number }>(
    `SELECT lab_id, MAX(lab_name) AS lab_name, COUNT(*) AS invoices,
            SUM(final_amount) AS billed, SUM(amount_paid) AS collected
     FROM invoices GROUP BY lab_id`
  );
  const invoiceCreated = new Map(
    db.all<{ id: string; created_at: string }>(`SELECT id, created_at FROM invoices WHERE created_at IS NOT NULL`)
      .map((r) => [r.id, r.created_at])
  );
  const payDays = new Map<string, number[]>();
  for (const p of db.all<{ lab_id: string | null; invoice_id: string | null; payment_date: string }>(
    `SELECT lab_id, invoice_id, payment_date FROM payments WHERE invoice_id IS NOT NULL`
  )) {
    const created = p.invoice_id ? invoiceCreated.get(p.invoice_id) : undefined;
    if (!p.lab_id || !created) continue;
    const list = payDays.get(p.lab_id) ?? [];
    list.push(Math.max(0, daysBetween(created, p.payment_date)));
    payDays.set(p.lab_id, list);
  }
  const advances = new Map(
    db.all<{ lab_id: string; amt: number }>(`SELECT lab_id, SUM(amount) AS amt FROM advance_payments GROUP BY lab_id`)
      .map((r) => [r.lab_id, r.amt])
  );

  const paymentBehavior: ClinicPaymentRow[] = labAgg
    .map((r) => ({
      labId: r.lab_id,
      labName: r.lab_name,
      invoices: r.invoices,
      billed: Math.round(r.billed || 0),
      collected: Math.round(r.collected || 0),
      outstanding: Math.round((r.billed || 0) - (r.collected || 0)),
      avgDaysToPay: mean(payDays.get(r.lab_id) ?? []),
      advances: Math.round(advances.get(r.lab_id) ?? 0),
    }))
    .sort((a, b) => b.billed - a.billed);

  return {
    turnaround,
    restorationRevenue,
    paymentBehavior,
    overall: { avgDays: mean(allDays), onTimePct: allOnTime.length > 0 ? Math.round((allOnTime.reduce((s, x) => s + x, 0) / allOnTime.length) * 100) : null, delivered: deliveredCount },
    generatedAt: new Date().toISOString(),
  };
}
