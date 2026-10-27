import { describe, it, expect } from 'vitest';
import {
  can,
  canPost,
  canManageSystem,
  ALL_ROLES,
  ALL_ACTIONS,
  ROLE_BASELINE,
  deniedTooltip,
  type AppAction,
  type BillingAction,
  type SystemAction,
} from '../../src/services/permissions';
import type { UserProfile } from '../../src/types';

const user = (role: UserProfile['role']): UserProfile => ({
  id: `u-${role}`, username: role, email: `${role}@x`, name: role, role,
});

describe('billing permission matrix (B3, RBAC v2)', () => {
  const matrix: [UserProfile['role'], BillingAction, boolean][] = [
    // payment:record / advance:deposit — the daily entry bundle
    ['Super Admin', 'payment:record', true],
    ['Clinic Entry Manager', 'payment:record', true],
    ['Audit Checker', 'payment:record', false],
    ['Clinic Entry Manager', 'advance:deposit', true],
    ['Audit Checker', 'advance:deposit', false],
    // The money-correction set is Super Admin only: credit notes, refunds,
    // bulk settle and voids are entered by hand and reverse the ledger.
    ['Clinic Entry Manager', 'credit:issue', false],
    ['Clinic Entry Manager', 'refund:issue', false],
    ['Clinic Entry Manager', 'payment:bulk', false],
    ['Clinic Entry Manager', 'invoice:void', false],
    ['Audit Checker', 'invoice:void', false],
    ['Super Admin', 'invoice:void', true],
    ['Super Admin', 'credit:issue', true],
    ['Super Admin', 'refund:issue', true],
    ['Super Admin', 'payment:bulk', true],
  ];

  it.each(matrix)('%s %s → %s', (role, action, expected) => {
    expect(canPost(user(role), action)).toBe(expected);
  });

  it('denies everything for a missing user', () => {
    for (const action of ['payment:record', 'invoice:void', 'refund:issue'] as BillingAction[]) {
      expect(canPost(null, action)).toBe(false);
    }
    expect(canPost(undefined, 'payment:record')).toBe(false);
  });
});

describe('system permission matrix (Settings F2, RBAC v2)', () => {
  const matrix: [UserProfile['role'], SystemAction, boolean][] = [
    // view + own preferences — every role
    ['Super Admin', 'view', true],
    ['Clinic Entry Manager', 'view', true],
    ['Audit Checker', 'view', true],
    ['Clinic Entry Manager', 'prefs:edit', true],
    ['Audit Checker', 'prefs:edit', true],
    // identity / documents / data / updates — Super Admin only
    ['Super Admin', 'branding:edit', true],
    ['Clinic Entry Manager', 'branding:edit', false],
    ['Audit Checker', 'branding:edit', false],
    ['Super Admin', 'print:edit', true],
    ['Audit Checker', 'print:edit', false],
    ['Super Admin', 'backup:restore', true],
    ['Clinic Entry Manager', 'backup:restore', false],
    ['Super Admin', 'data:wipe', true],
    ['Audit Checker', 'data:wipe', false],
    ['Super Admin', 'updates:install', true],
    ['Clinic Entry Manager', 'updates:install', false],
    ['Audit Checker', 'updates:install', false],
    // users — Super Admin only
    ['Super Admin', 'users:manage', true],
    ['Clinic Entry Manager', 'users:manage', false],
    ['Audit Checker', 'users:manage', false],
  ];

  it.each(matrix)('%s %s → %s', (role, action, expected) => {
    expect(canManageSystem(user(role), action)).toBe(expected);
  });

  it('denies everything for a missing user', () => {
    for (const action of ['view', 'branding:edit', 'users:manage'] as SystemAction[]) {
      expect(canManageSystem(null, action)).toBe(false);
    }
  });
});

describe('module permission matrix (RBAC v2)', () => {
  const matrix: [UserProfile['role'], AppAction, boolean][] = [
    ['Super Admin', 'dashboard:view', true],
    ['Clinic Entry Manager', 'dashboard:view', true],
    ['Audit Checker', 'dashboard:view', true],
    ['Super Admin', 'case:create', true],
    ['Clinic Entry Manager', 'case:create', true],
    ['Clinic Entry Manager', 'case:edit', true],
    ['Audit Checker', 'case:edit', false],
    // deletes are destructive — Super Admin only
    ['Super Admin', 'case:delete', true],
    ['Clinic Entry Manager', 'case:delete', false],
    ['Audit Checker', 'case:delete', false],
    ['Super Admin', 'clinic:create', true],
    ['Clinic Entry Manager', 'clinic:create', false],
    ['Super Admin', 'pricing:edit', true],
    ['Clinic Entry Manager', 'pricing:edit', false],
    ['Audit Checker', 'clinic:edit', false],
    ['Clinic Entry Manager', 'billing:view', true],
    // the full read-only bundle for the Audit Checker
    ['Audit Checker', 'reports:view', true],
    ['Audit Checker', 'reports:export', true],
    ['Audit Checker', 'ledger:view', true],
    ['Audit Checker', 'audit:view', true],
    ['Clinic Entry Manager', 'reports:view', false],
    ['Clinic Entry Manager', 'ledger:view', false],
    ['Clinic Entry Manager', 'audit:view', false],
    ['Super Admin', 'audit:view', true],
    ['Audit Checker', 'catalog:edit', false],
    ['Clinic Entry Manager', 'catalog:edit', false],
    ['Clinic Entry Manager', 'catalog:view', true],
    ['Audit Checker', 'catalog:view', true],
    ['Clinic Entry Manager', 'notifications:send', true],
    ['Audit Checker', 'notifications:send', false],
    ['Audit Checker', 'settings:view', true],
  ];

  it.each(matrix)('%s %s → %s', (role, action, expected) => {
    expect(can(user(role), action)).toBe(expected);
  });

  it('denies everything for a missing user', () => {
    for (const action of ['cases:view', 'case:create', 'audit:view'] as AppAction[]) {
      expect(can(null, action)).toBe(false);
    }
  });

  it('every action in the catalog resolves in every matrix', () => {
    expect(ALL_ROLES).toHaveLength(3);
    expect(ALL_ACTIONS.length).toBeGreaterThan(20);
  });

  it('denied answers carry the shared tooltip copy', () => {
    expect(deniedTooltip).toBe('Insufficient permission');
  });
});

describe('per-user permission overrides (RBAC v3)', () => {
  const userWith = (role: UserProfile['role'], permissions: string[]): UserProfile => ({
    id: `u-${role}-p`, username: role, email: `${role}@x`, name: role, role, permissions,
  });

  it('an explicit permission set replaces the role baseline entirely', () => {
    const u = userWith('Audit Checker', ['dashboard:view', 'case:create', 'payment:record']);
    expect(can(u, 'case:create')).toBe(true);
    expect(canPost(u, 'payment:record')).toBe(true);
    expect(can(u, 'cases:view')).toBe(false);
    expect(canManageSystem(u, 'branding:edit')).toBe(false);
  });

  it('grants can exceed the role ceiling and revokes can go below it', () => {
    const granted = userWith('Clinic Entry Manager', [...ROLE_BASELINE['Clinic Entry Manager'], 'credit:issue']);
    expect(canPost(granted, 'credit:issue')).toBe(true);
    const revoked = userWith('Clinic Entry Manager', ROLE_BASELINE['Clinic Entry Manager'].filter((a) => a !== 'case:create'));
    expect(can(revoked, 'case:create')).toBe(false);
  });

  it('destructive actions stay pinned to Super Admin even when ticked for another role', () => {
    const u = userWith('Clinic Entry Manager', [...ROLE_BASELINE['Clinic Entry Manager'], 'data:wipe', 'users:manage', 'invoice:void', 'backup:restore']);
    expect(canManageSystem(u, 'data:wipe')).toBe(false);
    expect(can(u, 'users:manage')).toBe(false);
    expect(canPost(u, 'invoice:void')).toBe(false);
    expect(canManageSystem(u, 'backup:restore')).toBe(false);
  });

  it('Super Admin keeps everything regardless of stored rows', () => {
    const u = { ...userWith('Super Admin', []), isSuperAdmin: true };
    expect(canManageSystem(u, 'data:wipe')).toBe(true);
    expect(canPost(u, 'refund:issue')).toBe(true);
    expect(can(u, 'case:delete')).toBe(true);
  });

  it('empty permission arrays mean fully revoked; unset falls back to baseline', () => {
    const revoked = userWith('Audit Checker', []);
    expect(can(revoked, 'ledger:view')).toBe(false);
    expect(canPost(revoked, 'payment:record')).toBe(false);
    const unset: UserProfile = { id: 'u-x', username: 'x', email: 'x@x', name: 'x', role: 'Audit Checker' };
    expect(can(unset, 'ledger:view')).toBe(true);
    expect(canPost(unset, 'payment:record')).toBe(false);
  });
});
