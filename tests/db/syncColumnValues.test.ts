import { describe, it, expect, beforeAll, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { syncCollectionsToDb, getLastSyncError, type SyncCollections } from '../../src/db/syncCore';

/**
 * The values behind syncSchemaCoverage's column-count audit.
 *
 * That test proves the sync MENTIONS every column; this one proves the value
 * the app actually holds comes back out. Both halves are needed — an INSERT can
 * name a column and still write the wrong thing into it — and both gaps found
 * here were real: department, case_notes.updated_at and payments.journal_id
 * were each silently NULLed on every autosave, with no error, no failed sync,
 * and no visible symptom until someone noticed cases grouped as "Unassigned"
 * and payments had lost their ledger entries.
 */
let engine: SqliteEngine;

const JOURNAL_ID = 'jrn-pay-1';

function makeCollections(): SyncCollections {
  const lab = { id: 'lab-1', name: 'Test Clinic', created_at: '2026-10-01T09:00' };
  const kase = {
    id: 'case-1', case_number: 'DS-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
    case_type_id: 'ct-1', case_type_name: 'Crown', doctor_name: 'Dr. Test',
    patient_name: 'Patient', selected_teeth: [16], status: 'received', priority: 'normal',
    // migration 015 added this column; casesRepo writes it and the modal reads
    // it back, so the autosave has to preserve it like every other field.
    department: 'Ceramics',
    price: 1000, discount: 0, final_price: 1000, delivery_date: '2026-10-05',
    created_at: '2026-10-01T09:00', updated_at: '2026-10-01T09:00', history: [],
  };
  const invoice = {
    id: 'inv-1', invoice_number: 'INV-0001', case_id: 'case-1', case_number: 'DS-0001',
    lab_id: 'lab-1', lab_name: 'Test Clinic', case_type_name: 'Crown', doctor_name: 'Dr. Test',
    patient_name: 'Patient', amount: 1000, discount: 0, final_amount: 1000, amount_paid: 1000,
    payment_status: 'paid', issue_date: '2026-10-01', due_date: '2026-10-05',
    // Stamped by useTransactionCommands when the receipt is recorded.
    payments: [{
      id: 'pmt-1', payment_number: 'PAY-0001', amount: 1000, payment_method: 'cash',
      payment_date: '2026-10-02', recorded_by: 'Test', journal_id: JOURNAL_ID,
      allocations: [], attachments: [],
    }],
    created_at: '2026-10-01T09:00', updated_at: '2026-10-01T09:00',
  };
  return {
    users: [], labs: [lab], caseTypes: [], cases: [kase], invoices: [invoice],
    caseNotes: {
      'case-1': [{
        id: 'note-1', case_id: 'case-1', note_text: 'Shade adjusted',
        author: 'Test', created_at: '2026-10-02T10:00',
        // Set by editCaseNote; without this every edit read back as authored.
        updated_at: '2026-10-03T11:00',
      }],
    },
    caseAttachments: {},
    journalEntries: [{
      id: JOURNAL_ID, journal_number: 'JRN-PAY-0001', date: '2026-10-02',
      event_type: 'payment_received', reference_type: 'payment', reference_id: 'pmt-1',
      reference_number: 'PAY-0001', lab_id: 'lab-1', lab_name: 'Test Clinic',
      description: 'Payment received', created_at: '2026-10-02T10:00', created_by: 'Test',
      lines: [],
    }],
    advancePayments: [], accountAdjustments: [], notifications: [], auditEvents: [],
    reconciliationItems: [], savedVouchers: [], qcInspections: [], labContacts: [],
    labAddresses: [], pricingOverrides: [], labReviews: [], templates: [], doctorPreferences: [],
  } as unknown as SyncCollections;
}

function flush(collections: SyncCollections): void {
  vi.useFakeTimers();
  try {
    expect(() => syncCollectionsToDb(collections)).not.toThrow();
    vi.advanceTimersByTime(150);
  } finally {
    vi.useRealTimers();
  }
  expect(getLastSyncError()).toBeNull();
}

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
});

describe('autosave preserves values, not just column names', () => {
  it('keeps the bench department assigned to a case', () => {
    flush(makeCollections());
    const row = engine.get<{ department: string | null }>(
      'SELECT department FROM cases WHERE id = ?', ['case-1']
    );
    expect(row?.department).toBe('Ceramics');
  });

  it('keeps the edited-at stamp on a case note', () => {
    flush(makeCollections());
    const row = engine.get<{ note_text: string; created_at: string; updated_at: string | null }>(
      'SELECT note_text, created_at, updated_at FROM case_notes WHERE id = ?', ['note-1']
    );
    expect(row?.note_text).toBe('Shade adjusted');
    expect(row?.created_at).toBe('2026-10-02T10:00');
    expect(row?.updated_at).toBe('2026-10-03T11:00');
  });

  it('keeps a payment linked to its journal entry', () => {
    flush(makeCollections());
    const row = engine.get<{ journal_id: string | null }>(
      'SELECT journal_id FROM payments WHERE id = ?', ['pmt-1']
    );
    expect(row?.journal_id).toBe(JOURNAL_ID);
  });

  it('re-links a payment whose journal id no longer resolves', () => {
    // The same dangling-pointer state the invoice healer exists for: the payment
    // kept an id whose journal was dropped from state. Preserving it verbatim
    // would store a link to nothing, so it falls back to the payment's own
    // payment_received journal.
    const collections = makeCollections();
    (collections.invoices[0].payments[0] as any).journal_id = 'jrn-deleted';
    flush(collections);
    const row = engine.get<{ journal_id: string | null }>(
      'SELECT journal_id FROM payments WHERE id = ?', ['pmt-1']
    );
    expect(row?.journal_id).toBe(JOURNAL_ID);
  });

  it('leaves journal_id NULL when there is genuinely no journal to link', () => {
    // Healing must not invent a pointer: a payment with no journal anywhere
    // stays NULL so the boot-time backfill can still find it.
    const collections = makeCollections();
    collections.journalEntries = [];
    (collections.invoices[0].payments[0] as any).journal_id = 'jrn-deleted';
    flush(collections);
    const row = engine.get<{ journal_id: string | null }>(
      'SELECT journal_id FROM payments WHERE id = ?', ['pmt-1']
    );
    expect(row?.journal_id).toBeNull();
  });

  it('survives repeated autosaves without accumulating or drifting', () => {
    // The rebuild runs on every debounced state change, so a value that only
    // survives the first pass would still look correct in a one-shot test.
    const collections = makeCollections();
    flush(collections);
    flush(collections);
    flush(collections);
    expect(engine.all<{ n: number }>('SELECT COUNT(*) AS n FROM cases')[0].n).toBe(1);
    expect(engine.all<{ n: number }>('SELECT COUNT(*) AS n FROM case_notes')[0].n).toBe(1);
    expect(engine.all<{ n: number }>('SELECT COUNT(*) AS n FROM payments')[0].n).toBe(1);
    expect(engine.get<{ department: string | null }>('SELECT department FROM cases WHERE id = ?', ['case-1'])?.department).toBe('Ceramics');
    expect(engine.get<{ updated_at: string | null }>('SELECT updated_at FROM case_notes WHERE id = ?', ['note-1'])?.updated_at).toBe('2026-10-03T11:00');
    expect(engine.get<{ journal_id: string | null }>('SELECT journal_id FROM payments WHERE id = ?', ['pmt-1'])?.journal_id).toBe(JOURNAL_ID);
  });
});