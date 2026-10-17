import { describe, it, expect } from 'vitest';
import {
  buildLabDeletionImpact,
  applyLabDeletion,
  type LabDeletionCollections,
} from '../../src/services/labDeletion';

/**
 * Deleting a clinic is a hard, unrecoverable cascade, and `syncCore` rebuilds
 * every SQLite table wholesale from state on each save — so a collection this
 * forgets is not "left alone", it is RESURRECTED on the next autosave, or the
 * rebuild aborts on a foreign key. These tests therefore enumerate every
 * collection the cascade touches and every one it must not.
 */

const lab = (id: string, name = `Clinic ${id}`) =>
  ({ id, name, created_at: '2026-01-01' }) as any;

const base = (): LabDeletionCollections =>
  ({
    labs: [lab('lab-a', 'Alpha Dental'), lab('lab-b', 'Beta Dental')],
    cases: [
      { id: 'case-a1', case_number: 'DS-0001', lab_id: 'lab-a' },
      { id: 'case-b1', case_number: 'DS-0002', lab_id: 'lab-b' },
    ],
    invoices: [
      {
        id: 'inv-a1', invoice_number: 'INV-0001', lab_id: 'lab-a',
        amount: 30000, final_amount: 28000, amount_paid: 12000,
        payments: [
          { id: 'pay-a1', amount: 12000 },
          { id: 'pay-a2', amount: 4000 },
        ],
      },
      {
        id: 'inv-b1', invoice_number: 'INV-0002', lab_id: 'lab-b',
        amount: 5000, final_amount: 5000, amount_paid: 0, payments: [],
      },
    ],
    advancePayments: [
      { id: 'adv-a1', lab_id: 'lab-a', amount: 10000 },
      { id: 'adv-b1', lab_id: 'lab-b', amount: 2500 },
    ],
    accountAdjustments: [
      { id: 'adj-a1', lab_id: 'lab-a', amount: 750, type: 'credit_note' },
      { id: 'adj-b1', lab_id: 'lab-b', amount: 300, type: 'write_off' },
    ],
    journalEntries: [
      { id: 'j-inv-a1', lab_id: 'lab-a', reference_type: 'invoice', reference_id: 'inv-a1', case_id: 'case-a1' },
      { id: 'j-pay-a1', lab_id: 'lab-a', reference_type: 'payment', reference_id: 'pay-a1', case_id: null },
      { id: 'j-adv-a1', lab_id: null, reference_type: 'advance', reference_id: 'adv-a1', case_id: null },
      { id: 'j-inv-b1', lab_id: 'lab-b', reference_type: 'invoice', reference_id: 'inv-b1', case_id: 'case-b1' },
    ],
    labContacts: [
      { id: 'lc-a1', lab_id: 'lab-a', name: 'Dr A' },
      { id: 'lc-b1', lab_id: 'lab-b', name: 'Dr B' },
    ],
    labAddresses: [
      { id: 'la-a1', lab_id: 'lab-a' },
      { id: 'la-b1', lab_id: 'lab-b' },
    ],
    pricingOverrides: [
      { id: 'po-a1', lab_id: 'lab-a' },
      { id: 'po-b1', lab_id: 'lab-b' },
    ],
    labReviews: [
      { id: 'lr-a1', lab_id: 'lab-a' },
      { id: 'lr-b1', lab_id: 'lab-b' },
    ],
    doctorPreferences: [
      { id: 'dp-a1', lab_id: 'lab-a' },
      { id: 'dp-b1', lab_id: 'lab-b' },
    ],
    qcInspections: [
      { id: 'qc-a1', case_id: 'case-a1' },
      { id: 'qc-b1', case_id: 'case-b1' },
    ],
    caseNotes: {
      'case-a1': [{ id: 'n1' }],
      'case-b1': [{ id: 'n2' }],
    },
    caseAttachments: {
      'case-a1': [{ id: 'at1' }],
      'case-b1': [{ id: 'at2' }],
    },
    notifications: [
      { id: 'nt-a-lab', lab_id: 'lab-a', case_id: null, invoice_id: null },
      { id: 'nt-a-case', lab_id: null, case_id: 'case-a1', invoice_id: null },
      { id: 'nt-a-inv', lab_id: null, case_id: null, invoice_id: 'inv-a1' },
      { id: 'nt-b1', lab_id: 'lab-b', case_id: null, invoice_id: null },
    ],
    savedVouchers: [
      { id: 'sv-a1', case_id: 'case-a1' },
      { id: 'sv-b1', case_id: 'case-b1' },
    ],
    reconciliationItems: [
      { id: 'ri-a-lab', lab_id: 'lab-a', invoice_id: null, payment_id: null },
      { id: 'ri-a-inv', lab_id: null, invoice_id: 'inv-a1', payment_id: null },
      { id: 'ri-a-pay', lab_id: null, invoice_id: null, payment_id: 'pay-a1' },
      { id: 'ri-b1', lab_id: 'lab-b', invoice_id: null, payment_id: null },
    ],
  }) as unknown as LabDeletionCollections;

const ids = (rows: any[]) => rows.map((r) => r.id).sort();

describe('the impact warning says what will be destroyed', () => {
  it('counts every linked row and totals the money', () => {
    const impact = buildLabDeletionImpact(base(), 'lab-a');

    expect(impact.labName).toBe('Alpha Dental');
    expect(impact.cases).toBe(1);
    expect(impact.invoices).toBe(1);
    // Both voucher slices of the invoice, not the invoice count.
    expect(impact.payments).toBe(2);
    expect(impact.advances).toBe(1);
    expect(impact.adjustments).toBe(1);
    expect(impact.contacts).toBe(1);
    expect(impact.addresses).toBe(1);
    expect(impact.pricingOverrides).toBe(1);
    expect(impact.reviews).toBe(1);
    // 28000 invoiced, 12000 + 4000 = 16000 paid.
    expect(impact.totalBilled).toBe(28000);
    expect(impact.totalPaid).toBe(16000);
    expect(impact.totalAdjustments).toBe(10000 + 750);
  });

  it('counts a journal that only names the clinic, or only names a doomed document', () => {
    /* j-pay-a1 has no lab_id and j-adv-a1 has neither, but both describe rows
       that are being destroyed. Missing either is how orphan ledger entries get
       left behind — the exact failure the reversal sweep had to clean up. */
    expect(buildLabDeletionImpact(base(), 'lab-a').journals).toBe(3);
  });

  it('reports zeros for a clinic with no history', () => {
    const c = base();
    c.labs.push(lab('lab-empty', 'Empty'));
    const impact = buildLabDeletionImpact(c, 'lab-empty');
    expect(impact.cases).toBe(0);
    expect(impact.invoices).toBe(0);
    expect(impact.totalBilled).toBe(0);
    expect(impact.totalPaid).toBe(0);
  });
});

describe('the cascade removes the clinic and everything under it', () => {
  const after = () => applyLabDeletion(base(), 'lab-a');

  it('removes the clinic itself and leaves the other one alone', () => {
    expect(after().labs.map((l) => l.id)).toEqual(['lab-b']);
  });

  it('removes its case jobs and their case-scoped children', () => {
    const a = after();
    expect(a.cases.map((c) => c.id)).toEqual(['case-b1']);
    // These hang off case_id, not lab_id — filtering by lab would miss them and
    // the rebuild would re-insert them.
    expect(ids(a.qcInspections)).toEqual(['qc-b1']);
    expect(Object.keys(a.caseNotes)).toEqual(['case-b1']);
    expect(Object.keys(a.caseAttachments)).toEqual(['case-b1']);
  });

  it('removes its invoices, taking the voucher rows with them', () => {
    const a = after();
    expect(a.invoices.map((i) => i.id)).toEqual(['inv-b1']);
    // The payments are not top-level rows; they went with their invoice.
    const gone = a.invoices.find((i) => i.id === 'inv-a1');
    expect(gone).toBeUndefined();
  });

  it('removes its advances and adjustments', () => {
    const a = after();
    expect(a.advancePayments.map((x) => x.id)).toEqual(['adv-b1']);
    expect(a.accountAdjustments.map((x) => x.id)).toEqual(['adj-b1']);
  });

  it('removes every journal that described a destroyed document', () => {
    /* Leaving any of these behind fills the ledger with entries that describe
       nothing — the reversal-era bug, reproduced. */
    expect(ids(after().journalEntries)).toEqual(['j-inv-b1']);
  });

  it('removes clinic-scoped records', () => {
    const a = after();
    expect(ids(a.labContacts)).toEqual(['lc-b1']);
    expect(ids(a.labAddresses)).toEqual(['la-b1']);
    expect(ids(a.pricingOverrides)).toEqual(['po-b1']);
    expect(ids(a.labReviews)).toEqual(['lr-b1']);
    expect(ids(a.doctorPreferences)).toEqual(['dp-b1']);
  });

  it('removes notifications, vouchers and reconciliation rows that point at the clinic', () => {
    const a = after();
    /* A notification can name the clinic, the case, or the invoice — all three
       routes have to be caught or the rebuild hits a dangling reference. */
    expect(ids(a.notifications)).toEqual(['nt-b1']);
    expect(ids(a.savedVouchers)).toEqual(['sv-b1']);
    expect(ids(a.reconciliationItems)).toEqual(['ri-b1']);
  });

  it('does not mutate the input', () => {
    const c = base();
    const before = JSON.stringify(c);
    applyLabDeletion(c, 'lab-a');
    expect(JSON.stringify(c)).toBe(before);
  });

  it('is a no-op for a clinic that does not exist', () => {
    const a = applyLabDeletion(base(), 'lab-missing');
    expect(a.labs).toHaveLength(2);
    expect(a.cases).toHaveLength(2);
    expect(a.invoices).toHaveLength(2);
    expect(a.journalEntries).toHaveLength(4);
  });

  it('agrees with the warning it showed', () => {
    /* The dialog promises counts. If the cascade and the impact calculation ever
       diverge, the operator is told one thing and loses another. */
    const before = base();
    const impact = buildLabDeletionImpact(before, 'lab-a');
    const a = applyLabDeletion(before, 'lab-a');
    expect(a.cases).toHaveLength(before.cases.length - impact.cases);
    expect(a.invoices).toHaveLength(before.invoices.length - impact.invoices);
    expect(a.journalEntries).toHaveLength(before.journalEntries.length - impact.journals);
    expect(a.advancePayments).toHaveLength(before.advancePayments.length - impact.advances);
    expect(a.accountAdjustments).toHaveLength(before.accountAdjustments.length - impact.adjustments);
    expect(a.labContacts).toHaveLength(before.labContacts.length - impact.contacts);
  });
});