/**
 * Local, redacted memory for the assistant ("learn from us").
 *
 * Stores only what the assistant SAW THE USER ASK and what it ANSWERED — never
 * clinical detail, never credentials. Redaction is applied before anything is
 * written; the memory list is visible in Settings and can be cleared at any time.
 */
import { redactVoiceText } from './voiceRedaction';

const KEY = 'ds.voice.memory';
const MAX_ENTRIES = 100;

export interface VoiceMemoryEntry { id: string; question: string; answer: string; at: string }

const read = (): VoiceMemoryEntry[] => {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') as VoiceMemoryEntry[]; } catch { return []; }
};
export const listMemories = (): VoiceMemoryEntry[] => read();
export const clearMemories = (): void => { localStorage.removeItem(KEY); };

export const remember = (question: string, answer: string): void => {
  const q = redactVoiceText((question || '').trim(), { allowClinicalDetail: false }).text;
  const a = redactVoiceText((answer || '').trim(), { allowClinicalDetail: false }).text;
  if (!q || !a) return;
  const entries = read();
  entries.unshift({ id: `mem-${Date.now()}`, question: q, answer: a, at: new Date().toISOString() });
  localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
};

/** Short, redacted digest to ground the optional Groq channel; never clinical. */
export const memoryContext = (): string => {
  const entries = read().slice(0, 12);
  if (!entries.length) return '';
  return 'Prior operator questions and accepted answers (redacted):\n'
    + entries.map((e) => `- Q: ${e.question}\n  A: ${e.answer}`).join('\n');
};
