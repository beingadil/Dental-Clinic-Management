import { describe, it, expect } from 'vitest';
import { askAssistant } from '../../src/services/voiceAssistant';

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

describe('assistant auto-fallback', () => {
  // Intent resolution is via the Groq agentic loop. When the AI has nothing
  // to run, it returns a natural, open question — never a canned phrase list.
  it('asks a natural open question when a user names a clinic without an action', async () => {
    const result = await askAssistant('Mir Dental', ctx);
    expect(result.text).toContain('your clinic');
    expect(result.text).toMatch(/balances/i);
    expect(result.text).not.toMatch(/^Say /i);
  });

  it('asks a natural question for ambiguous clinic input', async () => {
    const result = await askAssistant('mir or iqbal', ctx);
    expect(result.text).toContain('your clinic');
  });

  it('falls back to a natural question for money words', async () => {
    const result = await askAssistant('show me the cash', ctx);
    expect(result.text).toContain('your clinic');
  });

  it('falls back to a natural question for ledger questions without context', async () => {
    const result = await askAssistant('show me the books', ctx);
    expect(result.text).toContain('your clinic');
  });

  it('never dead-ends — always suggests something actionable', async () => {
    const result = await askAssistant('bonkers gibberish', ctx);
    expect(result.text).toMatch(/your clinic|balances/i);
  });
});
