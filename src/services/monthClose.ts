import { buildMonthlyStatements, type MonthlyClinicRow, type MonthlyStatementBlock } from './monthlyStatement';
import { monthCloseRepo, auditRepo, type MonthCloseRow } from '../db/repos';
import { roundMoney } from './financeDomain';
import { formatMonthLabel } from './monthlyStatement';
import type { DentalLab, Invoice, AdvancePayment, AccountAdjustment } from '../types';

/**
 * Month-end closing: one clinic, one calendar month, one frozen totals row.
 *
 * Closing is a decision the operator records, not a lock the system takes:
 * nothing in this feature blocks editing a document in a closed month, ever.
 * The row this writes is the statement of record for that clinic-month — the
 * same figures the monthly statement produces, stored so the report cannot
 * change out from under it later. A clinic that had no postings in the month
 * gets one too, carrying the balance it carried in, because a position that
 * cannot be read is not a position.
 *
 * The snapshot is totals only. The documents stay live bookkeeping: correcting
 * a payment is normal work, and the operator re-closes when the figures they
 * want on record have moved. Re-opening deletes the row; re-closing writes a
 * fresh one. Both events go to the audit log with the actor and, for a
 * reopen, the reason.
 *
 * Math is NEVER re-derived here. Every figure comes out of
 * `buildMonthlyStatements` — the same engine the General Ledger, the monthly
 * statement and the printed per-clinic PDF read, so a closed month cannot
 * disagree with any of the three.
 */

export interface MonthCloseInput {
  invoices?: Invoice[] | null;
  advancePayments?: AdvancePayment[] | null;
  accountAdjustments?: AccountAdjustment[] | null;
  labs?: Pick<DentalLab, 'id' | 'name' | 'opening_balance' | 'opening_balance_type' | 'created_at'>[] | null;
}

/** 'YYYY-MM' with a tolerance-free numeric equality for money. */
const sameAmount = (a: number, b: number): boolean => Math.abs((a || 0) - (b || 0)) <= 0.01;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const buildBlocks = (input: MonthCloseInput): MonthlyStatementBlock[] =>
  buildMonthlyStatements({
    invoices: input.invoices ?? [],
    advancePayments: input.advancePayments ?? [],
    accountAdjustments: input.accountAdjustments ?? [],
    labs: input.labs ?? undefined,
  });

/** The balance a clinic carries into `month` when nothing was posted that month:
 *  its newest closing at or before it, straight from the statement walk. */
const carriedClosing = (
  blocks: MonthlyStatementBlock[],
  labId: string,
  month: string,
): { closing_balance: number; advance_credit: number } => {
  let carried = { closing_balance: 0, advance_credit: 0 };
  // blocks are newest-first; walk oldest→newest up to the asked month
  for (const block of blocks.filter((b) => b.month <= month).reverse()) {
    const row = block.rows.find((r) => r.lab_id === labId);
    if (row) carried = { closing_balance: row.closing_balance, advance_credit: row.advance_credit };
  }
  return carried;
};

/** One clinic's snapshot for one month: live figures if it was active, carried
 *  balances if it was silent, zeros if it never posted. */
export const clinicMonthSnapshot = (
  blocks: MonthlyStatementBlock[],
  labId: string,
  labName: string,
  month: string,
): MonthlyClinicRow => {
  const live = blocks.find((b) => b.month === month)?.rows.find((r) => r.lab_id === labId);
  if (live) return { ...live, lab_name: labName || live.lab_name };
  const carried = carriedClosing(blocks, labId, month);
  return {
    lab_id: labId,
    lab_name: labName || 'Clinic',
    cases_billed: 0,
    billed: 0,
    collected: 0,
    advance_received: 0,
    advance_applied: 0,
    credit_notes: 0,
    debit_adjustments: 0,
    opening_balance: carried.closing_balance,
    closing_balance: carried.closing_balance,
    advance_credit: carried.advance_credit,
  };
};

/** Every clinic in scope — saved clinics union clinics found in the books —
 *  with this month's figures. Zero-activity clinics are not dropped out. */
export const clinicMonthSnapshots = (
  input: MonthCloseInput,
  month: string,
): MonthlyClinicRow[] => {
  if (!MONTH_RE.test(month)) throw new Error(`month must be 'YYYY-MM', got '${month}'`);
  const blocks = buildBlocks(input);
  const names = new Map<string, string>();
  blocks.forEach((block) =>
    block.rows.forEach((row) => {
      if (!names.has(row.lab_id)) names.set(row.lab_id, row.lab_name);
    }),
  );
  (input.labs ?? []).forEach((lab) => {
    if (lab.name) names.set(lab.id, lab.name);
    else if (!names.has(lab.id)) names.set(lab.id, 'Clinic');
  });
  const ids = [...names.keys()];
  return ids
    .map((id) => clinicMonthSnapshot(blocks, id, names.get(id) || 'Clinic', month))
    .sort((a, b) => a.lab_name.localeCompare(b.lab_name));
};

export interface CloseMonthInput extends MonthCloseInput {
  month: string;
  labId: string;
  labName?: string;
  actor?: string;
}

/** Close (or re-close) a clinic-month. Totals are recomputed from the live
 *  books every time, so a re-close always lands where the ledger stands. */
export const closeMonth = (input: CloseMonthInput): MonthCloseRow => {
  const { month, labId } = input;
  if (!MONTH_RE.test(month)) throw new Error(`month must be 'YYYY-MM', got '${month}'`);
  const blocks = buildBlocks(input);
  const labs = input.labs ?? [];
  const labName = input.labName || labs.find((l) => l.id === labId)?.name
    || blocks.flatMap((b) => b.rows).find((r) => r.lab_id === labId)?.lab_name
    || 'Clinic';
  const snapshot = clinicMonthSnapshot(blocks, labId, labName, month);
  const actor = input.actor || 'System';
  const row = monthCloseRepo.upsert({
    month,
    lab_id: labId,
    cases_billed: snapshot.cases_billed,
    billed: roundMoney(snapshot.billed),
    collected: roundMoney(snapshot.collected),
    advance_received: roundMoney(snapshot.advance_received),
    advance_applied: roundMoney(snapshot.advance_applied),
    credit_notes: roundMoney(snapshot.credit_notes),
    debit_adjustments: roundMoney(snapshot.debit_adjustments),
    opening_balance: roundMoney(snapshot.opening_balance),
    closing_balance: roundMoney(snapshot.closing_balance),
    advance_credit: roundMoney(snapshot.advance_credit),
    closed_by: actor,
    closed_at: new Date().toISOString(),
  });
  const label = `${labName} · ${formatMonthLabel(month)}`;
  auditRepo.log({
    actor,
    action: 'month_close',
    entity_type: 'month_close',
    entity_id: `${month}:${labId}`,
    entity_ref: label,
    notes: `Closed ${label}: billed ${roundMoney(snapshot.billed)}, collected ${roundMoney(snapshot.collected)}, closing ${roundMoney(snapshot.closing_balance)}`,
    new_state: snapshot,
  });
  return row;
};

export interface ReopenMonthInput extends MonthCloseInput {
  month: string;
  labId: string;
  labName?: string;
  actor?: string;
  reason: string;
}

/** Undo a close. A reason is mandatory and both events land in the audit log. */
export const reopenMonth = (input: ReopenMonthInput): void => {
  const { month, labId } = input;
  if (!MONTH_RE.test(month)) throw new Error(`month must be 'YYYY-MM', got '${month}'`);
  if (!(input.reason || '').trim()) {
    throw new Error('A reason is required to reopen a closed month.');
  }
  const existing = monthCloseRepo.get(month, labId);
  if (!existing) throw new Error('That clinic-month is not closed.');
  const actor = input.actor || 'System';
  const labs = input.labs ?? [];
  const labName = input.labName || labs.find((l) => l.id === labId)?.name || 'Clinic';
  monthCloseRepo.remove(month, labId);
  auditRepo.log({
    actor,
    action: 'month_reopen',
    entity_type: 'month_close',
    entity_id: `${month}:${labId}`,
    entity_ref: `${labName} · ${formatMonthLabel(month)}`,
    reason: input.reason.trim(),
    notes: `Reopened ${labName} · ${formatMonthLabel(month)}`,
    old_state: existing,
  });
};

/** The closed rows for one month, keyed by clinic for O(1) lookups in the UI. */
export const closedMonthFor = (month: string): Map<string, MonthCloseRow> => {
  const map = new Map<string, MonthCloseRow>();
  for (const row of monthCloseRepo.forMonth(month)) map.set(row.lab_id, row);
  return map;
};

/** All closed rows, newest month first — what the drift check walks. */
export const listMonthCloses = (): MonthCloseRow[] => monthCloseRepo.all();

export interface MonthCloseDrift {
  month: string;
  labId: string;
  labName: string;
  /** Field name → what moved, for the banner ("billed: 40,000 → 55,000"). */
  moved: { field: string; stored: number; live: number }[];
}

const TRACKED: (keyof MonthlyClinicRow)[] = [
  'cases_billed',
  'billed',
  'collected',
  'advance_received',
  'advance_applied',
  'credit_notes',
  'debit_adjustments',
  'opening_balance',
  'closing_balance',
  'advance_credit',
];

/**
 * Closed months whose live figures no longer match their stored snapshot.
 * A closed month is a position as it stood at close; this is how the operator
 * sees when the books have moved since — the answer is Re-close, never an
 * silent overwrite.
 */
export const diffClosedMonths = (input: MonthCloseInput): MonthCloseDrift[] => {
  const stored = listMonthCloses();
  if (stored.length === 0) return [];
  const byMonth = new Map<string, MonthCloseRow[]>();
  stored.forEach((row) => {
    const bucket = byMonth.get(row.month) ?? [];
    bucket.push(row);
    byMonth.set(row.month, bucket);
  });
  const blocks = buildBlocks(input);
  const drifts: MonthCloseDrift[] = [];
  for (const [month, rows] of byMonth) {
    const labs = input.labs ?? [];
    for (const row of rows) {
      const labName =
        labs.find((l) => l.id === row.lab_id)?.name
        || blocks.flatMap((b) => b.rows).find((r) => r.lab_id === row.lab_id)?.lab_name
        || 'Clinic';
      const live = clinicMonthSnapshot(blocks, row.lab_id, labName, month);
      const moved = TRACKED.flatMap((field) => {
        const a = row[field as keyof MonthCloseRow] as number;
        const b = live[field] as number;
        return sameAmount(a, b) ? [] : [{ field, stored: a, live: b }];
      });
      if (moved.length) {
        drifts.push({ month, labId: row.lab_id, labName, moved });
      }
    }
  }
  return drifts.sort((a, b) => b.month.localeCompare(a.month));
};
