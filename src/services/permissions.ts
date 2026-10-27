/**
 * RBAC v2 — least-privilege helpers. One place that answers "may this user
 * do that?" for billing posts, system settings and every module action.
 * Components use it to disable (see deniedTooltip); call sites must ALSO
 * check it — the UI is one of three layers (UI + service guards + audit),
 * never the enforcement itself.
 *
 * Roles (locked with the operator, 2026-10-26):
 *   Super Admin          — everything, including the destructive set:
 *                          void invoices, credit notes, refunds, bulk settle,
 *                          payment edits, deletes, clinic/pricing upkeep,
 *                          backups, wipe, updates, user management.
 *   Clinic Entry Manager — the daily-entry bundle: cases create/edit/status,
 *                          payments and advance deposits, notifications,
 *                          printing. No pricing edits, no credit notes or
 *                          refunds, no voids, no bulk settle, no payment
 *                          edits, no deletes, no clinic CRUD, no settings.
 *   Audit Checker        — full read-only: dashboards, cases, clinics,
 *                          billing views, Analytics & Reports (general
 *                          ledger, statements, audit trail) and exports.
 *                          No write action anywhere.
 *
 * Clinic scope is orthogonal to actions (user_clinics assignments, opt-in —
 * an unassigned user sees every clinic). Actions answer "may this user";
 * scope answers "which clinics". Role changes revoke sessions, so rights
 * take effect at the next login.
 */
import type { UserProfile } from '../types';

/** Shown on every disabled control the user may not use. */
export const deniedTooltip = 'Insufficient permission';

export const ALL_ROLES: UserProfile['role'][] = [
  'Super Admin',
  'Clinic Entry Manager',
  'Audit Checker',
];

/** Actions that may never be granted to a non-Super-Admin, regardless of ticks. */
export const DESTRUCTIVE_ACTIONS: ReadonlySet<string> = new Set([
  'data:wipe',
  'users:manage',
  'invoice:void',
  'backup:restore',
]);

/** Module grouping for the permission manager UI. */
export const PERMISSION_MODULES: { module: string; actions: { key: string; label: string }[] }[] = [
  { module: 'Dashboard', actions: [{ key: 'dashboard:view', label: 'View dashboard' }] },
  { module: 'Cases', actions: [
    { key: 'cases:view', label: 'View cases' },
    { key: 'case:create', label: 'Create case' },
    { key: 'case:edit', label: 'Edit case' },
    { key: 'case:delete', label: 'Delete case' },
  ]},
  { module: 'Clinics', actions: [
    { key: 'clinics:view', label: 'View clinics' },
    { key: 'clinic:create', label: 'Create clinic' },
    { key: 'clinic:edit', label: 'Edit clinic' },
    { key: 'pricing:edit', label: 'Edit pricing' },
    { key: 'contacts:edit', label: 'Edit contacts' },
  ]},
  { module: 'Billing', actions: [
    { key: 'billing:view', label: 'View billing' },
    { key: 'payment:record', label: 'Receive payment' },
    { key: 'advance:deposit', label: 'Advance deposit' },
    { key: 'credit:issue', label: 'Issue credit note' },
    { key: 'debit:issue', label: 'Debit adjustment' },
    { key: 'refund:issue', label: 'Issue refund' },
    { key: 'payment:edit', label: 'Edit payment' },
    { key: 'payment:bulk', label: 'Bulk mark paid' },
    { key: 'invoice:void', label: 'Void invoice' },
  ]},
  { module: 'Reports', actions: [
    { key: 'reports:view', label: 'View reports' },
    { key: 'reports:export', label: 'Export reports' },
    { key: 'ledger:view', label: 'View ledger' },
    { key: 'audit:view', label: 'View audit trail' },
  ]},
  { module: 'Catalog', actions: [
    { key: 'catalog:view', label: 'View catalog' },
    { key: 'catalog:edit', label: 'Edit catalog' },
  ]},
  { module: 'Notifications', actions: [
    { key: 'notifications:view', label: 'View notifications' },
    { key: 'notifications:send', label: 'Send notification' },
  ]},
  { module: 'Settings', actions: [
    { key: 'settings:view', label: 'View settings' },
    { key: 'prefs:edit', label: 'Edit preferences' },
    { key: 'branding:edit', label: 'Edit branding' },
    { key: 'print:edit', label: 'Edit print templates' },
    { key: 'notifications:edit', label: 'Edit notification config' },
    { key: 'backup:restore', label: 'Backup / restore' },
    { key: 'data:wipe', label: 'Wipe data' },
    { key: 'updates:install', label: 'Install updates' },
    { key: 'users:manage', label: 'Manage users' },
  ]},
];

/** Baseline permission set granted to a brand-new user of each BUILT-IN role. */
export const ROLE_BASELINE: Record<string, string[]> = {
  'Super Admin': PERMISSION_MODULES.flatMap((m) => m.actions.map((a) => a.key)),
  'Clinic Entry Manager': [
    'dashboard:view', 'cases:view', 'case:create', 'case:edit',
    'clinics:view', 'billing:view', 'payment:record', 'advance:deposit',
    'catalog:view', 'notifications:view', 'notifications:send', 'settings:view', 'prefs:edit',
  ],
  'Audit Checker': [
    'dashboard:view', 'cases:view', 'clinics:view', 'billing:view',
    'reports:view', 'reports:export', 'ledger:view', 'audit:view',
    'catalog:view', 'notifications:view', 'settings:view', 'prefs:edit',
  ],
};

/** Custom roles (RBAC v4): baseline ticks loaded from the roles table.
 *  Registered by the context layer whenever roles hydrate or change. */
const CUSTOM_ROLE_BASELINES = new Map<string, string[]>();

export function setCustomRoleBaseline(name: string, permissions: string[]): void {
  if (name) CUSTOM_ROLE_BASELINES.set(name, [...(permissions || [])]);
}

export function clearCustomRoleBaselines(): void {
  CUSTOM_ROLE_BASELINES.clear();
}

/** Built-ins first (code is truth), then custom roles, else none. */
export function roleBaselineFor(role: string): string[] {
  return ROLE_BASELINE[role] || CUSTOM_ROLE_BASELINES.get(role) || [];
}

export const BUILTIN_ROLES: string[] = ['Super Admin', 'Clinic Entry Manager', 'Audit Checker'];

export type BillingAction =
  | 'payment:record'
  | 'advance:deposit'
  | 'credit:issue'
  | 'debit:issue'
  | 'refund:issue'
  | 'payment:edit'
  | 'payment:bulk'
  | 'invoice:void';

export type SystemAction =
  | 'view'
  | 'prefs:edit'
  | 'branding:edit'
  | 'print:edit'
  | 'notifications:edit'
  | 'backup:restore'
  | 'data:wipe'
  | 'updates:install'
  | 'users:manage';

/** Module-level actions for the shell and per-module gates (RBAC v2). */
export type AppAction =
  | 'dashboard:view'
  | 'cases:view'
  | 'case:create'
  | 'case:edit'
  | 'case:delete'
  | 'clinics:view'
  | 'clinic:create'
  | 'clinic:edit'
  | 'pricing:edit'
  | 'contacts:edit'
  | 'billing:view'
  | 'reports:view'
  | 'reports:export'
  | 'ledger:view'
  | 'audit:view'
  | 'catalog:view'
  | 'catalog:edit'
  | 'notifications:view'
  | 'notifications:send'
  | 'settings:view';

/** Everything anywhere in the catalog — used by exhaustive matrix tests. */
export const ALL_ACTIONS: string[] = PERMISSION_MODULES.flatMap((m) => m.actions.map((a) => a.key));

/**
 * The one module gate. Reads the module matrix only — billing posts and
 * system settings have their own helpers so surfaces can stay specific.
 */
function roleBaseline(user: UserProfile, action: string): boolean {
  return roleBaselineFor(user.role).includes(action);
}

function isGranted(user: UserProfile | null | undefined, action: string): boolean {
  if (!user) return false;
  // Legacy bare 'view' SystemAction == Settings screen access.
  const key = action === 'view' ? 'settings:view' : action;
  const isSuper = user.isSuperAdmin || user.role === 'Super Admin';
  if (isSuper) return true;
  if (DESTRUCTIVE_ACTIONS.has(key)) return false;
  if (Array.isArray(user.permissions)) {
    return user.permissions.includes(key);
  }
  // Legacy / unsynced users fall back to their role baseline.
  return roleBaseline(user, key);
}

/** Module gate. */
export function can(user: UserProfile | null | undefined, action: AppAction | string): boolean {
  return isGranted(user, String(action));
}

/** May the user post this billing transaction? (service layer checks too) */
export function canPost(user: UserProfile | null | undefined, action: BillingAction | string): boolean {
  return isGranted(user, String(action));
}

/** May the user mutate system settings? */
export function canManageSystem(user: UserProfile | null | undefined, action: SystemAction | string): boolean {
  return isGranted(user, String(action));
}
