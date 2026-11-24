/**
 * Deterministic, offline speech output for the assistant.
 *
 * Every string spoken aloud goes through `redactVoiceText` first at the
 * call site; this module only owns the speechSynthesis plumbing so it can be
 * exercised under node/jsdom without a browser.
 */
import { redactVoiceText } from './voiceRedaction';

export interface SpeakOptions {
  rate?: number;
  voiceUri?: string;
  locale?: string;
  allowClinicalDetail?: boolean;
  onEnd?: () => void;
  onError?: (err: unknown) => void;
}

export const isSpeechSynthesisAvailable = (): boolean =>
  typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';

export const clampRate = (rate: number | undefined): number =>
  Math.min(2, Math.max(0.5, typeof rate === 'number' && !Number.isNaN(rate) ? rate : 1));

/**
 * Pick a voice for the utterance: explicit URI wins, then a locale-prefix
 * match (en-PK preferred for Pakistani English, then en), then any English
 * voice, then nothing.
 */
export const pickVoice = (
  voices: SpeechSynthesisVoice[],
  preferredUri?: string,
  locale?: string,
): SpeechSynthesisVoice | null => {
  if (!voices.length) return null;
  if (preferredUri) {
    const hit = voices.find((v) => v.voiceURI === preferredUri);
    if (hit) return hit;
  }
  const want = (locale || 'en-PK').toLowerCase();
  const prefix = want.split('-')[0];
  const byLocale = voices.find((v) => (v.lang || '').toLowerCase().startsWith(want));
  if (byLocale) return byLocale;
  const byPrefix = voices.find((v) => (v.lang || '').toLowerCase().startsWith(prefix));
  if (byPrefix) return byPrefix;
  const anyEn = voices.find((v) => (v.lang || '').toLowerCase().startsWith('en'));
  return anyEn || null;
};

/**
 * Speak `text` aloud (after redaction). Returns false when speech is
 * unavailable or the caller should fall back to a visual-only confirmation.
 */
export const speak = (text: string, opts: SpeakOptions = {}): boolean => {
  if (!isSpeechSynthesisAvailable()) return false;
  const synth = window.speechSynthesis;
  const redacted = redactVoiceText(text || '', {
    allowClinicalDetail: opts.allowClinicalDetail,
  }).text;
  if (!redacted.trim()) return false;

  try {
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(redacted);
    utterance.rate = clampRate(opts.rate);
    const voices = synth.getVoices();
    const chosen = pickVoice(voices, opts.voiceUri, opts.locale);
    if (chosen) utterance.voice = chosen;
    if (opts.onEnd) utterance.onend = () => opts.onEnd?.();
    if (opts.onError) utterance.onerror = (evt) => opts.onError?.(evt);
    synth.speak(utterance);
    return true;
  } catch (error) {
    opts.onError?.(error);
    return false;
  }
};

export const cancelSpeech = (): void => {
  if (!isSpeechSynthesisAvailable()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* never throw from a best-effort cancel */
  }
};
