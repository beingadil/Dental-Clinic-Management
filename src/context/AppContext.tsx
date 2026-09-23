import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import {
  DentalCase,
  DentalLab,
  CaseType,
  Invoice,
  AppNotification,
  CaseTemplate,
  LabContact,
  LabAddress,
  LabPricingOverride,
  LabReview,
  DoctorPreferredLab,
  UserPreferences,
  UserProfile,
  PaymentRecord,
  PaymentAttachment,
  LedgerEntry,
  LedgerEntryType,
  LabFinancialSummary,
  CaseNote,
  CaseAttachment,
  CaseStatus,
  PriorityLevel,
  BrandingSettings,
  SavedVoucher,
  AdvancePayment,
  AccountAdjustment,
  JournalEntry,
  AuditEvent,
  ReconciliationItem,
  PaymentAllocation,
  InvoiceStatusV2,
  PaymentStatusV2,
  AdvanceCreditStatus,
  QcInspection,
  QcCaseState,
  QcMetrics,
  QcCommand,
  QcReceipt
} from '../types';
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
  INITIAL_RECONCILIATION_ITEMS
} from '../data/initialData';
import {
  buildInvoiceJournal,
  buildPaymentJournal,
  buildAdvanceDepositJournal,
  buildApplyAdvanceJournal,
  buildAdjustmentJournal,
  buildReversalJournal,
  deriveInvoiceStatus,
  formatPKR,
  getAgingBucket
} from '../services/financeDomain';
import {
  computeQcMetrics,
  deriveQcCaseState,
  nextInspectionNo,
  qcDedupeKey,
  qcGateSatisfied,
  qcReasonLabel,
  statusAfterQc,
  QC_GATED_STATUSES,
} from '../services/qcDomain';
import { getTodayStr } from '../utils/dateUtils';
import { sqliteDb } from '../services/sqliteDbService';import { useSettingsDomain } from './hooks/useSettingsDomain';
import { useCasesDomain } from './hooks/useCasesDomain';
import { useBillingDomain } from './hooks/useBillingDomain';
import { hydrateAllFromDb as hydrateAllFromDbShared, dbRows, dbMirror, mirrorSet, groupByCase, attachmentsByCase } from './hooks/domainState';
import { isDatabaseReady, getDatabase } from '../db/core';
import { DEFAULT_BRANDING_SETTINGS } from '../db/defaults';
import { syncCollectionsToDb } from '../db/syncCore';
import {
  usersRepo, labsRepo, caseTypesRepo, casesRepo, caseNotesRepo, attachmentsRepo,
  caseTemplatesRepo, invoicesRepo, advancePaymentsRepo, adjustmentsRepo, journalRepo,
  notificationsRepo, settingsRepo, vouchersRepo, auditRepo,
  sessionsRepo, labContactsRepo, labAddressesRepo, labPricingOverridesRepo, labReviewsRepo,
  doctorPreferredLabsRepo, reconciliationRepo, qcInspectionsRepo,
} from '../db/repos';
import type { UserRow } from '../db/repos';
import { hashPassword, verifyPassword } from '../db/crypto';


// ─────────────────────────────────────────────────────────────
// SQLite sync: hydration, DB writes, mirror cache, diagnostics
// ─────────────────────────────────────────────────────────────

// Shared hydration helpers (mirror, dbRows, groupers) live in ./hooks/domainState
// so every domain hook and this context share ONE dbMirror instance.
let dbReflected = false;
export function getDbReflected(): boolean {
  return dbReflected;
}

function hydrateAllFromDb(): boolean {
  const ok = hydrateAllFromDbShared();
  if (ok) dbReflected = true;
  return ok;
}

/** DB write helper — no-ops when the engine is not booted (tests). */
function dbWrite(fn: () => void): void {
  if (!isDatabaseReady()) return;
  try {
    fn();
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[cutover] DB write failed:', e?.message || e);
  }
}

export const DEFAULT_BRANDING = DEFAULT_BRANDING_SETTINGS;

interface AppContextType {
  // Navigation & User
  currentView: string;
  setCurrentView: (view: string) => void;
  user: UserProfile | null;
  users: UserProfile[];
  login: (usernameOrEmail: string, passwordAttempt: string, rememberMe?: boolean) => Promise<boolean>;
  logout: () => void;
  todayStr: string;
  addUser: (newUser: Omit<UserProfile, 'id' | 'created_at'>) => void | Promise<void>;
  updateUser: (id: string, updates: Partial<UserProfile>) => void;
  deleteUser: (id: string) => void;
  changePassword: (userId: string, currentPasswordAttempt: string, newPassword: string) => Promise<{ success: boolean; message: string }>;
  createInitialAdmin: (name: string, username: string, password: string) => Promise<void>;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;

  // Data collections
  cases: DentalCase[];
  labs: DentalLab[];
  caseTypes: CaseType[];
  invoices: Invoice[];
  notifications: AppNotification[];
  templates: CaseTemplate[];
  labContacts: LabContact[];
  labAddresses: LabAddress[];
  pricingOverrides: LabPricingOverride[];
  labReviews: LabReview[];
  doctorPreferences: DoctorPreferredLab[];
  userPreferences: UserPreferences;
  caseAttachments: Record<string, CaseAttachment[]>;
  /* Quality control — append-only stream, one command, derived reads. */
  qcInspections: QcInspection[];
  recordQcCase: (command: QcCommand) => QcReceipt;
  getQcState: (caseId: string) => QcCaseState;
  getQcMetrics: () => QcMetrics;
  caseNotes: Record<string, CaseNote[]>;
  brandingSettings: BrandingSettings;
  savedVouchers: SavedVoucher[];
  advancePayments: AdvancePayment[];
  accountAdjustments: AccountAdjustment[];
  journalEntries: JournalEntry[];
  auditEvents: AuditEvent[];
  reconciliationItems: ReconciliationItem[];

  // Computed metrics
  unreadCount: number;
  overdueCount: number;
  dueTodayCount: number;
  dueThisWeekCount: number;

  // Actions
  // Branding
  updateBrandingSettings: (updates: Partial<BrandingSettings>) => void;

  // Backup & Restore
  getBackupData: () => any;
  restoreBackupData: (data: any) => boolean;
  resetToDemoData: () => void;
  wipeAllData: () => void;

  // Cases
  addCase: (caseData: Omit<DentalCase, 'id' | 'case_number' | 'created_at' | 'updated_at' | 'history'>) => DentalCase;
  updateCase: (id: string, updates: Partial<DentalCase>, note?: string) => void;
  deleteCase: (id: string) => void;
  addCaseNote: (caseId: string, noteText: string, author: string) => void;
  editCaseNote: (caseId: string, noteId: string, noteText: string) => void;
  deleteCaseNote: (caseId: string, noteId: string) => void;
  addCaseAttachment: (caseId: string, file: Omit<CaseAttachment, 'id' | 'case_id' | 'uploaded_at'>) => void;
  deleteCaseAttachment: (caseId: string, attachmentId: string) => void;

  // Templates
  saveAsTemplate: (templateName: string, caseData: DentalCase, description?: string) => void;
  deleteTemplate: (templateId: string) => void;

  // Labs
  addLab: (lab: Omit<DentalLab, 'id' | 'created_at' | 'rating' | 'reviews_count'>) => DentalLab;
  updateLab: (id: string, updates: Partial<DentalLab>) => void;
  deleteLab: (id: string) => void;
  addLabContact: (contact: Omit<LabContact, 'id'>) => void;
  updateLabContact: (id: string, updates: Partial<LabContact>) => void;
  deleteLabContact: (id: string) => void;
  addLabAddress: (address: Omit<LabAddress, 'id'>) => void;
  updateLabAddress: (id: string, updates: Partial<LabAddress>) => void;
  deleteLabAddress: (id: string) => void;
  addPricingOverride: (override: Omit<LabPricingOverride, 'id'>) => void;
  deletePricingOverride: (id: string) => void;

  // Doctor Preferences
  setDoctorPreferredLab: (doctorName: string, labId: string, labName: string) => void;
  getDoctorPreferredLab: (doctorName: string) => DoctorPreferredLab | undefined;

  // Case Types
  addCaseType: (ct: Omit<CaseType, 'id' | 'created_at'>) => void;
  updateCaseType: (id: string, updates: Partial<CaseType>) => void;
  deleteCaseType: (id: string) => void;

  // Invoices & Billing
  recordPayment: (
    invoiceId: string, 
    amount: number, 
    method: PaymentRecord['payment_method'], 
    notes?: string,
    referenceNumber?: string,
    attachments?: PaymentAttachment[]
  ) => PaymentRecord | null;
  deletePayment: (paymentId: string) => void;
  allPayments: PaymentRecord[];
  getLabFinancialSummary: (labId: string) => LabFinancialSummary;
  getClinicFinancialSummary: (clinicId: string) => LabFinancialSummary;
  getLedgerEntries: (filterLabId?: string) => LedgerEntry[];
  generatePaymentNumber: () => string;
  updateInvoice: (id: string, updates: Partial<Invoice>) => void;
  bulkMarkPaid: (invoiceIds: string[]) => void;
  deleteInvoice: (id: string) => void;

  // Advance Payments & Account Adjustments
  recordAdvancePayment: (
    labId: string,
    amount: number,
    method: 'cash' | 'bank' | 'cheque',
    notes?: string,
    referenceNumber?: string,
    attachments?: PaymentAttachment[]
  ) => AdvancePayment;
  applyAdvanceCredit: (
    labId: string,
    invoiceId: string,
    amount: number,
    notes?: string
  ) => boolean;
  recordAccountAdjustment: (
    labId: string,
    type: 'credit_note' | 'debit_adjustment' | 'refund',
    amount: number,
    reason: string,
    referenceNumber?: string,
    attachments?: PaymentAttachment[]
  ) => AccountAdjustment;
  deleteAdvancePayment: (advanceId: string) => void;
  deleteAccountAdjustment: (adjustmentId: string) => void;

  // Payments & Receivables 2.0 Core Financial Engine
  recordTransactionV2: (command: {
    clinicId: string;
    amount: number;
    method: 'cash' | 'bank' | 'cheque' | 'advance';
    date: string;
    referenceNumber?: string;
    notes?: string;
    attachments?: PaymentAttachment[];
    allocations: { invoiceId: string; amount: number }[];
    saveRemainingAsAdvance?: boolean;
    isVerified?: boolean;
  }) => { payment: PaymentRecord; receiptNumber: string; journal: JournalEntry };
  recordAdvanceDepositV2: (command: {
    clinicId: string;
    amount: number;
    method: 'cash' | 'bank' | 'cheque';
    date?: string;
    referenceNumber?: string;
    notes?: string;
    attachments?: PaymentAttachment[];
    isVerified?: boolean;
  }) => { advance: AdvancePayment; receiptNumber: string; journal: JournalEntry };
  applyAdvanceCreditV2: (command: {
    clinicId: string;
    invoiceId: string;
    amount: number;
    notes?: string;
  }) => boolean;
  issueCreditNoteV2: (command: {
    clinicId: string;
    invoiceId: string;
    amount: number;
    reasonCode: string;
    reasonText: string;
    approvedBy?: string;
  }) => AccountAdjustment;
  reverseTransactionV2: (command: {
    referenceType: 'payment' | 'advance_payment' | 'adjustment';
    referenceId: string;
    reason: string;
  }) => boolean;
  reconcileItemV2: (id: string, matchNotes?: string) => void;
  flagReconciliationExceptionV2: (id: string, reason: string) => void;
  getJournalEntriesForEntity: (referenceId: string) => JournalEntry[];
  getAuditHistoryForEntity: (entityId: string) => AuditEvent[];

  // Saved Vouchers & Slips
  saveVoucherToSystem: (voucher: Omit<SavedVoucher, 'id' | 'created_at' | 'saved_by'>) => SavedVoucher;
  deleteSavedVoucher: (id: string) => void;

  // Notifications
  markNotificationRead: (id: string) => void;
  markNotificationUnread: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearReadNotifications: () => void;
  clearAllNotifications: () => void;
  archiveNotification: (id: string) => void;
  restoreNotification: (id: string) => void;
  deleteNotification: (id: string) => void;
  bulkDeleteNotifications: (ids: string[]) => void;
  addNotification: (notification: Omit<AppNotification, 'id' | 'created_at'>) => void;
  markAsRead: (id: string) => void;
  markAllNotificationsAsRead: () => void;

  // Selected Case Modal helper
  selectedCaseForModal: DentalCase | null;
  setSelectedCaseForModal: (c: DentalCase | null) => void;

  // Global In-App Toast
  toast: { id: string; message: string; type: 'success' | 'error' | 'info' | 'warning' } | null;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  hideToast: () => void;

  // Global In-App Confirmation Modal
  confirmModal: {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    isDanger?: boolean;
    onConfirm: () => void;
  } | null;
  confirmAction: (options: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    isDanger?: boolean;
    onConfirm: () => void;
  }) => void;
  closeConfirmModal: () => void;

  // Filter presets for navigation
  caseFilterPreset: {
    overdue?: boolean;
    dueToday?: boolean;
    dueThisWeek?: boolean;
    dueSoon?: boolean;
    labId?: string;
    status?: string;
  } | null;
  setCaseFilterPreset: (preset: {
    overdue?: boolean;
    dueToday?: boolean;
    dueThisWeek?: boolean;
    dueSoon?: boolean;
    labId?: string;
    status?: string;
  } | null) => void;

  billingFilterPreset: {
    labId?: string;
    status?: string;
  } | null;
  setBillingFilterPreset: (preset: {
    labId?: string;
    status?: string;
  } | null) => void;

  // Settings
  updateUserPreferences: (prefs: Partial<UserPreferences>) => void;
  
  // Quick Search
  searchTerm: string;
  setSearchTerm: (term: string) => void;

  // SQLite Database Service Layer Instance
  sqliteDb: typeof sqliteDb;
}

/**
 * Fallback user list when the database has no accounts yet — intentionally
 * EMPTY. Identities, emails and passwords are never hardcoded: the first Super
 * Admin is created through the login screen's setup flow.
 */
export const INITIAL_USERS: UserProfile[] = [];

const AppContext = createContext<AppContextType | undefined>(undefined);

/**
 * Hex token from the platform CSPRNG. The Math.random fallback only ever runs on
 * a runtime that exposes no WebCrypto at all (neither is acceptable for tokens,
 * but a missing crypto object must not crash the boot path).
 */
function randomToken(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  try {
    crypto.getRandomValues(buf);
  } catch {
    for (let i = 0; i < buf.length; i += 1) buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Safe LocalStorage Reader Helper to prevent uncaught runtime JSON crashes
function safeGetJSON<T>(key: string, fallback: T): T {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback;
    const saved = localStorage.getItem(key);
    if (!saved || saved === 'undefined' || saved === 'null') return fallback;
    const parsed = JSON.parse(saved);
    return parsed !== null && parsed !== undefined ? parsed : fallback;
  } catch (e) {
    console.warn(`Safe parsing fallback triggered for "${key}":`, e);
    return fallback;
  }
}

// Safe LocalStorage Writer Helper to prevent quota or access uncaught exceptions
function safeSetJSON(key: string, value: any): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Failed to write to localStorage for "${key}":`, e);
  }
}

// Safe LocalStorage Remove Helper
function safeRemoveItem(key: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    localStorage.removeItem(key);
  } catch (e) {
    console.warn(`Failed to remove item from localStorage for "${key}":`, e);
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentView, setCurrentView] = useState<string>('dashboard');

  const [users, setUsers] = useState<UserProfile[]>(() => {
    if (dbMirror['users']) return dbMirror['users'] as UserProfile[];
    const loadedUsers: UserProfile[] = sqliteDb.users.getAll();
    if (Array.isArray(loadedUsers) && loadedUsers.length > 0) return loadedUsers;
    return INITIAL_USERS; // password-free identity fallback (DB seeds real hashed users)
  });

  const [user, setUser] = useState<UserProfile | null>(() => {
    // Session restore: valid token in localStorage → matching row in the SQLite
    // `sessions` table → the user. Otherwise the app starts logged out at the
    // login screen (never auto-authenticated, never from a cached user object).
    try {
      if (isDatabaseReady()) {
        const token = safeGetJSON<string | null>('dsw_session_token', null);
        if (token) {
          const sess = sessionsRepo.findValid(token);
          if (sess) {
            const row = usersRepo.byId(sess.user_id) as any;
            if (row) {
              const safe = { ...row } as any;
              delete safe.password_hash;
              delete safe.password_salt;
              delete safe.password;
              safe.isSuperAdmin = !!row.is_super_admin;
              return safe as UserProfile;
            }
          } else {
            safeRemoveItem('dsw_session_token');
          }
        }
      }
    } catch { /* fall through to logged-out */ }
    return null;
  });

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCaseForModal, setSelectedCaseForModal] = useState<DentalCase | null>(null);

  // Helper for generating unique IDs
  const genId = (prefix: string): string => {
    const uuid = globalThis.crypto?.randomUUID?.();
    return uuid ? `${prefix}-${uuid}` : `${prefix}-${Date.now()}-${randomToken(9)}`;
  };

  // Persistent Collections — hydrated from the SQLite mirror at mount.
  // Legacy dsw_* keys are read ONLY by the one-time legacyMigrator; the app's
  // active persistence layer is SQLite alone.
  // Cases + billing domains live in their own hooks (same surface, same
  // hydration order); settings in useSettingsDomain. Persistence and the
  // restore/wipe flows below are unchanged — they consume the identical names.
  const {
    cases, setCases, labs, setLabs, caseTypes, setCaseTypes,
    caseAttachments, setCaseAttachments, caseNotes, setCaseNotes,
    qcInspections, setQcInspections,
  } = useCasesDomain();
  const {
    invoices, setInvoices, notifications, setNotifications,
    savedVouchers, setSavedVouchers, advancePayments, setAdvancePayments,
    accountAdjustments, setAccountAdjustments, journalEntries, setJournalEntries,
    auditEvents, setAuditEvents, reconciliationItems, setReconciliationItems,
  } = useBillingDomain();

  const [templates, setTemplates] = useState<CaseTemplate[]>(() => dbRows('templates', () => caseTemplatesRepo.all() as unknown as CaseTemplate[]));
  const [labContacts, setLabContacts] = useState<LabContact[]>(() => dbRows('labContacts', () => labContactsRepo.all() as LabContact[]));
  const [labAddresses, setLabAddresses] = useState<LabAddress[]>(() => dbRows('labAddresses', () => labAddressesRepo.all() as LabAddress[]));
  const [pricingOverrides, setPricingOverrides] = useState<LabPricingOverride[]>(() => dbRows('pricingOverrides', () => labPricingOverridesRepo.all() as LabPricingOverride[]));
  const [labReviews, setLabReviews] = useState<LabReview[]>(() => dbRows('labReviews', () => labReviewsRepo.all() as LabReview[]));
  const [doctorPreferences, setDoctorPreferences] = useState<DoctorPreferredLab[]>(() => dbRows('doctorPreferences', () => doctorPreferredLabsRepo.all() as DoctorPreferredLab[]));
  // Settings domain (branding + preferences) lives in useSettingsDomain —
  // identical surface, same SQLite write-through behavior.
  const { brandingSettings, setBrandingSettings, userPreferences, setUserPreferences } = useSettingsDomain();

  // ─── SQLite write-through sync (replaces all dsw_* localStorage writes) ───
  // React state = UI mirror; SQLite = authoritative store.
  useEffect(() => {
    syncCollectionsToDb({
      cases, labs, caseTypes, invoices, advancePayments, accountAdjustments,
      journalEntries, reconciliationItems, notifications, savedVouchers, auditEvents,
      templates, labContacts, labAddresses, pricingOverrides, labReviews, doctorPreferences,
      caseNotes, caseAttachments, qcInspections,
    });
  }, [
    cases, labs, caseTypes, invoices, advancePayments, accountAdjustments,
    journalEntries, reconciliationItems, notifications, savedVouchers, auditEvents,
    templates, labContacts, labAddresses, pricingOverrides, labReviews, doctorPreferences,
    caseNotes, caseAttachments, qcInspections,
  ]);  // Settings persist ONLY into the namespaced settings store (SQLite) —
  // handled inside useSettingsDomain (single source of truth).

  // One-time legacy sweep: business data lives in SQLite only. Once the
  // migrator marker is set (import done), every other dsw_* key is dead
  // weight — remove it. Keys that are still live (browser persistence
  // snapshot, dirty flag, session token, remember-me, the marker itself)
  // are preserved.
  useEffect(() => {
    if (!isDatabaseReady()) return;
    try {
      if (!localStorage.getItem('dsw_legacy_migration_done')) return;
      const preserve = new Set([
        'dsw_sqlite_snapshot',
        'dsw_sqlite_dirty',
        'dsw_session_token',
        'dsw_remember_user',
        'dsw_legacy_migration_done',
      ]);
      const stale: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('dsw_') && !preserve.has(k)) stale.push(k);
      }
      stale.forEach((k) => {
        try { localStorage.removeItem(k); } catch { /* ignore */ }
      });
      if (stale.length > 0) {
        // eslint-disable-next-line no-console
        console.info(`[cutover] removed ${stale.length} legacy dsw_* key(s) — SQLite is the only store`);
      }
    } catch { /* storage unavailable — nothing to sweep */ }
  }, [user]);

  // Session state lives in the SQLite `sessions` table. localStorage caches only
  // the opaque token (never the user object, never a password) so a valid
  // session survives restarts.
  useEffect(() => {
    if (!isDatabaseReady()) return;
    try {
      if (user) {
        sessionsRepo.purgeExpired();
        let token = safeGetJSON<string | null>('dsw_session_token', null);
        const valid = token ? sessionsRepo.findValid(token) : undefined;
        if (!valid || valid.user_id !== user.id) {
          if (token) sessionsRepo.delete(token);
          const newToken: string =
            (crypto as any)?.randomUUID?.() ??
            `sess-${Date.now()}-${randomToken()}`;
          sessionsRepo.create(newToken, user.id, new Date(Date.now() + 30 * 86400000).toISOString());
          safeSetJSON('dsw_session_token', newToken);
        }
      } else {
        const token = safeGetJSON<string | null>('dsw_session_token', null);
        if (token) {
          sessionsRepo.delete(token);
          safeRemoveItem('dsw_session_token');
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[session] persist failed:', e);
    }
  }, [user]);

  // Filter Presets & Navigation States
  const [caseFilterPreset, setCaseFilterPreset] = useState<{
    overdue?: boolean;
    dueToday?: boolean;
    dueThisWeek?: boolean;
    dueSoon?: boolean;
    labId?: string;
    status?: string;
  } | null>(null);

  const [billingFilterPreset, setBillingFilterPreset] = useState<{
    labId?: string;
    status?: string;
  } | null>(null);

  // Global Toast
  const [toast, setToast] = useState<{ id: string; message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'success') => {
    const id = `toast-${Date.now()}`;
    setToast({ id, message, type });
  };

  const hideToast = () => {
    setToast(null);
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Global Confirmation Modal
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    isDanger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const confirmAction = (options: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    isDanger?: boolean;
    onConfirm: () => void;
  }) => {
    setConfirmModal({
      isOpen: true,
      ...options
    });
  };

  const closeConfirmModal = () => {
    setConfirmModal(null);
  };  // First-run admin provisioning (hashed like any other user)
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
      })
    );
    setUsers((prev) => [
      ...prev,
      { id, username, email, name, role: 'Super Admin' as const, isSuperAdmin: true, created_at: new Date().toISOString().split('T')[0] },
    ]);
  };

  // Authentication & User Management Methods (async — PBKDF2 verification)
  const login = async (usernameOrEmail: string, passwordAttempt: string, rememberMe = false): Promise<boolean> => {
    const cleanInput = usernameOrEmail.trim().toLowerCase();

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
      })
    );

    const createdUser: UserProfile = { ...newUser, id, created_at, isSuperAdmin: false, password: undefined };
    setUsers((prev) => [...prev, createdUser]);
  };

  const updateUser = async (id: string, updates: Partial<UserProfile>) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === id ? { ...u, ...updates } : u))
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

  // Save Voucher to System Database & History
  const saveVoucherToSystem = (voucherData: Omit<SavedVoucher, 'id' | 'created_at' | 'saved_by'>): SavedVoucher => {
    const newId = genId('vouch');
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const newVoucher: SavedVoucher = {
      ...voucherData,
      id: newId,
      created_at: nowStr,
      saved_by: user ? user.name : 'Lab Admin'
    };

    setSavedVouchers((prev) => [newVoucher, ...prev]);

    // Persist to SQLite (mirror-keyed effect does not cover this collection)
    dbWrite(() => {
      vouchersRepo.insert(newVoucher);
      mirrorSet('savedVouchers', vouchersRepo.all());
    });

    if (voucherData.case_id && voucherData.case_id !== 'temp-new') {
      const isInv = voucherData.voucher_type === 'invoice';
      const noteMsg = `[VOUCHER LOGGED] Official ${isInv ? 'Invoice Voucher' : 'Workstation Job Slip'} (${voucherData.voucher_number}) saved to system database.`;
      
      // Call note helper
      const newNote: CaseNote = {
        id: `note-${Date.now()}`,
        case_id: voucherData.case_id,
        note_text: noteMsg,
        author: user ? user.name : 'System',
        created_at: nowStr
      };
      setCaseNotes((prev) => ({
        ...prev,
        [voucherData.case_id]: [newNote, ...(prev[voucherData.case_id] || [])]
      }));
    }

    triggerAgentWorkflow('VOUCHER_SAVED', newVoucher);
    return newVoucher;
  };

  const deleteSavedVoucher = (id: string) => {
    setSavedVouchers((prev) => prev.filter((v) => v.id !== id));
  };

  // Branding updates
  const updateBrandingSettings = (updates: Partial<BrandingSettings>) => {
    setBrandingSettings((prev) => ({ ...prev, ...updates }));
  };

  // SQLite / Database Backup & Restore
  const getBackupData = () => {
    return {
      version: '2.0-sqlite-dump',
      export_date: new Date().toISOString(),
      database_name: 'dental_solutions_db',
      tables: {
        cases,
        labs,
        caseTypes,
        invoices,
        notifications,
        templates,
        labContacts,
        labAddresses,
        pricingOverrides,
        labReviews,
        doctorPreferences,
        userPreferences,
        caseAttachments,
        caseNotes,
        brandingSettings,
        savedVouchers,
        advancePayments,
        accountAdjustments,
        journalEntries,
        auditEvents,
        reconciliationItems,
        users
      }
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
      if (Array.isArray(tables.users)) setUsers(tables.users.filter((u: any) => !u.is_hidden));
      return true;
    } catch (err) {
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
    setBrandingSettings(DEFAULT_BRANDING);
    setSavedVouchers([]);
    setCaseAttachments({
      'case-1': [
        { id: 'att-1', case_id: 'case-1', filename: 'shade_guide_a2.jpg', file_type: 'image/jpeg', file_url: '', uploaded_at: '2026-07-26 10:00', uploaded_by: 'Dr. Tariq', file_size: '1.2 MB' }
      ]
    });
    setCaseNotes({
      'case-1': [
        { id: 'note-1', case_id: 'case-1', note_text: 'Anterior wax-up approved by doctor over call.', author: 'Tech Hamza', created_at: '2026-07-26 14:30' }
      ]
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
    setBrandingSettings(DEFAULT_BRANDING);
    setSavedVouchers([]);
    setCaseAttachments({});
    setCaseNotes({});

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
      console.warn('Notice clearing local storage:', e);
    }
  };

  // Computed Values
  const todayStr = getTodayStr();
  
  const unreadCount = (notifications || []).filter((n) => !n.is_read && !n.is_archived).length;

  const overdueCount = (cases || []).filter((c) => {
    if (!c || c.status === 'delivered' || c.status === 'cancelled') return false;
    return (c.delivery_date || '') < todayStr;
  }).length;

  const dueTodayCount = (cases || []).filter((c) => {
    if (!c || c.status === 'delivered' || c.status === 'cancelled') return false;
    return c.delivery_date === todayStr;
  }).length;

  const dueThisWeekCount = (cases || []).filter((c) => {
    if (!c || c.status === 'delivered' || c.status === 'cancelled') return false;
    if (!c.delivery_date) return false;
    const del = new Date(c.delivery_date).getTime();
    const today = new Date(todayStr).getTime();
    const sevenDaysLater = today + 7 * 24 * 60 * 60 * 1000;
    return del >= today && del <= sevenDaysLater;
  }).length;

  // Auto-generate overdue case alerts
  useEffect(() => {
    const existingCaseIds = new Set((notifications || []).filter((n) => n.type === 'overdue_case').map((n) => n.case_id));
    const newAlerts: AppNotification[] = [];

    (cases || []).forEach((c) => {
      if (c && c.status !== 'delivered' && c.status !== 'cancelled' && (c.delivery_date || '') < todayStr) {
        if (!existingCaseIds.has(c.id)) {
          newAlerts.push({
            id: `notif-overdue-${c.id}`,
            type: 'overdue_case',
            title: `Case ${c.case_number} Overdue Notice`,
            message: `Case ${c.case_number} (${c.patient_name} - ${c.doctor_name}) missed scheduled delivery on ${c.delivery_date}. Priority triage required.`,
            case_id: c.id,
            case_number: c.case_number,
            lab_id: c.lab_id,
            is_read: false,
            read: false,
            created_at: new Date().toISOString()
          });
        }
      }
    });

    if (newAlerts.length > 0) {
      setNotifications((prev) => [...newAlerts, ...(prev || [])]);
    }
  }, [cases, todayStr]);

  // Auto-generate unpaid-invoice reminders: one per invoice while its due date
  // is today or past — the app's real, local "payment trigger". Because the
  // alert id is invoice-keyed, once a payment logs, the alert disappears.
  useEffect(() => {
    const alerts: AppNotification[] = [];
    (invoices || []).forEach((inv) => {
      if (!inv || inv.payment_status === 'paid' || inv.status_v2 === 'voided') return;
      if (!inv.due_date || inv.due_date > todayStr) return;
      alerts.push({
        id: `notif-unpaid-${inv.id}`,
        type: 'unpaid_invoice',
        title: `Payment Due — Invoice ${inv.invoice_number}`,
        message: `${inv.final_amount.toLocaleString()} PKR outstanding for ${inv.patient_name || inv.lab_name}. Due ${inv.due_date}.`,
        invoice_id: inv.id,
        case_number: inv.case_number,
        lab_id: inv.lab_id,
        is_read: false,
        read: false,
        created_at: new Date().toISOString(),
      });
    });
    if (alerts.length > 0) {
      setNotifications((prev) => {
        const existing = new Set((prev || []).map((n) => n.id));
        const fresh = alerts.filter((a) => !existing.has(a.id));
        return fresh.length > 0 ? [...fresh, ...(prev || [])] : prev || [];
      });
    }
  }, [invoices, todayStr]);

  // Agent workflow listener trigger simulation
  const triggerAgentWorkflow = (event: string, payload: any) => {
    console.log(`[Agent Workflow Triggered] ${event}`, payload);
  };

  // Case Number Auto Generator DS-0001
  const generateCaseNumber = () => {
    const maxNum = (cases || []).reduce((max, c) => {
      const match = (c?.case_number || '').match(/DS-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        return num > max ? num : max;
      }
      return max;
    }, 0);
    const nextNum = maxNum + 1;
    return `DS-${String(nextNum).padStart(4, '0')}`;
  };

  // Invoice Number Auto Generator INV-0001
  const generateInvoiceNumber = () => {
    const maxNum = (invoices || []).reduce((max, inv) => {
      const match = (inv?.invoice_number || '').match(/INV-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        return num > max ? num : max;
      }
      return max;
    }, 0);
    const nextNum = maxNum + 1;
    return `INV-${String(nextNum).padStart(4, '0')}`;
  };

  // Payment Number Auto Generator PAY-0001
  const generatePaymentNumber = () => {
    let maxNum = 0;
    invoices.forEach((inv) => {
      (inv.payments || []).forEach((p) => {
        const match = (p.payment_number || '').match(/PAY-(\d+)/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) maxNum = num;
        }
      });
    });
    const nextNum = maxNum + 1;
    return `PAY-${String(nextNum).padStart(4, '0')}`;
  };

  // Advance Payment Number Auto Generator ADV-0001
  const generateAdvanceNumber = () => {
    let maxNum = 0;
    advancePayments.forEach((a) => {
      const match = (a.payment_number || '').match(/ADV-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
    return `ADV-${String(maxNum + 1).padStart(4, '0')}`;
  };

  // Account Adjustment Number Generator CR-0001 / DR-0001 / REF-0001
  const generateAdjustmentNumber = (type: 'credit_note' | 'debit_adjustment' | 'refund') => {
    const prefix = type === 'credit_note' ? 'CR' : (type === 'debit_adjustment' ? 'DR' : 'REF');
    let maxNum = 0;
    accountAdjustments.filter((a) => a.type === type).forEach((a) => {
      const match = (a.adjustment_number || '').match(new RegExp(`${prefix}-(\\d+)`));
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
    return `${prefix}-${String(maxNum + 1).padStart(4, '0')}`;
  };

  // Derived collection of all individual payment transactions across all invoices
  const allPayments = useMemo(() => {
    const list: PaymentRecord[] = [];
    invoices.forEach((inv) => {
      (inv.payments || []).forEach((p, idx) => {
        list.push({
          ...p,
          payment_number: p.payment_number || `PAY-${String(idx + 1).padStart(4, '0')}`,
          invoice_number: p.invoice_number || inv.invoice_number,
          case_id: p.case_id || inv.case_id,
          case_number: p.case_number || inv.case_number,
          lab_id: p.lab_id || inv.lab_id,
          lab_name: p.lab_name || inv.lab_name,
          attachments: p.attachments || []
        });
      });
    });
    return list.sort((a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime());
  }, [invoices]);

  // Derived Financial Summary for specific Clinic / Lab
  const getLabFinancialSummary = (labId: string): LabFinancialSummary => {
    const labInvs = invoices.filter((i) => i.lab_id === labId);
    const total_invoiced = labInvs.reduce((sum, inv) => sum + inv.final_amount, 0);
    const total_paid = labInvs.reduce((sum, inv) => sum + (inv.amount_paid || 0), 0);

    const clinicAdvances = advancePayments.filter((a) => a.lab_id === labId);
    const total_advance_received = clinicAdvances.reduce((sum, a) => sum + a.amount, 0);
    const advance_balance = clinicAdvances.reduce((sum, a) => sum + a.remaining_amount, 0);

    const clinicAdjs = accountAdjustments.filter((a) => a.lab_id === labId);
    const total_credit_notes = clinicAdjs.filter((a) => a.type === 'credit_note').reduce((sum, a) => sum + a.amount, 0);
    const total_debit_adjustments = clinicAdjs.filter((a) => a.type === 'debit_adjustment' || a.type === 'refund').reduce((sum, a) => sum + a.amount, 0);

    const unpaidInvoiceAmount = Math.max(0, total_invoiced - total_paid);
    const net_balance = unpaidInvoiceAmount + total_debit_adjustments - advance_balance - total_credit_notes;
    const outstanding_balance = Math.max(0, net_balance);
    
    let payments_count = 0;
    labInvs.forEach((inv) => {
      payments_count += (inv.payments || []).length;
    });

    return {
      total_invoiced,
      total_paid,
      total_advance_received,
      advance_balance,
      total_credit_notes,
      total_debit_adjustments,
      outstanding_balance,
      net_balance,
      invoices_count: labInvs.length,
      unpaid_invoices_count: labInvs.filter((i) => i.payment_status === 'unpaid').length,
      partial_invoices_count: labInvs.filter((i) => i.payment_status === 'partial').length,
      paid_invoices_count: labInvs.filter((i) => i.payment_status === 'paid').length,
      payments_count,
      advance_count: clinicAdvances.length
    };
  };

  const getClinicFinancialSummary = getLabFinancialSummary;

  // Derived Comprehensive Double-Entry Ledger Engine
  const getLedgerEntries = (filterLabId?: string): LedgerEntry[] => {
    try {
      type RawEvent = {
        date: string;
        timestamp: number;
        lab_id: string;
        lab_name: string;
        entry_type: LedgerEntryType;
        reference_id: string;
        reference_number: string;
        case_number?: string;
        doctor_name?: string;
        description: string;
        debit: number;
        credit: number;
        payment_method?: PaymentRecord['payment_method'];
        attachments_count?: number;
        attachments?: PaymentAttachment[];
        notes?: string;
        recorded_by?: string;
      };

      const rawEvents: RawEvent[] = [];
      const targetInvoices = filterLabId ? invoices.filter((i) => i.lab_id === filterLabId) : invoices;
      const targetAdvances = filterLabId ? advancePayments.filter((a) => a.lab_id === filterLabId) : advancePayments;
      const targetAdjustments = filterLabId ? accountAdjustments.filter((a) => a.lab_id === filterLabId) : accountAdjustments;

      // 1. Invoices -> Debit (Increases Outstanding Receivable)
      targetInvoices.forEach((inv) => {
        const invDate = inv.created_at || new Date().toISOString().slice(0, 10);
        const parsedTime = new Date(invDate).getTime();
        const invTime = isNaN(parsedTime) ? Date.now() : parsedTime;
        const invNum = inv.invoice_number || 'INV';
        const finalAmt = typeof inv.final_amount === 'number' ? inv.final_amount : (typeof inv.amount === 'number' ? inv.amount : 0);

        rawEvents.push({
          date: invDate,
          timestamp: invTime,
          lab_id: inv.lab_id || '',
          lab_name: inv.lab_name || 'Clinic',
          entry_type: 'invoice',
          reference_id: inv.id,
          reference_number: invNum,
          case_number: inv.case_number,
          doctor_name: inv.doctor_name,
          description: `Invoice for ${inv.case_type_name || 'Restoration'} (${inv.case_number || 'Case'})`,
          debit: finalAmt,
          credit: 0,
          notes: (inv.discount || 0) > 0 ? `Subtotal PKR ${(inv.amount || 0).toLocaleString()} - Discount PKR ${(inv.discount || 0).toLocaleString()}` : undefined
        });

        // 2. Payments for this Invoice -> Credit (if direct) or Allocation Memo (if advance)
        (inv.payments || []).forEach((p, pIdx) => {
          const isAdvanceAlloc = p.payment_method === 'advance' || p.payment_type === 'advance_allocation';
          const pDate = p.payment_date || invDate;
          const pParsedTime = new Date(pDate).getTime();
          const pBaseTime = isNaN(pParsedTime) ? invTime : pParsedTime;
          const methodStr = String(p.payment_method || 'bank').toUpperCase();

          rawEvents.push({
            date: pDate,
            // Offset timestamp slightly to ensure payments occurring on same date sort after invoice creation
            timestamp: pBaseTime + (pIdx + 1) * 1000,
            lab_id: p.lab_id || inv.lab_id || '',
            lab_name: p.lab_name || inv.lab_name || 'Clinic',
            entry_type: isAdvanceAlloc ? 'advance_allocation' : 'payment',
            reference_id: p.id || `pay-${pIdx}`,
            reference_number: p.payment_number || `PAY-${invNum.replace('INV-', '')}-${pIdx + 1}`,
            case_number: p.case_number || inv.case_number,
            doctor_name: inv.doctor_name,
            description: isAdvanceAlloc
              ? `Advance credit applied to ${invNum} (Ref: ${p.reference_number || 'Advance'})`
              : `Payment received for ${invNum} via ${methodStr}`,
            // If payment was paid from advance, the advance deposit already credited the ledger, so allocation is debit 0, credit 0
            debit: 0,
            credit: isAdvanceAlloc ? 0 : (p.amount || 0),
            payment_method: p.payment_method,
            attachments_count: (p.attachments || []).length,
            attachments: p.attachments || [],
            notes: p.notes || (p.reference_number ? `Ref: ${p.reference_number}` : undefined),
            recorded_by: p.recorded_by
          });
        });
      });

      // 3. Advance Payments / Deposits received from Clinic -> Credit (Decreases Outstanding Receivable / Creates credit surplus)
      targetAdvances.forEach((adv, advIdx) => {
        const advDate = adv.payment_date || adv.created_at || new Date().toISOString().slice(0, 10);
        const parsedTime = new Date(adv.created_at || advDate).getTime();
        const advTime = isNaN(parsedTime) ? Date.now() : parsedTime;
        const methodStr = String(adv.payment_method || 'cash').toUpperCase();
        const advAmt = adv.amount || 0;
        const remAmt = adv.remaining_amount !== undefined ? adv.remaining_amount : advAmt;
        const availPct = advAmt > 0 ? Math.round((remAmt / advAmt) * 100) : 0;

        rawEvents.push({
          date: advDate,
          timestamp: advTime + (advIdx + 1) * 500,
          lab_id: adv.lab_id || '',
          lab_name: adv.lab_name || 'Clinic',
          entry_type: 'advance_payment',
          reference_id: adv.id,
          reference_number: adv.payment_number || `ADV-${advIdx + 1}`,
          description: `Advance payment deposit received via ${methodStr}${remAmt < advAmt ? ` (${availPct}% available)` : ' (Unallocated)'}`,
          debit: 0,
          credit: advAmt,
          payment_method: adv.payment_method,
          attachments_count: (adv.attachments || []).length,
          attachments: adv.attachments || [],
          notes: adv.notes || (adv.reference_number ? `Ref: ${adv.reference_number}` : undefined),
          recorded_by: adv.recorded_by
        });
      });

      // 4. Account Adjustments (Credit notes, Debit surcharges, Refunds)
      targetAdjustments.forEach((adj, adjIdx) => {
        const isCreditNote = adj.type === 'credit_note';
        const isDebit = adj.type === 'debit_adjustment';
        const adjDate = adj.date || adj.created_at || new Date().toISOString().slice(0, 10);
        const parsedTime = new Date(adj.created_at || adjDate).getTime();
        const adjTime = isNaN(parsedTime) ? Date.now() : parsedTime;
        const adjAmt = adj.amount || 0;

        rawEvents.push({
          date: adjDate,
          timestamp: adjTime + (adjIdx + 1) * 300,
          lab_id: adj.lab_id || '',
          lab_name: adj.lab_name || 'Clinic',
          entry_type: adj.type,
          reference_id: adj.id,
          reference_number: adj.adjustment_number || `ADJ-${adjIdx + 1}`,
          description: isCreditNote
            ? `Credit Note: ${adj.reason || 'Discount'}`
            : isDebit
            ? `Debit Adjustment: ${adj.reason || 'Surcharge'}`
            : `Refund to Clinic: ${adj.reason || 'Refund'}`,
          debit: isCreditNote ? 0 : adjAmt,
          credit: isCreditNote ? adjAmt : 0,
          attachments_count: (adj.attachments || []).length,
          attachments: adj.attachments || [],
          notes: (adj.reason || '') + (adj.reference_number ? ` | Ref: ${adj.reference_number}` : ''),
          recorded_by: adj.recorded_by
        });
      });

      // Chronological sort: oldest to newest for calculating running balance
      rawEvents.sort((a, b) => {
        const timeA = typeof a.timestamp === 'number' && !isNaN(a.timestamp) ? a.timestamp : 0;
        const timeB = typeof b.timestamp === 'number' && !isNaN(b.timestamp) ? b.timestamp : 0;
        return timeA - timeB;
      });

      let runningBalance = 0;
      const ledger = rawEvents.map((evt, idx) => {
        runningBalance = runningBalance + evt.debit - evt.credit;
        return {
          id: `ledg-${idx}-${evt.reference_id}`,
          date: evt.date,
          lab_id: evt.lab_id,
          lab_name: evt.lab_name,
          entry_type: evt.entry_type,
          reference_id: evt.reference_id,
          reference_number: evt.reference_number,
          case_number: evt.case_number,
          doctor_name: evt.doctor_name,
          description: evt.description,
          debit: evt.debit,
          credit: evt.credit,
          running_balance: runningBalance,
          payment_method: evt.payment_method,
          attachments_count: evt.attachments_count,
          attachments: evt.attachments,
          notes: evt.notes,
          recorded_by: evt.recorded_by
        };
      });

      // Return entries in reverse-chronological order (newest first) for UI, while keeping the accurately calculated running_balance
      return ledger.reverse();
    } catch (err) {
      console.error('Error generating ledger entries:', err);
      return [];
    }
  };

  // Cases CRUD
  const addCase = (caseData: Omit<DentalCase, 'id' | 'case_number' | 'created_at' | 'updated_at' | 'history'>) => {
    const newId = genId('case');
    const caseNumber = generateCaseNumber();
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);

    const newCase: DentalCase = {
      ...caseData,
      id: newId,
      case_number: caseNumber,
      created_at: nowStr.split(' ')[0],
      updated_at: nowStr,
      history: [
        {
          id: genId('h'),
          case_id: newId,
          status: caseData.status,
          notes: 'Case registered',
          timestamp: nowStr,
          updated_by: user ? user.name : 'System'
        }
      ]
    };

    setCases((prev) => [newCase, ...prev]);

    // Create corresponding invoice automatically
    const newInvoice: Invoice = {
      id: genId('inv'),
      invoice_number: generateInvoiceNumber(),
      case_id: newId,
      case_number: caseNumber,
      lab_id: caseData.lab_id,
      lab_name: caseData.lab_name,
      case_type_name: caseData.case_type_name,
      doctor_name: caseData.doctor_name,
      patient_name: caseData.patient_name,
      amount: caseData.price,
      discount: caseData.discount,
      final_amount: caseData.final_price,
      amount_paid: 0,
      payment_status: 'unpaid',
      due_date: caseData.delivery_date,
      created_at: nowStr.split(' ')[0],
      payments: []
    };

    setInvoices((prev) => [newInvoice, ...prev]);

    // Check if preferred lab should be logged or updated
    if (caseData.doctor_name) {
      const existingPref = (doctorPreferences || []).find((dp) => (dp?.doctor_name || '').toLowerCase() === (caseData.doctor_name || '').toLowerCase());
      if (!existingPref) {
        setDoctorPreferredLab(caseData.doctor_name, caseData.lab_id, caseData.lab_name);
      }
    }

    triggerAgentWorkflow('CASE_CREATED', { case_id: newId, case_number: caseNumber, caseData });
    return newCase;
  };

  const updateCase = (
    id: string,
    updates: Partial<DentalCase>,
    note?: string,
    /* Internal: QC events appended in this very call, so the gate sees them
       before React state has flushed. Callers outside the QC action omit it. */
    qcEventsInFlight?: QcInspection[]
  ) => {
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);

    /* Quality gate: a case is only released once an inspection has passed. */
    if (updates.status && QC_GATED_STATUSES.includes(updates.status)) {
      const gateEvents = qcEventsInFlight ?? qcInspections;
      if (!qcGateSatisfied(deriveQcCaseState(gateEvents, id))) {
        showToast(
          `A passing QC inspection is required before this case can be marked ${updates.status}`,
          'warning'
        );
        /* Refuse only the blocked transition — every other edit in this call
           still applies (the case keeps its current status). */
        const rest: Partial<DentalCase> = { ...updates };
        delete rest.status;
        updates = rest;
      }
    }

    setCases((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;

        const updatedHistory = [...c.history];
        if (updates.status && updates.status !== c.status) {
          updatedHistory.push({
            id: genId('h'),
            case_id: id,
            status: updates.status,
            notes: note || `Status changed from ${c.status} to ${updates.status}`,
            timestamp: nowStr,
            updated_by: user ? user.name : 'System'
          });

          // Trigger status change notification
          if (updates.status === 'ready' || updates.status === 'delivered') {
            const notif: AppNotification = {
              id: genId('notif'),
              type: 'status_change',
              title: `Case ${c.case_number} ${updates.status.toUpperCase()}`,
              message: `Case ${c.case_number} for ${c.lab_name} status updated to ${updates.status}.`,
              case_id: c.id,
              case_number: c.case_number,
              is_read: false,
              is_archived: false,
              created_at: nowStr
            };
            setNotifications((n) => [notif, ...n]);
          }
        }

        const updatedCase = {
          ...c,
          ...updates,
          updated_at: nowStr,
          history: updatedHistory
        };

        triggerAgentWorkflow('CASE_UPDATED', { case_id: id, updates });
        return updatedCase;
      })
    );

    // Sync invoice if price changed
    if (updates.price !== undefined || updates.discount !== undefined || updates.final_price !== undefined) {
      setInvoices((prev) =>
        prev.map((inv) => {
          if (inv.case_id !== id) return inv;
          const newAmount = updates.price ?? inv.amount;
          const newDiscount = updates.discount ?? inv.discount;
          const newFinal = updates.final_price ?? (newAmount - newDiscount);
          const newStatus = inv.amount_paid >= newFinal ? 'paid' : (inv.amount_paid > 0 ? 'partial' : 'unpaid');
          return {
            ...inv,
            amount: newAmount,
            discount: newDiscount,
            final_amount: newFinal,
            payment_status: newStatus
          };
        })
      );
    }
  };

  /* ─── Quality control (QC) ────────────────────────────────────────────────
     Single command surface: append an inspection (or a correction of one) and
     let the derived state drive the case. Nothing in this stream is mutated;
     a mistake is amended by appending a correction that supersedes it. */
  const getQcState = (caseId: string): QcCaseState => deriveQcCaseState(qcInspections, caseId);

  const getQcMetrics = (): QcMetrics => computeQcMetrics(qcInspections, cases);

  const recordQcCase = (command: QcCommand): QcReceipt => {
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const actor = user ? user.name : 'System';

    const corrected = command.action === 'correct'
      ? qcInspections.find((q) => q.id === command.id)
      : undefined;
    const caseId = command.action === 'record' ? command.case_id : corrected?.case_id ?? '';
    const targetCase = cases.find((c) => c.id === caseId);

    if (!targetCase) {
      showToast('Case not found — the QC result was not recorded', 'error');
      return { case_state: deriveQcCaseState(qcInspections, caseId), notified: false };
    }

    const kind = command.action === 'correct' ? 'correction' : 'inspection';
    const inspectionNo = command.action === 'correct'
      ? corrected?.inspection_no ?? 1
      : nextInspectionNo(qcInspections, caseId);
    const checklist = command.action === 'record' ? command.checklist : undefined;

    const event: QcInspection = {
      id: genId('qc'),
      case_id: caseId,
      case_number: targetCase.case_number,
      inspection_no: inspectionNo,
      kind,
      result: command.result,
      reason_code: command.result === 'fail' ? command.reason_code ?? 'other' : null,
      reason_text: command.reason_text ?? null,
      checklist: checklist && checklist.length ? JSON.stringify(checklist) : null,
      inspector: command.inspector || actor,
      notes: command.notes ?? null,
      supersedes_id: command.action === 'correct' ? command.id : null,
      dedupe_key: qcDedupeKey(caseId, inspectionNo, command.result, kind),
      created_at: nowStr,
    };

    /* Append first: the database is authoritative and its UNIQUE dedupe_key is
       the idempotency guard — a duplicate posting is refused, never repeated. */
    try {
      if (isDatabaseReady()) qcInspectionsRepo.insert(event);
    } catch (e: any) {
      const duplicate = String(e?.message || '').toLowerCase().includes('unique');
      showToast(duplicate ? 'This QC result was already recorded' : 'Could not save the QC inspection', 'error');
      return { case_state: deriveQcCaseState(qcInspections, caseId), notified: false };
    }

    const nextEvents = [...qcInspections, event];
    setQcInspections(nextEvents);

    const status = statusAfterQc(command.result, targetCase.status);
    updateCase(
      caseId,
      { status },
      command.result === 'pass'
        ? `QC inspection #${inspectionNo} passed`
        : `QC inspection #${inspectionNo} failed — ${qcReasonLabel(event.reason_code)}`,
      nextEvents
    );

    let notified = false;
    if (command.result === 'fail') {
      const notification: AppNotification = {
        id: genId('notif'),
        type: 'escalation',
        title: `QC failed — ${targetCase.case_number}`,
        message: `${targetCase.case_number} (${targetCase.lab_name}) failed quality inspection #${inspectionNo}: ${qcReasonLabel(event.reason_code)}. Returned for rework.`,
        case_id: caseId,
        case_number: targetCase.case_number,
        lab_id: targetCase.lab_id,
        is_read: false,
        is_archived: false,
        priority: 'high',
        created_at: nowStr,
      };
      setNotifications((n) => [notification, ...n]);
      notified = true;
    }

    showToast(
      command.result === 'pass'
        ? `QC passed — ${targetCase.case_number} is ready`
        : `QC failed — ${targetCase.case_number} returned for rework`,
      command.result === 'pass' ? 'success' : 'warning'
    );

    return {
      inspection: event,
      case_state: deriveQcCaseState(nextEvents, caseId),
      status_after: status,
      notified,
    };
  };

  const deleteCase = (id: string) => {
    const target = cases.find((c) => c.id === id);
    setCases((prev) => prev.filter((c) => c.id !== id));
    setInvoices((prev) => prev.filter((inv) => inv.case_id !== id));
    setNotifications((prev) => prev.filter((n) => n.case_id !== id));
    if (target) {
      triggerAgentWorkflow('CASE_DELETED', { case_id: id, case_number: target.case_number });
    }
  };

  const addCaseNote = (caseId: string, noteText: string, author: string) => {
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const newNote: CaseNote = {
      id: `note-${Date.now()}`,
      case_id: caseId,
      note_text: noteText,
      author: author || (user ? user.name : 'Staff'),
      created_at: nowStr
    };
    setCaseNotes((prev) => ({
      ...prev,
      [caseId]: [newNote, ...(prev[caseId] || [])]
    }));
    triggerAgentWorkflow('CASE_NOTE_ADDED', { case_id: caseId, note: newNote });
  };

  const editCaseNote = (caseId: string, noteId: string, noteText: string) => {
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    setCaseNotes((prev) => ({
      ...prev,
      [caseId]: (prev[caseId] || []).map((n) => (n.id === noteId ? { ...n, note_text: noteText, updated_at: nowStr } : n))
    }));
  };

  const deleteCaseNote = (caseId: string, noteId: string) => {
    setCaseNotes((prev) => ({
      ...prev,
      [caseId]: (prev[caseId] || []).filter((n) => n.id !== noteId)
    }));
  };

  const addCaseAttachment = (caseId: string, fileData: Omit<CaseAttachment, 'id' | 'case_id' | 'uploaded_at'>) => {
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const newAtt: CaseAttachment = {
      ...fileData,
      id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      case_id: caseId,
      uploaded_at: nowStr
    };
    setCaseAttachments((prev) => {
      const currentMap = prev || {};
      const listForCase = currentMap[caseId] || [];
      return {
        ...currentMap,
        [caseId]: [newAtt, ...listForCase]
      };
    });
    triggerAgentWorkflow('ATTACHMENT_UPLOADED', { case_id: caseId, attachment: newAtt });
  };

  const deleteCaseAttachment = (caseId: string, attachmentId: string) => {
    setCaseAttachments((prev) => {
      const currentMap = prev || {};
      const listForCase = currentMap[caseId] || [];
      return {
        ...currentMap,
        [caseId]: listForCase.filter((a) => a.id !== attachmentId)
      };
    });
  };

  // Templates CRUD
  const saveAsTemplate = (templateName: string, caseData: DentalCase, description?: string) => {
    const newTmpl: CaseTemplate = {
      id: `tmpl-${Date.now()}`,
      template_name: templateName,
      case_type_id: caseData.case_type_id,
      case_type_name: caseData.case_type_name,
      description,
      selected_teeth: caseData.selected_teeth,
      shade: caseData.shade,
      instructions: caseData.instructions,
      default_priority: caseData.priority,
      created_at: new Date().toISOString().split('T')[0]
    };
    setTemplates((prev) => [newTmpl, ...prev]);
  };

  const deleteTemplate = (templateId: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== templateId));
  };

  // Labs CRUD
  const addLab = (labData: Omit<DentalLab, 'id' | 'created_at' | 'rating' | 'reviews_count'>) => {
    const newLab: DentalLab = {
      ...labData,
      id: `lab-${Date.now()}`,
      rating: 5.0,
      reviews_count: 0,
      created_at: new Date().toISOString().split('T')[0]
    };
    setLabs((prev) => [newLab, ...prev]);
    return newLab;
  };

  const updateLab = (id: string, updates: Partial<DentalLab>) => {
    setLabs((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)));
  };

  const deleteLab = (id: string) => {
    setLabs((prev) => prev.filter((l) => l.id !== id));
    setLabContacts((prev) => prev.filter((lc) => lc.lab_id !== id));
    setLabAddresses((prev) => prev.filter((la) => la.lab_id !== id));
    setPricingOverrides((prev) => prev.filter((po) => po.lab_id !== id));
    setLabReviews((prev) => prev.filter((lr) => lr.lab_id !== id));
  };

  const addLabContact = (contact: Omit<LabContact, 'id'>) => {
    const newC: LabContact = { ...contact, id: `lc-${Date.now()}` };
    if (newC.is_primary) {
      setLabContacts((prev) => prev.map((c) => (c.lab_id === newC.lab_id ? { ...c, is_primary: false } : c)));
    }
    setLabContacts((prev) => [...prev, newC]);
  };

  const updateLabContact = (id: string, updates: Partial<LabContact>) => {
    setLabContacts((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const updated = { ...c, ...updates };
        if (updates.is_primary) {
          // demote others
          setLabContacts((all) => all.map((item) => (item.lab_id === updated.lab_id && item.id !== id ? { ...item, is_primary: false } : item)));
        }
        return updated;
      })
    );
  };

  const deleteLabContact = (id: string) => {
    setLabContacts((prev) => prev.filter((c) => c.id !== id));
  };

  const addLabAddress = (address: Omit<LabAddress, 'id'>) => {
    const newA: LabAddress = { ...address, id: `la-${Date.now()}` };
    if (newA.is_default) {
      setLabAddresses((prev) => prev.map((a) => (a.lab_id === newA.lab_id ? { ...a, is_default: false } : a)));
    }
    setLabAddresses((prev) => [...prev, newA]);
  };

  const updateLabAddress = (id: string, updates: Partial<LabAddress>) => {
    setLabAddresses((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...updates } : a))
    );
  };

  const deleteLabAddress = (id: string) => {
    setLabAddresses((prev) => prev.filter((a) => a.id !== id));
  };

  const addPricingOverride = (override: Omit<LabPricingOverride, 'id'>) => {
    const newPO: LabPricingOverride = { ...override, id: `lpo-${Date.now()}` };
    setPricingOverrides((prev) => [...prev.filter((p) => !(p.lab_id === override.lab_id && p.case_type_id === override.case_type_id)), newPO]);
  };

  const deletePricingOverride = (id: string) => {
    setPricingOverrides((prev) => prev.filter((p) => p.id !== id));
  };

  // Doctor Preferred Lab
  const setDoctorPreferredLab = (doctorName: string, labId: string, labName: string) => {
    if (!doctorName || !doctorName.trim()) return;
    setDoctorPreferences((prev) => {
      const cleanName = doctorName.trim();
      const filtered = (prev || []).filter((dp) => (dp?.doctor_name || '').toLowerCase() !== cleanName.toLowerCase());
      return [
        ...filtered,
        {
          id: `dpl-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          doctor_name: cleanName,
          lab_id: labId,
          lab_name: labName,
          created_at: new Date().toISOString().split('T')[0]
        }
      ];
    });
  };

  const getDoctorPreferredLab = (doctorName: string) => {
    if (!doctorName || !doctorName.trim()) return undefined;
    const cleanName = doctorName.trim().toLowerCase();
    return (doctorPreferences || []).find((dp) => (dp?.doctor_name || '').toLowerCase().trim() === cleanName);
  };

  // Case Types CRUD
  const addCaseType = (ct: Omit<CaseType, 'id' | 'created_at'>) => {
    const newCT: CaseType = {
      ...ct,
      id: `ct-${Date.now()}`,
      created_at: new Date().toISOString().split('T')[0]
    };
    setCaseTypes((prev) => [...prev, newCT]);
  };

  const updateCaseType = (id: string, updates: Partial<CaseType>) => {
    setCaseTypes((prev) => prev.map((ct) => (ct.id === id ? { ...ct, ...updates } : ct)));
  };

  const deleteCaseType = (id: string) => {
    setCaseTypes((prev) => prev.filter((ct) => ct.id !== id));
  };

  // Billing & Invoices
  const recordPayment = (
    invoiceId: string, 
    amount: number, 
    method: PaymentRecord['payment_method'], 
    notes?: string,
    referenceNumber?: string,
    attachments?: PaymentAttachment[]
  ): PaymentRecord | null => {
    if (amount <= 0 || isNaN(amount)) return null;
    const nowStr = new Date().toISOString().split('T')[0];
    const paymentNum = generatePaymentNumber();
    let createdPayment: PaymentRecord | null = null;

    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== invoiceId) return inv;

        const currentPayments = inv.payments || [];
        const newPaid = currentPayments.reduce((s, p) => s + p.amount, 0) + amount;
        const newStatus = newPaid >= inv.final_amount ? 'paid' : (newPaid > 0 ? 'partial' : 'unpaid');

        const newPaymentId = `pay-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const preparedAttachments: PaymentAttachment[] = (attachments || []).map((att, idx) => ({
          id: att.id || `patt-${Date.now()}-${idx}`,
          payment_id: newPaymentId,
          file_name: att.file_name || `attachment_${idx + 1}.jpg`,
          file_type: att.file_type || 'image/jpeg',
          file_size: att.file_size || 'Unknown',
          file_url: att.file_url,
          uploaded_at: att.uploaded_at || new Date().toISOString().replace('T', ' ').substring(0, 16),
          uploaded_by: att.uploaded_by || (user ? user.name : 'Staff')
        }));

        createdPayment = {
          id: newPaymentId,
          payment_number: paymentNum,
          invoice_id: invoiceId,
          invoice_number: inv.invoice_number,
          case_id: inv.case_id,
          case_number: inv.case_number,
          lab_id: inv.lab_id,
          lab_name: inv.lab_name,
          amount,
          payment_method: method,
          payment_date: nowStr,
          reference_number: referenceNumber,
          notes,
          recorded_by: user ? user.name : 'Staff',
          created_at: new Date().toISOString().replace('T', ' ').substring(0, 16),
          attachments: preparedAttachments
        };

        const updatedInv: Invoice = {
          ...inv,
          amount_paid: newPaid,
          payment_status: newStatus as Invoice['payment_status'],
          payments: [createdPayment, ...currentPayments]
        };

        // Notify if invoice fully settled
        if (newStatus === 'paid') {
          const notif: AppNotification = {
            id: genId('notif'),
            type: 'system',
            title: `Invoice ${inv.invoice_number} Paid in Full`,
            message: `Payment of PKR ${(amount || 0).toLocaleString()} received for ${inv.lab_name}. Invoice is fully settled.`,
            invoice_id: inv.id,
            lab_id: inv.lab_id,
            is_read: false,
            is_archived: false,
            created_at: new Date().toISOString().replace('T', ' ').substring(0, 16)
          };
          setNotifications((n) => [notif, ...n]);
        }

        triggerAgentWorkflow('PAYMENT_RECORDED', { invoiceId, amount, paymentNum, newStatus });
        return updatedInv;
      })
    );

    // ---- Auto-log voucher + system journal for every payment entry ----
    const payVoucher = createdPayment as PaymentRecord | null;
    const payInv = invoices.find((i) => i.id === invoiceId);
    if (payVoucher && payInv) {
      saveVoucherToSystem({
        voucher_number: payVoucher.payment_number || paymentNum,
        voucher_type: 'invoice',
        case_id: payInv.case_id || '',
        case_number: payInv.case_number || '',
        lab_name: payInv.lab_name,
        doctor_name: payInv.doctor_name || '',
        patient_name: payInv.patient_name || '',
        case_type_name: payInv.case_type_name,
        amount,
        notes: notes || `Payment ${method}${referenceNumber ? ` · ref ${referenceNumber}` : ''} on ${payInv.invoice_number}`
      });

      const journal = buildPaymentJournal(
        payVoucher,
        [{
          id: `alloc-${payVoucher.id}`,
          source_type: 'payment',
          source_id: payVoucher.id,
          source_ref: payVoucher.payment_number || paymentNum,
          invoice_id: payInv.id,
          invoice_number: payInv.invoice_number,
          amount,
          allocated_at: new Date().toISOString().replace('T', ' ').substring(0, 16),
          allocated_by: user ? user.name : 'Staff'
        }],
        0,
        user ? user.name : 'Staff'
      );
      payVoucher.journal_id = journal.id;
      setJournalEntries((prev) => [journal, ...prev]);
    }

    return createdPayment;
  };

  const deletePayment = (paymentId: string) => {
    setInvoices((prev) =>
      prev.map((inv) => {
        const hasPayment = (inv.payments || []).some((p) => p.id === paymentId);
        if (!hasPayment) return inv;

        const updatedPayments = (inv.payments || []).filter((p) => p.id !== paymentId);
        const newPaid = updatedPayments.reduce((sum, p) => sum + p.amount, 0);
        const newStatus = newPaid >= inv.final_amount ? 'paid' : (newPaid > 0 ? 'partial' : 'unpaid');

        return {
          ...inv,
          amount_paid: newPaid,
          payment_status: newStatus,
          payments: updatedPayments
        };
      })
    );
  };

  const updateInvoice = (id: string, updates: Partial<Invoice>) => {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== id) return inv;
        const updated = { ...inv, ...updates };
        const finalAmt = updates.final_amount !== undefined ? updates.final_amount : updated.final_amount;
        const paidAmt = updates.amount_paid !== undefined ? updates.amount_paid : updated.amount_paid;
        updated.payment_status = paidAmt >= finalAmt ? 'paid' : (paidAmt > 0 ? 'partial' : 'unpaid');
        return updated;
      })
    );
  };

  const bulkMarkPaid = (invoiceIds: string[]) => {
    const today = getTodayStr();
    const newJournals: JournalEntry[] = [];
    const newAudits: AuditEvent[] = [];

    setInvoices((prev) =>
      prev.map((inv) => {
        if (!invoiceIds.includes(inv.id)) return inv;
        const remaining = inv.final_amount - inv.amount_paid;
        if (remaining <= 0) return inv;

        const payNum = generatePaymentNumber();
        const newPayment: PaymentRecord = {
          id: `pay-${Date.now()}-${inv.id}`,
          payment_number: payNum,
          receipt_number: `REC-${payNum.replace('PAY-', '')}`,
          invoice_id: inv.id,
          invoice_number: inv.invoice_number,
          case_id: inv.case_id,
          case_number: inv.case_number,
          lab_id: inv.lab_id,
          lab_name: inv.lab_name,
          amount: remaining,
          payment_method: 'bank',
          payment_date: today,
          status: 'posted',
          notes: 'Bulk payment settlement',
          recorded_by: user ? user.name : 'Staff',
          allocations: [
            {
              id: `alloc-${Date.now()}-${inv.id}`,
              source_type: 'payment',
              source_id: `pay-${Date.now()}-${inv.id}`,
              source_ref: payNum,
              invoice_id: inv.id,
              invoice_number: inv.invoice_number,
              amount: remaining,
              allocated_at: today,
              allocated_by: user ? user.name : 'Staff'
            }
          ]
        };

        const journal = buildPaymentJournal(
          newPayment,
          newPayment.allocations || [],
          0,
          user ? user.name : 'Staff'
        );
        newJournals.push(journal);

        newAudits.push({
          id: `aud-${Date.now()}-${inv.id}`,
          timestamp: new Date().toISOString(),
          actor: user ? user.name : 'Staff',
          action: 'BULK_PAYMENT_RECORDED',
          entity_type: 'Invoice',
          entity_id: inv.id,
          entity_ref: inv.invoice_number,
          notes: `Cleared outstanding PKR ${remaining.toLocaleString()} via bulk settlement`
        });

        return {
          ...inv,
          amount_paid: inv.final_amount,
          payment_status: 'paid',
          status_v2: 'paid',
          payments: [newPayment, ...(inv.payments || [])]
        };
      })
    );

    if (newJournals.length > 0) {
      setJournalEntries((prev) => [...newJournals, ...prev]);
    }
    if (newAudits.length > 0) {
      setAuditEvents((prev) => [...newAudits, ...prev]);
    }
    showToast(`Bulk payment recorded for ${invoiceIds.length} invoice(s).`, 'success');
  };

  const deleteInvoice = (id: string) => {
    const target = invoices.find((inv) => inv.id === id);
    if (!target) return;

    // Money integrity: an invoice with active (non-reversed) payments cannot
    // silently vanish — its payments, allocations and journals must be dealt
    // with through the reversal flow first.
    const activePayments = (target.payments || []).filter((p) => !p.is_reversed);
    if (activePayments.length > 0) {
      showToast(
        `Cannot void ${target.invoice_number}: it has ${activePayments.length} active payment(s). Reverse them first.`,
        'error'
      );
      return;
    }

    // Voiding = removing the invoice AND reversing its issuance journal so the
    // ledger stays balanced. The audit trail records who voided what, when.
    const actor = user ? user.name : 'Staff';
    const origJournal = journalEntries.find(
      (j) => j.reference_type === 'invoice' && j.reference_id === id
    );
    if (origJournal) {
      const revJournal = buildReversalJournal(
        origJournal,
        `Invoice ${target.invoice_number} voided`,
        actor
      );
      setJournalEntries((prev) => [revJournal, ...prev]);
    }

    const auditEvt: AuditEvent = {
      id: `aud-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
      actor,
      action: 'INVOICE_VOIDED',
      entity_type: 'Invoice',
      entity_id: id,
      entity_ref: target.invoice_number,
      notes: `Voided invoice ${target.invoice_number} (PKR ${target.final_amount.toLocaleString()}) for ${target.lab_name}`
    };
    setAuditEvents((prev) => [auditEvt, ...prev]);

    setInvoices((prev) => prev.filter((inv) => inv.id !== id));
    showToast(`Invoice ${target.invoice_number} voided — ledger reversed and audit trail updated.`, 'success');
  };

  // Advance Payments & Account Adjustments Actions
  const recordAdvancePayment = (
    labId: string,
    amount: number,
    method: 'cash' | 'bank' | 'cheque',
    notes?: string,
    referenceNumber?: string,
    attachments?: PaymentAttachment[]
  ): AdvancePayment => {
    const lab = labs.find((l) => l.id === labId);
    const labName = lab ? lab.name : 'Dental Clinic';
    const advNum = generateAdvanceNumber();
    const newId = `adv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);

    const preparedAttachments: PaymentAttachment[] = (attachments || []).map((att, idx) => ({
      id: att.id || `patt-${Date.now()}-${idx}`,
      payment_id: newId,
      file_name: att.file_name || `attachment_${idx + 1}.jpg`,
      file_type: att.file_type || 'image/jpeg',
      file_size: att.file_size || 'Unknown',
      file_url: att.file_url,
      uploaded_at: att.uploaded_at || nowStr,
      uploaded_by: att.uploaded_by || (user ? user.name : 'Staff')
    }));

    const newAdvance: AdvancePayment = {
      id: newId,
      payment_number: advNum,
      lab_id: labId,
      lab_name: labName,
      amount,
      allocated_amount: 0,
      remaining_amount: amount,
      payment_method: method,
      payment_date: nowStr.split(' ')[0],
      reference_number: referenceNumber,
      notes,
      recorded_by: user ? user.name : 'Staff',
      created_at: nowStr,
      attachments: preparedAttachments
    };

    setAdvancePayments((prev) => [newAdvance, ...prev]);

    const notif: AppNotification = {
      id: genId('notif'),
      type: 'system',
      title: `Advance Deposit Received: ${advNum}`,
      message: `Advance deposit of PKR ${(amount || 0).toLocaleString()} received from ${labName} via ${method.toUpperCase()}. Added to clinic credit balance.`,
      lab_id: labId,
      is_read: false,
      is_archived: false,
      created_at: nowStr
    };
    setNotifications((n) => [notif, ...n]);

    triggerAgentWorkflow('ADVANCE_PAYMENT_RECORDED', { labId, labName, amount, advNum });
    return newAdvance;
  };

  const applyAdvanceCredit = (
    labId: string,
    invoiceId: string,
    amount: number,
    notes?: string
  ): boolean => {
    if (amount <= 0 || isNaN(amount)) return false;
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) return false;

    const remainingDue = inv.final_amount - inv.amount_paid;
    if (remainingDue <= 0) return false;

    const clinicAdvances = advancePayments.filter((a) => a.lab_id === labId && a.remaining_amount > 0);
    const totalAvailable = clinicAdvances.reduce((sum, a) => sum + a.remaining_amount, 0);
    if (totalAvailable <= 0) return false;

    const toApply = Math.min(amount, remainingDue, totalAvailable);
    if (toApply <= 0) return false;

    let unallocatedNeeded = toApply;
    const usedAdvanceRefs: string[] = [];

    // Deduct from advance payments (oldest first)
    setAdvancePayments((prev) =>
      prev.map((adv) => {
        if (adv.lab_id !== labId || adv.remaining_amount <= 0 || unallocatedNeeded <= 0) return adv;
        const take = Math.min(adv.remaining_amount, unallocatedNeeded);
        unallocatedNeeded -= take;
        usedAdvanceRefs.push(adv.payment_number);
        return {
          ...adv,
          allocated_amount: adv.allocated_amount + take,
          remaining_amount: adv.remaining_amount - take
        };
      })
    );

    const advPaymentNum = generatePaymentNumber();
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const paymentRecord: PaymentRecord = {
      id: `pay-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      payment_number: advPaymentNum,
      invoice_id: invoiceId,
      invoice_number: inv.invoice_number,
      case_id: inv.case_id,
      case_number: inv.case_number,
      lab_id: inv.lab_id,
      lab_name: inv.lab_name,
      amount: toApply,
      payment_method: 'advance',
      payment_date: nowStr.split(' ')[0],
      reference_number: usedAdvanceRefs.join(', '),
      notes: notes ? `${notes} (Applied from Advance: ${usedAdvanceRefs.join(', ')})` : `Settled from Clinic Advance Balance (${usedAdvanceRefs.join(', ')})`,
      recorded_by: user ? user.name : 'Staff',
      created_at: nowStr,
      payment_type: 'advance_allocation'
    };

    setInvoices((prev) =>
      prev.map((item) => {
        if (item.id !== invoiceId) return item;
        const newPaid = item.amount_paid + toApply;
        const newStatus = newPaid >= item.final_amount ? 'paid' : 'partial';
        return {
          ...item,
          amount_paid: newPaid,
          payment_status: newStatus,
          payments: [paymentRecord, ...(item.payments || [])]
        };
      })
    );

    if (inv.amount_paid + toApply >= inv.final_amount) {
      const notif: AppNotification = {
        id: genId('notif'),
        type: 'system',
        title: `Invoice ${inv.invoice_number} Settled via Advance`,
        message: `Advance credit of PKR ${(toApply || 0).toLocaleString()} applied to ${inv.invoice_number} for ${inv.lab_name}. Invoice is fully settled.`,
        invoice_id: inv.id,
        lab_id: inv.lab_id,
        is_read: false,
        is_archived: false,
        created_at: nowStr
      };
      setNotifications((n) => [notif, ...n]);
    }

    return true;
  };

  const recordAccountAdjustment = (
    labId: string,
    type: 'credit_note' | 'debit_adjustment' | 'refund',
    amount: number,
    reason: string,
    referenceNumber?: string,
    attachments?: PaymentAttachment[]
  ): AccountAdjustment => {
    const lab = labs.find((l) => l.id === labId);
    const labName = lab ? lab.name : 'Dental Clinic';
    const adjNum = generateAdjustmentNumber(type);
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const newId = `adj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const newAdj: AccountAdjustment = {
      id: newId,
      adjustment_number: adjNum,
      lab_id: labId,
      lab_name: labName,
      type,
      amount,
      reason,
      date: nowStr.split(' ')[0],
      reference_number: referenceNumber,
      recorded_by: user ? user.name : 'Staff',
      created_at: nowStr,
      attachments: attachments || []
    };

    setAccountAdjustments((prev) => [newAdj, ...prev]);

    const notifTitle = type === 'credit_note' ? `Credit Note Issued: ${adjNum}` : (type === 'debit_adjustment' ? `Debit Surcharge: ${adjNum}` : `Refund Issued: ${adjNum}`);
    const notif: AppNotification = {
      id: genId('notif'),
      type: 'system',
      title: notifTitle,
      message: `${notifTitle} for ${labName}. Amount: PKR ${(amount || 0).toLocaleString()}. Reason: ${reason}`,
      lab_id: labId,
      is_read: false,
      is_archived: false,
      created_at: nowStr
    };
    setNotifications((n) => [notif, ...n]);

    return newAdj;
  };

  const deleteAdvancePayment = (advanceId: string) => {
    setAdvancePayments((prev) => prev.filter((a) => a.id !== advanceId));
  };

  const deleteAccountAdjustment = (adjustmentId: string) => {
    setAccountAdjustments((prev) => prev.filter((a) => a.id !== adjustmentId));
  };

  // ==========================================
  // PAYMENTS & RECEIVABLES 2.0 ENGINE
  // ==========================================

  const recordTransactionV2 = (command: {
    clinicId: string;
    amount: number;
    method: 'cash' | 'bank' | 'cheque' | 'advance';
    date: string;
    referenceNumber?: string;
    notes?: string;
    attachments?: PaymentAttachment[];
    allocations: { invoiceId: string; amount: number }[];
    saveRemainingAsAdvance?: boolean;
    isVerified?: boolean;
  }): { payment: PaymentRecord; receiptNumber: string; journal: JournalEntry } => {
    const lab = labs.find((l) => l.id === command.clinicId);
    const labName = lab ? lab.name : 'Dental Clinic';
    const currentYear = new Date().getFullYear();
    const seq = allPayments.length + advancePayments.length + 1;
    const paymentNum = `PAY-${currentYear}-${String(seq).padStart(4, '0')}`;
    const receiptNum = `REC-${currentYear}-${String(seq).padStart(4, '0')}`;
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const paymentId = `pay-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const totalAllocated = command.allocations.reduce((sum, a) => sum + a.amount, 0);
    const unappliedAmount = Math.max(0, command.amount - totalAllocated);

    // Prepare allocations list
    const preparedAllocations: PaymentAllocation[] = command.allocations.map((alloc, idx) => {
      const targetInv = invoices.find((i) => i.id === alloc.invoiceId);
      return {
        id: `alloc-${Date.now()}-${idx}`,
        source_type: 'payment',
        source_id: paymentId,
        source_ref: paymentNum,
        invoice_id: alloc.invoiceId,
        invoice_number: targetInv?.invoice_number || 'INV',
        amount: alloc.amount,
        allocated_at: nowStr,
        allocated_by: user ? user.name : 'Cashier',
        notes: command.notes
      };
    });

    const statusV2: PaymentStatusV2 = command.isVerified
      ? 'reconciled'
      : command.method === 'cash'
      ? 'posted'
      : 'pending_verification';

    const primaryInvoice = command.allocations.length > 0
      ? invoices.find((i) => i.id === command.allocations[0].invoiceId)
      : null;

    const newPayment: PaymentRecord = {
      id: paymentId,
      payment_number: paymentNum,
      receipt_number: receiptNum,
      invoice_id: primaryInvoice?.id || '',
      invoice_number: primaryInvoice?.invoice_number || (preparedAllocations.length > 1 ? 'Multi-Invoice' : 'Advance/Unapplied'),
      case_id: primaryInvoice?.case_id,
      case_number: primaryInvoice?.case_number,
      lab_id: command.clinicId,
      lab_name: labName,
      amount: command.amount,
      payment_method: command.method,
      payment_date: command.date || nowStr.split(' ')[0],
      reference_number: command.referenceNumber,
      notes: command.notes,
      recorded_by: user ? user.name : 'Cashier',
      created_at: nowStr,
      attachments: command.attachments || [],
      payment_type: command.allocations.length > 0 ? 'invoice_payment' : 'advance_payment',
      status: statusV2,
      allocations: preparedAllocations,
      unapplied_amount: unappliedAmount
    };

    // 1. Update Invoices
    setInvoices((prev) =>
      prev.map((inv) => {
        const alloc = command.allocations.find((a) => a.invoiceId === inv.id);
        if (!alloc) return inv;

        const newPaid = (inv.amount_paid || 0) + alloc.amount;
        const newStatus = deriveInvoiceStatus(
          inv.final_amount,
          newPaid,
          inv.due_date,
          inv.credit_notes_total || 0
        );

        const invPaymentSlice: PaymentRecord = {
          ...newPayment,
          id: `pay-slice-${Date.now()}-${inv.id}`,
          invoice_id: inv.id,
          invoice_number: inv.invoice_number,
          amount: alloc.amount
        };

        return {
          ...inv,
          amount_paid: newPaid,
          payment_status: newPaid >= inv.final_amount ? 'paid' : 'partial',
          status_v2: newStatus,
          payments: [invPaymentSlice, ...(inv.payments || [])]
        };
      })
    );

    // 2. If unapplied remainder exists and user opted to save to credit wallet
    if (unappliedAmount > 0 && command.saveRemainingAsAdvance !== false) {
      const advId = `adv-rem-${Date.now()}`;
      const advNum = `ADV-${currentYear}-${String(advancePayments.length + 1).padStart(4, '0')}`;
      const newAdvanceFromRemainder: AdvancePayment = {
        id: advId,
        payment_number: advNum,
        receipt_number: receiptNum,
        lab_id: command.clinicId,
        lab_name: labName,
        amount: unappliedAmount,
        allocated_amount: 0,
        remaining_amount: unappliedAmount,
        payment_method: command.method === 'advance' ? 'bank' : command.method,
        payment_date: command.date || nowStr.split(' ')[0],
        reference_number: command.referenceNumber || paymentNum,
        notes: `Unapplied remainder from payment ${paymentNum}`,
        recorded_by: user ? user.name : 'Cashier',
        created_at: nowStr,
        status: 'available'
      };
      setAdvancePayments((prev) => [newAdvanceFromRemainder, ...prev]);
    }

    // 3. Build Balanced Journal Entry
    const journal = buildPaymentJournal(
      newPayment,
      preparedAllocations,
      unappliedAmount,
      user ? user.name : 'Cashier'
    );
    newPayment.journal_id = journal.id;
    setJournalEntries((prev) => [journal, ...prev]);

    // 4. Record Audit Event
    const auditEvt: AuditEvent = {
      id: `aud-${Date.now()}`,
      timestamp: nowStr,
      actor: user ? user.name : 'Cashier',
      action: 'PAYMENT_COLLECTED',
      entity_type: 'payment',
      entity_id: paymentId,
      entity_ref: paymentNum,
      notes: `Collected ${formatPKR(command.amount)} from ${labName} via ${command.method.toUpperCase()}. Allocated: ${formatPKR(totalAllocated)}, Unapplied Credit: ${formatPKR(unappliedAmount)}.`
    };
    setAuditEvents((prev) => [auditEvt, ...prev]);

    // 5. Create Reconciliation Item if Bank or Cheque
    if (command.method === 'bank' || command.method === 'cheque') {
      const recItem: ReconciliationItem = {
        id: `rec-${Date.now()}`,
        payment_id: paymentId,
        reference_number: command.referenceNumber || paymentNum,
        method: command.method,
        amount: command.amount,
        date: command.date || nowStr.split(' ')[0],
        lab_id: command.clinicId,
        lab_name: labName,
        invoice_id: primaryInvoice?.id,
        invoice_number: primaryInvoice?.invoice_number,
        status: command.isVerified ? 'verified' : 'suggested_match',
        notes: `Payment ${paymentNum} recorded via ${command.method.toUpperCase()}`,
        proof_url: command.attachments && command.attachments[0] ? command.attachments[0].file_url : undefined,
        verified_at: command.isVerified ? nowStr : undefined,
        verified_by: command.isVerified ? (user ? user.name : 'Cashier') : undefined
      };
      setReconciliationItems((prev) => [recItem, ...prev]);
    }

    // 6. In-App Notification
    const notif: AppNotification = {
      id: genId('notif'),
      type: 'system',
      title: `Payment Received: ${receiptNum}`,
      message: `Received ${formatPKR(command.amount)} from ${labName} via ${command.method.toUpperCase()}. Receipt ${receiptNum} issued.`,
      lab_id: command.clinicId,
      is_read: false,
      is_archived: false,
      created_at: nowStr
    };
    setNotifications((prev) => [notif, ...prev]);

    // Voucher trail for this transaction
    const firstAllocInvoice = preparedAllocations[0]
      ? invoices.find((i) => i.id === preparedAllocations[0].invoice_id)
      : undefined;
    saveVoucherToSystem({
      voucher_number: paymentNum,
      voucher_type: 'invoice',
      case_id: firstAllocInvoice?.case_id || '',
      case_number: firstAllocInvoice?.case_number || '',
      lab_name: labName,
      doctor_name: firstAllocInvoice?.doctor_name || '',
      patient_name: firstAllocInvoice?.patient_name || '',
      case_type_name: firstAllocInvoice?.case_type_name || '',
      amount: command.amount,
      notes: command.notes || `${command.method} payment received from ${labName}`
    });

    return { payment: newPayment, receiptNumber: receiptNum, journal };
  };

  const recordAdvanceDepositV2 = (command: {
    clinicId: string;
    amount: number;
    method: 'cash' | 'bank' | 'cheque';
    date?: string;
    referenceNumber?: string;
    notes?: string;
    attachments?: PaymentAttachment[];
    isVerified?: boolean;
  }): { advance: AdvancePayment; receiptNumber: string; journal: JournalEntry } => {
    const lab = labs.find((l) => l.id === command.clinicId);
    const labName = lab ? lab.name : 'Dental Clinic';
    const currentYear = new Date().getFullYear();
    const seq = advancePayments.length + 1;
    const advNum = `ADV-${currentYear}-${String(seq).padStart(4, '0')}`;
    const receiptNum = `REC-${currentYear}-${String(allPayments.length + seq).padStart(4, '0')}`;
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const advId = `adv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const newAdvance: AdvancePayment = {
      id: advId,
      payment_number: advNum,
      receipt_number: receiptNum,
      lab_id: command.clinicId,
      lab_name: labName,
      amount: command.amount,
      allocated_amount: 0,
      remaining_amount: command.amount,
      payment_method: command.method,
      payment_date: command.date || nowStr.split(' ')[0],
      reference_number: command.referenceNumber,
      notes: command.notes,
      recorded_by: user ? user.name : 'Cashier',
      created_at: nowStr,
      attachments: command.attachments || [],
      status: 'available'
    };

    // Double-entry journal
    const journal = buildAdvanceDepositJournal(newAdvance, user ? user.name : 'Cashier');
    newAdvance.journal_id = journal.id;

    setAdvancePayments((prev) => [newAdvance, ...prev]);
    setJournalEntries((prev) => [journal, ...prev]);

    // Audit event
    const auditEvt: AuditEvent = {
      id: `aud-${Date.now()}`,
      timestamp: nowStr,
      actor: user ? user.name : 'Cashier',
      action: 'ADVANCE_DEPOSIT_RECORDED',
      entity_type: 'advance_payment',
      entity_id: advId,
      entity_ref: advNum,
      notes: `Recorded advance deposit of ${formatPKR(command.amount)} from ${labName} via ${command.method.toUpperCase()}. Available in clinic credit wallet.`
    };
    setAuditEvents((prev) => [auditEvt, ...prev]);

    // Reconciliation item
    if (command.method === 'bank' || command.method === 'cheque') {
      const recItem: ReconciliationItem = {
        id: `rec-${Date.now()}`,
        payment_id: advId,
        reference_number: command.referenceNumber || advNum,
        method: command.method,
        amount: command.amount,
        date: command.date || nowStr.split(' ')[0],
        lab_id: command.clinicId,
        lab_name: labName,
        status: command.isVerified ? 'verified' : 'suggested_match',
        notes: `Advance deposit ${advNum} received via ${command.method.toUpperCase()}`,
        proof_url: command.attachments && command.attachments[0] ? command.attachments[0].file_url : undefined,
        verified_at: command.isVerified ? nowStr : undefined,
        verified_by: command.isVerified ? (user ? user.name : 'Cashier') : undefined
      };
      setReconciliationItems((prev) => [recItem, ...prev]);
    }

    // Notification
    const notif: AppNotification = {
      id: genId('notif'),
      type: 'system',
      title: `Advance Deposit Received: ${advNum}`,
      message: `Deposit of ${formatPKR(command.amount)} added to ${labName} credit wallet. Receipt ${receiptNum}.`,
      lab_id: command.clinicId,
      is_read: false,
      is_archived: false,
      created_at: nowStr
    };
    setNotifications((prev) => [notif, ...prev]);

    return { advance: newAdvance, receiptNumber: receiptNum, journal };
  };

  const applyAdvanceCreditV2 = (command: {
    clinicId: string;
    invoiceId: string;
    amount: number;
    notes?: string;
  }): boolean => {
    if (command.amount <= 0 || isNaN(command.amount)) return false;
    const inv = invoices.find((i) => i.id === command.invoiceId);
    if (!inv) return false;

    const remainingDue = Math.max(0, inv.final_amount - (inv.amount_paid || 0) - (inv.credit_notes_total || 0));
    if (remainingDue <= 0) return false;

    const availableAdvances = advancePayments.filter(
      (a) => a.lab_id === command.clinicId && a.remaining_amount > 0 && !a.is_reversed
    );
    const totalAvailable = availableAdvances.reduce((sum, a) => sum + a.remaining_amount, 0);
    if (totalAvailable <= 0) return false;

    const toApply = Math.min(command.amount, remainingDue, totalAvailable);
    if (toApply <= 0) return false;

    let unallocatedNeeded = toApply;
    const usedAdvanceRefs: string[] = [];
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);

    // FIFO deduction
    setAdvancePayments((prev) =>
      prev.map((adv) => {
        if (adv.lab_id !== command.clinicId || adv.remaining_amount <= 0 || unallocatedNeeded <= 0 || adv.is_reversed) {
          return adv;
        }
        const take = Math.min(adv.remaining_amount, unallocatedNeeded);
        unallocatedNeeded -= take;
        usedAdvanceRefs.push(adv.payment_number);

        const newRemaining = adv.remaining_amount - take;
        const newStatus = newRemaining <= 0 ? 'fully_allocated' : 'partially_allocated';

        return {
          ...adv,
          allocated_amount: adv.allocated_amount + take,
          remaining_amount: newRemaining,
          status: newStatus as AdvanceCreditStatus
        };
      })
    );

    // Update invoice
    const advPaymentNum = `PAY-ADV-${Date.now().toString(36).toUpperCase()}`;
    const paymentSlice: PaymentRecord = {
      id: `pay-adv-${Date.now()}`,
      payment_number: advPaymentNum,
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      case_id: inv.case_id,
      case_number: inv.case_number,
      lab_id: inv.lab_id,
      lab_name: inv.lab_name,
      amount: toApply,
      payment_method: 'advance',
      payment_date: nowStr.split(' ')[0],
      reference_number: usedAdvanceRefs.join(', '),
      notes: command.notes ? `${command.notes} (Applied from: ${usedAdvanceRefs.join(', ')})` : `Applied from advance deposit ${usedAdvanceRefs.join(', ')}`,
      recorded_by: user ? user.name : 'Staff',
      created_at: nowStr,
      payment_type: 'advance_allocation',
      status: 'posted'
    };

    setInvoices((prev) =>
      prev.map((item) => {
        if (item.id !== inv.id) return item;
        const newPaid = (item.amount_paid || 0) + toApply;
        const newStatus = deriveInvoiceStatus(item.final_amount, newPaid, item.due_date, item.credit_notes_total || 0);

        return {
          ...item,
          amount_paid: newPaid,
          payment_status: newPaid >= item.final_amount ? 'paid' : 'partial',
          status_v2: newStatus,
          payments: [paymentSlice, ...(item.payments || [])]
        };
      })
    );

    // Double-entry journal
    const journal = buildApplyAdvanceJournal(
      usedAdvanceRefs.join(', '),
      inv,
      toApply,
      user ? user.name : 'Staff'
    );
    setJournalEntries((prev) => [journal, ...prev]);

    // Audit event
    const auditEvt: AuditEvent = {
      id: `aud-${Date.now()}`,
      timestamp: nowStr,
      actor: user ? user.name : 'Staff',
      action: 'ADVANCE_CREDIT_APPLIED',
      entity_type: 'invoice',
      entity_id: inv.id,
      entity_ref: inv.invoice_number,
      notes: `Applied ${formatPKR(toApply)} from advance (${usedAdvanceRefs.join(', ')}) to invoice ${inv.invoice_number}.`
    };
    setAuditEvents((prev) => [auditEvt, ...prev]);

    return true;
  };

  const issueCreditNoteV2 = (command: {
    clinicId: string;
    invoiceId: string;
    amount: number;
    reasonCode: string;
    reasonText: string;
    approvedBy?: string;
  }): AccountAdjustment => {
    const lab = labs.find((l) => l.id === command.clinicId);
    const labName = lab ? lab.name : 'Dental Clinic';
    const inv = invoices.find((i) => i.id === command.invoiceId);
    const currentYear = new Date().getFullYear();
    const seq = accountAdjustments.length + 1;
    const crNum = `CR-${currentYear}-${String(seq).padStart(4, '0')}`;
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const adjId = `adj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const newAdj: AccountAdjustment = {
      id: adjId,
      adjustment_number: crNum,
      credit_note_number: crNum,
      lab_id: command.clinicId,
      lab_name: labName,
      type: command.reasonCode === 'bad_debt' ? 'write_off' : 'credit_note',
      amount: command.amount,
      reason: `[${command.reasonCode.toUpperCase()}] ${command.reasonText}`,
      date: nowStr.split(' ')[0],
      invoice_id: command.invoiceId,
      invoice_number: inv?.invoice_number,
      recorded_by: user ? user.name : 'Manager',
      approved_by: command.approvedBy || (user ? user.name : 'Lab Director'),
      created_at: nowStr,
      status: 'posted'
    };

    // Update target invoice
    if (inv) {
      setInvoices((prev) =>
        prev.map((item) => {
          if (item.id !== inv.id) return item;
          const currentCr = item.credit_notes_total || 0;
          const newCr = currentCr + command.amount;
          const newStatus = deriveInvoiceStatus(item.final_amount, item.amount_paid || 0, item.due_date, newCr);

          return {
            ...item,
            credit_notes_total: newCr,
            status_v2: newStatus,
            payment_status: (item.amount_paid || 0) >= (item.final_amount - newCr) ? 'paid' : item.payment_status
          };
        })
      );
    }

    // Journal
    const journal = buildAdjustmentJournal(newAdj, user ? user.name : 'Manager');
    newAdj.journal_id = journal.id;

    setAccountAdjustments((prev) => [newAdj, ...prev]);
    setJournalEntries((prev) => [journal, ...prev]);

    // Voucher trail for credit notes
    saveVoucherToSystem({
      voucher_number: crNum,
      voucher_type: 'invoice',
      case_id: inv?.case_id || '',
      case_number: inv?.case_number || '',
      lab_name: labName,
      doctor_name: inv?.doctor_name || '',
      patient_name: inv?.patient_name || '',
      case_type_name: inv?.case_type_name || '',
      amount: command.amount,
      notes: command.reasonText || `Credit note issued on ${inv?.invoice_number || 'invoice'}`
    });

    // Audit Event
    const auditEvt: AuditEvent = {
      id: `aud-${Date.now()}`,
      timestamp: nowStr,
      actor: user ? user.name : 'Manager',
      action: 'CREDIT_NOTE_ISSUED',
      entity_type: 'credit_note',
      entity_id: adjId,
      entity_ref: crNum,
      reason: command.reasonText,
      notes: `Issued credit note ${crNum} of ${formatPKR(command.amount)} for invoice ${inv?.invoice_number || 'N/A'}. Reason: ${command.reasonCode} - ${command.reasonText}`
    };
    setAuditEvents((prev) => [auditEvt, ...prev]);

    return newAdj;
  };

  const reverseTransactionV2 = (command: {
    referenceType: 'payment' | 'advance_payment' | 'adjustment';
    referenceId: string;
    reason: string;
  }): boolean => {
    if (!command.reason.trim()) return false;
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const actor = user ? user.name : 'Supervisor';

    if (command.referenceType === 'payment') {
      // Find payment in all payments
      let targetPayment: PaymentRecord | null = null;
      for (const inv of invoices) {
        const p = (inv.payments || []).find((pay) => pay.id === command.referenceId || pay.payment_number === command.referenceId);
        if (p) {
          targetPayment = p;
          break;
        }
      }

      if (!targetPayment) return false;

      // Mark payment reversed on invoices and adjust amount_paid
      setInvoices((prev) =>
        prev.map((inv) => {
          const match = (inv.payments || []).find((p) => p.id === command.referenceId || p.payment_number === command.referenceId);
          if (!match || match.is_reversed) return inv;

          const updatedPayments = (inv.payments || []).map((p) =>
            p.id === match.id
              ? {
                  ...p,
                  is_reversed: true,
                  status: 'reversed' as PaymentStatusV2,
                  reversal_reason: command.reason,
                  reversed_at: nowStr,
                  reversed_by: actor
                }
              : p
          );

          const activePaid = updatedPayments
            .filter((p) => !p.is_reversed)
            .reduce((sum, p) => sum + p.amount, 0);

          const newStatus = deriveInvoiceStatus(inv.final_amount, activePaid, inv.due_date, inv.credit_notes_total || 0);

          return {
            ...inv,
            amount_paid: activePaid,
            payment_status: activePaid >= inv.final_amount ? 'paid' : (activePaid > 0 ? 'partial' : 'unpaid'),
            status_v2: newStatus,
            payments: updatedPayments
          };
        })
      );

      // Compensating Journal
      const origJournal = journalEntries.find(
        (j) => j.reference_id === targetPayment?.id || j.reference_number === targetPayment?.payment_number
      );
      if (origJournal) {
        const revJournal = buildReversalJournal(origJournal, command.reason, actor);
        setJournalEntries((prev) => [revJournal, ...prev]);
      }

      // Audit Event
      const auditEvt: AuditEvent = {
        id: `aud-${Date.now()}`,
        timestamp: nowStr,
        actor,
        action: 'TRANSACTION_REVERSED',
        entity_type: 'payment',
        entity_id: targetPayment.id,
        entity_ref: targetPayment.payment_number || 'PAY',
        reason: command.reason,
        notes: `Reversed payment ${targetPayment.payment_number} (${formatPKR(targetPayment.amount)}). Reason: ${command.reason}`
      };
      setAuditEvents((prev) => [auditEvt, ...prev]);

      return true;
    } else if (command.referenceType === 'advance_payment') {
      const adv = advancePayments.find((a) => a.id === command.referenceId || a.payment_number === command.referenceId);
      if (!adv || adv.is_reversed) return false;

      setAdvancePayments((prev) =>
        prev.map((a) =>
          a.id === adv.id
            ? {
                ...a,
                is_reversed: true,
                status: 'reversed',
                reversal_reason: command.reason,
                reversed_at: nowStr,
                reversed_by: actor,
                remaining_amount: 0
              }
            : a
        )
      );

      const origJournal = journalEntries.find(
        (j) => j.reference_id === adv.id || j.reference_number === adv.payment_number
      );
      if (origJournal) {
        const revJournal = buildReversalJournal(origJournal, command.reason, actor);
        setJournalEntries((prev) => [revJournal, ...prev]);
      }

      const auditEvt: AuditEvent = {
        id: `aud-${Date.now()}`,
        timestamp: nowStr,
        actor,
        action: 'TRANSACTION_REVERSED',
        entity_type: 'advance_payment',
        entity_id: adv.id,
        entity_ref: adv.payment_number,
        reason: command.reason,
        notes: `Reversed advance deposit ${adv.payment_number} (${formatPKR(adv.amount)}). Reason: ${command.reason}`
      };
      setAuditEvents((prev) => [auditEvt, ...prev]);

      return true;
    } else if (command.referenceType === 'adjustment') {
      const adj = accountAdjustments.find((a) => a.id === command.referenceId || a.adjustment_number === command.referenceId);
      if (!adj || adj.is_reversed) return false;

      // Restore invoice credit if was credit note
      if (adj.invoice_id) {
        setInvoices((prev) =>
          prev.map((item) => {
            if (item.id !== adj.invoice_id) return item;
            const newCr = Math.max(0, (item.credit_notes_total || 0) - adj.amount);
            const newStatus = deriveInvoiceStatus(item.final_amount, item.amount_paid || 0, item.due_date, newCr);
            return {
              ...item,
              credit_notes_total: newCr,
              status_v2: newStatus
            };
          })
        );
      }

      setAccountAdjustments((prev) =>
        prev.map((a) =>
          a.id === adj.id
            ? {
                ...a,
                is_reversed: true,
                status: 'reversed',
                reversal_reason: command.reason,
                reversed_at: nowStr,
                reversed_by: actor
              }
            : a
        )
      );

      const origJournal = journalEntries.find(
        (j) => j.reference_id === adj.id || j.reference_number === adj.adjustment_number
      );
      if (origJournal) {
        const revJournal = buildReversalJournal(origJournal, command.reason, actor);
        setJournalEntries((prev) => [revJournal, ...prev]);
      }

      const auditEvt: AuditEvent = {
        id: `aud-${Date.now()}`,
        timestamp: nowStr,
        actor,
        action: 'TRANSACTION_REVERSED',
        entity_type: 'adjustment',
        entity_id: adj.id,
        entity_ref: adj.adjustment_number,
        reason: command.reason,
        notes: `Reversed adjustment ${adj.adjustment_number} (${formatPKR(adj.amount)}). Reason: ${command.reason}`
      };
      setAuditEvents((prev) => [auditEvt, ...prev]);

      return true;
    }

    return false;
  };

  const reconcileItemV2 = (id: string, matchNotes?: string) => {
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const actor = user ? user.name : 'Auditor';

    setReconciliationItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'verified',
              verified_at: nowStr,
              verified_by: actor,
              notes: matchNotes ? `${item.notes || ''} | Reconciled: ${matchNotes}` : item.notes
            }
          : item
      )
    );

    const auditEvt: AuditEvent = {
      id: `aud-${Date.now()}`,
      timestamp: nowStr,
      actor,
      action: 'RECONCILIATION_VERIFIED',
      entity_type: 'reconciliation',
      entity_id: id,
      entity_ref: id,
      notes: `Reconciliation verified for item ${id}. ${matchNotes || ''}`
    };
    setAuditEvents((prev) => [auditEvt, ...prev]);
  };

  const flagReconciliationExceptionV2 = (id: string, reason: string) => {
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const actor = user ? user.name : 'Auditor';

    setReconciliationItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'exception',
              exception_reason: reason
            }
          : item
      )
    );

    const auditEvt: AuditEvent = {
      id: `aud-${Date.now()}`,
      timestamp: nowStr,
      actor,
      action: 'RECONCILIATION_EXCEPTION',
      entity_type: 'reconciliation',
      entity_id: id,
      entity_ref: id,
      reason,
      notes: `Reconciliation flagged as exception: ${reason}`
    };
    setAuditEvents((prev) => [auditEvt, ...prev]);
  };

  const getJournalEntriesForEntity = (referenceId: string): JournalEntry[] => {
    if (!referenceId) return [];
    return journalEntries.filter(
      (j) => j.reference_id === referenceId || j.reference_number === referenceId
    );
  };

  const getAuditHistoryForEntity = (entityId: string): AuditEvent[] => {
    if (!entityId) return [];
    return auditEvents.filter(
      (a) => a.entity_id === entityId || a.entity_ref === entityId
    );
  };

  // Notifications
  const markNotificationRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true, read: true } : n)));
  };

  const markNotificationUnread = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: false, read: false } : n)));
  };

  const markAllNotificationsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true, read: true })));
  };

  const clearReadNotifications = () => {
    setNotifications((prev) => prev.filter((n) => !n.is_read && !n.read));
  };

  const clearAllNotifications = () => {
    setNotifications([]);
  };

  const archiveNotification = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_archived: true } : n)));
  };

  const restoreNotification = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_archived: false } : n)));
  };

  const deleteNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const bulkDeleteNotifications = (ids: string[]) => {
    setNotifications((prev) => prev.filter((n) => !ids.includes(n.id)));
    showToast(`Removed ${ids.length} notification(s)`, 'info');
  };

  const addNotification = (n: Omit<AppNotification, 'id' | 'created_at'>) => {
    const newNotif: AppNotification = {
      ...n,
      id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      created_at: new Date().toISOString().replace('T', ' ').substring(0, 16),
      is_read: false,
      read: false,
      is_archived: false,
    };
    setNotifications((prev) => [newNotif, ...prev]);
  };

  // Settings
  const updateUserPreferences = (prefs: Partial<UserPreferences>) => {
    setUserPreferences((prev) => ({ ...prev, ...prefs }));
  };

  return (
    <AppContext.Provider
      value={{
        currentView,
        setCurrentView,
        user,
        users,
        login,
        logout,
        addUser,
        updateUser,
        deleteUser,
        changePassword,
        createInitialAdmin,
        sidebarOpen,
        setSidebarOpen,
        todayStr,

        cases,
        labs,
        caseTypes,
        invoices,
        notifications,
        templates,
        labContacts,
        labAddresses,
        pricingOverrides,
        labReviews,
        doctorPreferences,
        userPreferences,
        caseAttachments,
        caseNotes,
        brandingSettings,
        savedVouchers,
        qcInspections,

        unreadCount,
        overdueCount,
        dueTodayCount,
        dueThisWeekCount,

        updateBrandingSettings,
        getBackupData,
        restoreBackupData,
        resetToDemoData,
        wipeAllData,

        addCase,
        updateCase,
        deleteCase,
        addCaseNote,
        editCaseNote,
        deleteCaseNote,
        addCaseAttachment,
        deleteCaseAttachment,

        recordQcCase,
        getQcState,
        getQcMetrics,

        saveAsTemplate,
        deleteTemplate,

        addLab,
        updateLab,
        deleteLab,
        addLabContact,
        updateLabContact,
        deleteLabContact,
        addLabAddress,
        updateLabAddress,
        deleteLabAddress,
        addPricingOverride,
        deletePricingOverride,

        setDoctorPreferredLab,
        getDoctorPreferredLab,

        addCaseType,
        updateCaseType,
        deleteCaseType,

        recordPayment,
        deletePayment,
        allPayments,
        getLabFinancialSummary,
        getClinicFinancialSummary,
        getLedgerEntries,
        generatePaymentNumber,
        updateInvoice,
        bulkMarkPaid,
        deleteInvoice,

        advancePayments,
        accountAdjustments,
        journalEntries,
        auditEvents,
        reconciliationItems,
        recordAdvancePayment,
        applyAdvanceCredit,
        recordAccountAdjustment,
        deleteAdvancePayment,
        deleteAccountAdjustment,

        // Payments & Receivables 2.0
        recordTransactionV2,
        recordAdvanceDepositV2,
        applyAdvanceCreditV2,
        issueCreditNoteV2,
        reverseTransactionV2,
        reconcileItemV2,
        flagReconciliationExceptionV2,
        getJournalEntriesForEntity,
        getAuditHistoryForEntity,

        saveVoucherToSystem,
        deleteSavedVoucher,

        markNotificationRead,
        markNotificationUnread,
        markAllNotificationsRead,
        clearReadNotifications,
        clearAllNotifications,
        archiveNotification,
        restoreNotification,
        deleteNotification,
        bulkDeleteNotifications,
        addNotification,
        markAsRead: markNotificationRead,
        markAllNotificationsAsRead: markAllNotificationsRead,

        selectedCaseForModal,
        setSelectedCaseForModal,

        // Toast & Modals
        toast,
        showToast,
        hideToast,
        confirmModal,
        confirmAction,
        closeConfirmModal,

        // Filter presets
        caseFilterPreset,
        setCaseFilterPreset,
        billingFilterPreset,
        setBillingFilterPreset,

        updateUserPreferences,

        searchTerm,
        setSearchTerm,

        sqliteDb,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
