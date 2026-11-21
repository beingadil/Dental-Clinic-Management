/**
 * Groq planner: maps a free-form sentence to ONE registry tool + slot values,
 * or asks a clarifying question. The LLM NEVER produces figures — it only
 * routes. Tools execute deterministically in voiceRegistry.
 */
import { groqChat } from './voiceGroq';
import { VOICE_TOOLS } from './voiceRegistry';

export interface PlannedIntent {
  tool: string;
  clinic?: string;
  /** 'YYYY-MM-DD' bounds; omitted means unconstrained. */
  from?: string;
  to?: string;
  /** Raw utterance the canonical string is built from (audit/debug). */
  raw: string;
  confidence: number;
}

export const toolCatalog = () =>
  VOICE_TOOLS.map((t) => `- ${t.id}: ${t.description}`).join('\n');

const SYSTEM = `You are the intent router for an offline dental-lab billing app.
Reply with ONLY a JSON object: {"tool": "<id|none>", "clinic": "<clinic name or empty>", "from": "<YYYY-MM-DD or empty>", "to": "<YYYY-MM-DD or empty>", "confidence": 0..1}
Rules:
- Pick ONE tool from the catalog. If nothing fits, use "none".
- clinic must be exactly the clinic name as it appears in the list, or empty.
- Dates: only today/last-month/etc. become YYYY-MM-DD; otherwise empty.
- Never invent figures, never invent clinics, never invent tools.
- Output JSON only, no prose, no markdown.`;

const tryParse = (text: string): Record<string, unknown> | null => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
};

export async function planWithGroq(query: string, labs: { id: string; name: string }[]): Promise<PlannedIntent | null> {
  const clinicList = (labs || []).map((l) => l.name).join(' | ');
  const out = await groqChat([
    { role: 'system', content: SYSTEM + '\n\nKnown clinics: ' + clinicList + '\n\nTool catalog:\n' + toolCatalog() },
    { role: 'user', content: query },
  ], { maxTokens: 150, timeoutMs: 10000 });
  if (!out) return null;
  const parsed = tryParse(out);
  if (!parsed) return null;
  const tool = String(parsed.tool || 'none');
  const known = VOICE_TOOLS.some((t) => t.id === tool);
  if (!known || tool === 'none') return null;
  const confidence = Number(parsed.confidence ?? 0.5) || 0.5;
  const from = parsed.from && String(parsed.from).match(/^\d{4}-\d{2}-\d{2}$/) ? String(parsed.from) : undefined;
  const to = parsed.to && String(parsed.to).match(/^\d{4}-\d{2}-\d{2}$/) ? String(parsed.to) : undefined;
  return {
    tool,
    clinic: String(parsed.clinic || '').trim() || undefined,
    from,
    to,
    raw: query,
    confidence,
  };
}

/** Canonical string fed back into the registry: "<verb-ish> <clinic?> <range?>". */
export const canonicalFor = (plan: PlannedIntent): string => {
  const range = plan.from && plan.to ? ` from ${plan.from} to ${plan.to}` : plan.from ? ` from ${plan.from}` : '';
  const clinic = plan.clinic ? ` for ${plan.clinic}` : '';
  // The registry recognises natural prefixes like "ledger", "balance", "outstanding" etc.
  const verb: Record<string, string> = {
    cashCollected: 'cash collected',
    overdueCases: 'overdue cases',
    standings: 'standings',
    monthClose: 'month close status',
    clinicBalance: 'balance',
    statement: 'statement',
    ledger: 'ledger',
    outstanding: 'outstanding invoices',
    advanceWallet: 'advance wallet',
    invoiceSearch: 'search invoice',
    narrate: 'walk me through statement',
    briefing: 'morning briefing',
    navigate: 'open dashboard',
  };
  return `${verb[plan.tool] || plan.tool}${clinic}${range}`;
};
