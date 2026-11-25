/**
 * Phase 3 deterministic business tools for the voice assistant.
 * Pure functions over the same engines the UI uses — never independent math.
 */
import { invoiceBalanceDue, roundMoney } from './financeDomain';
import { buildMonthlyStatements, windowMonthlyStatements, filterMonthlyStatements } from './monthlyStatement';
import { availableAdvanceCredit } from './transactionDomain';
import { buildLedgerEntries, collectAllPayments } from './ledgerDomain';
import { invoiceMatchesSearch } from './invoiceSearch';
import { searchRag } from './ragQuery';
import type { Invoice, AdvancePayment, AccountAdjustment, DentalLab, DentalCase, UserProfile } from '../types';
import { selectCasesToAutoArchive } from '../context/hooks/autoArchive';
import { getTodayStr } from '../utils/dateUtils';
import {
  QC_REASON_CODES, QC_REASON_LABELS, normalizeReasonCode,
  deriveQcCaseState, effectiveQcEvents, computeQcMetrics, qcGateSatisfied, formatQcRate,
} from './qcDomain';
import { listMonthCloses } from './monthClose';
import { loadSlaSettings } from './prioritySla';

export interface VoiceContext {
  labs: DentalLab[];
  invoices: Invoice[];
  advancePayments: AdvancePayment[];
  accountAdjustments: AccountAdjustment[];
  cases?: DentalCase[];
  /** QC inspection stream — read-only, used by the QC read tools. */
  qcInspections?: import('../types').QcInspection[];
  /** Notes for the case_notes_list tool. */
  caseNotes?: Record<string, import('../types').CaseNote[]>;
  /** Attachments for the case_attachments_list tool. */
  caseAttachments?: Record<string, import('../types').CaseAttachment[]>;
  /** Catalog + rows needed for pricing overrides (optional; empty = no replace detection). */
  caseTypes?: import('../types').CaseType[];
  pricingOverrides?: import('../types').LabPricingOverride[];
  labContacts?: import('../types').LabContact[];
  labAddresses?: import('../types').LabAddress[];
  /** Payments register (read tools + payment edits by receipt number). */
  allPayments?: import('../types').PaymentRecord[];
  /** Bank reconciliation queue. */
  reconciliationItems?: import('../types').ReconciliationItem[];
  /** Audit trail (read tool). */
  auditEvents?: import('../types').AuditEvent[];
  /** Saved case templates. */
  templates?: import('../types').CaseTemplate[];
  /** Doctor → preferred lab links. */
  doctorPreferences?: import('../types').DoctorPreferredLab[];
  user?: UserProfile | null;
  /** Owner/Super-Admin opt-in for patient detail on reads. */
  allowClinicalDetail?: boolean;
}

export const resolveClinic = (ctx: VoiceContext, hint: string | undefined): DentalLab | null => {
  if (!hint) return null;
  const q = hint.trim().toLowerCase();
  if (!q) return null;
  const labs = ctx.labs || [];
  const exact = labs.find((l) => l.name.toLowerCase() === q);
  if (exact) return exact;
  const contains = labs.filter((l) => l.name.toLowerCase().includes(q));
  return contains.length === 1 ? contains[0] : null;
};
export const clinicCandidates = (ctx: VoiceContext, hint: string | undefined): DentalLab[] => {
  const q = (hint || '').trim().toLowerCase();
  if (!q) return [];
  return (ctx.labs || []).filter((l) => l.name.toLowerCase().includes(q));
};

export const periodFromQuery = (q: string): { from?: string; to?: string; allTime: boolean } => {
  const t = q.toLowerCase();
  if (/\ball time\b/.test(t) || /\bever\b/.test(t)) return { allTime: true };
  if (/\blast month\b/.test(t)) {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    const to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    return { from, to, allTime: false };
  }
  if (/\bthis month\b/.test(t)) {
    const now = new Date();
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return { from, to, allTime: false };
  }
  const m = t.match(/from\s+(\d{4}-\d{2}-\d{2})(?:\s+(?:to|till|until|-)\s+(\d{4}-\d{2}-\d{2}))?/);
  if (m) return { from: m[1], to: m[2], allTime: false };
  return { allTime: false };
};

export const getClinicBalance = (ctx: VoiceContext, labId: string): { signed: number; label: string } => {
  const lab = (ctx.labs || []).find((l) => l.id === labId);
  if (!lab) return { signed: 0, label: 'Fully settled' };
  const signed = roundMoney(
    (ctx.invoices || [])
      .filter((i) => i.lab_id === labId)
      .reduce((acc, inv) => acc + invoiceBalanceDue(inv), 0)
    + (ctx.accountAdjustments || []).filter((a) => a.lab_id === labId).reduce((acc, a) =>
      acc + (a.type === 'debit_adjustment' ? (a.amount || 0) : 0) - (a.type === 'credit_note' ? (a.amount || 0) : 0), 0),
  );
  return {
    signed,
    label: signed > 0 ? 'clinic owes us (Dr)' : signed < 0 ? 'we hold credit for the clinic (Cr)' : 'fully settled',
  };
};

export const getAdvanceWallet = (ctx: VoiceContext, labId: string) => {
  const wallet = availableAdvanceCredit(ctx.advancePayments || [], labId);
  return `Advance wallet for this clinic: PKR ${roundMoney(wallet).toLocaleString()} unallocated.`;
};

export const getUnpaid = (ctx: VoiceContext, labId: string, opts?: { overdue?: boolean }) => {
  const rows = (ctx.invoices || [])
    .filter((i) => i.lab_id === labId)
    .map((i) => ({ inv: i, balance: invoiceBalanceDue(i) }))
    .filter((r) => r.balance > 0)
    .filter((r) => !opts?.overdue || (r.inv.due_date && String(r.inv.due_date) < new Date().toISOString().slice(0, 10)))
    .sort((a, b) => b.balance - a.balance);
  if (!rows.length) return 'No outstanding invoices for this clinic.';
  const top = rows.slice(0, 5).map((r) => `${r.inv.invoice_number}: PKR ${roundMoney(r.balance).toLocaleString()}${ctx.allowClinicalDetail && r.inv.patient_name ? ` (${r.inv.patient_name})` : ''}`).join('; ');
  return `Outstanding invoices (${rows.length} total): ${top}`;
};

export const getStatementAnswer = (ctx: VoiceContext, labId: string, from?: string, to?: string, allTime = false) => {
  const base = buildMonthlyStatements({
    invoices: ctx.invoices,
    advancePayments: ctx.advancePayments,
    accountAdjustments: ctx.accountAdjustments,
    labs: ctx.labs,
  });
  const visible = filterMonthlyStatements(base, []);
  const months = windowMonthlyStatements(visible, { from: from || '', to: to || '', clinics: [ctx.labs.find((l) => l.id === labId)!] });
  if (allTime && months.length === 1) {
    const all = months[0];
    const row = all.rows.find((r) => r.lab_id === labId);
    if (!row) return 'No statement rows for this clinic.';
    return `All Time: billed PKR ${roundMoney(row.billed).toLocaleString()}, collected PKR ${roundMoney(row.collected).toLocaleString()}, closing PKR ${roundMoney(row.closing_balance).toLocaleString()} Dr`;
  }
  const chosen = months.find((m) => m.rows.some((r) => r.lab_id === labId));
  if (!chosen) return 'No statements in this window for this clinic.';
  const row = chosen.rows.find((r) => r.lab_id === labId)!;
  return `${chosen.month}: billed PKR ${roundMoney(row.billed).toLocaleString()}, collected PKR ${roundMoney(row.collected).toLocaleString()}, closing PKR ${roundMoney(row.closing_balance).toLocaleString()} Dr`;
};

export const getLedgerAnswer = (ctx: VoiceContext, labId: string, from?: string, to?: string) => {
  const entries = buildLedgerEntries({
    invoices: (ctx.invoices || []).filter((i) => i.lab_id === labId),
    advancePayments: (ctx.advancePayments || []).filter((a) => a.lab_id === labId),
    accountAdjustments: (ctx.accountAdjustments || []).filter((a) => a.lab_id === labId),
    labs: (ctx.labs || []).filter((l) => l.id === labId),
    filterLabId: labId,
  }).filter((e) => {
    const d = String(e.date).slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
  if (!entries.length) return 'No ledger postings for this window.';
  let opening = 0;
  entries.forEach((e) => { opening += (e.debit || 0) - (e.credit || 0); });
  // entries are newest-first, so the last in chronological order is the latest posted
  const closing = entries[0]?.running_balance ?? 0;
  return `Ledger: ${entries.length} postings, window net PKR ${roundMoney(opening).toLocaleString()}, latest running balance PKR ${roundMoney(closing).toLocaleString()} Dr`;
};

export const searchInvoicesInContext = (ctx: VoiceContext, q: string) => {
  const hits = (ctx.invoices || []).filter((inv) => invoiceMatchesSearch(inv, q));
  if (!hits.length) return 'No invoices match that search.';
  return `Found ${hits.length} invoice${hits.length === 1 ? '' : 's'}: ${hits.slice(0, 5).map((i) => `${i.invoice_number}${ctx.allowClinicalDetail && i.patient_name ? ` (${i.patient_name})` : ''}`).join(', ')}`;
};

/** One-line summary of the open workstation cases (max 8), or 'No open cases.' */
export const openCasesSummary = (ctx: VoiceContext) => {
  const open = (ctx.cases || [])
    .filter((c) => c.status !== 'delivered' && c.status !== 'cancelled' && !c.archived_at)
    .slice(0, 8);
  if (!open.length) return 'No open cases.';
  return open.map((c) => `${c.case_number} — ${c.patient_name || 'Patient'} · ${c.case_type_name || 'Case'} — ${c.status}`).join('; ');
};

export const getTodayBriefing = (ctx: VoiceContext) => {
  const today = new Date().toISOString().slice(0, 10);
  const cash = getCashCollected(ctx, today, today);
  const delivering = (ctx.cases || []).filter((c) => String(c.delivery_date).slice(0, 10) === today && c.status !== 'delivered' && c.status !== 'cancelled');
  const overdue = (ctx.cases || []).filter((c) => c.delivery_date && String(c.delivery_date).slice(0, 10) < today && c.status !== 'delivered' && c.status !== 'cancelled');
  const overdueInvoices = (ctx.invoices || []).filter((i) => invoiceBalanceDue(i) > 0).length;
  const patient = (c: typeof delivering[number]) => (ctx.allowClinicalDetail && c.patient_name ? ` (${c.patient_name})` : '');
  const deliverLine = delivering.length
    ? `Delivering today: ${delivering.slice(0, 5).map((c) => `${c.case_number}${patient(c)}`).join(', ')}${delivering.length > 5 ? '…' : ''}.`
    : 'Nothing due for delivery today.';
  return `${cash} ${overdueInvoices} invoice(s) still outstanding. ${deliverLine} ${overdue.length} case(s) overdue.`;
};

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Cases due today (by delivery_date), SLA-first, and the overdue list — spoken-friendly. */
export const getDueTodayBriefing = (ctx: VoiceContext): string => {
  const today = getTodayStr();
  const open = (ctx.cases || []).filter((c) => c.status !== 'delivered' && c.status !== 'cancelled' && !c.archived_at);
  const overdue = open.filter((c) => c.delivery_date && String(c.delivery_date).slice(0, 10) < today)
    .sort((a, b) => String(a.delivery_date).localeCompare(String(b.delivery_date)));
  const dueToday = open.filter((c) => String(c.delivery_date).slice(0, 10) === today)
    .sort((a, b) => (PRIORITY_RANK[a.priority ?? 'normal'] ?? 2) - (PRIORITY_RANK[b.priority ?? 'normal'] ?? 2));
  const patient = (c: DentalCase) => (ctx.allowClinicalDetail ? ` (${c.patient_name ?? 'Patient'})` : '');
  const line = (c: DentalCase) => `${c.case_number}${patient(c)} — ${c.case_type_name ?? 'Case'} — ${c.priority ?? 'normal'} priority — ${String(c.delivery_date).slice(0, 10)}`;
  const briefing = [
    overdue.length ? `Overdue (${overdue.length}): ${overdue.slice(0, 3).map((c) => `${c.case_number}${patient(c)} — due ${String(c.delivery_date).slice(0, 10)}`).join('; ')}.` : 'No overdue cases.',
    dueToday.length ? `Due today (${dueToday.length}): ${dueToday.map(line).join('; ')}.` : 'Nothing due today.',
    dueToday.length === 0 && overdue.length === 0 ? `${open.length} open case(s) in total.` : '',
  ].filter(Boolean).join(' ');
  return briefing || `${open.length} open case(s) in total.`;
};

/** Count cases — total, by clinic, or by status. Natural language answers. */
export const getCaseCount = (ctx: VoiceContext, clinicId?: string, status?: string): string => {
  let cases = (ctx.cases || []).filter((c) => !c.archived_at);
  if (clinicId) cases = cases.filter((c) => c.lab_id === clinicId);
  if (status) cases = cases.filter((c) => c.status === status);
  const label = status ? ` ${status} ` : ' ';
  const clinicLabel = clinicId ? ` for ${(ctx.labs || []).find((l) => l.id === clinicId)?.name || 'that clinic'}` : '';
  return `You have ${cases.length}${label}case${cases.length === 1 ? '' : 's'}${clinicLabel}.`;
};

/** Cases due today — natural language. */
export const getTodayCases = (ctx: VoiceContext, clinicId?: string): string => {
  const today = new Date().toISOString().slice(0, 10);
  const cases = (ctx.cases || [])
    .filter((c) => !c.archived_at && c.status !== 'delivered' && c.status !== 'cancelled')
    .filter((c) => String(c.delivery_date).slice(0, 10) === today)
    .filter((c) => !clinicId || c.lab_id === clinicId);
  if (!cases.length) return clinicId ? 'No cases due today for that clinic.' : 'No cases due today.';
  return `Cases due today${clinicId ? ' for that clinic' : ''} (${cases.length}): ${cases.map((c) => `${c.case_number} — ${c.case_type_name || 'Case'} — ${c.status}`).join('; ')}.`;
};

/** All cases for a specific clinic — natural language. */
export const getCasesByClinic = (ctx: VoiceContext, clinicId: string): string => {
  const clinic = (ctx.labs || []).find((l) => l.id === clinicId);
  const cases = (ctx.cases || [])
    .filter((c) => c.lab_id === clinicId && !c.archived_at)
    .filter((c) => c.status !== 'delivered' && c.status !== 'cancelled');
  if (!cases.length) return `No open cases for ${clinic?.name || 'that clinic'}.`;
  return `Open cases for ${clinic?.name || 'that clinic'} (${cases.length}): ${cases.map((c) => `${c.case_number} — ${c.case_type_name || 'Case'} — ${c.status}`).join('; ')}.`;
};

/** Cases in a specific status — natural language. */
export const getCasesByStatus = (ctx: VoiceContext, status: string): string => {
  const cases = (ctx.cases || [])
    .filter((c) => !c.archived_at && c.status === status);
  if (!cases.length) return `No cases in "${status}" status.`;
  return `Cases in "${status}" status (${cases.length}): ${cases.map((c) => `${c.case_number} — ${c.case_type_name || 'Case'}`).join('; ')}.`;
};

/** Delivery calendar — show cases due on a date. */
export const getDeliveryCalendar = (ctx: VoiceContext, date?: string): string => {
  const targetDate = date || new Date().toISOString().slice(0, 10);
  const cases = (ctx.cases || [])
    .filter((c) => !c.archived_at && c.status !== 'delivered' && c.status !== 'cancelled')
    .filter((c) => String(c.delivery_date).slice(0, 10) === targetDate);
  if (!cases.length) return `No cases due for delivery on ${targetDate}.`;
  return `Delivery calendar for ${targetDate} (${cases.length}): ${cases.map((c) => `${c.case_number} — ${c.case_type_name || 'Case'} — ${c.status}`).join('; ')}.`;
};

/** Case queue — cases ready for dispatch. */
export const getCaseQueue = (ctx: VoiceContext): string => {
  const cases = (ctx.cases || [])
    .filter((c) => !c.archived_at && (c.status === 'ready' || c.status === 'qc'));
  if (!cases.length) return 'No cases ready for dispatch.';
  return `Case queue (${cases.length}): ${cases.map((c) => `${c.case_number} — ${c.case_type_name || 'Case'} — ${c.status}`).join('; ')}.`;
};

/** Shade guide reference. */
export const getShadeGuide = (): string => {
  return 'Shade guide: A1 (lightest), A2, A3, A3.5, A4, B1, B2, B3, B4, C1, C2, C3, C4, D2, D3, D4. VITA classical shades. Use "shade A2" when creating or updating a case.';
};

/** Global search across all data. */
export const globalSearch = (ctx: VoiceContext, q: string): string => {
  const lower = (q || '').toLowerCase().trim();
  if (!lower) return 'What do you want to search for?';
  const caseHits = (ctx.cases || []).filter((c) => !c.archived_at && (
    c.case_number.toLowerCase().includes(lower) ||
    (c.patient_name || '').toLowerCase().includes(lower) ||
    (c.case_type_name || '').toLowerCase().includes(lower) ||
    (c.doctor_name || '').toLowerCase().includes(lower) ||
    (c.lab_name || '').toLowerCase().includes(lower) ||
    (c.material || '').toLowerCase().includes(lower) ||
    (c.shade || '').toLowerCase().includes(lower)
  ));
  const invoiceHits = (ctx.invoices || []).filter((i) =>
    i.invoice_number.toLowerCase().includes(lower) ||
    (i.lab_name || '').toLowerCase().includes(lower) ||
    (i.patient_name || '').toLowerCase().includes(lower)
  );
  const clinicHits = (ctx.labs || []).filter((l) =>
    l.name.toLowerCase().includes(lower) ||
    (l.doctor_name || '').toLowerCase().includes(lower) ||
    (l.city || '').toLowerCase().includes(lower)
  );
  const total = caseHits.length + invoiceHits.length + clinicHits.length;
  if (!total) return `No results for "${q}".`;
  const parts: string[] = [];
  if (caseHits.length) parts.push(`${caseHits.length} case(s)`);
  if (invoiceHits.length) parts.push(`${invoiceHits.length} invoice(s)`);
  if (clinicHits.length) parts.push(`${clinicHits.length} clinic(s)`);
  return `Global search for "${q}": ${parts.join(', ')}. ${caseHits.length ? `Cases: ${caseHits.slice(0, 3).map((c) => c.case_number).join(', ')}.` : ''} ${invoiceHits.length ? `Invoices: ${invoiceHits.slice(0, 3).map((i) => i.invoice_number).join(', ')}.` : ''} ${clinicHits.length ? `Clinics: ${clinicHits.slice(0, 3).map((l) => l.name).join(', ')}.` : ''}`;
};

/** The 30-day auto-archive predicate, applied on demand with a spoken confirm. */
export const bulkArchivePreview = (ctx: VoiceContext) => {
  const due = selectCasesToAutoArchive(ctx.cases || [], new Date(`${getTodayStr()}T00:00:00`));
  const list = due.slice(0, 8).map((c) => c.case_number).join(', ');
  return {
    count: due.length,
    ids: due.map((c) => c.id),
    preview: due.length
      ? `Archive ${due.length} delivered case(s) whose delivery is 30+ days old${due.length > 8 ? `: ${list}…` : `: ${list}`}?`
      : 'No delivered cases are more than 30 days past delivery.',
  };
};

const findCase = (ctx: VoiceContext, caseNumber: string | null | undefined): DentalCase | null => {
  const num = (caseNumber || '').trim().toUpperCase();
  if (!num || !ctx.cases) return null;
  return ctx.cases.find((c) => c.case_number?.toUpperCase() === num) || null;
};

/** Per-case QC state — pass/fail, attempt count, open gate. */
export const getQcCaseState = (ctx: VoiceContext, caseNumber: string | null) => {
  const target = findCase(ctx, caseNumber);
  if (!target) return `No case ${caseNumber} found.`;
  const state = deriveQcCaseState(ctx.qcInspections || [], target.id);
  if (state.attempts === 0) return `${target.case_number}: no QC inspections yet.`;
  const result = state.passed ? 'pass' : 'fail';
  const reason = state.failed_attempts > 0 ? ` (failed attempts: ${state.failed_attempts})` : '';
  const gate = qcGateSatisfied(state) ? 'gate open' : 'gate blocked';
  return `${target.case_number}: ${result} on QC attempt ${state.attempts}${reason}; ${gate}.`;
};

/** Attempt-by-attempt QC history for one case. */
export const getQcInspectionLog = (ctx: VoiceContext, caseNumber: string | null, limit = 10) => {
  const target = findCase(ctx, caseNumber);
  if (!target) return `No case ${caseNumber} found.`;
  const events = effectiveQcEvents(ctx.qcInspections || [])
    .filter((e) => e.case_id === target.id)
    .sort((a, b) => a.inspection_no - b.inspection_no)
    .slice(-limit);
  if (!events.length) return `${target.case_number}: no QC history yet.`;
  return events.map((e) => {
    const label = e.kind === 'correction' ? `correction of #${e.supersedes_id ?? '?'}` : `inspection #${e.inspection_no}`;
    return `${label}: ${e.result} (${QC_REASON_LABELS[normalizeReasonCode(e.reason_code) as keyof typeof QC_REASON_LABELS] ?? e.reason_code ?? 'other'}) by ${e.inspector ?? 'unknown'} — ${String(e.created_at || '').slice(0, 10)}`;
  }).join('; ');
};

/** Whether a case may proceed to dispatch. */
export const getQcGateCheck = (ctx: VoiceContext, caseNumber: string | null) => {
  const target = findCase(ctx, caseNumber);
  if (!target) return `No case ${caseNumber} found.`;
  const state = deriveQcCaseState(ctx.qcInspections || [], target.id);
  const gate = qcGateSatisfied(state);
  if (state.passed) return `${target.case_number} passed QC — gate open (${gate ? 'yes' : 'no'}).`;
  return `${target.case_number} has not passed QC yet — gate blocked${state.attempts === 0 ? ' (no inspections yet)' : ''}.`;
};

/** Lab-wide QC summary. The rate stays a dash when there is no data — never fabricate 0%. */
export const getQcSummary = (ctx: VoiceContext) => {
  const metrics = computeQcMetrics(ctx.qcInspections || [], ctx.cases || []);
  const firstPass = formatQcRate(metrics.first_pass_rate);
  const rework = formatQcRate(metrics.rework_rate);
  const topReasons = metrics.top_reasons?.length
    ? metrics.top_reasons.map((t) => `${QC_REASON_LABELS[t.code]} (${t.count})`).join(', ')
    : 'none recorded';
  return `QC summary: first-pass ${firstPass}, rework ${rework}. Top failure reasons: ${topReasons}.`;
};

/** How many cases are currently in rework, optionally listing numbers. */
export const getQcReworkList = (ctx: VoiceContext, limit = 8) => {
  const states = new Map((ctx.cases || []).map((c) => [c.id, deriveQcCaseState(ctx.qcInspections || [], c.id)]));
  const reworkCases = (ctx.cases || []).filter((c) => (states.get(c.id)?.failed_attempts ?? 0) > 0 && c.status !== 'delivered');
  if (!reworkCases.length) return 'No cases are currently in rework.';
  return reworkCases.slice(0, limit).map((c) => {
    const n = states.get(c.id)?.failed_attempts ?? 0;
    return `${c.case_number}: ${n === 1 ? '1 failed attempt' : `${n} failed attempts`}`;
  }).join('; ');
};

/** Export the list of QC codes so voice can explain them. */
export const qcReasonCodeList = (): string => QC_REASON_CODES.map((code) => QC_REASON_LABELS[code]).join(', ');

/** Case detail (material, shade, teeth/prep/implants, dates, status) —"which material is this case?" */
export const getCaseDetail = (ctx: VoiceContext, caseNumber: string) => {
  const c = findCase(ctx, caseNumber);
  if (!c) return `No case ${caseNumber} found.`;
  const sections: string[] = [
    `${c.case_number} — ${c.patient_name ?? 'Patient'}`,
    `${c.case_type_name ?? '?'} (${c.material || 'standard'}), status: ${c.status}`,
  ];
  if (c.selected_teeth?.length) sections.push(`Teeth/preps: ${c.selected_teeth.join(', ')}`);
  if (ctx.allowClinicalDetail) sections.push(`Material: ${c.material ?? 'n/a'}`, `Shade: ${c.shade ?? 'n/a'}`);
  if (c.instructions) sections.push(`Instructions: ${c.instructions.slice(0, 120)}`);
  sections.push(`Received: ${String(c.received_date || c.created_at).slice(0, 10)}, Delivery: ${String(c.delivery_date).slice(0, 10)}, Priority: ${c.priority}`);
  return sections.filter(Boolean).join('; ');
};

/** Workstation search/filter via the app's own filter machinery. Searches case
 *  number, patient name, case type, doctor, clinic, material, shade, and teeth. */
export const getCaseSearch = (ctx: VoiceContext, q: string) => {
  const lower = (q || '').toLowerCase().trim();
  if (!lower) return 'Say what you want to search — e.g. “crown”, “A2”, “26”, or “DS-0001”.';
  const normalized = lower.match(/DS-\d+/i)?.[0]?.toUpperCase();
  const hits = (ctx.cases || []).filter((c) =>
    (normalized ? c.case_number === normalized : true) &&
    (c.case_number.toUpperCase().includes(lower) ||
      (lower && (c.patient_name || '').toLowerCase().includes(lower)) ||
      (c.case_type_name || '').toLowerCase().includes(lower) ||
      (c.doctor_name || '').toLowerCase().includes(lower) ||
      (c.lab_name || '').toLowerCase().includes(lower) ||
      (c.material || '').toLowerCase().includes(lower) ||
      (c.shade || '').toLowerCase().includes(lower) ||
      (c.selected_teeth?.some((t) => String(t).includes(lower)) || false))
  );
  if (!hits.length) return 'No cases match that search.';
  return `Matched ${hits.length} case(s): ${hits.slice(0, 6).map((c) => `${c.case_number}${ctx.allowClinicalDetail && c.patient_name ? ` (${c.patient_name})` : ''} — ${c.case_type_name ?? '?'} — ${c.status}`).join('; ')}`;
};

/** Search patients by name, phone, address, or CNIC across all clinics. */
export const searchPatients = (ctx: VoiceContext, q: string): string => {
  const lower = (q || '').toLowerCase().trim();
  if (!lower) return 'What do you want to search for — a patient name, phone, address, or CNIC?';
  const hits = (ctx.cases || [])
    .filter((c) => !c.archived_at)
    .filter((c) =>
      (c.patient_name || '').toLowerCase().includes(lower) ||
      (c.doctor_name || '').toLowerCase().includes(lower) ||
      (c.lab_name || '').toLowerCase().includes(lower) ||
      (c.case_number || '').toLowerCase().includes(lower) ||
      (c.material || '').toLowerCase().includes(lower) ||
      (c.shade || '').toLowerCase().includes(lower) ||
      (c.selected_teeth?.some((t) => String(t).includes(lower)) || false)
    );
  if (!hits.length) return `No patients or cases match "${q}".`;
  const uniquePatients = [...new Set(hits.map((c) => c.patient_name).filter(Boolean))];
  return `Found ${hits.length} case(s) for ${uniquePatients.length} patient(s): ${hits.slice(0, 8).map((c) => `${c.case_number} — ${c.patient_name || 'Patient'} (${c.case_type_name || 'Case'}) — ${c.status}`).join('; ')}.`;
};

/** Filter cases by status, clinic, priority, date range, material, shade, teeth. */
export const filterCases = (ctx: VoiceContext, filters: {
  status?: string;
  clinic?: string;
  priority?: string;
  material?: string;
  shade?: string;
  teeth?: string;
  fromDate?: string;
  toDate?: string;
}): string => {
  let cases = (ctx.cases || []).filter((c) => !c.archived_at);
  if (filters.status) cases = cases.filter((c) => c.status === filters.status);
  if (filters.clinic) {
    const clinic = (ctx.labs || []).find((l) => l.name.toLowerCase().includes(filters.clinic!.toLowerCase()));
    if (clinic) cases = cases.filter((c) => c.lab_id === clinic.id);
  }
  if (filters.priority) cases = cases.filter((c) => (c.priority || 'normal') === filters.priority);
  if (filters.material) cases = cases.filter((c) => (c.material || '').toLowerCase().includes(filters.material!.toLowerCase()));
  if (filters.shade) cases = cases.filter((c) => (c.shade || '').toLowerCase().includes(filters.shade!.toLowerCase()));
  if (filters.teeth) cases = cases.filter((c) => (c.selected_teeth || []).some((t) => String(t).includes(filters.teeth!)));
  if (filters.fromDate) cases = cases.filter((c) => String(c.delivery_date).slice(0, 10) >= filters.fromDate!);
  if (filters.toDate) cases = cases.filter((c) => String(c.delivery_date).slice(0, 10) <= filters.toDate!);
  if (!cases.length) return 'No cases match those filters.';
  return `Filtered cases (${cases.length}): ${cases.slice(0, 8).map((c) => `${c.case_number} — ${c.case_type_name || 'Case'} — ${c.status}`).join('; ')}.`;
};

/** Search invoices by amount range. */
export const searchInvoicesByAmount = (ctx: VoiceContext, minAmount?: number, maxAmount?: number): string => {
  const invoices = (ctx.invoices || []).filter((i) => {
    const amt = i.final_amount || i.amount || 0;
    if (minAmount && amt < minAmount) return false;
    if (maxAmount && amt > maxAmount) return false;
    return true;
  });
  if (!invoices.length) return 'No invoices match that amount range.';
  return `Invoices (${invoices.length}): ${invoices.slice(0, 6).map((i) => `${i.invoice_number} — ${i.lab_name || 'clinic'} — PKR ${(i.final_amount || i.amount || 0).toLocaleString()} — ${i.payment_status || 'unpaid'}`).join('; ')}.`;
};

/** Monthly report summary for a clinic. */
export const generateReport = (ctx: VoiceContext, clinicId: string, month?: string): string => {
  const clinic = (ctx.labs || []).find((l) => l.id === clinicId);
  if (!clinic) return 'I could not find that clinic.';
  const invoices = (ctx.invoices || []).filter((i) => i.lab_id === clinicId);
  const cases = (ctx.cases || []).filter((c) => c.lab_id === clinicId && !c.archived_at);
  const totalBilled = invoices.reduce((acc, inv) => acc + (inv.final_amount || inv.amount || 0), 0);
  const totalPaid = invoices.reduce((acc, inv) => acc + (inv.amount_paid || 0), 0);
  const outstanding = invoices.reduce((acc, inv) => acc + invoiceBalanceDue(inv), 0);
  const openCases = cases.filter((c) => c.status !== 'delivered' && c.status !== 'cancelled').length;
  const delivered = cases.filter((c) => c.status === 'delivered').length;
  const monthLabel = month || 'all time';
  return `${clinic.name} report for ${monthLabel}: ${cases.length} total cases (${openCases} open, ${delivered} delivered), ${invoices.length} invoices, billed PKR ${totalBilled.toLocaleString()}, collected PKR ${totalPaid.toLocaleString()}, outstanding PKR ${outstanding.toLocaleString()}.`;
};

/** List users (for admin). */
export const listUsers = (): string => {
  // Users are not in the VoiceContext, so this returns a placeholder
  return 'User management is available in Settings → Users. I can open that screen for you — just say "Open settings".';
};

/** Switch theme. */
export const switchTheme = (mode: 'light' | 'dark' | 'system'): string => {
  if (typeof window === 'undefined') return 'Theme switching is only available in the browser.';
  try {
    localStorage.setItem('dental.theme.mode', mode);
    window.location.reload();
    return `Switching to ${mode} theme...`;
  } catch {
    return 'Could not switch theme.';
  }
};

/** Search case notes by content across all cases. */
export const getCaseNotesSearch = (ctx: VoiceContext, q: string) => {
  const lower = (q || '').toLowerCase().trim();
  if (!lower) return 'What do you want to search for in case notes?';
  const hits: string[] = [];
  for (const [caseId, notes] of Object.entries(ctx.caseNotes || {})) {
    const c = (ctx.cases || []).find((x) => x.id === caseId);
    for (const n of notes) {
      if (String(n.note_text || '').toLowerCase().includes(lower)) {
        hits.push(`${c?.case_number || caseId}: “${String(n.note_text).slice(0, 100)}” — by ${n.author}`);
      }
    }
  }
  if (!hits.length) return 'No case notes match that search.';
  return `Found ${hits.length} note(s): ${hits.slice(0, 6).join('; ')}`;
};

/** Find cases by patient name (partial match). */
export const getPatientCases = (ctx: VoiceContext, patientName: string): string => {
  const lower = (patientName || '').toLowerCase().trim();
  if (!lower) return 'Which patient do you mean? Tell me the name.';
  const hits = (ctx.cases || [])
    .filter((c) => !c.archived_at)
    .filter((c) => (c.patient_name || '').toLowerCase().includes(lower));
  if (!hits.length) return `No cases found for patient "${patientName}".`;
  return `Cases for "${patientName}" (${hits.length}): ${hits.map((c) => `${c.case_number} — ${c.case_type_name || 'Case'} — ${c.status}`).join('; ')}.`;
};

/** Find invoices by amount (partial match). */
export const getInvoiceByAmount = (ctx: VoiceContext, amount: number): string => {
  const hits = (ctx.invoices || [])
    .filter((i) => Math.abs((i.final_amount || i.amount || 0) - amount) < 1);
  if (!hits.length) return `No invoices found for PKR ${amount.toLocaleString()}.`;
  return `Invoices for PKR ${amount.toLocaleString()} (${hits.length}): ${hits.map((i) => `${i.invoice_number} — ${i.lab_name || 'clinic'} — ${i.payment_status || 'unpaid'}`).join('; ')}.`;
};

/** Outstanding invoices for a specific clinic — natural language. */
export const getClinicOutstanding = (ctx: VoiceContext, clinicId: string): string => {
  const clinic = (ctx.labs || []).find((l) => l.id === clinicId);
  const invoices = (ctx.invoices || [])
    .filter((i) => i.lab_id === clinicId)
    .filter((i) => invoiceBalanceDue(i) > 0);
  if (!invoices.length) return `${clinic?.name || 'That clinic'} has no outstanding invoices.`;
  const total = invoices.reduce((acc, inv) => acc + invoiceBalanceDue(inv), 0);
  return `Outstanding invoices for ${clinic?.name || 'that clinic'} (${invoices.length}): PKR ${total.toLocaleString()} total. ${invoices.slice(0, 6).map((i) => `${i.invoice_number}: PKR ${invoiceBalanceDue(i).toLocaleString()}`).join('; ')}.`;
};

/** Pending QC items (not yet passed). */
export const getQcPending = (ctx: VoiceContext): string => {
  const hits: string[] = [];
  for (const c of ctx.cases || []) {
    if (c.archived_at || c.status === 'delivered' || c.status === 'cancelled') continue;
    const state = deriveQcCaseState(ctx.qcInspections || [], c.id);
    if (state.attempts === 0) {
      hits.push(`${c.case_number}: no QC inspection yet`);
    } else if (!state.passed) {
      hits.push(`${c.case_number}: QC failed (attempt ${state.attempts})`);
    }
  }
  if (!hits.length) return 'All cases have passed QC or have no inspections.';
  return `Cases needing QC attention (${hits.length}): ${hits.slice(0, 8).join('; ')}.`;
};

/** Status-change history for one case. */
export const getCaseTimeline = (ctx: VoiceContext, caseNumber: string | null | undefined, limit = 12) => {
  const c = findCase(ctx, caseNumber);
  if (!c) return `No case ${caseNumber} found.`;
  const timeline = (c.history || []).slice(-limit).reverse().map((h) => `${String(h.timestamp).slice(0, 16)}: ${h.status}${h.notes ? ` — ${h.notes}` : ''} (${h.updated_by || 'user'})`).join('; ');
  return `${c.case_number} (${c.status}): ${timeline || 'no status history yet'}.`;
};

/** Notes for one case. */
export const getCaseNotes = (ctx: VoiceContext, caseNumber: string | null | undefined, limit = 5) => {
  const c = findCase(ctx, caseNumber);
  if (!c) return `No case ${caseNumber} found.`;
  const notes = (ctx.caseNotes?.[c.id] || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit);
  if (!notes.length) return `No notes on ${c.case_number} yet.`;
  return notes.map((n) => `“${n.note_text}” — by ${n.author} at ${String(n.created_at).slice(0, 16).replace(' ', ' @ ')}`).join('; ');
};

/** Attachments for one case, by category. */
export const getCaseAttachments = (ctx: VoiceContext, caseNumber: string | null | undefined) => {
  const c = findCase(ctx, caseNumber);
  if (!c) return `No case ${caseNumber} found.`;
  const files = (ctx.caseAttachments?.[c.id] || []).slice(0, 10);
  if (!files.length) return `No attachments on ${c.case_number} yet.`;
  return `${files.map((f) => `${f.filename} (${f.file_type})`).join(', ')}.`;
};

export const narrateStatement = (ctx: VoiceContext, labId: string, from?: string, to?: string) => {
  const base = buildMonthlyStatements({
    invoices: ctx.invoices,
    advancePayments: ctx.advancePayments,
    accountAdjustments: ctx.accountAdjustments,
    labs: ctx.labs,
  });
  const visible = filterMonthlyStatements(base, []);
  const months = windowMonthlyStatements(visible, { from: from || '', to: to || '', clinics: [ctx.labs.find((l) => l.id === labId)!] });
  if (!months.length) return 'No statement data for that window.';
  const parts = months.slice(0, 3).map((block) => {
    const row = block.rows.find((r) => r.lab_id === labId);
    if (!row) return null;
    const label = block.month === 'all-time' ? 'All Time' : block.month;
    return `${label}: opened at PKR ${roundMoney(row.opening_balance).toLocaleString()}, billed PKR ${roundMoney(row.billed).toLocaleString()} across ${row.cases_billed} case(s), collected PKR ${roundMoney(row.collected).toLocaleString()}, credit notes PKR ${roundMoney(row.credit_notes).toLocaleString()}, closing PKR ${roundMoney(row.closing_balance).toLocaleString()} ${row.closing_balance >= 0 ? 'Dr' : 'Cr'}.`;
  }).filter(Boolean).join(' ');
  return parts || 'No statement rows for that clinic.';
};

/** Codebase/docs answers via the offline RAG index. */
export const getCodeAnswer = async (q: string) => {
  const hits = await searchRag(q, { limit: 4 });
  if (!hits.length) return null;
  return hits.map((h) => `• ${h.citation} — ${h.excerpt.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n');
};

/** Score clinics by name tokens length ≥ 3 present in the query. */
export const guessClinic = (ctx: VoiceContext, q: string) => {
  const foldedLocal = q.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const hay = ` ${foldedLocal} `;
  const scored = (ctx.labs || [])
    .map((lab) => {
      const tokens = (lab.name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(' ').filter((t) => t.length >= 3);
      const score = tokens.reduce((acc, t) => acc + (hay.includes(` ${t} `) ? t.length : 0), 0);
      return { lab, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return { ambiguous: scored.slice(0, 4).map((s) => s.lab.name) };
  }
  return scored[0].lab;
};

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
export const monthFromQuery = (q: string): string | null => {
  const year = q.match(/(20\d{2})/)?.[1];
  const month = MONTHS.findIndex((m) => q.toLowerCase().includes(m));
  if (year && month >= 0) return `${year}-${String(month + 1).padStart(2, '0')}`;
  return null;
};

export const getCashCollected = (ctx: VoiceContext, from?: string, to?: string) => {
  const inRange = collectAllPayments(ctx.invoices || [])
    .filter((p) => {
      const d = String(p.payment_date).slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  const total = inRange.reduce((acc, p) => acc + (p.amount || 0), 0);
  const adv = (ctx.advancePayments || []).filter((a) => {
    const d = String(a.payment_date || a.created_at).slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }).reduce((acc, a) => acc + (a.amount || 0), 0);
  return `Cash collected ${from ? `${from} → ${to || 'today'}` : 'overall'}: PKR ${roundMoney(total).toLocaleString()} in payments, PKR ${roundMoney(adv).toLocaleString()} in advances.`;
};

export const getOverdueCases = (ctx: VoiceContext) => {
  const today = new Date().toISOString().slice(0, 10);
  const due = (ctx.cases || [])
    .filter((c) => c.delivery_date && String(c.delivery_date) < today && !['delivered', 'cancelled'].includes((c.status || '').toLowerCase()))
    .slice(0, 5);
  if (!due.length) return 'No overdue cases right now.';
  return `Overdue cases: ${due.map((c) => `${c.case_number}${ctx.allowClinicalDetail && c.patient_name ? ` (${c.patient_name})` : ''} — due ${String(c.delivery_date).slice(0, 10)}`).join('; ')}.`;
};

/** Top clinics on net receivable (outstanding) across the book. */
export const getStandings = (ctx: VoiceContext) => {
  const rows = (ctx.labs || [])
    .map((lab) => { const { signed } = getClinicBalance(ctx, lab.id); return { name: lab.name, signed }; })
    .filter((r) => r.signed !== 0)
    .sort((a, b) => b.signed - a.signed)
    .slice(0, 5);
  if (!rows.length) return 'No clinic has an outstanding balance.';
  return rows.map((r) => `${r.name}: PKR ${Math.abs(r.signed).toLocaleString()} ${r.signed > 0 ? 'Dr' : 'Cr'}`).join('; ');
};

/** Month close status from the persisted month_closes registry. */
export const getMonthCloseStatus = (monthHint: string | null) => {
  try {
    const month = monthHint || new Date().toISOString().slice(0, 7);
    const closes = listMonthCloses();
    const inMonth = closes.filter((c) => String(c.month) === month);
    if (!inMonth.length) return `No clinics closed for ${month} yet — run month close from Reports → Statements → Month-end close.`;
    return `${month} closed for ${inMonth.length} clinic(s) (${inMonth.map((c) => c.lab_id).slice(0, 5).join(', ')}${inMonth.length > 5 ? '…' : ''}).`;
  } catch {
    return 'Month close data is unavailable.';
  }
};

/* ── Catalog & clinical specs ─────────────────────────────────────────── */

/** All case types with prices and lead times. */
export const getCaseTypesList = (ctx: VoiceContext): string => {
  const types = ctx.caseTypes || [];
  if (!types.length) return 'The catalog has no case types yet. Add one in Catalog → Case types.';
  return `Case types (${types.length}): ${types.map((t) => `${t.name} — PKR ${Number(t.base_price || 0).toLocaleString()}${t.lead_time_days ? ` — ${t.lead_time_days} day lead` : ''}`).join('; ')}.`;
};

/** Clinical specs for one case type (material, unit basis, shade guide, indications). */
export const getClinicalSpecs = (ctx: VoiceContext, name: string): string => {
  const q = (name || '').toLowerCase().trim();
  const ct = (ctx.caseTypes || []).find((t) => t.name.toLowerCase() === q)
    || (ctx.caseTypes || []).find((t) => t.name.toLowerCase().includes(q));
  if (!ct) return `No case type named "${name}" in the catalog.`;
  const parts = [
    ct.material_system ? `material system: ${ct.material_system}` : '',
    ct.unit_basis ? `unit basis: ${ct.unit_basis}` : '',
    ct.shade_guide ? `shade guide: ${ct.shade_guide}` : '',
    ct.warranty_months ? `warranty: ${ct.warranty_months} months` : '',
    ct.lead_time_days ? `lead time: ${ct.lead_time_days} days` : '',
    ct.indications ? `indications: ${ct.indications}` : '',
    ct.contraindications ? `contraindications: ${ct.contraindications}` : '',
  ].filter(Boolean);
  return `${ct.name} — PKR ${Number(ct.base_price || 0).toLocaleString()}${parts.length ? `: ${parts.join('; ')}` : ' — no clinical specs recorded yet'}.`;
};

/** Catalog categories in use, with a case-type count each. */
export const getCatalogCategories = (ctx: VoiceContext): string => {
  const counts = new Map<string, number>();
  for (const t of ctx.caseTypes || []) {
    const key = (t.category || 'uncategorised').replace(/_/g, ' ');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (!counts.size) return 'No catalog categories yet.';
  return `Catalog categories: ${[...counts.entries()].map(([k, v]) => `${k} (${v})`).join('; ')}.`;
};

/** Current SLA turnaround promise per priority. */
export const getSlaStatus = (): string => {
  try {
    const days = loadSlaSettings();
    return `SLA turnaround: urgent ${days.urgent} day(s), high ${days.high}, normal ${days.normal}, low ${days.low}.`;
  } catch {
    return 'SLA settings are unavailable right now.';
  }
};

/* -- Billing depth ----------------------------------------------------- */

/** Outstanding-invoice ageing buckets, optionally for one clinic. */
export const getAgingReport = (ctx: VoiceContext, clinicHint?: string): string => {
  const clinic = clinicHint ? resolveClinic(ctx, clinicHint) : null;
  const invoices = (ctx.invoices || [])
    .filter((i) => !clinic || i.lab_id === clinic.id)
    .map((i) => ({ inv: i, due: invoiceBalanceDue(i) }))
    .filter((x) => x.due > 0.005);
  if (!invoices.length) return clinic ? `${clinic.name} has no outstanding invoices.` : 'No outstanding invoices.';
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, older: 0 };
  const today = new Date(getTodayStr() + 'T00:00:00');
  for (const { inv, due } of invoices) {
    const created = new Date(String(inv.created_at || getTodayStr()).slice(0, 10) + 'T00:00:00');
    const age = Math.max(0, Math.floor((today.getTime() - created.getTime()) / 86400000));
    if (age <= 30) buckets.current += due;
    else if (age <= 60) buckets.d30 += due;
    else if (age <= 90) buckets.d60 += due;
    else if (age <= 120) buckets.d90 += due;
    else buckets.older += due;
  }
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  const scope = clinic ? clinic.name : 'All clinics';
  return `${scope} aging — total outstanding PKR ${total.toLocaleString()}: 0–30 days PKR ${buckets.current.toLocaleString()}, 31–60 PKR ${buckets.d30.toLocaleString()}, 61–90 PKR ${buckets.d60.toLocaleString()}, 91–120 PKR ${buckets.d90.toLocaleString()}, 120+ PKR ${buckets.older.toLocaleString()} (${invoices.length} invoice(s)).`;
};

/** Recent account adjustments, optionally for one clinic. */
export const getAdjustmentList = (ctx: VoiceContext, clinicHint?: string): string => {
  const clinic = clinicHint ? resolveClinic(ctx, clinicHint) : null;
  const rows = (ctx.accountAdjustments || [])
    .filter((a) => !clinic || a.lab_id === clinic.id)
    .slice(-8)
    .reverse();
  if (!rows.length) return clinic ? `No account adjustments for ${clinic.name}.` : 'No account adjustments recorded.';
  return `Recent adjustments (${rows.length}): ${rows.map((a) => `${a.adjustment_number || a.id} — ${a.type.replace(/_/g, ' ')} — PKR ${Number(a.amount || 0).toLocaleString()} — ${a.lab_name} — ${String(a.date || '').slice(0, 10)}`).join('; ')}.`;
};

/** Recent payments with receipt numbers (for edit/delete by voice). */
export const getPaymentList = (ctx: VoiceContext, clinicHint?: string): string => {
  const clinic = clinicHint ? resolveClinic(ctx, clinicHint) : null;
  const rows = (ctx.allPayments && ctx.allPayments.length ? ctx.allPayments : collectAllPayments(ctx.invoices || []))
    .filter((p) => !clinic || p.lab_id === clinic.id)
    .slice(-8)
    .reverse();
  if (!rows.length) return clinic ? `No payments recorded for ${clinic.name}.` : 'No payments recorded.';
  return `Recent payments (${rows.length}): ${rows.map((p) => `${p.receipt_number || p.payment_number || p.id} — PKR ${Number(p.amount || 0).toLocaleString()} — ${p.lab_name || 'clinic'} — ${String(p.payment_date || '').slice(0, 10)}`).join('; ')}.`;
};

/** Bank reconciliation queue — matched/suggested/unmatched items. */
export const getReconciliationQueue = (ctx: VoiceContext): string => {
  const rows = (ctx.reconciliationItems || []).filter((r) => r.status !== 'verified' && r.status !== 'matched');
  if (!rows.length) return 'Nothing waiting in the reconciliation queue — every item is matched or verified.';
  return `Reconciliation queue (${rows.length}): ${rows.slice(0, 8).map((r) => `${r.reference_number} — PKR ${Number(r.amount || 0).toLocaleString()} — ${r.lab_name} — ${r.status.replace(/_/g, ' ')}`).join('; ')}.`;
};

/* -- Admin / diagnostics ----------------------------------------------- */

/** Recent audit-trail events. */
export const getAuditTrail = (ctx: VoiceContext, limit = 8): string => {
  const rows = (ctx.auditEvents || []).slice(-limit).reverse();
  if (!rows.length) return 'No audit events recorded yet.';
  return `Recent audit events (${rows.length}): ${rows.map((e) => `${String(e.timestamp).slice(0, 16)} — ${e.actor} — ${e.action.replace(/_/g, ' ')} ${e.entity_type || ''}${e.entity_ref ? ` ${e.entity_ref}` : ''}`).join('; ')}.`;
};

/** Connectivity / session state. */
export const getSyncStatus = (): string => {
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  const tauri = typeof window !== 'undefined' && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
  return `Sync status: ${online ? 'online' : 'offline'}${tauri ? ', desktop (Tauri) build' : ', browser preview'}. Data is stored locally in SQLite; the app works offline and reconnects automatically.`;
};

/** Saved case templates. */
export const getTemplateList = (ctx: VoiceContext): string => {
  const rows = ctx.templates || [];
  if (!rows.length) return 'No saved case templates yet. Save a case as a template from the workstation.';
  return `Saved templates (${rows.length}): ${rows.map((t) => `${t.template_name}${t.case_type_name ? ` — ${t.case_type_name}` : ''}`).join('; ')}.`;
};
