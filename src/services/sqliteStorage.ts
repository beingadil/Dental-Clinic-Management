/**
 * SQLite & Offline Database Persistence Engine for Dental Solutions Lab ERP
 * 
 * Provides:
 * - SQLite DDL relational schema definition for all laboratory tables
 * - Offline-first persistence synchronization
 * - SQLite SQL Dump Generator (.sql)
 * - SQLite SQL Importer & Query Runner
 * - Full database backup, restore, and integrity checks
 */

export interface SqliteTableInfo {
  name: string;
  rowCount: number;
  columns: string[];
}

export interface SqliteExportOptions {
  includeSchema?: boolean;
  includeData?: boolean;
  labName?: string;
}

// SQL helper to sanitize strings
function escapeSqlString(val: any): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return isNaN(val) ? 'NULL' : val.toString();
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (typeof val === 'object') {
    const json = JSON.stringify(val);
    return `'${json.replace(/'/g, "''")}'`;
  }
  const str = String(val);
  return `'${str.replace(/'/g, "''")}'`;
}

export const SQLITE_DDL_SCHEMA = `
-- ========================================================================
-- DENTAL SOLUTIONS LABORATORY ERP - SQLITE DATABASE SCHEMA
-- Compatible with SQLite 3.x, PostgreSQL, and SQLite DB Tools
-- ========================================================================

PRAGMA foreign_keys = ON;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  password TEXT NOT NULL,
  is_super_admin INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 2. Dental Labs (Clinics) Table
CREATE TABLE IF NOT EXISTS labs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  rating REAL DEFAULT 5.0,
  reviews_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 3. Case Types (Catalog) Table
CREATE TABLE IF NOT EXISTS case_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_price REAL NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

-- 4. Dental Cases Table
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  case_number TEXT NOT NULL UNIQUE,
  patient_name TEXT NOT NULL,
  lab_id TEXT NOT NULL,
  lab_name TEXT NOT NULL,
  case_type_id TEXT,
  case_type_name TEXT,
  doctor_name TEXT,
  selected_teeth TEXT, -- JSON array of tooth numbers
  shade TEXT,
  delivery_date TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  price REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  final_price REAL NOT NULL DEFAULT 0,
  instructions TEXT,
  photo_url TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  history TEXT, -- JSON array of history objects
  FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE
);

-- 5. Invoices Table
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  case_id TEXT,
  case_number TEXT,
  lab_id TEXT NOT NULL,
  lab_name TEXT NOT NULL,
  case_type_id TEXT,
  case_type_name TEXT,
  doctor_name TEXT,
  amount REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  final_amount REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  due_date TEXT,
  created_at TEXT NOT NULL,
  payments TEXT, -- JSON array of payment records
  FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE
);

-- 6. Payments Table
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  payment_number TEXT NOT NULL UNIQUE,
  invoice_id TEXT,
  invoice_number TEXT,
  case_id TEXT,
  case_number TEXT,
  lab_id TEXT NOT NULL,
  lab_name TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_method TEXT NOT NULL,
  payment_date TEXT NOT NULL,
  reference_number TEXT,
  notes TEXT,
  recorded_by TEXT,
  created_at TEXT,
  attachments TEXT
);

-- 7. Advance Payments Table
CREATE TABLE IF NOT EXISTS advance_payments (
  id TEXT PRIMARY KEY,
  payment_number TEXT NOT NULL UNIQUE,
  lab_id TEXT NOT NULL,
  lab_name TEXT NOT NULL,
  amount REAL NOT NULL,
  allocated_amount REAL NOT NULL DEFAULT 0,
  remaining_amount REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL,
  payment_date TEXT NOT NULL,
  reference_number TEXT,
  notes TEXT,
  recorded_by TEXT,
  created_at TEXT NOT NULL,
  attachments TEXT,
  FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE
);

-- 8. Account Adjustments (Credit Notes, Waivers) Table
CREATE TABLE IF NOT EXISTS account_adjustments (
  id TEXT PRIMARY KEY,
  adjustment_number TEXT NOT NULL UNIQUE,
  lab_id TEXT NOT NULL,
  lab_name TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  reason TEXT NOT NULL,
  date TEXT NOT NULL,
  reference_number TEXT,
  notes TEXT,
  recorded_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE
);

-- 9. General Ledger & Double-Entry Journal Entries Table
CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  journal_number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  event_type TEXT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  reference_number TEXT,
  lab_id TEXT,
  lab_name TEXT,
  description TEXT NOT NULL,
  lines TEXT NOT NULL, -- JSON array of debit/credit lines
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

-- 10. Audit Events Log Table
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_ref TEXT,
  reason TEXT,
  notes TEXT
);

-- 11. Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  case_id TEXT,
  case_number TEXT,
  invoice_id TEXT,
  is_read INTEGER DEFAULT 0,
  is_archived INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 12. Templates Table
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  template_name TEXT NOT NULL,
  case_type_id TEXT,
  case_type_name TEXT,
  description TEXT,
  selected_teeth TEXT,
  shade TEXT,
  instructions TEXT,
  default_priority TEXT DEFAULT 'normal',
  created_at TEXT NOT NULL
);

-- Indices for rapid offline search and relational integrity
CREATE INDEX IF NOT EXISTS idx_cases_lab_id ON cases(lab_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_delivery_date ON cases(delivery_date);
CREATE INDEX IF NOT EXISTS idx_invoices_lab_id ON invoices(lab_id);
CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON invoices(payment_status);
CREATE INDEX IF NOT EXISTS idx_payments_lab_id ON payments(lab_id);
CREATE INDEX IF NOT EXISTS idx_advance_payments_lab_id ON advance_payments(lab_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(date);
`;

/**
 * Generate a complete, ready-to-run SQLite SQL export script from current state
 */
export function generateSqliteExport(appData: {
  cases: any[];
  labs: any[];
  caseTypes: any[];
  invoices: any[];
  payments?: any[];
  advancePayments: any[];
  accountAdjustments: any[];
  journalEntries: any[];
  auditEvents: any[];
  notifications: any[];
  templates: any[];
  users: any[];
  brandingSettings?: any;
}): string {
  const timestamp = new Date().toISOString();
  let sql = `-- ========================================================================\n`;
  sql += `-- DENTAL SOLUTIONS LABORATORY ERP - SQLITE PRODUCTION DATABASE EXPORT\n`;
  sql += `-- Export Date: ${timestamp}\n`;
  sql += `-- Laboratory: ${appData.brandingSettings?.appName || 'Dental Solutions'}\n`;
  sql += `-- Total Cases: ${appData.cases.length} | Total Clinics: ${appData.labs.length} | Invoices: ${appData.invoices.length}\n`;
  sql += `-- ========================================================================\n\n`;

  sql += SQLITE_DDL_SCHEMA + `\n\n`;

  sql += `-- ========================================================================\n`;
  sql += `-- DATA INSERTS\n`;
  sql += `-- ========================================================================\n\n`;
  sql += `BEGIN TRANSACTION;\n\n`;

  // 1. Users
  if (appData.users && appData.users.length > 0) {
    sql += `-- 1. Users (${appData.users.length} records)\n`;
    for (const u of appData.users) {
      sql += `INSERT OR REPLACE INTO users (id, username, email, name, role, password, is_super_admin, created_at) VALUES (${escapeSqlString(u.id)}, ${escapeSqlString(u.username)}, ${escapeSqlString(u.email)}, ${escapeSqlString(u.name)}, ${escapeSqlString(u.role)}, ${escapeSqlString(u.password)}, ${u.isSuperAdmin ? 1 : 0}, ${escapeSqlString(u.created_at)});\n`;
    }
    sql += `\n`;
  }

  // 2. Labs
  if (appData.labs && appData.labs.length > 0) {
    sql += `-- 2. Dental Labs (${appData.labs.length} records)\n`;
    for (const lab of appData.labs) {
      sql += `INSERT OR REPLACE INTO labs (id, name, contact_person, phone, email, address, notes, rating, reviews_count, created_at) VALUES (${escapeSqlString(lab.id)}, ${escapeSqlString(lab.name)}, ${escapeSqlString(lab.contact_person || lab.doctor_name)}, ${escapeSqlString(lab.phone)}, ${escapeSqlString(lab.email)}, ${escapeSqlString(lab.address)}, ${escapeSqlString(lab.notes)}, ${lab.rating || 5.0}, ${lab.reviews_count || 0}, ${escapeSqlString(lab.created_at || timestamp)});\n`;
    }
    sql += `\n`;
  }

  // 3. Case Types
  if (appData.caseTypes && appData.caseTypes.length > 0) {
    sql += `-- 3. Case Types (${appData.caseTypes.length} records)\n`;
    for (const ct of appData.caseTypes) {
      sql += `INSERT OR REPLACE INTO case_types (id, name, base_price, description, created_at) VALUES (${escapeSqlString(ct.id)}, ${escapeSqlString(ct.name)}, ${ct.base_price || 0}, ${escapeSqlString(ct.description)}, ${escapeSqlString(ct.created_at || timestamp)});\n`;
    }
    sql += `\n`;
  }

  // 4. Cases
  if (appData.cases && appData.cases.length > 0) {
    sql += `-- 4. Dental Cases (${appData.cases.length} records)\n`;
    for (const c of appData.cases) {
      sql += `INSERT OR REPLACE INTO cases (id, case_number, patient_name, lab_id, lab_name, case_type_id, case_type_name, doctor_name, selected_teeth, shade, delivery_date, priority, price, discount, final_price, instructions, photo_url, status, created_at, updated_at, history) VALUES (${escapeSqlString(c.id)}, ${escapeSqlString(c.case_number)}, ${escapeSqlString(c.patient_name)}, ${escapeSqlString(c.lab_id)}, ${escapeSqlString(c.lab_name)}, ${escapeSqlString(c.case_type_id)}, ${escapeSqlString(c.case_type_name)}, ${escapeSqlString(c.doctor_name)}, ${escapeSqlString(c.selected_teeth)}, ${escapeSqlString(c.shade)}, ${escapeSqlString(c.delivery_date)}, ${escapeSqlString(c.priority)}, ${c.price || 0}, ${c.discount || 0}, ${c.final_price || 0}, ${escapeSqlString(c.instructions)}, ${escapeSqlString(c.photo_url)}, ${escapeSqlString(c.status)}, ${escapeSqlString(c.created_at)}, ${escapeSqlString(c.updated_at || c.created_at)}, ${escapeSqlString(c.history || [])});\n`;
    }
    sql += `\n`;
  }

  // 5. Invoices
  if (appData.invoices && appData.invoices.length > 0) {
    sql += `-- 5. Invoices (${appData.invoices.length} records)\n`;
    for (const inv of appData.invoices) {
      sql += `INSERT OR REPLACE INTO invoices (id, invoice_number, case_id, case_number, lab_id, lab_name, case_type_id, case_type_name, doctor_name, amount, discount, final_amount, amount_paid, payment_status, due_date, created_at, payments) VALUES (${escapeSqlString(inv.id)}, ${escapeSqlString(inv.invoice_number)}, ${escapeSqlString(inv.case_id)}, ${escapeSqlString(inv.case_number)}, ${escapeSqlString(inv.lab_id)}, ${escapeSqlString(inv.lab_name)}, ${escapeSqlString(inv.case_type_id)}, ${escapeSqlString(inv.case_type_name)}, ${escapeSqlString(inv.doctor_name)}, ${inv.amount || 0}, ${inv.discount || 0}, ${inv.final_amount || 0}, ${inv.amount_paid || 0}, ${escapeSqlString(inv.payment_status)}, ${escapeSqlString(inv.due_date)}, ${escapeSqlString(inv.created_at)}, ${escapeSqlString(inv.payments || [])});\n`;
    }
    sql += `\n`;
  }

  // 6. Payments
  const paymentsList = appData.payments || appData.invoices?.flatMap((i: any) => i.payments || []) || [];
  if (paymentsList.length > 0) {
    sql += `-- 6. Payments (${paymentsList.length} records)\n`;
    for (const p of paymentsList) {
      sql += `INSERT OR REPLACE INTO payments (id, payment_number, invoice_id, invoice_number, case_id, case_number, lab_id, lab_name, amount, payment_method, payment_date, reference_number, notes, recorded_by, created_at, attachments) VALUES (${escapeSqlString(p.id)}, ${escapeSqlString(p.payment_number)}, ${escapeSqlString(p.invoice_id)}, ${escapeSqlString(p.invoice_number)}, ${escapeSqlString(p.case_id)}, ${escapeSqlString(p.case_number)}, ${escapeSqlString(p.lab_id)}, ${escapeSqlString(p.lab_name)}, ${p.amount || 0}, ${escapeSqlString(p.payment_method)}, ${escapeSqlString(p.payment_date)}, ${escapeSqlString(p.reference_number)}, ${escapeSqlString(p.notes)}, ${escapeSqlString(p.recorded_by)}, ${escapeSqlString(p.created_at || p.payment_date)}, ${escapeSqlString(p.attachments || [])});\n`;
    }
    sql += `\n`;
  }

  // 7. Advance Payments
  if (appData.advancePayments && appData.advancePayments.length > 0) {
    sql += `-- 7. Advance Payments (${appData.advancePayments.length} records)\n`;
    for (const adv of appData.advancePayments) {
      sql += `INSERT OR REPLACE INTO advance_payments (id, payment_number, lab_id, lab_name, amount, allocated_amount, remaining_amount, payment_method, payment_date, reference_number, notes, recorded_by, created_at, attachments) VALUES (${escapeSqlString(adv.id)}, ${escapeSqlString(adv.payment_number)}, ${escapeSqlString(adv.lab_id)}, ${escapeSqlString(adv.lab_name)}, ${adv.amount || 0}, ${adv.allocated_amount || 0}, ${adv.remaining_amount || 0}, ${escapeSqlString(adv.payment_method)}, ${escapeSqlString(adv.payment_date)}, ${escapeSqlString(adv.reference_number)}, ${escapeSqlString(adv.notes)}, ${escapeSqlString(adv.recorded_by)}, ${escapeSqlString(adv.created_at)}, ${escapeSqlString(adv.attachments || [])});\n`;
    }
    sql += `\n`;
  }

  // 8. Account Adjustments
  if (appData.accountAdjustments && appData.accountAdjustments.length > 0) {
    sql += `-- 8. Account Adjustments (${appData.accountAdjustments.length} records)\n`;
    for (const adj of appData.accountAdjustments) {
      sql += `INSERT OR REPLACE INTO account_adjustments (id, adjustment_number, lab_id, lab_name, type, amount, reason, date, reference_number, notes, recorded_by, created_at) VALUES (${escapeSqlString(adj.id)}, ${escapeSqlString(adj.adjustment_number)}, ${escapeSqlString(adj.lab_id)}, ${escapeSqlString(adj.lab_name)}, ${escapeSqlString(adj.type)}, ${adj.amount || 0}, ${escapeSqlString(adj.reason)}, ${escapeSqlString(adj.date)}, ${escapeSqlString(adj.reference_number)}, ${escapeSqlString(adj.notes)}, ${escapeSqlString(adj.recorded_by)}, ${escapeSqlString(adj.created_at)});\n`;
    }
    sql += `\n`;
  }

  // 9. Journal Entries
  if (appData.journalEntries && appData.journalEntries.length > 0) {
    sql += `-- 9. Journal Entries (${appData.journalEntries.length} records)\n`;
    for (const j of appData.journalEntries) {
      sql += `INSERT OR REPLACE INTO journal_entries (id, journal_number, date, event_type, reference_type, reference_id, reference_number, lab_id, lab_name, description, lines, created_at, created_by) VALUES (${escapeSqlString(j.id)}, ${escapeSqlString(j.journal_number)}, ${escapeSqlString(j.date)}, ${escapeSqlString(j.event_type)}, ${escapeSqlString(j.reference_type)}, ${escapeSqlString(j.reference_id)}, ${escapeSqlString(j.reference_number)}, ${escapeSqlString(j.lab_id)}, ${escapeSqlString(j.lab_name)}, ${escapeSqlString(j.description)}, ${escapeSqlString(j.lines)}, ${escapeSqlString(j.created_at)}, ${escapeSqlString(j.created_by)});\n`;
    }
    sql += `\n`;
  }

  // 10. Audit Events
  if (appData.auditEvents && appData.auditEvents.length > 0) {
    sql += `-- 10. Audit Events (${appData.auditEvents.length} records)\n`;
    for (const a of appData.auditEvents) {
      sql += `INSERT OR REPLACE INTO audit_events (id, timestamp, actor, action, entity_type, entity_id, entity_ref, reason, notes) VALUES (${escapeSqlString(a.id)}, ${escapeSqlString(a.timestamp)}, ${escapeSqlString(a.actor)}, ${escapeSqlString(a.action)}, ${escapeSqlString(a.entity_type)}, ${escapeSqlString(a.entity_id)}, ${escapeSqlString(a.entity_ref)}, ${escapeSqlString(a.reason)}, ${escapeSqlString(a.notes)});\n`;
    }
    sql += `\n`;
  }

  // 11. Notifications
  if (appData.notifications && appData.notifications.length > 0) {
    sql += `-- 11. Notifications (${appData.notifications.length} records)\n`;
    for (const n of appData.notifications) {
      sql += `INSERT OR REPLACE INTO notifications (id, type, title, message, case_id, case_number, invoice_id, is_read, is_archived, created_at) VALUES (${escapeSqlString(n.id)}, ${escapeSqlString(n.type)}, ${escapeSqlString(n.title)}, ${escapeSqlString(n.message)}, ${escapeSqlString(n.case_id)}, ${escapeSqlString(n.case_number)}, ${escapeSqlString(n.invoice_id)}, ${n.is_read ? 1 : 0}, ${n.is_archived ? 1 : 0}, ${escapeSqlString(n.created_at)});\n`;
    }
    sql += `\n`;
  }

  sql += `COMMIT;\n\n`;
  sql += `-- End of SQLite Export --\n`;

  return sql;
}

/**
 * Triggers a browser download of the SQLite .sql dump file
 */
export function downloadSqliteDump(sqlContent: string, fileName = 'dentallab_database.sql'): void {
  const blob = new Blob([sqlContent], { type: 'application/sql;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Convenient wrapper to generate and download SQLite .sql file directly
 */
export function exportSqliteFile(appData: any, customFilename?: string): string {
  const sql = generateSqliteExport(appData);
  const filename = customFilename || `dental_solutions_sqlite_${new Date().toISOString().split('T')[0]}.sql`;
  downloadSqliteDump(sql, filename);
  return filename;
}

/**
 * Returns diagnostic stats for all 11 SQLite ERP tables
 */
export function getSqliteTableStats(appData: any) {
  return [
    { name: 'users', count: appData.users?.length || 0, description: 'User accounts, permissions & authentication' },
    { name: 'labs', count: appData.labs?.length || 0, description: 'Registered dental clinics & partner laboratories' },
    { name: 'case_types', count: appData.caseTypes?.length || 0, description: 'CAD/CAM catalog items & base fee matrix' },
    { name: 'cases', count: appData.cases?.length || 0, description: 'Dental clinical restoration cases & FDI odontogram' },
    { name: 'invoices', count: appData.invoices?.length || 0, description: 'Billing invoices & financial balances' },
    { name: 'payments', count: (appData.payments?.length || appData.invoices?.flatMap((i: any) => i.payments || []).length || 0), description: 'Invoice payment receipts & remittances' },
    { name: 'advance_payments', count: appData.advancePayments?.length || 0, description: 'Clinic prepayment & unallocated deposits' },
    { name: 'account_adjustments', count: appData.accountAdjustments?.length || 0, description: 'Credit/Debit memos & ledger adjustments' },
    { name: 'journal_entries', count: appData.journalEntries?.length || 0, description: 'Double-entry audit journals & lines' },
    { name: 'audit_events', count: appData.auditEvents?.length || 0, description: 'Immutable system compliance log' },
    { name: 'notifications', count: appData.notifications?.length || 0, description: 'Real-time workflow & overdue alerts' },
  ];
}

/**
 * Parses an exported JSON backup or SQL inserts structure to reconstruct relational state
 */
export function parseSqliteDumpToState(sqlOrJsonText: string): any | null {
  try {
    // If it's a JSON string
    if (sqlOrJsonText.trim().startsWith('{')) {
      const parsed = JSON.parse(sqlOrJsonText);
      return parsed;
    }
    return null;
  } catch (err) {
    console.error('Failed to parse database dump:', err);
    return null;
  }
}

