import { describe, it, expect, beforeAll, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { caseTypesRepo } from '../../src/db/repos';
import { syncCollectionsToDb, getLastSyncError, type SyncCollections } from '../../src/db/syncCore';

let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
});

const fullSpec = {
  name: 'Zirconia Crown',
  base_price: 15000,
  category: 'crown_bridge',
  lead_time_days: 5,
  warranty_months: 60,
  description: 'Full contour zirconia',
  material_system: '3Y-TZP zirconia',
  unit_basis: 'per unit',
  shade_guide: 'VITA Classical A1-D4',
  indications: 'Posterior single unit',
  contraindications: 'Not for very high load',
};

describe('migration 021 — catalog needs_teeth', () => {
  it('adds the column and defaults every existing catalog row to 1', () => {
    // Written without the column at all, so the DEFAULT has to supply it.
    engine.run(
      `INSERT INTO case_types (id, name, base_price, created_at) VALUES ('ct-legacy', 'Legacy Crown', 5000, '2026-01-01')`
    );

    const row = engine.get<{ needs_teeth: number }>(
      'SELECT needs_teeth FROM case_types WHERE id = ?', ['ct-legacy']
    );
    expect(row?.needs_teeth).toBe(1);

    const mapped = caseTypesRepo.byId('ct-legacy');
    expect(mapped.needs_teeth).toBe(true);
  });
});

describe('caseTypesRepo — needs_teeth', () => {
  it('defaults to required when the caller omits the flag', () => {
    const row = caseTypesRepo.insert({ name: 'Plain Crown', base_price: 9000 });
    expect(row.needs_teeth).toBe(true);
  });

  it('round-trips the flag off, including through update()', () => {
    const row = caseTypesRepo.insert({ name: 'Retainer', base_price: 8000, needs_teeth: false });
    expect(row.needs_teeth).toBe(false);
    expect(caseTypesRepo.byId(row.id)?.needs_teeth).toBe(false);

    caseTypesRepo.update(row.id, { needs_teeth: true });
    expect(caseTypesRepo.byId(row.id)?.needs_teeth).toBe(true);

    caseTypesRepo.update(row.id, { needs_teeth: false });
    expect(caseTypesRepo.byId(row.id)?.needs_teeth).toBe(false);

    caseTypesRepo.delete(row.id);
  });
});

/**
 * Regression. The autosave block in syncCore DELETEs all of case_types and
 * rebuilds it from React state. It listed only the pre-migration-010 columns, so
 * every autosave blanked material_system, unit_basis, shade_guide, indications
 * and contraindications — silently, with no error — and the values were gone the
 * next time the app loaded. needs_teeth would have died the same way.
 */
describe('syncCore — catalog columns survive an autosave', () => {
  it('preserves every catalog spec field and the needs_teeth flag', () => {
    const collections = {
      users: [], labs: [], caseTypes: [
        { ...fullSpec, id: 'ct-sync', name: 'Synced Crown', needs_teeth: false, created_at: '2026-01-01' },
        { ...fullSpec, id: 'ct-sync2', name: 'Synced Crown 2', needs_teeth: true, created_at: '2026-01-01' },
      ],
      cases: [], invoices: [], advancePayments: [], accountAdjustments: [],
      journalEntries: [], ledgerEntries: [], notifications: [], auditEvents: [],
      reconciliationItems: [], savedVouchers: [], caseNotes: {}, caseAttachments: {},
      qcInspections: [], labContacts: [], labAddresses: [], pricingOverrides: [],
      labReviews: [], templates: [], doctorPreferences: [],
    } as unknown as SyncCollections;

    // syncCollectionsToDb is debounced (150ms) — flush the timer synchronously.
    vi.useFakeTimers();
    expect(() => syncCollectionsToDb(collections)).not.toThrow();
    vi.advanceTimersByTime(150);
    vi.useRealTimers();
    // A wiped column fails silently, so a sync error here would be the only clue.
    expect(getLastSyncError()).toBeNull();

    const off = caseTypesRepo.byId('ct-sync');
    for (const key of [
      'material_system', 'unit_basis', 'shade_guide', 'indications', 'contraindications',
    ] as const) {
      expect(off[key], `${key} was wiped by the autosave`).toBe(fullSpec[key]);
    }
    expect(off.needs_teeth).toBe(false);
    expect(caseTypesRepo.byId('ct-sync2')?.needs_teeth).toBe(true);

    // Numeric spec fields too — lead_time_days and warranty_months were equally
    // exposed to the same blanking.
    expect(off.lead_time_days).toBe(fullSpec.lead_time_days);
    expect(off.warranty_months).toBe(fullSpec.warranty_months);
  });
});