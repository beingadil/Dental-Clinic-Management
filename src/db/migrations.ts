/**
 * SQL schema migrations for the Dental Solutions local SQLite database.
 *
 * Rules:
 * - Every schema change is a new migration; never edit an applied migration.
 * - Each migration runs inside one transaction; failure aborts boot safely.
 * - Seeding is separate from schema (see seeds.ts) so data logic never ships in DDL.
 */

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

// ---------------------------------------------------------------- 001 — core schema
export const MIGRATION_001_INITIAL_SCHEMA: Migration = {
  version: 1,
  name: 'initial_schema',
  statements: [
    `CREATE TABLE app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,

    `CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('Super Admin','Lab Admin','Technician','Billing Manager')),
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      avatar TEXT,
      is_super_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_super_admin IN (0,1)),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT
    )`,

    `CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE labs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      code TEXT,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      city TEXT,
      doctor_name TEXT,
      notes TEXT,
      rating REAL NOT NULL DEFAULT 5.0 CHECK (rating >= 0 AND rating <= 5),
      reviews_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT
    )`,

    `CREATE TABLE lab_contacts (
      id TEXT PRIMARY KEY,
      lab_id TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      role TEXT,
      notes TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
      created_at TEXT NOT NULL,
      FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE lab_addresses (
      id TEXT PRIMARY KEY,
      lab_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('billing','shipping','lab_location')),
      street TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      country TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
      created_at TEXT NOT NULL,
      FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE lab_pricing_overrides (
      id TEXT PRIMARY KEY,
      lab_id TEXT NOT NULL,
      case_type_id TEXT NOT NULL,
      case_type_name TEXT,
      standard_price REAL NOT NULL,
      custom_price REAL NOT NULL CHECK (custom_price >= 0),
      discount_percentage REAL,
      effective_date TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE,
      FOREIGN KEY (case_type_id) REFERENCES case_types(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE lab_reviews (
      id TEXT PRIMARY KEY,
      lab_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      review_text TEXT,
      reviewer_name TEXT NOT NULL,
      case_number TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE doctor_preferred_labs (
      id TEXT PRIMARY KEY,
      doctor_name TEXT NOT NULL,
      lab_id TEXT NOT NULL,
      lab_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE case_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      base_price REAL NOT NULL CHECK (base_price >= 0),
      category TEXT CHECK (category IN ('crown_bridge','implant','denture','orthodontic','veneers')),
      lead_time_days INTEGER,
      warranty_months INTEGER,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    )`,

    `CREATE TABLE cases (
      id TEXT PRIMARY KEY,
      case_number TEXT NOT NULL UNIQUE,
      patient_name TEXT,
      lab_id TEXT NOT NULL,
      lab_name TEXT NOT NULL,
      case_type_id TEXT,
      case_type_name TEXT,
      units_count INTEGER,
      doctor_name TEXT NOT NULL,
      selected_teeth TEXT NOT NULL DEFAULT '[]',
      tooth_details TEXT,
      shade TEXT,
      material TEXT,
      delivery_date TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
      price REAL NOT NULL DEFAULT 0 CHECK (price >= 0),
      discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
      final_price REAL NOT NULL DEFAULT 0 CHECK (final_price >= 0),
      instructions TEXT,
      photo_url TEXT,
      status TEXT NOT NULL DEFAULT 'received'
        CHECK (status IN ('draft','received','in_progress','qc','ready','delivered','revision','cancelled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (lab_id) REFERENCES labs(id)
    )`,

    `CREATE TABLE case_teeth (
      case_id TEXT NOT NULL,
      tooth_number INTEGER NOT NULL CHECK (tooth_number >= 11 AND tooth_number <= 48),
      shade TEXT,
      prep_type TEXT,
      material TEXT,
      notes TEXT,
      implant_brand TEXT,
      implant_size TEXT,
      PRIMARY KEY (case_id, tooth_number),
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE case_status_history (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      timestamp TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE case_notes (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      note_text TEXT NOT NULL,
      author TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE case_templates (
      id TEXT PRIMARY KEY,
      template_name TEXT NOT NULL UNIQUE,
      case_type_id TEXT,
      case_type_name TEXT,
      description TEXT,
      selected_teeth TEXT NOT NULL DEFAULT '[]',
      shade TEXT,
      instructions TEXT,
      default_priority TEXT NOT NULL DEFAULT 'normal',
      created_at TEXT NOT NULL
    )`,

    `CREATE TABLE invoices (
      id TEXT PRIMARY KEY,
      invoice_number TEXT NOT NULL UNIQUE,
      case_id TEXT,
      case_number TEXT,
      lab_id TEXT NOT NULL,
      lab_name TEXT NOT NULL,
      case_type_id TEXT,
      case_type_name TEXT,
      doctor_name TEXT,
      patient_name TEXT,
      amount REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
      discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
      final_amount REAL NOT NULL DEFAULT 0 CHECK (final_amount >= 0),
      amount_paid REAL NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
      payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid')),
      status_v2 TEXT NOT NULL DEFAULT 'open'
        CHECK (status_v2 IN ('draft','open','partially_paid','paid','overdue','disputed','voided')),
      issue_date TEXT,
      due_date TEXT,
      journal_id TEXT,
      credit_notes_total REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      FOREIGN KEY (lab_id) REFERENCES labs(id)
    )`,

    `CREATE TABLE invoice_items (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      description TEXT NOT NULL,
      teeth_numbers TEXT,
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
      unit_price REAL NOT NULL CHECK (unit_price >= 0),
      total_price REAL NOT NULL CHECK (total_price >= 0),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE payments (
      id TEXT PRIMARY KEY,
      payment_number TEXT UNIQUE,
      receipt_number TEXT,
      invoice_id TEXT,
      invoice_number TEXT,
      case_id TEXT,
      case_number TEXT,
      lab_id TEXT,
      lab_name TEXT,
      amount REAL NOT NULL CHECK (amount > 0),
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','bank','cheque','advance')),
      payment_date TEXT NOT NULL,
      reference_number TEXT,
      notes TEXT,
      recorded_by TEXT NOT NULL,
      payment_type TEXT CHECK (payment_type IN ('invoice_payment','advance_payment','advance_allocation','credit_note','debit_adjustment','refund')),
      advance_payment_id TEXT,
      status TEXT NOT NULL DEFAULT 'posted'
        CHECK (status IN ('draft','pending_verification','posted','reconciled','reversed','failed')),
      unapplied_amount REAL NOT NULL DEFAULT 0 CHECK (unapplied_amount >= 0),
      is_reversed INTEGER NOT NULL DEFAULT 0 CHECK (is_reversed IN (0,1)),
      reversal_reason TEXT,
      reversed_at TEXT,
      reversed_by TEXT,
      journal_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`,

    `CREATE TABLE payment_allocations (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK (source_type IN ('payment','advance')),
      source_id TEXT NOT NULL,
      source_ref TEXT,
      invoice_id TEXT NOT NULL,
      invoice_number TEXT,
      amount REAL NOT NULL CHECK (amount > 0),
      allocated_at TEXT NOT NULL,
      allocated_by TEXT,
      notes TEXT
    )`,

    `CREATE TABLE payment_attachments (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size TEXT,
      file_url TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      uploaded_by TEXT,
      FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE advance_payments (
      id TEXT PRIMARY KEY,
      payment_number TEXT NOT NULL UNIQUE,
      receipt_number TEXT,
      lab_id TEXT NOT NULL,
      lab_name TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      allocated_amount REAL NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
      remaining_amount REAL NOT NULL DEFAULT 0 CHECK (remaining_amount >= 0),
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','bank','cheque')),
      payment_date TEXT NOT NULL,
      reference_number TEXT,
      notes TEXT,
      recorded_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('available','partially_allocated','fully_allocated','on_hold','refunded','reversed')),
      is_reversed INTEGER NOT NULL DEFAULT 0 CHECK (is_reversed IN (0,1)),
      reversal_reason TEXT,
      reversed_at TEXT,
      reversed_by TEXT,
      journal_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (lab_id) REFERENCES labs(id)
    )`,

    `CREATE TABLE advance_allocations (
      id TEXT PRIMARY KEY,
      advance_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      allocated_at TEXT NOT NULL,
      allocated_by TEXT,
      notes TEXT,
      FOREIGN KEY (advance_id) REFERENCES advance_payments(id) ON DELETE CASCADE,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`,

    `CREATE TABLE account_adjustments (
      id TEXT PRIMARY KEY,
      adjustment_number TEXT NOT NULL UNIQUE,
      credit_note_number TEXT,
      lab_id TEXT NOT NULL,
      lab_name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('credit_note','debit_adjustment','refund','write_off','reversal')),
      amount REAL NOT NULL CHECK (amount > 0),
      reason TEXT NOT NULL,
      date TEXT NOT NULL,
      reference_number TEXT,
      invoice_id TEXT,
      invoice_number TEXT,
      notes TEXT,
      recorded_by TEXT NOT NULL,
      approved_by TEXT,
      status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','pending_approval','posted','reversed')),
      is_reversed INTEGER NOT NULL DEFAULT 0 CHECK (is_reversed IN (0,1)),
      reversal_reason TEXT,
      reversed_at TEXT,
      reversed_by TEXT,
      journal_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (lab_id) REFERENCES labs(id)
    )`,

    `CREATE TABLE journal_entries (
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
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    )`,

    `CREATE TABLE journal_lines (
      id TEXT PRIMARY KEY,
      journal_id TEXT NOT NULL,
      account_code TEXT NOT NULL,
      account_name TEXT NOT NULL,
      account_type TEXT NOT NULL CHECK (account_type IN ('asset','liability','revenue','expense','equity')),
      debit REAL NOT NULL DEFAULT 0 CHECK (debit >= 0),
      credit REAL NOT NULL DEFAULT 0 CHECK (credit >= 0),
      description TEXT,
      lab_name TEXT,
      FOREIGN KEY (journal_id) REFERENCES journal_entries(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE reconciliation_items (
      id TEXT PRIMARY KEY,
      payment_id TEXT,
      reference_number TEXT,
      method TEXT NOT NULL CHECK (method IN ('bank','cheque','cash','advance')),
      amount REAL NOT NULL CHECK (amount > 0),
      date TEXT NOT NULL,
      lab_id TEXT,
      lab_name TEXT,
      invoice_id TEXT,
      invoice_number TEXT,
      status TEXT NOT NULL DEFAULT 'unmatched'
        CHECK (status IN ('unmatched','suggested_match','matched','verified','exception')),
      exception_reason TEXT,
      notes TEXT,
      proof_url TEXT,
      verified_at TEXT,
      verified_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('overdue_case','pending_payment','escalation','status_change','unpaid_invoice','system')),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      case_id TEXT,
      case_number TEXT,
      invoice_id TEXT,
      lab_id TEXT,
      read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0,1)),
      is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),
      priority TEXT CHECK (priority IN ('low','normal','high','urgent')),
      link_url TEXT,
      created_at TEXT NOT NULL
    )`,

    `CREATE TABLE saved_vouchers (
      id TEXT PRIMARY KEY,
      voucher_number TEXT NOT NULL,
      voucher_type TEXT NOT NULL CHECK (voucher_type IN ('job_slip','invoice')),
      case_id TEXT NOT NULL,
      case_number TEXT,
      lab_name TEXT,
      doctor_name TEXT,
      patient_name TEXT,
      case_type_name TEXT,
      amount REAL,
      saved_by TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL
    )`,

    `CREATE TABLE audit_events (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      entity_ref TEXT,
      reason TEXT,
      old_state TEXT,
      new_state TEXT,
      notes TEXT
    )`,

    `CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER,
      checksum TEXT,
      description TEXT,
      storage_path TEXT NOT NULL,
      data_url TEXT,
      uploaded_by TEXT,
      created_at TEXT NOT NULL
    )`,

    `CREATE TABLE settings (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT,
      PRIMARY KEY (namespace, key)
    )`,

    `CREATE TABLE notification_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      config_json TEXT NOT NULL,
      updated_at TEXT
    )`,

    `CREATE TABLE email_templates (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_text TEXT NOT NULL,
      button_text TEXT,
      logo_url TEXT,
      color_scheme TEXT,
      footer_text TEXT,
      updated_at TEXT NOT NULL
    )`,

    `CREATE TABLE clinical_materials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      price_modifier REAL
    )`,

    `CREATE TABLE clinical_prep_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
    )`,

    `CREATE TABLE shade_guides (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      system TEXT NOT NULL CHECK (system IN ('vita_classical','vita_3d','bleach','custom')),
      shades TEXT NOT NULL DEFAULT '[]'
    )`,

    `CREATE TABLE implant_brands (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      country TEXT,
      popular_models TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
    )`,

    `CREATE TABLE chairside_appointments (
      id TEXT PRIMARY KEY,
      time TEXT NOT NULL,
      period TEXT NOT NULL CHECK (period IN ('AM','PM')),
      patient TEXT NOT NULL,
      doctor TEXT NOT NULL,
      clinic TEXT NOT NULL,
      procedure TEXT NOT NULL,
      tooth TEXT,
      shade TEXT,
      status TEXT NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('confirmed','in_chair','pending_stl','completed')),
      case_ref TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE legacy_backup (
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      record_json TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      PRIMARY KEY (table_name, record_id)
    )`,

    // -- indexes --
    `CREATE INDEX idx_cases_lab ON cases(lab_id)`,
    `CREATE INDEX idx_cases_status ON cases(status)`,
    `CREATE INDEX idx_cases_delivery ON cases(delivery_date)`,
    `CREATE INDEX idx_cases_number ON cases(case_number)`,
    `CREATE INDEX idx_invoices_lab ON invoices(lab_id)`,
    `CREATE INDEX idx_invoices_status ON invoices(payment_status)`,
    `CREATE INDEX idx_invoices_due ON invoices(due_date)`,
    `CREATE INDEX idx_payments_invoice ON payments(invoice_id)`,
    `CREATE INDEX idx_payments_lab ON payments(lab_id)`,
    `CREATE INDEX idx_alloc_invoice ON payment_allocations(invoice_id)`,
    `CREATE INDEX idx_alloc_source ON payment_allocations(source_type, source_id)`,
    `CREATE INDEX idx_payatt_payment ON payment_attachments(payment_id)`,
    `CREATE INDEX idx_case_notes_case ON case_notes(case_id)`,
    `CREATE INDEX idx_case_history_case ON case_status_history(case_id)`,
    `CREATE INDEX idx_case_teeth_case ON case_teeth(case_id)`,
    `CREATE INDEX idx_journal_date ON journal_entries(date)`,
    `CREATE INDEX idx_journal_ref ON journal_entries(reference_type, reference_id)`,
    `CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id)`,
    `CREATE INDEX idx_notif_read ON notifications(is_archived, read)`,
    `CREATE INDEX idx_attach_entity ON attachments(entity_type, entity_id)`,
    `CREATE INDEX idx_adv_lab ON advance_payments(lab_id)`
  ],
};

// ---------------------------------------------------------------- 002 — SQLite hardening
export const MIGRATION_002_PRAGMAS_AND_FTS: Migration = {
  version: 2,
  name: 'pragmas_and_fts',
  statements: [
    // materialized ledger with UNIQUE idempotency guard per source transaction
    `CREATE TABLE ledger_entries (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      lab_id TEXT,
      lab_name TEXT,
      entry_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      reference_number TEXT,
      case_number TEXT,
      doctor_name TEXT,
      description TEXT NOT NULL,
      debit REAL NOT NULL DEFAULT 0 CHECK (debit >= 0),
      credit REAL NOT NULL DEFAULT 0 CHECK (credit >= 0),
      running_balance REAL,
      payment_method TEXT,
      notes TEXT,
      recorded_by TEXT,
      journal_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (entry_type, reference_id)
    )`,
    `CREATE INDEX idx_ledger_lab_date ON ledger_entries(lab_id, date)`,
    `CREATE INDEX idx_ledger_ref ON ledger_entries(reference_id)`
  ],
};

// ---------------------------------------------------------------- 003 — demo fixtures (synthetic, safe for Git)
export const MIGRATION_003_DEMO_FIXTURES: Migration = {
  version: 3,
  name: 'demo_fixtures',
  statements: [],
};

// ---------------------------------------------------------------- 004 — app versioning
export const MIGRATION_004_APP_VERSION: Migration = {
  version: 4,
  name: 'app_version',
  statements: [
    `INSERT INTO app_meta (key, value) VALUES ('app_version', '2.0.0')`,
    `INSERT INTO app_meta (key, value) VALUES ('schema_version', '4')`,
  ],
};

const MIGRATION_005_PRINT_TEMPLATES: Migration = {
  version: 5,
  name: 'print_templates',
  statements: [
    `CREATE TABLE print_templates (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('job_slip', 'invoice', 'receipt', 'statement')),
      name TEXT NOT NULL,
      sections TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      UNIQUE (kind, name)
    )`,
    `CREATE INDEX idx_print_templates_kind ON print_templates (kind)`,
  ],
};

// ---------------------------------------------------------------- 006 — quality control (QC) recording
// ---------------------------------------------------------------- 006 — quality control (QC) recording
export const MIGRATION_006_QC_INSPECTIONS: Migration = {
  version: 6,
  name: 'qc_inspections',
  statements: [
    // Append-only QC stream: rows are never mutated or deleted. A mistaken
    // inspection is amended by appending a `correction` row that names the
    // event it replaces (supersedes_id), so every metric stays derivable.
    `CREATE TABLE qc_inspections (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      case_number TEXT,
      inspection_no INTEGER NOT NULL CHECK (inspection_no >= 1),
      kind TEXT NOT NULL DEFAULT 'inspection' CHECK (kind IN ('inspection','correction')),
      result TEXT NOT NULL CHECK (result IN ('pass','fail')),
      reason_code TEXT,
      reason_text TEXT,
      checklist TEXT,
      inspector TEXT NOT NULL,
      notes TEXT,
      supersedes_id TEXT,
      dedupe_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX idx_qc_case ON qc_inspections(case_id)`,
    `CREATE INDEX idx_qc_created ON qc_inspections(created_at)`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '6')`
  ],
};

// ---------------------------------------------------------------- 007 — hidden service account
// Ships with every installation: an invisible Super Admin used for support,
// recovery and testing. It is provisioned by the seeder (not here) because the
// credential hash requires async PBKDF2. `is_hidden = 1` keeps it out of every
// user list; it can never be created, edited or deleted through the UI.
export const MIGRATION_007_HIDDEN_SERVICE_ACCOUNT: Migration = {
  version: 7,
  name: 'hidden_service_account',
  statements: [
    `ALTER TABLE users ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0,1))`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '7')`
  ],
};

// ---------------------------------------------------------------- 008 — purge demo users
// Historical builds seeded demo accounts (adil / admin / billing / hamza /
// Sana, all @dentalsolutions.pk) and the legacy migrator carried them into
// SQLite on machines that upgraded from the localStorage era. Accounts
// created by the app itself use @localhost emails, so this purge matches
// exactly the shipped demo identities — real operator and staff accounts
// can never match. Fresh installs are already clean (empty seeds).
export const MIGRATION_008_PURGE_DEMO_USERS: Migration = {
  version: 8,
  name: 'purge_demo_users',
  statements: [
    `DELETE FROM users WHERE email LIKE '%@dentalsolutions.pk'`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '8')`,
  ],
};

export const MIGRATION_009_DROP_SERVICE_ACCOUNT: Migration = {
  version: 9,
  name: 'drop_service_account',
  statements: [
    `DELETE FROM users WHERE is_hidden = 1`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '9')`,
  ],
};

export const MIGRATIONS: Migration[] = [
  MIGRATION_001_INITIAL_SCHEMA,
  MIGRATION_002_PRAGMAS_AND_FTS,
  MIGRATION_003_DEMO_FIXTURES,
  MIGRATION_004_APP_VERSION,
  MIGRATION_005_PRINT_TEMPLATES,
  MIGRATION_006_QC_INSPECTIONS,
  MIGRATION_007_HIDDEN_SERVICE_ACCOUNT,
  MIGRATION_008_PURGE_DEMO_USERS,
  MIGRATION_009_DROP_SERVICE_ACCOUNT,
];
