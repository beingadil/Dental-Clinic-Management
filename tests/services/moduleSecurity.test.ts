import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase, getDatabase } from '../../src/db/core';
import { settingsRepo } from '../../src/db/repos';
import {
  LOCKABLE_MODULES,
  MIN_MODULE_PASSWORD_LENGTH,
  canEnterModule,
  changeModulePassword,
  clearAllModulePasswords,
  clearModulePassword,
  isModuleLockEnabled,
  isModuleUnlocked,
  loadModuleLock,
  loadModuleLocks,
  lockAllModules,
  lockModule,
  moduleForView,
  setModulePassword,
  unlockModule,
  verifyModulePassword,
} from '../../src/services/moduleSecurity';

/**
 * Module passwords are a second door in front of a whole module, stored as
 * PBKDF2 hashes in the settings table, one independent lock per module.
 * These tests pin the promises the Settings tab and the shell rely on:
 *   - the password itself is never written to the database;
 *   - locks are independent (protecting Billing does not touch Reports);
 *   - changing needs the old password; removing one leaves the rest alone;
 *   - unlocks are in memory and scoped to one module;
 *   - a legacy single-report row still protects Reports after upgrade;
 *   - corrupt rows degrade to "not protected", never a lockout.
 */

async function freshDb() {
  const SQL = await initSqlJs();
  const eng = await SqliteEngine.create(SQL, null);
  eng.migrate();
  setDatabase(eng);
  return eng;
}

/** The raw value of one settings row, before JSON parsing. */
function rawRow(key: string): string {
  const row = getDatabase().get<{ value: string }>(
    'SELECT value FROM settings WHERE namespace = ? AND key = ?',
    ['security', key],
  );
  return row?.value ?? '';
}

beforeEach(async () => {
  await freshDb();
  lockAllModules();
});

describe('module lock registry', () => {
  it('starts with every lockable module open', () => {
    const map = loadModuleLocks();
    expect(Object.keys(map).sort()).toEqual(LOCKABLE_MODULES.map((m) => m.id).sort());
    for (const module of LOCKABLE_MODULES) {
      expect(map[module.id].enabled).toBe(false);
      expect(isModuleLockEnabled(module.id)).toBe(false);
      expect(loadModuleLock(module.id).passwordHash).toBe('');
    }
  });

  it('maps shell views to their whole module', () => {
    expect(moduleForView('billing')).toBe('billing');
    expect(moduleForView('print-invoices')).toBe('billing');
    expect(moduleForView('general_ledger')).toBe('reports');
    expect(moduleForView('statements')).toBe('reports');
    expect(moduleForView('insights')).toBe('reports');
    expect(moduleForView('settings')).toBeNull();
  });

  it('does not include System Settings in the lockable list', () => {
    expect(LOCKABLE_MODULES.some((m) => m.id === ('settings' as never))).toBe(false);
    expect(moduleForView('settings')).toBeNull();
  });
});

describe('setting a module password', () => {
  it('stores a PBKDF2 hash, never the password, and verifies it', async () => {
    await setModulePassword('reports', 'reports-secret', 'Super Admin');

    const lock = loadModuleLock('reports');
    expect(lock.enabled).toBe(true);
    expect(lock.passwordHash.startsWith('pbkdf2$')).toBe(true);
    expect(lock.updatedBy).toBe('Super Admin');
    expect(lock.updatedAt).toBeTruthy();

    // The raw row must not contain the credential in any form.
    expect(rawRow('module_locks')).not.toContain('reports-secret');
    expect(rawRow('module_locks')).toContain('pbkdf2$');

    expect(await verifyModulePassword('reports', 'reports-secret')).toBe(true);
    expect(await verifyModulePassword('reports', 'Reports-Secret')).toBe(false);
    expect(await verifyModulePassword('reports', '')).toBe(false);
  });

  it('rejects a password shorter than the floor', async () => {
    const short = 'short';
    expect(short.length).toBeLessThan(MIN_MODULE_PASSWORD_LENGTH);
    await expect(setModulePassword('cases', short, 'Super Admin')).rejects.toThrow();
    expect(isModuleLockEnabled('cases')).toBe(false);
  });

  it('closes the in-memory unlock when the password is written', async () => {
    await setModulePassword('reports', 'reports-secret', 'Super Admin');
    unlockModule('reports');
    expect(isModuleUnlocked('reports')).toBe(true);

    await setModulePassword('reports', 'another-secret', 'Super Admin');
    expect(isModuleUnlocked('reports')).toBe(false);
  });
});

describe('independent module locks', () => {
  it('protects only the module that was given a password', async () => {
    await setModulePassword('billing', 'billing-secret', 'Super Admin');

    expect(isModuleLockEnabled('billing')).toBe(true);
    expect(isModuleLockEnabled('reports')).toBe(false);
    expect(isModuleLockEnabled('cases')).toBe(false);

    // Verification of an unprotected module is open by design.
    expect(await verifyModulePassword('reports', 'anything')).toBe(true);
  });

  it('changes one password without disturbing another module', async () => {
    await setModulePassword('billing', 'billing-secret', 'Super Admin');
    await setModulePassword('reports', 'reports-secret', 'Super Admin');

    const changed = await changeModulePassword(
      'billing',
      'billing-secret',
      'billing-next',
      'Super Admin',
    );
    expect(changed.success).toBe(true);
    expect(await verifyModulePassword('billing', 'billing-next')).toBe(true);
    expect(await verifyModulePassword('reports', 'reports-secret')).toBe(true);
  });

  it('removes one module and leaves the others protected', async () => {
    await setModulePassword('billing', 'billing-secret', 'Super Admin');
    await setModulePassword('reports', 'reports-secret', 'Super Admin');

    clearModulePassword('billing', 'Super Admin');

    expect(isModuleLockEnabled('billing')).toBe(false);
    expect(loadModuleLock('billing').passwordHash).toBe('');
    expect(isModuleLockEnabled('reports')).toBe(true);
    expect(await verifyModulePassword('reports', 'reports-secret')).toBe(true);
  });

  it('removes every password in one call', async () => {
    await setModulePassword('billing', 'billing-secret', 'Super Admin');
    await setModulePassword('reports', 'reports-secret', 'Super Admin');
    unlockModule('reports');

    clearAllModulePasswords('Super Admin');

    expect(isModuleLockEnabled('billing')).toBe(false);
    expect(isModuleLockEnabled('reports')).toBe(false);
    expect(isModuleUnlocked('reports')).toBe(false);
  });
});

describe('changing a module password', () => {
  it('requires the current password', async () => {
    await setModulePassword('reports', 'reports-secret', 'Super Admin');

    const denied = await changeModulePassword(
      'reports',
      'wrong-current',
      'next-secret',
      'Super Admin',
    );
    expect(denied.success).toBe(false);
    expect(await verifyModulePassword('reports', 'reports-secret')).toBe(true);

    const changed = await changeModulePassword(
      'reports',
      'reports-secret',
      'next-secret',
      'Super Admin',
    );
    expect(changed.success).toBe(true);
    expect(await verifyModulePassword('reports', 'reports-secret')).toBe(false);
    expect(await verifyModulePassword('reports', 'next-secret')).toBe(true);
  });

  it('refuses to change a module that has no password', async () => {
    const result = await changeModulePassword('cases', 'anything', 'next-secret', 'Super Admin');
    expect(result.success).toBe(false);
    expect(isModuleLockEnabled('cases')).toBe(false);
  });

  it('rejects a too-short replacement without touching the old password', async () => {
    await setModulePassword('reports', 'reports-secret', 'Super Admin');

    const result = await changeModulePassword(
      'reports',
      'reports-secret',
      'short',
      'Super Admin',
    );
    expect(result.success).toBe(false);
    expect(await verifyModulePassword('reports', 'reports-secret')).toBe(true);
  });
});

describe('session unlocks', () => {
  it('scopes an unlock to the module that was opened', async () => {
    await setModulePassword('billing', 'billing-secret', 'Super Admin');
    await setModulePassword('reports', 'reports-secret', 'Super Admin');

    unlockModule('reports');

    expect(isModuleUnlocked('reports')).toBe(true);
    expect(isModuleUnlocked('billing')).toBe(false);
    expect(canEnterModule('reports')).toBe(true);
    expect(canEnterModule('billing')).toBe(false);
  });

  it('keeps an unlock across views of the same module, and closes it on lock', async () => {
    await setModulePassword('reports', 'reports-secret', 'Super Admin');
    unlockModule('reports');

    // The shell only calls lockModule when the MODULE changes, so switching
    // Ledger ↔ Statements keeps the door open.
    expect(canEnterModule('reports')).toBe(true);
    lockModule('reports');
    expect(canEnterModule('reports')).toBe(false);
  });

  it('lets an unprotected module in without a session unlock', () => {
    expect(canEnterModule('catalog')).toBe(true);
  });

  it('clears every unlock when the operator changes', async () => {
    await setModulePassword('billing', 'billing-secret', 'Super Admin');
    await setModulePassword('reports', 'reports-secret', 'Super Admin');
    unlockModule('billing');
    unlockModule('reports');

    lockAllModules();

    expect(isModuleUnlocked('billing')).toBe(false);
    expect(isModuleUnlocked('reports')).toBe(false);
  });
});

describe('stored row compatibility', () => {
  it('folds the legacy single-module Reports row into the new map', () => {
    settingsRepo.set('security', 'reports_access', {
      enabled: true,
      passwordHash: 'pbkdf2$1$c2FsdA==$aGFzaA==',
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: 'Super Admin',
    });

    const map = loadModuleLocks();
    expect(map.reports.enabled).toBe(true);
    expect(map.reports.passwordHash).toBe('pbkdf2$1$c2FsdA==$aGFzaA==');
    expect(map.billing.enabled).toBe(false);
  });

  it('keeps the legacy Reports lock when another module is protected later', async () => {
    settingsRepo.set('security', 'reports_access', {
      enabled: true,
      passwordHash: 'pbkdf2$1$c2FsdA==$aGFzaA==',
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: 'Super Admin',
    });

    await setModulePassword('billing', 'billing-secret', 'Super Admin');

    expect(isModuleLockEnabled('reports')).toBe(true);
    expect(isModuleLockEnabled('billing')).toBe(true);
  });

  it('treats a corrupt or half-written lock as not protected', () => {
    settingsRepo.set('security', 'module_locks', {
      modules: {
        reports: { enabled: true, passwordHash: '' },
        billing: { enabled: 'yes', passwordHash: 'pbkdf2$1$c2FsdA==$aGFzaA==' },
        cases: 'not-an-object',
      },
    });

    const map = loadModuleLocks();
    expect(map.reports.enabled).toBe(false);
    expect(map.billing.enabled).toBe(false);
    expect(map.cases.enabled).toBe(false);
  });

  it('ignores unknown module ids instead of widening the type', () => {
    settingsRepo.set('security', 'module_locks', {
      modules: {
        reports: { enabled: true, passwordHash: 'pbkdf2$1$c2FsdA==$aGFzaA==' },
        payroll: { enabled: true, passwordHash: 'pbkdf2$1$c2FsdA==$aGFzaA==' },
      },
    });

    const map = loadModuleLocks();
    expect(map.reports.enabled).toBe(true);
    expect(Object.keys(map).sort()).toEqual(LOCKABLE_MODULES.map((m) => m.id).sort());
  });

  it('reads a legacy double-encoded row without throwing', () => {
    getDatabase().run(
      `INSERT INTO settings (namespace, key, value, updated_at) VALUES (?, ?, ?, ?)`,
      [
        'security',
        'reports_access',
        JSON.stringify(JSON.stringify({ enabled: true, passwordHash: 'pbkdf2$1$c2FsdA==$aGFzaA==' })),
        '2026-01-01',
      ],
    );

    const map = loadModuleLocks();
    expect(map.reports.enabled).toBe(true);
    expect(map.reports.passwordHash).toBe('pbkdf2$1$c2FsdA==$aGFzaA==');
  });
});
