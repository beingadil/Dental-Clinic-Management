import { describe, it, expect } from 'vitest';
import {
  buildOverdueAlerts,
  buildUnpaidInvoiceAlerts,
  cadenceOffsets,
  shouldRemind,
} from '../../src/services/notificationDomain';

/**
 * D1 — the reminder cadence is stored in `notification_config` and read by the
 * sweeps. The rule that needs pinning is the last one: running past the final
 * ticked reminder keeps reminding, so a receivable can never silently vanish
 * from the tray just because the cadence ran out.
 */
describe('reminder cadence (D1)', () => {
  it('turns frequency ids into signed day offsets', () => {
    expect(cadenceOffsets(['1_day_before', 'on_due_date', '3_days_after'])).toEqual([-1, 0, 3]);
    expect(cadenceOffsets(['7_days_after', '14_days_after'])).toEqual([7, 14]);
  });

  it('ignores unknown frequency ids instead of guessing', () => {
    expect(cadenceOffsets(['nonsense', 'on_due_date'])).toEqual([0]);
    expect(cadenceOffsets([])).toEqual([]);
    expect(cadenceOffsets(undefined)).toEqual([]);
  });

  it('reminds on the ticked days only', () => {
    const cadence = ['on_due_date', '3_days_after', '7_days_after'];

    expect(shouldRemind(cadence, '2026-10-01', '2026-10-01')).toBe(true);
    expect(shouldRemind(cadence, '2026-09-28', '2026-10-01')).toBe(true);
    expect(shouldRemind(cadence, '2026-09-30', '2026-10-01')).toBe(false);
  });

  it('keeps reminding once the last ticked day has passed', () => {
    const cadence = ['on_due_date', '7_days_after'];

    expect(shouldRemind(cadence, '2026-09-01', '2026-10-01')).toBe(true);
    expect(shouldRemind(cadence, '2025-01-01', '2026-10-01')).toBe(true);
  });

  it('treats "no cadence configured" as remind-about-everything', () => {
    expect(shouldRemind([], '2026-09-01', '2026-10-01')).toBe(true);
    expect(shouldRemind(undefined, '2026-09-01', '2026-10-01')).toBe(true);
  });

  it('leaves the legacy sweep untouched when no cadence is passed', () => {
    const cases = [
      { id: 'c1', case_number: 'DS-1', delivery_date: '2026-09-25', status: 'in_progress' }, // 6 days late
      { id: 'c2', case_number: 'DS-2', delivery_date: '2026-10-05', status: 'in_progress' }, // 4 days out
    ] as any;

    // Omitting the cadence must keep behaving exactly as it did before D1:
    // everything strictly past its delivery date, nothing else.
    expect(buildOverdueAlerts(cases, '2026-10-01', (c) => c.id)).toHaveLength(1);
    // A cadence only reaches as far as its offsets — plus everything older.
    expect(buildOverdueAlerts(cases, '2026-10-01', (c) => c.id, ['1_day_before'])).toHaveLength(1);
    // …so a case due in four days is never dragged in early.
    const soon = [{ id: 'c3', case_number: 'DS-3', delivery_date: '2026-10-02', status: 'in_progress' }] as any;
    expect(buildOverdueAlerts(soon, '2026-10-01', (c) => c.id)).toHaveLength(0);
    expect(buildOverdueAlerts(soon, '2026-10-01', (c) => c.id, ['1_day_before'])).toHaveLength(1);
  });

  it('can fire a day early when the cadence asks for it', () => {
    const invoices = [
      { id: 'i1', invoice_number: 'INV-1', final_amount: 1000, due_date: '2026-10-02', payment_status: 'unpaid', lab_name: 'Clinic' },
    ] as any;

    expect(buildUnpaidInvoiceAlerts(invoices, '2026-10-01', (i) => i.id)).toHaveLength(0);
    expect(buildUnpaidInvoiceAlerts(invoices, '2026-10-01', (i) => i.id, ['1_day_before'])).toHaveLength(1);
  });
});
