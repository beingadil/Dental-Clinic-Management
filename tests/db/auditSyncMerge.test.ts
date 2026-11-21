import { describe, it, expect, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { auditRepo } from '../../src/db/repos';
import { syncCollectionsToDb, getLastSyncError, type SyncCollections } from '../../src/db/syncCore';

/**
 * Regression: audit_repo.log and the direct module-control/auth/month-close
 * logs write straight into audit_events, bypassing React state. The snapshot
 * used to DELETE FROM audit_events and re-insert only the mirrored rows,
 * silently wiping those direct entries on the next sync.
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

describe('audit event sync merge', () => {
  it('keeps rows written directly to the DB across syncs', async () => {
    const eng = await freshEngine();
    auditRepo.log({
      action: 'module_unlock',
      entity_type: 'module',
      entity_id: 'billing',
      notes: 'source=ui',
    });

    // Simulate a sync where React only mirrors OTHER events.
    flushSync(makeCollections([]));

    const rows = auditRepo.all();
    expect(rows.some((r) => r.action === 'module_unlock')).toBe(true);
    expect(getLastSyncError()).toBeNull();
    expect(eng.get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_events')!.n).toBe(1);
  });

  it('upserts mirrored rows without deleting direct rows', async () => {
    const eng = await freshEngine();
    const direct = auditRepo.log({
      action: 'month_reopen',
      entity_type: 'month_close',
      entity_id: '2026-10',
    });

    const mirrored = [{
      id: direct.id,
      timestamp: direct.timestamp,
      actor: direct.actor,
      action: 'month_reopen',
      entity_type: 'month_close',
      entity_id: '2026-10',
      entity_ref: null,
      reason: 'fixed',
      old_state: undefined,
      new_state: undefined,
      notes: 'source=voice',
    }];

    flushSync(makeCollections(mirrored));

    const rows = auditRepo.all();
    expect(rows).toHaveLength(1);
    expect(rows[0].notes).toBe('source=voice');
    expect(eng.get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_events')!.n).toBe(1);
  });
});
