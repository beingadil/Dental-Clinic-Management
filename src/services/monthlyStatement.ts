import type {
  Invoice,
  PaymentRecord,
  AdvancePayment,
  AccountAdjustment,
} from '../types';
import { roundMoney } from './financeDomain';
import { getTodayStr } from '../utils/dateUtils';
import { buildXlsx, XL, type XlsxCell, type XlsxSheet } from '../lib/xlsx';

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
 * Month totals for a set of rows.
 *
 * One definition, used both by the builder and by the clinic filter, so a
 * filtered statement can never total differently from an unfiltered one.
 */
const totalsOf = (rows: MonthlyClinicRow[]): MonthlyStatementBlock['totals'] => {
  const sum = (pick: (r: MonthlyClinicRow) => number) =>
    roundMoney(rows.reduce((acc, r) => acc + pick(r), 0));
  const closing_balance = sum((r) => r.closing_balance);
  return {
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
  };
};

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

    blocks.push({
      month,
      rows,
      totals: totalsOf(rows),
    });
  });

  return blocks.reverse(); // newest month first, like every other report tab
};

/**
 * Narrow a statement to a set of clinics.
 *
 * The filter is applied AFTER the whole history is walked, and that order is
 * the whole point. A clinic's opening balance is its closing balance from the
 * month before, and that chain has to keep running through months the
 * operator has filtered out — otherwise selecting a clinic would rewrite the
 * balance it started the year with. So: build everything, drop the rows the
 * operator excluded, and recompute the month totals from what is left.
 *
 * EXCLUDED rather than included, so a clinic added tomorrow is in scope by
 * default instead of being silently missing from every report until someone
 * remembers to tick it.
 *
 * A month with no clinics left disappears entirely, rather than showing an
 * empty table and a row of zeroes.
 */
export const filterMonthlyStatements = (
  blocks: MonthlyStatementBlock[],
  /** Clinic ids to leave out. Empty keeps everything. */
  excludedLabIds: string[] | null,
): MonthlyStatementBlock[] => {
  if (!excludedLabIds || excludedLabIds.length === 0) return blocks;
  const drop = new Set(excludedLabIds);
  return blocks
    .map((block) => {
      const rows = block.rows.filter((r) => !drop.has(r.lab_id));
      return { ...block, rows, totals: totalsOf(rows) };
    })
    .filter((block) => block.rows.length > 0);
};

/* ---------- the workbook ---------- */

/** The statement's money columns, in the order they read. */
const STATEMENT_COLUMNS = [
  'Dental Clinic',
  'Cases Billed',
  'Billed (PKR)',
  'Collected (PKR)',
  'Advance In (PKR)',
  'Advance Used (PKR)',
  'Credit Notes (PKR)',
  'Debit Adj. (PKR)',
  'Opening (PKR)',
  'Closing (PKR)',
  'Advance Credit (PKR)',
  'Remaining Due (PKR)',
] as const;

/** The figures of one clinic row, in STATEMENT_COLUMNS order (skipping the name). */
const rowFigures = (r: MonthlyClinicRow): number[] => [
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
];

/**
 * The monthly statement as an Excel workbook.
 *
 * A summary sheet, then one sheet per month — the same shape the PDF uses,
 * because that is the shape an operator reads the statement in. The figures
 * are NUMBERS with a money format, not strings, so a cell can be summed,
 * sorted and charted; a spreadsheet that cannot do arithmetic is a picture
 * of a spreadsheet.
 *
 * The grand total deliberately leaves the balance columns blank. The flows
 * (billed, collected, advances, notes) add up across months; the balances
 * (opening, closing, due) do not, because each month opens where the last
 * one closed, and a total of them would be a number that means nothing.
 */
export const monthlyStatementWorkbook = (
  blocks: MonthlyStatementBlock[],
  meta: { labName: string; periodLabel: string; scopeLabel: string; generatedOn: string },
): Uint8Array => {
  const widths = [30, 12, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16];

  /* The document's own title block, so the workbook says what it is when it
     is opened. A sheet that begins with a header row and no title is a
     screenshot of a document; this is a document. */
  const titleRows: XlsxCell[][] = [
    [{ value: meta.labName, style: XL.totalLabel }],
    [{ value: 'Monthly Statement', style: XL.totalLabel }],
    [{ value: `Period: ${meta.periodLabel}` }],
    [{ value: `Clinics: ${meta.scopeLabel}` }],
    [{ value: `Generated: ${meta.generatedOn}` }],
    [{ value: '' }],
  ];

  const summaryRows: XlsxCell[][] = [
    [
      { value: 'Month', style: XL.header },
      { value: 'Clinics', style: XL.header },
      { value: 'Cases Billed', style: XL.header },
      { value: 'Billed (PKR)', style: XL.header },
      { value: 'Collected (PKR)', style: XL.header },
      { value: 'Advance In (PKR)', style: XL.header },
      { value: 'Advance Used (PKR)', style: XL.header },
      { value: 'Credit Notes (PKR)', style: XL.header },
      { value: 'Debit Adj. (PKR)', style: XL.header },
      { value: 'Opening (PKR)', style: XL.header },
      { value: 'Closing (PKR)', style: XL.header },
      { value: 'Advance Credit (PKR)', style: XL.header },
      { value: 'Remaining Due (PKR)', style: XL.header },
    ],
    ...blocks.map((block) => [
      { value: formatMonthLabel(block.month) },
      { value: block.totals.clinics, style: XL.count },
      { value: block.totals.cases_billed, style: XL.count },
      { value: block.totals.billed, style: XL.money },
      { value: block.totals.collected, style: XL.money },
      { value: block.totals.advance_received, style: XL.money },
      { value: block.totals.advance_applied, style: XL.money },
      { value: block.totals.credit_notes, style: XL.money },
      { value: block.totals.debit_adjustments, style: XL.money },
      { value: block.totals.opening_balance, style: XL.money },
      { value: block.totals.closing_balance, style: XL.money },
      { value: block.totals.advance_credit, style: XL.money },
      { value: block.totals.remaining, style: XL.money },
    ]),
  ];

  // The flows add up; the balances do not, so those cells are left empty.
  if (blocks.length > 0) {
    const sum = (pick: (b: MonthlyStatementBlock) => number) =>
      roundMoney(blocks.reduce((acc, b) => acc + pick(b), 0));
    summaryRows.push([
      { value: 'TOTAL', style: XL.totalLabel },
      { value: '', style: XL.totalLabel },
      { value: blocks.reduce((a, b) => a + b.totals.cases_billed, 0), style: XL.totalCount },
      { value: sum((b) => b.totals.billed), style: XL.totalMoney },
      { value: sum((b) => b.totals.collected), style: XL.totalMoney },
      { value: sum((b) => b.totals.advance_received), style: XL.totalMoney },
      { value: sum((b) => b.totals.advance_applied), style: XL.totalMoney },
      { value: sum((b) => b.totals.credit_notes), style: XL.totalMoney },
      { value: sum((b) => b.totals.debit_adjustments), style: XL.totalMoney },
      { value: '', style: XL.totalMoney },
      { value: '', style: XL.totalMoney },
      { value: '', style: XL.totalMoney },
      { value: '', style: XL.totalMoney },
    ]);
  }

  const sheets: XlsxSheet[] = [
    {
      name: 'Summary',
      rows: [...titleRows, ...summaryRows],
      widths,
      freezeRows: titleRows.length + 1,
    },
    ...blocks.map((block) => ({
      name: formatMonthLabel(block.month),
      freezeRows: 1,
      widths,
      rows: [
        STATEMENT_COLUMNS.map((h) => ({ value: h as string, style: XL.header })),
        ...block.rows.map((r) => [
          { value: r.lab_name },
          ...rowFigures(r).map((v, i) => ({
            value: v,
            style: i === 0 ? XL.count : XL.money,
          })),
        ]),
        [
          { value: 'MONTH TOTAL', style: XL.totalLabel },
          { value: block.totals.cases_billed, style: XL.totalCount },
          { value: block.totals.billed, style: XL.totalMoney },
          { value: block.totals.collected, style: XL.totalMoney },
          { value: block.totals.advance_received, style: XL.totalMoney },
          { value: block.totals.advance_applied, style: XL.totalMoney },
          { value: block.totals.credit_notes, style: XL.totalMoney },
          { value: block.totals.debit_adjustments, style: XL.totalMoney },
          { value: block.totals.opening_balance, style: XL.totalMoney },
          { value: block.totals.closing_balance, style: XL.totalMoney },
          { value: block.totals.advance_credit, style: XL.totalMoney },
          { value: block.totals.remaining, style: XL.totalMoney },
        ],
      ],
    })),
  ];

  return buildXlsx(sheets);
};
