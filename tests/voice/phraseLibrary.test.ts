import { describe, it, expect } from 'vitest';
import { askAssistant } from '../../src/services/voiceAssistant';

/**
 * Phrase coverage sweep — one test per phrasing that a real operator might say.
 * Every row lands on either its pending write kind (read-only assertions also run).
 * No Groq key is needed: the deterministic registry answers these when the LLM is absent.
 */
const ctx = {
  labs: [
    { id: 'l1', name: 'Mir Dental' },
    { id: 'l2', name: 'Iqbal Dental' },
    { id: 'l3', name: 'Ahmed Surgical' },
  ],
  invoices: [],
  cases: [
    { id: 'case-1', case_number: 'DS-0393', status: 'received', lab_id: 'l1', lab_name: 'Mir Dental', doctor_name: 'Dr. Tariq', patient_name: 'Nabeel' },
    { id: 'case-3', case_number: 'DS-0395', status: 'delivered', lab_id: 'l1', lab_name: 'Mir Dental', doctor_name: 'Dr. Tariq', patient_name: 'Sara' },
  ],
  caseTypes: [
    { id: 'ct1', name: 'Zirconia Crown', base_price: 22000 },
    { id: 'ct2', name: 'PFM Crown', base_price: 8000 },
  ],
  labContacts: [],
  labAddresses: [],
  pricingOverrides: [],
  advancePayments: [],
  accountAdjustments: [],
  user: null,
  api: {
    labs: [
      { id: 'l1', name: 'Mir Dental' }, { id: 'l2', name: 'Iqbal Dental' }, { id: 'l3', name: 'Ahmed Surgical' },
    ],
    invoices: [],
    cases: [
      { id: 'case-1', case_number: 'DS-0393' } as never,
      { id: 'case-3', case_number: 'DS-0395' } as never,
    ],
    caseTypes: [
      { id: 'ct1', name: 'Zirconia Crown' } as never, { id: 'ct2', name: 'PFM Crown' } as never,
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
    addLabContact: () => {},
    addLabAddress: () => {},
    addPricingOverride: () => {},
  },
} as never;

describe('read phrasings never die', () => {
  const reads = [
    'Mir Dental balance',
    'what is Mir Dental balance',
    'how much does Mir Dental owe',
    'outstanding invoices for Mir Dental',
    'Mir Dental statement',
    'statement for Mir Dental',
    'statement for Mir Dental all time',
    'ledger for Mir Dental',
    'cash collected today',
    'overdue cases',
    'standings',
    'Mir Dental advance wallet',
    'advance credit for Mir Dental',
    'month close status for October 2026',
    'morning briefing',
    'walk me through Mir Dental statement last month',
    'find invoice INV-0042',
  ];
  for (const phrase of reads) {
    it(`reads: "${phrase}"`, async () => {
      const r = await askAssistant(phrase, ctx);
      expect(typeof r.text).toBe('string');
      expect(r.text.length).toBeGreaterThan(8);
    });
  }
});

describe('write phrasings route to the same tool', () => {
  const writes: [string, string][] = [
    // Payments
    ['record payment of PKR 5,000 for Mir Dental', 'payment'],
    ['take payment of PKR 5,000 for Mir Dental', 'payment'],
    ['collect payment of PKR 5,000 for Mir Dental', 'payment'],
    ['accept payment of PKR 5,000 for Mir Dental', 'payment'],
    // Advances
    ['record advance deposit of PKR 2,000 for Mir Dental', 'advance'],
    ['post advance for Mir Dental PKR 2,000', 'advance'],
    // Clinic CRUD
    ['add clinic New Test Dental', 'createClinic'],
    ['update doctor for Mir Dental to Dr Tariq', 'updateClinicDoctor'],
    ['update phone for Mir Dental to 0300-1234567', 'updateClinicField'],
    ['update email for Mir Dental to m@example.com', 'updateClinicField'],
    ['update address for Mir Dental to 12 Clinic Road', 'updateClinicField'],
    ['update name for Mir Dental to Mir Dental Surgery', 'updateClinicField'],
    ['update city for Mir Dental to Wazirabad', 'updateClinicField'],
    // Clinic relationships
    ['add contact Ahmed to Mir Dental, phone 0300-1122334', 'addClinicContact'],
    ['add contact Sara to Mir Dental phone 0300112244', 'addClinicContact'],
    ['add contact Ahmed to Mir Dental phone 0300-1122334, primary', 'addClinicContact'],
    ['add billing address for Mir Dental: 12 Main Blvd, Lahore, Punjab 54000, Pakistan', 'addClinicAddress'],
    ['add lab location address for Mir Dental: 12 Main Blvd, Lahore, Punjab 54000, Pakistan', 'addClinicAddress'],
    // Pricing
    ['add pricing override for Mir Dental: Zirconia Crown at PKR 25,000', 'addPricingOverride'],
    // Case status
    ['mark case DS-0393 ready', 'setCaseStatus'],
    ['move case DS-0393 to ready', 'setCaseStatus'],
    ['route DS-0393 to qc', 'setCaseStatus'],
    ['send DS-0393 to revision', 'setCaseStatus'],
    ['move DS-0393 to ready', 'setCaseStatus'],
    ['cancel DS-0393', 'setCaseStatus'],
    ['cancel case DS-0393', 'setCaseStatus'],
    // Case notes
    ['add note on case DS-0393: chair time confirmed', 'addCaseNote'],
    ['log note on case DS-0393 technician approved', 'addCaseNote'],
    ['post note on case DS-0393 shade confirmed A2', 'addCaseNote'],
    // QC
    ['qc pass case DS-0393', 'recordQc'],
    ['qc pass DS-0393', 'recordQc'],
    ['qc fail case DS-0393 margin_fit', 'recordQc'],
    ['record qc pass DS-0393', 'recordQc'],
    // Archive
    ['archive case DS-0395', 'archiveCase'],
    ['archive DS-0395', 'archiveCase'],
  ];
  for (const [phrase, kind] of writes) {
    it(`writes: "${phrase}" → ${kind}`, async () => {
      const r = await askAssistant(phrase, ctx);
      expect((r.pendingWrite as { kind?: string } | undefined)?.kind).toBe(kind);
    });
  }
});

describe('graceful failure (never a dead end)', () => {
  const nonsense = ['bonkers gibberish zzz', 'mir', 'do the case thing', 'hello', 'the'];
  for (const phrase of nonsense) {
    it(`falls back helpfully: "${phrase}"`, async () => {
      const r = await askAssistant(phrase, ctx);
      expect(typeof r.text).toBe('string');
      expect(r.text.length).toBeGreaterThan(20);
    });
  }
});
