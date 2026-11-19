/**
 * Phase 3 deterministic business tools for the voice assistant.
 * Pure functions over the same engines the UI uses — never independent math.
 */
import { invoiceBalanceDue, roundMoney } from './financeDomain';
import { buildMonthlyStatements, windowMonthlyStatements, filterMonthlyStatements } from './monthlyStatement';
import { availableAdvanceCredit } from './transactionDomain';
import { buildLedgerEntries } from './ledgerDomain';
import { invoiceMatchesSearch } from './invoiceSearch';
import { searchRag } from './ragQuery';
import type { Invoice, AdvancePayment, AccountAdjustment, DentalLab, DentalCase, UserProfile } from '../types';
import { collectAllPayments } from './ledgerDomain';
import { listMonthCloses } from './monthClose';

export interface VoiceContext {
  labs: DentalLab[];
  invoices: Invoice[];
  advancePayments: AdvancePayment[];
  accountAdjustments: AccountAdjustment[];
  cases?: DentalCase[];
  /** Catalog + rows needed for pricing overrides (optional; empty = no replace detection). */
  caseTypes?: import('../types').CaseType[];
  pricingOverrides?: import('../types').LabPricingOverride[];
  labContacts?: import('../types').LabContact[];
  labAddresses?: import('../types').LabAddress[];
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
