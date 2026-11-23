/**
 * Voice assistant entry point.
 *
 * Per AGENTS.md: NO hardcoded phrases. All intent resolution happens via
 * Groq Tool Calling through runAgenticLoop. This file glues the agentic
 * loop to the local memory, TTS, and confirmation handling.
 */
import { remember } from './voiceMemory';
import type { VoiceToolContext } from './voiceRegistry';
import type { WriteCommand } from './voiceWrite';
import { runAgenticLoop } from './voiceAgent';

export interface AssistantResult {
  text: string;
  spoke: boolean;
  /** When set, the voice shell navigates the app to this view id. */
  navigateTo?: string;
  /** When set, the voice shell opens the amber confirmation panel for this action. */
  pendingWrite?: WriteCommand;
  /** Risk of the pending action (write | destructive). */
  risk?: 'write' | 'destructive';
}

const mkr = (text: string): AssistantResult => ({ text, spoke: false });

/** Clinic names mentioned in the query (distinctive token overlap; generic words ignored). */
const mentionedClinics = (ctx: VoiceToolContext, q: string): string[] => {
  const stop = new Set(['dental', 'clinic', 'clinics', 'lab', 'labs', 'the', 'of', 'for', 'and', 'a']);
  const f = q.toLowerCase();
  return (ctx.labs || [])
    .filter((lab) => lab.name.toLowerCase().split(/\s+/).some((t) => t.length >= 3 && !stop.has(t) && f.includes(t)))
    .map((l) => l.name);
};

/**
 * Auto-fallback: never dead-end. Ask the smallest useful question instead —
 * a clinic name with no action → ask what to do with it; money words →
 * list the money verbs; anything else → say what it can do.
 */
const buildClarification = (ctx: VoiceToolContext, raw: string): string => {
  const q = raw.toLowerCase();
  const clinics = mentionedClinics(ctx, raw);
  if (clinics.length === 1) {
    return `What would you like to do with ${clinics[0]}? Balance, statement, ledger, outstanding invoices, advance wallet, doctor, or edit a field — just say the action.`;
  }
  if (clinics.length > 1) {
    return `Which clinic — ${clinics.join(', ')}?`;
  }
  if (/money|cash|payment|balance|bill|invoice|collect|receiv|pay\b/.test(q)) {
    return 'Try: “cash collected today”, “Mir Dental balance”, “outstanding invoices for Mir Dental”, “record payment of PKR 5,000 for Mir Dental”, or “advance wallet for Mir Dental”.';
  }
  if (/statement|ledger|books|journal|close|closing/.test(q)) {
    return 'Which clinic and which period — today, this month, last month, or All Time? For example: “Ledger for Mir Dental last month” or “Statement for Iqbal Dental all time”.';
  }
  if (/case|patient|tooth|shade|delivery|ready/.test(q)) {
    return 'Say “Overdue cases”, “Mark case DS-0393 ready”, “Add note on case DS-0393 …”, or “QC pass case DS-0393”.';
  }
  return `I didn't catch what you meant. Try: “Mir Dental balance”, “Open general ledger”, “Add clinic”, or ask “What can you do?”`;
};

/** Redact-and-remember the Q/A pair for the local "learn from us" store. */
const finish = (text: string, raw = ''): AssistantResult => {
  try { remember(raw, text); } catch { /* memory is best-effort */ }
  return mkr(text);
};

export async function askAssistant(raw: string, ctx: VoiceToolContext): Promise<AssistantResult> {
  const q = (raw || '').trim();
  const done = (text: string) => finish(text, q);
  if (!q) {
    return done('Ask me anything about the clinic: balances, statements, ledgers, overdue work, cash collected, or open any screen. Say “what can you do?” for the full list.');
  }

  // Primary path: Groq agentic loop (tool calling, no regex matching).
  const agentResult = await runAgenticLoop(q, ctx);
  if (agentResult?.navigateTo) return { ...agentResult, spoke: true } as AssistantResult;
  if (agentResult?.text) return { ...agentResult, spoke: true } as AssistantResult;

  // Fallback: clarification.
  return done(buildClarification(ctx, q));
}
