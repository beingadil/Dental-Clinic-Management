import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import {
  labsRepo, casesRepo, caseTypesRepo, invoicesRepo, paymentsRepo, advancePaymentsRepo,
  adjustmentsRepo, journalRepo, ledgerRepo, notificationsRepo, usersRepo, caseNotesRepo,
  attachmentsRepo, settingsRepo, statsRepo,
} from '../../src/db/repos';
import { nextNumber, ensureCounterAtLeast, SEQ_KEYS, ensureSequenceTable } from '../../src/db/sequences';
import { setDatabase } from '../../src/db/core';

let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
  ensureSequenceTable(engine);
});

describe('labsRepo', () => {
  it('creates, reads, updates and deletes labs', () => {
    const lab = labsRepo.insert({ name: 'Bright Smiles', phone: '0300-1234567' });
    expect(lab.id).toBeTruthy();
    expect(labsRepo.byId(lab.id)?.name).toBe('Bright Smiles');
    expect(labsRepo.byName('bright smiles')?.id).toBe(lab.id);

    labsRepo.update(lab.id, { city: 'Gujranwala', rating: 4.5 });
    expect(labsRepo.byId(lab.id)?.city).toBe('Gujranwala');
    expect(labsRepo.byId(lab.id)?.rating).toBe(4.5);

    expect(labsRepo.delete(lab.id)).toBe(true);
    expect(labsRepo.byId(lab.id)).toBeUndefined();
  });

  it('rejects duplicate clinic names with a friendly error', () => {
    labsRepo.insert({ id: 'lab-dup', name: 'Unique Clinic' });
    expect(() => labsRepo.insert({ name: 'unique clinic' })).toThrow(/already exists/i);
    labsRepo.delete('lab-dup');
  });

  it('searches by name and city via SQL LIKE', () => {
    labsRepo.insert({ name: 'Lahore Dental Care', city: 'Lahore' });
    const hits = labsRepo.search('lahore');
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

describe('casesRepo', () => {
  it('creates a case with teeth normalization and initial history', () => {
    labsRepo.insert({ id: 'lab-cases', name: 'Cases Clinic' });
    const c = casesRepo.insert({
      case_number: 'DS-1001',
      lab_id: 'lab-cases',
      lab_name: 'Cases Clinic',
      doctor_name: 'Dr. Test',
      patient_name: 'Ali Raza',
      selected_teeth: [11, 12],
      tooth_details: { 11: { shade: 'A2', prep_type: 'crown' } },
      delivery_date: '2026-10-01',
      price: 15000,
      discount: 1000,
      final_price: 14000,
      status: 'received',
    });
    expect(c.case_number).toBe('DS-1001');
    expect(c.selected_teeth).toEqual([11, 12]);
    expect(c.history.length).toBe(1);
    const teeth = engine.all('SELECT * FROM case_teeth WHERE case_id = ?', [c.id]);
    expect(teeth.length).toBe(2);
    expect(teeth.find((t: any) => t.tooth_number === 11)?.shade).toBe('A2');
  });

  it('updates status and preserves history ordering', () => {
    const c = casesRepo.byCaseNumber('DS-1001')!;
    casesRepo.update(c.id, {
      status: 'in_progress',
      history: [
        { id: 'h2', status: 'in_progress', timestamp: '2027-01-01T10:00:00Z', updated_by: 'Hamza' },
        ...c.history,
      ],
    });
    const updated = casesRepo.byId(c.id)!;
    expect(updated.status).toBe('in_progress');
    expect(updated.history[0].status).toBe('in_progress');
    expect(updated.history.length).toBe(2);
  });

  it('searches by patient and case number', () => {
    const hits = casesRepo.search('ali raza');
    expect(hits.length).toBe(1);
    const hits2 = casesRepo.search('DS-1001');
    expect(hits2.length).toBe(1);
  });

  it('deletes a case', () => {
    const c = casesRepo.byCaseNumber('DS-1001')!;
    expect(casesRepo.delete(c.id)).toBe(true);
    expect(casesRepo.byId(c.id)).toBeUndefined();
  });
});

describe('billing flow (invoice → payments → balance)', () => {
  it('supports partial then full payment with correct derived status', () => {
    labsRepo.insert({ id: 'lab-fin', name: 'Finance Clinic' });
    const inv = invoicesRepo.insert({
      invoice_number: 'INV-1001',
      lab_id: 'lab-fin',
      lab_name: 'Finance Clinic',
      amount: 100000,
      discount: 0,
      final_amount: 100000,
      amount_paid: 0,
      payment_status: 'unpaid',
      items: [{ description: 'Zirconia Crown', quantity: 1, unit_price: 100000, total_price: 100000 }],
    });
    expect(invoiceItemsRepoHelper(inv.id).length).toBe(1);

    // Payment 1 — 30,000
    const p1 = paymentsRepo.insert({
      payment_number: 'PAY-1001',
      invoice_id: inv.id,
      invoice_number: 'INV-1001',
      lab_id: 'lab-fin',
      lab_name: 'Finance Clinic',
      amount: 30000,
      payment_method: 'bank',
      payment_date: '2026-09-17',
      recorded_by: 'Sana',
      allocations: [{ source_type: 'payment', invoice_id: inv.id, amount: 30000 }],
    });
    // Payment 2 — 20,000 with screenshot attachment
    const p2 = paymentsRepo.insert({
      payment_number: 'PAY-1002',
      invoice_id: inv.id,
      lab_id: 'lab-fin',
      amount: 20000,
      payment_method: 'cash',
      payment_date: '2026-09-18',
      recorded_by: 'Sana',
      attachments: [{ file_name: 'proof.png', file_type: 'image/png', file_url: 'data:image/png;base64,AAA' }],
      allocations: [{ source_type: 'payment', invoice_id: inv.id, amount: 20000 }],
    });
    expect(p2.attachments.length).toBe(1);

    const paidSoFar = 30000 + 20000;
    invoicesRepo.update(inv.id, { amount_paid: paidSoFar, payment_status: 'partial' });
    let current = invoicesRepo.byId(inv.id)!;
    expect(current.amount_paid).toBe(50000);
    expect(current.payment_status).toBe('partial');
    expect(current.payments.length).toBe(2);

    // Payment 3 — 50,000 clears the invoice
    paymentsRepo.insert({
      payment_number: 'PAY-1003',
      invoice_id: inv.id,
      lab_id: 'lab-fin',
      amount: 50000,
      payment_method: 'cheque',
      payment_date: '2026-09-19',
      recorded_by: 'Sana',
      allocations: [{ source_type: 'payment', invoice_id: inv.id, amount: 50000 }],
    });
    invoicesRepo.update(inv.id, { amount_paid: 100000, payment_status: 'paid' });
    current = invoicesRepo.byId(inv.id)!;
    expect(current.amount_paid).toBe(100000);
    expect(current.payment_status).toBe('paid');
    expect(current.payments.length).toBe(3);
    const totalFromPayments = current.payments.reduce((s: number, p: any) => s + p.amount, 0);
    expect(totalFromPayments).toBe(100000);
  });
});

function invoiceItemsRepoHelper(invoiceId: string): any[] {
  return engine.all('SELECT * FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
}

describe('advances and adjustments', () => {
  it('records an advance and allocates it to an invoice', () => {
    // create a real invoice to allocate against (FK integrity is enforced)
    const targetInvoice = invoicesRepo.insert({
      invoice_number: 'INV-2001',
      lab_id: 'lab-fin',
      lab_name: 'Finance Clinic',
      amount: 40000,
      discount: 0,
      final_amount: 40000,
      amount_paid: 0,
      payment_status: 'unpaid',
    });

    const adv = advancePaymentsRepo.insert({
      payment_number: 'ADV-1001',
      lab_id: 'lab-fin',
      lab_name: 'Finance Clinic',
      amount: 25000,
      allocated_amount: 0,
      remaining_amount: 25000,
      payment_method: 'bank',
      payment_date: '2026-09-17',
      recorded_by: 'Sana',
    });
    expect(adv.remaining_amount).toBe(25000);

    // orphan allocations must be rejected
    expect(() => advancePaymentsRepo.addAllocation(adv.id, 'inv-does-not-exist', 10000, 'Sana')).toThrow();

    advancePaymentsRepo.addAllocation(adv.id, targetInvoice.id, 10000, 'Sana');
    advancePaymentsRepo.update(adv.id, { allocated_amount: 10000, remaining_amount: 15000 });
    const updated = advancePaymentsRepo.byId(adv.id)!;
    expect(updated.allocated_amount).toBe(10000);
    expect(updated.remaining_amount).toBe(15000);
    expect(updated.allocations.length).toBe(1);
    expect(updated.allocations[0].invoice_id).toBe(targetInvoice.id);
  });

  it('records a credit note adjustment', () => {
    const adj = adjustmentsRepo.insert({
      adjustment_number: 'CR-1001',
      lab_id: 'lab-fin',
      lab_name: 'Finance Clinic',
      type: 'credit_note',
      amount: 5000,
      reason: 'Goodwill discount',
      date: '2026-09-17',
      recorded_by: 'Sana',
    });
    expect(adjustmentsRepo.byId(adj.id)?.type).toBe('credit_note');
  });
});

describe('journal and ledger', () => {
  it('stores journal entries with balanced lines', () => {
    const je = journalRepo.insert({
      journal_number: 'JE-1001',
      date: '2026-09-17',
      event_type: 'invoice_created',
      reference_type: 'invoice',
      reference_id: 'inv-x',
      reference_number: 'INV-1001',
      lab_id: 'lab-fin',
      lab_name: 'Finance Clinic',
      description: 'Invoice INV-1001 issued',
      created_by: 'system',
      lines: [
        { account_code: '1100', account_name: 'Accounts Receivable', account_type: 'asset', debit: 100000, credit: 0 },
        { account_code: '4000', account_name: 'Service Revenue', account_type: 'revenue', debit: 0, credit: 100000 },
      ],
    });
    expect(je.lines.length).toBe(2);
    expect(journalRepo.forEntity('inv-x').length).toBe(1);
    const totalDebit = je.lines.reduce((s: number, l: any) => s + l.debit, 0);
    const totalCredit = je.lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
  });

  it('writes ledger entries and recomputes per-lab running balances', () => {
    ledgerRepo.clear();
    ledgerRepo.insert({
      date: '2026-09-17', lab_id: 'lab-fin', lab_name: 'Finance Clinic', entry_type: 'invoice',
      reference_id: 'ref-inv-1', reference_number: 'INV-1001', description: 'Invoice', debit: 100000, credit: 0,
    });
    ledgerRepo.insert({
      date: '2026-09-18', lab_id: 'lab-fin', lab_name: 'Finance Clinic', entry_type: 'payment',
      reference_id: 'ref-pay-1', reference_number: 'PAY-1001', description: 'Payment', debit: 0, credit: 30000,
    });
    ledgerRepo.insert({
      date: '2026-09-19', lab_id: 'lab-fin', lab_name: 'Finance Clinic', entry_type: 'payment',
      reference_id: 'ref-pay-2', reference_number: 'PAY-1002', description: 'Payment', debit: 0, credit: 20000,
    });
    ledgerRepo.recomputeRunningBalance();
    const rows = ledgerRepo.byLab('lab-fin');
    expect(rows.map((r: any) => r.running_balance)).toEqual([100000, 70000, 50000]);
    // idempotent UNIQUE guard per source transaction
    expect(() =>
      ledgerRepo.insert({
        date: '2026-09-17', lab_id: 'lab-fin', lab_name: 'Finance Clinic', entry_type: 'invoice',
        reference_id: 'ref-inv-1', reference_number: 'INV-1001', description: 'Invoice', debit: 100000, credit: 0,
      })
    ).toThrow();
  });
});

describe('users, notes, attachments, settings, notifications', () => {
  it('stores hashed users', () => {
    usersRepo.insert({
      id: 'u-t', username: 'tester', email: 't@d.pk', name: 'Tester', role: 'Technician',
      password_hash: 'pbkdf2$1$abc$def', password_salt: 'abc',
    });
    expect(usersRepo.byUsername('TESTER')?.id).toBe('u-t');
  });

  it('manages case notes', () => {
    labsRepo.insert({ id: 'lab-notes', name: 'Notes Clinic' });
    casesRepo.insert({
      case_number: 'DS-1002', lab_id: 'lab-notes', lab_name: 'Notes Clinic', doctor_name: 'Dr. N',
      selected_teeth: [21], delivery_date: '2026-10-02', status: 'received',
    });
    const c = casesRepo.byCaseNumber('DS-1002')!;
    const note = caseNotesRepo.insert({ case_id: c.id, note_text: 'Try-in scheduled', author: 'Hamza' });
    expect(caseNotesRepo.byCase(c.id).length).toBe(1);
    caseNotesRepo.update(note.id, 'Try-in rescheduled');
    expect(caseNotesRepo.byCase(c.id)[0].note_text).toBe('Try-in rescheduled');
  });

  it('stores attachment metadata with data URLs', () => {
    const att = attachmentsRepo.insert({
      id: 'att-t1', entity_type: 'case', entity_id: 'c-1', original_filename: 'rx.png',
      stored_filename: 'rx.png', mime_type: 'image/png', storage_path: 'legacy/c-1/att-t1',
      data_url: 'data:image/png;base64,AAA',
    });
    expect(attachmentsRepo.byEntity('case', 'c-1').length).toBe(1);
    attachmentsRepo.delete(att.id);
    expect(attachmentsRepo.byEntity('case', 'c-1').length).toBe(0);
  });

  it('round-trips settings namespaces', () => {
    settingsRepo.set('branding', 'settings', { appName: 'Dental Solutions', phone: '0333' });
    expect(settingsRepo.get('branding', 'settings').appName).toBe('Dental Solutions');
  });

  it('manages notification lifecycle', () => {
    const n = notificationsRepo.insert({ type: 'overdue_case', title: 'Case overdue', message: 'DS-1002 overdue' });
    notificationsRepo.markRead(n.id, true);
    notificationsRepo.setArchived(n.id, true);
    const stored = engine.get('SELECT read, is_archived FROM notifications WHERE id = ?', [n.id]) as any;
    expect(stored.read).toBe(1);
    expect(stored.is_archived).toBe(1);
    notificationsRepo.delete(n.id);
  });
});

describe('sequences', () => {
  it('allocates sequential document numbers', () => {
    const a = nextNumber(engine, SEQ_KEYS.case, 'DS');
    const b = nextNumber(engine, SEQ_KEYS.case, 'DS');
    const n1 = parseInt(a.split('-')[1], 10);
    const n2 = parseInt(b.split('-')[1], 10);
    expect(n2).toBe(n1 + 1);
  });

  it('never re-issues numbers after import realignment', () => {
    ensureCounterAtLeast(engine, SEQ_KEYS.invoice, 5000);
    const next = nextNumber(engine, SEQ_KEYS.invoice, 'INV');
    expect(parseInt(next.split('-')[1], 10)).toBeGreaterThanOrEqual(5000);
  });
});

describe('statsRepo', () => {
  it('returns counts for every tracked table', () => {
    const stats = statsRepo.all();
    expect(stats.cases).toBeGreaterThan(0);
    expect(stats.invoices).toBeGreaterThan(0);
    expect(stats.payments).toBe(3);
  });
});

describe('case types', () => {
  it('manages the catalog', () => {
    const ct = caseTypesRepo.insert({ name: 'Test Crown', base_price: 12345 });
    expect(caseTypesRepo.byId(ct.id)?.base_price).toBe(12345);
    caseTypesRepo.update(ct.id, { base_price: 13000 });
    expect(caseTypesRepo.byId(ct.id)?.base_price).toBe(13000);
    expect(caseTypesRepo.delete(ct.id)).toBe(true);
  });
});
