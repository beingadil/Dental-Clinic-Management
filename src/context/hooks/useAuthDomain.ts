import {
  DentalCase, DentalLab, CaseType, Invoice, AppNotification, CaseTemplate,
  LabContact, LabAddress, LabPricingOverride, LabReview, DoctorPreferredLab,
  UserPreferences, BrandingSettings, SavedVoucher, AdvancePayment,
  AccountAdjustment, JournalEntry, AuditEvent, ReconciliationItem,
  CaseAttachment, CaseNote, UserProfile, QcInspection,
} from '../../types';
import type { UserRow } from '../../db/repos';
import { usersRepo, sessionsRepo, caseTypesRepo, auditRepo, userClinicsRepo, userPermissionsRepo } from '../../db/repos';
import { ROLE_BASELINE, ALL_ACTIONS, DESTRUCTIVE_ACTIONS, roleBaselineFor, setCustomRoleBaseline } from '../../services/permissions';
import { rolesRepo } from '../../db/repos';
import { isDatabaseReady, getDatabase } from '../../db/core';
import { getTodayStr } from '../../utils/dateUtils';
import { hashPassword, verifyPassword } from '../../db/crypto';
import { INITIAL_USER_PREFERENCES, INITIAL_CASE_TYPES } from '../../data/initialData';
import { getClinicalSpecs } from '../../services/clinicalSpecsService';
import { nextBackoff, passwordProblem } from './loginBackoff';
import { DEFAULT_BRANDING_SETTINGS } from '../../db/defaults';

/**
 * D3 — the tables a full wipe has to delete explicitly, because the collection
 * sync does not own them: the write-through rebuild that follows a wipe only
 * re-INSERTs the collections it does own, so anything listed here would
 * otherwise survive a wipe that claims to leave a blank slate.
 *
 * `branding` and `user_preferences` are deliberately absent — setting their
 * state above persists defaults through their own effects (useSettingsDomain).
 *
 * The service catalog (`case_types`) and the clinical spec tables
 * (clinical_materials / clinical_prep_types / shade_guides / implant_brands)
 * are deliberately ABSENT too. They are clinic configuration, not business
 * data: a reset that deleted the price list and the material/prep references
 * left the Catalog and the Odontogram empty until the next app start, and the
 * operator had to rebuild a working catalog from memory to price a case. A
 * reset restores the shipped defaults (see `restoreConfigAfterReset`) instead.
 */
export const WIPE_EXPLICIT_TABLES = [
  'chairside_appointments',
  'notification_config',
  'email_templates',
] as const;

/**
 * Auth + user management + backup/restore/wipe orchestration extracted from
 * AppContext (audit F2 continuation). Receives the raw state it must touch;
 * exposes the exact same function surface AppContext offered before, so the
 * context value and every consumer stay unchanged.
 */
export function useAuthDomain(deps: {
  user: UserProfile | null;
  setUser: React.Dispatch<React.SetStateAction<UserProfile | null>>;
  users: UserProfile[];
  setUsers: React.Dispatch<React.SetStateAction<UserProfile[]>>;
  setCurrentView: (view: 'dashboard' | 'cases' | 'labs' | 'billing' | 'print-invoices' | 'catalog' | 'analytics' | 'inbox' | 'settings') => void;
  loginBackoffState: React.MutableRefObject<Map<string, { count: number; lastFail: number; until: number }>>;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  genId: (prefix: string) => string;
  // Backup/restore/wipe need every collection's raw state.
  snapshot: {
    cases: DentalCase[]; labs: DentalLab[]; caseTypes: CaseType[]; invoices: Invoice[];
    notifications: AppNotification[]; templates: CaseTemplate[]; labContacts: LabContact[];
    labAddresses: LabAddress[]; pricingOverrides: LabPricingOverride[]; labReviews: LabReview[];
    doctorPreferences: DoctorPreferredLab[]; userPreferences: UserPreferences; caseAttachments: Record<string, CaseAttachment[]>;
    caseNotes: Record<string, CaseNote[]>; brandingSettings: BrandingSettings; savedVouchers: SavedVoucher[];
    advancePayments: AdvancePayment[]; accountAdjustments: AccountAdjustment[];
    journalEntries: JournalEntry[]; auditEvents: AuditEvent[]; reconciliationItems: ReconciliationItem[]; users: UserProfile[];
    qcInspections: QcInspection[];
  };
  setCases: React.Dispatch<React.SetStateAction<DentalCase[]>>;
  setLabs: React.Dispatch<React.SetStateAction<DentalLab[]>>;
  setCaseTypes: React.Dispatch<React.SetStateAction<CaseType[]>>;
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  setAdvancePayments: React.Dispatch<React.SetStateAction<AdvancePayment[]>>;
  setAccountAdjustments: React.Dispatch<React.SetStateAction<AccountAdjustment[]>>;
  setJournalEntries: React.Dispatch<React.SetStateAction<JournalEntry[]>>;
  setAuditEvents: React.Dispatch<React.SetStateAction<AuditEvent[]>>;
  setReconciliationItems: React.Dispatch<React.SetStateAction<ReconciliationItem[]>>;
  setNotifications: React.Dispatch<React.SetStateAction<AppNotification[]>>;
  setTemplates: React.Dispatch<React.SetStateAction<CaseTemplate[]>>;
  setLabContacts: React.Dispatch<React.SetStateAction<LabContact[]>>;
  setLabAddresses: React.Dispatch<React.SetStateAction<LabAddress[]>>;
  setPricingOverrides: React.Dispatch<React.SetStateAction<LabPricingOverride[]>>;
  setLabReviews: React.Dispatch<React.SetStateAction<LabReview[]>>;
  setDoctorPreferences: React.Dispatch<React.SetStateAction<DoctorPreferredLab[]>>;
  setUserPreferences: React.Dispatch<React.SetStateAction<UserPreferences>>;
  setBrandingSettings: React.Dispatch<React.SetStateAction<BrandingSettings>>;
  setSavedVouchers: React.Dispatch<React.SetStateAction<SavedVoucher[]>>;
  setCaseAttachments: React.Dispatch<React.SetStateAction<Record<string, CaseAttachment[]>>>;
  setCaseNotes: React.Dispatch<React.SetStateAction<Record<string, CaseNote[]>>>;
  setQcInspections: React.Dispatch<React.SetStateAction<QcInspection[]>>;
  // Re-runs the integrity self-check after a reset, so money rows the reset
  // failed to clear are reported instead of quietly surviving (AppContext).
  refreshIntegrityReport: () => void;
}) {
  const {
    user, setUser, users, setUsers, setCurrentView, loginBackoffState, showToast, genId, snapshot,
    setCases, setLabs, setCaseTypes, setInvoices, setAdvancePayments, setAccountAdjustments,
    setJournalEntries, setAuditEvents, setReconciliationItems, setNotifications, setTemplates,
    setLabContacts, setLabAddresses, setPricingOverrides, setLabReviews, setDoctorPreferences,
    setUserPreferences, setBrandingSettings, setSavedVouchers, setCaseAttachments, setCaseNotes,
    setQcInspections, refreshIntegrityReport,
  } = deps;

  const dbWrite = (fn: () => void): void => {
    if (!isDatabaseReady()) return;
    try {
      fn();
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[cutover] DB write failed:', e?.message || e);
    }
  };

  function safeRemoveItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable — nothing to clean */
    }
  }

  /**
   * Session hygiene (audit S5): a privilege change — role, super-admin flag or
   * a password reset — must invalidate tokens minted under the old authority.
   * Deleting the rows covers every session; for the signed-in user the cached
   * token goes too, so AppContext's session effect mints a fresh one instead of
   * leaving a token that no longer resolves to a session row. A self-service
   * password change drops the token without re-minting, which simply means the
   * operator re-authenticates after the next restart.
   */
  const revokeSessions = (userId: string): void => {
    try {
      if (!isDatabaseReady()) return;
      sessionsRepo.deleteForUser(userId);
      if (user?.id === userId) safeRemoveItem('dsw_session_token');
    } catch {
      /* session hygiene must never block the edit itself */
    }
  };

  // ────────────────────────────────────────────── auth + user management

  // First-run admin provisioning (hashed like any other user)
  const createInitialAdmin = async (name: string, username: string, password: string): Promise<void> => {
    if (!isDatabaseReady()) return;
    if (!password || password.length < 8) {
      showToast('Choose a password of at least 8 characters for the administrator account', 'error');
      return;
    }
    const id = genId('usr');
    const hash = await hashPassword(password);
    // Local account identifier: no lab domain or identity is assumed or leaked.
    const email = `${username}@localhost`;
    dbWrite(() =>
      usersRepo.insert({
        id,
        username,
        email,
        name,
        role: 'Super Admin',
        password_hash: hash,
        password_salt: hash.split('$')[2] ?? '',
        is_super_admin: 1,
      }),
    );
    setUsers((prev) => [
      ...prev,
      { id, username, email, name, role: 'Super Admin' as const, isSuperAdmin: true, created_at: getTodayStr() },
    ]);
  };

  // Authentication & User Management Methods (async — PBKDF2 verification)
  const login = async (usernameOrEmail: string, passwordAttempt: string, rememberMe = false): Promise<boolean> => {
    const cleanInput = usernameOrEmail.trim().toLowerCase();

    // Brute-force backoff: 5 rapid failures per username trigger a 30s
    // enforced wait (doubling, capped). Purely local — the attacker is
    // someone at the keyboard; the goal is making online guessing impractical
    // without locking out the legitimate operator forever.
    const backoff = loginBackoffState.current.get(cleanInput);
    if (backoff && backoff.until > Date.now()) {
      const waitSec = Math.ceil((backoff.until - Date.now()) / 1000);
      showToast(`Too many failed attempts — try again in ${waitSec}s`, 'error');
      return false;
    }

    // Remember me support
    if (rememberMe) {
      try { localStorage.setItem('dsw_remember_user', usernameOrEmail.trim()); } catch (e) {}
    } else {
      try { localStorage.removeItem('dsw_remember_user'); } catch (e) {}
    }

    let authenticatedUser: UserProfile | null = null;

    // ── Credential verification against SQLite (hashed; the plaintext backdoor is removed) ──
    if (isDatabaseReady()) {
      const row = cleanInput.includes('@')
        ? usersRepo.byEmail(cleanInput)
        : usersRepo.byUsername(cleanInput);
      if (row) {
        if (!row.is_active) {
          try {
            auditRepo.log({
              actor: row.username,
              action: 'auth.login.failed',
              entity_type: 'user',
              entity_id: row.id,
              entity_ref: row.username,
              reason: 'inactive_account',
              notes: 'Login denied - account is disabled.',
            });
          } catch { /* audit is best-effort */ }
        } else if (await verifyPassword(passwordAttempt, row.password_hash)) {
          authenticatedUser = {
            id: row.id,
            username: row.username,
            email: row.email,
            name: row.name,
            role: row.role as UserProfile['role'],
            isSuperAdmin: !!row.is_super_admin,
            is_active: !!row.is_active,
            clinic_ids: userClinicsRepo.idsForUser(row.id),
            permissions: (() => {
              if (row.is_super_admin) return ROLE_BASELINE['Super Admin'];
              // Custom-role baselines live in the roles table; register before lookup.
              try { rolesRepo.all().forEach((r) => { if (!r.is_system) setCustomRoleBaseline(r.name, r.permissions); }); } catch { /* best-effort */ }
              let perms = userPermissionsRepo.forUser(row.id);
              if (!perms.length && !userPermissionsRepo.exists(row.id)) {
                const baseline = roleBaselineFor(row.role);
                if (baseline.length) { try { userPermissionsRepo.setForUser(row.id, baseline); } catch {} perms = baseline; }
              }
              return perms;
            })(),
            created_at: row.created_at,
          };
          try {
            auditRepo.log({
              actor: row.username,
              action: 'auth.login',
              entity_type: 'user',
              entity_id: row.id,
              entity_ref: row.username,
              new_state: { role: row.role, is_super_admin: !!row.is_super_admin },
            });
          } catch { /* audit is best-effort */ }
        } else {
          try {
            auditRepo.log({
              actor: row.username,
              action: 'auth.login.failed',
              entity_type: 'user',
              entity_id: row.id,
              entity_ref: row.username,
              reason: 'invalid_password',
            });
          } catch { /* audit is best-effort */ }
        }
      } else {
        try {
          auditRepo.log({
            actor: cleanInput,
            action: 'auth.login.failed',
            entity_type: 'user',
            entity_id: 'unknown',
            entity_ref: cleanInput,
            reason: 'unknown_identity',
          });
        } catch { /* audit is best-effort */ }
      }
    }

    if (authenticatedUser) {
      loginBackoffState.current.delete(cleanInput);
      setUser(authenticatedUser);

      // Role-based routing
      if (authenticatedUser.role === 'Clinic Entry Manager') {
        setCurrentView('cases');
      } else if (authenticatedUser.role === 'Audit Checker') {
        setCurrentView('analytics');
      } else {
        setCurrentView('dashboard');
      }
      showToast(`Welcome back, ${authenticatedUser.name}!`, 'success');
      return true;
    }

    const failed = loginBackoffState.current.get(cleanInput);
    const nowMs = Date.now();
    // The policy lives in ./loginBackoff, not inline. It used to be copied
    // here line for line, which meant the 8 unit tests in loginBackoff.test.ts
    // were validating a copy of the policy that never ran — the copy could
    // drift from the tested one without a single test noticing. One
    // implementation, one test target.
    const next = nextBackoff(failed ?? { count: 0, lastFail: 0, until: 0 }, nowMs);
    loginBackoffState.current.set(cleanInput, next);
    if (next.until) {
      showToast(`Too many failed attempts — locked for ${Math.ceil((next.until - nowMs) / 1000)}s`, 'error');
    }
    return false;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('dsw_auth_user');
    localStorage.removeItem('dsw_user');
  };

  const addUser = async (newUser: Omit<UserProfile, 'id' | 'created_at'>): Promise<UserProfile | undefined> => {
    const pwProblem = passwordProblem(newUser.password);
    if (pwProblem) {
      showToast(`${pwProblem} to create a user`, 'error');
      return;
    }
    const created_at = getTodayStr();
    const id = genId('usr');
    const hash = await hashPassword(newUser.password!);

    dbWrite(() =>
      usersRepo.insert({
        id,
        username: newUser.username,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        password_hash: hash,
        password_salt: hash.split('$')[2] ?? '',
        is_super_admin: newUser.isSuperAdmin ? 1 : 0,
        created_at,
      }),
    );

    // RBAC v3: the add-user form (or API caller) supplies the ticked set
    // explicitly. Destructive actions can never be seeded onto a non-Super
    // account; role baseline applies only when no explicit array was passed.
    const isSuper = !!newUser.isSuperAdmin || newUser.role === 'Super Admin';
    const seedPerms = isSuper
      ? ROLE_BASELINE['Super Admin']
      : (Array.isArray(newUser.permissions)
          ? Array.from(new Set(newUser.permissions)).filter((a) => !DESTRUCTIVE_ACTIONS.has(a))
          : roleBaselineFor(newUser.role));
    try { userPermissionsRepo.setForUser(id, seedPerms, isSuper ? [] : ALL_ACTIONS); } catch { /* best-effort */ }

    const createdUser: UserProfile = { ...newUser, id, created_at, isSuperAdmin: false, password: undefined, permissions: seedPerms };
    setUsers((prev) => [...prev, createdUser]);
    try {
      auditRepo.log({
        actor: user?.name || 'System',
        action: 'user.created',
        entity_type: 'user',
        entity_id: id,
        entity_ref: newUser.username,
        new_state: {
          role: newUser.role,
          is_super_admin: !!newUser.isSuperAdmin,
          username: newUser.username,
          email: newUser.email,
        },
      });
      setAuditEvents((prev) => [
        {
          id: `aud-${Date.now()}`,
          timestamp: new Date().toISOString(),
          actor: user?.name || 'System',
          action: 'user.created',
          entity_type: 'user',
          entity_id: id,
          entity_ref: newUser.username,
          new_state: { role: newUser.role, username: newUser.username },
        },
        ...prev,
      ]);
    } catch { /* audit is best-effort */ }
    return createdUser;
  };

  const updateUser = async (id: string, updates: Partial<UserProfile>) => {
    /* An admin password reset is a password SET, so it obeys the same rule as
       creating an account. It did not: the reset dialog only disabled its
       button on an empty string, so `updateUser(id, { password: 'a' })` was
       accepted and immediately hashed. */
    if (updates.password !== undefined) {
      const pwProblem = passwordProblem(updates.password);
      if (pwProblem) {
        showToast(pwProblem, 'error');
        return;
      }
    }
    // Revoke before the state update: a role / super-admin / password change
    // makes every existing token stale.
    if (updates.role !== undefined || updates.isSuperAdmin !== undefined || !!updates.password) {
      revokeSessions(id);
    }
    setUsers((prev) =>
      prev.map((u) => (u.id === id ? { ...u, ...updates } : u)),
    );
    if (user && user.id === id) {
      setUser((prev) => (prev ? { ...prev, ...updates } : null));
    }

    // Persist to SQLite: profile edits AND password resets must survive a restart.
    if (!isDatabaseReady()) return;
    const persisted: Partial<UserRow> = {};
    if (updates.username !== undefined) persisted.username = updates.username;
    if (updates.email !== undefined) persisted.email = updates.email;
    if (updates.name !== undefined) persisted.name = updates.name;
    if (updates.role !== undefined) persisted.role = updates.role;
    if (updates.isSuperAdmin !== undefined) persisted.is_super_admin = updates.isSuperAdmin ? 1 : 0;
    if (updates.password) {
      const hash = await hashPassword(updates.password);
      persisted.password_hash = hash;
      persisted.password_salt = hash.split('$')[2] ?? '';
    }
    if (Object.keys(persisted).length === 0) return;

    dbWrite(() => usersRepo.update(id, persisted));
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, password: undefined } : u)));

    try {
      const isPasswordReset = !!updates.password;
      const action = isPasswordReset ? 'user.password_reset' : 'user.updated';
      const masked = { ...updates } as any;
      if (masked.password !== undefined) masked.password = '***';
      auditRepo.log({
        actor: user?.name || 'System',
        action,
        entity_type: 'user',
        entity_id: id,
        entity_ref: updates.username || (users.find((u) => u.id === id)?.username || id),
        new_state: masked,
        notes: updates.role ? `role -> ${updates.role}` : undefined,
      });
      setAuditEvents((prev) => [
        {
          id: `aud-${Date.now()}`,
          timestamp: new Date().toISOString(),
          actor: user?.name || 'System',
          action,
          entity_type: 'user',
          entity_id: id,
          entity_ref: updates.username || (users.find((u) => u.id === id)?.username || id),
          new_state: masked,
        },
        ...prev,
      ]);
    } catch { /* audit is best-effort */ }
  };

  const deleteUser = (id: string) => {
    // The Super Admin account is protected; every other account can be removed.
    setUsers((prev) => prev.filter((u) => u.id !== id || !!u.isSuperAdmin));
    if (isDatabaseReady()) {
      const row = usersRepo.byId(id);
      if (row && !row.is_super_admin) {
        dbWrite(() => usersRepo.delete(id));
        try {
          auditRepo.log({
            actor: user?.name || 'System',
            action: 'user.deleted',
            entity_type: 'user',
            entity_id: id,
            entity_ref: row.username,
            old_state: { username: row.username, role: row.role },
          });
          setAuditEvents((prev) => [
            {
              id: `aud-${Date.now()}`,
              timestamp: new Date().toISOString(),
              actor: user?.name || 'System',
              action: 'user.deleted',
              entity_type: 'user',
              entity_id: id,
              entity_ref: row.username,
              old_state: { username: row.username, role: row.role },
            },
            ...prev,
          ]);
        } catch { /* audit is best-effort */ }
      }
    }
  };

  const setUserPermissions = (userId: string, actions: string[]) => {
    const normalized = Array.from(new Set((actions || []).filter(Boolean)));
    const target = users.find((u) => u.id === userId);
    const isSuper = !!target?.isSuperAdmin;
    const safe = isSuper ? normalized : normalized.filter((a) => !DESTRUCTIVE_ACTIONS.has(a));
    if (isDatabaseReady()) {
      try { dbWrite(() => userPermissionsRepo.setForUser(userId, safe, target?.isSuperAdmin ? [] : ALL_ACTIONS)); } catch { /* best-effort */ }
    }
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, permissions: safe } : u)));
    if (user?.id === userId) {
      setUser((prev) => (prev ? { ...prev, permissions: safe } : prev));
    }
    try {
      auditRepo.log({
        actor: user?.name || 'System',
        action: 'user.permissions_changed',
        entity_type: 'user',
        entity_id: userId,
        entity_ref: (target?.username || userId),
        new_state: { permissions: safe },
      });
      setAuditEvents((prev) => [
        {
          id: `aud-${Date.now()}`,
          timestamp: new Date().toISOString(),
          actor: user?.name || 'System',
          action: 'user.permissions_changed',
          entity_type: 'user',
          entity_id: userId,
          entity_ref: (target?.username || userId),
          new_state: { permissions: safe },
        },
        ...prev,
      ]);
    } catch { /* audit is best-effort */ }
  };

  const setUserClinicScope = (userId: string, labIds: string[]) => {
    const normalized = (labIds || []).filter(Boolean);
    if (isDatabaseReady()) {
      try { dbWrite(() => userClinicsRepo.setForUser(userId, normalized)); } catch { /* best-effort */ }
    }
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, clinic_ids: normalized } : u)));
    if (user?.id === userId) {
      setUser((prev) => (prev ? { ...prev, clinic_ids: normalized } : prev));
    }
    try {
      auditRepo.log({
        actor: user?.name || 'System',
        action: 'user.clinic_scope_changed',
        entity_type: 'user',
        entity_id: userId,
        entity_ref: (users.find((u) => u.id === userId)?.username || userId),
        new_state: { clinic_ids: normalized },
      });
      setAuditEvents((prev) => [
        {
          id: `aud-${Date.now()}`,
          timestamp: new Date().toISOString(),
          actor: user?.name || 'System',
          action: 'user.clinic_scope_changed',
          entity_type: 'user',
          entity_id: userId,
          entity_ref: (users.find((u) => u.id === userId)?.username || userId),
          new_state: { clinic_ids: normalized },
        },
        ...prev,
      ]);
    } catch { /* audit is best-effort */ }
  };

  const changePassword = async (userId: string, currentPasswordAttempt: string, newPassword: string) => {
    const targetUser = users.find((u) => u.id === userId);
    if (!targetUser) {
      return { success: false, message: 'User account not found.' };
    }

    /* Self-service had no length rule at all — only "the two new fields match".
       Same hole as the admin reset, closed by the same shared rule. */
    const pwProblem = passwordProblem(newPassword);
    if (pwProblem) {
      return { success: false, message: pwProblem };
    }

    const hash = await hashPassword(newPassword);

    // Verify current password unless a Super Admin is performing the change
    if (isDatabaseReady() && !user?.isSuperAdmin) {
      const row = usersRepo.byId(userId);
      if (!row || !(await verifyPassword(currentPasswordAttempt || '', row.password_hash))) {
        return { success: false, message: 'Current password is incorrect.' };
      }
    }

    dbWrite(() => usersRepo.update(userId, { password_hash: hash, password_salt: hash.split('$')[2] ?? '' }));
    // A new password invalidates sessions minted with the old one (S5).
    revokeSessions(userId);
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, password: undefined } : u)));
    try {
      auditRepo.log({
        actor: user?.name || targetUser.name,
        action: 'user.password_changed',
        entity_type: 'user',
        entity_id: userId,
        entity_ref: targetUser.username,
      });
      setAuditEvents((prev) => [
        {
          id: `aud-${Date.now()}`,
          timestamp: new Date().toISOString(),
          actor: user?.name || targetUser.name,
          action: 'user.password_changed',
          entity_type: 'user',
          entity_id: userId,
          entity_ref: targetUser.username,
        },
        ...prev,
      ]);
    } catch { /* audit is best-effort */ }
    return { success: true, message: 'Password updated successfully!' };
  };

  // ────────────────────────────────────────────── backup / restore / wipe

  const getBackupData = () => {
    return {
      version: '2.0-sqlite-dump',
      export_date: new Date().toISOString(),
      database_name: 'dental_solutions_db',
      tables: { ...snapshot },
    };
  };

  const restoreBackupData = (data: any): boolean => {
    try {
      if (!data || typeof data !== 'object') return false;
      const tables = data.tables || data;
      if (Array.isArray(tables.cases)) setCases(tables.cases);
      if (Array.isArray(tables.labs)) setLabs(tables.labs);
      if (Array.isArray(tables.caseTypes)) setCaseTypes(tables.caseTypes);
      if (Array.isArray(tables.invoices)) setInvoices(tables.invoices);
      if (Array.isArray(tables.advancePayments)) setAdvancePayments(tables.advancePayments);
      if (Array.isArray(tables.accountAdjustments)) setAccountAdjustments(tables.accountAdjustments);
      if (Array.isArray(tables.journalEntries)) setJournalEntries(tables.journalEntries);
      if (Array.isArray(tables.auditEvents)) setAuditEvents(tables.auditEvents);
      if (Array.isArray(tables.reconciliationItems)) setReconciliationItems(tables.reconciliationItems);
      if (Array.isArray(tables.notifications)) setNotifications(tables.notifications);
      if (Array.isArray(tables.templates)) setTemplates(tables.templates);
      if (Array.isArray(tables.labContacts)) setLabContacts(tables.labContacts);
      if (Array.isArray(tables.labAddresses)) setLabAddresses(tables.labAddresses);
      if (Array.isArray(tables.pricingOverrides)) setPricingOverrides(tables.pricingOverrides);
      if (Array.isArray(tables.labReviews)) setLabReviews(tables.labReviews);
      if (Array.isArray(tables.doctorPreferences)) setDoctorPreferences(tables.doctorPreferences);
      if (tables.userPreferences) setUserPreferences(tables.userPreferences);
      if (tables.caseAttachments) setCaseAttachments(tables.caseAttachments);
      if (tables.caseNotes) setCaseNotes(tables.caseNotes);
      if (tables.brandingSettings) setBrandingSettings(tables.brandingSettings);
      if (Array.isArray(tables.savedVouchers)) setSavedVouchers(tables.savedVouchers);
      if (Array.isArray(tables.qcInspections)) setQcInspections(tables.qcInspections);
      if (Array.isArray(tables.users)) setUsers(tables.users.filter((u: any) => !u.is_hidden));
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to restore database backup:', err);
      return false;
    }
  };

  const wipeAllData = () => {
    // Config is restored below, before the sync effect rewrites `case_types`
    // from state — so it must NOT be blanked here.
    setCases([]);
    setLabs([]);
    setInvoices([]);
    setAdvancePayments([]);
    setAccountAdjustments([]);
    setJournalEntries([]);
    setAuditEvents([]);
    setReconciliationItems([]);
    setNotifications([]);
    setTemplates([]);
    setLabContacts([]);
    setLabAddresses([]);
    setPricingOverrides([]);
    setLabReviews([]);
    setDoctorPreferences([]);
    setUserPreferences(INITIAL_USER_PREFERENCES);
    setBrandingSettings(DEFAULT_BRANDING_SETTINGS);
    setSavedVouchers([]);
    setCaseAttachments({});
    setCaseNotes({});
    setQcInspections([]);

    // Purge the SQLite tables the collection sync does not own (D3) — the
    // tables it does own are emptied by the write-through rebuild that follows,
    // and branding / user preferences persist their defaults from the setters
    // above. User accounts are intentionally kept, so staff can still sign in.
    if (isDatabaseReady()) {
      dbWrite(() => {
        const db = getDatabase();
        for (const table of WIPE_EXPLICIT_TABLES) {
          try { db.run(`DELETE FROM ${table}`); } catch { /* table absent in this profile */ }
        }
      });
    }

    // Clinic configuration survives the reset — and is reloaded HERE, not left
    // to a later mount, so the Catalog and Odontogram are usable the moment
    // the reset dialog closes instead of blank until the next app start.
    setCaseTypes(restoreConfigAfterReset());

    // Integrity self-check: a reset claims to leave a blank slate, so prove it.
    // Runs after the write-through rebuild (AppContext orders the sync effect
    // first), and raises a toast naming every failed check rather than letting
    // orphaned money rows survive in silence.
    refreshIntegrityReport();

    // Purge local storage safely
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        Object.keys(localStorage).forEach((key) => {
          if (key && key.startsWith('dsw_')) {
            safeRemoveItem(key);
          }
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Notice clearing local storage:', e);
    }
  };

  /**
   * Clinic configuration that a system reset keeps: the service catalog and the
   * clinical specs. Both are configuration, not business data — deleting them
   * cost the operator a working price list until the next app start.
   *
   * The catalog is owned by the collection sync, so returning it into state
   * before that sync runs is what persists it. The clinical spec tables have no
   * React owner at all — `clinicalSpecsService` reads them straight out of
   * SQLite — so keeping them means not touching the rows, then broadcasting the
   * current set so an Odontogram or case editor open over the reset dialog
   * repaints immediately.
   */
  const restoreConfigAfterReset = (): CaseType[] => {
    let caseTypes: CaseType[] = [];
    if (isDatabaseReady()) {
      try {
        caseTypes = caseTypesRepo.all() as CaseType[];
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error('[reset] could not reload the service catalog:', e?.message || e);
      }
    }
    // A database whose catalog was never seeded still gets the shipped
    // defaults — a reset must never hand back an unpriceable clinic.
    if (caseTypes.length === 0) caseTypes = INITIAL_CASE_TYPES;

    try {
      const specs = getClinicalSpecs(); // self-seeds the default rows if empty
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('clinical-specs-updated', { detail: specs }));
      }
    } catch {
      /* specs are non-critical: the Odontogram falls back to its own defaults */
    }

    return caseTypes;
  };

  return {
    createInitialAdmin,
    login,
    logout,
    addUser,
    updateUser,
    deleteUser,
    changePassword,
    setUserPermissions,
    setUserClinicScope,
    getBackupData,
    restoreBackupData,
    wipeAllData,
  };
}
