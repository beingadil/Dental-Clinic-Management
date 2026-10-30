import type { AdvancePayment, CaseStatus, DentalCase, Invoice, PaymentRecord, PriorityLevel } from '../types';
import { getTodayStr } from '../utils/dateUtils';

/**
 * DAILY LAB REPORT — what came in, what went out, and what is still owed, for a
 * chosen window.
 *
 * This is the operator's end-of-day question: "what did the lab take in today,
 * and what is still out there?". It is deliberately NOT a month statement and
 * NOT a ledger — those answer "what does this clinic owe me over time". This
 * answers "what happened", and it is the one report a lab owner reads every
 * single day.
 *
 * Everything here is derived, never stored. A report that has its own table
 * becomes a second source of truth the day a case is edited.
 */

/** The day a case entered the lab. Falls back to creation when the operator
 *  never recorded a received date — a case without one still arrived. */
export const caseReceivedDate = (c: DentalCase): string =>
  (c.received_date || c.created_at || '').slice(0, 10);

/** The day an invoice was raised. Falls back to creation for legacy rows. */
export const invoiceIssuedDate = (inv: Invoice): string =>
  (inv.issue_date || inv.created_at || '').slice(0, 10);

/** The day a payment actually landed. */
export const paymentDate = (p: PaymentRecord): string =>
  (p.payment_date || p.created_at || '').slice(0, 10);

export interface DailyReportInput {
  cases: DentalCase[];
  invoices: Invoice[];
  advancePayments: AdvancePayment[];
  from: string;
  to: string;
  /** Include archived cases. Off by default: an archived case is history. */
  includeArchived?: boolean;
  /**
   * Restrict the report to some case types ("Zirconia", "Aligners", …).
   *
   * An empty list, or the entries `'all'`, mean every type. The match is exact
   * on the type NAME after trimming and lower-casing, not a substring match:
   * "Crown" must not swallow "Zirconia Crown" AND "PFM Crown", or the
   * operator's clinic totals would quietly include work they did not ask for.
   *
   * The operator can tick several treatments at once ("zirconia and e.max this
   * month"), so the filter is a SET. One filter, applied once, so the sheet and
   * the per-clinic totals can never disagree about which work is in scope.
   */
  caseTypes?: string[];
  /** Single-type shorthand for callers that only ever ask about one treatment. */
  caseType?: string;
}

/** One case as it appears in the production sheet. */
export interface ProductionRow {
  id: string;
  /** The clinic's id. Carried on the row so grouping never has to look the
   *  case up again — a report over a few thousand cases should stay linear. */
  labId: string;
  caseNumber: string;
  receivedDate: string;
  deliveryDate: string;
  caseType: string;
  doctor: string;
  patient: string;
  clinic: string;
  status: CaseStatus;
  priority: PriorityLevel;
  units: number;
  teeth: string;
  shade: string;
  material: string;
  price: number;
  /** Days from receipt to the promised delivery date — the lead time given. */
  daysToDelivery: number;
  /** Days remaining until the promised delivery date, measured at the end of
   *  the window. Negative means it went past due by that many days. */
  daysRemaining: number;
  isOverdue: boolean;
}

/** One clinic's slice of the day. */
export interface ClinicRow {
  labId: string;
  labName: string;
  doctor: string;
  casesReceived: number;
  casesDue: number;
  invoicesRaised: number;
  invoicedValue: number;
  paymentsReceived: number;
  paidValue: number;
  outstanding: number;
  advanceCredit: number;
}

/** One clinic's work in the window, for the chosen case type.
 *
 * This is the "who sent us how much of this, and what is it worth" view: the
 * question an operator asks when a clinic rings up about a specific treatment
 * rather than about their account. `cases` carries the individual rows so the
 * UI can open the detail without a second query or a second derivation rule.
 */
export interface ClinicWorkRow {
  labId: string;
  labName: string;
  doctor: string;
  cases: number;
  units: number;
  /** Sum of the case prices — the work's value, not what is owed on it.
   *  Money owed is the invoice's business, and a case may not be invoiced yet. */
  value: number;
  rows: ProductionRow[];
}

export interface DailyLabReport {
  from: string;
  to: string;
  /** The case-type filter this report was built with (`''` = all types). */
  caseType: string;
  /** Per-clinic work for the window and the chosen type, biggest value first. */
  byClinic: ClinicWorkRow[];
  /** Cases received in the window. */
  received: number;
  /** Cases whose delivery date falls in the window. */
  due: number;
  /** Cases received but not yet delivered at the end of the window. */
  open: number;
  overdue: number;
  invoicesRaised: number;
  invoicedValue: number;
  paymentsReceived: number;
  paidValue: number;
  advancesReceived: number;
  advanceValue: number;
  advanceCredit: number;
  /** Outstanding receivable across the whole lab, not just the window. */
  totalOutstanding: number;
  production: ProductionRow[];
  clinics: ClinicRow[];
}

const inRange = (day: string, from: string, to: string) =>
  !!day && (!from || day >= from) && (!to || day <= to);

const DAY_MS = 86_400_000;

export const buildDailyLabReport = (input: DailyReportInput): DailyLabReport => {
  const { cases, invoices, advancePayments, from, to, includeArchived } = input;

  /* One list of requested types, whichever way the caller supplied them, with
     hand-typed duplicates folded together so the label cannot read
     "Zirconia + zirconia". */
  const requestedTypes: string[] = [];
  const seenTypes = new Set<string>();
  for (const raw of input.caseTypes?.length ? input.caseTypes : input.caseType ? [input.caseType] : []) {
    const label = (raw || '').trim();
    const key = label.toLowerCase();
    if (!key || key === 'all' || seenTypes.has(key)) continue;
    seenTypes.add(key);
    requestedTypes.push(label);
  }
  const isAllTypes = requestedTypes.length === 0;
  const caseTypeName = (c: DentalCase) =>
    (c.case_type_name || c.case_type || '').trim();

  const liveCases = includeArchived ? cases : cases.filter((c) => !c.archived_at);

  /* The type filter is applied ONCE, here, and everything below reads this
     list — the production sheet, the clinic counts and the per-clinic work
     breakdown. Filtering at each use site is how the header total and the rows
     under it drift apart. */
  const scopedCases = isAllTypes
    ? liveCases
    : liveCases.filter((c) => seenTypes.has(caseTypeName(c).toLowerCase()));

  /* ---- Production sheet: every case received in the window. */
  const production: ProductionRow[] = scopedCases
    .filter((c) => inRange(caseReceivedDate(c), from, to))
    .map((c) => {
      const received = caseReceivedDate(c);
      const delivery = (c.delivery_date || '').slice(0, 10);
      // The lead time the job was given: receipt to promised delivery.
      const daysToDelivery = delivery && received
        ? Math.round((new Date(delivery).getTime() - new Date(received).getTime()) / DAY_MS)
        : 0;
      // Overdue is judged against the END OF THE WINDOW, not against the receipt
      // date. A case received on the 10th and due on the 15th has a five-day
      // lead time; it is only OVERDUE once the 15th has passed. Comparing the two
      // dates to each other would call it late on the day it arrived.
      const asOf = to || getTodayStr();
      // Positive = days still to run; negative = days already past due.
      const daysRemaining = delivery && asOf
        ? Math.round((new Date(delivery).getTime() - new Date(asOf).getTime()) / DAY_MS)
        : 0;
      return {
        id: c.id,
        labId: c.lab_id,
        caseNumber: c.case_number,
        receivedDate: received,
        deliveryDate: delivery,
        caseType: c.case_type_name || c.case_type || '—',
        doctor: c.doctor_name || '—',
        patient: c.patient_name || '—',
        clinic: c.lab_name || '—',
        status: c.status,
        priority: c.priority,
        units: c.units_count || 0,
        teeth: (c.selected_teeth || []).length ? c.selected_teeth.map((t) => `#${t}`).join(' ') : '—',
        shade: c.shade || '—',
        material: c.material || '—',
        price: c.final_price || 0,
        daysToDelivery,
        daysRemaining,
        isOverdue:
          daysRemaining < 0 && c.status !== 'delivered' && c.status !== 'cancelled',
      };
    })
    .sort((a, b) => (a.receivedDate < b.receivedDate ? 1 : a.receivedDate > b.receivedDate ? -1 : a.caseNumber.localeCompare(b.caseNumber)));

  /* ---- Cases due for delivery in the window. */
  const due = scopedCases.filter((c) => inRange((c.delivery_date || '').slice(0, 10), from, to));

  /* ---- Money moved in the window. */
  const windowInvoices = invoices.filter((inv) => inRange(invoiceIssuedDate(inv), from, to));
  const invoicedValue = windowInvoices.reduce((s, inv) => s + (inv.final_amount || 0), 0);

  let paymentsReceived = 0;
  let paidValue = 0;
  for (const inv of invoices) {
    for (const p of inv.payments || []) {
      if (!inRange(paymentDate(p), from, to)) continue;
      paymentsReceived += 1;
      paidValue += p.amount || 0;
    }
  }

  const windowAdvances = advancePayments.filter((a) => inRange((a.payment_date || a.created_at || '').slice(0, 10), from, to));
  const advanceValue = windowAdvances.reduce((s, a) => s + (a.amount || 0), 0);
  const advanceCredit = advancePayments.reduce((s, a) => s + (a.remaining_amount || 0), 0);

  /* ---- Outstanding across the WHOLE lab: a day with no invoices does not mean
   *  the money stopped being owed. */
  const totalOutstanding = invoices.reduce(
    (s, inv) => s + Math.max(0, (inv.final_amount || 0) - (inv.amount_paid || 0)),
    0
  );

  /* ---- Per-clinic breakdown. */
  const byLab = new Map<string, ClinicRow>();
  const labFor = (labId: string, labName: string) => {
    let row = byLab.get(labId);
    if (!row) {
      row = {
        labId,
        labName: labName || 'Unknown clinic',
        doctor: '',
        casesReceived: 0,
        casesDue: 0,
        invoicesRaised: 0,
        invoicedValue: 0,
        paymentsReceived: 0,
        paidValue: 0,
        outstanding: 0,
        advanceCredit: 0,
      };
      byLab.set(labId, row);
    }
    return row;
  };

  for (const c of scopedCases) {
    if (inRange(caseReceivedDate(c), from, to)) {
      const row = labFor(c.lab_id, c.lab_name);
      row.casesReceived += 1;
      if (!row.doctor && c.doctor_name) row.doctor = c.doctor_name;
    }
    if (inRange((c.delivery_date || '').slice(0, 10), from, to)) {
      labFor(c.lab_id, c.lab_name).casesDue += 1;
    }
  }

  for (const inv of invoices) {
    const row = labFor(inv.lab_id, inv.lab_name);
    if (!row.doctor && inv.doctor_name) row.doctor = inv.doctor_name;
    if (inRange(invoiceIssuedDate(inv), from, to)) {
      row.invoicesRaised += 1;
      row.invoicedValue += inv.final_amount || 0;
    }
    for (const p of inv.payments || []) {
      if (inRange(paymentDate(p), from, to)) {
        row.paymentsReceived += 1;
        row.paidValue += p.amount || 0;
      }
    }
    // Outstanding is a standing balance, not a windowed one.
    row.outstanding += Math.max(0, (inv.final_amount || 0) - (inv.amount_paid || 0));
  }

  for (const a of advancePayments) {
    labFor(a.lab_id, a.lab_name).advanceCredit += a.remaining_amount || 0;
  }

  const clinics = [...byLab.values()]
    .filter((r) => r.casesReceived || r.casesDue || r.invoicesRaised || r.paymentsReceived || r.outstanding > 0)
    .sort((a, b) => b.casesReceived - a.casesReceived || a.labName.localeCompare(b.labName));

  /* ---- Per-clinic WORK for the window's type: who sent this kind of job,
   *  how many, how many units, and what it was worth. Grouped from the same
   *  production rows the sheet shows, so a click-through can never disagree
   *  with the list it came from. */
  const byClinicMap = new Map<string, ClinicWorkRow>();
  for (const row of production) {
    const labId = row.labId || row.clinic;
    let entry = byClinicMap.get(labId);
    if (!entry) {
      entry = {
        labId,
        labName: row.clinic,
        doctor: '',
        cases: 0,
        units: 0,
        value: 0,
        rows: [],
      };
      byClinicMap.set(labId, entry);
    }
    entry.cases += 1;
    entry.units += row.units || 0;
    entry.value += row.price || 0;
    if (!entry.doctor && row.doctor && row.doctor !== '—') entry.doctor = row.doctor;
    entry.rows.push(row);
  }
  const byClinic = [...byClinicMap.values()].sort(
    (a, b) => b.value - a.value || b.cases - a.cases || a.labName.localeCompare(b.labName)
  );

  const open = scopedCases.filter(
    (c) => c.status !== 'delivered' && c.status !== 'cancelled' && inRange(caseReceivedDate(c), from, to)
  ).length;

  const overdue = production.filter((r) => r.isOverdue).length;

  return {
    from,
    to,
    received: production.length,
    due: due.length,
    open,
    overdue,
    invoicesRaised: windowInvoices.length,
    invoicedValue,
    paymentsReceived,
    paidValue,
    advancesReceived: windowAdvances.length,
    advanceValue,
    advanceCredit,
    totalOutstanding,
    /* The label, not the case fold: a filter that matches nothing still has to
       say WHICH types they were, or the empty sheet looks like a bug. */
    caseType: requestedTypes.join(' + '),
    byClinic,
    production,
    clinics,
  };
};
