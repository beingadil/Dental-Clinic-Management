/**
 * Standalone runtime verification for the payment-numbering fix and the
 * syncCore duplicate-number healer. Runs on plain Node via a tsc-only compile
 * (no Vite/esbuild), so it works even in environments where the vitest pool
 * cannot spawn.
 *
 * Re-run:
 *   npx tsc src/services/transactionDomain.ts src/db/syncCore.ts src/db/core.ts src/db/engine.ts ^
 *     --outDir .tmp-verify --rootDir src --module commonjs --moduleResolution node ^
 *     --target es2022 --lib es2022,dom --esModuleInterop --skipLibCheck
 *   node .planning/payment-number-fix/verify-numbering.cjs
 */
const assert = require('node:assert');
const path = require('node:path');

const compiled = (rel) => path.join(process.cwd(), '.tmp-verify', rel);

async function main() {
  // ── 1. numbering: slices, deletions, mixed formats, advances, receipts ──
  const { prepareTransaction, prepareAdvanceDeposit } = require(compiled('services/transactionDomain.js'));
  const { maxDocumentSeq, nextPaymentNumber } = require(compiled('services/ledgerDomain.js'));

  const YEAR = new Date().getFullYear();
  const inv = (over = {}) => ({
    id: 'inv-1', invoice_number: 'INV-0001', lab_id: 'lab-1', lab_name: 'Clinic One',
    amount: 1000, discount: 0, final_amount: 1000, amount_paid: 0, payment_status: 'unpaid',
    status_v2: 'open', payments: [], created_at: '2026-09-01', ...over,
  });
  const invoices = [inv(), inv({ id: 'inv-2', invoice_number: 'INV-0002' })];
  const base = { clinicId: 'lab-1', method: 'cash', date: '2026-10-01' };

  const multi = prepareTransaction({
    command: { ...base, amount: 300, allocations: [{ invoiceId: 'inv-1', amount: 200 }, { invoiceId: 'inv-2', amount: 100 }] },
    invoices, existingPaymentNumbers: [], existingAdvanceNumbers: [], existingReceiptNumbers: [],
    labName: 'Clinic One', actor: 'Cashier', paymentId: 'p1',
  });
  const sliceNumbers = multi.invoiceSlices.map((s) => s.payment.payment_number);
  assert.deepStrictEqual(sliceNumbers, [`PAY-${YEAR}-0001-1`, `PAY-${YEAR}-0001-2`], 'slice numbers must be unique');
  console.log('ok  multi-invoice slices are unique:', sliceNumbers.join(', '));

  const gap = prepareTransaction({
    command: { ...base, amount: 100, allocations: [{ invoiceId: 'inv-1', amount: 100 }] },
    invoices, existingPaymentNumbers: ['PAY-2026-0003', 'PAY-2026-0005', 'PAY-0002'],
    existingAdvanceNumbers: [], existingReceiptNumbers: [],
    labName: 'Clinic One', actor: 'Cashier', paymentId: 'p2',
  });
  assert.strictEqual(gap.paymentNumber, 'PAY-2026-0006', 'sequence must continue past the max, not the count');
  console.log('ok  numbering continues past a deletion gap:', gap.paymentNumber);

  const adv = prepareAdvanceDeposit({
    command: { clinicId: 'lab-1', amount: 500, method: 'cash', date: '2026-10-01' },
    existingAdvanceNumbers: ['ADV-2026-0004', 'ADV-0002'], existingReceiptNumbers: ['REC-2026-0007'],
    labName: 'Clinic One', actor: 'Cashier', advanceId: 'a1',
  });
  assert.strictEqual(adv.advance.payment_number, 'ADV-2026-0005');
  assert.strictEqual(adv.receiptNumber, 'REC-2026-0008');
  console.log('ok  advance + receipt sequences are max-based:', adv.advance.payment_number, adv.receiptNumber);

  const rem = prepareTransaction({
    command: { ...base, amount: 500, allocations: [{ invoiceId: 'inv-1', amount: 300 }], saveRemainingAsAdvance: true },
    invoices, existingPaymentNumbers: ['PAY-2026-0009'], existingAdvanceNumbers: ['ADV-2026-0002'],
    existingReceiptNumbers: ['REC-2026-0001'], labName: 'Clinic One', actor: 'Cashier', paymentId: 'p3',
  });
  assert.strictEqual(rem.remainderAdvance.payment_number, 'ADV-2026-0003');
  assert.strictEqual(maxDocumentSeq(['PAY-2026-0009', 'PAY-0003', 'PAY-2026-0009-2', ''], 'PAY'), 9);
  assert.strictEqual(maxDocumentSeq(['PAY-0012-1', 'PAY-0012-2'], 'PAY'), 12, 'bulk slice base, not the slice index');
  assert.strictEqual(maxDocumentSeq([`PAY-${YEAR}-0001-1`, `PAY-${YEAR}-0001-2`], 'PAY'), 1, 'split receipt base is consumed');
  assert.strictEqual(nextPaymentNumber([inv({ payments: [{ payment_number: 'PAY-2026-0009' }] })]), 'PAY-0010');
  const afterSplit = prepareTransaction({
    command: { ...base, amount: 100, allocations: [{ invoiceId: 'inv-1', amount: 100 }] },
    invoices, existingPaymentNumbers: [`PAY-${YEAR}-0001-1`, `PAY-${YEAR}-0001-2`],
    existingAdvanceNumbers: [], existingReceiptNumbers: [],
    labName: 'Clinic One', actor: 'Cashier', paymentId: 'p4',
  });
  assert.strictEqual(afterSplit.paymentNumber, `PAY-${YEAR}-0002`, 'next payment must not re-mint the split base');
  console.log('ok  remainder advance + legacy generator:', rem.remainderAdvance.payment_number);

  // ── 2. syncCore healing: duplicate numbers must persist, not abort ──
  const initSqlJs = require('sql.js');
  const { SqliteEngine } = require(compiled('db/engine.js'));
  const { setDatabase } = require(compiled('db/core.js'));
  const { syncCollectionsToDb, getLastSyncError } = require(compiled('db/syncCore.js'));

  const SQL = await initSqlJs();
  const eng = await SqliteEngine.create(SQL, null);
  eng.migrate();
  setDatabase(eng);

  const payment = (id, n, amount) => ({
    id, payment_number: n, receipt_number: 'REC-2026-0001', amount, payment_method: 'cash',
    payment_date: '2026-09-28', recorded_by: 'Tester', created_at: '2026-09-28T09:00',
  });
  const invoice = (id, num, payments) => ({
    id, invoice_number: num, lab_id: 'lab-1', lab_name: 'Test Clinic', amount: 1000, discount: 0,
    final_amount: 1000, amount_paid: payments.reduce((s, p) => s + p.amount, 0),
    payment_status: 'partial', status_v2: 'partially_paid', created_at: '2026-09-28T09:00', payments,
  });
  const advance = (id, n, amount, method) => ({
    id, payment_number: n, lab_id: 'lab-1', lab_name: 'Test Clinic', amount, allocated_amount: 0,
    remaining_amount: amount, payment_method: method, payment_date: '2026-09-28', recorded_by: 'Tester',
    status: 'available', attachments: [],
  });

  syncCollectionsToDb({
    users: [], labs: [{ id: 'lab-1', name: 'Test Clinic', created_at: '2026-09-28T09:00' }],
    caseTypes: [], cases: [],
    invoices: [
      invoice('inv-1', 'INV-0001', [payment('pay-1', 'PAY-2026-0001', 300), payment('pay-2', 'PAY-2026-0001', 200)]),
      invoice('inv-2', 'INV-0002', []),
    ],
    advancePayments: [advance('adv-1', 'ADV-2026-0001', 500, 'cash'), advance('adv-2', 'ADV-2026-0001', 700, 'bank')],
    accountAdjustments: [], journalEntries: [], reconciliationItems: [], notifications: [],
    savedVouchers: [], auditEvents: [], templates: [], labContacts: [], labAddresses: [],
    pricingOverrides: [], labReviews: [], caseNotes: {}, caseAttachments: {}, qcInspections: [],
    doctorPreferences: [],
  });
  await new Promise((resolve) => setTimeout(resolve, 500)); // flush the 150ms debounce

  assert.strictEqual(getLastSyncError(), null, `sync must succeed, got: ${getLastSyncError()}`);
  const payNums = eng.all('SELECT payment_number AS n FROM payments ORDER BY payment_number').map((r) => r.n);
  assert.strictEqual(payNums.length, 2, 'no payment row may be dropped');
  assert.strictEqual(new Set(payNums).size, 2, 'payment numbers must be unique in the DB');
  assert.ok(payNums.includes('PAY-2026-0001') && payNums.includes('PAY-2026-0001-D2'), payNums.join(','));
  const advNums = eng.all('SELECT payment_number AS n FROM advance_payments ORDER BY payment_number').map((r) => r.n);
  assert.strictEqual(advNums.length, 2, 'no advance row may be dropped');
  assert.strictEqual(new Set(advNums).size, 2, 'advance numbers must be unique in the DB');
  console.log('ok  sync healed duplicates instead of aborting:', payNums.join(', '), '|', advNums.join(', '));

  // ── 3. case/invoice/QC healing on a second sync round ──
  const caseRow = (id, num, teeth) => ({
    id, case_number: num, lab_id: 'lab-1', lab_name: 'Test Clinic', doctor_name: 'Dr. T',
    selected_teeth: teeth, delivery_date: '2026-10-01', status: 'received',
    created_at: '2026-09-28T09:00', updated_at: '2026-09-28T09:00', history: [],
  });
  syncCollectionsToDb({
    users: [], labs: [{ id: 'lab-1', name: 'Test Clinic', created_at: '2026-09-28T09:00' }],
    caseTypes: [],
    cases: [caseRow('case-1', 'DS-0001', [16, 16, 17]), caseRow('case-2', 'DS-0001', [])],
    invoices: [invoice('inv-1', 'INV-0001', []), invoice('inv-2', 'INV-0001', [])],
    advancePayments: [], accountAdjustments: [], journalEntries: [], reconciliationItems: [],
    notifications: [], savedVouchers: [], auditEvents: [], templates: [], labContacts: [],
    labAddresses: [], pricingOverrides: [], labReviews: [], caseNotes: {}, caseAttachments: {},
    qcInspections: [
      { id: 'qc-1', case_id: 'case-2', inspection_no: 1, kind: 'inspection', result: 'pass', inspector: 'T', dedupe_key: 'qc-case2-1', created_at: '2026-09-28T09:00' },
      { id: 'qc-2', case_id: 'case-gone', inspection_no: 1, kind: 'inspection', result: 'pass', inspector: 'T', dedupe_key: 'qc-orphan-1', created_at: '2026-09-28T09:00' },
    ],
    doctorPreferences: [],
  });
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.strictEqual(getLastSyncError(), null, `second sync must succeed, got: ${getLastSyncError()}`);
  const caseNums = eng.all('SELECT case_number AS n FROM cases ORDER BY case_number').map((r) => r.n);
  assert.deepStrictEqual(caseNums, ['DS-0001', 'DS-0001-D2']);
  const invoiceNums = eng.all('SELECT invoice_number AS n FROM invoices ORDER BY invoice_number').map((r) => r.n);
  assert.deepStrictEqual(invoiceNums, ['INV-0001', 'INV-0001-D2']);
  const teeth = eng.all('SELECT tooth_number AS n FROM case_teeth ORDER BY tooth_number').map((r) => r.n);
  assert.deepStrictEqual(teeth, [16, 17]);
  const qcCount = eng.all('SELECT COUNT(*) AS n FROM qc_inspections')[0].n;
  assert.strictEqual(qcCount, 1, 'orphan QC row must be skipped, live row kept');
  console.log('ok  cases/invoices healed, teeth deduped, orphan QC skipped');

  console.log('\nALL NUMBERING + SYNC-HEAL CHECKS PASSED');
}

main().catch((e) => {
  console.error('HARNESS FAILED:', (e && e.stack) || e);
  process.exit(1);
});
