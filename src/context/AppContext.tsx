import React, { createContext, useContext, useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
  deriveInvoiceStatus,
  formatPKR,
  getAgingBucket,
  buildInvoiceJournal,
  buildPaymentJournal,
  buildReversalJournal,
} from '../services/financeDomain';
import {
  computeQcMetrics,
  deriveQcCaseState,
  nextInspectionNo,
  qcDedupeKey,
  qcReasonLabel,
  statusAfterQc,
} from '../services/qcDomain';
import { getTodayStr, getNowStamp } from '../utils/dateUtils';
import { useSettingsDomain } from './hooks/useSettingsDomain';
import { useCasesDomain } from './hooks/useCasesDomain';
import { selectCasesToAutoArchive } from './hooks/autoArchive';
import {
  nextCaseNumber,
  nextInvoiceNumber,
  nextPaymentNumber,
  nextAdjustmentNumber,
  collectAllPayments,
  buildLabFinancialSummary,
  buildLedgerEntries,
} from '../services/ledgerDomain';
import { nextReservedInvoiceNumber } from '../services/invoiceNumbering';
import { applyBrandColor } from '../services/brandingTheme';
import { readNotificationCadence, NOTIFICATION_CONFIG_CHANGED } from '../services/notificationSettings';
import { useTransactionCommands } from './hooks/useTransactionCommands';
import { useAuthDomain } from './hooks/useAuthDomain';
import { deriveSimpleStatus, buildInvoiceAllocation, buildPaymentSideEffects } from '../services/paymentDomain';
import { useBillingDomain } from './hooks/useBillingDomain';
import { useNotificationsDomain } from './hooks/useNotificationsDomain';
import { useVoucherLogging } from './hooks/useVoucherLogging';
import {
  buildStatusChangeNotification,
  buildQcFailedNotification,
  buildOverdueAlerts,
  buildUnpaidInvoiceAlerts,
  buildAdvanceDepositV2Notification,
  buildAdjustmentNotification,
  buildPaymentReceivedNotification,
  prependUniqueNotifications,
} from '../services/notificationDomain';
import { hydrateAllFromDb as hydrateAllFromDbShared, dbRows, dbMirror, groupByCase, attachmentsByCase } from './hooks/domainState';
import { isDatabaseReady, getDatabase } from '../db/core';
import { DEFAULT_BRANDING_SETTINGS } from '../db/defaults';
import { syncCollectionsToDb, getLastSyncError } from '../db/syncCore';
import { runIntegrityCheckSafe, IntegrityReport } from '../db/integrityCheck';
import {
  usersRepo, labsRepo, caseTypesRepo, casesRepo, caseNotesRepo, attachmentsRepo,
  caseTemplatesRepo, invoicesRepo, advancePaymentsRepo, adjustmentsRepo, journalRepo,
  notificationsRepo, settingsRepo, auditRepo,
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
  /** Boot-time DB integrity self-check result (null until the boot sweep ran). */
  integrityReport: IntegrityReport | null;
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
  /** Move a delivered/completed case out of the active workstation into the archive. */
  archiveCase: (id: string) => void;
  /** Bring an archived case back to the active workstation. */
  restoreCase: (id: string) => void;
  /** Permanently remove an archived case (typed-confirmation guard lives in the UI). */
  deleteCasePermanently: (id: string) => void;
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
  reassignLabRecords: (fromLabId: string, toLabId: string) => boolean;
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
  deletePayment: (paymentId: string) => void;
  allPayments: PaymentRecord[];
  getLabFinancialSummary: (labId: string) => LabFinancialSummary;
  getClinicFinancialSummary: (clinicId: string) => LabFinancialSummary;
  getLedgerEntries: (filterLabId?: string) => LedgerEntry[];
  generatePaymentNumber: () => string;
  updateInvoice: (id: string, updates: Partial<Invoice>) => void;
  bulkMarkPaid: (invoiceIds: string[], paymentDate?: string) => void;
  deleteInvoice: (id: string) => void;

  // Advance Payments & Account Adjustments
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
    attachments?: PaymentAttachment[],
    date?: string
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
    date?: string;
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
}

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
    // Read the live engine directly. The legacy localStorage-backed service
    // always returned empty here, which resurfaced the first-run setup form
    // on every relaunch even though the created admin was persisted.
    return (usersRepo.all() as UserRow[])
      .filter((u) => !u.is_hidden)
      .map((row) => {
        const safe = { ...row } as Record<string, unknown>;
        delete safe.password_hash;
        delete safe.password_salt;
        delete safe.password;
        safe.isSuperAdmin = !!row.is_super_admin;
        return safe as unknown as UserProfile;
      });
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

  // Login backoff state (session-only, per username; see login())
  const loginBackoffState = useRef(new Map<string, { count: number; lastFail: number; until: number }>());

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

  // Notification list management + voucher logging live in their own domain
  // hooks (audit F2) — same surface AppContext exposed before the split.
  const {
    pushNotifications,
    markNotificationRead, markNotificationUnread, markAllNotificationsRead,
    clearReadNotifications, clearAllNotifications,
    archiveNotification, restoreNotification,
    deleteNotification, bulkDeleteNotifications, addNotification,
  } = useNotificationsDomain(notifications, setNotifications, (count) =>
    showToast(`Removed ${count} notification(s)`, 'info'),
  );

  const { saveVoucherToSystem } = useVoucherLogging({
    savedVouchers,
    setSavedVouchers,
    setCaseNotes,
    actorName: user ? user.name : 'Lab Admin',
    onWorkflowTrigger: (event, payload) => triggerAgentWorkflow(event, payload),
  });

  // Agents/agent-workflow listener simulation (see triggerAgentWorkflow below).

  const [templates, setTemplates] = useState<CaseTemplate[]>(() => dbRows('templates', () => caseTemplatesRepo.all() as unknown as CaseTemplate[]));
  const [labContacts, setLabContacts] = useState<LabContact[]>(() => dbRows('labContacts', () => labContactsRepo.all() as LabContact[]));
  const [labAddresses, setLabAddresses] = useState<LabAddress[]>(() => dbRows('labAddresses', () => labAddressesRepo.all() as LabAddress[]));
  const [pricingOverrides, setPricingOverrides] = useState<LabPricingOverride[]>(() => dbRows('pricingOverrides', () => labPricingOverridesRepo.all() as LabPricingOverride[]));
  const [labReviews, setLabReviews] = useState<LabReview[]>(() => dbRows('labReviews', () => labReviewsRepo.all() as LabReview[]));
  const [doctorPreferences, setDoctorPreferences] = useState<DoctorPreferredLab[]>(() => dbRows('doctorPreferences', () => doctorPreferredLabsRepo.all() as DoctorPreferredLab[]));
  // Settings domain (branding + preferences) lives in useSettingsDomain —
  // identical surface, same SQLite write-through behavior. The signed-in
  // user threads through so preferences hydrate/save per user (D4).
  const { brandingSettings, setBrandingSettings, userPreferences, setUserPreferences } = useSettingsDomain(user);

  // D7 — the stored accent is the single source of truth for `--brand-600`.
  // Applied on boot and on every change (including the login rehydrate, which
  // replaces brandingSettings wholesale), so a swatch change repaints instantly.
  useEffect(() => {
    applyBrandColor(brandingSettings?.primaryColor);
  }, [brandingSettings?.primaryColor]);

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

  // ─── Auto-archive sweep (boot-time) ───
  // Delivered cases older than 30 days (by delivery_date — the Archive tab's
  // age basis; there is no delivered_at timestamp on a case) are archived
  // automatically once per session. Setting the fields here is the whole
  // persistence story: the write-through sync above rewrites the SQLite
  // `cases` table from this state. Runs only when the pref is on (undefined
  // counts as on — it is the default), the database is ready, and cases have
  // hydrated (dbMirror check distinguishes first render from post-boot).
  const autoArchiveRanRef = useRef(false);
  useEffect(() => {
    if (autoArchiveRanRef.current) return;
    if (!isDatabaseReady()) return;
    if (userPreferences?.auto_archive_completed_cases === false) return;
    if (!dbMirror['cases']) return; // wait for hydration
    autoArchiveRanRef.current = true; // decide-once: reruns would re-archive restored cases
    const today = new Date(`${getTodayStr()}T00:00:00`);
    const due = selectCasesToAutoArchive(cases, today);
    if (due.length === 0) return;
    const stamp = new Date().toISOString();
    const dueIds = new Set(due.map((c) => c.id));
    setCases((prev) =>
      prev.map((c) =>
        dueIds.has(c.id) && !c.archived_at
          ? { ...c, archived_at: stamp, updated_at: stamp }
          : c,
      ),
    );
    showToast(
      `Auto-archive: ${due.length} delivered case${due.length === 1 ? '' : 's'} older than 30 days moved to the archive`,
      'success',
    );
  }, [cases, userPreferences]);

  // ─── Integrity self-check (boot-time, read-only) ───
  // Runs once per session after hydration: FK pragma, orphan rows, ledger
  // balance, invoice-journal coverage. Result lands in provider state so
  // Settings → Database & Backup can display it without its own boot scan.
  const [integrityReport, setIntegrityReport] = useState<IntegrityReport | null>(null);
  const integrityRanRef = useRef(false);
  useEffect(() => {
    if (integrityRanRef.current) return;
    if (!isDatabaseReady()) return;
    if (!dbMirror['cases']) return; // wait for hydration
    integrityRanRef.current = true;
    setIntegrityReport(runIntegrityCheckSafe());
  }, []);

  // ─── Sync-failure surfacing + ledger backfill sweep ───
  // Migration 012 backfills issuance journals for invoices that predate the
  // journal wiring, but the whole-table sync rewrites invoices from state —
  // so the backfilled journal_id must ALSO land in React state or the next
  // sync wipes the pairing. Runs once per session after hydration; charges
  // only when the backfill actually created a journal (012 stamps it).
  const ledgerBackfillRanRef = useRef(false);
  useEffect(() => {
    if (ledgerBackfillRanRef.current) return;
    if (!isDatabaseReady()) return;
    if (!dbMirror['cases']) return; // wait for hydration
    ledgerBackfillRanRef.current = true;
    if (invoices.some((i) => !i.journal_id)) {
      const byRef = new Map<string, string>();
      for (const j of journalEntries) {
        if (j.event_type === 'invoice_issued' && j.reference_id && !byRef.has(j.reference_id)) {
          byRef.set(j.reference_id, j.id);
        }
      }
      if (byRef.size > 0) {
        const affected = new Set(invoices.filter((i) => !i.journal_id && byRef.has(i.id)).map((i) => i.id));
        if (affected.size > 0) {
          setInvoices((prev) => prev.map((i) => (affected.has(i.id) && !i.journal_id ? { ...i, journal_id: byRef.get(i.id)! } : i)));
        }
      }
    }
  }, [invoices, journalEntries]);

  useEffect(() => {
    const onSyncStatus = () => {
      const err = getLastSyncError();
      if (err) showToast('Database sync failed — recent changes may not be saved.', 'error');
    };
    window.addEventListener('sync:status', onSyncStatus);
    return () => window.removeEventListener('sync:status', onSyncStatus);
  }, []);

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
  };

  // Auth, user management, and backup/restore/wipe orchestration live in
  // useAuthDomain (audit F2 continuation) - same surface as before.
  const {
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
  } = useAuthDomain({
    user,
    setUser,
    users,
    setUsers,
    setCurrentView,
    loginBackoffState,
    showToast,
    genId,
    snapshot: {
      cases, labs, caseTypes, invoices, notifications, templates, labContacts,
      labAddresses, pricingOverrides, labReviews, doctorPreferences, userPreferences,
      caseAttachments, caseNotes, brandingSettings, savedVouchers, advancePayments,
      accountAdjustments, journalEntries, auditEvents, reconciliationItems, users, qcInspections,
    },
    setCases, setLabs, setCaseTypes, setInvoices, setAdvancePayments, setAccountAdjustments,
    setJournalEntries, setAuditEvents, setReconciliationItems, setNotifications, setTemplates,
    setLabContacts, setLabAddresses, setPricingOverrides, setLabReviews, setDoctorPreferences,
    setUserPreferences, setBrandingSettings, setSavedVouchers, setCaseAttachments, setCaseNotes,
    setQcInspections,
  });


  const deleteSavedVoucher = (id: string) => {
    setSavedVouchers((prev) => prev.filter((v) => v.id !== id));
  };

  // Branding updates
  const updateBrandingSettings = (updates: Partial<BrandingSettings>) => {
    setBrandingSettings((prev) => ({ ...prev, ...updates }));
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

  // D1 — Settings → Notifications announces a cadence change; bumping a counter
  // re-runs both sweeps below so the new cadence applies at once.
  const [notifConfigRev, setNotifConfigRev] = useState(0);
  useEffect(() => {
    const bump = () => setNotifConfigRev((n) => n + 1);
    window.addEventListener(NOTIFICATION_CONFIG_CHANGED, bump);
    return () => window.removeEventListener(NOTIFICATION_CONFIG_CHANGED, bump);
  }, []);

  // Auto-generate overdue case alerts. D1: the sweep honours the cadence the
  // admin set in Settings → Notifications (read straight from the repo so the
  // sweep never depends on a render-scope snapshot going stale).
  useEffect(() => {
    const cadence = readNotificationCadence();
    const alerts = buildOverdueAlerts(cases || [], todayStr, (c) => `notif-overdue-${c.id}`, cadence);

    if (alerts.length > 0) {
      // Dedupe INSIDE the updater: the render-scope `notifications` snapshot
      // goes stale across the rapid re-renders/StrictMode double-invokes this
      // effect fires on, which used to re-insert the same deterministic ids
      // (`notif-overdue-<caseId>`) twice — and a duplicate id aborts the whole
      // SQLite sync transaction, silently stopping ALL persistence.
      setNotifications((prev) => prependUniqueNotifications(prev, alerts));
    }
  }, [cases, todayStr, notifConfigRev]);

  // Auto-generate unpaid-invoice reminders: one per invoice while its due date
  // is today or past — the app's real, local "payment trigger". Because the
  // alert id is invoice-keyed, once a payment logs, the alert disappears.
  useEffect(() => {
    const alerts = buildUnpaidInvoiceAlerts(
      invoices || [],
      todayStr,
      (inv) => `notif-unpaid-${inv.id}`,
      readNotificationCadence('pending_payment'),
    );
    if (alerts.length > 0) {
      setNotifications((prev) => prependUniqueNotifications(prev, alerts));
    }
  }, [invoices, todayStr, notifConfigRev]);

  // Agent workflow listener trigger simulation
  const triggerAgentWorkflow = (event: string, payload: any) => {
    console.log(`[Agent Workflow Triggered] ${event}`, payload);
  };

  // Document number generators (pure ledger domain)
  const generateCaseNumber = () => nextCaseNumber(cases || []);
  // Voided invoice numbers stay retired: the audit trail is the only place a
  // removed invoice's number still exists, and it must never be re-issued.
  const generateInvoiceNumber = () =>
    nextInvoiceNumber(invoices || [], auditEvents.filter((a) => a.action === 'INVOICE_VOIDED').map((a) => a.entity_ref));
  const generatePaymentNumber = () => nextPaymentNumber(invoices);
  const generateAdjustmentNumber = (type: 'credit_note' | 'debit_adjustment' | 'refund') =>
    nextAdjustmentNumber(accountAdjustments, type);

  // Derived collection of all individual payment transactions across all invoices
  const allPayments = useMemo(() => collectAllPayments(invoices), [invoices]);

  // Derived Financial Summary for specific Clinic / Lab
  const getLabFinancialSummary = (labId: string): LabFinancialSummary =>
    buildLabFinancialSummary({ labId, invoices, advancePayments, accountAdjustments });

  const getClinicFinancialSummary = getLabFinancialSummary;

  // Derived Comprehensive Double-Entry Ledger Engine (pure ledger domain)
  const getLedgerEntries = useCallback((filterLabId?: string): LedgerEntry[] =>
    buildLedgerEntries({ invoices, advancePayments, accountAdjustments, filterLabId }),
  [invoices, advancePayments, accountAdjustments]);

  // Cases CRUD
  const addCase = (caseData: Omit<DentalCase, 'id' | 'case_number' | 'created_at' | 'updated_at' | 'history'>) => {
    const newId = genId('case');
    const caseNumber = generateCaseNumber();
    const nowStr = getNowStamp();

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

    // Create corresponding invoice automatically. The number is minted
    // through the reservation service (B2): render-state closures handed out
    // duplicate INV-n when two cases were created inside one render window,
    // and the sync aborted on the UNIQUE constraint. The floor is the live
    // state's max-scan output — byte-identical to the legacy generator —
    // raised monotonically so two mints can never collide.
    const newInvoice: Invoice = {
      id: genId('inv'),
      invoice_number: nextReservedInvoiceNumber(() => generateInvoiceNumber()),
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
      // The invoice is booked on the day the case is REGISTERED — that is the
      // day the work entered the books, and it is the day the billing tabs
      // default their window to. Booking it on the delivery date instead
      // pushed every new invoice days into the future, so a case created
      // today was invisible in the default Today filter until its delivery
      // date arrived. The delivery date remains the due date.
      issue_date: nowStr.split(' ')[0],
      due_date: caseData.delivery_date,
      created_at: nowStr.split(' ')[0],
      payments: []
    };

    // Post the issuance journal (debit A/R / credit Revenue) and stamp it on
    // the invoice BEFORE the invoice enters state. The ledger is double-entry:
    // every invoice must carry its issuance journal or reports cannot
    // reconcile, and a state snapshot without the pairing loses it for a sync.
    const journal = buildInvoiceJournal(newInvoice, user ? user.name : 'System');
    newInvoice.journal_id = journal.id;
    setInvoices((prev) => [newInvoice, ...prev]);
    setJournalEntries((prev) => [journal, ...prev]);

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
    note?: string
  ) => {
    const nowStr = getNowStamp();

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
            pushNotifications(buildStatusChangeNotification({ id: genId('notif'), case: c, status: updates.status, at: nowStr }));
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

    // Sync invoice if price or the owning clinic changed: an invoice left on a
    // stale lab_id trips the labs FK and aborts the whole sync once that clinic
    // is deleted.
    if (updates.price !== undefined || updates.discount !== undefined || updates.final_price !== undefined
      || updates.lab_id !== undefined || updates.lab_name !== undefined || updates.delivery_date !== undefined) {
      // Repricing re-posts the books (audit F11): the old issuance journal is
      // reversed and a fresh one is issued for the new amounts, so the ledger
      // never drifts from the invoice.
      const actor = user ? user.name : 'System';
      const repriceJournals: JournalEntry[] = [];
      const repriceReversals: JournalEntry[] = [];
      setInvoices((prev) =>
        prev.map((inv) => {
          if (inv.case_id !== id) return inv;
          const newAmount = updates.price ?? inv.amount;
          const newDiscount = updates.discount ?? inv.discount;
          // Clamp at zero: a discount larger than the price used to produce a
          // negative final_amount and the CHECK (final_amount >= 0) constraint
          // failed the whole SQLite sync.
          const newFinal = Math.max(0, updates.final_price ?? (newAmount - newDiscount));
          const newStatus = inv.amount_paid >= newFinal ? 'paid' : (inv.amount_paid > 0 ? 'partial' : 'unpaid');
          const reissued: Invoice = {
            ...inv,
            amount: newAmount,
            discount: newDiscount,
            final_amount: newFinal,
            payment_status: newStatus,
            lab_id: updates.lab_id ?? inv.lab_id,
            lab_name: updates.lab_name ?? inv.lab_name,
            issue_date: updates.delivery_date ?? inv.issue_date,
            due_date: updates.delivery_date ?? inv.due_date
          };
          const priorJournal = journalEntries.find((j) => j.reference_type === 'invoice' && j.reference_id === inv.id);
          if (priorJournal) {
            repriceReversals.push(buildReversalJournal(priorJournal, `Invoice ${inv.invoice_number} repriced from case edit`, actor));
          }
          const newIssuance = buildInvoiceJournal(reissued, actor);
          reissued.journal_id = newIssuance.id;
          repriceJournals.push(newIssuance);
          return reissued;
        })
      );
      if (repriceReversals.length > 0 || repriceJournals.length > 0) {
        setJournalEntries((prev) => [...repriceJournals, ...repriceReversals, ...prev]);
      }
    }
  };

  /* ─── Quality control (QC) ────────────────────────────────────────────────
     Single command surface: append an inspection (or a correction of one) and
     let the derived state drive the case. Nothing in this stream is mutated;
     a mistake is amended by appending a correction that supersedes it. */
  const getQcState = (caseId: string): QcCaseState => deriveQcCaseState(qcInspections, caseId);

  const getQcMetrics = (): QcMetrics => computeQcMetrics(qcInspections, cases);

  const recordQcCase = (command: QcCommand): QcReceipt => {
    const nowStr = getNowStamp();
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
        : `QC inspection #${inspectionNo} failed — ${qcReasonLabel(event.reason_code)}`
    );

    let notified = false;
    if (command.result === 'fail') {
      pushNotifications(
        buildQcFailedNotification({ id: genId('notif'), case: targetCase, inspectionNo, reasonLabel: qcReasonLabel(event.reason_code), at: nowStr }),
      );
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

    // Money integrity: linked invoices must never vanish silently. Refuse while
    // any of them carries an active payment (the same gate deleteInvoice
    // enforces) and reverse each issuance journal before removing the rows.
    const linkedInvoices = invoices.filter((inv) => inv.case_id === id);
    const activeInvoices = linkedInvoices.filter((inv) => (inv.payments || []).some((p) => !p.is_reversed));
    if (activeInvoices.length > 0) {
      showToast(
        `Cannot delete ${target ? target.case_number : 'case'}: invoice ${activeInvoices[0].invoice_number} has active payment(s). Reverse them first.`,
        'error'
      );
      return;
    }

    const actor = user ? user.name : 'Staff';
    const reversalJournals: JournalEntry[] = [];
    const voidAudits: AuditEvent[] = [];
    linkedInvoices.forEach((inv) => {
      const origJournal = journalEntries.find((j) => j.reference_type === 'invoice' && j.reference_id === inv.id);
      if (origJournal) {
        reversalJournals.push(buildReversalJournal(origJournal, `Case ${target ? target.case_number : id} deleted — invoice ${inv.invoice_number} voided`, actor));
      }
      voidAudits.push({
        id: `aud-${Date.now()}-${inv.id}`,
        timestamp: getNowStamp(),
        actor,
        action: 'INVOICE_VOIDED',
        entity_type: 'Invoice',
        entity_id: inv.id,
        entity_ref: inv.invoice_number,
        notes: `Voided with case ${target ? target.case_number : id} (PKR ${inv.final_amount.toLocaleString()}) — no active payments.`
      });
    });
    if (reversalJournals.length > 0) setJournalEntries((prev) => [...reversalJournals, ...prev]);
    if (voidAudits.length > 0) setAuditEvents((prev) => [...voidAudits, ...prev]);

    setCases((prev) => prev.filter((c) => c.id !== id));
    setInvoices((prev) => prev.filter((inv) => inv.case_id !== id));
    setNotifications((prev) => prev.filter((n) => n.case_id !== id));
    // QC rows cascade in SQLite (case FK): drop them here too or the rebuild
    // re-inserts orphans and the FK aborts the whole sync.
    setQcInspections((prev) => prev.filter((q) => q.case_id !== id));
    // State hygiene (audit C9): the case is gone, so its notes/attachments
    // maps must not keep orphan entries either.
    setCaseNotes((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)));
    setCaseAttachments((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)));
    if (target) {
      triggerAgentWorkflow('CASE_DELETED', { case_id: id, case_number: target.case_number });
      showToast(`Case ${target.case_number} deleted — linked invoice journals reversed.`, 'success');
    }
  };

  /* Archive lifecycle: the case row is kept (history + invoices stay intact),
     only `archived_at` flips. The sync engine rewrites SQLite from state, so
     setting the timestamp here is the whole persistence story. */
  const archiveCase = (id: string) => {
    const target = cases.find((c) => c.id === id);
    const stamp = new Date().toISOString();
    setCases((prev) => prev.map((c) => (c.id === id ? { ...c, archived_at: stamp, updated_at: stamp } : c)));
    if (target) {
      showToast(`Case ${target.case_number} moved to archive`, 'success');
    }
  };

  const restoreCase = (id: string) => {
    const target = cases.find((c) => c.id === id);
    const stamp = new Date().toISOString();
    setCases((prev) => prev.map((c) => (c.id === id ? { ...c, archived_at: null, updated_at: stamp } : c)));
    if (target) {
      showToast(`Case ${target.case_number} restored to the workstation`, 'success');
    }
  };

  const deleteCasePermanently = (id: string) => {
    const target = cases.find((c) => c.id === id);
    setCases((prev) => prev.filter((c) => c.id !== id));
    setNotifications((prev) => prev.filter((n) => n.case_id !== id));
    setQcInspections((prev) => prev.filter((q) => q.case_id !== id));
    setCaseNotes((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)));
    setCaseAttachments((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)));
    if (isDatabaseReady()) {
      try { casesRepo.deleteCascade(id); } catch { /* sync pass will reconcile */ }
    }
    if (target) {
      showToast(`Case ${target.case_number} permanently deleted`, 'success');
    }
  };

  const addCaseNote = (caseId: string, noteText: string, author: string) => {
    const nowStr = getNowStamp();
    const newNote: CaseNote = {
      id: genId('note'),
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
    const nowStr = getNowStamp();
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
    const nowStr = getNowStamp();
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
      created_at: getTodayStr()
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
      created_at: getTodayStr()
    };
    setLabs((prev) => [newLab, ...prev]);
    return newLab;
  };

  const updateLab = (id: string, updates: Partial<DentalLab>) => {
    setLabs((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)));
  };

  const deleteLab = (id: string) => {
    // FK integrity: cases/invoices/advances/adjustments reference the lab with
    // no cascade. Removing it while any row still points here aborts the whole
    // SQLite sync transaction — refuse and ask for a re-assignment first.
    const referenced =
      cases.some((c) => c.lab_id === id) ||
      invoices.some((inv) => inv.lab_id === id) ||
      advancePayments.some((a) => a.lab_id === id) ||
      accountAdjustments.some((adj) => adj.lab_id === id);
    if (referenced) {
      showToast('Cannot delete this clinic: cases, invoices or transactions still reference it.', 'error');
      return;
    }
    setLabs((prev) => prev.filter((l) => l.id !== id));
    setLabContacts((prev) => prev.filter((lc) => lc.lab_id !== id));
    setLabAddresses((prev) => prev.filter((la) => la.lab_id !== id));
    setPricingOverrides((prev) => prev.filter((po) => po.lab_id !== id));
    setLabReviews((prev) => prev.filter((lr) => lr.lab_id !== id));
  };

  // Bulk clinic re-assignment (audit C3): deleting a clinic is blocked while
  // cases/invoices reference it, so this moves the case records (and their
  // invoices) to another clinic in one step. Advances/adjustments are money
  // rows and stay put — they keep blocking deletion on purpose.
  const reassignLabRecords = (fromLabId: string, toLabId: string): boolean => {
    const target = labs.find((l) => l.id === toLabId);
    if (!target || fromLabId === toLabId) return false;
    const stamp = new Date().toISOString();
    setCases((prev) =>
      prev.map((c) => (c.lab_id === fromLabId ? { ...c, lab_id: target.id, lab_name: target.name, updated_at: stamp } : c))
    );
    setInvoices((prev) =>
      prev.map((inv) => (inv.lab_id === fromLabId ? { ...inv, lab_id: target.id, lab_name: target.name } : inv))
    );
    showToast(`Moved all cases and invoices to ${target.name}.`, 'success');
    return true;
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
          created_at: getTodayStr()
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
      created_at: getTodayStr()
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
  const deletePayment = (paymentId: string) => {
    // Money rows may not be deleted (audit F6): the payment list is owned by
    // the transaction flows, and removal must keep the reversal journal, audit
    // and reversal flags that applyPaymentReversalToInvoice/reverseTransactionV2
    // produce. This legacy entry point is latent (zero callers) and now refuses
    // instead of silently destroying the money trail.
    const target = allPayments.find((p) => p.id === paymentId);
    if (target) {
      showToast(
        `Payment ${target.payment_number || paymentId} cannot be deleted — reverse it instead (Reversal flow).`,
        'error'
      );
    }
  };

  const updateInvoice = (id: string, updates: Partial<Invoice>) => {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== id) return inv;
        // Money columns are owned by the transaction flows (audit F5): a
        // generic invoice edit may change pricing/notes, never silently
        // replace its payment list or paid total.
        const { payments: _ignoredPayments, amount_paid: _ignoredPaid, ...safeUpdates } = updates;
        const updated = { ...inv, ...safeUpdates };
        const finalAmt = safeUpdates.final_amount !== undefined ? safeUpdates.final_amount : updated.final_amount;
        updated.payment_status = deriveSimpleStatus(inv.amount_paid, finalAmt);
        return updated;
      })
    );
  };

  const bulkMarkPaid = (invoiceIds: string[], paymentDate?: string) => {
    const today = paymentDate || getTodayStr();
    const newJournals: JournalEntry[] = [];
    const newAudits: AuditEvent[] = [];

    // Unique payment number PER invoice: generatePaymentNumber() reads the
    // stale pre-update state, so calling it inside the map handed every
    // invoice in the batch the same PAY- number and the payments.payment_number
    // UNIQUE constraint aborted the whole SQLite sync transaction.
    const basePayNum = generatePaymentNumber();
    const payNumFor = (invId: string) =>
      invoiceIds.length > 1 ? `${basePayNum}-${invoiceIds.indexOf(invId) + 1}` : basePayNum;

    setInvoices((prev) =>
      prev.map((inv) => {
        if (!invoiceIds.includes(inv.id)) return inv;
        // Net due must respect stored credit notes, or the settlement records
        // amount_paid beyond what the clinic actually owes.
        const credits = inv.credit_notes_total || 0;
        const remaining = inv.final_amount - credits - inv.amount_paid;
        if (remaining <= 0) return inv;

        const payNum = payNumFor(inv.id);
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
            buildInvoiceAllocation({
              payment: { id: `pay-${Date.now()}-${inv.id}`, payment_number: payNum, amount: remaining } as PaymentRecord,
              invoice: inv,
              actor: user ? user.name : 'Staff',
            }),
          ],
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
          timestamp: getNowStamp(),
          actor: user ? user.name : 'Staff',
          action: 'BULK_PAYMENT_RECORDED',
          entity_type: 'Invoice',
          entity_id: inv.id,
          entity_ref: inv.invoice_number,
          notes: `Cleared outstanding PKR ${remaining.toLocaleString()} via bulk settlement`
        });

        return {
          ...inv,
          amount_paid: inv.final_amount - credits,
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
      timestamp: getNowStamp(),
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

  // Legacy advance-credit entry point (audit F9): zero callers today, and the
  // old body hand-wrote invoice.payments + wallet + status. It now delegates to
  // the V2 command, so there is exactly one implementation of the money
  // movement (journal, allocations, advance wallet and audit all included).
  const applyAdvanceCredit = (
    labId: string,
    invoiceId: string,
    amount: number,
    notes?: string
  ): boolean =>
    applyAdvanceCreditV2({
      clinicId: labId,
      invoiceId,
      amount,
      notes: notes || 'Applied from clinic credit wallet',
    });

  const recordAccountAdjustment = (
    labId: string,
    type: 'credit_note' | 'debit_adjustment' | 'refund',
    amount: number,
    reason: string,
    referenceNumber?: string,
    attachments?: PaymentAttachment[],
    date?: string
  ): AccountAdjustment => {
    const lab = labs.find((l) => l.id === labId);
    const labName = lab ? lab.name : 'Dental Clinic';
    const adjNum = generateAdjustmentNumber(type);
    const nowStr = getNowStamp();
    const newId = `adj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const newAdj: AccountAdjustment = {
      id: newId,
      adjustment_number: adjNum,
      lab_id: labId,
      lab_name: labName,
      type,
      amount,
      reason,
      // Business date first: a backdated refund/adjustment files at its
      // transaction date; created_at stays the record time.
      date: date || nowStr.split(' ')[0],
      reference_number: referenceNumber,
      recorded_by: user ? user.name : 'Staff',
      created_at: nowStr,
      attachments: attachments || []
    };

    setAccountAdjustments((prev) => [newAdj, ...prev]);

    pushNotifications(
      buildAdjustmentNotification({ id: genId('notif'), kind: type, adjNum, labId, labName, amount, reason, at: nowStr }),
    );

    return newAdj;
  };

  const deleteAdvancePayment = (advanceId: string) => {
    // Same money rule as deletePayment (audit F6): advances are reversed
    // (reverseTransactionV2), never deleted — the wallet, journal and audit
    // rows must survive.
    const target = advancePayments.find((a) => a.id === advanceId);
    if (target) {
      showToast(`Advance ${target.payment_number || advanceId} cannot be deleted — reverse it instead (Reversal flow).`, 'error');
    }
  };

  const deleteAccountAdjustment = (adjustmentId: string) => {
    // Same money rule (audit F6): adjustments are reversed, never deleted.
    const target = accountAdjustments.find((a) => a.id === adjustmentId || a.adjustment_number === adjustmentId);
    if (target) {
      showToast(`Adjustment ${target.adjustment_number || adjustmentId} cannot be deleted — reverse it instead (Reversal flow).`, 'error');
    }
  };

  // ==========================================
  // PAYMENTS & RECEIVABLES 2.0 ENGINE
  // ==========================================

  // V2 cashier command flows — rules in services/transactionDomain.ts,
  // state sequencing in useTransactionCommands (audit F2 continuation).
  const {
    recordTransactionV2,
    recordAdvanceDepositV2,
    applyAdvanceCreditV2,
    issueCreditNoteV2,
    reverseTransactionV2,
    reconcileItemV2,
    flagReconciliationExceptionV2,
  } = useTransactionCommands({
    labs,
    invoices,
    setInvoices,
    advancePayments,
    setAdvancePayments,
    accountAdjustments,
    setAccountAdjustments,
    journalEntries,
    setJournalEntries,
    auditEvents,
    setAuditEvents,
    reconciliationItems,
    setReconciliationItems,
    allPayments,
    actorName: user ? user.name : '',
    pushNotifications,
    genId,
    saveVoucherToSystem,
  });

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

  // Notifications (mark/archive/delete/add live in useNotificationsDomain)

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
        integrityReport,

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
        archiveCase,
        restoreCase,
        deleteCasePermanently,
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
        reassignLabRecords,
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
