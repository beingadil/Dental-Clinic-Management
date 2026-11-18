import { describe, it, expect } from 'vitest';
import { guessClinic } from '../../src/services/voiceAssistant';
import { periodFromQuery } from '../../src/services/voiceTools';

const ctx = {
  labs: [
    { id: 'l1', name: 'Mir Dental' },
    { id: 'l2', name: 'Iqbal Dental' },
    { id: 'l3', name: 'Mandir Iqbal Dental' },
  ] as never,
  invoices: [], advancePayments: [], accountAdjustments: [],
} as never;

describe('voice context parsing', () => {
  it('resolves an exact known clinic substring', () => {
    expect((guessClinic(ctx as never, 'Mir Dental balance') as { name: string }).name).toBe('Mir Dental');
  });

  it('flags ambiguity instead of guessing when two clinics match', () => {
    const result = guessClinic(ctx as never, 'Iqbal statement') as { ambiguous: string[] } | { name: string };
    expect('ambiguous' in result ? result.ambiguous : []).toContain('Iqbal Dental');
  });

  it('parses All Time and this/last month windows', () => {
    expect(periodFromQuery('pain ledger all time').allTime).toBe(true);
    expect(periodFromQuery('ledger this month').from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(periodFromQuery('ledger from 2026-10-05 till 2026-10-31')).toEqual({ from: '2026-10-05', to: '2026-10-31', allTime: false });
  });
});
