import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { syncCollectionsToDb } from '../../src/db/syncCore';
import { nextNumberStandalone, peekNumber } from '../../src/db/sequences';
import { generateSqliteExport } from '../../src/services/sqliteStorage';

/**
 * The `.sql` dump must be a *portable copy of the clinic's data*, not a summary
 * of it.
 *
 * It used to be assembled from an in-memory React snapshot: 11 of the 45 tables,
 * a hand-written subset of their columns, and no `schema_migrations` rows at
 * all. So a dump silently dropped case teeth, QC inspections, notes, vouchers,
 * reconciliation rows, ledger entries, per-user preferences and every reversal
 * flag on money documents — and importing it into the app tried to replay
 * migration 1 against tables that already existed.
 *
 * This test is the proof that the export is now a faithful copy: it dumps a
 * database populated through the app's own writer, replays the script into a
 * brand-new SQLite file the way `sqlite3 clinic.sqlite < dump.sql` would, and
 * compares EVERY table and EVERY column cell-for-cell. Then it boots the app on
 * the imported file to show a clean machine comes up without re-running a single
 * migration and carries on issuing document numbers where the source stopped.
 *
 * A value with backslashes, both quote characters and a newline is planted in
 * the fixture on purpose: the previous escaping doubled every backslash (`\\`
 * -> `\\\\`), corrupting Windows paths and any free text that contained one.
 */

/** Backslash + single quote + double quote + newline: everything that can break a literal. */
const TRICKY = 'C:\\Lab\\shared\\"O\'Brien\'s" report\nline 2';

const T = {
  now: '2026-10-06T09:00:00.000Z',
  day: '2026-10-06',
};

// ---------------------------------------------------------------- the fixture

/** A clinic database with every synced table populated, plus the tables the sync does not own. */
async function buildSourceDatabase(SQL: any): Promise<{ engine: SqliteEngine; issuedCases: string[] }> {
  const eng = await SqliteEngine.create(SQL, null);
  eng.migrate();
  setDatabase(eng);

  // Users are deliberately NOT part of the collection sync (credentials go
  // through usersRepo with async hashing), so they are written directly.
  eng.run(
    `INSERT INTO users (id, username, email, name, role, password_hash, password_salt, avatar, is_super_admin, is_active, created_at, updated_at, is_hidden)
     VALUES ('u1', 'labadmin', 'labadmin@localhost', 'Lab Admin', 'Lab Admin', 'pbkdf2$deadbeef', 'c0ffee', NULL, 0, 1, ?, ?, 0)`,
    [T.now, T.now],
  );
  eng.run(
    `INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ('tok-1', 'u1', ?, '2027-01-01T00:00:00.000Z')`,
    [T.now],
  );

  // Consume three case numbers and one invoice number. The absolute starting
  // value is not asserted here — the round-trip proof compares the imported
  // counter against the source's own, so it holds whatever the series starts at.
  const issuedCases = [
    nextNumberStandalone('case', 'DS'),
    nextNumberStandalone('case', 'DS'),
    nextNumberStandalone('case', 'DS'),
  ];
  nextNumberStandalone('invoice', 'INV');

  const collections = {
    users: [],
    labs: [
      {
        id: 'lab-1',
        name: 'Bright Smiles Clinic',
        code: 'BS-01',
        contact_person: "Dr. O'Brien",
        phone: '+92-300-1234567',
        email: 'front@brightsmiles.example',
        address: TRICKY, // backslashes + quotes + newline
        city: 'Lahore',
        doctor_name: "Dr. O'Brien",
        notes: TRICKY,
        rating: 4.5,
        reviews_count: 2,
        created_at: T.now,
      },
    ],
    caseTypes: [
      {
        id: 'ct-1', name: 'Zirconia Crown', base_price: 12000, category: 'crown_bridge',
        lead_time_days: 5, warranty_months: 24, description: 'Monolithic zirconia', created_at: T.now,
      },
    ],
    cases: [
      {
        id: 'case-1',
        case_number: 'DS-0001',
        patient_name: 'Ayesha Khan',
        lab_id: 'lab-1',
        lab_name: 'Bright Smiles Clinic',
        case_type_id: 'ct-1',
        case_type_name: 'Zirconia Crown',
        units_count: 2,
        doctor_name: "Dr. O'Brien",
        selected_teeth: [16, 17],
        tooth_details: { 16: { shade: 'A2', prep_type: 'shoulder', material: 'zirconia' } },
        shade: 'A2',
        material: 'zirconia',
        delivery_date: '2026-10-12',
        priority: 'high',
        price: 24000,
        discount: 1000,
        final_price: 23000,
        instructions: 'Do not reduce the mesial wall',
        photo_url: null,
        status: 'in_progress',
        department: 'Ceramics',
        archived_at: null,
        created_at: T.now,
        updated_at: T.now,
        history: [
          { id: 'h1', status: 'received', notes: 'Cast received', timestamp: T.now, updated_by: 'Lab Admin' },
          { id: 'h2', status: 'in_progress', notes: 'On the bench', timestamp: T.now, updated_by: 'Lab Admin' },
        ],
      },
      {
        id: 'case-2',
        case_number: 'DS-0002',
        patient_name: 'Bilal Ahmed',
        lab_id: 'lab-1',
        lab_name: 'Bright Smiles Clinic',
        case_type_id: 'ct-1',
        case_type_name: 'Zirconia Crown',
        units_count: 1,
        doctor_name: "Dr. O'Brien",
        selected_teeth: [21],
        tooth_details: {},
        shade: 'B1',
        material: 'zirconia',
        delivery_date: '2026-10-20',
        priority: 'normal',
        price: 12000,
        discount: 0,
        final_price: 12000,
        instructions: null,
        photo_url: null,
        status: 'received',
        department: null,
        created_at: T.now,
        updated_at: T.now,
        history: [{ id: 'h3', status: 'received', notes: null, timestamp: T.now, updated_by: 'Lab Admin' }],
      },
    ],
    caseNotes: {
      'case-1': [
        { id: 'n1', note_text: 'Shade verified with the clinician', author: 'Lab Admin', created_at: T.now },
      ],
    },
    caseAttachments: {
      'case-1': [
        {
          id: 'att-1', filename: 'scan.stl', file_type: 'model/stl', file_size: '2.34 MB',
          size_bytes: 2453668, checksum: 'sha256:abc123', description: 'Intraoral scan',
          file_url: 'blob:scan', uploaded_at: T.now, uploaded_by: 'Lab Admin',
        },
      ],
    },
    invoices: [
      {
        id: 'inv-1',
        invoice_number: 'INV-0001',
        case_id: 'case-1',
        case_number: 'DS-0001',
        lab_id: 'lab-1',
        lab_name: 'Bright Smiles Clinic',
        case_type_id: 'ct-1',
        case_type_name: 'Zirconia Crown',
        doctor_name: "Dr. O'Brien",
        patient_name: 'Ayesha Khan',
        amount: 23000,
        discount: 1000,
        final_amount: 23000,
        amount_paid: 13000,
        payment_status: 'partial',
        status_v2: 'partially_paid',
        issue_date: T.day,
        due_date: '2026-10-31',
        credit_notes_total: 0,
        created_at: T.now,
        payments: [
          {
            id: 'pay-1', payment_number: 'PAY-0001', receipt_number: 'REC-0001',
            amount: 13000, payment_method: 'bank', payment_date: T.day,
            reference_number: 'TRX-8891', notes: 'Bank transfer', recorded_by: 'Lab Admin',
            payment_type: 'invoice_payment', status: 'posted', unapplied_amount: 0,
            is_reversed: 1, reversal_reason: 'Cheque bounced', reversed_at: T.now, reversed_by: 'Lab Admin',
            case_id: 'case-1', case_number: 'DS-0001', lab_id: 'lab-1', lab_name: 'Bright Smiles Clinic',
            created_at: T.now,
            attachments: [
              { id: 'pa-1', file_name: 'slip.pdf', file_type: 'application/pdf', file_size: '180 KB', file_url: 'blob:slip', uploaded_at: T.now, uploaded_by: 'Lab Admin' },
            ],
          },
        ],
      },
      {
        id: 'inv-2',
        invoice_number: 'INV-0002',
        case_id: 'case-2',
        case_number: 'DS-0002',
        lab_id: 'lab-1',
        lab_name: 'Bright Smiles Clinic',
        case_type_id: 'ct-1',
        case_type_name: 'Zirconia Crown',
        doctor_name: "Dr. O'Brien",
        amount: 12000,
        discount: 0,
        final_amount: 12000,
        amount_paid: 0,
        payment_status: 'unpaid',
        status_v2: 'open',
        due_date: '2026-10-31',
        created_at: T.now,
        payments: [],
      },
    ],
    advancePayments: [
      {
        id: 'adv-1', payment_number: 'ADV-0001', receipt_number: 'ADVR-1', lab_id: 'lab-1',
        lab_name: 'Bright Smiles Clinic', amount: 20000, allocated_amount: 8000, remaining_amount: 12000,
        payment_method: 'bank', payment_date: T.day, reference_number: 'ADV-TRX', notes: 'Prepayment',
        recorded_by: 'Lab Admin', status: 'partially_allocated', is_reversed: 0,
        created_at: T.now,
        allocations: [
          { id: 'aa-1', invoice_id: 'inv-2', amount: 8000, allocated_at: T.now, allocated_by: 'Lab Admin', notes: 'Applied to INV-0002' },
        ],
        attachments: [
          { id: 'pa-2', file_name: 'advance.pdf', file_type: 'application/pdf', file_size: '90 KB', file_url: 'blob:adv', uploaded_at: T.now, uploaded_by: 'Lab Admin' },
        ],
      },
    ],
    accountAdjustments: [
      {
        id: 'adj-1', adjustment_number: 'CR-0001', credit_note_number: 'CN-77', lab_id: 'lab-1',
        lab_name: 'Bright Smiles Clinic', type: 'credit_note', amount: 500, reason: 'Goodwill',
        date: T.day, reference_number: 'CN-REF', invoice_id: 'inv-1', invoice_number: 'INV-0001',
        notes: 'Agreed with the clinic', recorded_by: 'Lab Admin', approved_by: 'Lab Admin',
        status: 'posted', is_reversed: 0, created_at: T.now,
        attachments: [
          { id: 'pa-3', file_name: 'note.txt', file_type: 'text/plain', file_size: '1 KB', file_url: 'blob:note', uploaded_at: T.now, uploaded_by: 'Lab Admin' },
        ],
      },
    ],
    journalEntries: [
      {
        id: 'je-1', journal_number: 'JE-0001', date: T.day, event_type: 'invoice_issued',
        reference_type: 'invoice', reference_id: 'inv-1', reference_number: 'INV-0001',
        case_id: 'case-1', case_number: 'DS-0001', lab_id: 'lab-1', lab_name: 'Bright Smiles Clinic',
        description: 'Invoice issued for DS-0001', created_at: T.now, created_by: 'Lab Admin',
        lines: [
          { id: 'jl-1', account_code: '1100', account_name: 'Accounts Receivable', account_type: 'asset', debit: 23000, credit: 0, description: 'A/R', lab_name: 'Bright Smiles Clinic' },
          { id: 'jl-2', account_code: '4010', account_name: 'Prosthetics Revenue', account_type: 'revenue', debit: 0, credit: 23000, description: 'Revenue', lab_name: 'Bright Smiles Clinic' },
        ],
      },
    ],
    ledgerEntries: [],
    notifications: [
      { id: 'nt-1', type: 'pending_payment', title: 'Unpaid invoice', message: 'INV-0002 is unpaid', case_id: 'case-2', case_number: 'DS-0002', invoice_id: 'inv-2', lab_id: 'lab-1', is_read: false, is_archived: false, priority: 'high', link_url: null, created_at: T.now },
    ],
    auditEvents: [
      { id: 'ae-1', timestamp: T.now, actor: 'Lab Admin', action: 'case.updated', entity_type: 'case', entity_id: 'case-1', entity_ref: 'DS-0001', reason: 'status change', old_state: { status: 'received' }, new_state: { status: 'in_progress' }, notes: TRICKY },
    ],
    savedVouchers: [
      { id: 'v-1', voucher_number: 'JS-0001', voucher_type: 'job_slip', case_id: 'case-1', case_number: 'DS-0001', lab_name: 'Bright Smiles Clinic', doctor_name: "Dr. O'Brien", patient_name: 'Ayesha Khan', case_type_name: 'Zirconia Crown', amount: 23000, saved_by: 'Lab Admin', notes: null, created_at: T.now },
    ],
    reconciliationItems: [
      { id: 'r-1', payment_id: 'pay-1', reference_number: 'TRX-8891', method: 'bank', amount: 13000, date: T.day, lab_id: 'lab-1', lab_name: 'Bright Smiles Clinic', invoice_id: 'inv-1', invoice_number: 'INV-0001', status: 'exception', exception_reason: 'Amount mismatch', notes: 'Bounced', proof_url: 'blob:slip', verified_at: T.now, verified_by: 'Lab Admin', created_at: T.now },
    ],
    templates: [
      { id: 'tpl-1', template_name: 'Standard zirconia', case_type_id: 'ct-1', case_type_name: 'Zirconia Crown', description: 'Default workflow', selected_teeth: [16], shade: 'A2', instructions: 'Check occlusion', default_priority: 'normal', created_at: T.now },
    ],
    qcInspections: [
      { id: 'qc-1', case_id: 'case-1', case_number: 'DS-0001', inspection_no: 1, kind: 'inspection', result: 'fail', reason_code: 'margin', reason_text: 'Open margin on distal', checklist: '{"margin":"fail"}', inspector: 'Lab Admin', notes: 'Rework', supersedes_id: null, dedupe_key: 'qc-key-1', created_at: T.now },
    ],
    labContacts: [
      { id: 'lc-1', lab_id: 'lab-1', name: 'Sana Iqbal', phone: '+92-300-7654321', email: 'sana@brightsmiles.example', role: 'Front desk', notes: null, is_primary: true, created_at: T.now },
    ],
    labAddresses: [
      { id: 'la-1', lab_id: 'lab-1', type: 'shipping', street: '12-C Gulberg', city: 'Lahore', state: 'Punjab', postal_code: '54000', country: 'PK', is_default: true, created_at: T.now },
    ],
    pricingOverrides: [
      { id: 'po-1', lab_id: 'lab-1', case_type_id: 'ct-1', case_type_name: 'Zirconia Crown', standard_price: 12000, custom_price: 11000, discount_percentage: 8.3, effective_date: T.day, created_at: T.now },
    ],
    labReviews: [
      { id: 'lr-1', lab_id: 'lab-1', rating: 4, review_text: 'Good turnarounds', reviewer_name: 'Dr. O\'Brien', case_number: 'DS-0001', created_at: T.now },
    ],
    doctorPreferences: [
      { id: 'dp-1', doctor_name: "Dr. O'Brien", lab_id: 'lab-1', lab_name: 'Bright Smiles Clinic', created_at: T.now },
    ],
  };

  // syncCollectionsToDb is debounced (150ms) — flush the timer synchronously.
  vi.useFakeTimers();
  syncCollectionsToDb(collections as any);
  vi.advanceTimersByTime(150);
  vi.useRealTimers();

  // ── tables the collection sync does not own ──
  eng.run(
    `INSERT INTO settings (namespace, key, value, updated_at) VALUES ('branding', 'settings', ?, ?)`,
    [JSON.stringify({ appName: 'Round Trip Dental', address: TRICKY }), T.now],
  );
  eng.run(
    `INSERT INTO user_preferences (user_id, value, updated_at) VALUES ('u1', ?, ?)`,
    [JSON.stringify({ zoom: 1.1, tableDensity: 'compact' }), T.now],
  );
  eng.run(
    `INSERT INTO notification_config (id, config_json, updated_at) VALUES (1, ?, ?)`,
    [JSON.stringify({ overdueCases: true }), T.now],
  );
  eng.run(
    `INSERT INTO email_templates (id, key, name, subject, body_text, button_text, logo_url, color_scheme, footer_text, updated_at)
     VALUES ('et-1', 'invoice_sent', 'Invoice sent', 'Your invoice', 'Body text', 'View', NULL, '#4f46e5', 'Regards', ?)`,
    [T.now],
  );
  eng.run(
    `INSERT INTO print_templates (id, kind, name, sections, created_at) VALUES ('pt-1', 'invoice', 'Default invoice', ?, ?)`,
    [JSON.stringify([{ type: 'header' }]), T.now],
  );
  eng.run(
    `INSERT INTO ledger_entries (id, date, lab_id, lab_name, entry_type, reference_id, reference_number, case_number, doctor_name, description, debit, credit, running_balance, payment_method, notes, recorded_by, journal_id, created_at)
     VALUES ('le-1', ?, 'lab-1', 'Bright Smiles Clinic', 'invoice', 'inv-1', 'INV-0001', 'DS-0001', 'Dr. O''Brien', 'Invoice issued', 23000, 0, 23000, 'bank', ?, 'Lab Admin', 'je-1', ?)`,
    [T.day, TRICKY, T.now],
  );
  eng.run(
    `INSERT INTO payment_allocations (id, source_type, source_id, source_ref, invoice_id, invoice_number, amount, allocated_at, allocated_by, notes)
     VALUES ('pal-1', 'payment', 'pay-1', 'REC-0001', 'inv-1', 'INV-0001', 13000, ?, 'Lab Admin', NULL)`,
    [T.now],
  );
  eng.run(
    `INSERT INTO legacy_backup (table_name, record_id, record_json, imported_at) VALUES ('cases', 'old-1', ?, ?)`,
    [JSON.stringify({ id: 'old-1', note: TRICKY }), T.now],
  );
  eng.run(
    `INSERT INTO shade_guides (id, name, system, shades) VALUES ('sg-1', 'VITA Classical', 'vita_classical', ?)`,
    [JSON.stringify(['A1', 'A2', 'B1'])],
  );
  eng.run(
    `INSERT INTO implant_brands (id, name, country, popular_models, is_active) VALUES ('ib-1', 'Straumann', 'CH', 'BLX', 1)`,
  );
  eng.run(
    `INSERT INTO clinical_materials (id, name, category, description, is_active, price_modifier) VALUES ('cm-1', 'Zirconia blank', 'ceramic', 'Multilayer', 1, 1.15)`,
  );
  eng.run(
    `INSERT INTO clinical_prep_types (id, name, code, description, is_active) VALUES ('cp-1', 'Shoulder', 'SH', '0.8mm shoulder', 1)`,
  );
  eng.run(
    `INSERT INTO chairside_appointments (id, time, period, patient, doctor, clinic, procedure, tooth, shade, status, case_ref, created_at)
     VALUES ('ca-1', '10:30', 'AM', 'Ayesha Khan', 'Dr. O''Brien', 'Bright Smiles Clinic', 'Crown prep', '16', 'A2', 'confirmed', 'DS-0001', ?)`,
    [T.now],
  );

  return { engine: eng, issuedCases };
}

// ------------------------------------------------------------- comparison kit

/** Every table, every column, every cell — as comparable strings. */
function snapshot(db: any): { tables: string[]; columns: Record<string, string[]>; rows: Record<string, string[][]> } {
  const names: string[] = db
    .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")[0]
    .values.map((v: any[]) => String(v[0]));
  const columns: Record<string, string[]> = {};
  const rowsOut: Record<string, string[][]> = {};
  for (const t of names) {
    const info = db.exec(`PRAGMA table_info("${t}")`)[0].values.map((v: any[]) => String(v[1]));
    columns[t] = info;
    const res = db.exec(`SELECT * FROM "${t}"`);
    rowsOut[t] = res.length
      ? (res[0].values as any[][]).map((row) => row.map(cell))
      : [];
  }
  return { tables: names, columns, rows: rowsOut };
}

/** Storage-class-aware so an INTEGER that comes back as TEXT cannot hide. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Uint8Array) {
    let hex = '';
    for (const b of v) hex += b.toString(16).padStart(2, '0');
    return `BLOB:${hex}`;
  }
  if (typeof v === 'number') return `NUM:${v}`;
  return `TEXT:${String(v)}`;
}

/** Tables the fixture is expected to leave with rows — guards a vacuous comparison. */
const POPULATED = [
  'users', 'sessions', 'labs', 'lab_contacts', 'lab_addresses', 'lab_pricing_overrides', 'lab_reviews',
  'doctor_preferred_labs', 'case_types', 'cases', 'case_teeth', 'case_status_history', 'case_notes',
  'case_templates', 'invoices', 'payments', 'payment_attachments', 'payment_allocations',
  'advance_payments', 'advance_allocations', 'account_adjustments', 'journal_entries', 'journal_lines',
  'reconciliation_items', 'saved_vouchers', 'audit_events', 'notifications', 'attachments',
  'qc_inspections', 'settings', 'user_preferences', 'notification_config', 'email_templates',
  'print_templates', 'ledger_entries', 'legacy_backup', 'shade_guides', 'implant_brands',
  'clinical_materials', 'clinical_prep_types', 'chairside_appointments', 'doc_sequences', 'schema_migrations',
];

// ----------------------------------------------------------------- the drill

let SQL: any;
let source: SqliteEngine;
let sourceSnap: ReturnType<typeof snapshot>;
let script: string;
let importedDb: any;
let importedBytes: Uint8Array;
let importedSnap: ReturnType<typeof snapshot>;
let issuedCases: string[];
/** What the source would issue next, and its raw counter — the values the import must match. */
let sourcePeek: string;
let sourceCounter: number;

beforeAll(async () => {
  SQL = await initSqlJs();
  const built = await buildSourceDatabase(SQL);
  source = built.engine;
  issuedCases = built.issuedCases;
  sourcePeek = peekNumber('case', 'DS');
  sourceCounter = Number(
    source.get<{ next_value: number }>("SELECT next_value FROM doc_sequences WHERE seq_key = 'case'")?.next_value,
  );
  sourceSnap = snapshot(new SQL.Database(source.export()));

  script = generateSqliteExport({ labName: 'Round Trip Dental', generatedAt: '2026-10-06T12:00:00.000Z' });

  // A clean machine: brand-new empty file, with foreign keys enforced, exactly
  // as the app opens a database.
  importedDb = new SQL.Database(null);
  importedDb.run('PRAGMA foreign_keys = ON');
  importedDb.run(script);
  importedBytes = importedDb.export();
  importedSnap = snapshot(importedDb);
}, 120_000);

afterAll(() => {
  importedDb?.close();
  setDatabase(null);
});

describe('sql dump round trip', () => {
  it('populates the fixture across the whole schema', () => {
    const empty = POPULATED.filter((t) => (sourceSnap.rows[t] ?? []).length === 0);
    expect(empty).toEqual([]);
    expect(sourceSnap.tables.length).toBeGreaterThan(40);
  });

  it('is shaped like sqlite .dump output', () => {
    expect(script.indexOf('PRAGMA foreign_keys = OFF;')).toBeLessThan(script.indexOf('BEGIN TRANSACTION;'));
    expect(script.indexOf('BEGIN TRANSACTION;')).toBeLessThan(script.indexOf('COMMIT;'));
    expect(script).toContain('-- SCHEMA — replayed from MIGRATIONS');
    expect(script).toContain('-- DATA — every table, every column');
    // Both halves of "identical": the ledger AND the counters travel.
    expect(script).toContain('INSERT OR REPLACE INTO "schema_migrations"');
    expect(script).toContain('INSERT OR REPLACE INTO "doc_sequences"');
  });

  it('imports cleanly with integrity and foreign keys intact', () => {
    expect(importedDb.exec('PRAGMA integrity_check')[0].values[0][0]).toBe('ok');
    const fk = importedDb.exec('PRAGMA foreign_key_check');
    expect(fk.length ? fk[0].values : []).toEqual([]);
  });

  it('carries identical business data for every table and column', () => {
    expect(importedSnap.tables).toEqual(sourceSnap.tables);
    expect(importedSnap.columns).toEqual(sourceSnap.columns);
    // One assertion over all 45 tables: any missing table, column or changed cell fails.
    expect(importedSnap.rows).toEqual(sourceSnap.rows);
  });

  it('preserves the columns the old hand-written dump never wrote', () => {
    const cellOf = (table: string, id: string, column: string) => {
      const idx = sourceSnap.columns[table].indexOf(column);
      expect(idx).toBeGreaterThanOrEqual(0);
      return importedSnap.rows[table].find((row) => row[sourceSnap.columns[table].indexOf('id')] === `TEXT:${id}`)?.[idx];
    };
    // Reversal state on money documents (audit F6) — the whole point of a backup.
    expect(cellOf('payments', 'pay-1', 'is_reversed')).toBe('NUM:1');
    expect(cellOf('payments', 'pay-1', 'reversal_reason')).toBe('TEXT:Cheque bounced');
    expect(cellOf('payments', 'pay-1', 'reversed_by')).toBe('TEXT:Lab Admin');
    // Child rows that used to be dropped entirely. `case_teeth` has no `id`
    // column — its key is (case_id, tooth_number) — so it is checked directly.
    const toothCol = sourceSnap.columns.case_teeth.indexOf('tooth_number');
    expect(toothCol).toBeGreaterThanOrEqual(0);
    expect(importedSnap.rows.case_teeth.map((row) => row[toothCol]).sort()).toEqual([
      'NUM:16',
      'NUM:17',
      'NUM:21',
    ]);
    expect(importedSnap.rows.journal_lines).toHaveLength(2);
    expect(importedSnap.rows.payment_attachments).toHaveLength(3);
    expect(importedSnap.rows.qc_inspections).toHaveLength(1);
    expect(importedSnap.rows.reconciliation_items).toHaveLength(1);
    expect(importedSnap.rows.saved_vouchers).toHaveLength(1);
    expect(importedSnap.rows.attachments).toHaveLength(1);
    expect(importedSnap.rows.ledger_entries).toHaveLength(1);
    // ...and the preferences the app needs to look the same on the new machine.
    expect(importedSnap.rows.user_preferences).toHaveLength(1);
    expect(importedSnap.rows.settings).toHaveLength(1);
  });

  it('round-trips values containing backslashes, quotes and newlines', () => {
    const col = sourceSnap.columns.labs.indexOf('address');
    const importedAddress = importedSnap.rows.labs[0][col];
    expect(importedAddress).toBe(`TEXT:${TRICKY}`);
    expect(importedAddress).toContain('\\Lab\\shared\\');
    expect(importedAddress).not.toContain('\\\\Lab');
    expect(importedAddress).toContain("O'Brien's");
    expect(importedAddress).toContain('\n');
  });

  it('boots on a clean machine without replaying a single migration', async () => {
    const booted = await SqliteEngine.create(SQL, importedBytes);
    const result = booted.migrate();
    // Every migration already recorded, so nothing re-runs. Before this fix the
    // dump had no schema_migrations rows at all: migration 1 would try to
    // CREATE TABLE cases on a database that already had it, and boot failed.
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(booted.scalar("SELECT value FROM app_meta WHERE key = 'schema_version'")).toBe('20');
    booted.close();
  });

  it('continues document numbering where the source left off', async () => {
    // The counter table is what a dump without `doc_sequences` (or without its
    // rows) silently restarts — reissuing numbers against documents that
    // already exist. Asserted against the source's own next value rather than a
    // hardcoded string, so this holds regardless of where the series starts.
    expect(new Set(issuedCases).size).toBe(3);

    const restored = await SqliteEngine.create(SQL, importedBytes);
    setDatabase(restored);

    const counter = restored.get<{ next_value: number }>(
      "SELECT next_value FROM doc_sequences WHERE seq_key = 'case'",
    );
    expect(Number(counter?.next_value)).toBe(sourceCounter);
    expect(peekNumber('case', 'DS')).toBe(sourcePeek);

    const next = nextNumberStandalone('case', 'DS');
    expect(next).toBe(sourcePeek);
    expect(issuedCases).not.toContain(next);
    expect(peekNumber('case', 'DS')).not.toBe(sourcePeek);

    // And the restored database is writable, not a frozen copy.
    restored.run(
      "INSERT INTO case_notes (id, case_id, note_text, author, created_at) VALUES ('n-restored', 'case-1', 'written after import', 'Lab Admin', ?)",
      [T.now],
    );
    expect(restored.rowCount('case_notes')).toBe(2);
  });

  it('emits schema only, and says so, when the database is not initialised', () => {
    setDatabase(null);
    const schemaOnly = generateSqliteExport();
    expect(schemaOnly).toContain('WARNING: THE DATABASE WAS NOT INITIALISED — SCHEMA ONLY, NO DATA.');
    expect(schemaOnly).not.toContain('INSERT OR REPLACE INTO "cases"');
    expect(schemaOnly).toContain('-- (no rows)');
    // The schema is still complete, so the file remains inspectable.
    expect(schemaOnly).toContain('CREATE TABLE cases');
  });
});
