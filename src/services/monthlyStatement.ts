import type {
  Invoice,
  PaymentRecord,
  AdvancePayment,
  AccountAdjustment,
} from '../types';
import { roundMoney } from './financeDomain';
import { getTodayStr } from '../utils/dateUtils';

/**
 * Monthly statement domain — pure financial view (no React, no state, no DB).
 *
 * WHY THIS EXISTS: the old monthly report grouped invoices by their creation
 * month and called `Σ invoice.amount_paid` "Collected". That misstates a
 * clinic statement in three ways:
 *   1. Cash received in month M against an invoice raised in month M-3 never
 *      showed up in M, so a collection month looked empty and never carried
 *      forward.
 *   2. `amount_paid` is a lifetime figure on the invoice, so a payment landed
 *      in the wrong month.
 *   3. Advance deposits and credit notes were invisible, so "Remaining" was
 *      just `billed - lifetime_paid` and ignored money the clinic had already
 *      paid or been credited.
 *
 * Here every figure is dated to the month the money actually moved, and the
 * balance is carried month to month:
 *
 *   closing = opening + billed − collected − advance_received
 *             + advance_applied − credit_notes + debit_adjustments
 *
 * Sign convention matches `buildLabFinancialSummary` (net_balance): positive
 * means the clinic owes us, negative means the clinic is in credit. `remaining`
 * is therefore `max(0, closing)` — the "still to pay" figure a statement shows.
 * `advance_credit` is the unallocated deposit wallet only (deposits minus
 * applications), which is what the clinic can spend against future invoices.
 *
 * Reconciliation invariant: for the newest month, a clinic's `closing_balance`
 * equals `buildLabFinancialSummary(...).net_balance` as long as `amount_paid`
 * equals the sum of its invoice's payments (which is how the app maintains it).
 * A test asserts exactly that.
 */

/** One clinic's row inside one billing month. */
export interface MonthlyClinicRow {
  lab_id: string;
  lab_name: string;
  /** Invoices raised in this month (one invoice per case in this app). */
  cases_billed: number;
  /** Charges raised in this month. */
  billed: number;
  /** Invoice settlements received in this month, cash and advance-sourced. */
  collected: number;
  /** Advance deposits banked in this month. */
  advance_received: number;
  /** Advance credit spent against invoices in this month. */
  advance_applied: number;
  credit_notes: number;
  debit_adjustments: number;
  /** Balance brought forward from the previous month (0 for the first month). */
  opening_balance: number;
  /** Signed balance carried into the next month. */
  closing_balance: number;
  /** Unallocated advance wallet at month end. */
  advance_credit: number;
  /** Still owed (max(0, closing)); 0 when the clinic is in credit. */
  remaining: number;
}

/** One billing month: every clinic active that month, plus month totals. */
export interface MonthlyStatementBlock {
  /** 'YYYY-MM' */
  month: string;
  rows: MonthlyClinicRow[];
  totals: Omit<MonthlyClinicRow, 'lab_id' | 'lab_name'> & {
    clinics: number;
  };
}

const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * 'YYYY-MM' for a stored date string, falling back to today for missing or
 * malformed values. Records written before a date column existed must still
 * file into a month instead of silently vanishing from the report.
 */
const monthKey = (value?: string): string => {
  const slice = (value || '').slice(0, 7);
  return MONTH_RE.test(slice) ? slice : getTodayStr().slice(0, 7);
};

/**
 * A payment that spends the advance wallet rather than cash. These are counted
 * inside `collected` (they settle an invoice) and added back in
 * `advance_applied`, because the deposit already reduced the balance in the
 * month it was banked — applying it is net-neutral to the clinic.
 */
export const isAdvanceAppliedPayment = (p: PaymentRecord): boolean =>
  p.payment_method === 'advance' || p.payment_type === 'advance_allocation' || !!p.advance_payment_id;

/** Human month label, e.g. '2026-03' → 'March 2026'. */
export const formatMonthLabel = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

type FlowBucket = {
  cases_billed: number;
  billed: number;
  collected: number;
  advance_received: number;
  advance_applied: number;
  credit_notes: number;
  debit_adjustments: number;
};

const emptyFlow = (): FlowBucket => ({
  cases_billed: 0,
  billed: 0,
  collected: 0,
  advance_received: 0,
  advance_applied: 0,
  credit_notes: 0,
  debit_adjustments: 0,
});

/**
 * Build the monthly statement for every clinic, newest month first.
 *
 * Balances are walked oldest → newest so each month's opening is the previous
 * month's closing; the blocks are then reversed for the UI.
 */
export const buildMonthlyStatements = (input: {
  invoices: Invoice[];
  advancePayments: AdvancePayment[];
  accountAdjustments: AccountAdjustment[];
}): MonthlyStatementBlock[] => {
  const { invoices, advancePayments, accountAdjustments } = input;

  /* month → lab_id → flows. Every money movement lands in the month of its own
     business date, so a month appears whenever the clinic transacted — even
     when it raised no invoice (a deposit or a part payment month). */
  const months = new Map<string, Map<string, FlowBucket & { lab_name: string }>>();

  const bucket = (month: string, labId: string, labName: string) => {
    let labMap = months.get(month);
    if (!labMap) {
      labMap = new Map();
      months.set(month, labMap);
    }
    let flow = labMap.get(labId);
    if (!flow) {
      flow = { lab_name: labName, ...emptyFlow() };
      labMap.set(labId, flow);
    }
    // A later record can carry the clinic name where an earlier one lacked it.
    if (labName && labName !== 'Dental Clinic') flow.lab_name = labName;
    return flow;
  };

  // 1. Charges: invoices debit the receivable in their own month.
  (invoices || []).forEach((inv) => {
    if (!inv || inv.status_v2 === 'voided') return;
    const flow = bucket(monthKey(inv.created_at || inv.issue_date), inv.lab_id, inv.lab_name);
    flow.cases_billed += 1;
    flow.billed += inv.final_amount || 0;
  });

  // 2. Settlements: every payment is dated by its payment date, not by the
  //    invoice it pays — this is the correction the old report was missing.
  (invoices || []).forEach((inv) => {
    (inv?.payments || []).forEach((p) => {
      const flow = bucket(
        monthKey(p.payment_date || inv.created_at),
        p.lab_id || inv.lab_id,
        p.lab_name || inv.lab_name
      );
      flow.collected += p.amount || 0;
      if (isAdvanceAppliedPayment(p)) flow.advance_applied += p.amount || 0;
    });
  });

  // 3. Advance deposits banked (a clinic-level credit wallet).
  (advancePayments || []).forEach((adv) => {
    const flow = bucket(
      monthKey(adv.payment_date || adv.created_at),
      adv.lab_id,
      adv.lab_name
    );
    flow.advance_received += adv.amount || 0;
  });

  /* 4. Credit notes and debit adjustments at their own date. `write_off` and
     `reversal` are excluded to stay arithmetically consistent with
     `buildLabFinancialSummary`, which ignores them too. */
  (accountAdjustments || []).forEach((adj) => {
    if (adj?.type !== 'credit_note' && adj?.type !== 'debit_adjustment' && adj?.type !== 'refund') return;
    const flow = bucket(monthKey(adj.date || adj.created_at), adj.lab_id, adj.lab_name);
    if (adj.type === 'credit_note') flow.credit_notes += adj.amount || 0;
    else flow.debit_adjustments += adj.amount || 0;
  });

  // Walk oldest → newest, carrying balance and advance wallet per clinic.
  const ordered = Array.from(months.keys()).sort();
  const running = new Map<string, { closing: number; advance_credit: number }>();
  const blocks: MonthlyStatementBlock[] = [];

  ordered.forEach((month) => {
    const labMap = months.get(month)!;
    const rows: MonthlyClinicRow[] = [];

    labMap.forEach((flow, labId) => {
      const prior = running.get(labId) || { closing: 0, advance_credit: 0 };
      const opening_balance = roundMoney(prior.closing);
      const closing_balance = roundMoney(
        opening_balance +
          flow.billed -
          flow.collected -
          flow.advance_received +
          flow.advance_applied -
          flow.credit_notes +
          flow.debit_adjustments
      );
      const advance_credit = roundMoney(
        Math.max(0, prior.advance_credit + flow.advance_received - flow.advance_applied)
      );

      running.set(labId, { closing: closing_balance, advance_credit });

      rows.push({
        lab_id: labId,
        lab_name: flow.lab_name || 'Dental Clinic',
        cases_billed: flow.cases_billed,
        billed: roundMoney(flow.billed),
        collected: roundMoney(flow.collected),
        advance_received: roundMoney(flow.advance_received),
        advance_applied: roundMoney(flow.advance_applied),
        credit_notes: roundMoney(flow.credit_notes),
        debit_adjustments: roundMoney(flow.debit_adjustments),
        opening_balance,
        closing_balance,
        advance_credit,
        remaining: Math.max(0, closing_balance),
      });
    });

    rows.sort((a, b) => b.billed - a.billed || a.lab_name.localeCompare(b.lab_name));

    const sum = (pick: (r: MonthlyClinicRow) => number) =>
      roundMoney(rows.reduce((acc, r) => acc + pick(r), 0));

    const closing_balance = sum((r) => r.closing_balance);

    blocks.push({
      month,
      rows,
      totals: {
        clinics: rows.length,
        cases_billed: rows.reduce((a, r) => a + r.cases_billed, 0),
        billed: sum((r) => r.billed),
        collected: sum((r) => r.collected),
        advance_received: sum((r) => r.advance_received),
        advance_applied: sum((r) => r.advance_applied),
        credit_notes: sum((r) => r.credit_notes),
        debit_adjustments: sum((r) => r.debit_adjustments),
        opening_balance: sum((r) => r.opening_balance),
        closing_balance,
        advance_credit: sum((r) => r.advance_credit),
        remaining: Math.max(0, closing_balance),
      },
    });
  });

  return blocks.reverse(); // newest month first, like every other report tab
};

/** Flat CSV rows for the monthly statement, one line per clinic per month. */
export const monthlyStatementCsvRows = (
  blocks: MonthlyStatementBlock[]
): (string | number)[][] => {
  const header = [
    'Month',
    'Dental Clinic',
    'Cases Billed',
    'Billed (PKR)',
    'Collected (PKR)',
    'Advance Received (PKR)',
    'Advance Applied (PKR)',
    'Credit Notes (PKR)',
    'Debit Adjustments (PKR)',
    'Opening Balance (PKR)',
    'Closing Balance (PKR)',
    'Advance Credit (PKR)',
    'Remaining Due (PKR)',
  ];
  const rows = blocks.flatMap((block) =>
    block.rows.map((r) => [
      block.month,
      r.lab_name,
      r.cases_billed,
      r.billed,
      r.collected,
      r.advance_received,
      r.advance_applied,
      r.credit_notes,
      r.debit_adjustments,
      r.opening_balance,
      r.closing_balance,
      r.advance_credit,
      r.remaining,
    ])
  );
  return [header, ...rows];
};