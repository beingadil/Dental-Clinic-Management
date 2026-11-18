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
  it('asks what to do when a user names a clinic without an action', async () => {
    const result = await askAssistant('Mir Dental', ctx);
    expect(result.text).toContain('What would you like to do with Mir Dental');
    expect(result.text).toMatch(/[Bb]alance/);
  });

  it('disambiguates when several clinic names match', async () => {
    const result = await askAssistant('mir or iqbal', ctx);
    expect(result.text).toContain('Which clinic');
  });

  it('returns useful money verbs for money words', async () => {
    const result = await askAssistant('show me the cash', ctx);
    expect(result.text).toContain('Mir Dental balance');
  });

  it('asks for clinic + period for ledger questions without context', async () => {
    const result = await askAssistant('show me the books', ctx);
    expect(result.text).toContain('Which clinic');
  });

  it('never dead-ends — always suggests something actionable', async () => {
    const result = await askAssistant('bonkers gibberish', ctx);
    expect(result.text).toMatch(/Mir Dental balance|Open general ledger|what can you do/i);
  });
});
