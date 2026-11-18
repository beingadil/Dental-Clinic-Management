/**
 * Phase 4+5: intent router with clarification loop + deterministic business tools.
 * Deterministic path always wins; Groq is only a natural-language fallback that
 * must output a strict intent JSON. Never Groq-fabricated figures.
 */
import { groqChat } from './voiceGroq';
import {
  clinicCandidates,
  getAdvanceWallet,
  getCodeAnswer,
  getClinicBalance,
  getLedgerAnswer,
  getStatementAnswer,
  getUnpaid,
  periodFromQuery,
  resolveClinic,
  searchInvoicesInContext,
  type VoiceContext,
} from './voiceTools';

export interface AssistantResult {
  text: string;
  spoke: boolean;
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

export async function askAssistant(raw: string, ctx: VoiceContext): Promise<AssistantResult> {
  const q = (raw || '').trim();
  if (!q) return mkr('Ask me about a clinic’s balance, statement, ledger, outstanding invoices, or an invoice search.');
  const lower = folded(q);

  // ── code/docs questions ───────────────────────────────────────────────
  if (/^how (does|do|is)\b|^what is\b|^where is\b|^why\b|\bcodebase\b|\bsettings?\b|\bhelp me\b/.test(lower)) {
    if (/\bvoice\b|\bassistant\b/.test(lower)) return mkr('Voice assistant is off by default. Enable it in Settings → Application Defaults → Voice Assistant. Groq routing is opt-in and never required for financial answers.');
    const docs = await getCodeAnswer(q);
    if (docs) return mkr(`From the codebase and docs:\n${docs}`);
  }

  // ── needs a clinic? ────────────────────────────────────────────────────
  const clinic = guessClinic(ctx, q);
  if (clinic && 'ambiguous' in clinic) {
    return mkr(`Which clinic did you mean — ${clinic.ambiguous.join(', ')}?`);
  }
  const directResolve = resolveClinic(ctx, q.match(/(?:for|of)\s+([A-Za-z0-9 ()&-]{2,})/i)?.[1]?.trim());
  const chosen = clinic ?? directResolve;

  const period = periodFromQuery(q);

  const needsClinic = /balance|owe|statement|ledger|outstanding|unpaid|overdue|advance|wallet|baki|udhar/.test(lower);
  if (needsClinic && !chosen) {
    const hint = q.match(/(?:for|of)\s+([A-Za-z0-9 ()&-]{2,})/i)?.[1]?.trim();
    const candidates = clinicCandidates(ctx, hint);
    if (candidates.length > 1) return mkr(`Which clinic did you mean — ${candidates.map((c) => c.name).join(', ')}?`);
    return mkr('Which clinic should I look up?');
  }

  // ── outstanding invoices ──────────────────────────────────────────────
  if (/overdue|unpaid|outstanding|baki/.test(lower)) {
    return mkr(getUnpaid(ctx, chosen!.id, { overdue: /overdue/.test(lower) }));
  }

  // ── advance wallet ────────────────────────────────────────────────────
  if (/advance|wallet/.test(lower)) {
    return mkr(`For ${chosen!.name}: ${getAdvanceWallet(ctx, chosen!.id)}`);
  }

  // ── statement ─────────────────────────────────────────────────────────
  if (/statement|monthly/.test(lower)) {
    const { from, to } = period.allTime ? { from: undefined, to: undefined } : period;
    return mkr(`For ${chosen!.name}: ${getStatementAnswer(ctx, chosen!.id, from, to, period.allTime)}`);
  }

  // ── ledger ────────────────────────────────────────────────────────────
  if (/ledger/.test(lower)) {
    return mkr(`For ${chosen!.name}: ${getLedgerAnswer(ctx, chosen!.id, period.from, period.to)}`);
  }

  // ── balance ───────────────────────────────────────────────────────────
  if (/balance|owe|udhar/.test(lower)) {
    const bal = getClinicBalance(ctx, chosen!.id);
    return mkr(`${chosen!.name}: PKR ${Math.abs(bal.signed).toLocaleString()} ${bal.label}.`);
  }

  // ── search invoices ───────────────────────────────────────────────────
  if (/search|find|look up|invoice/.test(lower)) {
    const hits = searchInvoicesInContext(ctx, q.replace(/^(search for|find|look up|invoice)\s*/i, '').trim() || q);
    return mkr(hits);
  }

  // ── Groq fallback for anything else ───────────────────────────────────
  const groq = await groqChat([
    { role: 'system', content: 'You are a strict intent classifier for a dental lab billing app. Reply with ONLY JSON like {"intent":"none"}. Valid intents: getClinicBalance, getClinicStatement, getLedger, getOutstanding, getAdvanceWallet, searchInvoices. Never output prose.' },
    { role: 'user', content: q },
  ], { maxTokens: 120 });
  if (groq) {
    try {
      const parsed = JSON.parse(groq.slice(groq.indexOf('{'), groq.lastIndexOf('}') + 1));
      if (parsed?.intent === 'getClinicBalance' && chosen) {
        const bal = getClinicBalance(ctx, chosen.id);
        return mkr(`${chosen.name}: PKR ${Math.abs(bal.signed).toLocaleString()} ${bal.label}.`);
      }
      if (parsed?.intent === 'getClinicStatement' && chosen) {
        const { from, to } = period.allTime ? { from: undefined, to: undefined } : period;
        return mkr(`For ${chosen.name}: ${getStatementAnswer(ctx, chosen.id, from, to, period.allTime)}`);
      }
      if (parsed?.intent === 'getLedger' && chosen) {
        return mkr(`For ${chosen.name}: ${getLedgerAnswer(ctx, chosen.id, period.from, period.to)}`);
      }
      if (parsed?.intent === 'getOutstanding' && chosen) {
        return mkr(getUnpaid(ctx, chosen.id));
      }
      if (parsed?.intent === 'getAdvanceWallet' && chosen) {
        return mkr(`For ${chosen.name}: ${getAdvanceWallet(ctx, chosen.id)}`);
      }
    } catch {
      /* fall through to safe default */
    }
  }
  return mkr('I can answer a clinic’s balance, statement, ledger, outstanding invoices, advance wallet, invoice search, or codebase questions. Try “Mir Dental balance”, “ledger for Mir Dental this month”, or “outstanding invoices for Iqbal”.');
}
