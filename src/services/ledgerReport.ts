/**
 * Normalized ledger reporting — Phase 2 + Phase 3.
 *
 * buildLedgerEntries (ledgerDomain.ts) already produces the accounting facts:
 * every invoice posts a debit, every payment slice / advance / adjustment posts
 * a credit, chronological order, opening-balance event, `running_balance`.
 *
 * This layer adds the **auditable presentation layer** the task requires:
 *   - VOUCHER TRACEABILITY. `voucherNumber` (PAY-2026-0001, INV-0054, CR-0001…)
 *     is kept SEPARATE from `caseNumber` (DS-0027). A voucher number is never
 *     derived from a case number. One voucher covering multiple cases produces
 *     one LINE PER CASE with the same voucher number and only its allocated
 *     amount — never duplicated, never merged.
 *   - CORRECT ACCOUNTING. Recompute everything from actual postings: opening
 *     = Σ(debit − credit) before the period + clinic brought-forward; running =
 *     prev + debit − credit; closing = opening + totalDebit − totalCredit.
 *     Nothing is re-derived from invoice totals independently of payments.
 *   - STABLE ROUNDING. Money is rounded to 2dp at every boundary; balances are
 *     carried in integer cents internally so 0.1 + 0.2 problems cannot appear.
 *   - PAYMENT STATUS. partial vs final-settlement, related invoice voucher.
 *
 * Pure functions only; no React, no DB, no LLM.
 */

export interface LedgerReportRow {
  /* identity */
  id: string;
  /** Transaction date (business date, YYYY-MM-DD). */
  date: string;
  /** Display date, e.g. 05-Oct-2026 — the same on screen and in the PDF. */
  dateLabel: string;
  /** Posting timestamp (ISO) — stable sort key. */
  posted_at?: string;
  /** 'invoice' | 'payment' | 'advance_payment' | 'advance_allocation' | 'credit_note' | 'debit_adjustment' | 'refund' | 'write_off' | 'opening_balance'. */
  type: string;
  /** Type label for display. */
  typeLabel: string;
  /** Voucher number: INV-0054 / PAY-2026-0005 / CR-0001 / DR-0003 / ADV-0001 / OPENING. */
  voucherNumber: string;
  /** Related invoice voucher number when this row pays/adjusts an invoice. */
  relatedInvoiceNumber?: string;
  /** Case/job id. */
  caseNumber?: string;
  caseId?: string;
  /** Clinic/customer. */
  clinicId?: string;
  clinicName?: string;
  /** Patient. */
  patientName?: string;
  patientId?: string;
  /** Procedure / case type. */
  procedure?: string;
  /** Procedure recorded on the case, when it differs from the invoice. */
  caseProcedure?: string;
  /** True when the invoice and its case disagree on the procedure. */
  clinicalMismatch?: boolean;
  /** Tooth numbers as stored, full list, never truncated. */
  teeth?: string;
  shade?: string;
  units?: number;
  /** Received (case received date). */
  receivedDate?: string;
  /** Delivery date. */
  deliveryDate?: string;
  /** Narration, cleaned single-line. */
  narration: string;
  /** Narration without the voucher/case prefix already shown in its own
      column. Keeps the printed row from repeating the same reference twice. */
  bodyNarration?: string;
  /* amounts, 2dp */
  debit: number;
  credit: number;
  /** Running balance, 2dp. */
  balance: number;
  /** Payment allocation: which invoice + how much allocated here (2dp). */
  allocations?: { invoiceNumber?: string; caseNumber?: string; amount: number }[];
  /** Payment method (cash / bank / cheque / advance), when the row is a receipt. */
  paymentMethod?: string;
  /** Payment status note: partial / final settlement. */
  paymentNote?: string;
  /** Raw underlying reference id. */
  referenceId?: string;
  recordedBy?: string;
  notes?: string;
}

export interface LedgerReportSummary {
  openingBalance: number;
  totalDebits: number;
  totalCredits: number;
  closingBalance: number;
  transactionCount: number;
  /**
   * Adjustments posted with an "opening balance" reason. They are shown as
   * period transactions (never silently reinterpreted); this lets the screen
   * and PDF tell the reader to review them against the brought-forward field.
   */
  openingBalanceReview?: { voucherNumber: string; typeLabel: string; amount: number }[];
}

/* ---------- stable money: integer cents ---------- */
export const toCents = (n: number): number => Math.round((n + Number.EPSILON) * 100);
export const fromCents = (c: number): number => Math.round(c) / 100;
export const round2 = (n: number): number => fromCents(toCents(n || 0));

/* ---------- type labels ---------- */
const TYPE_LABEL: Record<string, string> = {
  invoice: 'Invoice',
  payment: 'Payment Received',
  advance_payment: 'Advance Deposit',
  advance_allocation: 'Advance Applied',
  credit_note: 'Credit Note',
  debit_adjustment: 'Debit Adjustment',
  refund: 'Refund',
  write_off: 'Write Off',
  opening_balance: 'Opening Balance',
};

export const typeLabelFor = (t?: string): string => TYPE_LABEL[t || ''] || 'Other';

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  bank: 'Bank',
  cheque: 'Cheque',
  advance: 'Advance',
};

/** Payment rows read from the account holder's side: money RECEIVED, not paid. */
export const receiptTypeLabel = (method?: string): string => {
  const label = METHOD_LABEL[String(method || '').toLowerCase()];
  return label ? `${label} Receipt` : 'Payment Received';
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Tooth numbers are clinical data: keep the full list, in numeric order. */
const formatTeeth = (teeth?: string[]): string | undefined => {
  if (!teeth?.length) return undefined;
  const sorted = teeth.slice().sort((a, b) => {
    const na = Number(a); const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });
  return sorted.map((t) => `#${t}`).join(', ');
};

/** Deterministic business-date label, with no timezone drift. */
export const formatLedgerDate = (value?: string): string => {
  const iso = isoDate(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${m[3]}-${month}-${m[1]}` : iso;
};

/* ---------- narration cleanup ---------- */
/** Collapse whitespace; strip separators so narration reads cleanly. */
export const cleanNarration = (s?: string): string =>
  String(s || '').replace(/\s+/g, ' ').replace(/\s*\|\s*/g, ' · ').trim();

/* ---------- the normalizer ---------- */
export interface LedgerCaseInfo {
  case_number?: string;
  case_id?: string;
  patient_name?: string;
  patient_id?: string;
  doctor_name?: string;
  case_type_name?: string;
  selected_teeth?: string[];
  shade?: string;
  quantity?: number;
  created_at?: string;
  received_at?: string;
  delivery_date?: string;
}

export interface BuildLedgerReportInput {
  entries: {
    id: string;
    date: string;
    posted_at?: string;
    entry_type?: string;
    type?: string;
    reference_id?: string;
    reference_number?: string;
    case_id?: string;
    case_number?: string;
    lab_id?: string;
    lab_name?: string;
    description?: string;
    notes?: string;
    payment_method?: string;
    debit?: number;
    credit?: number;
    running_balance?: number;
    recorded_by?: string;
    invoiceDetails?: { invoiceNumber?: string; patient?: string; procedure?: string; amount?: number }[];
  }[];
  cases?: LedgerCaseInfo[];
  /** Map invoice voucher number → case number, to recover related invoice + case. */
  invoices?: { id?: string; invoice_number?: string; case_number?: string; case_id?: string; patient_name?: string; patient_id?: string; case_type_name?: string }[];
  /** Payment voucher number → the invoices it allocates to (multi-case vouchers). */
  paymentAllocations?: Map<string, { invoiceNumber?: string; caseNumber?: string; amount: number }[]>;
  /** Opening balance brought forward already in `entries` as 'opening_balance'. */
  periodStart?: string;
  periodEnd?: string;
  /** Extra filters. */
  clinicId?: string;
  caseNumber?: string;
}

const isoDate = (s?: string): string => {
  if (!s) return '';
  const d = String(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const t = Date.parse(d);
  return isNaN(t) ? d.slice(0, 10) : new Date(t).toISOString().slice(0, 10);
};

/** Strip slice suffix `PAY-2026-0001-2` → `PAY-2026-0001`. */
export const voucherBaseNumber = (num?: string): string => {
  const value = String(num || '');
  const parts = value.split('-');
  // `PAY-2026-0001-2` (4 parts) → `PAY-2026-0001`; `PAY-2026-0001` (3) unchanged.
  // An invoice/reference number with four parts is not a payment slice.
  const isSlice = parts.length === 4 && /^(PAY|ADV)$/i.test(parts[0]) && /^\d+$/.test(parts[3]);
  return isSlice ? parts.slice(0, -1).join('-') : value;
};

export function buildLedgerReport(input: BuildLedgerReportInput): { rows: LedgerReportRow[]; summary: LedgerReportSummary } {
  const cases = input.cases || [];
  const invoices = input.invoices || [];
  const findCase = (e: { case_number?: string; case_id?: string }): LedgerCaseInfo | undefined =>
    cases.find((c) => c.case_id === e.case_id) || cases.find((c) => (c.case_number || '').toLowerCase() === (e.case_number || '').toLowerCase());
  const findInvoiceByVoucher = (v?: string) => invoices.find((i) => (i.invoice_number || '').toUpperCase() === String(v || '').toUpperCase());
  const findInvoiceForEntry = (e: { reference_id?: string; reference_number?: string; description?: string }) => {
    const byId = e.reference_id ? invoices.find((i) => i.id === e.reference_id) : undefined;
    if (byId) return byId;
    const byVoucher = findInvoiceByVoucher(e.reference_number);
    if (byVoucher) return byVoucher;
    const m = String(e.description || '').match(/INV-[A-Za-z0-9-]+/i);
    return m ? findInvoiceByVoucher(m[0]) : undefined;
  };

  /* 1. order chronologically, stable */
  const sorted = input.entries.slice().sort((a, b) => {
    const ta = Date.parse(a.posted_at || a.date || '');
    const tb = Date.parse(b.posted_at || b.date || '');
    const A = isNaN(ta) ? 0 : ta; const B = isNaN(tb) ? 0 : tb;
    if (A !== B) return A - B;
    return String(a.id).localeCompare(String(b.id));
  });

  /* 2. period + case filtering, tracking opening */
  const periodStart = isoDate(input.periodStart);
  const periodEnd = isoDate(input.periodEnd);
  let openingCents = 0;
  const active: typeof sorted = [];
  for (const e of sorted) {
    if (input.clinicId && e.lab_id && e.lab_id !== input.clinicId) continue;
    if (input.caseNumber && (e.case_number || '').toLowerCase() !== input.caseNumber.toLowerCase()) continue;
    const d = isoDate(e.date);
    const drC = toCents(e.debit || 0); const crC = toCents(e.credit || 0);
    if (periodStart && d && d < periodStart) { openingCents += drC - crC; continue; }
    if (periodEnd && d && d > periodEnd) continue;
    active.push(e);
  }

  /* 3. build rows + running balance */
  let runningCents = openingCents;
  const rows: LedgerReportRow[] = [];
  const openingBalanceReview: NonNullable<LedgerReportSummary['openingBalanceReview']> = [];
  for (const e of active) {
    const type = e.entry_type || e.type || '';
    const c = findCase(e);
    const invoice = findInvoiceForEntry(e);
    const voucherNumber = voucherBaseNumber(e.reference_number || '');
    const drC = toCents(e.debit || 0); const crC = toCents(e.credit || 0);
    runningCents += drC - crC;

    /* related invoice voucher */
    let relatedInvoiceNumber: string | undefined;
    if (type === 'invoice') relatedInvoiceNumber = undefined;
    else if (voucherNumber.startsWith('INV-')) relatedInvoiceNumber = voucherNumber;
    else {
      const inv = findInvoiceByVoucher(e.reference_number);
      if (inv?.invoice_number) relatedInvoiceNumber = inv.invoice_number;
      else {
        // payment slice named PAY-X-1 under invoice found via invoice voucher in description
        const m = (e.description || '').match(/INV-[A-Za-z0-9-]+/i);
        if (m) relatedInvoiceNumber = m[0].toUpperCase();
      }
    }
    /* A merged multi-invoice voucher names every invoice it paid in the
       description; keep them all in the narration, not just the first. */
    const allInvoiceNumbers = Array.from(
      new Set((e.description || '').toUpperCase().match(/INV-[A-Za-z0-9-]+/g) || [])
    );

    /* payment allocation */
    const allocations = input.paymentAllocations?.get(voucherNumber) || undefined;
    let paymentNote: string | undefined;

    const caseNumber = e.case_number || c?.case_number || invoice?.case_number || '';
    const patientName = c?.patient_name || invoice?.patient_name;
    const caseProcedure = c?.case_type_name;
    /* An invoice narrates what was BILLED. Prefer the invoice's own procedure;
       the case record is kept alongside so a disagreement is visible instead
       of the ledger silently picking one. */
    const procedure = type === 'invoice'
      ? (invoice?.case_type_name || caseProcedure)
      : (caseProcedure || invoice?.case_type_name);
    /* Treat a more specific case label as compatible with a shorter invoice
       label ("Night Guard" vs "lower Night Guard") and ignore punctuation.
       Only a genuinely different procedure is a clinical mismatch. */
    const normProcedure = (value?: string) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const invoiceProcedure = normProcedure(invoice?.case_type_name);
    const caseProcedureNorm = normProcedure(caseProcedure);
    const clinicalMismatch = !!(invoiceProcedure && caseProcedureNorm &&
      !invoiceProcedure.includes(caseProcedureNorm) &&
      !caseProcedureNorm.includes(invoiceProcedure));
    const paymentMethod = type === 'payment' ? e.payment_method : undefined;
    const typeLabel = type === 'payment' ? receiptTypeLabel(paymentMethod) : typeLabelFor(type);

    /* narration */
    const voucher = voucherNumber || '—';
    const casePart = caseNumber ? `Case ${caseNumber}` : '';
    const patientPart = patientName ? `Patient: ${patientName}` : '';
    let narration: string;
    let bodyNarration: string;
    if (type === 'invoice') {
      const proc = procedure || 'Restoration';
      bodyNarration = [
        `Invoice for ${proc}`,
        clinicalMismatch ? `Case record: ${caseProcedure} — verify` : '',
        patientPart,
        c?.selected_teeth?.length ? `Teeth: ${formatTeeth(c.selected_teeth)}` : '',
        c?.shade ? `Shade: ${c.shade}` : '',
      ].filter(Boolean).join(' | ');
      narration = [`${voucher}`, casePart, bodyNarration].filter(Boolean).join(' | ');
    } else if (type === 'payment') {
      const details = e.invoiceDetails || [];
      const against =
        details.length > 1
          ? `Against ${details
              .map(
                (d) =>
                  `${d.invoiceNumber || ''}${
                    d.patient || d.procedure ? ` (${[d.patient, d.procedure].filter(Boolean).join(', ')})` : ''
                  }`
              )
              .join(', ')}`
          : allInvoiceNumbers.length
          ? `Against ${allInvoiceNumbers.join(', ')}`
          : '';
      const multiInvoice = details.length > 1;
      bodyNarration = [
        against,
        typeLabel,
        multiInvoice ? '' : patientPart,
        multiInvoice ? '' : procedure ? `Procedure: ${procedure}` : '',
        paymentNote || '',
      ].filter(Boolean).join(' | ');
      narration = [`${voucher}`, casePart, bodyNarration].filter(Boolean).join(' | ');
    } else if (type === 'opening_balance') {
      narration = `Opening balance ${voucher} | brought forward`;
      bodyNarration = 'Brought forward';
    } else {
      const reason = cleanNarration(e.description || '')
        .replace(/^(Credit Note|Debit Adjustment|Refund to Clinic|Write Off):\s*/i, '');
      const note = cleanNarration(e.notes || '');
      const reasonKey = reason.toLowerCase();
      const noteKey = note.toLowerCase();
      bodyNarration = [
        relatedInvoiceNumber ? `Against ${relatedInvoiceNumber}` : '',
        typeLabel,
        reason && reasonKey !== typeLabel.toLowerCase() ? `Reason: ${reason}` : '',
        note && noteKey !== reasonKey && noteKey !== typeLabel.toLowerCase() ? note : '',
      ].filter(Boolean).join(' | ');
      narration = [voucher, casePart, bodyNarration].filter(Boolean).join(' | ');
    }

    /* These are real postings, not the statement's brought-forward figure. Flag
       them for review; never silently move historical money. */
    if (['opening_balance', 'debit_adjustment', 'credit_note'].includes(type)) {
      const evidence = `${e.description || ''} ${e.notes || ''}`;
      if (/opening\s*balance/i.test(evidence)) {
        openingBalanceReview.push({ voucherNumber: voucher, typeLabel, amount: fromCents(drC || crC) });
      }
    }

    rows.push({
      id: e.id,
      date: isoDate(e.date),
      dateLabel: formatLedgerDate(e.date),
      posted_at: e.posted_at,
      type,
      typeLabel,
      voucherNumber: voucher,
      relatedInvoiceNumber,
      caseNumber: caseNumber || undefined,
      caseId: e.case_id || c?.case_id,
      clinicId: e.lab_id || undefined,
      clinicName: e.lab_name || undefined,
      patientName,
      patientId: c?.patient_id,
      procedure,
      caseProcedure,
      clinicalMismatch,
      teeth: formatTeeth(c?.selected_teeth),
      shade: c?.shade,
      units: c?.quantity,
      receivedDate: c?.received_at ? isoDate(c.received_at) : (c?.created_at ? isoDate(c.created_at) : undefined),
      deliveryDate: c?.delivery_date ? isoDate(c.delivery_date) : undefined,
      narration,
      bodyNarration,
      debit: fromCents(drC),
      credit: fromCents(crC),
      balance: fromCents(runningCents),
      allocations,
      paymentMethod,
      paymentNote,
      referenceId: e.reference_id,
      recordedBy: e.recorded_by,
      notes: e.notes,
    });
  }

  /* 4. summary computed from the rows + opening */
  let totalDebitCents = 0; let totalCreditCents = 0;
  for (const r of rows) { totalDebitCents += toCents(r.debit); totalCreditCents += toCents(r.credit); }
  const closingCents = openingCents + totalDebitCents - totalCreditCents;

  return {
    rows,
    summary: {
      openingBalance: fromCents(openingCents),
      totalDebits: fromCents(totalDebitCents),
      totalCredits: fromCents(totalCreditCents),
      closingBalance: fromCents(closingCents),
      transactionCount: rows.length,
      openingBalanceReview: openingBalanceReview.length ? openingBalanceReview : undefined,
    },
  };
}

/* ---------- partial / final payment classification ---------- */
/**
 * Re-scan payment rows for each related invoice to mark partial vs final
 * settlement. Returns a parallel array of notes (index-aligned with rows).
 * `invoiceAmounts` maps invoice voucher → invoiced total.
 */
export function classifyPayments(rows: LedgerReportRow[], invoiceAmounts: Map<string, number>): Map<string, string> {
  const paidByInvoice = new Map<string, number>();
  const notes = new Map<string, string>();
  for (const r of rows) {
    if ((r.type === 'payment' || r.type === 'advance_allocation') && r.relatedInvoiceNumber) {
      const key = r.relatedInvoiceNumber.toUpperCase();
      const cur = (paidByInvoice.get(key) || 0) + toCents(r.credit);
      paidByInvoice.set(key, cur);
      const total = toCents(invoiceAmounts.get(key) || 0);
      if (total > 0) {
        if (cur >= total) notes.set(r.id, 'Final settlement');
        else notes.set(r.id, 'Partial payment');
      }
    }
  }
  return notes;
}
