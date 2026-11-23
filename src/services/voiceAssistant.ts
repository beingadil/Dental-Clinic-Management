/**
 * Voice assistant entry point.
 *
 * ALL intent resolution is via the Groq tool-calling agentic loop
 * (src/services/voiceAgent.ts). This file glues the agentic loop to local
 * memory and TTS.
 *
 * No fixed phrases anywhere: if the AI decides there is no tool call, it
 * asks the operator a natural, general question instead of a canned
 * keyword-match. The AI auto-executes the work when it is clear enough to
 * act on; otherwise it asks.
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
  /** When set, the voice shell auto-executes this write (destructive still
      keeps the typed-token gate). */
  pendingWrite?: WriteCommand;
  risk?: 'write' | 'destructive';
}

const mkr = (text: string): AssistantResult => ({ text, spoke: false });

/** Redact-and-remember the Q/A pair for the local "learn from us" store. */
const finish = (text: string, raw = ''): AssistantResult => {
  try { remember(raw, text); } catch { /* memory is best-effort */ }
  return mkr(text);
};

/** Natural, general question when the AI has no tool call to run. */
const noActionText = (): string =>
  'Hey — want to know anything about your clinic? Balances, statements, your open cases, or ask “what can you do?” for the full list.';

export async function askAssistant(raw: string, ctx: VoiceToolContext): Promise<AssistantResult> {
  const q = (raw || '').trim();
  const done = (text: string) => finish(text, q);
  if (!q) {
    return done('Try asking about balances, statements, ledgers or open cases — or say "what can you do?" for the full list.');
  }

  // Primary path: Groq agentic loop (tool calling, no regex matching).
  const agentResult = await runAgenticLoop(q, ctx);
  if (agentResult?.navigateTo) return { ...agentResult, spoke: true } as AssistantResult;
  if (agentResult?.text) return { ...agentResult, spoke: true } as AssistantResult;

  // Fallback: a natural question, never a canned phrase list.
  return done(noActionText());
}
