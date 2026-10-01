import { describe, it, expect } from 'vitest';
import { canPost, canManageSystem, type BillingAction, type SystemAction } from '../../src/services/permissions';
import type { UserProfile } from '../../src/types';

const user = (role: UserProfile['role']): UserProfile => ({
  id: `u-${role}`, username: role, email: `${role}@x`, name: role, role,
});

describe('billing permission matrix (B3)', () => {
  const matrix: [UserProfile['role'], BillingAction, boolean][] = [
    // payment:record
    ['Super Admin', 'payment:record', true],
    ['Lab Admin', 'payment:record', true],
    ['Billing Manager', 'payment:record', true],
    ['Technician', 'payment:record', false],
    // advance:deposit
    ['Billing Manager', 'advance:deposit', true],
    ['Technician', 'advance:deposit', false],
    // credit:issue
    ['Billing Manager', 'credit:issue', true],
    ['Technician', 'credit:issue', false],
    // refund:issue
    ['Billing Manager', 'refund:issue', true],
    ['Technician', 'refund:issue', false],
    // payment:bulk
    ['Billing Manager', 'payment:bulk', true],
    ['Technician', 'payment:bulk', false],
    // invoice:void — admins only
    ['Super Admin', 'invoice:void', true],
    ['Lab Admin', 'invoice:void', true],
    ['Billing Manager', 'invoice:void', false],
    ['Technician', 'invoice:void', false],
    // reversal:post — admins only
    ['Super Admin', 'reversal:post', true],
    ['Lab Admin', 'reversal:post', true],
    ['Billing Manager', 'reversal:post', false],
    ['Technician', 'reversal:post', false],
  ];

  it.each(matrix)('%s %s → %s', (role, action, expected) => {
    expect(canPost(user(role), action)).toBe(expected);
  });

  it('denies everything for a missing user', () => {
    for (const action of ['payment:record', 'invoice:void', 'reversal:post'] as BillingAction[]) {
      expect(canPost(null, action)).toBe(false);
    }
  });
});

describe('system permission matrix (Settings F2)', () => {
  const matrix: [UserProfile['role'], SystemAction, boolean][] = [
    // view — everyone in settings
    ['Technician', 'view', true],
    ['Billing Manager', 'view', true],
    // personal preferences — self, any role
    ['Technician', 'prefs:edit', true],
    // identity/branding — admins only
    ['Super Admin', 'branding:edit', true],
    ['Lab Admin', 'branding:edit', true],
    ['Billing Manager', 'branding:edit', false],
    ['Technician', 'branding:edit', false],
    // print/documents — admins only
    ['Super Admin', 'print:edit', true],
    ['Lab Admin', 'print:edit', true],
    ['Billing Manager', 'print:edit', false],
    ['Technician', 'print:edit', false],
    // backup restore / wipe / updates — admins only
    ['Super Admin', 'backup:restore', true],
    ['Lab Admin', 'backup:restore', true],
    ['Billing Manager', 'backup:restore', false],
    ['Technician', 'backup:restore', false],
    ['Lab Admin', 'data:wipe', true],
    ['Technician', 'data:wipe', false],
    ['Lab Admin', 'updates:install', true],
    ['Billing Manager', 'updates:install', false],
    ['Technician', 'updates:install', false],
    // users — Super Admin only
    ['Super Admin', 'users:manage', true],
    ['Lab Admin', 'users:manage', false],
    ['Billing Manager', 'users:manage', false],
    ['Technician', 'users:manage', false],
  ];

  it.each(matrix)('%s %s → %s', (role, action, expected) => {
    expect(canManageSystem(user(role), action)).toBe(expected);
  });
});
