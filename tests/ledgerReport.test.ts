import { describe, it, expect } from 'vitest';
import { buildLedgerReport, classifyPayments, round2, type BuildLedgerReportInput } from '../src/services/ledgerReport';

const caseInfo = (caseNumber: string) => ({
  case_number: caseNumber,
  case_id: `c-${caseNumber}`,
  patient_name: 'Farzana Yaseen',
  case_type_name: 'Zirconia',
  selected_teeth: [11,12,13,14,15,21,22,23,24,25].map(String),
  shade: 'A2',
});

/* DS-0092 regression: invoice 3,000; PAY-2026-0064 2,000; PAY-2026-0065 1,000 → settled. */
const ds92 = (): BuildLedgerReportInput => ({
  cases: [caseInfo('DS-0092')],
  invoices: [{ invoice_number: 'INV-0092', case_number: 'DS-0092' }],
  entries: [
    { id: 'i1', date: '2026-01-01', posted_at: '2026-01-01T09:00:00Z', entry_type: 'invoice', reference_id: 'inv', reference_number: 'INV-0092', case_number: 'DS-0092', description: 'Invoice for Zirconia', debit: 3000, credit: 0 },
    { id: 'p1', date: '2026-01-02', posted_at: '2026-01-02T09:00:00Z', entry_type: 'payment', reference_id: 'pay1', reference_number: 'PAY-2026-0064', case_number: 'DS-0092', description: 'Payment received for INV-0092', debit: 0, credit: 2000 },
    { id: 'p2', date: '2026-01-03', posted_at: '2026-01-03T09:00:00Z', entry_type: 'payment', reference_id: 'pay2', reference_number: 'PAY-2026-0065', case_number: 'DS-0092', description: 'Payment received for INV-0092', debit: 0, credit: 1000 },
  ],
});

describe('buildLedgerReport — accounting correctness', () => {
  it('DS-0092: invoice stays one transaction; both receipts separate; outstanding 0', () => {
    const { rows, summary } = buildLedgerReport(ds92());
    expect(rows).toHaveLength(3);
    expect(rows[0].voucherNumber).toBe('INV-0092');
    expect(rows[1].voucherNumber).toBe('PAY-2026-0064');
    expect(rows[2].voucherNumber).toBe('PAY-2026-0065');
    expect(rows[0].debit).toBe(3000);
    expect(rows[1].credit).toBe(2000);
    expect(rows[2].credit).toBe(1000);
    expect(summary.totalDebits).toBe(3000);
    expect(summary.totalCredits).toBe(3000);
    expect(summary.closingBalance).toBe(0);
    expect(summary.openingBalance).toBe(0);
  });

  it('voucher number is separate from case number; payments relate to invoice voucher', () => {
    const { rows } = buildLedgerReport(ds92());
    for (const r of rows) expect(r.voucherNumber).not.toBe(r.caseNumber);
    expect(rows[1].relatedInvoiceNumber).toBe('INV-0092');
    expect(rows[1].caseNumber).toBe('DS-0092');
  });

  it('never duplicates or merges payment vouchers', () => {
    const { rows } = buildLedgerReport(ds92());
    const pays = rows.filter((r) => r.type === 'payment');
    expect(pays).toHaveLength(2);
    expect(pays[0].credit + pays[1].credit).toBe(3000);
  });

  it('running balance = prev + debit - credit', () => {
    const { rows } = buildLedgerReport(ds92());
    expect(rows.map((r) => r.balance)).toEqual([3000, 1000, 0]);
  });

  it('opening = Σ(debit−credit) before period; closing = opening + D − C', () => {
    const { rows, summary } = buildLedgerReport({ ...ds92(), periodStart: '2026-01-02' });
    // opening-balance scan takes pre-period invoice; period contains the two payments
    expect(summary.openingBalance).toBe(3000);
    expect(rows).toHaveLength(2);
    expect(summary.totalDebits).toBe(0);
    expect(summary.totalCredits).toBe(3000);
    expect(summary.closingBalance).toBe(0);
  });

  it('does not count brought-forward twice: an opening_balance event inside the stream is not re-added', () => {
    const { summary } = buildLedgerReport({
      ...ds92(),
      entries: [
        { id: 'ob', date: '2025-12-31', posted_at: '2025-12-31T23:59:59Z', entry_type: 'opening_balance', reference_id: 'opening', reference_number: 'OPENING', description: 'Opening balance', debit: 1000, credit: 0 },
        ...ds92().entries,
      ],
      periodStart: '2026-01-01',
    });
    // OPENING event is before period → lands in opening; not also counted as a row
    expect(summary.openingBalance).toBe(1000);
    expect(summary.totalDebits).toBe(3000); // only the invoice inside period
    expect(summary.closingBalance).toBe(1000);
  });

  it('debit/credit adjustments: credit_note credits; debit_adjustment debits; refund debits', () => {
    const { summary, rows } = buildLedgerReport({
      cases: [],
      invoices: [],
      entries: [
        { id: 'a1', date: '2026-01-01', posted_at: '2026-01-01T09:00:00Z', entry_type: 'credit_note', reference_id: 'c1', reference_number: 'CR-0001', description: 'Credit', debit: 0, credit: 500 },
        { id: 'a2', date: '2026-01-02', posted_at: '2026-01-02T09:00:00Z', entry_type: 'debit_adjustment', reference_id: 'd1', reference_number: 'DR-0001', description: 'Debit', debit: 250, credit: 0 },
        { id: 'a3', date: '2026-01-03', posted_at: '2026-01-03T09:00:00Z', entry_type: 'refund', reference_id: 'r1', reference_number: 'REF-0001', description: 'Refund', debit: 100, credit: 0 },
      ],
    });
    expect(rows.map((r) => r.typeLabel)).toEqual(['Credit Note', 'Debit Adjustment', 'Refund']);
    expect(summary.totalCredits).toBe(500);
    expect(summary.totalDebits).toBe(350);
    expect(summary.closingBalance).toBe(-150);
  });

  it('one payment voucher across multiple cases → one line per case, only allocated amount', () => {
    const voucher = 'PAY-2026-0050';
    const { rows, summary } = buildLedgerReport({
      cases: [caseInfo('DS-0001'), caseInfo('DS-0002')],
      invoices: [{ invoice_number: 'INV-0001', case_number: 'DS-0001' }, { invoice_number: 'INV-0002', case_number: 'DS-0002' }],
      paymentAllocations: new Map([[voucher, [{ invoiceNumber: 'INV-0001', caseNumber: 'DS-0001', amount: 600 }, { invoiceNumber: 'INV-0002', caseNumber: 'DS-0002', amount: 400 }]]]),
      entries: [
        { id: 'i1', date: '2026-01-01', posted_at: '2026-01-01T09:00:00Z', entry_type: 'invoice', reference_id: 'i1', reference_number: 'INV-0001', case_number: 'DS-0001', description: '', debit: 600, credit: 0 },
        { id: 'i2', date: '2026-01-01', posted_at: '2026-01-01T09:30:00Z', entry_type: 'invoice', reference_id: 'i2', reference_number: 'INV-0002', case_number: 'DS-0002', description: '', debit: 400, credit: 0 },
        // slices of ONE voucher (this app's allocation convention) — same base voucher number
        { id: 's1', date: '2026-01-02', posted_at: '2026-01-02T09:00:00Z', entry_type: 'payment', reference_id: 's1', reference_number: `${voucher}-1`, case_number: 'DS-0001', description: 'Payment received for INV-0001', debit: 0, credit: 600 },
        { id: 's2', date: '2026-01-02', posted_at: '2026-01-02T09:00:01Z', entry_type: 'payment', reference_id: 's2', reference_number: `${voucher}-2`, case_number: 'DS-0002', description: 'Payment received for INV-0002', debit: 0, credit: 400 },
      ],
    });
    const pays = rows.filter((r) => r.type === 'payment');
    expect(pays).toHaveLength(2); // not merged
    expect(pays.map((p) => p.voucherNumber)).toEqual([voucher, voucher]);
    expect(pays.map((p) => p.credit)).toEqual([600, 400]);
    expect(pays[0].caseNumber).toBe('DS-0001');
    expect(pays[1].caseNumber).toBe('DS-0002');
    expect(summary.totalCredits).toBe(1000); // full voucher counted once total, not per line
    expect(summary.closingBalance).toBe(0);
    // never duplicate full voucher amount on any line
    expect(pays.every((p) => p.credit < 1000)).toBe(true);
  });

  it('narration keeps full tooth list + shade + patient; no truncation', () => {
    const { rows } = buildLedgerReport(ds92());
    const inv = rows.find((r) => r.type === 'invoice')!;
    expect(inv.teeth).toContain('#25');
    expect(inv.teeth).toContain('#11');
    expect(inv.narration).toContain('Shade: A2');
    expect(inv.narration).toContain('Farzana Yaseen');
    expect(inv.narration).not.toContain('…');
  });

  it('labels receipts from the account holder perspective, by method', () => {
    const { rows } = buildLedgerReport({
      cases: [],
      invoices: [],
      entries: [
        { id: 'p1', date: '2026-01-02', entry_type: 'payment', reference_number: 'PAY-2026-0005', description: 'Payment received for INV-0001 via CASH', payment_method: 'cash', debit: 0, credit: 2000 },
        { id: 'p2', date: '2026-01-03', entry_type: 'payment', reference_number: 'PAY-2026-0006', description: 'Payment received for INV-0001 via BANK', payment_method: 'bank', debit: 0, credit: 1000 },
      ],
    });
    expect(rows.map((r) => r.typeLabel)).toEqual(['Cash Receipt', 'Bank Receipt']);
    expect(rows[0].narration).toContain('Cash Receipt');
  });

  it('uses the invoice procedure, and distinguishes wording differences from a real clinical mismatch', () => {
    const { rows } = buildLedgerReport({
      cases: [
        { case_number: 'DS-0581', case_id: 'c1', case_type_name: 'Zirconia' },
        { case_number: 'DS-0002', case_id: 'c2', case_type_name: 'lower Night Guard' },
      ],
      invoices: [
        { id: 'i1', invoice_number: 'INV-1187', case_number: 'DS-0581', case_id: 'c1', case_type_name: 'Acrylic Denture' },
        { id: 'i2', invoice_number: 'INV-0048', case_number: 'DS-0002', case_id: 'c2', case_type_name: 'Night Guard' },
      ],
      entries: [
        { id: 'i1', date: '2026-11-11', entry_type: 'invoice', reference_id: 'i1', reference_number: 'INV-1187', case_number: 'DS-0581', debit: 5000, credit: 0 },
        { id: 'i2', date: '2026-11-12', entry_type: 'invoice', reference_id: 'i2', reference_number: 'INV-0048', case_number: 'DS-0002', debit: 2000, credit: 0 },
      ],
    });
    const real = rows.find((r) => r.caseNumber === 'DS-0581')!;
    expect(real.procedure).toBe('Acrylic Denture');
    expect(real.clinicalMismatch).toBe(true);
    expect(real.narration).toContain('Invoice for Acrylic Denture');
    expect(real.narration).toContain('Case record: Zirconia — verify');

    const wording = rows.find((r) => r.caseNumber === 'DS-0002')!;
    expect(wording.clinicalMismatch).toBe(false);
    expect(wording.narration).not.toContain('Case record:');
  });

  it('flags posted opening-balance adjustments without moving them into opening', () => {
    const { summary } = buildLedgerReport({
      cases: [],
      invoices: [],
      entries: [
        { id: 'd1', date: '2026-09-01', entry_type: 'debit_adjustment', reference_number: 'DR-0003', description: 'Debit Adjustment: opening balance', debit: 40000, credit: 0 },
        { id: 'd2', date: '2026-09-30', entry_type: 'debit_adjustment', reference_number: 'DR-0001', description: 'Debit Adjustment: opening balance', debit: 28000, credit: 0 },
        { id: 'c1', date: '2026-10-14', entry_type: 'credit_note', reference_number: 'CR-0001', description: 'Credit Note: opening balance payment', debit: 0, credit: 40000 },
      ],
    });
    expect(summary.openingBalance).toBe(0);
    expect(summary.openingBalanceReview?.map((r) => r.voucherNumber)).toEqual(['DR-0003', 'DR-0001', 'CR-0001']);
    expect(summary.totalDebits).toBe(68000);
    expect(summary.totalCredits).toBe(40000);
    expect(summary.closingBalance).toBe(28000);
  });

  it('reconciles a 49-transaction ledger exactly once, with no missing postings', () => {
    const invoiceAmounts = [...Array(30).fill(10000), 9500];
    const paymentAmounts = [...Array(14).fill(10000), 21000];
    const entries: BuildLedgerReportInput['entries'] = [
      ...invoiceAmounts.map((amount, i) => ({ id: `inv-${i}`, date: '2026-10-01', entry_type: 'invoice', reference_id: `inv-${i}`, reference_number: `INV-${String(i + 1).padStart(4, '0')}`, debit: amount, credit: 0 })),
      ...paymentAmounts.map((amount, i) => ({ id: `pay-${i}`, date: '2026-10-15', entry_type: 'payment', reference_id: `pay-${i}`, reference_number: `PAY-2026-${String(i + 1).padStart(4, '0')}`, payment_method: 'cash', debit: 0, credit: amount })),
      { id: 'dr1', date: '2026-09-01', entry_type: 'debit_adjustment', reference_number: 'DR-0003', description: 'Debit Adjustment: opening balance', debit: 40000, credit: 0 },
      { id: 'dr2', date: '2026-09-30', entry_type: 'debit_adjustment', reference_number: 'DR-0001', description: 'Debit Adjustment: opening balance', debit: 28000, credit: 0 },
      { id: 'cr1', date: '2026-10-14', entry_type: 'credit_note', reference_number: 'CR-0001', description: 'Credit Note: opening balance payment', debit: 0, credit: 40000 },
    ];
    const { rows, summary } = buildLedgerReport({ entries, cases: [], invoices: [] });
    expect(rows).toHaveLength(49);
    expect(new Set(rows.map((r) => r.id)).size).toBe(49);
    expect(summary.transactionCount).toBe(49);
    expect(summary.openingBalance).toBe(0);
    expect(summary.totalDebits).toBe(377500);
    expect(summary.totalCredits).toBe(201000);
    expect(summary.closingBalance).toBe(176500);
    expect(rows[rows.length - 1].balance).toBe(176500);
  });
});

describe('classifyPayments', () => {
  it('marks partial vs final settlement from real postings', () => {
    const { rows } = buildLedgerReport(ds92());
    const notes = classifyPayments(rows, new Map([['INV-0092', 3000]]));
    expect(notes.get('p1')).toBe('Partial payment');
    expect(notes.get('p2')).toBe('Final settlement');
  });
});

describe('money arithmetic', () => {
  it('no floating point drift', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
  });
});
