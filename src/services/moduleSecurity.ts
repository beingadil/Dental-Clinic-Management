/**
 * MODULE-LEVEL PASSWORDS — a second lock in front of a module or a chosen
 * subset of its views, separate from the password each operator signs in with.
 *
 * A lab can protect any of the modules listed in LOCKABLE_MODULES, each with
 * its own password. Within a module, the Super Admin chooses whether the door
 * covers every view (a complete module lock) or only some of them — Billing's
 * invoice list can stay open while Print Invoices asks for the password. The
 * password is shared by everyone who needs those views (not created per user):
 * the point is that the books are not readable by whoever happens to be
 * sitting at an unlocked workstation.
 *
 * System Settings is deliberately NOT in the list. It is the recovery surface
 * — a Super Admin must always be able to reach Module Security to change or
 * remove a forgotten module password.
 *
 * Storage rules:
 * - only PBKDF2 hashes are written (`pbkdf2$…`), never a password;
 * - the map lives in the SQLite settings store, so a backup carries the locks;
 * - a malformed or half-written row degrades to "not protected" rather than
 *   locking the installation out of its own modules.
 *
 * The unlock is deliberately IN MEMORY and per visit: leave the module and it
 * asks again. Persisting the unlock in localStorage would turn a module lock
 * into a decoration.
 */
import { hashPassword, verifyPassword } from '../db/crypto';
import { auditRepo, settingsRepo } from '../db/repos';
import { REPORTS_ENTRY_ID, REPORTS_TABS } from '../components/common/financeTabs';

const NAMESPACE = 'security';
const MODULE_LOCKS_KEY = 'module_locks';
/** The single-module row written by the first version of this feature. */
const LEGACY_REPORTS_KEY = 'reports_access';

/** Short enough to type from memory at a shared workstation, long enough to
 *  be a real credential. Mirrors the login password floor. */
export const MIN_MODULE_PASSWORD_LENGTH = 8;

export type LockableModuleId =
  | 'dashboard'
  | 'cases'
  | 'labs'
  | 'billing'
  | 'catalog'
  | 'reports'
  | 'notifications';

export interface LockableModuleDef {
  id: LockableModuleId;
  label: string;
  description: string;
  /** Every shell view id that belongs to this module. A password on the
   *  module covers all of them. */
  views: readonly string[];
}

/**
 * The modules a Super Admin may protect, in the order the rail lists them.
 *
 * Billing & Invoices and Analytics & Reports own two and three view ids
 * respectively; locking the module locks the whole group, so a second tab is
 * never a way around the first.
 */
export const LOCKABLE_MODULES: readonly LockableModuleDef[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'The operational board and its KPI cards.',
    views: ['dashboard'],
  },
  {
    id: 'cases',
    label: 'Case Management',
    description: 'Case list, case detail and the laboratory workflow.',
    views: ['cases'],
  },
  {
    id: 'labs',
    label: 'Dental Clinics',
    description: 'Clinic accounts, balances and contact records.',
    views: ['labs'],
  },
  {
    id: 'billing',
    label: 'Billing & Invoices',
    description: 'Invoice recording, payments and batch statement printing.',
    views: ['billing', 'print-invoices'],
  },
  {
    id: 'catalog',
    label: 'Price List & Catalog',
    description: 'Products, procedures and pricing.',
    views: ['catalog'],
  },
  {
    id: 'reports',
    label: 'Analytics & Reports',
    description: 'General Ledger, Reports & Statements and the Insight board.',
    /* The rail reuses REPORTS_ENTRY_ID for the first tab, so it is an alias of
       the General Ledger surface rather than a fourth destination. Coverage
       lists the real tabs only; moduleForView still maps the alias in. */
    views: REPORTS_TABS.map((tab) => tab.id),
  },
  {
    id: 'notifications',
    label: 'System Inbox',
    description: 'Operational alerts, reminders and unread messages.',
    views: ['notifications'],
  },
];

const LOCKABLE_IDS = new Set<LockableModuleId>(LOCKABLE_MODULES.map((m) => m.id));

/** The module a shell view belongs to, or null for surfaces that are not
 *  lockable (Settings, login, dialogs outside the rail). */
export function moduleForView(view: string): LockableModuleId | null {
  // `analytics` is the shell's landing id for the first Reports tab, not a
  // separate surface, so it resolves to the module without becoming a chip.
  if (view === REPORTS_ENTRY_ID) return 'reports';
  return LOCKABLE_MODULES.find((m) => m.views.includes(view))?.id ?? null;
}

export function moduleDefinition(id: LockableModuleId): LockableModuleDef {
  return LOCKABLE_MODULES.find((m) => m.id === id) ?? LOCKABLE_MODULES[0];
}

export function moduleLabel(id: LockableModuleId): string {
  return moduleDefinition(id).label;
}

export interface ModulePasswordLock {
  /** True only when a verifiable hash is stored for this module. */
  enabled: boolean;
  /** PBKDF2 hash (`pbkdf2$…`); empty when no password is configured. */
  passwordHash: string;
  /** Shell view ids this password covers. Older rows have no list and fall
   *  back to every view, which preserves the original whole-module behaviour. */
  views: string[];
  updatedAt?: string;
  updatedBy?: string;
}

/** A module's views with no password in front of them. */
const disabledLock = (id: LockableModuleId): ModulePasswordLock => ({
  enabled: false,
  passwordHash: '',
  views: [...moduleDefinition(id).views],
});

export type ModuleLockMap = Record<LockableModuleId, ModulePasswordLock>;

const emptyMap = (): ModuleLockMap =>
  Object.fromEntries(
    LOCKABLE_MODULES.map((m) => [m.id, disabledLock(m.id)]),
  ) as ModuleLockMap;

/** Keep only the views this module actually owns, de-duplicated and in rail
 *  order. Unknown ids are dropped rather than widening a lock to a surface the
 *  module does not own. */
function pickViews(value: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const wanted = new Set(value.filter((view): view is string => typeof view === 'string'));
  return allowed.filter((view) => wanted.has(view));
}

/** Stored coverage is untrusted: an absent, empty or unknown list means the
 *  whole module, never "protect nothing". */
function normaliseViews(value: unknown, allowed: readonly string[]): string[] {
  const picked = pickViews(value, allowed);
  return picked.length > 0 ? picked : [...allowed];
}

/** Coerce one stored record, or a legacy JSON string, into a lock. */
function normaliseLock(raw: unknown, id: LockableModuleId): ModulePasswordLock {
  const fallback = disabledLock(id);
  if (typeof raw === 'string') {
    try {
      return normaliseLock(JSON.parse(raw), id);
    } catch {
      return fallback;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
  const row = raw as Record<string, unknown>;
  const hash = typeof row.passwordHash === 'string' ? row.passwordHash : '';
  // `enabled` without a hash cannot be verified; treat it as not protected so
  // a corrupt row is a recoverable inconvenience, never a permanent lockout.
  const enabled = row.enabled === true && hash.length > 0;
  return {
    enabled,
    passwordHash: enabled ? hash : '',
    views: normaliseViews(row.views, fallback.views),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined,
    updatedBy: typeof row.updatedBy === 'string' ? row.updatedBy : undefined,
  };
}

function normaliseMap(raw: unknown): ModuleLockMap {
  const out = emptyMap();
  if (typeof raw === 'string') {
    try {
      return normaliseMap(JSON.parse(raw));
    } catch {
      return out;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const modules = (raw as { modules?: unknown }).modules;
  if (!modules || typeof modules !== 'object' || Array.isArray(modules)) return out;
  for (const [id, record] of Object.entries(modules as Record<string, unknown>)) {
    if (LOCKABLE_IDS.has(id as LockableModuleId)) {
      out[id as LockableModuleId] = normaliseLock(record, id as LockableModuleId);
    }
  }
  return out;
}

/**
 * All configured locks, one entry per lockable module.
 *
 * A database written by the first version of this feature has no
 * `module_locks` row, only `reports_access`. That row is folded in on read so
 * an upgrade does not silently unprotect Analytics & Reports; the next write
 * stores the map in the new shape.
 */
export function loadModuleLocks(): ModuleLockMap {
  try {
    const stored = settingsRepo.get(NAMESPACE, MODULE_LOCKS_KEY);
    if (stored !== undefined) return normaliseMap(stored);
    const legacy = settingsRepo.get(NAMESPACE, LEGACY_REPORTS_KEY);
    if (legacy !== undefined) {
      const map = emptyMap();
      map.reports = normaliseLock(legacy, 'reports');
      return map;
    }
  } catch {
    /* fall through to the unlocked map */
  }
  return emptyMap();
}

export function loadModuleLock(id: LockableModuleId): ModulePasswordLock {
  return loadModuleLocks()[id] ?? disabledLock(id);
}

export function isModuleLockEnabled(id: LockableModuleId): boolean {
  return loadModuleLock(id).enabled;
}

/** True only when this exact view is behind the module password. */
export function isViewProtected(id: LockableModuleId, view: string): boolean {
  const lock = loadModuleLock(id);
  return lock.enabled && lock.views.includes(view);
}

/* ------------------------------------------------------------------ *
 * Session unlocks
 *
 * Module scope, not React state: the shell mounts and unmounts gate
 * components as the operator navigates, and an unlock has to survive a switch
 * between two views that belong to the same module (Billing ↔ Print Invoices,
 * Ledger ↔ Statements). The shell locks the module when navigation leaves it.
 * ------------------------------------------------------------------ */

const unlockedModules = new Set<LockableModuleId>();

export const isModuleUnlocked = (id: LockableModuleId): boolean =>
  unlockedModules.has(id);

export const unlockModule = (id: LockableModuleId): void => {
  unlockedModules.add(id);
};

export const lockModule = (id: LockableModuleId): void => {
  unlockedModules.delete(id);
};

export const lockAllModules = (): void => {
  unlockedModules.clear();
};

/** True when this module has no password, or the session already opened it. */
export function canEnterModule(id: LockableModuleId): boolean {
  return !isModuleLockEnabled(id) || isModuleUnlocked(id);
}

function audit(
  actor: string,
  action: string,
  moduleId: LockableModuleId,
  notes: string,
  reason?: string,
): void {
  try {
    auditRepo.log({
      actor: actor || 'System',
      action,
      entity_type: 'settings',
      entity_id: MODULE_LOCKS_KEY,
      entity_ref: moduleLabel(moduleId),
      notes,
      ...(reason ? { reason } : {}),
    });
  } catch {
    /* audit is best-effort; a logging failure must not undo a security write */
  }
}

/** Read-modify-write one module's record, preserving every other lock. */
function writeLock(id: LockableModuleId, lock: ModulePasswordLock): void {
  const map = loadModuleLocks();
  map[id] = lock;
  settingsRepo.set(NAMESPACE, MODULE_LOCKS_KEY, { modules: map });
  lockModule(id);
}

/** Verify a typed module password. An unlocked module accepts everything —
 *  callers that need the distinction use `isModuleLockEnabled` first. */
export async function verifyModulePassword(
  id: LockableModuleId,
  password: string,
): Promise<boolean> {
  const lock = loadModuleLock(id);
  if (!lock.enabled) return true;
  return verifyPassword(password, lock.passwordHash);
}

/**
 * Set (or replace) one module's password. Throws on a too-short value or an
 * empty view selection. Omitting `views` keeps the original behaviour and
 * protects the whole module.
 */
export async function setModulePassword(
  id: LockableModuleId,
  password: string,
  actor = 'System',
  views?: readonly string[],
): Promise<void> {
  if (password.length < MIN_MODULE_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_MODULE_PASSWORD_LENGTH} characters.`);
  }
  const allowed = moduleDefinition(id).views;
  const selected = views === undefined ? [...allowed] : pickViews(views, allowed);
  if (selected.length === 0) {
    throw new Error('Choose at least one view to protect.');
  }
  const hash = await hashPassword(password);
  writeLock(id, {
    enabled: true,
    passwordHash: hash,
    views: selected,
    updatedAt: new Date().toISOString(),
    updatedBy: actor || 'System',
  });
  audit(
    actor,
    'security.module_password.set',
    id,
    `${moduleLabel(id)} password set for ${selected.length} of ${allowed.length} views`,
  );
}

/**
 * Change which views an existing module password covers, without asking for
 * the credential again. The Super Admin is already authenticated, and making a
 * coverage edit require the shared password would be a usability trap. The
 * write still re-locks the module so the new boundary takes effect at once.
 */
export function setModuleLockViews(
  id: LockableModuleId,
  views: readonly string[],
  actor = 'System',
): ModulePasswordLock {
  const lock = loadModuleLock(id);
  if (!lock.enabled) {
    throw new Error('Set a module password before choosing its views.');
  }
  const allowed = moduleDefinition(id).views;
  const selected = pickViews(views, allowed);
  if (selected.length === 0) {
    throw new Error('Choose at least one view to protect.');
  }
  const next: ModulePasswordLock = {
    ...lock,
    views: selected,
    updatedAt: new Date().toISOString(),
    updatedBy: actor || 'System',
  };
  writeLock(id, next);
  audit(
    actor,
    'security.module_password.views_changed',
    id,
    `${moduleLabel(id)} now covers ${selected.length} of ${allowed.length} views`,
  );
  return next;
}

/**
 * Change an existing module password. The current one is required so a
 * forgotten session cannot quietly swap the credential.
 */
export async function changeModulePassword(
  id: LockableModuleId,
  currentPassword: string,
  newPassword: string,
  actor = 'System',
): Promise<{ success: boolean; message: string }> {
  const lock = loadModuleLock(id);
  if (!lock.enabled) {
    return { success: false, message: 'No module password is configured yet.' };
  }
  if (!(await verifyPassword(currentPassword, lock.passwordHash))) {
    audit(actor, 'security.module_password.change_failed', id, 'Incorrect current module password', 'invalid_password');
    return { success: false, message: 'The current module password is incorrect.' };
  }
  if (newPassword.length < MIN_MODULE_PASSWORD_LENGTH) {
    return { success: false, message: `Password must be at least ${MIN_MODULE_PASSWORD_LENGTH} characters.` };
  }
  const hash = await hashPassword(newPassword);
  writeLock(id, {
    ...lock,
    enabled: true,
    passwordHash: hash,
    updatedAt: new Date().toISOString(),
    updatedBy: actor || 'System',
  });
  audit(actor, 'security.module_password.changed', id, `${moduleLabel(id)} password changed`);
  return { success: true, message: 'Module password changed.' };
}

/** Remove protection from one module (a Super Admin action from Settings). */
export function clearModulePassword(id: LockableModuleId, actor = 'System'): void {
  writeLock(id, {
    enabled: false,
    passwordHash: '',
    views: [...moduleDefinition(id).views],
    updatedAt: new Date().toISOString(),
    updatedBy: actor || 'System',
  });
  audit(actor, 'security.module_password.removed', id, `${moduleLabel(id)} password removed`);
}

/** Remove every module password (used by a settings reset / wipe flow). */
export function clearAllModulePasswords(actor = 'System'): void {
  settingsRepo.set(NAMESPACE, MODULE_LOCKS_KEY, { modules: emptyMap() });
  lockAllModules();
  audit(actor, 'security.module_password.removed_all', 'reports', 'All module passwords removed');
}
