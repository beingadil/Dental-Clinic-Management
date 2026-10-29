import { roundMoney } from './financeDomain';
import { buildLedgerEntries } from './ledgerDomain';
import { getTodayStr } from '../utils/dateUtils';
import { buildXlsx, XL, type XlsxCell, type XlsxSheet } from '../lib/xlsx';
import type {
  Invoice,
  PaymentRecord,
  DentalLab,
  AdvancePayment,
  AccountAdjustment,
  LedgerEntry,
} from '../types';

/**
 * Monthly statement domain â€” pure financial view (no React, no state, no DB).
 *
 * WHY THIS EXISTS: the old monthly report grouped invoices by their creation
 * month and called `Î£ invoice.amount_paid` "Collected". That misstates a
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
 * EVERY figure is dated to the month the money actually moved.
 *
 * THE CLOSING BALANCE RIDES THE LEDGER ENGINE, not a second walker. The
 * blocks are built from `buildLedgerEntries` â€” the same engine the General
 * Ledger tab runs â€” and each month's `closing_balance` is that engine's own
 * running balance at the month's last posting. That makes the statement's
 * closing balance the general ledger's closing balance BY CONSTRUCTION. The
 * first version of this report walked its own arithmetic and could not see a
 * clinic's OPENING-balance entry (it never received the labs), so it opened
 * at zero while the ledger opened at the clinic's brought-forward debt â€” a
 * clinic owing 41,000 historically plus 15,000 in the month read as 15,000
 * here and 56,000 in the ledger. Riding one engine removes the class of
 * bug, not just the instance: opening balances, voided invoices, write-offs
 * â€” whatever the ledger posts, the statement closes at.
 *
 * The analytic columns are bucketed by what each posting IS:
 *
 *  - `collected` IS THE LEDGER'S CREDIT COLUMN, VERBATIM. Every credit the
 *    engine posts for the clinic-month - a settlement, an advance deposit,
 *    a credit note, an opening credit - rides into that one figure, so the
 *    statement totals exactly the credits the General Ledger tab totals
 *    for the same period (its footer prints the same sum). A credit that
 *    lives on the ledger but not in `collected` is a reconciliation
 *    break; this report exists to never produce one.
 *
 *  - `advance_applied` ("Advance Used") is walked from the invoice payment
 *    records, because in the ledger an applied advance is a 0/0 memo: the
 *    deposit already carried the credit in the month it was banked, so the
 *    application must not be counted a second time. It settles nothing new.
 *
 * Sign convention matches the ledger's running balance (net receivable):
 * positive means the clinic owes us, negative means the clinic is in credit.
 * The statement prints this figure in the Closing Balance column with its
 * ledger side â€” "Dr" for a receivable, "Cr" for credit the clinic holds.
 * `advance_credit` is the unallocated deposit wallet only (deposits minus
 * applications), which is what the clinic can spend against future invoices.
 * A test asserts the newest closing equals `buildLabFinancialSummary(
 * ...).net_balance` on a fixture where the two derivations agree.
 */

/** One clinic's row inside one billing month. */
export interface MonthlyClinicRow {
  lab_id: string;
  lab_name: string;
  /** Invoices raised in this month (one invoice per case in this app). */
  cases_billed: number;
  /** Charges raised in this month. */
  billed: number;
  /**
   * THE LEDGER'S CREDIT COLUMN for this clinic-month: settlements, advance
   * deposits, credit notes and an opening credit — every credit the ledger
   * posts, exactly the total the General Ledger's Credit column prints.
   */
  collected: number;
  /** Advance deposits banked in this month (also inside `collected`). */
  advance_received: number;
  /** Advance credit spent against invoices in this month. */
  advance_applied: number;
  /** Credit notes issued in this month (also inside `collected`). */
  credit_notes: number;
  /** Debit adjustments, surcharges and refunds posted in this month. */
  debit_adjustments: number;
  /** Balance brought forward from the previous month (0 for the first month). */
  opening_balance: number;
  /** Signed balance carried into the next month. */
  closing_balance: number;
  /** Unallocated advance wallet at month end. */
  advance_credit: number;
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
 * An application is a 0/0 memo inside the ledger engine: the deposit already
 * carried the credit in the month it was banked, so the ledger's Credit
 * column (and therefore the statement's `collected`) does not repeat it. The
 * amount is walked from the invoice payment rows ONLY for the "Advance Used"
 * column and the advance-wallet math.
 */
export const isAdvanceAppliedPayment = (p: PaymentRecord): boolean =>
  p.payment_method === 'advance' || p.payment_type === 'advance_allocation' || !!p.advance_payment_id;

/** Human month label, e.g. '2026-03' â†’ 'March 2026'. */
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
  };
};

/**
 * Build the monthly statement for every clinic, newest month first.
 *
 * The blocks are bucketed from `buildLedgerEntries` -- the SAME engine the
 * General Ledger tab renders -- so the statement walks exactly the postings
 * the ledger walks: billing months, settlement months, and the clinic's
 * own OPENING balance (dated at its creation by the engine) all enter the
 * carrying chain. An explicit second engine here is what let a clinic owing
 * 41,000 historically plus 15,000 in the month read as 15,000 while the
 * General Ledger closed at 56,000 -- riding one engine removes the class of
 * bug: whatever the ledger posts, the statement closes from.
 */
export const buildMonthlyStatements = (input: {
  invoices: Invoice[];
  advancePayments: AdvancePayment[];
  accountAdjustments: AccountAdjustment[];
  labs?: Pick<
    DentalLab,
    'id' | 'name' | 'opening_balance' | 'opening_balance_type' | 'created_at'
  >[];
}): MonthlyStatementBlock[] => {
  const { invoices, advancePayments, accountAdjustments, labs } = input;

  /* The ledger engine produces entries newest-first with a running balance
     on each; reverse to posting order to walk. */
  const postings: LedgerEntry[] = [...buildLedgerEntries({
    invoices,
    advancePayments,
    accountAdjustments,
    labs,
  })].reverse();

  /* month | lab_id | flow bucket + the running balance at the month's last
     posting. Every money movement lands in the month of its own business
     date, so a month appears whenever the clinic transacted -- even when it
     raised no invoice (a deposit, a credit note or a brought-forward opening
     month). */
  type FlowState = FlowBucket & { lab_name: string };
  const months = new Map<string, Map<string, FlowState>>();

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

  // Advance applications are 0/0 memos in the ledger (the deposit already
  // carried the credit), so the ledger's Credit column never includes them.
  // The amount they USE is walked from the invoice payment rows — dated by
  // the payment date like every other movement — and surfaces ONLY as the
  // "Advance Used" column and the wallet math. It never enters `collected`.
  const applied = new Map<string, number>(); // "month|labId" -> amount used
  (invoices || []).forEach((inv) => {
    (inv?.payments || []).forEach((p) => {
      if (!isAdvanceAppliedPayment(p)) return;
      const month = monthKey(p.payment_date || inv.created_at);
      bucket(month, p.lab_id || inv.lab_id, p.lab_name || inv.lab_name);
      const key = `${month}|${p.lab_id || inv.lab_id}`;
      applied.set(key, (applied.get(key) || 0) + (p.amount || 0));
    });
  });

  postings.forEach((entry) => {
    const flow = bucket(monthKey(entry.date), entry.lab_id, entry.lab_name);
    if (entry.debit > 0 && entry.credit === 0) {
      // Invoices, debit adjustments and refunds: debits to the receivable.
      if (entry.entry_type === 'invoice') {
        flow.cases_billed += 1;
        flow.billed += entry.debit;
      } else {
        flow.debit_adjustments += entry.debit;
      }
    }
    if (entry.credit > 0 && entry.debit === 0) {
      // THE CREDIT COLUMN, VERBATIM: every credit the ledger posts — a
      // settlement, an advance deposit, a credit note, an opening credit —
      // rides into `collected` so the statement's Collected (Cr) figure is,
      // by construction, the same total the General Ledger's Credit column
      // prints for the clinic-month. Buckets below are the ledger's own
      // detail, and stay additive-only views of the same credits.
      flow.collected += entry.credit;
      if (entry.entry_type === 'advance_payment') flow.advance_received += entry.credit;
      else if (entry.entry_type === 'credit_note') flow.credit_notes += entry.credit;
    }
  });

  // Walk oldest to newest so each month's opening is the previous month's
  // closing. The engine's running_balance is GLOBAL (every clinic in one
  // chain), so a month's closing is aggregated per clinic over exactly the
  // postings the engine printed -- the same sum the engine's per-clinic
  // running balance (used by the General Ledger tab via filterLabId)
  // carries at that month's last posting. Advance allocations are 0/0
  // memos, so they are net-neutral and correctly absent from these flows.
  const ordered = Array.from(months.keys()).sort();
  const running = new Map<string, { closing: number; advance_credit: number }>();
  const blocks: MonthlyStatementBlock[] = [];

  ordered.forEach((month) => {
    const labMap = months.get(month)!;
    const rows: MonthlyClinicRow[] = [];

    labMap.forEach((flow, labId) => {
      const prior = running.get(labId) || { closing: 0, advance_credit: 0 };
      const opening_balance = roundMoney(prior.closing);
      const advance_applied = roundMoney(applied.get(`${month}|${labId}`) || 0);
      // The closing balance is the ledger's own running balance for this
      // clinic at this month's last posting: opening + the month's debits
      // (invoices + adjustments) - the month's credits (`collected`, which
      // is the Credit column verbatim — settlements, deposits, notes,
      // opening credit). Advance applications are 0/0 memos that neither
      // side of this identity sees, so no add-back exists.
      const closing_balance = roundMoney(
        opening_balance +
          flow.billed +
          flow.debit_adjustments -
          flow.collected
      );
      const advance_credit = roundMoney(
        Math.max(0, prior.advance_credit + flow.advance_received - advance_applied)
      );

      running.set(labId, { closing: closing_balance, advance_credit });

      rows.push({
        lab_id: labId,
        lab_name: flow.lab_name || 'Dental Clinic',
        cases_billed: flow.cases_billed,
        billed: roundMoney(flow.billed),
        collected: roundMoney(flow.collected),
        advance_received: roundMoney(flow.advance_received),
        advance_applied,
        credit_notes: roundMoney(flow.credit_notes),
        debit_adjustments: roundMoney(flow.debit_adjustments),
        opening_balance,
        closing_balance,
        advance_credit,
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
 * operator has filtered out â€” otherwise selecting a clinic would rewrite the
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

/** The statement's columns, declared once. */
export interface StatementColumn {
  key: StatementColumnKey;
  /** The heading, exactly as it appears on the screen, in the PDF and in the workbook. */
  label: string;
  /** Share of the width, for the PDF. */
  width: number;
  align: 'left' | 'right';
  /**
   * A CORE column is one a reader needs to read the statement at all; the
   * rest are detail. The Compact view shows the core columns and the Full
   * view shows all of them.
   */
  core: boolean;
  /**
   * A STRONG column is one the reader must see: the charge, the balance
   * carried forward, and what is still owed. The PDF sets these in bold, and
   * the screen sets them in the heavier weight â€” one rule, two renderers.
   */
  strong: boolean;
  /** The figure in this column for a clinic row. */
  value: (r: MonthlyClinicRow) => number;
}

export type StatementColumnKey =
  | 'clinic'
  | 'cases'
  | 'billed'
  | 'collected'
  | 'advanceUsed'
  | 'credits'
  | 'debits'
  | 'opening'
  | 'closing';

/**
 * THE TABLE, DECLARED ONCE.
 *
 * The screen, the PDF and the workbook all draw the same table, and they used
 * to declare it three times: twelve headings in one place, twelve SHORT
 * headings plus a legend explaining them in another, and twelve spreadsheet
 * headers in a third. They drifted â€” the PDF needed a legend because its
 * headings were abbreviations the other two did not use, so a document had
 * to be read alongside a key; and a column could be renamed in one place
 * and not the others.
 *
 * Now there is one table. The PDF prints the same headings the screen
 * prints, so it needs no legend; the workbook prints the same headings
 * again; and `core` is what the Compact view shows.
 */
export const STATEMENT_COLUMNS: readonly StatementColumn[] = [
  {
    key: 'clinic',
    label: 'Dental Clinic',
    width: 0.155,
    align: 'left',
    core: true,
    strong: false,
    value: () => 0,
  },
  {
    key: 'cases',
    label: 'Cases Billed',
    width: 0.05,
    align: 'right',
    core: true,
    strong: false,
    value: (r) => r.cases_billed,
  },
  {
    key: 'billed',
    label: 'Billed (Dr)',
    width: 0.095,
    align: 'right',
    core: true,
    strong: true,
    value: (r) => r.billed,
  },
  {
    key: 'collected',
    label: 'Collected (Cr)',
    width: 0.095,
    align: 'right',
    core: true,
    strong: false,
    value: (r) => r.collected,
  },
  {
    key: 'advanceUsed',
    label: 'Advance Used',
    width: 0.075,
    align: 'right',
    core: false,
    strong: false,
    value: (r) => r.advance_applied,
  },
  {
    key: 'credits',
    label: 'Credit Notes',
    width: 0.075,
    align: 'right',
    core: false,
    strong: false,
    value: (r) => r.credit_notes,
  },
  {
    key: 'debits',
    label: 'Debit Adj.',
    width: 0.075,
    align: 'right',
    core: false,
    strong: false,
    value: (r) => r.debit_adjustments,
  },
  {
    key: 'closing',
    label: 'Closing Balance',
    width: 0.095,
    align: 'right',
    core: true,
    strong: true,
    value: (r) => r.closing_balance,
  },
];

/** The columns to show: the core ones, or all of them. */
export const statementColumns = (coreOnly: boolean): StatementColumn[] =>
  STATEMENT_COLUMNS.filter((c) => !coreOnly || c.core);

/* ---------- the workbook ---------- */

/**
 * The monthly statement as an Excel workbook.
 *
 * A summary sheet, then one sheet per month â€” the same shape the PDF uses,
 * because that is the shape an operator reads the statement in. The figures
 * are NUMBERS with a money format, not strings, so a cell can be summed,
 * sorted and charted; a spreadsheet that cannot do arithmetic is a picture
 * of a spreadsheet.
 *
 * The columns come from the one declaration the screen and the PDF use
 * (STATEMENT_COLUMNS), so a heading can never be spelled one way on the
 * screen and another way in the file.
 *
 * The grand total deliberately leaves the balance columns blank. The flows
 * (billed, collected, advances, notes) add up across months; the balances
 * (opening, closing, due) do not, because each month opens where the last
 * one closed, and a total of them would be a number that means nothing.
 */
export const monthlyStatementWorkbook = (
  blocks: MonthlyStatementBlock[],
  meta: { labName: string; periodLabel: string; scopeLabel: string; generatedOn: string },
  coreOnly = false,
): Uint8Array => {
  const columns = statementColumns(coreOnly);
  const widths = [30, ...columns.slice(1).map((c) => (c.key === 'cases' ? 12 : 16))];

  /* The document's own title block, so the workbook says what it is when it
     is opened. A sheet that begins with a header row and no title is a
     screenshot of a document; this is a document. */
  const titleRows: XlsxCell[][] = [
    [{ value: meta.labName, style: XL.totalLabel }],
    [{ value: 'Monthly Statement', style: XL.totalLabel }],
    [{ value: `Period: ${meta.periodLabel}` }],
    [{ value: `Clinics: ${meta.scopeLabel}` }],
    [{ value: 'All amounts in PKR' }],
    [{ value: `Generated: ${meta.generatedOn}` }],
    [{ value: '' }],
  ];

  const moneyStyle = (key: StatementColumnKey) =>
    key === 'cases' ? XL.count : XL.money;

  /* The summary sheet is the statement BY MONTH, so it does not carry the
     clinic column â€” it carries the clinic COUNT instead, and then the same
     money columns the month sheets carry. */
  const summaryColumns = columns.slice(1);

  const summaryRows: XlsxCell[][] = [
    [
      { value: 'Month', style: XL.header },
      { value: 'Clinics', style: XL.header },
      ...summaryColumns.map((c) => ({ value: c.label, style: XL.header })),
    ],
    ...blocks.map((block) => [
      { value: formatMonthLabel(block.month) },
      { value: block.totals.clinics, style: XL.count },
      ...summaryColumns.map((c) => ({
        value:
          c.key === 'cases'
            ? block.totals.cases_billed
            : c.value(block.totals as unknown as MonthlyClinicRow),
        style: moneyStyle(c.key),
      })),
    ]),
  ];

  // The flows add up; the balances do not, so those cells are left empty.
  if (blocks.length > 0) {
    const sum = (pick: (b: MonthlyStatementBlock) => number) =>
      roundMoney(blocks.reduce((acc, b) => acc + pick(b), 0));
    const isBalance = (key: StatementColumnKey) =>
      key === 'opening' || key === 'closing';
    summaryRows.push([
      { value: 'TOTAL', style: XL.totalLabel },
      { value: '', style: XL.totalLabel },
      ...summaryColumns.map((c) => {
        if (c.key === 'cases') {
          return {
            value: blocks.reduce((a, b) => a + b.totals.cases_billed, 0),
            style: XL.totalCount,
          };
        }
        if (isBalance(c.key)) return { value: '', style: XL.totalMoney };
        return {
          value: sum((b) => c.value(b.totals as unknown as MonthlyClinicRow)),
          style: XL.totalMoney,
        };
      }),
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
        columns.map((c) => ({ value: c.label, style: XL.header })),
        ...block.rows.map((r) => [
          { value: r.lab_name },
          ...columns
            .slice(1)
            .map((c) => ({ value: c.value(r), style: moneyStyle(c.key) })),
        ]),
        [
          { value: 'MONTH TOTAL', style: XL.totalLabel },
          ...columns.slice(1).map((c) => ({
            value: c.value(block.totals as unknown as MonthlyClinicRow),
            style: c.key === 'cases' ? XL.totalCount : XL.totalMoney,
          })),
        ],
      ],
    })),
  ];

  return buildXlsx(sheets);
};
;
