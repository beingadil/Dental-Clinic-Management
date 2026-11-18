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
import type { Invoice, AdvancePayment, AccountAdjustment, DentalLab, UserProfile } from '../types';

export interface VoiceContext {
  labs: DentalLab[];
  invoices: Invoice[];
  advancePayments: AdvancePayment[];
  accountAdjustments: AccountAdjustment[];
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

/** Codebase/docs answers via the offline RAG index. */
export const getCodeAnswer = async (q: string) => {
  const hits = await searchRag(q, { limit: 4 });
  if (!hits.length) return null;
  return hits.map((h) => `• ${h.citation} — ${h.excerpt.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n');
};
