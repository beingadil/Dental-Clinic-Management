/**
 * Least-privilege helpers (B3 / Settings F2). One place that answers "may
 * this user do that?" for billing posts and system settings. Components use
 * it to hide/disable; the call sites must ALSO check it — hiding alone is
 * not enforcement.
 *
 * Matrix (decided):
 *   Super Admin, Lab Admin — everything, including destructive (void,
 *     reversal, restore, wipe, updates, users).
 *   Billing Manager — every money POST (payment, advance, credit note,
 *     refund, bulk settle) but NOT invoice:void / reversal:post, and no
 *     system mutation.
 *   Technician — read-only money: no posts, no system mutation.
 */
import type { UserProfile } from '../types';

export type BillingAction =
  | 'payment:record'
  | 'advance:deposit'
  | 'credit:issue'
  | 'refund:issue'
  | 'payment:bulk'
  | 'invoice:void'
  | 'reversal:post';

export type SystemAction =
  | 'view'
  | 'prefs:edit'
  | 'branding:edit'
  | 'print:edit'
  | 'notifications:edit'
  | 'currency:edit'
  | 'backup:restore'
  | 'data:wipe'
  | 'updates:install'
  | 'users:manage';

const ADMIN_ROLES: UserProfile['role'][] = ['Super Admin', 'Lab Admin'];

const BILLING: Record<BillingAction, UserProfile['role'][]> = {
  'payment:record': [...ADMIN_ROLES, 'Billing Manager'],
  'advance:deposit': [...ADMIN_ROLES, 'Billing Manager'],
  'credit:issue': [...ADMIN_ROLES, 'Billing Manager'],
  'refund:issue': [...ADMIN_ROLES, 'Billing Manager'],
  'payment:bulk': [...ADMIN_ROLES, 'Billing Manager'],
  'invoice:void': ADMIN_ROLES,
  'reversal:post': ADMIN_ROLES,
};

const SYSTEM: Record<SystemAction, UserProfile['role'][]> = {
  view: [...ADMIN_ROLES, 'Billing Manager', 'Technician'],
  'prefs:edit': [...ADMIN_ROLES, 'Billing Manager', 'Technician'],
  'branding:edit': ADMIN_ROLES,
  'print:edit': ADMIN_ROLES,
  // D1/D6 — reminder copy plus the billing currency. Both are lab-wide, not
  // per-user, so they follow branding/print: admin only, no technician access.
  'notifications:edit': ADMIN_ROLES,
  'currency:edit': ADMIN_ROLES,
  'backup:restore': ADMIN_ROLES,
  'data:wipe': ADMIN_ROLES,
  'updates:install': ADMIN_ROLES,
  'users:manage': ['Super Admin'],
};

export function canPost(user: UserProfile | null | undefined, action: BillingAction): boolean {
  if (!user) return false;
  return BILLING[action].includes(user.role);
}

export function canManageSystem(user: UserProfile | null | undefined, action: SystemAction): boolean {
  if (!user) return false;
  return SYSTEM[action].includes(user.role);
}
