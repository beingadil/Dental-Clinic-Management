import { getDatabase } from './index';
import { appMetaRepo, usersRepo, labsRepo, caseTypesRepo, casesRepo, invoicesRepo, advancePaymentsRepo, adjustmentsRepo, journalRepo, notificationsRepo, settingsRepo, notificationConfigRepo, emailTemplatesRepo, clinicalSpecsRepo, chairsideRepo, auditRepo, caseNotesRepo, attachmentsRepo, vouchersRepo } from './repos';
import { ensureSequenceTable, ensureCounterAtLeast, SEQ_KEYS } from './sequences';
import { hashPassword } from './crypto';
import { DEFAULT_MATERIALS, DEFAULT_PREP_TYPES, DEFAULT_SHADE_GUIDES, DEFAULT_IMPLANT_BRANDS } from '../services/clinicalSpecsService';
import { DEFAULT_BRANDING_SETTINGS } from './defaults';

/**
 * Phase 3 — one-time migration of pre-existing browser localStorage records
 * into SQLite. Idempotent (guarded by app_meta.legacy_import_done) and
 * non-destructive: originals stay in localStorage until the user confirms
 * cleanup in Settings. Per-record problems are collected in a report and the
 * raw record is preserved in legacy_backup — nothing is silently dropped.
 */

export interface LegacyMigrationReport {
  ran: boolean;
  startedAt: string;
  finishedAt?: string;
  tables: Record<string, { imported: number; skipped: number; problems: string[] }>;
  warnings: string[];
}

let lastReport: LegacyMigrationReport | null = null;
export function getLastLegacyReport(): LegacyMigrationReport | null {
  return lastReport;
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw || raw === 'undefined' || raw === 'null') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readKey(key: string): any {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

class ReportBuilder {
  tables: LegacyMigrationReport['tables'] = {};
  warnings: string[] = [];
  current = '';
  counts = { imported: 0, skipped: 0, problems: [] as string[] };

  start(table: string) {
    this.flush();
    this.current = table;
    this.counts = { imported: 0, skipped: 0, problems: [] };
  }
  imported(n = 1) {
    this.counts.imported += n;
  }
  skip(reason: string, record?: any) {
    this.counts.skipped += 1;
    this.counts.problems.push(reason);
    if (record !== undefined) this.preserve(this.current, record, reason);
  }
  preserve(tableName: string, record: any, reason: string) {
    try {
      const id = String(record?.id ?? record?.case_number ?? record?.invoice_number ?? record?.payment_number ?? `unknown-${Math.random().toString(36).slice(2, 8)}`);
      getDatabase().run(
        `INSERT OR REPLACE INTO legacy_backup (table_name, record_id, record_json, imported_at) VALUES (?, ?, ?, ?)`,
        [tableName || 'unknown', id, JSON.stringify(record), new Date().toISOString()]
      );
    } catch {
      /* legacy_backup unavailable — report still records the problem */
    }
  }
  warn(message: string) {
    this.warnings.push(message);
  }
  flush() {
    if (this.current) {
      this.tables[this.current] = { ...this.counts };
    }
    this.current = '';
  }
  finish(): LegacyMigrationReport {
    this.flush();
    return {
      ran: true,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      tables: this.tables,
      warnings: this.warnings,
    };
  }
  private startedAt = new Date().toISOString();
}

function requireString(value: any, field: string, ctx: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${ctx}: missing required field "${field}"`);
  }
  return value;
}

/** Imports legacy plaintext credentials as properly hashed rows. */
async function importLegacyUser(u: any, report: ReportBuilder): Promise<void> {
  try {
    const username = requireString(u.username, 'username', `user ${u.id}`);
    const email = typeof u.email === 'string' && u.email.includes('@')
      ? u.email
      : `${username}@dentalsolutions.pk`;
    if (usersRepo.byUsername(username)) {
      report.skip(`duplicate username ${username}`);
      return;
    }
    const hash = await hashPassword(String(u.password ?? 'changeme123'));
    usersRepo.insert({
      id: String(u.id),
      username,
      email,
      name: requireString(u.name, 'name', `user ${username}`),
      role: ['Super Admin', 'Lab Admin', 'Technician', 'Billing Manager'].includes(u.role) ? u.role : 'Technician',
      password_hash: hash,
      password_salt: hash.split('$')[2] ?? '',
      is_super_admin: u.isSuperAdmin || u.role === 'Super Admin' ? 1 : 0,
      created_at: u.created_at,
    });
    report.imported();
  } catch (err: any) {
    report.skip(err?.message || 'invalid user record', u);
  }
}

function importLegacyCase(c: any, report: ReportBuilder): void {
  try {
    if (casesRepo.byCaseNumber(String(c.case_number))) {
      report.skip(`duplicate case_number ${c.case_number}`);
      return;
    }
    requireString(c.case_number, 'case_number', `case ${c.id}`);
    requireString(c.lab_id, 'lab_id', `case ${c.id}`);
    requireString(c.delivery_date, 'delivery_date', `case ${c.case_number}`);
    casesRepo.insert({
      ...c,
      id: String(c.id),
      case_number: String(c.case_number),
      selected_teeth: Array.isArray(c.selected_teeth) ? c.selected_teeth : [],
      tooth_details: c.tooth_details && typeof c.tooth_details === 'object' ? c.tooth_details : undefined,
      status: ['draft', 'received', 'in_progress', 'qc', 'ready', 'delivered', 'revision', 'cancelled'].includes(c.status) ? c.status : 'received',
      history: Array.isArray(c.history) ? c.history : [],
    });
    // notes / attachments from Record maps
    report.imported();
  } catch (err: any) {
    report.skip(err?.message || 'invalid case record', c);
  }
}

function importLegacyInvoice(inv: any, report: ReportBuilder): void {
  try {
    if (invoicesRepo.byInvoiceNumber(String(inv.invoice_number))) {
      report.skip(`duplicate invoice_number ${inv.invoice_number}`);
      return;
    }
    requireString(inv.invoice_number, 'invoice_number', `invoice ${inv.id}`);
    requireString(inv.lab_id, 'lab_id', `invoice ${inv.id}`);
    invoicesRepo.insert({
      ...inv,
      id: String(inv.id),
      invoice_number: String(inv.invoice_number),
      amount: Number(inv.amount) || 0,
      discount: Number(inv.discount) || 0,
      final_amount: Number(inv.final_amount ?? inv.amount) || 0,
      amount_paid: Number(inv.amount_paid) || 0,
      payment_status: ['unpaid', 'partial', 'paid'].includes(inv.payment_status) ? inv.payment_status : 'unpaid',
      due_date: inv.due_date ?? null,
      payments: [], // embedded legacy payments are imported as standalone rows below
    });
    report.imported();
    return;
  } catch (err: any) {
    report.skip(err?.message || 'invalid invoice record', inv);
  }
}

/**
 * Runs the legacy import exactly once per browser profile.
 * Returns the report (also retrievable via getLastLegacyReport).
 */
export async function runLegacyMigration(): Promise<LegacyMigrationReport> {
  lastReport = null;
  const report = new ReportBuilder();
  const db = getDatabase();
  ensureSequenceTable();

  const alreadyDone = appMetaRepo.get('legacy_import_done') === 'true';
  if (alreadyDone) {
    lastReport = {
      ran: false,
      startedAt: report.finish().startedAt,
      finishedAt: new Date().toISOString(),
      tables: {},
      warnings: ['Skipped — legacy import already completed for this profile.'],
    };
    return lastReport;
  }

  // ---------------- users (dsw_sqlite_users authoritative, then dsw_users) ----------------
  report.start('users');
  const legacyUsers = [
    ...safeParse<any[]>(readKey('dsw_sqlite_users'), []),
    ...safeParse<any[]>(readKey('dsw_users'), []),
  ];
  const seenUsernames = new Set<string>();
  for (const u of legacyUsers) {
    if (!u?.username || seenUsernames.has(String(u.username).toLowerCase())) continue;
    seenUsernames.add(String(u.username).toLowerCase());
    await importLegacyUser(u, report);
  }
  // No super-admin is fabricated here: a profile with no users provisions its
  // first administrator through the login screen's setup flow.

  // ---------------- labs ----------------
  report.start('labs');
  const legacyLabs = [...safeParse<any[]>(readKey('dsw_sqlite_labs'), []), ...safeParse<any[]>(readKey('dsw_labs'), [])];
  const seenLabs = new Set<string>();
  for (const l of legacyLabs) {
    if (!l?.name || seenLabs.has(String(l.name).toLowerCase()) || labsRepo.byName(String(l.name))) continue;
    seenLabs.add(String(l.name).toLowerCase());
    try {
      labsRepo.insert({ ...l, id: String(l.id), name: String(l.name) });
      report.imported();
    } catch (err: any) {
      report.skip(err?.message || 'invalid lab record', l);
    }
  }

  // ---------------- case types ----------------
  report.start('case_types');
  const legacyTypes = [...safeParse<any[]>(readKey('dsw_sqlite_case_types'), []), ...safeParse<any[]>(readKey('dsw_casetypes'), [])];
  const seenTypes = new Set<string>();
  for (const ct of legacyTypes) {
    if (!ct?.name || seenTypes.has(String(ct.name).toLowerCase())) continue;
    seenTypes.add(String(ct.name).toLowerCase());
    if (db.get('SELECT 1 FROM case_types WHERE name = ? COLLATE NOCASE', [String(ct.name)])) continue;
    try {
      caseTypesRepo.insert({ ...ct, id: String(ct.id), name: String(ct.name), base_price: Number(ct.base_price) || 0 });
      report.imported();
    } catch (err: any) {
      report.skip(err?.message || 'invalid case type', ct);
    }
  }

  // ---------------- cases ----------------
  report.start('cases');
  const legacyCases = [...safeParse<any[]>(readKey('dsw_sqlite_cases'), []), ...safeParse<any[]>(readKey('dsw_cases'), [])];
  const seenCases = new Set<string>();
  for (const c of legacyCases) {
    const num = c?.case_number ? String(c.case_number).toLowerCase() : null;
    if (!num || seenCases.has(num)) continue;
    seenCases.add(num);
    importLegacyCase(c, report);
  }

  // legacy case notes / attachments (Record maps keyed by case id)
  const legacyNoteMap = safeParse<Record<string, any[]>>(readKey('dsw_case_notes'), {});
  for (const [caseId, notes] of Object.entries(legacyNoteMap)) {
    if (!Array.isArray(notes)) continue;
    for (const n of notes) {
      try {
        caseNotesRepo.insert({ case_id: String(caseId), note_text: String(n.note_text ?? ''), author: String(n.author ?? 'Unknown'), created_at: n.created_at });
        report.imported();
      } catch {
        report.skip('invalid case note', n);
      }
    }
  }
  const legacyAttMap = safeParse<Record<string, any[]>>(readKey('dsw_case_attachments'), {});
  for (const [caseId, atts] of Object.entries(legacyAttMap)) {
    if (!Array.isArray(atts)) continue;
    for (const a of atts) {
      try {
        attachmentsRepo.insert({
          id: String(a.id),
          entity_type: 'case',
          entity_id: String(caseId),
          original_filename: String(a.filename ?? 'file'),
          stored_filename: String(a.filename ?? 'file'),
          mime_type: String(a.file_type ?? 'application/octet-stream'),
          size_bytes: null,
          checksum: null,
          description: a.file_size ? String(a.file_size) : null,
          storage_path: `legacy/${caseId}/${a.id}`,
          data_url: String(a.file_url ?? ''),
          uploaded_by: a.uploaded_by ?? null,
        });
        report.imported();
      } catch {
        report.skip('invalid case attachment', a);
      }
    }
  }

  // ---------------- invoices + embedded payments ----------------
  report.start('invoices');
  const legacyInvoices = [...safeParse<any[]>(readKey('dsw_sqlite_invoices'), []), ...safeParse<any[]>(readKey('dsw_invoices'), [])];
  const seenInvoices = new Set<string>();
  const embeddedPayments: any[] = [];
  for (const inv of legacyInvoices) {
    const num = inv?.invoice_number ? String(inv.invoice_number).toLowerCase() : null;
    if (!num || seenInvoices.has(num)) continue;
    seenInvoices.add(num);
    importLegacyInvoice(inv, report);
    if (Array.isArray(inv.payments)) {
      for (const p of inv.payments) embeddedPayments.push({ ...p, invoice_id: String(inv.id), invoice_number: inv.invoice_number, lab_id: inv.lab_id, lab_name: inv.lab_name });
    }
  }

  report.start('payments');
  const seenPayments = new Set<string>();
  for (const p of embeddedPayments) {
    const pid = p?.id ? String(p.id) : null;
    if (!pid || seenPayments.has(pid)) continue;
    seenPayments.add(pid);
    try {
      const amount = Number(p.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('payment amount must be > 0');
      getDatabase().withTransaction((tx) => {
        tx.run(
          `INSERT INTO payments (id, payment_number, receipt_number, invoice_id, invoice_number, case_id, case_number, lab_id, lab_name,
                                 amount, payment_method, payment_date, reference_number, notes, recorded_by, payment_type, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [pid, p.payment_number ?? null, p.receipt_number ?? null, String(p.invoice_id), p.invoice_number ?? null,
           p.case_id ?? null, p.case_number ?? null, p.lab_id ?? null, p.lab_name ?? null,
           amount, ['cash', 'bank', 'cheque', 'advance'].includes(p.payment_method) ? p.payment_method : 'cash',
           p.payment_date ?? p.created_at ?? new Date().toISOString(), p.reference_number ?? null, p.notes ?? null,
           p.recorded_by ?? 'Legacy Import', 'invoice_payment', 'posted', p.created_at ?? p.payment_date ?? new Date().toISOString()]
        );
        for (const att of p.attachments || []) {
          tx.run(
            `INSERT INTO payment_attachments (id, payment_id, filename, file_type, file_size, file_url, uploaded_at, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [att.id || `pa-${Math.random().toString(36).slice(2, 8)}`, pid, att.file_name ?? 'proof', att.file_type ?? 'application/octet-stream',
             att.file_size ?? null, att.file_url ?? '', att.uploaded_at ?? new Date().toISOString(), att.uploaded_by ?? null]
          );
        }
      });
      report.imported();
    } catch (err: any) {
      report.skip(err?.message || 'invalid payment record', p);
    }
  }

  // ---------------- advance payments ----------------
  report.start('advance_payments');
  const legacyAdvances = [...safeParse<any[]>(readKey('dsw_sqlite_advance_payments'), []), ...safeParse<any[]>(readKey('dsw_advance_payments'), [])];
  const seenAdv = new Set<string>();
  for (const a of legacyAdvances) {
    const key = a?.id ? String(a.id) : a?.payment_number ? String(a.payment_number) : null;
    if (!key || seenAdv.has(key)) continue;
    seenAdv.add(key);
    try {
      const amount = Number(a.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('advance amount must be > 0');
      requireString(a.lab_id, 'lab_id', `advance ${key}`);
      advancePaymentsRepo.insert({
        ...a,
        id: String(a.id),
        payment_number: String(a.payment_number ?? key),
        amount,
        allocated_amount: Number(a.allocated_amount) || 0,
        remaining_amount: Number(a.remaining_amount ?? amount) || 0,
        status: a.status ?? 'available',
      });
      report.imported();
    } catch (err: any) {
      report.skip(err?.message || 'invalid advance record', a);
    }
  }

  // ---------------- account adjustments ----------------
  report.start('account_adjustments');
  const legacyAdjustments = [...safeParse<any[]>(readKey('dsw_sqlite_adjustments'), []), ...safeParse<any[]>(readKey('dsw_account_adjustments'), [])];
  const seenAdj = new Set<string>();
  for (const a of legacyAdjustments) {
    const key = a?.id ? String(a.id) : a?.adjustment_number ? String(a.adjustment_number) : null;
    if (!key || seenAdj.has(key)) continue;
    seenAdj.add(key);
    try {
      const amount = Number(a.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('adjustment amount must be > 0');
      requireString(a.lab_id, 'lab_id', `adjustment ${key}`);
      requireString(a.reason, 'reason', `adjustment ${key}`);
      db.withTransaction((tx) => {
        tx.run(
          `INSERT INTO account_adjustments (id, adjustment_number, credit_note_number, lab_id, lab_name, type, amount, reason, date,
                                            reference_number, invoice_id, invoice_number, notes, recorded_by, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [String(a.id), String(a.adjustment_number ?? key), a.credit_note_number ?? null, String(a.lab_id), String(a.lab_name ?? ''),
           ['credit_note', 'debit_adjustment', 'refund', 'write_off', 'reversal'].includes(a.type) ? a.type : 'credit_note',
           amount, String(a.reason), a.date ?? a.created_at ?? new Date().toISOString(),
           a.reference_number ?? null, a.invoice_id ?? null, a.invoice_number ?? null, a.notes ?? null,
           a.recorded_by ?? 'Legacy Import', a.status ?? 'posted', a.created_at ?? new Date().toISOString()]
        );
        for (const att of a.attachments || []) {
          tx.run(
            `INSERT INTO payment_attachments (id, payment_id, filename, file_type, file_size, file_url, uploaded_at, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [att.id || `pa-${Math.random().toString(36).slice(2, 8)}`, String(a.id), att.file_name ?? 'proof',
             att.file_type ?? 'application/octet-stream', att.file_size ?? null, att.file_url ?? '',
             att.uploaded_at ?? new Date().toISOString(), att.uploaded_by ?? null]
          );
        }
      });
      report.imported();
    } catch (err: any) {
      report.skip(err?.message || 'invalid adjustment record', a);
    }
  }

  // ---------------- journal entries ----------------
  report.start('journal_entries');
  const legacyJournal = [...safeParse<any[]>(readKey('dsw_sqlite_journal_entries'), []), ...safeParse<any[]>(readKey('dsw_journal_entries'), [])];
  const seenJe = new Set<string>();
  for (const j of legacyJournal) {
    const key = j?.id ? String(j.id) : j?.journal_number ? String(j.journal_number) : null;
    if (!key || seenJe.has(key)) continue;
    seenJe.add(key);
    try {
      requireString(j.journal_number, 'journal_number', `journal ${key}`);
      requireString(j.description, 'description', `journal ${key}`);
      journalRepo.insert({
        ...j,
        id: String(j.id),
        journal_number: String(j.journal_number),
        date: j.date ?? new Date().toISOString(),
        event_type: String(j.event_type ?? 'legacy'),
        lines: Array.isArray(j.lines) ? j.lines : [],
        created_by: j.created_by ?? 'Legacy Import',
      });
      report.imported();
    } catch (err: any) {
      report.skip(err?.message || 'invalid journal record', j);
    }
  }

  // ---------------- notifications ----------------
  report.start('notifications');
  const legacyNotifs = [...safeParse<any[]>(readKey('dsw_sqlite_notifications'), []), ...safeParse<any[]>(readKey('dsw_notifications'), [])];
  const seenNotif = new Set<string>();
  for (const n of legacyNotifs) {
    const key = n?.id ? String(n.id) : null;
    if (!key || seenNotif.has(key)) continue;
    seenNotif.add(key);
    try {
      requireString(n.title, 'title', `notification ${key}`);
      notificationsRepo.insert({ ...n, id: key, type: n.type ?? 'system' });
      report.imported();
    } catch (err: any) {
      report.skip(err?.message || 'invalid notification', n);
    }
  }

  // ---------------- templates, contacts, addresses, pricing, reviews, doctor prefs ----------------
  report.start('lab_relations');
  const legacyTemplates = safeParse<any[]>(readKey('dsw_templates'), []);
  for (const t of legacyTemplates) {
    try {
      requireString(t.template_name, 'template_name', `template ${t.id}`);
      db.run(
        `INSERT INTO case_templates (id, template_name, case_type_id, case_type_name, description, selected_teeth, shade, instructions, default_priority, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [String(t.id), String(t.template_name), t.case_type_id ?? null, t.case_type_name ?? null, t.description ?? null,
         JSON.stringify(Array.isArray(t.selected_teeth) ? t.selected_teeth : []), t.shade ?? null, t.instructions ?? null,
         t.default_priority ?? 'normal', t.created_at ?? new Date().toISOString()]
      );
      report.imported();
    } catch (err: any) {
      report.skip(err?.message || 'invalid template', t);
    }
  }
  for (const [key, table, cols] of [
    ['dsw_lab_contacts', 'lab_contacts', ['lab_id', 'name', 'phone', 'email', 'role', 'notes', 'is_primary']],
    ['dsw_sqlite_lab_contacts', 'lab_contacts', ['lab_id', 'name', 'phone', 'email', 'role', 'notes', 'is_primary']],
    ['dsw_lab_addresses', 'lab_addresses', ['lab_id', 'type', 'street', 'city', 'state', 'postal_code', 'country', 'is_default']],
    ['dsw_sqlite_lab_addresses', 'lab_addresses', ['lab_id', 'type', 'street', 'city', 'state', 'postal_code', 'country', 'is_default']],
    ['dsw_pricing_overrides', 'lab_pricing_overrides', ['lab_id', 'case_type_id', 'case_type_name', 'standard_price', 'custom_price', 'discount_percentage', 'effective_date']],
    ['dsw_sqlite_pricing_overrides', 'lab_pricing_overrides', ['lab_id', 'case_type_id', 'case_type_name', 'standard_price', 'custom_price', 'discount_percentage', 'effective_date']],
    ['dsw_lab_reviews', 'lab_reviews', ['lab_id', 'rating', 'review_text', 'reviewer_name', 'case_number']],
    ['dsw_sqlite_lab_reviews', 'lab_reviews', ['lab_id', 'rating', 'review_text', 'reviewer_name', 'case_number']],
  ] as const) {
    const rows = safeParse<any[]>(readKey(key), []);
    for (const r of rows) {
      try {
        const values = cols.map((c) => {
          const v = r[c];
          if (typeof v === 'boolean') return v ? 1 : 0;
          return v ?? null;
        });
        db.run(
          `INSERT OR REPLACE INTO ${table} (id, ${cols.join(', ')}, created_at) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)`,
          [String(r.id), ...values, r.created_at ?? new Date().toISOString()]
        );
        report.imported();
      } catch (err: any) {
        report.skip(err?.message || `invalid ${table} row`, r);
      }
    }
  }
  const legacyDocPrefs = safeParse<any[]>(readKey('dsw_doctor_preferences'), []);
  for (const d of legacyDocPrefs) {
    try {
      if (!d?.doctor_name || !d?.lab_id) throw new Error('missing doctor_name or lab_id');
      db.run(
        'INSERT OR REPLACE INTO doctor_preferred_labs (id, doctor_name, lab_id, lab_name, created_at) VALUES (?, ?, ?, ?, ?)',
        [String(d.id), String(d.doctor_name), String(d.lab_id), String(d.lab_name ?? ''), d.created_at ?? new Date().toISOString()]
      );
      report.imported();
    } catch (err: any) {
      report.skip(err?.message || 'invalid doctor preference', d);
    }
  }
  const legacyVouchers = safeParse<any[]>(readKey('dsw_saved_vouchers'), []);
  for (const v of legacyVouchers) {
    try {
      requireString(v.voucher_number, 'voucher_number', `voucher ${v.id}`);
      vouchersRepo.insert({
        id: String(v.id),
        voucher_number: String(v.voucher_number),
        voucher_type: v.voucher_type === 'invoice' ? 'invoice' : 'job_slip',
        case_id: String(v.case_id ?? ''),
        case_number: v.case_number ?? null,
        lab_name: v.lab_name ?? null,
        doctor_name: v.doctor_name ?? null,
        patient_name: v.patient_name ?? null,
        case_type_name: v.case_type_name ?? null,
        amount: v.amount ?? null,
        saved_by: String(v.saved_by ?? 'Legacy Import'),
        notes: v.notes ?? null,
        created_at: v.created_at,
      });
      report.imported();
    } catch (err: any) {
      report.skip(err?.message || 'invalid voucher', v);
    }
  }

  // ---------------- reconciliation ----------------
  report.start('reconciliation_items');
  const legacyRecon = safeParse<any[]>(readKey('dsw_reconciliation_items'), []);
  for (const r of legacyRecon) {
    try {
      requireString(r.id, 'id', 'reconciliation item');
      db.run(
        `INSERT OR REPLACE INTO reconciliation_items (id, payment_id, reference_number, method, amount, date, lab_id, lab_name, invoice_id, invoice_number, status, exception_reason, notes, proof_url, verified_at, verified_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [String(r.id), r.payment_id ?? null, r.reference_number ?? null,
         ['bank', 'cheque', 'cash', 'advance'].includes(r.method) ? r.method : 'cash',
         Number(r.amount) || 0, r.date ?? new Date().toISOString(), r.lab_id ?? null, r.lab_name ?? null,
         r.invoice_id ?? null, r.invoice_number ?? null, r.status ?? 'unmatched', r.exception_reason ?? null,
         r.notes ?? null, r.proof_url ?? null, r.verified_at ?? null, r.verified_by ?? null, new Date().toISOString()]
      );
      report.imported();
    } catch (err: any) {
      report.skip(err?.message || 'invalid reconciliation item', r);
    }
  }

  // ---------------- settings ----------------
  report.start('settings');
  const legacyBranding = safeParse<any>(readKey('dsw_sqlite_branding') || readKey('dsw_branding'), null);
  if (legacyBranding && typeof legacyBranding === 'object') {
    settingsRepo.set('branding', 'settings', { ...DEFAULT_BRANDING_SETTINGS, ...legacyBranding });
    report.imported();
  } else {
    settingsRepo.set('branding', 'settings', DEFAULT_BRANDING_SETTINGS);
  }
  const legacyPrefs = safeParse<any>(readKey('dsw_sqlite_preferences') || readKey('dsw_user_prefs'), null);
  if (legacyPrefs && typeof legacyPrefs === 'object') {
    settingsRepo.set('preferences', 'global', legacyPrefs);
    report.imported();
  }
  const legacyNotifCfg = safeParse<any>(readKey('dsw_notif_config'), null);
  if (legacyNotifCfg) {
    notificationConfigRepo.set(legacyNotifCfg);
    report.imported();
  }
  const legacyEmailTpls = safeParse<any[]>(readKey('dsw_email_templates'), []);
  for (const t of legacyEmailTpls) {
    try {
      emailTemplatesRepo.upsert(t);
      report.imported();
    } catch {
      report.skip('invalid email template', t);
    }
  }

  // ---------------- clinical specs ----------------
  report.start('clinical_specs');
  const legacySpecs = safeParse<any>(readKey('dental_solutions_clinical_specs'), null);
  if (legacySpecs && typeof legacySpecs === 'object') {
    const mats = Array.isArray(legacySpecs.materials) ? legacySpecs.materials : DEFAULT_MATERIALS;
    const preps = Array.isArray(legacySpecs.prepTypes) ? legacySpecs.prepTypes : DEFAULT_PREP_TYPES;
    const shades = Array.isArray(legacySpecs.shadeGuides) ? legacySpecs.shadeGuides : DEFAULT_SHADE_GUIDES;
    const brands = Array.isArray(legacySpecs.implantBrands) ? legacySpecs.implantBrands : DEFAULT_IMPLANT_BRANDS;
    clinicalSpecsRepo.materials.deleteAll();
    for (const m of mats) clinicalSpecsRepo.materials.insert(m);
    clinicalSpecsRepo.prepTypes.deleteAll();
    for (const p of preps) clinicalSpecsRepo.prepTypes.insert(p);
    clinicalSpecsRepo.shadeGuides.deleteAll();
    for (const g of shades) clinicalSpecsRepo.shadeGuides.insert(g);
    clinicalSpecsRepo.implantBrands.deleteAll();
    for (const b of brands) clinicalSpecsRepo.implantBrands.insert(b);
    report.imported(mats.length + preps.length + shades.length + brands.length);
  }

  // ---------------- chairside appointments ----------------
  report.start('chairside_appointments');
  const legacyChairside = safeParse<any[]>(readKey('dsw_custom_chairside_appts'), []);
  for (const a of legacyChairside) {
    try {
      requireString(a.patient, 'patient', 'chairside appointment');
      chairsideRepo.insert({
        id: String(a.id),
        time: String(a.time ?? '09:00'),
        period: a.period === 'PM' ? 'PM' : 'AM',
        patient: String(a.patient),
        doctor: String(a.doctor ?? ''),
        clinic: String(a.clinic ?? ''),
        procedure: String(a.procedure ?? ''),
        tooth: a.tooth ?? null,
        shade: a.shade ?? null,
        status: ['confirmed', 'in_chair', 'pending_stl', 'completed'].includes(a.status) ? a.status : 'confirmed',
        case_ref: a.caseRef ?? null,
      });
      report.imported();
    } catch (err: any) {
      report.skip(err?.message || 'invalid chairside appointment', a);
    }
  }

  // ---------------- re-align document counters ----------------
  const maxCaseNum = Number(
    db.scalar(`SELECT MAX(CAST(REPLACE(case_number, 'DS-', '') AS INTEGER)) FROM cases`) ?? 0
  );
  const maxInvNum = Number(
    db.scalar(`SELECT MAX(CAST(REPLACE(invoice_number, 'INV-', '') AS INTEGER)) FROM invoices`) ?? 0
  );
  const maxPayNum = Number(
    db.scalar(`SELECT MAX(CAST(REPLACE(payment_number, 'PAY-', '') AS INTEGER)) FROM payments WHERE payment_number LIKE 'PAY-%'`) ?? 0
  );
  ensureCounterAtLeast(db, SEQ_KEYS.case, maxCaseNum + 1);
  ensureCounterAtLeast(db, SEQ_KEYS.invoice, maxInvNum + 1);
  ensureCounterAtLeast(db, SEQ_KEYS.payment, maxPayNum + 1);

  appMetaRepo.set('legacy_import_done', 'true');
  const finished = report.finish();
  appMetaRepo.set('legacy_import_report', JSON.stringify(finished));
  lastReport = finished;
  return finished;
}
