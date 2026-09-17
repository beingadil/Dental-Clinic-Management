import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { seedDatabase } from '../../src/db/seeds';
import { usersRepo, caseTypesRepo, settingsRepo, clinicalSpecsRepo, emailTemplatesRepo, notificationConfigRepo, appMetaRepo } from '../../src/db/repos';
import { verifyPassword } from '../../src/db/crypto';

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
  it('seeds hashed users, catalog, clinical specs, settings and templates', async () => {
    await seedDatabase();

    expect(usersRepo.count()).toBeGreaterThanOrEqual(3);
    const adil = usersRepo.byUsername('adil');
    expect(adil).toBeTruthy();
    expect(adil!.password_hash.startsWith('pbkdf2$')).toBe(true);
    expect(await verifyPassword('adil123', adil!.password_hash)).toBe(true);
    // plaintext must not be stored
    expect(JSON.stringify(usersRepo.all())).not.toContain('adil123');

    expect(caseTypesRepo.all().length).toBeGreaterThanOrEqual(8);
    expect(clinicalSpecsRepo.materials.all().length).toBeGreaterThanOrEqual(8);
    expect(clinicalSpecsRepo.prepTypes.all().length).toBeGreaterThanOrEqual(8);
    expect(clinicalSpecsRepo.shadeGuides.all().length).toBeGreaterThanOrEqual(3);
    expect(clinicalSpecsRepo.implantBrands.all().length).toBeGreaterThanOrEqual(6);

    expect(settingsRepo.get('branding', 'settings')?.appName).toBeTruthy();
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
