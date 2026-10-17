import { describe, it, expect, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { syncCollectionsToDb, getLastSyncError, type SyncCollections } from '../../src/db/syncCore';

/**
 * Reversal is GONE, and the migration that removes it does two jobs:
 *
 *  1. Drops the four reversal columns from all three money tables.
 *  2. Sweeps the orphan journals the dead concept left behind.
 *
 * Part 2 is the one that mattered in the field. Deleting a case voided its
 * invoice and wrote a compensating "reversal" journal while KEEPING the
 * original. The invoice row was removed; both journal rows stayed behind
 * pointing at it. Because syncCore rebuilds the journal tables wholesale from
 * memory on every save, the pair was re-inserted forever — two entries for one
 * deleted invoice that came back after every restart. That is the "technical
 * glitch", and these tests exist so it cannot come back.
 */

const MONEY_TABLES = ['payments', 'advance_payments', 'account_adjustments'];
const REVERSAL_COLUMNS = ['is_reversed', 'reversal_reason', 'reversed_at', 'reversed_by'];

async function migratedEngine() {
  const SQL = await initSqlJs();
  const eng = await SqliteEngine.create(SQL, null);
  eng.migrate();
  return eng;
}

function columnsOf(eng: SqliteEngine, table: string): string[] {
  return eng.all<{ name: string }>(`PRAGMA table_info("${table}")`).map((r) => String(r.name));
}

describe('reversal columns are gone from the schema', () => {
  it('drops all four columns from every money table', async () => {
    const eng = await migratedEngine();
    for (const table of MONEY_TABLES) {
      const cols = columnsOf(eng, table);
      for (const gone of REVERSAL_COLUMNS) {
        expect(cols, `${table} still has ${gone}`).not.toContain(gone);
      }
    }
  });

  it('leaves every other column of those tables intact', async () => {
    /* A rebuild that quietly dropped a working column would be worse than the
       bug it fixes, so the surviving shape is pinned explicitly. */
    const eng = await migratedEngine();
    expect(columnsOf(eng, 'payments')).toEqual([
      'id', 'payment_number', 'receipt_number', 'invoice_id', 'invoice_number',
      'case_id', 'case_number', 'lab_id', 'lab_name', 'amount', 'payment_method',
      'payment_date', 'reference_number', 'notes', 'recorded_by', 'payment_type',
      'advance_payment_id', 'status', 'unapplied_amount', 'journal_id', 'created_at',
    ]);
    expect(columnsOf(eng, 'advance_payments')).toEqual([
      'id', 'payment_number', 'receipt_number', 'lab_id', 'lab_name', 'amount',
      'allocated_amount', 'remaining_amount', 'payment_method', 'payment_date',
      'reference_number', 'notes', 'recorded_by', 'status', 'journal_id', 'created_at',
    ]);
    expect(columnsOf(eng, 'account_adjustments')).toEqual([
      'id', 'adjustment_number', 'credit_note_number', 'lab_id', 'lab_name', 'type',
      'amount', 'reason', 'date', 'reference_number', 'invoice_id', 'invoice_number',
      'notes', 'recorded_by', 'approved_by', 'status', 'journal_id', 'created_at',
    ]);
  });

  it('keeps the constraints that protect the money columns', async () => {
    /* The rebuild is only allowed to lose the reversal columns — not the CHECK
       that forbids a zero payment, or the one that pins the method vocabulary. */
    const eng = await migratedEngine();
    const ddl = (t: string) => String(eng.get<any>(`SELECT sql FROM sqlite_master WHERE name = '${t}'`)?.sql ?? '');
    expect(ddl('payments')).toMatch(/amount REAL NOT NULL CHECK \(amount > 0\)/);
    expect(ddl('payments')).toMatch(/payment_method IN \('cash','bank','cheque','advance'\)/);
    expect(ddl('payments')).toMatch(/payment_number TEXT UNIQUE/);
    expect(ddl('payments')).toMatch(/FOREIGN KEY \(invoice_id\) REFERENCES invoices\(id\)/);
    expect(ddl('advance_payments')).toMatch(/FOREIGN KEY \(lab_id\) REFERENCES labs\(id\)/);
    expect(ddl('account_adjustments')).toMatch(/FOREIGN KEY \(lab_id\) REFERENCES labs\(id\)/);
  });

  it('keeps the attachment cascade triggers on all three tables', async () => {
    /* DROP TABLE takes a table's triggers with it. Migration 016 built the money
       attachment cascade as triggers rather than FKs (polymorphic owner_type), so
       a rebuild that forgets to restore them silently strands every receipt scan
       and slip on the attachments table. That is the F4 bug, reintroduced. */
    const eng = await migratedEngine();
    const triggers = eng.all<{ name: string; tbl_name: string }>(
      `SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger'`
    );
    const byTable = new Map(triggers.map((t) => [t.tbl_name, t.name]));
    expect(byTable.get('payments'), 'payments cascade trigger').toBeTruthy();
    expect(byTable.get('advance_payments'), 'advance cascade trigger').toBeTruthy();
    expect(byTable.get('account_adjustments'), 'adjustment cascade trigger').toBeTruthy();
  });

  it('keeps the lookup indexes on the rebuilt tables', async () => {
    const eng = await migratedEngine();
    const names = eng
      .all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index'`)
      .map((r) => r.name);
    expect(names).toContain('idx_payments_invoice');
    expect(names).toContain('idx_adv_lab');
  });

  it('no longer accepts a reversal type or a reversed status', async () => {
    const eng = await migratedEngine();
    eng.run(`INSERT INTO labs (id, name, created_at) VALUES ('l1', 'C', '2026-01-01')`);
    const insert = (type: string, status: string) => () =>
      eng.run(
        `INSERT INTO account_adjustments
           (id, adjustment_number, lab_id, lab_name, type, amount, reason, date, recorded_by, status, created_at)
         VALUES (?, ?, 'l1', 'C', ?, 10, 'x', '2026-01-01', 'T', ?, '2026-01-01')`,
        [`adj-${type}-${status}`, `ADJ-${type}-${status}`, type, status]
      );

    expect(insert('reversal', 'posted')).toThrow();
    expect(insert('credit_note', 'reversed')).toThrow();
    // A legitimate adjustment is still accepted.
    expect(insert('credit_note', 'posted')).not.toThrow();
  });
});

describe('orphan journals from the reversal era are swept', () => {
  it('deletes journals whose invoice no longer exists, and their lines', async () => {
    const eng = await migratedEngine();
    // The exact shape the field bug produced: invoice gone, both journals left.
    eng.run(
      `INSERT INTO journal_entries (id, journal_number, date, event_type, reference_type, reference_id, reference_number, description, created_at, created_by)
       VALUES ('j-inv', 'JRN-INV-0096', '2026-10-07', 'invoice_issued', 'invoice', 'inv-gone', 'INV-0096', 'issued', '2026-10-07', 'Mateen')`
    );
    eng.run(
      `INSERT INTO journal_entries (id, journal_number, date, event_type, reference_type, reference_id, reference_number, description, created_at, created_by)
       VALUES ('j-rev', 'JRN-REV-0096', '2026-10-07', 'reversal', 'invoice', 'inv-gone', 'REV-OF-INV-0096', 'REVERSAL', '2026-10-07', 'Mateen')`
    );
    eng.run(`INSERT INTO journal_lines (id, journal_id, account_code, account_name, account_type, debit, credit)
             VALUES ('l-1', 'j-inv', '1100', 'Cash', 'asset', 1000, 0)`);
    eng.run(`INSERT INTO journal_lines (id, journal_id, account_code, account_name, account_type, debit, credit)
             VALUES ('l-2', 'j-rev', '1100', 'Cash', 'asset', 0, 1000)`);

    // Replay the sweep exactly as the migration does.
    runSweep(eng);

    expect(eng.all(`SELECT id FROM journal_entries WHERE id IN ('j-inv','j-rev')`)).toHaveLength(0);
    expect(eng.all(`SELECT id FROM journal_lines WHERE id IN ('l-1','l-2')`)).toHaveLength(0);
  });

  it('keeps a journal whose invoice is still there', async () => {
    /* The sweep must not become a blanket purge of the books. */
    const eng = await migratedEngine();
    eng.run(`INSERT INTO labs (id, name, created_at) VALUES ('l1', 'C', '2026-01-01')`);
    eng.run(
      `INSERT INTO invoices (id, invoice_number, lab_id, lab_name, amount, discount, final_amount, amount_paid, payment_status, status_v2, issue_date, due_date, created_at)
       VALUES ('inv-live', 'INV-0001', 'l1', 'C', 1000, 0, 1000, 0, 'unpaid', 'open', '2026-01-01', '2026-01-15', '2026-01-01')`
    );
    eng.run(
      `INSERT INTO journal_entries (id, journal_number, date, event_type, reference_type, reference_id, reference_number, description, created_at, created_by)
       VALUES ('j-live', 'JRN-INV-0001', '2026-01-01', 'invoice_issued', 'invoice', 'inv-live', 'INV-0001', 'issued', '2026-01-01', 'Mateen')`
    );

    runSweep(eng);

    expect(eng.all(`SELECT id FROM journal_entries WHERE id = 'j-live'`)).toHaveLength(1);
  });

  it('deletes a receipt journal whose payment no longer exists', async () => {
    const eng = await migratedEngine();
    eng.run(
      `INSERT INTO journal_entries (id, journal_number, date, event_type, reference_type, reference_id, reference_number, description, created_at, created_by)
       VALUES ('j-pay', 'JRN-PAY-1', '2026-01-01', 'payment_received', 'payment', 'pay-gone', 'PAY-1', 'received', '2026-01-01', 'Mateen')`
    );
    runSweep(eng);
    expect(eng.all(`SELECT id FROM journal_entries WHERE id = 'j-pay'`)).toHaveLength(0);
  });
});

describe('a synced voucher survives the post-migration rebuild', () => {
  function collections(): SyncCollections {
    return {
      users: [],
      labs: [{ id: 'lab-1', name: 'Test Clinic', created_at: '2026-09-28T09:00' }],
      caseTypes: [], cases: [],
      invoices: [
        {
          id: 'inv-1', invoice_number: 'INV-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
          amount: 1000, discount: 0, final_amount: 1000, amount_paid: 1000,
          payment_status: 'paid', status_v2: 'paid',
          created_at: '2026-09-28T09:00',
          payments: [
            {
              id: 'pay-1', payment_number: 'PAY-2026-0001', receipt_number: 'REC-1',
              amount: 1000, payment_method: 'cheque', payment_date: '2026-09-28',
              recorded_by: 'Tester', created_at: '2026-09-28T09:00', attachments: [],
            },
          ],
        },
      ],
      advancePayments: [
        {
          id: 'adv-1', payment_number: 'ADV-2026-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
          amount: 500, allocated_amount: 0, remaining_amount: 500, payment_method: 'cash',
          payment_date: '2026-09-28', recorded_by: 'Tester', status: 'available',
          attachments: [], allocations: [],
        },
      ],
      accountAdjustments: [
        {
          id: 'adj-1', adjustment_number: 'ADJ-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
          type: 'credit_note', amount: 200, reason: 'Wrong shade', date: '2026-09-28',
          recorded_by: 'Tester', status: 'posted', attachments: [],
        },
      ],
      journalEntries: [], reconciliationItems: [], notifications: [], savedVouchers: [],
      auditEvents: [], templates: [], labContacts: [], labAddresses: [], pricingOverrides: [],
      labReviews: [], caseNotes: {}, caseAttachments: {}, qcInspections: [], doctorPreferences: [],
    } as unknown as SyncCollections;
  }

  it('writes the voucher, advance and adjustment against the new schema', async () => {
    const eng = await migratedEngine();
    setDatabase(eng);
    vi.useFakeTimers();
    syncCollectionsToDb(collections());
    vi.advanceTimersByTime(150);
    vi.useRealTimers();

    expect(getLastSyncError()).toBeNull();
    const pay = eng.get<any>(`SELECT amount, payment_method, status FROM payments WHERE id = 'pay-1'`);
    expect(pay).toBeTruthy();
    expect(pay.amount).toBe(1000);
    expect(pay.payment_method).toBe('cheque');
    expect(eng.get<any>(`SELECT amount FROM advance_payments WHERE id = 'adv-1'`)?.amount).toBe(500);
    expect(eng.get<any>(`SELECT type FROM account_adjustments WHERE id = 'adj-1'`)?.type).toBe('credit_note');
  });

  it('keeps the values stable across repeated saves', async () => {
    /* The old test this replaces existed because a whole-table rebuild silently
       reset columns. The guarantee still matters now that the tables have been
       rebuilt once more — so it is re-asserted against the new schema. */
    const eng = await migratedEngine();
    setDatabase(eng);
    for (let pass = 0; pass < 3; pass += 1) {
      vi.useFakeTimers();
      syncCollectionsToDb(collections());
      vi.advanceTimersByTime(150);
      vi.useRealTimers();
      expect(getLastSyncError(), `pass ${pass}`).toBeNull();
      const pay = eng.get<any>(`SELECT amount, payment_method, receipt_number FROM payments WHERE id = 'pay-1'`);
      expect(pay?.amount, `pass ${pass}`).toBe(1000);
      expect(pay?.payment_method, `pass ${pass}`).toBe('cheque');
      expect(pay?.receipt_number, `pass ${pass}`).toBe('REC-1');
    }
  });
});

/**
 * The orphan sweep, lifted verbatim from MIGRATION_024 so these tests exercise
 * the real statements. If the migration changes, this must change with it.
 * Run one statement at a time, the way the migration runner does — `run()`
 * executes only the first statement of a multi-statement string.
 */
const MIGRATION_024_ORPHAN_SWEEP = [
  `DELETE FROM journal_lines WHERE journal_id IN (
     SELECT j.id FROM journal_entries j
     WHERE j.reference_type = 'invoice'
       AND j.reference_id NOT IN (SELECT id FROM invoices)
   )`,
  `DELETE FROM journal_entries WHERE reference_type = 'invoice'
     AND reference_id NOT IN (SELECT id FROM invoices)`,
  `DELETE FROM journal_lines WHERE journal_id IN (
     SELECT j.id FROM journal_entries j
     WHERE j.case_id IS NOT NULL
       AND j.case_id NOT IN (SELECT id FROM cases)
   )`,
  `DELETE FROM journal_entries WHERE case_id IS NOT NULL
     AND case_id NOT IN (SELECT id FROM cases)`,
  `DELETE FROM journal_lines WHERE journal_id IN (
     SELECT j.id FROM journal_entries j
     WHERE j.event_type = 'payment_received'
       AND j.reference_id NOT IN (SELECT id FROM payments)
   )`,
  `DELETE FROM journal_entries WHERE event_type = 'payment_received'
     AND reference_id NOT IN (SELECT id FROM payments)`,
];

function runSweep(eng: SqliteEngine) {
  for (const statement of MIGRATION_024_ORPHAN_SWEEP) eng.run(statement);
}