import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTodayStr, getDateStr, getNowStamp, getDaysOffsetStr } from '../../src/utils/dateUtils';
import { computeSlaDueDate } from '../../src/services/prioritySla';
import { todayISO } from '../../src/components/common/DatePickerRange';
import { prepareTransaction } from '../../src/services/transactionDomain';
import type { Invoice } from '../../src/types';

/**
 * Frozen-clock regression for the UTC date bug that forced the operator to
 * clear the Today filter to see what they had just entered.
 *
 * A dental lab closes its books at night. At 01:30 Pakistan time the LOCAL
 * day is 2026-10-03 while the UTC day is still 2026-10-02, so every
 * `toISOString()`-stamped record landed a day behind the tab's
 * `todayISO()` window and vanished from the default view.
 *
 * The whole suite runs under TZ=Asia/Karachi with a frozen clock at exactly
 * that moment — the window where the two calendars disagree.
 */

const REAL_TZ = process.env.TZ;
const ORIGINAL_DATE = globalThis.Date;

// 01:30 on 2026-10-03 in Asia/Karachi === 2026-10-02T20:30Z.
const FROZEN_ISO = '2026-10-02T20:30:00.000Z';
const LOCAL_DAY = '2026-10-03';   // what the tabs call "today"
const UTC_DAY = '2026-10-02';     // what toISOString() would have written

/** Fake Date: advances only when the code under test asks for real time. */
class FrozenDate extends ORIGINAL_DATE {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(FROZEN_ISO);
    else super(...(args as [number]));
  }
  static override now(): number {
    return new ORIGINAL_DATE(FROZEN_ISO).getTime();
  }
}

beforeEach(() => {
  process.env.TZ = 'Asia/Karachi';
  globalThis.Date = FrozenDate as unknown as typeof Date;
});

afterEach(() => {
  globalThis.Date = ORIGINAL_DATE;
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

/** The exact predicate the Invoices tab uses (BillingView.filteredInvoices). */
const invoiceInWindow = (inv: Invoice, from: string, to: string): boolean => {
  const day = (inv.created_at || '').slice(0, 10);
  if (from && (!day || day < from)) return false;
  if (to && (!day || day > to)) return false;
  return true;
};

/** The exact predicate the Payments register uses (TransactionRegister). */
const paymentInWindow = (day: string, from: string, to: string): boolean => {
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
};

describe('the frozen clock really is the disputed window', () => {
  it('local day and UTC day differ', () => {
    // Guards the fixture: if these ever match, the test proves nothing.
    expect(Number(new Date(FROZEN_ISO).getHours())).toBe(1);
    expect(getTodayStr()).toBe(LOCAL_DAY);
    expect(new Date().toISOString().split('T')[0]).toBe(UTC_DAY);
    expect(LOCAL_DAY).not.toBe(UTC_DAY);
  });
});

describe('dateUtils stamps the local calendar day', () => {
  it('today is the local day, never the UTC day', () => {
    expect(getTodayStr()).toBe(LOCAL_DAY);
  });

  it('the tab filter and the record stamp agree on "today"', () => {
    // The whole bug: todayISO() (filters) vs toISOString() (records).
    expect(todayISO()).toBe(getTodayStr());
  });

  it('now-stamp carries the local day and the local wall clock', () => {
    expect(getNowStamp()).toBe(`${LOCAL_DAY} 01:30`);
    expect(getNowStamp().split(' ')[0]).toBe(getTodayStr());
  });

  it('offsets stay on the local calendar', () => {
    expect(getDaysOffsetStr(4)).toBe('2026-10-07');
    expect(getDateStr(new Date(`${LOCAL_DAY}T00:30:00`))).toBe(LOCAL_DAY);
  });
});

describe('SLA delivery date is a local-calendar date', () => {
  it('adds the SLA days to the local day, not to the UTC day', () => {
    // Normal = 4 days from 2026-10-03 local => 2026-10-07. Reading the
    // result back in UTC used to yield 2026-10-06, a day early.
    expect(computeSlaDueDate('normal')).toBe('2026-10-07');
  });

  it('is not the old day-early value', () => {
    expect(computeSlaDueDate('normal')).not.toBe('2026-10-06');
  });
});

describe('a case booked tonight shows up in the Invoices tab', () => {
  it('books its invoice on the registration day, with delivery as due date', () => {
    // Mirrors addCase: the invoice's created_at/issue_date is the stamp's
    // day; due_date stays the case's delivery date.
    const stamp = getNowStamp();
    const invoice = {
      created_at: stamp.split(' ')[0],
      issue_date: stamp.split(' ')[0],
      due_date: '2026-10-07',
    };

    expect(invoice.created_at).toBe(LOCAL_DAY);
    expect(invoice.due_date).toBe('2026-10-07');
  });

  it('falls inside the default Today filter', () => {
    const inv = {
      created_at: getNowStamp().split(' ')[0],
      payments: [],
    } as unknown as Invoice;

    expect(invoiceInWindow(inv, todayISO(), todayISO())).toBe(true);
  });
});

describe('a payment taken tonight shows up in the Payments register', () => {
  const invoice = {
    id: 'inv-1',
    invoice_number: 'INV-0001',
    lab_id: 'lab-1',
    lab_name: 'Clinic One',
    amount: 25000,
    discount: 0,
    final_amount: 25000,
    amount_paid: 0,
    payment_status: 'unpaid',
    status_v2: 'open',
    payments: [],
    created_at: LOCAL_DAY,
  } as unknown as Invoice;

  it('posts with the local day when the cashier does not override it', () => {
    const prepared = prepareTransaction({
      command: {
        clinicId: 'lab-1',
        amount: 5000,
        method: 'cash',
        // No explicit date — this is the modal default, getTodayStr().
        date: getTodayStr(),
        allocations: [{ invoiceId: 'inv-1', amount: 5000 }],
      },
      invoices: [invoice],
      existingPaymentNumbers: [],
      existingAdvanceNumbers: [],
      existingReceiptNumbers: [],
      labName: 'Clinic One',
      actor: 'Cashier',
      paymentId: 'pay-1',
    });

    expect(prepared.payment.payment_date).toBe(LOCAL_DAY);
  });

  it('is matched by the default Today filter', () => {
    const day = getNowStamp().split(' ')[0];
    expect(paymentInWindow(day, todayISO(), todayISO())).toBe(true);
  });
});
