import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

class SpeechSynthesisStub {
  speak = vi.fn();
  cancel = vi.fn();
  getVoices = vi.fn(() => [
    { voiceURI: 'uri-1', lang: 'en-PK', name: 'PK Voice' },
    { voiceURI: 'uri-2', lang: 'en-US', name: 'US Voice' },
  ]) as unknown as () => SpeechSynthesisVoice[];
}

beforeEach(() => {
  (globalThis as any).window = { speechSynthesis: new SpeechSynthesisStub() };
});

afterEach(() => {
  delete (globalThis as any).window;
});

import { clampRate, isSpeechSynthesisAvailable, pickVoice, cancelSpeech, speak } from '../../src/services/voiceUtterance';

describe('voice utterance plumbing', () => {
  it('knows speech is available only when window.speechSynthesis exists', () => {
    expect(isSpeechSynthesisAvailable()).toBe(true);
    delete (globalThis as any).window.speechSynthesis;
    expect(isSpeechSynthesisAvailable()).toBe(false);
  });

  it('clamps rate within 0.5–2 and defaults to 1', () => {
    expect(clampRate(undefined)).toBe(1);
    expect(clampRate(9)).toBe(2);
    expect(clampRate(0)).toBe(0.5);
  });

  it('picks preferred URI, then locale prefix, then any English voice', () => {
    const voices = (globalThis as any).window.speechSynthesis.getVoices();
    expect(pickVoice(voices, 'uri-1')?.voiceURI).toBe('uri-1');
    expect(pickVoice(voices, undefined, 'en-PK')?.voiceURI).toBe('uri-1');
    expect(pickVoice(voices, undefined, 'fr-FR')?.voiceURI).toBe('uri-1'); // falls back to en-*
    expect(pickVoice(voices, undefined, 'de-DE')?.voiceURI).not.toBeUndefined();
  });

  it('speak returns false and does not throw without speechSynthesis', () => {
    delete (globalThis as any).window.speechSynthesis;
    expect(speak('hello')).toBe(false);
    expect(() => cancelSpeech()).not.toThrow();
  });
});
