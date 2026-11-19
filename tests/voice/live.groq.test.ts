/**
 * @vitest-environment jsdom
 *
 * Live Groq smoke suite — runs ONLY when GROQ_API_KEY is set in the
 * environment. Otherwise every test skips and no network call is made.
 *
 * The app never reads GROQ_API_KEY directly: keys live in localStorage
 * ('ds.voice.groq.key' + 'ds.voice.groq.enabled', see src/services/voiceGroq.ts).
 * So when the env key IS present we seed localStorage from it for the duration
 * of the run and restore whatever was there afterwards. When it is absent we
 * skip everything — groqChat() would return null immediately anyway, but the
 * skip keeps this file fully offline and free of accidental API hits.
 *
 * Run with: GROQ_API_KEY=... npx vitest run tests/voice/live.groq.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { askAssistant } from '../../src/services/voiceAssistant';

const hasKey = !!process.env.GROQ_API_KEY;
const TIMEOUT = 15_000;

/** Fake ctx, identical in shape to tests/services/voiceFallback.test.ts. */
const ctx = {
  labs: [
    { id: 'l1', name: 'Mir Dental' },
    { id: 'l2', name: 'Iqbal Dental' },
  ],
  invoices: [],
  cases: [],
  advancePayments: [],
  accountAdjustments: [],
  user: null,
  api: {
    labs: [
      { id: 'l1', name: 'Mir Dental' },
      { id: 'l2', name: 'Iqbal Dental' },
    ],
    invoices: [],
    cases: [],
    advancePayments: [],
    setCurrentView: () => {},
    addLab: () => ({ id: 'x', name: '' } as never),
    updateLab: () => {},
    updateCase: () => {},
    addCaseNote: () => {},
    recordQcCase: () => ({} as never),
    archiveCase: () => {},
    recordTransactionV2: () => ({ receiptNumber: 'REC' } as never),
    recordAdvanceDepositV2: () => ({ receiptNumber: 'REC' } as never),
  },
} as never;

const KEY = 'ds.voice.groq.key';
const ENABLED = 'ds.voice.groq.enabled';
let prevKey: string | null = null;
let prevEnabled: string | null = null;

describe.skipIf(!hasKey)('live groq', () => {
  beforeAll(() => {
    prevKey = localStorage.getItem(KEY);
    prevEnabled = localStorage.getItem(ENABLED);
    localStorage.setItem(KEY, process.env.GROQ_API_KEY as string);
    localStorage.setItem(ENABLED, 'true');
  });

  afterAll(() => {
    if (prevKey === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, prevKey);
    if (prevEnabled === null) localStorage.removeItem(ENABLED);
    else localStorage.setItem(ENABLED, prevEnabled);
  });

  it('answers "Mir Dental balance" with real text', async () => {
    const result = await askAssistant('Mir Dental balance', ctx);
    console.log('[live groq] "Mir Dental balance" ->', JSON.stringify(result.text));
    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(10);
  }, TIMEOUT);

  it('answers "show the books" (clarification or ledger)', async () => {
    const result = await askAssistant('show the books', ctx);
    console.log('[live groq] "show the books" ->', JSON.stringify(result.text));
    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(10);
  }, TIMEOUT);

  it('answers "cash collected today"', async () => {
    const result = await askAssistant('cash collected today', ctx);
    console.log('[live groq] "cash collected today" ->', JSON.stringify(result.text));
    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(10);
  }, TIMEOUT);

  it('handles the free-form "mir" with a clarification', async () => {
    const result = await askAssistant('mir', ctx);
    console.log('[live groq] "mir" ->', JSON.stringify(result.text));
    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(10);
    // Soft clarification check: expect a "which clinic"-style question or suggestions.
    expect(result.text).toMatch(/which clinic|what would you like|suggest|mir/i);
  }, TIMEOUT);
});
