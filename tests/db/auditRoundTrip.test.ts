import { describe, it, expect, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { auditRepo } from '../../src/db/repos';
import { syncCollectionsToDb, getLastSyncError, type SyncCollections } from '../../src/db/syncCore';

/**
 * `audit_events.old_state` / `new_state` are JSON text columns. auditRepo.log
 * stringifies an object into them; auditRepo.all() read them back as raw
 * strings, and syncCore stringified again on the way out. That round trip was
 * lossy — a value already holding JSON text got encoded a second time, so
 * every hydrate→sync cycle wrapped it in another layer of escaping. Backslash
 * count roughly doubles per cycle, so the column grew exponentially until
 * SQLite held ~25 MB of nested quotes per row and JSON.stringify threw
 * "Invalid string length". That RangeError aborted the whole snapshot
 * transaction, so a handful of audit rows stopped every table from
 * persisting.
 */
function makeCollections(auditEvents: any[] = []): SyncCollections {
  return {
    cases: [], labs: [], caseTypes: [], invoices: [], advancePayments: [],
    accountAdjustments: [], journalEntries: [], reconciliationItems: [],
    notifications: [], savedVouchers: [], auditEvents, templates: [],
    labContacts: [], labAddresses: [], pricingOverrides: [], labReviews: [],
    doctorPreferences: [], caseNotes: {}, caseAttachments: {}, qcInspections: [],
  } as unknown as SyncCollections;
}

/** syncCollectionsToDb is debounced (150ms) — flush the timer synchronously. */
function flushSync(collections: SyncCollections): void {
  vi.useFakeTimers();
  try {
    syncCollectionsToDb(collections);
    vi.advanceTimersByTime(200);
  } finally {
    vi.useRealTimers();
  }
}

async function freshEngine(): Promise<SqliteEngine> {
  const SQL = await initSqlJs();
  const eng = await SqliteEngine.create(SQL, null);
  eng.migrate();
  setDatabase(eng);
  return eng;
}

const layoutAudit = () => auditRepo.log({
  action: 'update',
  entity_type: 'settings',
  entity_id: 'dashboard_layout',
  old_state: { layout: 'custom' },
  new_state: { layout: 'default' },
});

describe('audit state round trip', () => {
  it('reads back the object it was given, not re-encoded text', async () => {
    await freshEngine();
    layoutAudit();

    const [row] = auditRepo.all();
    expect(row.old_state).toEqual({ layout: 'custom' });
    expect(row.new_state).toEqual({ layout: 'default' });
  });

  it('keeps old_state byte-stable across repeated hydrate→sync cycles', async () => {
    const eng = await freshEngine();
    layoutAudit();

    const before = eng.get<{ n: number }>('SELECT LENGTH(old_state) AS n FROM audit_events')!.n;

    // Ten cycles is what a long-lived session accumulates. Without the fix
    // this doubled every time and blew past V8's max string length long
    // before cycle 10.
    for (let i = 0; i < 10; i++) flushSync(makeCollections(auditRepo.all()));

    const after = eng.get<{ n: number }>('SELECT LENGTH(old_state) AS n FROM audit_events')!.n;
    expect(after).toBe(before);
    expect(auditRepo.all()[0].old_state).toEqual({ layout: 'custom' });
  });

  it('survives a decade of audit cycles without failing the snapshot save', async () => {
    const eng = await freshEngine();
    for (let i = 0; i < 10; i++) {
      auditRepo.log({
        action: 'update',
        entity_type: 'settings',
        entity_id: 'dashboard_layout',
        old_state: { layout: 'custom', note: 'Panel drag-and-drop unlocked' },
        new_state: { layout: 'default' },
      });
    }

    for (let i = 0; i < 10; i++) flushSync(makeCollections(auditRepo.all()));

    // The snapshot save itself used to be the thing that threw, which meant
    // no table persisted at all.
    expect(getLastSyncError()).toBeNull();
    expect(eng.get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_events')!.n).toBe(10);
  });

  it('bounds an oversized state value instead of writing it whole', async () => {
    const eng = await freshEngine();
    auditRepo.log({
      action: 'update',
      entity_type: 'settings',
      entity_id: 'oversized',
      old_state: { blob: 'x'.repeat(500_000) },
    });

    const length = eng.get<{ n: number }>(
      'SELECT LENGTH(old_state) AS n FROM audit_events WHERE entity_id = ?',
      ['oversized']
    )!.n;
    expect(length).toBeLessThan(70_000);
  });

  it('survives a re-sync of a database that already holds grown rows', async () => {
    const eng = await freshEngine();
    // Simulate the pre-fix database: one round of double encoding already
    // applied, which is exactly what the running app had on disk.
    eng.run(
      `INSERT INTO audit_events (id, timestamp, actor, action, entity_type, entity_id, old_state, new_state)
       VALUES ('aud-legacy', '2026-09-01 10:00', 'System', 'update', 'settings', 'dashboard_layout', ?, ?)`,
      [JSON.stringify(JSON.stringify({ layout: 'custom' })), null]
    );

    for (let i = 0; i < 10; i++) flushSync(makeCollections(auditRepo.all()));

    expect(getLastSyncError()).toBeNull();
    // Repaired, not carried forward: the growth stops on contact.
    const length = eng.get<{ n: number }>(
      'SELECT LENGTH(old_state) AS n FROM audit_events WHERE id = ?',
      ['aud-legacy']
    )!.n;
    expect(length).toBeLessThan(70_000);
  });
});