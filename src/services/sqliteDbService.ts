/**
 * SQLite & Local Relational Storage Service Layer
 * Dental Solutions CAD/CAM Laboratory ERP
 * 
 * Provides an enterprise offline persistence service layer interacting with SQLite relational tables.
 * Ensures all laboratory data operations (cases, partner clinics, invoices, financial ledgers,
 * odontogram records, audit compliance) are persisted in non-volatile storage.
 */

import {
  DentalCase,
  DentalLab,
  CaseType,
  Invoice,
  AppNotification,
  SavedVoucher,
  AdvancePayment,
  AccountAdjustment,
  JournalEntry,
  AuditEvent,
  UserProfile,
  BrandingSettings,
  UserPreferences,
  CaseNote,
  CaseAttachment,
  CaseStatus,
  CaseStatusHistory,
  PriorityLevel,
  PaymentRecord
} from '../types';
import {
  INITIAL_CASE_TYPES,
  INITIAL_USERS,
  INITIAL_CASES,
  INITIAL_LABS,
  INITIAL_INVOICES,
  INITIAL_NOTIFICATIONS,
  INITIAL_ADVANCE_PAYMENTS,
  INITIAL_ADJUSTMENTS,
  INITIAL_JOURNAL_ENTRIES,
  INITIAL_AUDIT_EVENTS
} from '../data/initialData';
import { SQLITE_DDL_SCHEMA, generateSqliteExport, downloadSqliteDump } from './sqliteStorage';

// Storage Keys
const STORAGE_PREFIX = 'dsw_sqlite_';
const KEYS = {
  CASES: `${STORAGE_PREFIX}cases`,
  LABS: `${STORAGE_PREFIX}labs`,
  CASE_TYPES: `${STORAGE_PREFIX}case_types`,
  INVOICES: `${STORAGE_PREFIX}invoices`,
  NOTIFICATIONS: `${STORAGE_PREFIX}notifications`,
  ADVANCE_PAYMENTS: `${STORAGE_PREFIX}advance_payments`,
  ADJUSTMENTS: `${STORAGE_PREFIX}adjustments`,
  JOURNAL_ENTRIES: `${STORAGE_PREFIX}journal_entries`,
  AUDIT_EVENTS: `${STORAGE_PREFIX}audit_events`,
  USERS: `${STORAGE_PREFIX}users`,
  ACTIVE_USER: `${STORAGE_PREFIX}active_user`,
  BRANDING: `${STORAGE_PREFIX}branding`,
  PREFERENCES: `${STORAGE_PREFIX}preferences`,
  VOUCHERS: `${STORAGE_PREFIX}vouchers`,
  CASE_NOTES: `${STORAGE_PREFIX}case_notes`,
  CASE_ATTACHMENTS: `${STORAGE_PREFIX}case_attachments`,
  DB_META: `${STORAGE_PREFIX}metadata`
};

// Mirrors DEFAULT_BRANDING_SETTINGS in src/db/defaults.ts — identity fields
// ship blank; the operator configures them in Settings → Branding.
export const DEFAULT_BRANDING_SETTINGS: BrandingSettings = {
  appName: '',
  tagline: '',
  logoUrl: '',
  primaryColor: '#4f46e5',
  phone: '',
  address: '',
  email: '',
  facebook: '',
  bankName: '',
  bankAccountTitle: '',
  bankAccountNumber: '',
  bankIban: '',
  enable24hWarning: true,
  warningThresholdHours: 24,
  warningHighlightColor: 'rose',
  warningHighlightStyle: 'border',
  cardBgColor: '#ffffff'
};

export const DEFAULT_USER_PREFS: UserPreferences = {
  channels: ['in_app', 'email'],
  frequency: 'real_time',
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  enabled_types: ['overdue_case', 'pending_payment', 'escalation', 'status_change'],
  unsubscribed_all: false,
  currency: 'PKR',
  default_turnaround_days: 3,
  default_priority: 'normal',
  auto_print_job_slips: false
};

// Database Event Listener Mechanism
type DbEventType = 'insert' | 'update' | 'delete' | 'reset' | 'restore';
type DbTable = keyof typeof KEYS;
type DbListener = (table: DbTable, event: DbEventType, payload?: any) => void;

class DatabaseEventEmitter {
  private listeners: DbListener[] = [];

  subscribe(listener: DbListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(table: DbTable, event: DbEventType, payload?: any) {
    this.listeners.forEach((listener) => {
      try {
        listener(table, event, payload);
      } catch (err) {
        console.error('Error in SQLite Database listener:', err);
      }
    });
  }
}

export const dbEvents = new DatabaseEventEmitter();

// Safe LocalStorage Reader / Writer with JSON parsing
function readTable<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`Failed to read SQLite table data from ${key}:`, err);
    return fallback;
  }
}

function writeTable<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.error(`Failed to write SQLite table data to ${key}:`, err);
  }
}

/**
 * Core SQLite Database Service Layer
 */
export class SqliteDatabaseService {
  private static instance: SqliteDatabaseService;

  private constructor() {
    this.initializeDatabase();
  }

  public static getInstance(): SqliteDatabaseService {
    if (!SqliteDatabaseService.instance) {
      SqliteDatabaseService.instance = new SqliteDatabaseService();
    }
    return SqliteDatabaseService.instance;
  }

  /**
   * Initializes SQLite tables and schemas if not already present
   */
  public initializeDatabase(): void {
    const meta = readTable<{ initialized: boolean; version: string }>(KEYS.DB_META, {
      initialized: false,
      version: '1.0.0'
    });

    if (!meta.initialized) {
      // Initialize Default Seed Users if empty
      const existingUsers = readTable<UserProfile[]>(KEYS.USERS, []);
      if (existingUsers.length === 0) {
        writeTable(KEYS.USERS, INITIAL_USERS);
      }

      // Initialize Catalog Case Types if empty
      const existingTypes = readTable<CaseType[]>(KEYS.CASE_TYPES, []);
      if (existingTypes.length === 0) {
        writeTable(KEYS.CASE_TYPES, INITIAL_CASE_TYPES);
      }

      // Initialize Empty Tables
      if (!localStorage.getItem(KEYS.CASES)) writeTable(KEYS.CASES, []);
      if (!localStorage.getItem(KEYS.LABS)) writeTable(KEYS.LABS, []);
      if (!localStorage.getItem(KEYS.INVOICES)) writeTable(KEYS.INVOICES, []);
      if (!localStorage.getItem(KEYS.NOTIFICATIONS)) writeTable(KEYS.NOTIFICATIONS, []);
      if (!localStorage.getItem(KEYS.ADVANCE_PAYMENTS)) writeTable(KEYS.ADVANCE_PAYMENTS, []);
      if (!localStorage.getItem(KEYS.ADJUSTMENTS)) writeTable(KEYS.ADJUSTMENTS, []);
      if (!localStorage.getItem(KEYS.JOURNAL_ENTRIES)) writeTable(KEYS.JOURNAL_ENTRIES, []);
      if (!localStorage.getItem(KEYS.AUDIT_EVENTS)) writeTable(KEYS.AUDIT_EVENTS, []);
      if (!localStorage.getItem(KEYS.BRANDING)) writeTable(KEYS.BRANDING, DEFAULT_BRANDING_SETTINGS);
      if (!localStorage.getItem(KEYS.PREFERENCES)) writeTable(KEYS.PREFERENCES, DEFAULT_USER_PREFS);
      if (!localStorage.getItem(KEYS.VOUCHERS)) writeTable(KEYS.VOUCHERS, []);
      if (!localStorage.getItem(KEYS.CASE_NOTES)) writeTable(KEYS.CASE_NOTES, []);
      if (!localStorage.getItem(KEYS.CASE_ATTACHMENTS)) writeTable(KEYS.CASE_ATTACHMENTS, []);

      // Mark Initialized
      writeTable(KEYS.DB_META, {
        initialized: true,
        version: '1.0.0',
        schema: SQLITE_DDL_SCHEMA,
        initializedAt: new Date().toISOString()
      });
    }
  }

  // ==========================================
  // 1. CASES SERVICE (Odontogram & CAD/CAM)
  // ==========================================
  public cases = {
    getAll: (): DentalCase[] => {
      return readTable<DentalCase[]>(KEYS.CASES, []);
    },

    getById: (id: string): DentalCase | undefined => {
      const all = this.cases.getAll();
      return all.find((c) => c.id === id);
    },

    getByCaseNumber: (caseNumber: string): DentalCase | undefined => {
      const all = this.cases.getAll();
      return all.find((c) => c.case_number.toLowerCase() === caseNumber.toLowerCase());
    },

    create: (caseData: Omit<DentalCase, 'id' | 'created_at' | 'updated_at'> & { id?: string }): DentalCase => {
      const all = this.cases.getAll();
      const now = new Date().toISOString();
      const caseId = caseData.id || `case-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const newCase: DentalCase = {
        ...caseData,
        id: caseId,
        created_at: now,
        updated_at: now,
        history: caseData.history || [
          {
            id: `h-${Date.now()}`,
            case_id: caseId,
            timestamp: now,
            status: caseData.status || 'received',
            notes: `Case registered in SQLite database for ${caseData.patient_name || 'Patient'}`,
            updated_by: 'System'
          }
        ]
      };

      const updated = [newCase, ...all];
      writeTable(KEYS.CASES, updated);
      dbEvents.emit('CASES', 'insert', newCase);
      return newCase;
    },

    update: (id: string, updates: Partial<DentalCase>): DentalCase | null => {
      const all = this.cases.getAll();
      const index = all.findIndex((c) => c.id === id);
      if (index === -1) return null;

      const current = all[index];
      const now = new Date().toISOString();
      const updatedCase: DentalCase = {
        ...current,
        ...updates,
        updated_at: now
      };

      all[index] = updatedCase;
      writeTable(KEYS.CASES, all);
      dbEvents.emit('CASES', 'update', updatedCase);
      return updatedCase;
    },

    delete: (id: string): boolean => {
      const all = this.cases.getAll();
      const filtered = all.filter((c) => c.id !== id);
      if (filtered.length === all.length) return false;

      writeTable(KEYS.CASES, filtered);
      dbEvents.emit('CASES', 'delete', { id });
      return true;
    },

    updateStatus: (id: string, newStatus: CaseStatus, notes?: string, actor = 'Technician'): DentalCase | null => {
      const c = this.cases.getById(id);
      if (!c) return null;

      const now = new Date().toISOString();
      const historyItem: CaseStatusHistory = {
        id: `h-${Date.now()}`,
        case_id: id,
        timestamp: now,
        status: newStatus,
        notes: notes || `Status transitioned to ${newStatus}`,
        updated_by: actor
      };

      return this.cases.update(id, {
        status: newStatus,
        history: [historyItem, ...(c.history || [])]
      });
    },

    search: (query: string): DentalCase[] => {
      const q = query.trim().toLowerCase();
      if (!q) return this.cases.getAll();
      return this.cases.getAll().filter((c) => {
        return (
          (c.case_number ?? '').toLowerCase().includes(q) ||
          (c.patient_name ?? '').toLowerCase().includes(q) ||
          (c.lab_name ?? '').toLowerCase().includes(q) ||
          (c.doctor_name && c.doctor_name.toLowerCase().includes(q)) ||
          (c.shade && c.shade.toLowerCase().includes(q)) ||
          (c.case_type_name && c.case_type_name.toLowerCase().includes(q))
        );
      });
    }
  };

  // ==========================================
  // 2. LABS & CLINICS SERVICE
  // ==========================================
  public labs = {
    getAll: (): DentalLab[] => {
      return readTable<DentalLab[]>(KEYS.LABS, []);
    },

    getById: (id: string): DentalLab | undefined => {
      return this.labs.getAll().find((l) => l.id === id);
    },

    getByName: (name: string): DentalLab | undefined => {
      return this.labs.getAll().find((l) => l.name.toLowerCase() === name.toLowerCase());
    },

    create: (labData: Omit<DentalLab, 'id' | 'created_at'> & { id?: string }): DentalLab => {
      const all = this.labs.getAll();
      const newLab: DentalLab = {
        ...labData,
        id: labData.id || `lab-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        created_at: new Date().toISOString(),
        rating: labData.rating ?? 5.0,
        reviews_count: labData.reviews_count ?? 0
      };

      const updated = [...all, newLab];
      writeTable(KEYS.LABS, updated);
      dbEvents.emit('LABS', 'insert', newLab);
      return newLab;
    },

    update: (id: string, updates: Partial<DentalLab>): DentalLab | null => {
      const all = this.labs.getAll();
      const index = all.findIndex((l) => l.id === id);
      if (index === -1) return null;

      const updatedLab: DentalLab = {
        ...all[index],
        ...updates
      };

      all[index] = updatedLab;
      writeTable(KEYS.LABS, all);
      dbEvents.emit('LABS', 'update', updatedLab);
      return updatedLab;
    },

    delete: (id: string): boolean => {
      const all = this.labs.getAll();
      const filtered = all.filter((l) => l.id !== id);
      if (filtered.length === all.length) return false;

      writeTable(KEYS.LABS, filtered);
      dbEvents.emit('LABS', 'delete', { id });
      return true;
    },

    getBalance: (labName: string): { totalBilled: number; totalPaid: number; balance: number } => {
      const invoices = this.invoices.getAll().filter((i) => i.lab_name.toLowerCase() === labName.toLowerCase());
      const totalBilled = invoices.reduce((sum, i) => sum + (i.final_amount || 0), 0);
      const totalPaid = invoices.reduce((sum, i) => sum + (i.amount_paid || 0), 0);
      const balance = Math.max(0, totalBilled - totalPaid);
      return { totalBilled, totalPaid, balance };
    }
  };

  // ==========================================
  // 3. CASE TYPES (CATALOG MATRIX) SERVICE
  // ==========================================
  public caseTypes = {
    getAll: (): CaseType[] => {
      return readTable<CaseType[]>(KEYS.CASE_TYPES, INITIAL_CASE_TYPES);
    },

    getById: (id: string): CaseType | undefined => {
      return this.caseTypes.getAll().find((ct) => ct.id === id);
    },

    create: (typeData: Omit<CaseType, 'id' | 'created_at'> & { id?: string }): CaseType => {
      const all = this.caseTypes.getAll();
      const newType: CaseType = {
        ...typeData,
        id: typeData.id || `ct-${Date.now()}`,
        created_at: new Date().toISOString()
      };

      const updated = [...all, newType];
      writeTable(KEYS.CASE_TYPES, updated);
      dbEvents.emit('CASE_TYPES', 'insert', newType);
      return newType;
    },

    update: (id: string, updates: Partial<CaseType>): CaseType | null => {
      const all = this.caseTypes.getAll();
      const index = all.findIndex((ct) => ct.id === id);
      if (index === -1) return null;

      const updatedType = { ...all[index], ...updates };
      all[index] = updatedType;
      writeTable(KEYS.CASE_TYPES, all);
      dbEvents.emit('CASE_TYPES', 'update', updatedType);
      return updatedType;
    },

    delete: (id: string): boolean => {
      const all = this.caseTypes.getAll();
      const filtered = all.filter((ct) => ct.id !== id);
      if (filtered.length === all.length) return false;

      writeTable(KEYS.CASE_TYPES, filtered);
      dbEvents.emit('CASE_TYPES', 'delete', { id });
      return true;
    }
  };

  // ==========================================
  // 4. INVOICES & BILLING SERVICE
  // ==========================================
  public invoices = {
    getAll: (): Invoice[] => {
      return readTable<Invoice[]>(KEYS.INVOICES, []);
    },

    getById: (id: string): Invoice | undefined => {
      return this.invoices.getAll().find((i) => i.id === id);
    },

    getByInvoiceNumber: (invNumber: string): Invoice | undefined => {
      return this.invoices.getAll().find((i) => i.invoice_number.toLowerCase() === invNumber.toLowerCase());
    },

    create: (invoiceData: Omit<Invoice, 'id' | 'created_at'> & { id?: string }): Invoice => {
      const all = this.invoices.getAll();
      const newInvoice: Invoice = {
        ...invoiceData,
        id: invoiceData.id || `inv-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        created_at: new Date().toISOString(),
        payments: invoiceData.payments || []
      };

      const updated = [newInvoice, ...all];
      writeTable(KEYS.INVOICES, updated);
      dbEvents.emit('INVOICES', 'insert', newInvoice);
      return newInvoice;
    },

    update: (id: string, updates: Partial<Invoice>): Invoice | null => {
      const all = this.invoices.getAll();
      const index = all.findIndex((i) => i.id === id);
      if (index === -1) return null;

      const current = all[index];
      const updatedInvoice: Invoice = { ...current, ...updates };

      // Re-derive payment status
      if (updates.amount_paid !== undefined || updates.final_amount !== undefined) {
        const finalAmt = updatedInvoice.final_amount;
        const paid = updatedInvoice.amount_paid;
        if (paid >= finalAmt) updatedInvoice.payment_status = 'paid';
        else if (paid > 0) updatedInvoice.payment_status = 'partial';
        else updatedInvoice.payment_status = 'unpaid';
      }

      all[index] = updatedInvoice;
      writeTable(KEYS.INVOICES, all);
      dbEvents.emit('INVOICES', 'update', updatedInvoice);
      return updatedInvoice;
    },

    delete: (id: string): boolean => {
      const all = this.invoices.getAll();
      const filtered = all.filter((i) => i.id !== id);
      if (filtered.length === all.length) return false;

      writeTable(KEYS.INVOICES, filtered);
      dbEvents.emit('INVOICES', 'delete', { id });
      return true;
    },

    recordPayment: (invoiceId: string, payment: Omit<PaymentRecord, 'id' | 'created_at'>): Invoice | null => {
      const inv = this.invoices.getById(invoiceId);
      if (!inv) return null;

      const newPayment: PaymentRecord = {
        ...payment,
        id: `pmt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        created_at: new Date().toISOString()
      };

      const currentPayments = inv.payments || [];
      const updatedPayments = [...currentPayments, newPayment];
      const totalPaid = updatedPayments.reduce((sum, p) => sum + p.amount, 0);

      return this.invoices.update(invoiceId, {
        amount_paid: totalPaid,
        payments: updatedPayments
      });
    }
  };

  // ==========================================
  // 5. ADVANCE PAYMENTS & ADJUSTMENTS SERVICE
  // ==========================================
  public advancePayments = {
    getAll: (): AdvancePayment[] => {
      return readTable<AdvancePayment[]>(KEYS.ADVANCE_PAYMENTS, []);
    },

    create: (adv: Omit<AdvancePayment, 'id' | 'created_at'>): AdvancePayment => {
      const all = this.advancePayments.getAll();
      const newAdv: AdvancePayment = {
        ...adv,
        id: `adv-${Date.now()}`,
        created_at: new Date().toISOString()
      };

      const updated = [newAdv, ...all];
      writeTable(KEYS.ADVANCE_PAYMENTS, updated);
      dbEvents.emit('ADVANCE_PAYMENTS', 'insert', newAdv);
      return newAdv;
    },

    update: (id: string, updates: Partial<AdvancePayment>): AdvancePayment | null => {
      const all = this.advancePayments.getAll();
      const index = all.findIndex((a) => a.id === id);
      if (index === -1) return null;

      const updated = { ...all[index], ...updates };
      all[index] = updated;
      writeTable(KEYS.ADVANCE_PAYMENTS, all);
      dbEvents.emit('ADVANCE_PAYMENTS', 'update', updated);
      return updated;
    }
  };

  public adjustments = {
    getAll: (): AccountAdjustment[] => {
      return readTable<AccountAdjustment[]>(KEYS.ADJUSTMENTS, []);
    },

    create: (adj: Omit<AccountAdjustment, 'id' | 'created_at'>): AccountAdjustment => {
      const all = this.adjustments.getAll();
      const newAdj: AccountAdjustment = {
        ...adj,
        id: `adj-${Date.now()}`,
        created_at: new Date().toISOString()
      };

      const updated = [newAdj, ...all];
      writeTable(KEYS.ADJUSTMENTS, updated);
      dbEvents.emit('ADJUSTMENTS', 'insert', newAdj);
      return newAdj;
    }
  };

  // ==========================================
  // 6. JOURNAL ENTRIES SERVICE
  // ==========================================
  public journalEntries = {
    getAll: (): JournalEntry[] => {
      return readTable<JournalEntry[]>(KEYS.JOURNAL_ENTRIES, []);
    },

    create: (entry: Omit<JournalEntry, 'id' | 'created_at'>): JournalEntry => {
      const all = this.journalEntries.getAll();
      const newEntry: JournalEntry = {
        ...entry,
        id: `je-${Date.now()}`,
        created_at: new Date().toISOString()
      };

      const updated = [newEntry, ...all];
      writeTable(KEYS.JOURNAL_ENTRIES, updated);
      dbEvents.emit('JOURNAL_ENTRIES', 'insert', newEntry);
      return newEntry;
    }
  };

  // ==========================================
  // 7. NOTIFICATIONS SERVICE
  // ==========================================
  public notifications = {
    getAll: (): AppNotification[] => {
      return readTable<AppNotification[]>(KEYS.NOTIFICATIONS, []);
    },

    create: (notif: Omit<AppNotification, 'id' | 'created_at' | 'is_read' | 'is_archived'>): AppNotification => {
      const all = this.notifications.getAll();
      const newNotif: AppNotification = {
        ...notif,
        id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        created_at: new Date().toISOString(),
        is_read: false,
        is_archived: false
      };

      const updated = [newNotif, ...all];
      writeTable(KEYS.NOTIFICATIONS, updated);
      dbEvents.emit('NOTIFICATIONS', 'insert', newNotif);
      return newNotif;
    },

    markAsRead: (id: string): void => {
      const all = this.notifications.getAll();
      const updated = all.map((n) => (n.id === id ? { ...n, is_read: true } : n));
      writeTable(KEYS.NOTIFICATIONS, updated);
      dbEvents.emit('NOTIFICATIONS', 'update', { id, is_read: true });
    },

    markAllAsRead: (): void => {
      const all = this.notifications.getAll();
      const updated = all.map((n) => ({ ...n, is_read: true }));
      writeTable(KEYS.NOTIFICATIONS, updated);
      dbEvents.emit('NOTIFICATIONS', 'update', { allRead: true });
    },

    archive: (id: string): void => {
      const all = this.notifications.getAll();
      const updated = all.map((n) => (n.id === id ? { ...n, is_archived: true } : n));
      writeTable(KEYS.NOTIFICATIONS, updated);
      dbEvents.emit('NOTIFICATIONS', 'update', { id, is_archived: true });
    },

    clearAll: (): void => {
      writeTable(KEYS.NOTIFICATIONS, []);
      dbEvents.emit('NOTIFICATIONS', 'delete', { clearAll: true });
    }
  };

  // ==========================================
  // 8. USERS & AUTHENTICATION SERVICE
  // ==========================================
  public users = {
    getAll: (): UserProfile[] => {
      // Hidden accounts (is_hidden, e.g. the shipped service admin) never
      // appear in app state or user management — only login resolves them.
      const all = readTable<UserProfile[]>(KEYS.USERS, INITIAL_USERS);
      return Array.isArray(all) ? all.filter((u) => !(u as any).is_hidden) : all;
    },

    getById: (id: string): UserProfile | undefined => {
      return this.users.getAll().find((u) => u.id === id);
    },

    getByUsername: (username: string): UserProfile | undefined => {
      return this.users.getAll().find((u) => u.username.toLowerCase() === username.toLowerCase());
    },

    create: (userData: Omit<UserProfile, 'id' | 'created_at'>): UserProfile => {
      const all = this.users.getAll();
      const newUser: UserProfile = {
        ...userData,
        id: `usr-${Date.now()}`,
        created_at: new Date().toISOString()
      };

      const updated = [...all, newUser];
      writeTable(KEYS.USERS, updated);
      dbEvents.emit('USERS', 'insert', newUser);
      return newUser;
    },

    update: (id: string, updates: Partial<UserProfile>): UserProfile | null => {
      const all = this.users.getAll();
      const index = all.findIndex((u) => u.id === id);
      if (index === -1) return null;

      const updatedUser = { ...all[index], ...updates };
      all[index] = updatedUser;
      writeTable(KEYS.USERS, all);
      dbEvents.emit('USERS', 'update', updatedUser);
      return updatedUser;
    },

    delete: (id: string): boolean => {
      const all = this.users.getAll();
      const filtered = all.filter((u) => u.id !== id);
      if (filtered.length === all.length) return false;

      writeTable(KEYS.USERS, filtered);
      dbEvents.emit('USERS', 'delete', { id });
      return true;
    },

    getActiveUser: (): UserProfile | null => {
      return readTable<UserProfile | null>(KEYS.ACTIVE_USER, null);
    },

    setActiveUser: (user: UserProfile | null): void => {
      if (user) {
        writeTable(KEYS.ACTIVE_USER, user);
      } else {
        localStorage.removeItem(KEYS.ACTIVE_USER);
      }
    }
  };

  // ==========================================
  // 9. BRANDING & PREFERENCES SERVICE
  // ==========================================
  public settings = {
    getBranding: (): BrandingSettings => {
      return readTable<BrandingSettings>(KEYS.BRANDING, DEFAULT_BRANDING_SETTINGS);
    },

    updateBranding: (settings: Partial<BrandingSettings>): BrandingSettings => {
      const current = this.settings.getBranding();
      const updated = { ...current, ...settings };
      writeTable(KEYS.BRANDING, updated);
      dbEvents.emit('BRANDING', 'update', updated);
      return updated;
    },

    getPreferences: (): UserPreferences => {
      return readTable<UserPreferences>(KEYS.PREFERENCES, DEFAULT_USER_PREFS);
    },

    updatePreferences: (prefs: Partial<UserPreferences>): UserPreferences => {
      const current = this.settings.getPreferences();
      const updated = { ...current, ...prefs };
      writeTable(KEYS.PREFERENCES, updated);
      dbEvents.emit('PREFERENCES', 'update', updated);
      return updated;
    }
  };

  // ==========================================
  // 10. VOUCHERS SERVICE
  // ==========================================
  public vouchers = {
    getAll: (): SavedVoucher[] => {
      return readTable<SavedVoucher[]>(KEYS.VOUCHERS, []);
    },

    create: (v: SavedVoucher): SavedVoucher => {
      const all = this.vouchers.getAll();
      const updated = [v, ...all];
      writeTable(KEYS.VOUCHERS, updated);
      dbEvents.emit('VOUCHERS', 'insert', v);
      return v;
    },

    delete: (id: string): boolean => {
      const all = this.vouchers.getAll();
      const filtered = all.filter((v) => v.id !== id);
      writeTable(KEYS.VOUCHERS, filtered);
      dbEvents.emit('VOUCHERS', 'delete', { id });
      return true;
    }
  };

  // ==========================================
  // 11. CASE NOTES & ATTACHMENTS SERVICE
  // ==========================================
  public caseDetails = {
    getNotes: (): CaseNote[] => {
      return readTable<CaseNote[]>(KEYS.CASE_NOTES, []);
    },

    getNotesByCase: (caseId: string): CaseNote[] => {
      return this.caseDetails.getNotes().filter((n) => n.case_id === caseId);
    },

    addNote: (note: Omit<CaseNote, 'id' | 'created_at'>): CaseNote => {
      const all = this.caseDetails.getNotes();
      const newNote: CaseNote = {
        ...note,
        id: `cn-${Date.now()}`,
        created_at: new Date().toISOString()
      };
      const updated = [newNote, ...all];
      writeTable(KEYS.CASE_NOTES, updated);
      dbEvents.emit('CASE_NOTES', 'insert', newNote);
      return newNote;
    },

    getAttachments: (): CaseAttachment[] => {
      return readTable<CaseAttachment[]>(KEYS.CASE_ATTACHMENTS, []);
    },

    getAttachmentsByCase: (caseId: string): CaseAttachment[] => {
      return this.caseDetails.getAttachments().filter((a) => a.case_id === caseId);
    },

    addAttachment: (att: Omit<CaseAttachment, 'id' | 'uploaded_at'>): CaseAttachment => {
      const all = this.caseDetails.getAttachments();
      const newAtt: CaseAttachment = {
        ...att,
        id: `att-${Date.now()}`,
        uploaded_at: new Date().toISOString()
      };
      const updated = [newAtt, ...all];
      writeTable(KEYS.CASE_ATTACHMENTS, updated);
      dbEvents.emit('CASE_ATTACHMENTS', 'insert', newAtt);
      return newAtt;
    }
  };

  // ==========================================
  // 12. AUDIT COMPLIANCE LOGGING SERVICE
  // ==========================================
  public audit = {
    getAll: (): AuditEvent[] => {
      return readTable<AuditEvent[]>(KEYS.AUDIT_EVENTS, []);
    },

    log: (
      action: string,
      entityType: string,
      entityId: string,
      entityRef: string,
      actor = 'System',
      reason?: string,
      notes?: string
    ): AuditEvent => {
      const all = this.audit.getAll();
      const newEvent: AuditEvent = {
        id: `aud-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor,
        action,
        entity_type: entityType,
        entity_id: entityId,
        entity_ref: entityRef,
        reason,
        notes
      };

      const updated = [newEvent, ...all.slice(0, 499)]; // Cap at 500 audit events
      writeTable(KEYS.AUDIT_EVENTS, updated);
      dbEvents.emit('AUDIT_EVENTS', 'insert', newEvent);
      return newEvent;
    }
  };

  // ==========================================
  // 13. BACKUP, RESTORE & SQLITE DUMP UTILITIES
  // ==========================================
  public maintenance = {
    getFullState: () => {
      return {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        tables: {
          cases: this.cases.getAll(),
          labs: this.labs.getAll(),
          caseTypes: this.caseTypes.getAll(),
          invoices: this.invoices.getAll(),
          notifications: this.notifications.getAll(),
          advancePayments: this.advancePayments.getAll(),
          adjustments: this.adjustments.getAll(),
          journalEntries: this.journalEntries.getAll(),
          auditEvents: this.audit.getAll(),
          users: this.users.getAll(),
          brandingSettings: this.settings.getBranding(),
          userPreferences: this.settings.getPreferences(),
          savedVouchers: this.vouchers.getAll(),
          caseNotes: this.caseDetails.getNotes(),
          caseAttachments: this.caseDetails.getAttachments()
        }
      };
    },

    exportSqliteDump: (customFilename?: string): string => {
      const fullState = this.maintenance.getFullState().tables;
      const sql = generateSqliteExport({
        cases: fullState.cases,
        labs: fullState.labs,
        caseTypes: fullState.caseTypes,
        invoices: fullState.invoices,
        advancePayments: fullState.advancePayments,
        accountAdjustments: fullState.adjustments,
        journalEntries: fullState.journalEntries,
        auditEvents: fullState.auditEvents,
        notifications: fullState.notifications,
        templates: [],
        users: fullState.users,
        brandingSettings: fullState.brandingSettings
      });
      const filename = customFilename || `dental_solutions_sqlite_${new Date().toISOString().split('T')[0]}.sql`;
      downloadSqliteDump(sql, filename);
      return filename;
    },

    restoreFromBackup: (backupData: any): boolean => {
      try {
        if (!backupData || typeof backupData !== 'object') return false;

        const tables = backupData.tables || backupData;

        if (Array.isArray(tables.cases)) writeTable(KEYS.CASES, tables.cases);
        if (Array.isArray(tables.labs)) writeTable(KEYS.LABS, tables.labs);
        if (Array.isArray(tables.caseTypes)) writeTable(KEYS.CASE_TYPES, tables.caseTypes);
        if (Array.isArray(tables.invoices)) writeTable(KEYS.INVOICES, tables.invoices);
        if (Array.isArray(tables.notifications)) writeTable(KEYS.NOTIFICATIONS, tables.notifications);
        if (Array.isArray(tables.advancePayments)) writeTable(KEYS.ADVANCE_PAYMENTS, tables.advancePayments);
        if (Array.isArray(tables.adjustments)) writeTable(KEYS.ADJUSTMENTS, tables.adjustments);
        if (Array.isArray(tables.journalEntries)) writeTable(KEYS.JOURNAL_ENTRIES, tables.journalEntries);
        if (Array.isArray(tables.auditEvents)) writeTable(KEYS.AUDIT_EVENTS, tables.auditEvents);
        if (Array.isArray(tables.users)) writeTable(KEYS.USERS, tables.users);
        if (tables.brandingSettings) writeTable(KEYS.BRANDING, tables.brandingSettings);
        if (tables.userPreferences) writeTable(KEYS.PREFERENCES, tables.userPreferences);
        if (Array.isArray(tables.savedVouchers)) writeTable(KEYS.VOUCHERS, tables.savedVouchers);
        if (Array.isArray(tables.caseNotes)) writeTable(KEYS.CASE_NOTES, tables.caseNotes);
        if (Array.isArray(tables.caseAttachments)) writeTable(KEYS.CASE_ATTACHMENTS, tables.caseAttachments);

        dbEvents.emit('DB_META', 'restore', tables);
        return true;
      } catch (err) {
        console.error('Failed to restore database from backup:', err);
        return false;
      }
    },

    resetToDemoState: (): void => {
      writeTable(KEYS.CASES, INITIAL_CASES);
      writeTable(KEYS.LABS, INITIAL_LABS);
      writeTable(KEYS.CASE_TYPES, INITIAL_CASE_TYPES);
      writeTable(KEYS.INVOICES, INITIAL_INVOICES);
      writeTable(KEYS.NOTIFICATIONS, INITIAL_NOTIFICATIONS);
      writeTable(KEYS.ADVANCE_PAYMENTS, INITIAL_ADVANCE_PAYMENTS);
      writeTable(KEYS.ADJUSTMENTS, INITIAL_ADJUSTMENTS);
      writeTable(KEYS.JOURNAL_ENTRIES, INITIAL_JOURNAL_ENTRIES);
      writeTable(KEYS.AUDIT_EVENTS, INITIAL_AUDIT_EVENTS);
      writeTable(KEYS.USERS, INITIAL_USERS);
      writeTable(KEYS.BRANDING, DEFAULT_BRANDING_SETTINGS);
      writeTable(KEYS.PREFERENCES, DEFAULT_USER_PREFS);
      writeTable(KEYS.VOUCHERS, []);
      writeTable(KEYS.CASE_NOTES, []);
      writeTable(KEYS.CASE_ATTACHMENTS, []);

      dbEvents.emit('DB_META', 'reset', {});
    },

    wipeAllData: (): void => {
      writeTable(KEYS.CASES, []);
      writeTable(KEYS.LABS, []);
      writeTable(KEYS.INVOICES, []);
      writeTable(KEYS.NOTIFICATIONS, []);
      writeTable(KEYS.ADVANCE_PAYMENTS, []);
      writeTable(KEYS.ADJUSTMENTS, []);
      writeTable(KEYS.JOURNAL_ENTRIES, []);
      writeTable(KEYS.AUDIT_EVENTS, []);
      writeTable(KEYS.VOUCHERS, []);
      writeTable(KEYS.CASE_NOTES, []);
      writeTable(KEYS.CASE_ATTACHMENTS, []);

      // Keep default users and case types so admin can still log in
      writeTable(KEYS.USERS, INITIAL_USERS);
      writeTable(KEYS.CASE_TYPES, INITIAL_CASE_TYPES);
      writeTable(KEYS.BRANDING, DEFAULT_BRANDING_SETTINGS);
      writeTable(KEYS.PREFERENCES, DEFAULT_USER_PREFS);

      dbEvents.emit('DB_META', 'reset', {});
    }
  };
}

// Export singleton instance
export const sqliteDb = SqliteDatabaseService.getInstance();
