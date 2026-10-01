import { describe, it, expect, vi, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase, getDatabase } from '../../src/db/core';
import { syncCollectionsToDb, getLastSyncError, type SyncCollections } from '../../src/db/syncCore';
import { nextInvoiceNumber } from '../../src/services/ledgerDomain';
import { reserveInvoiceNumber, nextReservedInvoiceNumber } from '../../src/services/invoiceNumbering';
import type { Invoice } from '../../src/types';

/**
 * B2 regression: generateInvoiceNumber() used to read invoices from render
 * state, and addCase built `newInvoice` outside the setInvoices updater —
 * two creations inside one render window minted the SAME INV-n, and the
 * sync aborted with UNIQUE constraint failed: invoices.invoice_number.
 * The minter now goes through a monotonic reservation service and the sync
 * carries a healer as the last line of defence (mirrors payments/advances).
 */

const invoiceRow = (id: string, number: string) => ({
  id, invoice_number: number, lab_id: 'lab-1', lab_name: 'Test Clinic',
  amount: 1000, discount: 0, final_amount: 1000, amount_paid: 0,
  payment_status: 'unpaid', status_v2: 'open',
  created_at: '2026-10-01T09:00', payments: [],
});

function makeCollections(invoices: ReturnType<typeof invoiceRow>[]): SyncCollections {
  return {
    users: [], labs: [{ id: 'lab-1', name: 'Test Clinic', created_at: '2026-10-01T09:00' }],
    caseTypes: [], cases: [], invoices,
    advancePayments: [], accountAdjustments: [], journalEntries: [], reconciliationItems: [],
    notifications: [], savedVouchers: [], auditEvents: [], templates: [], labContacts: [],
    labAddresses: [], pricingOverrides: [], labReviews: [], caseNotes: {}, caseAttachments: {},
    qcInspections: [], doctorPreferences: [],
  } as unknown as SyncCollections;
}

beforeEach(() => {
  // Fresh reservation book per test (module-level singleton).
  reserveInvoiceNumber('INV-0000', true);
});

describe('invoice number reservation (B2)', () => {
  it('generator output shape is unchanged', () => {
    const invoices = [invoiceRow('i1', 'INV-0007')] as unknown as Invoice[];
    expect(nextInvoiceNumber(invoices)).toBe('INV-0008');
  });

  it('two reservations in one render window cannot collide', () => {
    const a = nextReservedInvoiceNumber(() => 'INV-0005');
    const b = nextReservedInvoiceNumber(() => 'INV-0005');
    expect(a).not.toBe(b);
  });

  it('reservation floor accounts for voided (retired) numbers', () => {
    // Live invoices only reach INV-0002, but INV-0009 was voided (retired).
    // First mint after seeding with the retired number: beyond it (0010).
    const first = nextReservedInvoiceNumber(() => 'INV-0009');
    expect(first).toBe('INV-0010');
    // A LOWER seed (state lagged) must never lower the mark: still 0011.
    const second = nextReservedInvoiceNumber(() => 'INV-0002');
    expect(second).toBe('INV-0011');
  });
});

describe('sync invoice healer (B2 last line of defence)', () => {
  it('heals duplicate invoice numbers instead of aborting the transaction', async () => {
    const SQL = await initSqlJs();
    const eng = await SqliteEngine.create(SQL, null);
    eng.migrate();
    setDatabase(eng);

    vi.useFakeTimers();
    syncCollectionsToDb(makeCollections([invoiceRow('inv-1', 'INV-0001'), invoiceRow('inv-2', 'INV-0001')]));
    vi.advanceTimersByTime(150);
    vi.useRealTimers();

    expect(getLastSyncError()).toBeNull();
    const numbers = getDatabase()
      .all<{ n: string }>('SELECT invoice_number AS n FROM invoices ORDER BY invoice_number')
      .map((r) => r.n);
    expect(numbers).toEqual(['INV-0001', 'INV-0001-D2']);
  });
});
