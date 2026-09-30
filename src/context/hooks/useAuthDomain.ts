import { useState } from 'react';
import {
  DentalCase, DentalLab, CaseType, Invoice, AppNotification, CaseTemplate,
  LabContact, LabAddress, LabPricingOverride, LabReview, DoctorPreferredLab,
  UserPreferences, BrandingSettings, SavedVoucher, AdvancePayment,
  AccountAdjustment, JournalEntry, AuditEvent, ReconciliationItem,
  CaseAttachment, CaseNote, UserProfile, QcInspection,
} from '../../types';
import type { UserRow } from '../../db/repos';
import { usersRepo } from '../../db/repos';
import { isDatabaseReady, getDatabase } from '../../db/core';
import { hashPassword, verifyPassword } from '../../db/crypto';
import {
  INITIAL_CASES,
  INITIAL_LABS,
  INITIAL_CASE_TYPES,
  INITIAL_INVOICES,
  INITIAL_NOTIFICATIONS,
  INITIAL_TEMPLATES,
  INITIAL_LAB_CONTACTS,
  INITIAL_LAB_ADDRESSES,
  INITIAL_PRICING_OVERRIDES,
  INITIAL_LAB_REVIEWS,
  INITIAL_DOCTOR_PREFERENCES,
  INITIAL_USER_PREFERENCES,
  INITIAL_ADVANCE_PAYMENTS,
  INITIAL_ADJUSTMENTS,
  INITIAL_JOURNAL_ENTRIES,
  INITIAL_AUDIT_EVENTS,
  INITIAL_RECONCILIATION_ITEMS,
} from '../../data/initialData';
import { DEFAULT_BRANDING_SETTINGS } from '../../db/defaults';

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
  setCurrentView: (view: 'dashboard' | 'cases' | 'labs' | 'billing' | 'catalog' | 'analytics' | 'inbox' | 'settings') => void;
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
}) {
  const {
    user, setUser, users, setUsers, setCurrentView, loginBackoffState, showToast, genId, snapshot,
    setCases, setLabs, setCaseTypes, setInvoices, setAdvancePayments, setAccountAdjustments,
    setJournalEntries, setAuditEvents, setReconciliationItems, setNotifications, setTemplates,
    setLabContacts, setLabAddresses, setPricingOverrides, setLabReviews, setDoctorPreferences,
    setUserPreferences, setBrandingSettings, setSavedVouchers, setCaseAttachments, setCaseNotes,
    setQcInspections,
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
      { id, username, email, name, role: 'Super Admin' as const, isSuperAdmin: true, created_at: new Date().toISOString().split('T')[0] },
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
      if (row && (await verifyPassword(passwordAttempt, row.password_hash))) {
        authenticatedUser = {
          id: row.id,
          username: row.username,
          email: row.email,
          name: row.name,
          role: row.role as UserProfile['role'],
          isSuperAdmin: !!row.is_super_admin,
          created_at: row.created_at,
        };
      }
    }

    if (authenticatedUser) {
      loginBackoffState.current.delete(cleanInput);
      setUser(authenticatedUser);

      // Role-based routing
      if (authenticatedUser.role === 'Technician') {
        setCurrentView('cases');
      } else if (authenticatedUser.role === 'Billing Manager') {
        setCurrentView('billing');
      } else {
        setCurrentView('dashboard');
      }
      showToast(`Welcome back, ${authenticatedUser.name}!`, 'success');
      return true;
    }

    const failed = loginBackoffState.current.get(cleanInput);
    const nowMs = Date.now();
    const attempt = failed && nowMs - failed.lastFail < 60_000 ? failed.count + 1 : 1;
    const until = attempt >= 5 ? nowMs + Math.min(30_000 * 2 ** (attempt - 5), 300_000) : 0;
    loginBackoffState.current.set(cleanInput, { count: attempt, lastFail: nowMs, until });
    if (until) showToast(`Too many failed attempts — locked for ${Math.ceil((until - nowMs) / 1000)}s`, 'error');
    return false;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('dsw_auth_user');
    localStorage.removeItem('dsw_user');
  };

  const addUser = async (newUser: Omit<UserProfile, 'id' | 'created_at'>) => {
    if (!newUser.password || newUser.password.length < 8) {
      showToast('A password of at least 8 characters is required to create a user', 'error');
      return;
    }
    const created_at = new Date().toISOString().split('T')[0];
    const id = genId('usr');
    const hash = await hashPassword(newUser.password);

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

    const createdUser: UserProfile = { ...newUser, id, created_at, isSuperAdmin: false, password: undefined };
    setUsers((prev) => [...prev, createdUser]);
  };

  const updateUser = async (id: string, updates: Partial<UserProfile>) => {
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
  };

  const deleteUser = (id: string) => {
    // The Super Admin account is protected; every other account can be removed.
    setUsers((prev) => prev.filter((u) => u.id !== id || !!u.isSuperAdmin));
    if (isDatabaseReady()) {
      const row = usersRepo.byId(id);
      if (row && !row.is_super_admin) dbWrite(() => usersRepo.delete(id));
    }
  };

  const changePassword = async (userId: string, currentPasswordAttempt: string, newPassword: string) => {
    const targetUser = users.find((u) => u.id === userId);
    if (!targetUser) {
      return { success: false, message: 'User account not found.' };
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
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, password: undefined } : u)));
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

  const resetToDemoData = () => {
    setCases(INITIAL_CASES);
    setLabs(INITIAL_LABS);
    setCaseTypes(INITIAL_CASE_TYPES);
    setInvoices(INITIAL_INVOICES);
    setAdvancePayments(INITIAL_ADVANCE_PAYMENTS);
    setAccountAdjustments(INITIAL_ADJUSTMENTS);
    setJournalEntries(INITIAL_JOURNAL_ENTRIES);
    setAuditEvents(INITIAL_AUDIT_EVENTS);
    setReconciliationItems(INITIAL_RECONCILIATION_ITEMS);
    setNotifications(INITIAL_NOTIFICATIONS);
    setTemplates(INITIAL_TEMPLATES);
    setLabContacts(INITIAL_LAB_CONTACTS);
    setLabAddresses(INITIAL_LAB_ADDRESSES);
    setPricingOverrides(INITIAL_PRICING_OVERRIDES);
    setLabReviews(INITIAL_LAB_REVIEWS);
    setDoctorPreferences(INITIAL_DOCTOR_PREFERENCES);
    setUserPreferences(INITIAL_USER_PREFERENCES);
    setBrandingSettings(DEFAULT_BRANDING_SETTINGS);
    setSavedVouchers([]);
    setQcInspections([]);
    setCaseAttachments({
      'case-1': [
        { id: 'att-1', case_id: 'case-1', filename: 'shade_guide_a2.jpg', file_type: 'image/jpeg', file_url: '', uploaded_at: '2026-07-26 10:00', uploaded_by: 'Dr. Tariq', file_size: '1.2 MB' },
      ],
    });
    setCaseNotes({
      'case-1': [
        { id: 'note-1', case_id: 'case-1', note_text: 'Anterior wax-up approved by doctor over call.', author: 'Tech Hamza', created_at: '2026-07-26 14:30' },
      ],
    });
  };

  const wipeAllData = () => {
    setCases([]);
    setLabs([]);
    setCaseTypes([]);
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

    // Purge the SQLite tables that the collection sync does not own — the tables
    // it does own are emptied by the write-through rebuild that follows.
    if (isDatabaseReady()) {
      dbWrite(() => {
        const db = getDatabase();
        for (const table of ['chairside_appointments', 'clinical_materials', 'clinical_prep_types', 'shade_guides', 'implant_brands']) {
          try { db.run(`DELETE FROM ${table}`); } catch { /* table absent in this profile */ }
        }
      });
    }

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

  return {
    createInitialAdmin,
    login,
    logout,
    addUser,
    updateUser,
    deleteUser,
    changePassword,
    getBackupData,
    restoreBackupData,
    resetToDemoData,
    wipeAllData,
  };
}
