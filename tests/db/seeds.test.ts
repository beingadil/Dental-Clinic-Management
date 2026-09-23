import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { seedDatabase } from '../../src/db/seeds';
import { usersRepo, caseTypesRepo, settingsRepo, clinicalSpecsRepo, emailTemplatesRepo, notificationConfigRepo, appMetaRepo } from '../../src/db/repos';
let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
  // minimal localStorage shim for seeds.ts (appMetaRepo works via DB, but
  // clinicalSpecsService defaults are pure constants so no storage is touched)
  if (typeof (globalThis as any).localStorage === 'undefined') {
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }
});

describe('seedDatabase', () => {
  it('seeds catalog, clinical specs, settings, templates — and zero accounts', async () => {
    await seedDatabase();

    // No shipped accounts of any kind. The operator's Super Admin is
    // provisioned through the login screen's setup flow with an
    // operator-chosen password.
    expect(usersRepo.count()).toBe(0);

    expect(caseTypesRepo.all().length).toBeGreaterThanOrEqual(8);
    expect(clinicalSpecsRepo.materials.all().length).toBeGreaterThanOrEqual(8);
    expect(clinicalSpecsRepo.prepTypes.all().length).toBeGreaterThanOrEqual(8);
    expect(clinicalSpecsRepo.shadeGuides.all().length).toBeGreaterThanOrEqual(3);
    expect(clinicalSpecsRepo.implantBrands.all().length).toBeGreaterThanOrEqual(6);

    // Identity fields ship blank by design — the operator configures them in
    // Settings → Branding. The settings row itself must still be seeded.
    const branding = settingsRepo.get('branding', 'settings');
    expect(branding).toBeDefined();
    expect(branding?.primaryColor).toBeTruthy();
    expect(notificationConfigRepo.get()?.overdue_frequencies.length).toBeGreaterThan(0);
    expect(emailTemplatesRepo.all().length).toBe(4);
  });

  it('is idempotent — second run changes nothing', async () => {
    const usersBefore = usersRepo.count();
    const typesBefore = caseTypesRepo.all().length;
    await seedDatabase();
    expect(usersRepo.count()).toBe(usersBefore);
    expect(caseTypesRepo.all().length).toBe(typesBefore);
  });
});
