import { describe, it, expect } from 'vitest';
import { buildInsightsSnapshot, periodRange } from '../../src/services/insightsDomain';
import type { DentalCase, DentalLab, Invoice, CaseType } from '../../src/types';

const lab = (id: string, name: string): DentalLab => ({ id, name, contact_person: '', phone: '', email: '', address: '' } as DentalLab);
const ct = (id: string, name: string): CaseType => ({ id, name } as CaseType);
const cas = (over: Partial<DentalCase>): DentalCase => ({
  id: 'c1', case_number: 'DS-0001', lab_id: 'l1', lab_name: 'Cedar', case_type_id: 'ct1', case_type_name: 'Crown',
  doctor_name: 'Dr A', selected_teeth: [], delivery_date: '2026-10-10', priority: 'normal', price: 1000,
  discount: 0, final_price: 1000, status: 'delivered', created_at: '2026-10-05', updated_at: '2026-10-10', history: [],
  ...over,
} as DentalCase);
const inv = (over: Partial<Invoice>): Invoice => ({
  id: 'i1', invoice_number: 'INV-0001', case_id: 'c1', case_number: 'DS-0001', lab_id: 'l1', lab_name: 'Cedar',
  case_type_name: 'Crown', doctor_name: 'Dr A', amount: 1000, discount: 0, final_amount: 1000, amount_paid: 600,
  payment_status: 'partial', due_date: '2026-10-20', created_at: '2026-10-05', payments: [],
  ...over,
} as Invoice);

describe('insightsDomain', () => {
  it('returns zeros for empty data', () => {
    const m = buildInsightsSnapshot({ cases: [], invoices: [], labs: [], caseTypes: [] }, { kind: 'thisMonth', now: new Date('2026-10-15') });
    expect(m.kpi.invoiced).toBe(0);
    expect(m.kpi.collected).toBe(0);
    expect(m.kpi.cases).toBe(0);
    expect(m.productMix.items).toEqual([]);
    expect(m.clinicStandings.rows).toEqual([]);
  });

  it('aggregates invoiced/collected/outstanding and case counts', () => {
    const m = buildInsightsSnapshot(
      { cases: [cas({})], invoices: [inv({})], labs: [lab('l1', 'Cedar')], caseTypes: [ct('ct1', 'Crown')] },
      { kind: 'thisMonth', now: new Date('2026-10-15') },
    );
    expect(m.kpi.invoiced).toBe(1000);
    expect(m.kpi.collected).toBe(600);
    expect(m.kpi.outstanding).toBe(400);
    expect(m.kpi.cases).toBe(1);
    expect(m.rings.collectionRate).toBe(60);
    expect(m.rings.deliveryRate).toBe(100);
    expect(m.productMix.items[0]).toMatchObject({ name: 'Crown', value: 1000 });
    expect(m.clinicStandings.rows[0]).toMatchObject({ name: 'Cedar', revenue: 1000, balance: 400, cases: 1 });
    expect(m.dayHeat.total).toBe(1);
  });

  it('periodRange produces local-midnight boundaries', () => {
    const r = periodRange({ kind: 'thisMonth', now: new Date('2026-10-15T23:30:00+05:00') });
    // start should be Oct 1 local
    expect(new Date(r.start).getDate()).toBe(1);
    expect(new Date(r.start).getMonth()).toBe(9);
  });
});
