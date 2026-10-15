/**
 * The escalation sweep.
 *
 * WHY THIS TEST EXISTS
 * Settings → Notifications has always offered three controls — "Escalate
 * unresolved reminders", "Escalate after (days unpaid)" and a repeat interval.
 * All three were rendered, saved and written to the audit trail, and read by
 * nothing: the only sweeps in the app consulted the `overdue_frequencies` and
 * `payment_frequencies` arrays, and the `escalation` notification kind was
 * declared and never produced. They were a promise with no implementation.
 *
 * Two properties matter enough to pin:
 *
 *   1. it stays QUIET while the setting is off — turning escalation on by
 *      default would spam every lab that never asked for it, and
 *   2. the repeat interval actually repeats: an invoice ignored for a month
 *      should escalate again, not produce exactly one row forever. That is the
 *      entire reason the interval setting exists.
 */
import { describe, expect, it } from 'vitest';
import { buildEscalationAlerts, type EscalationRule } from '../../src/services/notificationDomain';
import type { Invoice } from '../../src/types';

const TODAY = '2026-10-15';

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: 'inv-1',
    invoice_number: 'INV-0001',
    final_amount: 10000,
    amount_paid: 0,
    credit_notes_total: 0,
    payment_status: 'unpaid',
    status_v2: 'open',
    due_date: '2026-10-01',
    lab_name: 'Bright Smile',
    patient_name: 'Ayesha Khan',
    case_number: 'DS-0001',
    ...over,
  }) as Invoice;

const rule = (over: Partial<EscalationRule> = {}): EscalationRule => ({
  enabled: true,
  thresholdDays: 7,
  interval: 'weekly',
  ...over,
});

const id = (inv: Invoice, bucket: number) => `notif-escalation-${inv.id}-${bucket}`;

describe('buildEscalationAlerts', () => {
  it('produces nothing while escalation is switched off', () => {
    // The setting defaults must not silently switch escalation on for a lab
    // that never configured it.
    expect(buildEscalationAlerts([invoice()], TODAY, id, rule({ enabled: false }))).toEqual([]);
  });

  it('escalates an invoice past the threshold', () => {
    const alerts = buildEscalationAlerts([invoice()], TODAY, id, rule());
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('escalation');
    expect(alerts[0].invoice_id).toBe('inv-1');
    expect(alerts[0].is_read).toBe(false);
    expect(alerts[0].is_archived).toBe(false);
  });

  it('stays silent BEFORE the threshold, even though the invoice is overdue', () => {
    // Due 2026-10-12 is 3 days overdue, under a 7-day threshold. The unpaid
    // sweep already covers it; escalating too would double every reminder.
    const alerts = buildEscalationAlerts(
      [invoice({ due_date: '2026-10-12' })],
      TODAY,
      id,
      rule({ thresholdDays: 7 }),
    );
    expect(alerts).toEqual([]);
  });

  it('escalates exactly on the threshold day', () => {
    const alerts = buildEscalationAlerts(
      [invoice({ due_date: '2026-10-08' })], // 7 days
      TODAY,
      id,
      rule({ thresholdDays: 7 }),
    );
    expect(alerts).toHaveLength(1);
  });

  it('never escalates a paid, voided or undated invoice', () => {
    const rows = [
      invoice({ id: 'a', payment_status: 'paid' }),
      invoice({ id: 'b', status_v2: 'voided' }),
      invoice({ id: 'c', due_date: '' }),
    ];
    expect(buildEscalationAlerts(rows, TODAY, id, rule())).toEqual([]);
  });

  it('states the real outstanding amount, net of credits', () => {
    const alerts = buildEscalationAlerts(
      [invoice({ amount_paid: 4000, credit_notes_total: 1000 })],
      TODAY,
      id,
      rule(),
    );
    // 10,000 − 4,000 paid − 1,000 credited = 5,000, the same balance every
    // other money surface shows. An escalation quoting the gross figure while
    // the invoice register shows a smaller one would be the old two-formulas bug
    // in a new place.
    expect(alerts[0].message).toContain('5,000 PKR outstanding');
  });

  it('advances to a new id once the interval elapses, so it can repeat', () => {
    const due = '2026-09-15'; // 30 days overdue, weekly interval
    const first = buildEscalationAlerts([invoice({ due_date: due })], TODAY, id, rule({ interval: 'weekly' }));
    const second = buildEscalationAlerts([invoice({ due_date: due })], TODAY, id, rule({ interval: 'weekly' }));

    // Same day, same bucket → identical id, so re-running the sweep (React
    // StrictMode double-invoke, a re-render, a restart) adds nothing.
    expect(first[0].id).toBe(second[0].id);

    // A week later the bucket has moved on, so it escalates again.
    const nextWeek = buildEscalationAlerts([invoice({ due_date: due })], '2026-10-22', id, rule({ interval: 'weekly' }));
    expect(nextWeek[0].id).not.toBe(first[0].id);
  });

  it('repeats sooner on a daily interval than a weekly one', () => {
    const due = '2026-10-01'; // 14 days overdue
    const weekly = buildEscalationAlerts([invoice({ due_date: due })], TODAY, id, rule({ interval: 'weekly' }));
    const daily = buildEscalationAlerts([invoice({ due_date: due })], TODAY, id, rule({ interval: 'daily' }));
    // 14 days: bucket 2 on weekly, bucket 14 on daily.
    expect(weekly[0].id).toBe('notif-escalation-inv-1-2');
    expect(daily[0].id).toBe('notif-escalation-inv-1-14');
  });

  it('falls back to weekly for an interval it does not recognise', () => {
    const alerts = buildEscalationAlerts([invoice()], TODAY, id, rule({ interval: 'fortnightly' }));
    expect(alerts).toHaveLength(1);
  });

  it('falls back to the default 7-day threshold when the stored value is nonsense', () => {
    // A corrupt preference must not either disable escalation or turn it into a
    // 1-day nag. Both extremes are worse than the shipped default.
    const due3Days = invoice({ due_date: '2026-10-12' });
    const due14Days = invoice({ due_date: '2026-10-01' });

    expect(buildEscalationAlerts([due3Days], TODAY, id, rule({ thresholdDays: Number.NaN }))).toEqual([]);
    expect(buildEscalationAlerts([due14Days], TODAY, id, rule({ thresholdDays: Number.NaN }))).toHaveLength(1);
  });

  it('treats a zero or negative threshold as the minimum of 1 day', () => {
    expect(buildEscalationAlerts([invoice({ due_date: '2026-10-14' })], TODAY, id, rule({ thresholdDays: 0 }))).toHaveLength(1);
  });

  it('survives an empty or absent invoice list', () => {
    expect(buildEscalationAlerts([], TODAY, id, rule())).toEqual([]);
  });
});
