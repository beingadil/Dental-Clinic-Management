import { describe, it, expect } from 'vitest';
import { askAssistant } from '../../src/services/voiceAssistant';

const ctx = {
  labs: [
    { id: 'l1', name: 'Mir Dental' },
    { id: 'l2', name: 'Iqbal Dental' },
  ],
  invoices: [],
  cases: [
    { id: 'case-1', case_number: 'DS-0393', status: 'received', delivery_date: '2026-11-30', lab_id: 'l1', lab_name: 'Mir Dental', doctor_name: 'Dr. Tariq', patient_name: 'Nabeel' },
    { id: 'case-2', case_number: 'DS-0394', status: 'ready', delivery_date: '2026-11-25', lab_id: 'l2', lab_name: 'Iqbal Dental', doctor_name: 'Dr. Nadeem', patient_name: 'Ahmed' },
    { id: 'case-3', case_number: 'DS-0395', status: 'delivered', delivery_date: '2026-11-01', lab_id: 'l1', lab_name: 'Mir Dental', doctor_name: 'Dr. Tariq', patient_name: 'Sara' },
  ],
  advancePayments: [],
  accountAdjustments: [],
  user: null,
  api: {
    labs: [{ id: 'l1', name: 'Mir Dental' }, { id: 'l2', name: 'Iqbal Dental' }],
    invoices: [],
    cases: [
      { id: 'case-1', case_number: 'DS-0393' } as never,
      { id: 'case-2', case_number: 'DS-0394' } as never,
      { id: 'case-3', case_number: 'DS-0395' } as never,
    ],
    advancePayments: [],
    setCurrentView: () => {},
    addLab: () => ({ id: 'x', name: '' } as never),
    updateLab: () => {},
    updateCase: () => {},
    addCaseNote: () => {},
    recordQcCase: () => ({ status_after: 'ready' } as never),
    archiveCase: () => {},
    recordTransactionV2: () => ({ receiptNumber: 'REC' } as never),
    recordAdvanceDepositV2: () => ({ receiptNumber: 'REC' } as never),
  },
} as never;

const expectRead = (r: { text: string }, match: RegExp | string) => {
  if (typeof match === 'string') expect(r.text).toContain(match);
  else expect(r.text).toMatch(match);
};

describe('voice phrases — case workflow', () => {
  const writePhrases: [string, string][] = [
    ['mark case DS-0393 ready', 'setCaseStatus'],
    ['move case DS-0393 to ready', 'setCaseStatus'],
    ['set case DS-0393 as delivered', 'setCaseStatus'],
    ['advance case DS-0393 to qc', 'setCaseStatus'],
    ['move case DS-0393 to revision', 'setCaseStatus'],
    ['cancel case DS-0393', 'setCaseStatus'],
    ['add note on case DS-0393: doctor approved wax-up', 'addCaseNote'],
    ['add note to case DS-0393: shade confirmed A2', 'addCaseNote'],
    ['post note on case DS-0393 patient called', 'addCaseNote'],
    ['qc pass case DS-0393', 'recordQc'],
    ['qc fail case DS-0393 margin_fit', 'recordQc'],
    ['qc fail case DS-0393 shade_mismatch', 'recordQc'],
    ['record qc pass case DS-0394', 'recordQc'],
    ['qc fail case DS-0394', ''], // missing reason — must NOT open pending write
    ['archive case DS-0395', 'archiveCase'],
    ['archive case DS-0393', 'archiveCase'], // delivered? no — received; still pends, but confirm will refuse
  ];

  for (const [phrase, kind] of writePhrases) {
    it(`parses "${phrase}"`, async () => {
      const r = await askAssistant(phrase, ctx);
      if (!kind) expect(r.pendingWrite).toBeUndefined();
      else expect((r.pendingWrite as { kind?: string } | undefined)?.kind).toBe(kind);
    });
  }

  it('"add case" is a create signal — clarification points at new-case guidance', async () => {
    const r = await askAssistant('add case', ctx);
    expectRead(r, /case/i);
  });

  it('unknown case phrase falls back to clarification, never a dead end', async () => {
    const r = await askAssistant('do the case thing', ctx);
    expect(r.text.length).toBeGreaterThan(20);
  });

  it('marking a case ready emits a confirmation (not a silent change)', async () => {
    const r = await askAssistant('mark case DS-0393 ready', ctx);
    expect(r.pendingWrite).toBeTruthy();
    expect(r.text).toMatch(/confirm/i);
  });

  it('add-note content is carried through to the pending action', async () => {
    const r = await askAssistant('add note on case DS-0393: doctor says approved', ctx);
    expect((r.pendingWrite as { noteText?: string } | undefined)?.noteText).toContain('doctor says approved');
  });

  it('qc fail without reason returns instructions, not a confirmation', async () => {
    const r = await askAssistant('qc fail case DS-0393', ctx);
    expect(r.pendingWrite).toBeUndefined();
    expectRead(r, /margin_fit/);
  });
});

describe('voice phrases — case reads', () => {
  it('answers case status/overdue questions without crashing', async () => {
    const r = await askAssistant('overdue cases', ctx);
    expect(typeof r.text).toBe('string');
    expect(r.text.length).toBeGreaterThan(10);
  });

  it('answers invoice/invoice-number questions', async () => {
    const r = await askAssistant('invoice INV-0042', ctx);
    expect(typeof r.text).toBe('string');
  });
});
