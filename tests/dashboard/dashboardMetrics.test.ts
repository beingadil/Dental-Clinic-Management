/**
 * @vitest-environment jsdom
 *
 * The dashboard's contract is that every figure traces to a real row. These
 * tests pin that contract: the module must never invent a number, must judge
 * business dates in local time, and must report emptiness honestly.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDashboardMetrics,
  computeKpis,
  computeRevenue,
  computeWorkload,
  computeTodaySchedule,
  computeAtRisk,
  type MetricsInput,
} from '../../src/components/dashboard/dashboardMetrics';
import { computePerformance } from '../../src/components/dashboard/dashboardPerformance';
import type { DentalCase, Invoice, PaymentRecord } from '../../src/types';

const TODAY = '2026-10-03';

let seq = 0;
const makeCase = (over: Partial<DentalCase> = {}): DentalCase => ({
  id: `c${++seq}`,
  case_number: `DS-${String(seq).padStart(4, '0')}`,
  lab_id: 'lab-1',
  lab_name: 'ABC Dental',
  case_type_id: 'ct-1',
  case_type_name: 'Zirconia Crown',
  doctor_name: 'Dr. Khan',
  selected_teeth: [11],
  delivery_date: TODAY,
  priority: 'normal',
  price: 1000,
  discount: 0,
  final_price: 1000,
  status: 'received',
  created_at: `${TODAY} 09:00`,
  updated_at: `${TODAY} 09:00`,
  history: [
    {
      id: `h${seq}`,
      case_id: `c${seq}`,
      status: 'received',
      notes: '',
      timestamp: `${TODAY} 09:00`,
      updated_by: 'adil',
    },
  ],
  ...over,
});

const makeInvoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: `i${++seq}`,
  invoice_number: `INV-${seq}`,
  case_id: `c${seq}`,
  case_number: 'DS-0001',
  lab_id: 'lab-1',
  lab_name: 'ABC Dental',
  case_type_name: 'Zirconia Crown',
  doctor_name: 'Dr. Khan',
  amount: 1000,
  discount: 0,
  final_amount: 1000,
  amount_paid: 0,
  payment_status: 'unpaid',
  due_date: TODAY,
  created_at: `${TODAY} 09:00`,
  payments: [],
  ...over,
});

const makePayment = (over: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: `p${++seq}`,
  invoice_id: 'i1',
  amount: 500,
  payment_method: 'cash',
  payment_date: TODAY,
  recorded_by: 'adil',
  ...over,
});

const base = (over: Partial<MetricsInput> = {}): MetricsInput => ({
  cases: [],
  invoices: [],
  payments: [],
  labs: [],
  todayStr: TODAY,
  ...over,
});

describe('computeKpis', () => {
  it('counts active cases and excludes delivered and cancelled ones', () => {
    const kpis = computeKpis(
      base({
        cases: [
          makeCase({ status: 'received' }),
          makeCase({ status: 'in_progress' }),
          makeCase({ status: 'qc' }),
          makeCase({ status: 'ready' }),
          makeCase({ status: 'delivered' }),
          makeCase({ status: 'cancelled' }),
        ],
      })
    );
    expect(kpis.activeCases).toBe(4);
    expect(kpis.inProduction).toBe(3); // in_progress + qc + ready
  });

  it('sums outstanding as billed minus paid and never goes negative', () => {
    const kpis = computeKpis(
      base({
        invoices: [
          makeInvoice({ final_amount: 1000, amount_paid: 400 }),
          makeInvoice({ final_amount: 500, amount_paid: 0 }),
          // A credit note overpaid this one; the balance must floor at zero.
          makeInvoice({ final_amount: 200, amount_paid: 650 }),
        ],
      })
    );
    expect(kpis.outstanding).toBe(1100);
  });

  it('counts only unpaid, past-due invoices as overdue', () => {
    const kpis = computeKpis(
      base({
        invoices: [
          makeInvoice({ due_date: '2026-10-01', amount_paid: 0, final_amount: 1000 }),
          makeInvoice({ due_date: '2026-10-01', amount_paid: 1000, final_amount: 1000, payment_status: 'paid' }),
          makeInvoice({ due_date: '2026-10-05', amount_paid: 0, final_amount: 1000 }),
        ],
      })
    );
    expect(kpis.overdueCount).toBe(1);
    expect(kpis.overdueAmount).toBe(1000);
  });

  it('judges "today" against the injected day, not the wall clock', () => {
    // A case delivered on the injected today is a today delivery even though
    // the machine clock is nowhere near 2026-10-03.
    const kpis = computeKpis(base({ cases: [makeCase({ delivery_date: TODAY })] }));
    expect(kpis.deliveriesToday).toBe(1);
  });

  it('returns zeros rather than throwing on an empty dataset', () => {
    const kpis = computeKpis(base());
    expect(kpis.activeCases).toBe(0);
    expect(kpis.outstanding).toBe(0);
    expect(kpis.nextDeliveryRef).toBeNull();
  });
});

describe('computeRevenue', () => {
  it('reports null percentages rather than dividing by zero', () => {
    const revenue = computeRevenue(base());
    expect(revenue.billed).toBe(0);
    expect(revenue.collectedPct).toBeNull();
    expect(revenue.outstandingPct).toBeNull();
    expect(revenue.overduePct).toBeNull();
    expect(revenue.momPct).toBeNull();
  });

  it('walks back to the last billed month and flags that it did', () => {
    const revenue = computeRevenue(
      base({
        invoices: [makeInvoice({ created_at: '2026-09-14 10:00', final_amount: 4000 })],
      })
    );
    expect(revenue.isFallbackPeriod).toBe(true);
    expect(revenue.monthPrefix).toBe('2026-09');
    expect(revenue.billed).toBe(4000);
  });

  it('stays on the current month when it has billing', () => {
    const revenue = computeRevenue(
      base({ invoices: [makeInvoice({ created_at: `${TODAY} 10:00`, final_amount: 900 })] })
    );
    expect(revenue.isFallbackPeriod).toBe(false);
    expect(revenue.monthPrefix).toBe('2026-10');
  });

  it('counts collections from the dated payment register, not undated amount_paid', () => {
    // The invoice says 900 was paid, but the payment landed last month. The
    // month total must follow the payment's own date.
    const revenue = computeRevenue(
      base({
        invoices: [
          makeInvoice({ created_at: `${TODAY} 10:00`, final_amount: 900, amount_paid: 900, payment_status: 'paid' }),
        ],
        payments: [makePayment({ amount: 900, payment_date: '2026-09-20' })],
      })
    );
    expect(revenue.collected).toBe(0);
  });
});

describe('computeWorkload', () => {
  it('reports an empty bench as empty, not as zero-width bars', () => {
    const { rows, overallPct, unassigned } = computeWorkload(base());
    expect(rows).toEqual([]);
    expect(overallPct).toBeNull();
    expect(unassigned).toBe(0);
  });

  it('groups by cases.department, not by material', () => {
    const { rows } = computeWorkload(
      base({
        cases: [
          makeCase({ department: 'CAD / CAM', material: 'Zirconia' }),
          makeCase({ department: 'CAD / CAM', material: 'E.max' }),
          makeCase({ department: 'Sintering', material: 'Zirconia' }),
        ],
      })
    );
    // Two distinct materials must not split the CAD / CAM bench.
    expect(rows.map((r) => r.label).sort()).toEqual(['CAD / CAM', 'Sintering']);
    expect(rows.find((r) => r.label === 'CAD / CAM')?.pct).toBe(67);
  });

  it('shows un-routed cases as a visible Unassigned row, never spreading them across benches', () => {
    const { rows, unassigned } = computeWorkload(
      base({
        cases: [makeCase({ department: null }), makeCase({ department: 'Waxing' })],
      })
    );
    expect(unassigned).toBe(1);
    const unassignedRow = rows.find((r) => r.label === 'Unassigned');
    expect(unassignedRow).toMatchObject({ pct: 50, tone: 'muted' });
  });

  it('excludes delivered, cancelled and draft cases from the bench', () => {
    const { rows } = computeWorkload(
      base({
        cases: [
          makeCase({ department: 'Waxing' }),
          makeCase({ department: 'Waxing', status: 'delivered' }),
          makeCase({ department: 'Waxing', status: 'cancelled' }),
          makeCase({ department: 'Waxing', status: 'draft' }),
        ],
      })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].pct).toBe(100);
  });

  it('orders rows by the department roster so bars stay comparable between loads', () => {
    const { rows } = computeWorkload(
      base({
        cases: [
          makeCase({ department: 'QC' }),
          makeCase({ department: 'CAD / CAM' }),
          makeCase({ department: 'Waxing' }),
          makeCase({ department: 'Waxing' }),
        ],
      })
    );
    // Roster order, not count order — Waxing has the most work but is listed last.
    expect(rows.map((r) => r.label)).toEqual(['CAD / CAM', 'Waxing', 'QC']);
  });
});

describe('computeTodaySchedule', () => {
  it('lists only today and reads the clock from the last recorded transition', () => {
    const rows = computeTodaySchedule(
      base({
        cases: [
          makeCase({
            delivery_date: TODAY,
            status: 'in_progress',
            history: [
              { id: 'h1', case_id: 'c1', status: 'received', notes: '', timestamp: `${TODAY} 08:00`, updated_by: 'a' },
              { id: 'h2', case_id: 'c1', status: 'in_progress', notes: '', timestamp: `${TODAY} 14:32`, updated_by: 'a' },
            ],
          }),
          makeCase({ delivery_date: '2026-10-09' }),
        ],
      })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].clock).toBe('14:32');
    expect(rows[0].status).toBe('In Production');
  });

  it('falls back to the case timestamp when no transition was recorded', () => {
    const rows = computeTodaySchedule(
      base({ cases: [makeCase({ history: [], updated_at: `${TODAY} 09:00` })] })
    );
    // A real recorded time, not a slot invented from the row's index.
    expect(rows[0].clock).toBe('09:00');
  });

  it('reports a null clock when there is genuinely no timestamp at all', () => {
    const rows = computeTodaySchedule(base({ cases: [makeCase({ history: [], updated_at: '' })] }));
    expect(rows[0].clock).toBeNull();
  });
});

describe('computeAtRisk', () => {
  it('grades a past-due case as Behind and a distant one as On Track', () => {
    const rows = computeAtRisk(
      base({
        cases: [
          makeCase({ delivery_date: '2026-09-28' }), // 5 days late
          makeCase({ delivery_date: '2026-10-05' }), // 2 days out
          makeCase({ delivery_date: '2026-10-20' }), // comfortable
        ],
      })
    );
    expect(rows.map((r) => r.level)).toEqual(['Behind', 'At Risk', 'On Track']);
  });
});

describe('computePerformance', () => {
  it('marks every metric unsupported on an empty dataset, so the panel drops them all', () => {
    const rows = computePerformance({ cases: [], invoices: [], todayStr: TODAY });
    expect(rows.every((r) => !r.supported)).toBe(true);
    expect(rows.every((r) => r.value === '—')).toBe(true);
  });

  it('supports only the metrics the data actually backs', () => {
    const rows = computePerformance({
      cases: [
        makeCase({
          status: 'delivered',
          delivery_date: '2026-10-02',
          history: [
            { id: 'h', case_id: 'c', status: 'delivered', notes: '', timestamp: `${TODAY} 10:00`, updated_by: 'a' },
          ],
        }),
      ],
      invoices: [makeInvoice({ created_at: `${TODAY} 10:00`, final_amount: 900 })],
      todayStr: TODAY,
    });
    const supported = rows.filter((r) => r.supported).map((r) => r.label);
    expect(supported).toContain('On-Time Delivery');
    expect(supported).toContain('Cases Completed');
    expect(supported).toContain('Revenue / Case');
    // Nothing has been marked ready to ship in this fixture.
    expect(supported).not.toContain('Ready to Ship');
  });

  it('measures on-time delivery against the promised date', () => {
    const rows = computePerformance({
      cases: [
        makeCase({
          status: 'delivered',
          delivery_date: '2026-10-02',
          history: [
            { id: 'h', case_id: 'c', status: 'delivered', notes: '', timestamp: `${TODAY} 10:00`, updated_by: 'a' },
          ],
        }),
      ],
      invoices: [],
      todayStr: TODAY,
    });
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    // Promised 10-02, actually delivered 10-03 — that is a late delivery.
    expect(byLabel['On-Time Delivery']).toBe('0%');
  });
});

describe('computeDashboardMetrics', () => {
  it('returns a complete, empty-safe bundle', () => {
    const m = computeDashboardMetrics(base());
    expect(m.workflow).toHaveLength(5);
    expect(m.attention).toHaveLength(4);
    expect(m.performance.length).toBeGreaterThan(0);
    expect(m.clinicCount).toBe(0);
    expect(m.activeClinics).toEqual([]);
  });

  it('produces no NaN anywhere, for any dataset', () => {
    const m = computeDashboardMetrics(
      base({
        cases: [makeCase({ delivery_date: '2020-01-01', status: 'revision', material: 'Zirconia' })],
        invoices: [makeInvoice({ final_amount: 0, amount_paid: 0, due_date: '2019-01-01' })],
        payments: [makePayment({ amount: 0, payment_date: '2019-05-05' })],
      })
    );
    const json = JSON.stringify(m);
    expect(json).not.toContain('null,null');
    expect(json).not.toMatch(/NaN/);
    expect(json).not.toMatch(/Infinity/);
  });
});