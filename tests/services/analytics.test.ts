import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { labsRepo, casesRepo, invoicesRepo } from '../../src/db/repos';
import { computeAnalytics } from '../../src/services/analyticsService';

let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
});

function seedDeliveredCase(id: string, opts: { priority: string; created: string; delivered: string; material: string; price: number }) {
  if (!labsRepo.byId('lab-a')) labsRepo.insert({ id: 'lab-a', name: 'Analytics Clinic A' });
  if (!labsRepo.byId('lab-b')) labsRepo.insert({ id: 'lab-b', name: 'Analytics Clinic B' });
  casesRepo.insert({
    id,
    case_number: `DS-${id.slice(-4)}`,
    lab_id: 'lab-a',
    lab_name: 'Analytics Clinic A',
    doctor_name: 'Dr. Test',
    patient_name: 'Analytics Patient',
    selected_teeth: [11],
    delivery_date: '2026-12-31',
    price: opts.price,
    discount: 0,
    final_price: opts.price,
    status: 'delivered',
    priority: opts.priority,
    created_at: opts.created,
  });
  engine.run(`UPDATE cases SET created_at = ? WHERE id = ?`, [opts.created, id]);
  engine.run(
    `INSERT OR REPLACE INTO case_status_history (id, case_id, status, notes, timestamp, updated_by)
     VALUES (?, ?, 'delivered', NULL, ?, 'Vitest')`,
    [`h-${id}`, id, opts.delivered]
  );
  engine.run(`UPDATE case_teeth SET material = ? WHERE case_id = ?`, [opts.material, id]);
}

describe('analyticsService — computed from SQLite', () => {
  it('turnaround per priority: avg days + on-time vs delivery date', () => {
    // urgent SLA = 1 day: created 09-01, delivered 09-02 → 1 day, on time
    seedDeliveredCase('an-u1', { priority: 'urgent', created: '2026-09-01', delivered: '2026-09-02', material: 'Zirconia', price: 10000 });
    // urgent delivered late (3 days)
    seedDeliveredCase('an-u2', { priority: 'urgent', created: '2026-09-03', delivered: '2026-09-06', material: 'Zirconia', price: 12000 });
    // normal SLA = 4 days: delivered on day 3 → on time
    seedDeliveredCase('an-n1', { priority: 'normal', created: '2026-09-01', delivered: '2026-09-04', material: 'E.max', price: 8000 });

    const { turnaround } = computeAnalytics();
    const urgent = turnaround.find((r) => r.priority === 'urgent')!;
    expect(urgent.avgDays).toBe(2); // (1 + 3) / 2
    expect(urgent.onTimePct).toBe(50); // 1 of 2 on time
    expect(urgent.sample).toBe(2);
    const normal = turnaround.find((r) => r.priority === 'normal')!;
    expect(normal.avgDays).toBe(3);
    expect(normal.onTimePct).toBe(100);
  });

  it('revenue by restoration material sums invoice finals per case', () => {
    invoicesRepo.insert({
      id: 'an-inv-1', invoice_number: 'AN-INV-1', case_id: 'an-u1', case_number: 'DS--u1',
      lab_id: 'lab-a', lab_name: 'Analytics Clinic A',
      amount: 10000, discount: 0, final_amount: 10000, amount_paid: 10000,
      payment_status: 'paid', status_v2: 'paid', created_at: '2026-09-02',
    });
    invoicesRepo.insert({
      id: 'an-inv-2', invoice_number: 'AN-INV-2', case_id: 'an-u2', case_number: 'DS--u2',
      lab_id: 'lab-a', lab_name: 'Analytics Clinic A',
      amount: 12000, discount: 0, final_amount: 12000, amount_paid: 0,
      payment_status: 'unpaid', status_v2: 'open', created_at: '2026-09-04',
    });

    const { restorationRevenue } = computeAnalytics();
    const zirconia = restorationRevenue.find((r) => r.material === 'Zirconia')!;
    expect(zirconia.cases).toBe(2);
    expect(zirconia.revenue).toBe(22000);
    // E.max case has no invoice → no revenue, but still counted as a case
    const emax = restorationRevenue.find((r) => r.material === 'E.max')!;
    expect(emax.cases).toBe(1);
    expect(emax.revenue).toBe(0);
  });

  it('payment behavior per clinic: billed, collected, outstanding, days-to-pay', () => {
    engine.run(
      `INSERT INTO payments (id, payment_number, invoice_id, invoice_number, case_id, case_number, lab_id, lab_name,
        amount, payment_method, payment_date, recorded_by, payment_type, created_at)
       VALUES ('an-pay-1','AN-PAY-1','an-inv-1','AN-INV-1','an-u1','DS--u1','lab-a','Analytics Clinic A',
        10000,'bank','2026-09-06','Vitest','invoice_payment','2026-09-06')`
    );

    const { paymentBehavior } = computeAnalytics();
    const a = paymentBehavior.find((r) => r.labId === 'lab-a')!;
    expect(a.invoices).toBe(2);
    expect(a.billed).toBe(22000);
    expect(a.collected).toBe(10000);
    expect(a.outstanding).toBe(12000);
    expect(a.avgDaysToPay).toBe(4); // invoice created 09-02, paid 09-06
  });
});
