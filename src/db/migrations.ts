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
  /**
   * Set ONLY by a migration that rebuilds a table using SQLite's 12-step
   * ALTER procedure (create new → copy → drop old → rename).
   *
   * It exists because `DROP TABLE` on a table that other tables reference is
   * unsafe while foreign keys are enforced — SQLite attempts an implicit
   * `DELETE FROM`, which either raises an immediate FK error or fires the
   * child's `ON DELETE CASCADE` and destroys rows the rebuild was meant to
   * preserve. This engine turns `foreign_keys` ON at open (engine.ts), and
   * `PRAGMA foreign_keys` is a NO-OP inside a transaction, so it cannot be
   * switched off by a statement in `statements`. The runner has to do it.
   *
   * When set, the runner suspends FK enforcement for this migration only and
   * runs `PRAGMA foreign_key_check` before committing, so a rebuild that would
   * have silently broken referential integrity fails loudly instead.
   */
  rebuildsTable?: boolean;
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

// ---------------------------------------------------------------- 010 — catalog detail
// The price list / catalog needs real specification fields (material system,
// unit basis, shade guide, indications, contraindications). All nullable —
// existing rows simply leave them empty, nothing is fabricated.
export const MIGRATION_010_CATALOG_DETAIL: Migration = {
  version: 10,
  name: 'catalog_detail',
  statements: [
    `ALTER TABLE case_types ADD COLUMN material_system TEXT`,
    `ALTER TABLE case_types ADD COLUMN unit_basis TEXT`,
    `ALTER TABLE case_types ADD COLUMN shade_guide TEXT`,
    `ALTER TABLE case_types ADD COLUMN indications TEXT`,
    `ALTER TABLE case_types ADD COLUMN contraindications TEXT`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '10')`,
  ],
};

// ---------------------------------------------------------------- 011 — case archive
// Completed cases can be archived out of the active workstation without being
// deleted. `archived_at` NULL = active; set = archived on that timestamp.
export const MIGRATION_011_CASE_ARCHIVE: Migration = {
  version: 11,
  name: 'case_archive',
  statements: [
    `ALTER TABLE cases ADD COLUMN archived_at TEXT`,
    `CREATE INDEX idx_cases_archived ON cases(archived_at)`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '11')`,
  ],
};

// ---------------------------------------------------------------- 012 — invoice journal backfill
// The issuance journal (debit A/R / credit Revenue) was never wired into the
// invoice-creation flow, so historical invoices have no journal in the
// double-entry ledger. This backfill creates one balanced journal per invoice
// that has none (matched by event_type='invoice_issued' AND reference_id).
// The invoice's journal_id is NOT set here: the whole-table sync rewrites
// invoices from React state and would overwrite it — the AppContext boot
// sweep fills journal_id in state instead, per the app's persistence contract.
export const MIGRATION_012_INVOICE_JOURNALS: Migration = {
  version: 12,
  name: 'invoice_journals_backfill',
  statements: [
    `INSERT INTO journal_entries (id, journal_number, date, event_type, reference_type, reference_id, reference_number, lab_id, lab_name, description, created_at, created_by)
     SELECT 'jrn-invbf-' || i.id,
            'JRN-INVBF-' || CAST(i.rowid AS TEXT),
            COALESCE(i.created_at, '1970-01-01'),
            'invoice_issued',
            'invoice',
            i.id,
            i.invoice_number,
            i.lab_id,
            i.lab_name,
            'Backfilled issuance journal for invoice ' || i.invoice_number,
            COALESCE(i.created_at, '1970-01-01'),
            'Migration 012'
     FROM invoices i
     WHERE NOT EXISTS (
       SELECT 1 FROM journal_entries je
       WHERE je.event_type = 'invoice_issued' AND je.reference_id = i.id
     )`,
    `INSERT INTO journal_lines (id, journal_id, account_code, account_name, account_type, debit, credit, description, lab_name)
     SELECT 'jline-invbf-dr-' || j.reference_id, j.id, '1100', 'Accounts Receivable (Dental Clinics)', 'asset', i.final_amount, 0, 'Backfill: A/R debit', j.lab_name
     FROM journal_entries j JOIN invoices i ON i.id = j.reference_id
     WHERE j.event_type = 'invoice_issued' AND j.created_by = 'Migration 012'`,
    `INSERT INTO journal_lines (id, journal_id, account_code, account_name, account_type, debit, credit, description, lab_name)
     SELECT 'jline-invbf-cr-' || j.reference_id, j.id, '4010', 'Dental Prosthetics Revenue', 'revenue', 0, i.final_amount, 'Backfill: revenue credit', j.lab_name
     FROM journal_entries j JOIN invoices i ON i.id = j.reference_id
     WHERE j.event_type = 'invoice_issued' AND j.created_by = 'Migration 012'`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '12')`,
  ],
};

// ---------------------------------------------------------------- 013 — journal case references
// Case/Job must be a first-class accounting reference: journal_entries stored
// case context only inside free-text description, forcing narration parsing in
// the General Ledger. Backfill derives case_id/case_number relationally from
// the journal's own reference row (invoice.case_id / payments.case_id /
// account_adjustments.invoice_id → invoice), never from description text.
export const MIGRATION_013_JOURNAL_CASE_REFS: Migration = {
  version: 13,
  name: 'journal_case_references',
  statements: [
    `ALTER TABLE journal_entries ADD COLUMN case_id TEXT`,
    `ALTER TABLE journal_entries ADD COLUMN case_number TEXT`,
    // Invoices carry case_id directly.
    `UPDATE journal_entries SET
       case_id = (SELECT i.case_id FROM invoices i WHERE i.id = journal_entries.reference_id),
       case_number = (SELECT i.case_number FROM invoices i WHERE i.id = journal_entries.reference_id)
     WHERE reference_type = 'invoice' AND reference_id IS NOT NULL`,
    // Payments carry case_id themselves; fall back to their invoice.
    `UPDATE journal_entries SET
       case_id = COALESCE(
         (SELECT p.case_id FROM payments p WHERE p.id = journal_entries.reference_id),
         (SELECT i.case_id FROM invoices i WHERE i.id = (SELECT p.invoice_id FROM payments p WHERE p.id = journal_entries.reference_id))
       ),
       case_number = COALESCE(
         (SELECT p.case_number FROM payments p WHERE p.id = journal_entries.reference_id),
         (SELECT i.case_number FROM invoices i WHERE i.id = (SELECT p.invoice_id FROM payments p WHERE p.id = journal_entries.reference_id))
       )
     WHERE reference_type = 'payment' AND reference_id IS NOT NULL`,
    // Advance-allocation journals reference the invoice they were applied to.
    `UPDATE journal_entries SET
       case_id = (SELECT i.case_id FROM invoices i WHERE i.id = journal_entries.reference_id),
       case_number = (SELECT i.case_number FROM invoices i WHERE i.id = journal_entries.reference_id)
     WHERE reference_type = 'advance_allocation' AND reference_id IS NOT NULL`,
    // Adjustments reach the case through their invoice.
    `UPDATE journal_entries SET
       case_id = (SELECT i.case_id FROM invoices i WHERE i.id = (SELECT a.invoice_id FROM account_adjustments a WHERE a.id = journal_entries.reference_id)),
       case_number = (SELECT i.case_number FROM invoices i WHERE i.id = (SELECT a.invoice_id FROM account_adjustments a WHERE a.id = journal_entries.reference_id))
     WHERE reference_type = 'adjustment' AND reference_id IS NOT NULL`,
    // Reversal journals inherit from the journal they reverse (reference_number REV-OF-*).
    `UPDATE journal_entries SET
       case_id = (SELECT o.case_id FROM journal_entries o WHERE o.journal_number = REPLACE(journal_entries.reference_number, 'REV-OF-', '')),
       case_number = (SELECT o.case_number FROM journal_entries o WHERE o.journal_number = REPLACE(journal_entries.reference_number, 'REV-OF-', ''))
     WHERE event_type = 'reversal' AND reference_number LIKE 'REV-OF-%'`,
    `CREATE INDEX idx_journal_case ON journal_entries(case_id)`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '13')`,
  ],
};

// ---------------------------------------------------------------- 014 — per-user preferences
// D4 decision (2026-10-01): preferences (UI zoom, per-user toggles) become
// per-user rows instead of one global blob, so two staff members on the same
// installation keep their own settings. value holds the JSON preferences
// object; the legacy global row (settings namespace 'user_prefs') migrates
// to nobody — the app falls back to defaults until each user saves once.
export const MIGRATION_014_USER_PREFERENCES: Migration = {
  version: 14,
  name: 'user_preferences_table',
  statements: [
    `CREATE TABLE IF NOT EXISTS user_preferences (
       user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
       value TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '14')`,
  ],
};

// ---------------------------------------------------------------- 015 — bench department
// The dashboard's workload panel needs to know which bench a case is routed to.
// Until now the schema had no such field, so the panel could only report a
// share of cases by material — real, but not the question a lab manager asks.
// `department` is nullable: existing rows stay NULL and the panel groups them
// under "Unassigned" rather than silently inventing a department for them.
export const MIGRATION_015_CASE_DEPARTMENT: Migration = {
  version: 15,
  name: 'case_department',
  statements: [
    `ALTER TABLE cases ADD COLUMN department TEXT`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '15')`,
  ],
};

// ---------------------------------------------------------------- 016 — money attachment owner
// `payment_attachments` has always been used polymorphically: the repo layer
// (advancePaymentsRepo.insert, adjustmentsRepo.insert), the legacy migrator
// and syncCore all store an ADVANCE or ADJUSTMENT id in `payment_id`. But the
// table declared `FOREIGN KEY (payment_id) REFERENCES payments(id)`, so every
// one of those writes raised "FOREIGN KEY constraint failed" — and because
// syncCollectionsToDb writes the whole app inside ONE SAVEPOINT, a single
// advance with a receipt scan killed persistence for the entire database
// (advances, adjustments, notifications, vouchers, audit events, templates,
// every table synced after that point).
//
// The FK was also the only reason `PRAGMA foreign_key_check` was quiet, and it
// was never true for the rows that actually mattered: with foreign_keys OFF
// (which sql.js silently does on every export() before the P2 fix) those very
// inserts succeeded and left genuine orphans.
//
// So make the table say what it always was: an attachment owned by a money
// document, tagged with `owner_type`. The FK cannot express "one of three
// parents", so it is replaced by three AFTER DELETE triggers that reproduce the
// exact cascade the schema used to get for free.
export const MIGRATION_016_PAYMENT_ATTACHMENT_OWNER: Migration = {
  version: 16,
  name: 'payment_attachment_owner',
  statements: [
    `CREATE TABLE payment_attachments_v16 (
      id TEXT PRIMARY KEY,
      owner_type TEXT NOT NULL DEFAULT 'payment'
        CHECK (owner_type IN ('payment','advance','adjustment')),
      payment_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size TEXT,
      file_url TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      uploaded_by TEXT
    )`,

    // Carry every existing row over. owner_type is inferred from the id that
    // is actually there — those rows are real advance/adjustment proofs that
    // the FK used to reject, and they are the operator's receipts, so they
    // must not be dropped on the floor by the fix.
    `INSERT INTO payment_attachments_v16
       (id, owner_type, payment_id, filename, file_type, file_size, file_url, uploaded_at, uploaded_by)
     SELECT id,
            CASE
              WHEN payment_id IN (SELECT id FROM advance_payments) THEN 'advance'
              WHEN payment_id IN (SELECT id FROM account_adjustments) THEN 'adjustment'
              ELSE 'payment'
            END,
            payment_id, filename, file_type, file_size, file_url, uploaded_at, uploaded_by
     FROM payment_attachments`,

    `DROP TABLE payment_attachments`,
    `ALTER TABLE payment_attachments_v16 RENAME TO payment_attachments`,
    `CREATE INDEX idx_payatt_payment ON payment_attachments(payment_id)`,

    // Cascade deletes, re-implemented as triggers (the old FK covered only the
    // `payment` owner type, so advances/adjustments never cascaded anyway).
    `CREATE TRIGGER trg_payment_attachments_cascade_payment AFTER DELETE ON payments BEGIN
       DELETE FROM payment_attachments WHERE owner_type = 'payment' AND payment_id = OLD.id;
     END`,
    `CREATE TRIGGER trg_payment_attachments_cascade_advance AFTER DELETE ON advance_payments BEGIN
       DELETE FROM payment_attachments WHERE owner_type = 'advance' AND payment_id = OLD.id;
     END`,
    `CREATE TRIGGER trg_payment_attachments_cascade_adjustment AFTER DELETE ON account_adjustments BEGIN
       DELETE FROM payment_attachments WHERE owner_type = 'adjustment' AND payment_id = OLD.id;
     END`,

    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '16')`,
  ],
};

// ---------------------------------------------------------------- 017 — drop dead indexes
/**
 * Measured, not guessed. Every SQL statement the app can issue was extracted from
 * src/ and planned with EXPLAIN QUERY PLAN against a migrated database; the
 * indexes below are chosen by NO statement. The reason is structural: the app
 * loads whole collections into memory and filters, sorts and searches them in
 * JavaScript (CaseListView, NotificationsView, AuditLogView, dashboardMetrics),
 * so the only SQL that ever runs is `SELECT * FROM t` plus id-keyed lookups.
 *
 * Cost, measured by dropping each index and VACUUMing:
 *
 *   index                 empty DB    2,000 rows/table
 *   idx_cases_delivery     4,096 B          40,960 B
 *   idx_cases_archived     4,096 B          20,480 B
 *   idx_invoices_status    4,096 B          32,768 B
 *   idx_payments_lab       4,096 B          32,768 B
 *   idx_alloc_invoice      4,096 B          32,768 B
 *   idx_alloc_source       4,096 B          45,056 B  (replaced below)
 *   idx_journal_ref        4,096 B          45,056 B
 *   idx_audit_entity       4,096 B          40,960 B
 *   idx_notif_read         4,096 B          24,576 B
 *   idx_ledger_ref         4,096 B          32,768 B  (superseded by UNIQUE(entry_type, reference_id))
 *   idx_print_templates_kind 4,096 B        36,864 B  (superseded by UNIQUE(kind, name))
 *
 * An index costs exactly one 4 KB page when the table is empty — which is why
 * the empty database floor was 569,344 bytes — and 20-45 KB once the clinic has
 * real rows, roughly 9% of a 4.4 MB working database.
 *
 * `idx_qc_created` is deliberately KEPT: `qcRepo.all()` orders by
 * `created_at, inspection_no` and SQLite does use the index for the first term
 * (`SCAN qc_inspections USING INDEX idx_qc_created` + temp b-tree for the last).
 *
 * `idx_alloc_source` is not simply dropped, it is REPLACED. It was declared on
 * `(source_type, source_id)`, but every lookup filters `source_id` alone
 * (`repos.ts`: payment allocations are read and deleted by source id), and a
 * two-column index is unusable when only the second column is constrained —
 * `EXPLAIN QUERY PLAN DELETE FROM payment_allocations WHERE source_id = ?`
 * returned `SCAN payment_allocations`. The replacement index makes that delete
 * and that read indexed instead of a full table scan.
 */
export const MIGRATION_017_DROP_UNUSED_INDEXES: Migration = {
  version: 17,
  name: 'drop_unused_indexes',
  statements: [
    `DROP INDEX IF EXISTS idx_cases_delivery`,
    `DROP INDEX IF EXISTS idx_cases_archived`,
    `DROP INDEX IF EXISTS idx_invoices_status`,
    `DROP INDEX IF EXISTS idx_payments_lab`,
    `DROP INDEX IF EXISTS idx_alloc_invoice`,
    `DROP INDEX IF EXISTS idx_alloc_source`,
    `DROP INDEX IF EXISTS idx_journal_ref`,
    `DROP INDEX IF EXISTS idx_audit_entity`,
    `DROP INDEX IF EXISTS idx_notif_read`,
    `DROP INDEX IF EXISTS idx_ledger_ref`,
    `DROP INDEX IF EXISTS idx_print_templates_kind`,
    // Replaces the unusable (source_type, source_id) index: lookups filter
    // source_id alone, which SQLite cannot use a composite index for.
    `CREATE INDEX IF NOT EXISTS idx_alloc_source_id ON payment_allocations(source_id)`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '17')`,
  ],
};

// ---------------------------------------------------------------- 018 — doc_sequences
/**
 * `doc_sequences` was the one table NOT owned by a migration: it was created
 * lazily on first use by `ensureSequenceTable()` (sequences.ts) and by the
 * seeder, so it existed in every real database while appearing in none of them
 * declared schema.
 *
 * That was invisible until the export DDL was derived from MIGRATIONS, at which
 * point the .sql dump came out with 44 of the live 45 tables — discovered by
 * replaying the real export against the running app's schema, not by reading the
 * code. A dump missing the document-number counters would hand out document
 * numbers that already exist after a restore, which is exactly the class of
 * collision the sync's duplicate healer exists to paper over.
 *
 * `IF NOT EXISTS` keeps this a no-op for every existing database (they already
 * have the table), and `ensureSequenceTable()` stays as the belt-and-braces
 * guard for any path that reaches a counter before migrations have run.
 */
export const MIGRATION_018_DOC_SEQUENCES: Migration = {
  version: 18,
  name: 'doc_sequences',
  statements: [
    `CREATE TABLE IF NOT EXISTS doc_sequences (
      seq_key TEXT PRIMARY KEY,
      next_value INTEGER NOT NULL DEFAULT 1
    )`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '18')`,
  ],
};

// ---------------------------------------------------------------- 019 — case received date
// A job slip has to record the day the case came INTO the lab, which is not
// `delivery_date`: that column is the FUTURE promised date, is NOT NULL, and
// drives overdue flags, SLA reminders, queue buckets and sorting. So the day
// the lab actually received the job gets its own nullable column — NULL for
// every pre-019 row, so no migration has to guess a date that was never stored.
export const MIGRATION_019_CASE_RECEIVED_DATE: Migration = {
  version: 19,
  name: 'case_received_date',
  statements: [
    `ALTER TABLE cases ADD COLUMN received_date TEXT`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '19')`,
  ],
};

/**
 * Strip ONE leading `Dr`/`Dr.` (any case) from a doctor-name column.
 *
 * SQLite's LIKE is case-insensitive for ASCII, so this matches `DR ` as well
 * as `Dr ` — which is what we want, since the old form was typed by hand.
 *
 * Two guards earn their keep:
 *
 *  - The pattern requires whitespace or a literal `.` after `Dr`, so `Drake`
 *    and `Professor` are never touched. Matching on the bare prefix would
 *    corrupt ordinary names.
 *  - `NULLIF(..., '')` then `COALESCE(..., col)` means a value that was
 *    nothing but an honorific keeps its original text instead of being blanked.
 *    Those rows are already unusable, but erasing them destroys evidence, and
 *    the read path renders an empty name as "—" either way.
 */
const stripOneDoctorPrefix = (table: string, column: string): string =>
  `UPDATE ${table} SET ${column} = COALESCE(NULLIF(TRIM(SUBSTR(${column}, 4)), ''), ${column}) WHERE ${column} LIKE 'Dr %' OR ${column} LIKE 'Dr.%'`;

/**
 * Migration 020: normalise stored doctor names to the BARE form.
 *
 * `doctor_name` was free text typed against a placeholder reading
 * `"Dr. Tariq Mahmood"`, while five renderers prepended their own `"Dr. "`.
 * The single source of truth is now `src/utils/doctorName.ts`: store bare,
 * format at the edge. This rewrites history so the bare form is a fact about
 * the data rather than a convention each call site has to remember.
 *
 * All SIX tables carrying the column are covered. Fixing only `cases` would
 * leave an invoice or a ledger line printing "Dr. Dr." forever, because each
 * of them renders independently.
 *
 * The strip runs three times per table because the defect could stack — a
 * name re-saved through an already-prefixed form can carry two honorifics, and
 * a single pass would leave the second behind, making the migration
 * non-idempotent in the sense that matters: re-running the app on such a row
 * would put the doubled prefix right back.
 */
export const MIGRATION_020_BARE_DOCTOR_NAME: Migration = {
  version: 20,
  name: 'bare_doctor_name',
  statements: [
    ...(
      [
        'labs',
        'doctor_preferred_labs',
        'cases',
        'invoices',
        'saved_vouchers',
        'ledger_entries',
      ] as const
    ).flatMap((table) => [
      stripOneDoctorPrefix(table, 'doctor_name'),
      stripOneDoctorPrefix(table, 'doctor_name'),
      stripOneDoctorPrefix(table, 'doctor_name'),
    ]),
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '20')`,
  ],
};

// ------------------------------------------------------------ 021 — catalog tooth requirement
// Some products are not per-tooth work: retainers, healing posts, a denture
// try-in. `needs_teeth = 0` lets the case wizard skip charting for them, and makes
// every output omit teeth and shade (they are stored empty rather than faked).
// DEFAULT 1 keeps every existing catalog row and every existing case meaning
// exactly what it did before, so no backfill is required.
export const MIGRATION_021_CATALOG_NEEDS_TEETH: Migration = {
  version: 21,
  name: 'catalog_needs_teeth',
  statements: [
    `ALTER TABLE case_types ADD COLUMN needs_teeth INTEGER NOT NULL DEFAULT 1`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '21')`,
  ],
};

/**
 * 022 — drop the dead `ledger_entries` table.
 *
 * `ledger_entries` was a per-document mirror of the double-entry journal that
 * the live money path stopped writing years ago: the General Ledger renders
 * `journal_entries`/`journal_lines`, and every posting goes through
 * `journalRepo` + the invoice/advance/adjustment triggers. Nothing in the app
 * read or wrote the mirror any more — the only code touching it was
 * `ledgerRepo`, which nothing called, plus the system-reset purge list, which
 * existed purely to keep the dead rows from surviving a wipe.
 *
 * Dropping the table (rather than leaving it to rot) also removes a second
 * ledger-balance story that could drift from the real one. `IF EXISTS` keeps
 * the migration replayable from any older snapshot, and the index goes first
 * so no orphan index is left behind.
 */
export const MIGRATION_022_DROP_LEDGER_ENTRIES: Migration = {
  version: 22,
  name: 'drop_ledger_entries',
  statements: [
    // Both indexes migration 001 created on the table (017 already dropped
    // idx_ledger_ref, but an older snapshot may still carry it).
    `DROP INDEX IF EXISTS idx_ledger_ref`,
    `DROP INDEX IF EXISTS idx_ledger_lab_date`,
    `DROP TABLE IF EXISTS ledger_entries`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '22')`,
  ],
};

/**
 * 023 — user-managed catalog categories.
 *
 * Material categories used to be a hardcoded five-element array inside
 * `CatalogView.tsx`, with a TS union mirroring it. Adding a category meant
 * editing a component and rebuilding; renaming one was impossible; the label
 * existed in TWO places that disagreed (`Implant Prosthetics` on the filter pill
 * vs `Implant Abutment` in the form dropdown), so the same category had two
 * names depending on where you looked.
 *
 * THE BACKFILL IS THE PART THAT MATTERS
 * The seeded category ids are deliberately IDENTICAL to the legacy strings
 * (`crown_bridge`, `implant`, `denture`, `orthodontic`, `veneers`) rather than
 * fresh generated ones. `case_types.category` already stores those exact
 * strings, so every existing product is already pointing at a valid category row
 * the moment the INSERT lands — there is no UPDATE, no id remapping, and no
 * window in which a product could point at nothing.
 *
 * The second INSERT catches what the seed cannot: a category string in
 * `case_types` that was never in the hardcoded array — a hand-edited database, or
 * a row written by an older build with a value the UI no longer offered. Each
 * becomes a real category row at sort_order 900 (sorted last) instead of an
 * orphan that would silently vanish from the filter list.
 *
 * `case_types.category` stays a plain TEXT column rather than becoming a
 * FOREIGN KEY. A FK would be tidier on paper but would make the delete path
 * order-dependent in a way the UI has to honour; the repo enforces referential
 * behaviour explicitly and can report *why* a delete was refused, which is what
 * the operator actually needs to see.
 */
export const MIGRATION_023_CATALOG_CATEGORIES: Migration = {
  version: 23,
  name: 'catalog_categories',
  // Rebuilds `case_types` (see below), so the runner suspends FK enforcement.
  rebuildsTable: true,
  statements: [
    /* ── 1. Widen the category CHECK ───────────────────────────────────────
       `case_types.category` carried
         CHECK (category IN ('crown_bridge','implant','denture','orthodontic','veneers'))
       at the SQL layer. Widening a CHECK needs SQLite's 12-step ALTER — there
       is no ALTER CONSTRAINT — so the table is rebuilt.

       Had this been missed, `categoryRepo.create()` would have succeeded and
       then EVERY save of a material in that new category would have failed with
       "CHECK constraint failed", with the category visible in the dropdown and
       unusable in practice. The constraint, not the UI, was the real gate.

       The rebuild preserves every column added by 010 and 021, the
       `name ... UNIQUE COLLATE NOCASE`, and the `base_price >= 0` guard.
       Only the category CHECK is relaxed. */
    `DROP TABLE IF EXISTS case_types_023_rebuild`,
    `CREATE TABLE case_types_023_rebuild (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      base_price REAL NOT NULL CHECK (base_price >= 0),
      -- CHECK removed: the valid set now lives in catalog_categories.
      category TEXT,
      lead_time_days INTEGER,
      warranty_months INTEGER,
      description TEXT,
      -- added by migration 010
      material_system TEXT,
      unit_basis TEXT,
      shade_guide TEXT,
      indications TEXT,
      contraindications TEXT,
      -- added by migration 021
      needs_teeth INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT
    )`,
    `INSERT INTO case_types_023_rebuild
       (id, name, base_price, category, lead_time_days, warranty_months, description,
        material_system, unit_basis, shade_guide, indications, contraindications,
        needs_teeth, created_at, updated_at)
     SELECT
       id, name, base_price, category, lead_time_days, warranty_months, description,
       material_system, unit_basis, shade_guide, indications, contraindications,
       needs_teeth, created_at, updated_at
     FROM case_types`,
    `DROP TABLE case_types`,
    // With legacy_alter_table OFF (the default) this rewrites references to
    // "case_types_023_rebuild" inside other tables' FK clauses back to the
    // final name, so lab_pricing_overrides keeps pointing at the real table.
    `ALTER TABLE case_types_023_rebuild RENAME TO case_types`,

    `CREATE TABLE IF NOT EXISTS catalog_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    )`,
    // NO INDEX ON PURPOSE. `all()` orders by (sort_order, name) and runs once per
    // catalog render over a table bounded by the number of categories a lab
    // actually has — a handful to a few dozen rows. A full scan plus sort at
    // that size is cheaper than maintaining the index on every create, rename
    // and delete. `dbFootprint.test.ts` is a drift alarm for exactly this: a
    // new index must earn its place, and migrations 017 and 022 both removed
    // dead ones rather than relaxing the count.
    // The five shipped categories. ids == the legacy strings (see note above).
    `INSERT OR IGNORE INTO catalog_categories (id, name, sort_order) VALUES
      ('crown_bridge',  'Crown & Bridge',            10),
      ('implant',       'Implant Prosthetics',       20),
      ('denture',       'Dentures & Removables',     30),
      ('orthodontic',   'Orthodontic & Aligners',    40),
      ('veneers',       'Veneers & Aesthetics',      50)`,
    // Adopt any pre-existing category string so nothing is left orphaned.
    `INSERT OR IGNORE INTO catalog_categories (id, name, sort_order)
       SELECT lower(replace(replace(trim(category), ' ', '_'), '-', '_')),
              replace(trim(category), '_', ' '),
              900
       FROM case_types
       WHERE category IS NOT NULL AND trim(category) <> ''`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '23')`,
  ],
};

/**
 * 024 - remove the reversal concept, and clean up what it left behind.
 *
 * REVERSAL NEVER WORKED. `is_reversed` was read in ten places and written in
 * none: no command, UI or migration ever set it, and no "reverse" action
 * existed to call. What it did leave behind:
 *
 *  1. DEAD GATES. Voiding an invoice or deleting a case with money against it
 *     refused with "Reverse them first" - pointing at a command that did not
 *     exist. The only way out was deleting the voucher, which the message never
 *     said.
 *  2. A LEDGER THAT IGNORED IT. `buildLedgerEntries` never tested `is_reversed`,
 *     so a reversed payment still emitted a full credit row. Separately the
 *     General Ledger never read `journal_entries` at all, so a journal-level
 *     reversal was invisible to it. Two ledger views, two different truths.
 *  3. ORPHAN JOURNALS - the part that actually bit. Deleting a case voided its
 *     invoice and wrote a compensating "reversal" journal while KEEPING the
 *     original. The invoice row went away; both journal rows stayed. Because
 *     `syncCore` rebuilds the journal tables wholesale from memory on every
 *     save, the pair was re-inserted forever. Two entries for one deleted
 *     invoice, re-appearing after every restart. That is the "technical
 *     glitch" - and it is why the entries came back.
 *
 * THE FIX IS DELETION, NOT A COMPENSATING ENTRY. A posting is retired by
 * removing the row it belongs to. `deleteCase`, `deleteInvoice` and the reprice
 * path now do exactly that (see AppContext), so the gap cannot reopen.
 *
 * The four columns go with the concept. `ALTER TABLE ... DROP COLUMN` cannot
 * run while a CHECK constraint references the column, and these tables carry
 * `CHECK (is_reversed IN (0,1))`, so each is rebuilt with the 12-step
 * procedure the engine already understands via `rebuildsTable: true`. Every
 * CHECK, UNIQUE and FOREIGN KEY is carried across verbatim - the rebuild is
 * only allowed to lose the four reversal columns and the two enum values that
 * named a state this app can no longer be in.
 *
 * `status = 'reversed'` is filtered out of the copy rather than migrated. That
 * state was only ever reachable through the flag that was never written, so
 * the count is zero in practice; keeping the value in the CHECK would leave a
 * reversal state behind, which is the whole thing being removed.
 */
export const MIGRATION_024_REMOVE_REVERSAL: Migration = {
  version: 24,
  name: 'remove_reversal',
  rebuildsTable: true,
  statements: [
    // ── Orphan sweep, FIRST, against the schema as it stands today. A journal
    // whose invoice, case or payment is gone describes an event that no longer
    // exists. journal_lines cascades from journal_entries, but it is pruned
    // explicitly first so the sweep is correct even on a database whose
    // foreign_keys pragma was off when the orphans were written.
    `DELETE FROM journal_lines WHERE journal_id IN (
       SELECT j.id FROM journal_entries j
       WHERE j.reference_type = 'invoice'
         AND j.reference_id NOT IN (SELECT id FROM invoices)
     )`,
    `DELETE FROM journal_entries WHERE reference_type = 'invoice'
       AND reference_id NOT IN (SELECT id FROM invoices)`,
    `DELETE FROM journal_lines WHERE journal_id IN (
       SELECT j.id FROM journal_entries j
       WHERE j.case_id IS NOT NULL
         AND j.case_id NOT IN (SELECT id FROM cases)
     )`,
    `DELETE FROM journal_entries WHERE case_id IS NOT NULL
       AND case_id NOT IN (SELECT id FROM cases)`,
    `DELETE FROM journal_lines WHERE journal_id IN (
       SELECT j.id FROM journal_entries j
       WHERE j.event_type = 'payment_received'
         AND j.reference_id NOT IN (SELECT id FROM payments)
     )`,
    `DELETE FROM journal_entries WHERE event_type = 'payment_received'
       AND reference_id NOT IN (SELECT id FROM payments)`,

    // ── payments
    `CREATE TABLE payments__new (
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
        CHECK (status IN ('draft','pending_verification','posted','reconciled','failed')),
      unapplied_amount REAL NOT NULL DEFAULT 0 CHECK (unapplied_amount >= 0),
      journal_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`,
    `INSERT INTO payments__new SELECT
      id, payment_number, receipt_number, invoice_id, invoice_number,
      case_id, case_number, lab_id, lab_name,
      amount, payment_method, payment_date, reference_number, notes, recorded_by,
      payment_type, advance_payment_id,
      status, unapplied_amount, journal_id, created_at
      FROM payments WHERE is_reversed = 0 AND status <> 'reversed'`,
    `DROP TABLE payments`,
    `ALTER TABLE payments__new RENAME TO payments`,
    // DROP TABLE takes the table's TRIGGERS with it. This one is the money
    // attachment cascade from migration 016: without it, deleting a voucher
    // left its receipt scans and slips behind on the attachments table forever.
    `CREATE TRIGGER trg_payment_attachments_cascade_payment AFTER DELETE ON payments BEGIN
       DELETE FROM payment_attachments WHERE owner_type = 'payment' AND payment_id = OLD.id;
     END`,
    // DROP TABLE took these with it. The UNIQUE constraints come back on their
    // own (they are part of the CREATE TABLE), but explicit indexes do not, and
    // `payments.invoice_id` is the hot path: every invoice drawer, statement and
    // ledger build reads a payment by invoice.
    `CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id)`,

    // ── advance_payments
    `CREATE TABLE advance_payments__new (
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
        CHECK (status IN ('available','partially_allocated','fully_allocated','on_hold','refunded')),
      journal_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (lab_id) REFERENCES labs(id)
    )`,
    `INSERT INTO advance_payments__new SELECT
      id, payment_number, receipt_number, lab_id, lab_name,
      amount, allocated_amount, remaining_amount,
      payment_method, payment_date, reference_number, notes, recorded_by,
      status, journal_id, created_at
      FROM advance_payments WHERE is_reversed = 0 AND status <> 'reversed'`,
    `DROP TABLE advance_payments`,
    `ALTER TABLE advance_payments__new RENAME TO advance_payments`,
    `CREATE TRIGGER trg_payment_attachments_cascade_advance AFTER DELETE ON advance_payments BEGIN
       DELETE FROM payment_attachments WHERE owner_type = 'advance' AND payment_id = OLD.id;
     END`,
    `CREATE INDEX IF NOT EXISTS idx_adv_lab ON advance_payments(lab_id)`,

    // ── account_adjustments
    `CREATE TABLE account_adjustments__new (
      id TEXT PRIMARY KEY,
      adjustment_number TEXT NOT NULL UNIQUE,
      credit_note_number TEXT,
      lab_id TEXT NOT NULL,
      lab_name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('credit_note','debit_adjustment','refund','write_off')),
      amount REAL NOT NULL CHECK (amount > 0),
      reason TEXT NOT NULL,
      date TEXT NOT NULL,
      reference_number TEXT,
      invoice_id TEXT,
      invoice_number TEXT,
      notes TEXT,
      recorded_by TEXT NOT NULL,
      approved_by TEXT,
      status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','pending_approval','posted')),
      journal_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (lab_id) REFERENCES labs(id)
    )`,
    // A type of 'reversal' was the other way the dead concept surfaced as a
    // real row. That type does not exist any more, so those rows go.
    `INSERT INTO account_adjustments__new SELECT
      id, adjustment_number, credit_note_number, lab_id, lab_name,
      type, amount, reason, date,
      reference_number, invoice_id, invoice_number, notes, recorded_by, approved_by,
      status, journal_id, created_at
      FROM account_adjustments
      WHERE is_reversed = 0 AND type <> 'reversal' AND status <> 'reversed'`,
    `DROP TABLE account_adjustments`,
    `ALTER TABLE account_adjustments__new RENAME TO account_adjustments`,
    `CREATE TRIGGER trg_payment_attachments_cascade_adjustment AFTER DELETE ON account_adjustments BEGIN
       DELETE FROM payment_attachments WHERE owner_type = 'adjustment' AND payment_id = OLD.id;
     END`,

    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '24')`,
  ],
};

/**
 * 025 - opening balance on a clinic account.
 *
 * A clinic that already owed money before it was entered into the system has no
 * way to record that starting debt. Without it the ledger opens at zero and the
 * first invoice makes the balance look like it appeared from nowhere.
 *
 * Stored as a column on `labs` rather than as a one-off adjustment row so it has
 * a home that can be read and corrected. The ledger derives its opening entry
 * from this field, which is what keeps the two from ever disagreeing — an
 * adjustment row would balance the books but leave no editable record of what
 * the starting figure was.
 *
 * `ADD COLUMN` with a constant DEFAULT is enough here: unlike the reversal
 * columns in 024 there is no CHECK constraint referencing this one, so no table
 * rebuild is needed.
 */
export const MIGRATION_025_CLINIC_OPENING_BALANCE: Migration = {
  version: 25,
  name: 'clinic_opening_balance',
  statements: [
    // ALTER TABLE ... ADD COLUMN in SQLite cannot add a column with a CHECK
    // constraint that references the column in some versions, and the browser
    // build (sql.js) is stricter than the desktop build about it. The
    // application code validates both values, so the CHECK is dropped here and
    // kept only in the CREATE TABLE for fresh databases (migration 001).
    `ALTER TABLE labs ADD COLUMN opening_balance REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE labs ADD COLUMN opening_balance_type TEXT NOT NULL DEFAULT 'debit'`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '25')`,
  ],
};

// ---------------------------------------------------------------- 026 - RBAC roles
export const MIGRATION_026_RBAC_ROLES: Migration = {
  version: 26,
  name: 'rbac_roles',
  rebuildsTable: true,
  statements: [
    `CREATE TABLE users_v26 (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('Super Admin','Clinic Entry Manager','Audit Checker')),
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      avatar TEXT,
      is_super_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_super_admin IN (0,1)),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT,
      is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0,1))
    )`,

    `INSERT INTO users_v26
       (id, username, email, name, role, password_hash, password_salt, avatar,
        is_super_admin, is_active, created_at, updated_at, is_hidden)
     SELECT id, username, email, name, 'Super Admin',
            password_hash, password_salt, avatar,
            is_super_admin, is_active, created_at, updated_at, COALESCE(is_hidden, 0)
     FROM users`,

    `DROP TABLE users`,
    `ALTER TABLE users_v26 RENAME TO users`,

    `CREATE TABLE user_clinics (
      user_id TEXT NOT NULL,
      lab_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, lab_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE
    )`,

    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '26')`,
  ],
};

// ---------------------------------------------------------------- 027 - per-user permissions (RBAC v3)
export const MIGRATION_027_USER_PERMISSIONS: Migration = {
  version: 27,
  name: 'user_permissions',
  statements: [
    `CREATE TABLE user_permissions (
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      granted INTEGER NOT NULL DEFAULT 1 CHECK (granted IN (0,1)),
      PRIMARY KEY (user_id, action),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '27')`,
  ],
};

// ---------------------------------------------------------------- 028 - custom roles
/**
 * RBAC v4: roles become data. Three built-ins ship as is_system rows (their
 * baselines stay defined in code and are merged over any rows on load); the
 * Super Admin can add more in Settings -> Users, each carrying its own
 * baseline tick set (permissions JSON). The users.role CHECK constraint from
 * migration 026 is dropped by rebuilding the table without it, so custom role
 * names can be referenced. Baseline decisive for lint: app code validates
 * non-empty role names.
 */
export const MIGRATION_028_CUSTOM_ROLES: Migration = {
  version: 28,
  name: 'custom_roles',
  rebuildsTable: true,
  statements: [
    `CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      description TEXT,
      permissions TEXT NOT NULL DEFAULT '[]',
      is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
      created_at TEXT NOT NULL
    )`,

    `INSERT INTO roles (id, name, description, permissions, is_system, created_at)
     VALUES ('role-super', 'Super Admin', 'Built-in: everything including the destructive set.', '[]', 1, datetime('now'))`,
    `INSERT INTO roles (id, name, description, permissions, is_system, created_at)
     VALUES ('role-entry', 'Clinic Entry Manager', 'Built-in: daily entry bundle (cases, payments, deposits, notifications).', '[]', 1, datetime('now'))`,
    `INSERT INTO roles (id, name, description, permissions, is_system, created_at)
     VALUES ('role-audit', 'Audit Checker', 'Built-in: strictly read-only across views, reports and the audit trail.', '[]', 1, datetime('now'))`,

    `CREATE TABLE users_v28 (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      avatar TEXT,
      is_super_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_super_admin IN (0,1)),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT,
      is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0,1))
    )`,

    `INSERT INTO users_v28
       (id, username, email, name, role, password_hash, password_salt, avatar,
        is_super_admin, is_active, created_at, updated_at, is_hidden)
     SELECT id, username, email, name, role,
            password_hash, password_salt, avatar,
            is_super_admin, is_active, created_at, updated_at, COALESCE(is_hidden, 0)
     FROM users`,

    `DROP TABLE users`,
    `ALTER TABLE users_v28 RENAME TO users`,

    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '28')`,
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
  MIGRATION_010_CATALOG_DETAIL,
  MIGRATION_011_CASE_ARCHIVE,
  MIGRATION_012_INVOICE_JOURNALS,
  MIGRATION_013_JOURNAL_CASE_REFS,
  MIGRATION_014_USER_PREFERENCES,
  MIGRATION_015_CASE_DEPARTMENT,
  MIGRATION_016_PAYMENT_ATTACHMENT_OWNER,
  MIGRATION_017_DROP_UNUSED_INDEXES,
  MIGRATION_018_DOC_SEQUENCES,
  MIGRATION_019_CASE_RECEIVED_DATE,
  MIGRATION_020_BARE_DOCTOR_NAME,
  MIGRATION_021_CATALOG_NEEDS_TEETH,
  MIGRATION_022_DROP_LEDGER_ENTRIES,
  MIGRATION_023_CATALOG_CATEGORIES,
  MIGRATION_024_REMOVE_REVERSAL,
  MIGRATION_025_CLINIC_OPENING_BALANCE,
  MIGRATION_026_RBAC_ROLES,
  MIGRATION_027_USER_PERMISSIONS,
  MIGRATION_028_CUSTOM_ROLES,
];

/**
 * The migration ledger itself. Created by the engine before it replays
 * MIGRATIONS (see `SqliteEngine.migrate`), and by the export script, so a dump
 * restores as a database that already knows which migrations ran.
 */
export const SCHEMA_MIGRATIONS_DDL =
  'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)';

/**
 * The whole schema as one ordered SQL script, straight from MIGRATIONS.
 *
 * This is the ONLY correct way to produce a schema for an export. The .sql
 * dump used to carry its own hand-maintained DDL string, which had already
 * drifted — it predated `payment_attachments.owner_type` (migration 016) and
 * 30-odd other tables, so a dump taken from Settings > Database & Backup was
 * NOT the schema the app actually runs on. Replaying MIGRATIONS cannot drift:
 * a new migration ships and the export picks it up automatically.
 *
 * Data backfills inside migrations are included on purpose; they are written
 * to be no-ops against an empty database (INSERT…SELECT guarded by NOT EXISTS,
 * INSERT OR REPLACE into app_meta), and replaying them keeps the dumped
 * `schema_version` in step with the live app.
 */
export function schemaScript(): string {
  const body = MIGRATIONS.map(
    (m) => `-- ── migration ${m.version}: ${m.name} ──\n${m.statements.map((s) => `${s.trim().replace(/;+$/, '')};`).join('\n')}`,
  ).join('\n\n');
  return `-- ── migration ledger ──\n${SCHEMA_MIGRATIONS_DDL};\n\n${body}`;
}
