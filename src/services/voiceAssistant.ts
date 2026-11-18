/**
 * Phase 4+5: intent router with clarification loop + deterministic business tools.
 * Deterministic path always wins; Groq is only a natural-language fallback that
 * must output a strict intent JSON. Never Groq-fabricated figures.
 */
import { groqChat } from './voiceGroq';
import { getTodayStr } from '../utils/dateUtils';
import { remember, memoryContext } from './voiceMemory';
import {
  clinicCandidates,
  getAdvanceWallet,
  getCashCollected,
  getCodeAnswer,
  getClinicBalance,
  getLedgerAnswer,
  getMonthCloseStatus,
  getOverdueCases,
  getStandings,
  getStatementAnswer,
  getUnpaid,
  monthFromQuery,
  periodFromQuery,
  resolveClinic,
  searchInvoicesInContext,
  type VoiceContext,
} from './voiceTools';

export interface AssistantResult {
  text: string;
  spoke: boolean;
  /** When set, the voice shell navigates the app to this view id. */
  navigateTo?: string;
}

const folded = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Score clinics by name tokens length ≥ 3 present in the query. */
export const guessClinic = (ctx: VoiceContext, q: string) => {
  const f = folded(q);
  const hay = ` ${f} `;
  const scored = (ctx.labs || [])
    .map((lab) => {
      const tokens = folded(lab.name).split(' ').filter((t) => t.length >= 3);
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

const mkr = (text: string): AssistantResult => ({ text, spoke: false });

/** Redact-and-remember the Q/A pair for the local "learn from us" store. */
const finish = (text: string, raw = ""): AssistantResult => {
  try { remember(raw, text); } catch { /* memory is best-effort */ }
  return mkr(text);
};

export async function askAssistant(raw: string, ctx: VoiceContext): Promise<AssistantResult> {
  const q = (raw || '').trim();
  const done = (text: string) => finish(text, q);
  if (!q) return done('Ask me about a clinic’s balance, statement, ledger, outstanding invoices, or an invoice search.');
  const lower = folded(q);
  const period = periodFromQuery(q);

  // ── navigation (JARVIS control of the software) ─────────────────────────
  const NAV: Record<string, string> = {
    dashboard: 'dashboard', home: 'dashboard', overview: 'dashboard',
    case: 'cases', cases: 'cases', workstation: 'cases', 'dental workstation': 'cases', records: 'cases',
    labs: 'labs', lab: 'labs', clinics: 'labs', clinic: 'labs', 'dental clinics': 'labs',
    billing: 'billing', payments: 'billing', finance: 'billing', 'payment receive': 'billing',
    ledger: 'general_ledger', 'general ledger': 'general_ledger', books: 'general_ledger',
    statement: 'statements', statements: 'statements', monthly: 'statements', 'monthly statement': 'statements', vouchers: 'statements',
    insights: 'insights', analytics: 'insights', insight: 'insights', reports: 'analytics',
    catalog: 'catalog', catalogue: 'catalog', pricing: 'catalog', price: 'catalog',
    notifications: 'notifications', alerts: 'notifications', inbox: 'notifications',
    settings: 'settings', preferences: 'settings',
    'print invoices': 'print-invoices', batch: 'print-invoices', 'batch print': 'print-invoices',
  };
  const navMatch = lower.match(/^(?:open|show|go to|navigate to|take me to)\s+([a-z -]{2,40})$/);
  if (navMatch) {
    const target = navMatch[1].trim();
    const view = NAV[target];
    if (view) {
      const result = { text: `Opening ${target}.`, spoke: true as const, navigateTo: view };
      try { remember(q, result.text); } catch { /* best effort */ }
      return result;
    }
    return done('I can open: dashboard, cases, labs, billing, general ledger, statements, insights, catalog, notifications, settings, print-invoices.');
  }

  if (/^(what can you do|help|commands|capabilities|list commands|what are you capable of|how can you help)\b/.test(lower)) {
    return done([
      'I can control Dental Solutions hands-free:',
      '• Open any screen: “Open dashboard”, “Open general ledger”, “Open settings”',
      '• Money: “Mir Dental balance”, “Statement for Mir Dental last month”, “Ledger for Mir Dental since Oct 1”, “Outstanding invoices for Mir Dental”, “Advance wallet for Mir Dental”',
      '• Whole business: “Cash collected today”, “Overdue cases”, “Standings”, “Month close status for October 2026”',
      '• Search: “Find invoice INV-0042” (patient name included if you enabled clinical detail in Settings)',
      '• Actions (with on-screen confirmation): “Record payment of PKR 5,000 for Mir Dental”, “Record advance deposit of PKR 2,000 for Mir Dental”',
      '• Code and docs: “How does the monthly statement compute closing balance?”',
      'Voice writes require confirmation; destructive actions (void, delete, wipe, restore) stay physical.',
    ].join('\n'));
  }

  // ── whole-book analytics (no clinic needed) ─────────────────────────────
  if (/cash collected|collection today|money in|income today|collection\b/.test(lower)) {
    const from = /today/.test(lower) ? getTodayStr() : period.from;
    const to = /today/.test(lower) ? getTodayStr() : period.to;
    return done(getCashCollected(ctx, from, to));
  }
  if (/overdue case|cases overdue|pending cases/.test(lower)) {
    return done(getOverdueCases(ctx));
  }
  if (/standings|best clinic|top clinic|worst clinic|who owes/.test(lower)) {
    return done(getStandings(ctx));
  }
  if (/month.?close|closed month|month closed/.test(lower)) {
    return done(getMonthCloseStatus(monthFromQuery(q)));
  }

  // ── code/docs questions ───────────────────────────────────────────────
  if (/^how (does|do|is)\b|^what is\b|^where is\b|^why\b|\bcodebase\b|\bsettings?\b|\bhelp me\b/.test(lower)) {
    if (/\bvoice\b|\bassistant\b/.test(lower)) return done('Voice assistant is off by default. Enable it in Settings → Application Defaults → Voice Assistant. Groq routing is opt-in and never required for financial answers.');
    const docs = await getCodeAnswer(q);
    if (docs) return done(`From the codebase and docs:\n${docs}`);
  }

  // ── needs a clinic? ────────────────────────────────────────────────────
  const clinic = guessClinic(ctx, q);
  if (clinic && 'ambiguous' in clinic) {
    return done(`Which clinic did you mean — ${clinic.ambiguous.join(', ')}?`);
  }
  const directResolve = resolveClinic(ctx, q.match(/(?:for|of)\s+([A-Za-z0-9 ()&-]{2,})/i)?.[1]?.trim());
  const chosen = clinic ?? directResolve;

  const needsClinic = /balance|owe|statement|ledger|outstanding|unpaid|overdue|advance|wallet|baki|udhar/.test(lower);
  if (needsClinic && !chosen) {
    const hint = q.match(/(?:for|of)\s+([A-Za-z0-9 ()&-]{2,})/i)?.[1]?.trim();
    const candidates = clinicCandidates(ctx, hint);
    if (candidates.length > 1) return done(`Which clinic did you mean — ${candidates.map((c) => c.name).join(', ')}?`);
    return done('Which clinic should I look up?');
  }

  // ── outstanding invoices ──────────────────────────────────────────────
  if (/overdue|unpaid|outstanding|baki/.test(lower)) {
    return done(getUnpaid(ctx, chosen!.id, { overdue: /overdue/.test(lower) }));
  }

  // ── advance wallet ────────────────────────────────────────────────────
  if (/advance|wallet/.test(lower)) {
    return done(`For ${chosen!.name}: ${getAdvanceWallet(ctx, chosen!.id)}`);
  }

  // ── statement ─────────────────────────────────────────────────────────
  if (/statement|monthly/.test(lower)) {
    const { from, to } = period.allTime ? { from: undefined, to: undefined } : period;
    return done(`For ${chosen!.name}: ${getStatementAnswer(ctx, chosen!.id, from, to, period.allTime)}`);
  }

  // ── ledger ────────────────────────────────────────────────────────────
  if (/ledger/.test(lower)) {
    return done(`For ${chosen!.name}: ${getLedgerAnswer(ctx, chosen!.id, period.from, period.to)}`);
  }

  // ── balance ───────────────────────────────────────────────────────────
  if (/balance|owe|udhar/.test(lower)) {
    const bal = getClinicBalance(ctx, chosen!.id);
    return done(`${chosen!.name}: PKR ${Math.abs(bal.signed).toLocaleString()} ${bal.label}.`);
  }

  // ── search invoices ───────────────────────────────────────────────────
  if (/search|find|look up|invoice/.test(lower)) {
    const hits = searchInvoicesInContext(ctx, q.replace(/^(search for|find|look up|invoice)\s*/i, '').trim() || q);
    return done(hits);
  }

  // ── Groq fallback for anything else ───────────────────────────────────
  const groq = await groqChat([
    { role: 'system', content: 'You are a strict intent classifier for a dental lab billing app. Reply with ONLY JSON like {"intent":"none"}. Valid intents: getClinicBalance, getClinicStatement, getLedger, getOutstanding, getAdvanceWallet, searchInvoices. Never output prose.\n' + memoryContext() },
    { role: 'user', content: q },
  ], { maxTokens: 120 });
  if (groq) {
    try {
      const parsed = JSON.parse(groq.slice(groq.indexOf('{'), groq.lastIndexOf('}') + 1));
      if (parsed?.intent === 'getClinicBalance' && chosen) {
        const bal = getClinicBalance(ctx, chosen.id);
        return done(`${chosen.name}: PKR ${Math.abs(bal.signed).toLocaleString()} ${bal.label}.`);
      }
      if (parsed?.intent === 'getClinicStatement' && chosen) {
        const { from, to } = period.allTime ? { from: undefined, to: undefined } : period;
        return done(`For ${chosen.name}: ${getStatementAnswer(ctx, chosen.id, from, to, period.allTime)}`);
      }
      if (parsed?.intent === 'getLedger' && chosen) {
        return done(`For ${chosen.name}: ${getLedgerAnswer(ctx, chosen.id, period.from, period.to)}`);
      }
      if (parsed?.intent === 'getOutstanding' && chosen) {
        return done(getUnpaid(ctx, chosen.id));
      }
      if (parsed?.intent === 'getAdvanceWallet' && chosen) {
        return done(`For ${chosen.name}: ${getAdvanceWallet(ctx, chosen.id)}`);
      }
    } catch {
      /* fall through to safe default */
    }
  }
  return done('I can answer a clinic’s balance, statement, ledger, outstanding invoices, advance wallet, invoice search, or codebase questions. Try “Mir Dental balance”, “ledger for Mir Dental this month”, or “outstanding invoices for Iqbal”.');
}
