import { getDatabase } from './index';
import { SqliteEngine, TransactionApi, DbError } from './engine';

/**
 * Typed repository layer. Each repository maps an app domain type to SQLite
 * tables. JSON-structured fields (tooth details, line items, attachments…)
 * are stored as TEXT and decoded on read — modeled as first-class child
 * tables only where relational queries matter.
 */

type Db = SqliteEngine;

const now = () => new Date().toISOString();
const genId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function requireEngine(): Db {
  return getDatabase();
}

// ─────────────────────────────────────────────────────────── users & sessions

export interface UserRow {
  id: string;
  username: string;
  email: string;
  name: string;
  role: string;
  password_hash: string;
  password_salt: string;
  avatar?: string | null;
  is_super_admin: number;
  is_active: number;
  created_at: string;
  updated_at?: string | null;
}

export const usersRepo = {
  all(): UserRow[] {
    return requireEngine().all<UserRow>('SELECT * FROM users ORDER BY created_at ASC');
  },
  byId(id: string): UserRow | undefined {
    return requireEngine().get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
  },
  byUsername(username: string): UserRow | undefined {
    return requireEngine().get<UserRow>('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [username]);
  },
  byEmail(email: string): UserRow | undefined {
    return requireEngine().get<UserRow>('SELECT * FROM users WHERE email = ? COLLATE NOCASE', [email]);
  },
  insert(u: {
    id: string;
    username: string;
    email: string;
    name: string;
    role: string;
    password_hash: string;
    password_salt: string;
    avatar?: string | null;
    is_super_admin?: number;
    is_active?: number;
    created_at?: string;
  }): void {
    requireEngine().run(
      `INSERT INTO users (id, username, email, name, role, password_hash, password_salt, avatar, is_super_admin, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [u.id, u.username, u.email, u.name, u.role, u.password_hash, u.password_salt, u.avatar ?? null,
       u.is_super_admin ?? 0, u.is_active ?? 1, u.created_at ?? now()]
    );
  },
  update(id: string, updates: Partial<UserRow>): void {
    const allowed = ['username', 'email', 'name', 'role', 'password_hash', 'password_salt', 'avatar', 'is_super_admin', 'is_active'] as const;
    const sets: string[] = [];
    const params: any[] = [];
    for (const key of allowed) {
      if (key in updates) {
        sets.push(`${key} = ?`);
        params.push((updates as any)[key]);
      }
    }
    if (!sets.length) return;
    sets.push('updated_at = ?');
    params.push(now(), id);
    requireEngine().run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  },
  delete(id: string): void {
    requireEngine().run('DELETE FROM users WHERE id = ?', [id]);
  },
  count(): number {
    return requireEngine().rowCount('users');
  },
};

export const sessionsRepo = {
  create(token: string, userId: string, expiresAt: string): void {
    requireEngine().run(
      'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      [token, userId, now(), expiresAt]
    );
  },
  findValid(token: string): { token: string; user_id: string; expires_at: string } | undefined {
    return requireEngine().get(
      'SELECT * FROM sessions WHERE token = ? AND expires_at > ?',
      [token, now()]
    );
  },
  delete(token: string): void {
    requireEngine().run('DELETE FROM sessions WHERE token = ?', [token]);
  },
  purgeExpired(): void {
    requireEngine().run('DELETE FROM sessions WHERE expires_at <= ?', [now()]);
  },
};

// ─────────────────────────────────────────────────────────── labs (clinics)

export interface LabRow {
  id: string;
  name: string;
  code?: string | null;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  doctor_name?: string | null;
  notes?: string | null;
  rating: number;
  reviews_count: number;
  created_at: string;
  updated_at?: string | null;
}

function labToDomain(row: LabRow): any {
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? undefined,
    contact_person: row.contact_person ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    address: row.address ?? undefined,
    city: row.city ?? undefined,
    doctor_name: row.doctor_name ?? undefined,
    notes: row.notes ?? undefined,
    rating: row.rating,
    reviews_count: row.reviews_count,
    created_at: row.created_at,
  };
}

export const labsRepo = {
  all(): any[] {
    return requireEngine().all<LabRow>('SELECT * FROM labs ORDER BY name COLLATE NOCASE ASC').map(labToDomain);
  },
  byId(id: string): any | undefined {
    const row = requireEngine().get<LabRow>('SELECT * FROM labs WHERE id = ?', [id]);
    return row ? labToDomain(row) : undefined;
  },
  byName(name: string): any | undefined {
    const row = requireEngine().get<LabRow>('SELECT * FROM labs WHERE name = ? COLLATE NOCASE', [name]);
    return row ? labToDomain(row) : undefined;
  },
  insert(lab: any): any {
    const id = lab.id || genId('lab');
    try {
      requireEngine().run(
        `INSERT INTO labs (id, name, code, contact_person, phone, email, address, city, doctor_name, notes, rating, reviews_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, lab.name, lab.code ?? null, lab.contact_person ?? null, lab.phone ?? null, lab.email ?? null,
         lab.address ?? null, lab.city ?? null, lab.doctor_name ?? null, lab.notes ?? null,
         lab.rating ?? 5.0, lab.reviews_count ?? 0, lab.created_at ?? now(), now()]
      );
    } catch (err: any) {
      if (String(err?.message).toUpperCase().includes('UNIQUE')) {
        throw new DbError('A clinic with that name already exists', 'CONSTRAINT', err);
      }
      throw err;
    }
    return this.byId(id);
  },
  update(id: string, updates: any): any | null {
    const allowed = ['name', 'code', 'contact_person', 'phone', 'email', 'address', 'city', 'doctor_name', 'notes', 'rating', 'reviews_count'] as const;
    const sets: string[] = [];
    const params: any[] = [];
    for (const key of allowed) {
      if (key in updates) {
        sets.push(`${key} = ?`);
        params.push(updates[key] ?? null);
      }
    }
    if (!sets.length) return this.byId(id);
    sets.push('updated_at = ?');
    params.push(now(), id);
    try {
      requireEngine().run(`UPDATE labs SET ${sets.join(', ')} WHERE id = ?`, params);
    } catch (err: any) {
      if (String(err?.message).toUpperCase().includes('UNIQUE')) {
        throw new DbError('A clinic with that name already exists', 'CONSTRAINT', err);
      }
      throw err;
    }
    return this.byId(id);
  },
  delete(id: string): boolean {
    const before = requireEngine().rowCount('labs');
    requireEngine().run('DELETE FROM labs WHERE id = ?', [id]);
    return requireEngine().rowCount('labs') < before;
  },
  search(query: string): any[] {
    const q = `%${query.trim()}%`;
    return requireEngine()
      .all<LabRow>(
        `SELECT * FROM labs WHERE name LIKE ? OR code LIKE ? OR contact_person LIKE ? OR city LIKE ? OR doctor_name LIKE ? ORDER BY name COLLATE NOCASE`,
        [q, q, q, q, q]
      )
      .map(labToDomain);
  },
};

// ─────────────────────────────────────────────────────────── lab children

function childRepoFactory(table: string, labKey: boolean) {
  const allowedMap: Record<string, string[]> = {
    lab_contacts: ['name', 'phone', 'email', 'role', 'notes', 'is_primary'],
    lab_addresses: ['type', 'street', 'city', 'state', 'postal_code', 'country', 'is_default'],
    lab_pricing_overrides: ['case_type_id', 'case_type_name', 'standard_price', 'custom_price', 'discount_percentage', 'effective_date'],
    lab_reviews: ['rating', 'review_text', 'reviewer_name', 'case_number'],
  };
  const allowed = allowedMap[table] || [];

  const repo: any = {
    all(): any[] {
      return requireEngine().all(`SELECT * FROM ${table} ORDER BY created_at ASC`);
    },
    byLab(labId: string): any[] {
      return requireEngine().all(`SELECT * FROM ${table} WHERE lab_id = ? ORDER BY created_at ASC`, [labId]);
    },
    insert(row: any): any {
      const id = row.id || genId(table.slice(0, 3));
      const cols = ['id', ...(labKey ? ['lab_id'] : []), ...allowed, 'created_at'];
      const params = [
        id,
        ...(labKey ? [row.lab_id] : []),
        ...allowed.map((k) => (row[k] !== undefined ? row[k] : k.includes('is_') ? 0 : null)),
        row.created_at ?? now(),
      ];
      requireEngine().run(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        params
      );
      return requireEngine().get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    },
    update(id: string, updates: any): any | null {
      const sets: string[] = [];
      const params: any[] = [];
      for (const key of allowed) {
        if (key in updates) {
          sets.push(`${key} = ?`);
          params.push(updates[key] ?? null);
        }
      }
      if (!sets.length) return requireEngine().get(`SELECT * FROM ${table} WHERE id = ?`, [id]) ?? null;
      params.push(id);
      requireEngine().run(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, params);
      return requireEngine().get(`SELECT * FROM ${table} WHERE id = ?`, [id]) ?? null;
    },
    delete(id: string): boolean {
      const before = requireEngine().rowCount(table);
      requireEngine().run(`DELETE FROM ${table} WHERE id = ?`, [id]);
      return requireEngine().rowCount(table) < before;
    },
  };
  return repo;
}

export const labContactsRepo = childRepoFactory('lab_contacts', true);
export const labAddressesRepo = childRepoFactory('lab_addresses', true);
export const labPricingOverridesRepo = childRepoFactory('lab_pricing_overrides', true);
export const labReviewsRepo = childRepoFactory('lab_reviews', true);

export interface DoctorPreferredLabRow {
  id: string;
  doctor_name: string;
  lab_id: string;
  lab_name: string;
  created_at: string;
}

export const doctorPreferredLabsRepo = {
  all(): DoctorPreferredLabRow[] {
    return requireEngine().all<DoctorPreferredLabRow>('SELECT * FROM doctor_preferred_labs ORDER BY doctor_name');
  },
  byDoctor(name: string): DoctorPreferredLabRow | undefined {
    return requireEngine().get<DoctorPreferredLabRow>('SELECT * FROM doctor_preferred_labs WHERE doctor_name = ? COLLATE NOCASE', [name]);
  },
  set(doctorName: string, labId: string, labName: string): void {
    const engine = requireEngine();
    const existing = this.byDoctor(doctorName);
    if (existing) {
      engine.run('UPDATE doctor_preferred_labs SET lab_id = ?, lab_name = ? WHERE id = ?', [labId, labName, existing.id]);
    } else {
      engine.run(
        'INSERT INTO doctor_preferred_labs (id, doctor_name, lab_id, lab_name, created_at) VALUES (?, ?, ?, ?, ?)',
        [genId('dpl'), doctorName, labId, labName, now()]
      );
    }
  },
  delete(id: string): void {
    requireEngine().run('DELETE FROM doctor_preferred_labs WHERE id = ?', [id]);
  },
};

// ─────────────────────────────────────────────────────────── case types

export interface CaseTypeRow {
  id: string;
  name: string;
  base_price: number;
  category?: string | null;
  lead_time_days?: number | null;
  warranty_months?: number | null;
  description?: string | null;
  created_at: string;
  updated_at?: string | null;
}

function caseTypeToDomain(row: CaseTypeRow): any {
  return {
    id: row.id,
    name: row.name,
    base_price: row.base_price,
    category: row.category ?? undefined,
    lead_time_days: row.lead_time_days ?? undefined,
    warranty_months: row.warranty_months ?? undefined,
    description: row.description ?? undefined,
    created_at: row.created_at,
  };
}

export const caseTypesRepo = {
  all(): any[] {
    return requireEngine().all<CaseTypeRow>('SELECT * FROM case_types ORDER BY name COLLATE NOCASE').map(caseTypeToDomain);
  },
  byId(id: string): any | undefined {
    const row = requireEngine().get<CaseTypeRow>('SELECT * FROM case_types WHERE id = ?', [id]);
    return row ? caseTypeToDomain(row) : undefined;
  },
  insert(ct: any): any {
    const id = ct.id || genId('ct');
    requireEngine().run(
      `INSERT INTO case_types (id, name, base_price, category, lead_time_days, warranty_months, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, ct.name, ct.base_price, ct.category ?? null, ct.lead_time_days ?? null,
       ct.warranty_months ?? null, ct.description ?? null, ct.created_at ?? now(), now()]
    );
    return this.byId(id);
  },
  update(id: string, updates: any): any | null {
    const allowed = ['name', 'base_price', 'category', 'lead_time_days', 'warranty_months', 'description'] as const;
    const sets: string[] = [];
    const params: any[] = [];
    for (const key of allowed) {
      if (key in updates) {
        sets.push(`${key} = ?`);
        params.push(updates[key] ?? null);
      }
    }
    if (sets.length) {
      sets.push('updated_at = ?');
      params.push(now(), id);
      requireEngine().run(`UPDATE case_types SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    return this.byId(id);
  },
  delete(id: string): boolean {
    const before = requireEngine().rowCount('case_types');
    requireEngine().run('DELETE FROM case_types WHERE id = ?', [id]);
    return requireEngine().rowCount('case_types') < before;
  },
};

// ─────────────────────────────────────────────────────────── cases

export interface CaseRow {
  id: string;
  case_number: string;
  patient_name?: string | null;
  lab_id: string;
  lab_name: string;
  case_type_id?: string | null;
  case_type_name?: string | null;
  units_count?: number | null;
  doctor_name: string;
  selected_teeth: string;
  tooth_details?: string | null;
  shade?: string | null;
  material?: string | null;
  delivery_date: string;
  priority: string;
  price: number;
  discount: number;
  final_price: number;
  instructions?: string | null;
  photo_url?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function caseToDomain(row: CaseRow, db: Db): any {
  const history = db.all<{ id: string; case_id: string; status: string; notes?: string | null; timestamp: string; updated_by: string }>(
    'SELECT * FROM case_status_history WHERE case_id = ? ORDER BY timestamp DESC',
    [row.id]
  );
  return {
    id: row.id,
    case_number: row.case_number,
    patient_name: row.patient_name ?? undefined,
    lab_id: row.lab_id,
    lab_name: row.lab_name,
    case_type_id: row.case_type_id ?? undefined,
    case_type_name: row.case_type_name ?? undefined,
    case_type: row.case_type_name ?? undefined,
    units_count: row.units_count ?? undefined,
    doctor_name: row.doctor_name,
    selected_teeth: JSON.parse(row.selected_teeth || '[]'),
    tooth_details: row.tooth_details ? JSON.parse(row.tooth_details) : undefined,
    shade: row.shade ?? undefined,
    material: row.material ?? undefined,
    delivery_date: row.delivery_date,
    priority: row.priority,
    price: row.price,
    discount: row.discount,
    final_price: row.final_price,
    instructions: row.instructions ?? undefined,
    photo_url: row.photo_url ?? undefined,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    history,
  };
}

export const casesRepo = {
  all(): any[] {
    const db = requireEngine();
    return db.all<CaseRow>('SELECT * FROM cases ORDER BY created_at DESC').map((r) => caseToDomain(r, db));
  },
  byId(id: string): any | undefined {
    const db = requireEngine();
    const row = db.get<CaseRow>('SELECT * FROM cases WHERE id = ?', [id]);
    return row ? caseToDomain(row, db) : undefined;
  },
  byCaseNumber(caseNumber: string): any | undefined {
    const db = requireEngine();
    const row = db.get<CaseRow>('SELECT * FROM cases WHERE case_number = ? COLLATE NOCASE', [caseNumber]);
    return row ? caseToDomain(row, db) : undefined;
  },
  insert(c: any): any {
    const db = requireEngine();
    return db.withTransaction((tx) => {
      const id = c.id || genId('case');
      tx.run(
        `INSERT INTO cases (id, case_number, patient_name, lab_id, lab_name, case_type_id, case_type_name, units_count, doctor_name,
                            selected_teeth, tooth_details, shade, material, delivery_date, priority, price, discount, final_price,
                            instructions, photo_url, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, c.case_number, c.patient_name ?? null, c.lab_id, c.lab_name, c.case_type_id ?? null, c.case_type_name ?? null,
         c.units_count ?? null, c.doctor_name, JSON.stringify(c.selected_teeth ?? []), c.tooth_details ? JSON.stringify(c.tooth_details) : null,
         c.shade ?? null, c.material ?? null, c.delivery_date, c.priority ?? 'normal', c.price ?? 0, c.discount ?? 0, c.final_price ?? 0,
         c.instructions ?? null, c.photo_url ?? null, c.status ?? 'received', c.created_at ?? now(), now()]
      );
      // normalize teeth
      const details = c.tooth_details || {};
      for (const tooth of c.selected_teeth || []) {
        const d = details[tooth] || {};
        tx.run(
          `INSERT OR REPLACE INTO case_teeth (case_id, tooth_number, shade, prep_type, material, notes, implant_brand, implant_size)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, tooth, d.shade ?? null, d.prep_type ?? null, d.material ?? null, d.notes ?? null, d.implant_brand ?? null, d.implant_size ?? null]
        );
      }
      // initial history row
      tx.run(
        `INSERT INTO case_status_history (id, case_id, status, notes, timestamp, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [genId('h'), id, c.status ?? 'received', c.history?.[0]?.notes || 'Case registered', c.created_at ?? now(), c.history?.[0]?.updated_by || 'System']
      );
      return this.byId(id);
    });
  },
  update(id: string, updates: any): any | null {
    const db = requireEngine();
    return db.withTransaction((tx) => {
      const allowed = ['patient_name', 'lab_id', 'lab_name', 'case_type_id', 'case_type_name', 'units_count', 'doctor_name',
        'shade', 'material', 'delivery_date', 'priority', 'price', 'discount', 'final_price', 'instructions', 'photo_url', 'status'] as const;
      const sets: string[] = [];
      const params: any[] = [];
      for (const key of allowed) {
        if (key in updates) {
          sets.push(`${key} = ?`);
          params.push(updates[key] ?? null);
        }
      }
      if (sets.length) {
        sets.push('updated_at = ?');
        params.push(now(), id);
        tx.run(`UPDATE cases SET ${sets.join(', ')} WHERE id = ?`, params);
      }
      if (updates.selected_teeth || updates.tooth_details) {
        const current = tx.get<{ selected_teeth: string; tooth_details?: string }>('SELECT selected_teeth, tooth_details FROM cases WHERE id = ?', [id]);
        const teeth = updates.selected_teeth ?? JSON.parse(current?.selected_teeth || '[]');
        const details = updates.tooth_details ?? (current?.tooth_details ? JSON.parse(current.tooth_details) : {});
        tx.run('DELETE FROM case_teeth WHERE case_id = ?', [id]);
        for (const tooth of teeth) {
          const d = details[tooth] || {};
          tx.run(
            `INSERT OR REPLACE INTO case_teeth (case_id, tooth_number, shade, prep_type, material, notes, implant_brand, implant_size)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, tooth, d.shade ?? null, d.prep_type ?? null, d.material ?? null, d.notes ?? null, d.implant_brand ?? null, d.implant_size ?? null]
          );
        }
        tx.run('UPDATE cases SET selected_teeth = ?, tooth_details = ? WHERE id = ?',
          [JSON.stringify(teeth), JSON.stringify(details), id]);
      }
      if (updates.history) {
        tx.run('DELETE FROM case_status_history WHERE case_id = ?', [id]);
        for (const h of updates.history) {
          tx.run(
            `INSERT INTO case_status_history (id, case_id, status, notes, timestamp, updated_by) VALUES (?, ?, ?, ?, ?, ?)`,
            [h.id || genId('h'), id, h.status, h.notes ?? null, h.timestamp, h.updated_by]
          );
        }
      }
      return this.byId(id);
    });
  },
  delete(id: string): boolean {
    const before = requireEngine().rowCount('cases');
    requireEngine().run('DELETE FROM cases WHERE id = ?', [id]);
    return requireEngine().rowCount('cases') < before;
  },
  search(query: string): any[] {
    const db = requireEngine();
    const q = `%${query.trim()}%`;
    return db
      .all<CaseRow>(
        `SELECT * FROM cases
         WHERE case_number LIKE ? OR patient_name LIKE ? OR lab_name LIKE ? OR doctor_name LIKE ? OR shade LIKE ? OR case_type_name LIKE ?
         ORDER BY created_at DESC`,
        [q, q, q, q, q, q]
      )
      .map((r) => caseToDomain(r, db));
  },
  countByStatus(status: string): number {
    return Number(requireEngine().scalar('SELECT COUNT(*) FROM cases WHERE status = ?', [status]) ?? 0);
  },
};

// ─────────────────────────────────────────────────────────── case notes & attachments

export interface CaseNoteRow {
  id: string;
  case_id: string;
  note_text: string;
  author: string;
  created_at: string;
  updated_at?: string | null;
}

export const caseNotesRepo = {
  all(): CaseNoteRow[] {
    return requireEngine().all<CaseNoteRow>('SELECT * FROM case_notes ORDER BY created_at DESC');
  },
  byCase(caseId: string): CaseNoteRow[] {
    return requireEngine().all<CaseNoteRow>('SELECT * FROM case_notes WHERE case_id = ? ORDER BY created_at DESC', [caseId]);
  },
  insert(n: { case_id: string; note_text: string; author: string; created_at?: string }): CaseNoteRow {
    const id = genId('cn');
    requireEngine().run(
      'INSERT INTO case_notes (id, case_id, note_text, author, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, n.case_id, n.note_text, n.author, n.created_at ?? now()]
    );
    return requireEngine().get<CaseNoteRow>('SELECT * FROM case_notes WHERE id = ?', [id])!;
  },
  update(id: string, noteText: string): void {
    requireEngine().run('UPDATE case_notes SET note_text = ?, updated_at = ? WHERE id = ?', [noteText, now(), id]);
  },
  delete(id: string): void {
    requireEngine().run('DELETE FROM case_notes WHERE id = ?', [id]);
  },
};

export interface AttachmentRow {
  id: string;
  entity_type: string;
  entity_id: string;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  size_bytes?: number | null;
  checksum?: string | null;
  description?: string | null;
  storage_path: string;
  data_url?: string | null;
  uploaded_by?: string | null;
  created_at: string;
}

export const attachmentsRepo = {
  all(): AttachmentRow[] {
    return requireEngine().all<AttachmentRow>('SELECT * FROM attachments ORDER BY created_at DESC');
  },
  byEntity(entityType: string, entityId: string): AttachmentRow[] {
    return requireEngine().all<AttachmentRow>(
      'SELECT * FROM attachments WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC',
      [entityType, entityId]
    );
  },
  insert(att: Omit<AttachmentRow, 'created_at'> & { created_at?: string }): AttachmentRow {
    requireEngine().run(
      `INSERT INTO attachments (id, entity_type, entity_id, original_filename, stored_filename, mime_type, size_bytes, checksum, description, storage_path, data_url, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [att.id, att.entity_type, att.entity_id, att.original_filename, att.stored_filename, att.mime_type,
       att.size_bytes ?? null, att.checksum ?? null, att.description ?? null, att.storage_path,
       att.data_url ?? null, att.uploaded_by ?? null, att.created_at ?? now()]
    );
    return requireEngine().get<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', [att.id])!;
  },
  delete(id: string): void {
    requireEngine().run('DELETE FROM attachments WHERE id = ?', [id]);
  },
  deleteForEntity(entityType: string, entityId: string): void {
    requireEngine().run('DELETE FROM attachments WHERE entity_type = ? AND entity_id = ?', [entityType, entityId]);
  },
  count(): number {
    return requireEngine().rowCount('attachments');
  },
};

// ─────────────────────────────────────────────────────────── invoices & items

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  case_id?: string | null;
  case_number?: string | null;
  lab_id: string;
  lab_name: string;
  case_type_id?: string | null;
  case_type_name?: string | null;
  doctor_name?: string | null;
  patient_name?: string | null;
  amount: number;
  discount: number;
  final_amount: number;
  amount_paid: number;
  payment_status: string;
  status_v2: string;
  issue_date?: string | null;
  due_date?: string | null;
  journal_id?: string | null;
  credit_notes_total: number;
  created_at: string;
  updated_at?: string | null;
}

function invoiceToDomain(row: InvoiceRow, db: Db): any {
  const payments = db.all<any>(
    'SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date ASC, created_at ASC',
    [row.id]
  ).map((p) => ({
    ...p,
    is_reversed: !!p.is_reversed,
    attachments: db.all('SELECT * FROM payment_attachments WHERE payment_id = ? ORDER BY uploaded_at', [p.id]),
  }));
  return {
    id: row.id,
    invoice_number: row.invoice_number,
    case_id: row.case_id ?? '',
    case_number: row.case_number ?? '',
    lab_id: row.lab_id,
    lab_name: row.lab_name,
    case_type_id: row.case_type_id ?? undefined,
    case_type_name: row.case_type_name ?? undefined,
    doctor_name: row.doctor_name ?? '',
    patient_name: row.patient_name ?? undefined,
    amount: row.amount,
    discount: row.discount,
    final_amount: row.final_amount,
    amount_paid: row.amount_paid,
    payment_status: row.payment_status,
    status_v2: row.status_v2,
    issue_date: row.issue_date ?? undefined,
    due_date: row.due_date ?? '',
    payments,
    credit_notes_total: row.credit_notes_total,
    journal_id: row.journal_id ?? undefined,
    created_at: row.created_at,
  };
}

export const invoicesRepo = {
  all(): any[] {
    const db = requireEngine();
    return db.all<InvoiceRow>('SELECT * FROM invoices ORDER BY created_at DESC').map((r) => invoiceToDomain(r, db));
  },
  byId(id: string): any | undefined {
    const db = requireEngine();
    const row = db.get<InvoiceRow>('SELECT * FROM invoices WHERE id = ?', [id]);
    return row ? invoiceToDomain(row, db) : undefined;
  },
  byInvoiceNumber(num: string): any | undefined {
    const db = requireEngine();
    const row = db.get<InvoiceRow>('SELECT * FROM invoices WHERE invoice_number = ? COLLATE NOCASE', [num]);
    return row ? invoiceToDomain(row, db) : undefined;
  },
  insert(inv: any): any {
    const db = requireEngine();
    return db.withTransaction((tx) => {
      const id = inv.id || genId('inv');
      tx.run(
        `INSERT INTO invoices (id, invoice_number, case_id, case_number, lab_id, lab_name, case_type_id, case_type_name, doctor_name, patient_name,
                               amount, discount, final_amount, amount_paid, payment_status, status_v2, issue_date, due_date, journal_id, credit_notes_total, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, inv.invoice_number, inv.case_id ?? null, inv.case_number ?? null, inv.lab_id, inv.lab_name,
         inv.case_type_id ?? null, inv.case_type_name ?? null, inv.doctor_name ?? null, inv.patient_name ?? null,
         inv.amount ?? 0, inv.discount ?? 0, inv.final_amount ?? 0, inv.amount_paid ?? 0,
         inv.payment_status ?? 'unpaid', inv.status_v2 ?? 'open', inv.issue_date ?? null, inv.due_date ?? null,
         inv.journal_id ?? null, inv.credit_notes_total ?? 0, inv.created_at ?? now(), now()]
      );
      for (const item of inv.items || []) {
        tx.run(
          `INSERT INTO invoice_items (id, invoice_id, description, teeth_numbers, quantity, unit_price, total_price)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [item.id || genId('ii'), id, item.description, item.teeth_numbers ? JSON.stringify(item.teeth_numbers) : null,
           item.quantity ?? 1, item.unit_price, item.total_price]
        );
      }
      return this.byId(id);
    });
  },
  update(id: string, updates: any): any | null {
    const db = requireEngine();
    return db.withTransaction((tx) => {
      const allowed = ['case_id', 'case_number', 'lab_id', 'lab_name', 'case_type_id', 'case_type_name', 'doctor_name', 'patient_name',
        'amount', 'discount', 'final_amount', 'amount_paid', 'payment_status', 'status_v2', 'issue_date', 'due_date', 'journal_id', 'credit_notes_total'] as const;
      const sets: string[] = [];
      const params: any[] = [];
      for (const key of allowed) {
        if (key in updates) {
          sets.push(`${key} = ?`);
          params.push(updates[key] ?? null);
        }
      }
      if (sets.length) {
        sets.push('updated_at = ?');
        params.push(now(), id);
        tx.run(`UPDATE invoices SET ${sets.join(', ')} WHERE id = ?`, params);
      }
      if (updates.items) {
        tx.run('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);
        for (const item of updates.items) {
          tx.run(
            `INSERT INTO invoice_items (id, invoice_id, description, teeth_numbers, quantity, unit_price, total_price)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [item.id || genId('ii'), id, item.description, item.teeth_numbers ? JSON.stringify(item.teeth_numbers) : null,
             item.quantity ?? 1, item.unit_price, item.total_price]
          );
        }
      }
      return this.byId(id);
    });
  },
  delete(id: string): boolean {
    const before = requireEngine().rowCount('invoices');
    requireEngine().run('DELETE FROM invoices WHERE id = ?', [id]);
    return requireEngine().rowCount('invoices') < before;
  },
};

export const invoiceItemsRepo = {
  byInvoice(invoiceId: string): any[] {
    return requireEngine()
      .all<any>('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY rowid', [invoiceId])
      .map((r) => ({ ...r, teeth_numbers: r.teeth_numbers ? JSON.parse(r.teeth_numbers) : [] }));
  },
};

// ─────────────────────────────────────────────────────────── payments

export interface PaymentRow {
  id: string;
  payment_number?: string | null;
  receipt_number?: string | null;
  invoice_id?: string | null;
  invoice_number?: string | null;
  case_id?: string | null;
  case_number?: string | null;
  lab_id?: string | null;
  lab_name?: string | null;
  amount: number;
  payment_method: string;
  payment_date: string;
  reference_number?: string | null;
  notes?: string | null;
  recorded_by: string;
  payment_type?: string | null;
  advance_payment_id?: string | null;
  status: string;
  unapplied_amount: number;
  is_reversed: number;
  reversal_reason?: string | null;
  reversed_at?: string | null;
  reversed_by?: string | null;
  journal_id?: string | null;
  created_at: string;
}

function paymentToDomain(row: PaymentRow, db: Db): any {
  return {
    ...row,
    is_reversed: !!row.is_reversed,
    attachments: db.all('SELECT * FROM payment_attachments WHERE payment_id = ? ORDER BY uploaded_at', [row.id]),
    allocations: db.all('SELECT * FROM payment_allocations WHERE source_id = ? ORDER BY allocated_at', [row.id]),
  };
}

export const paymentsRepo = {
  all(): any[] {
    const db = requireEngine();
    return db.all<PaymentRow>('SELECT * FROM payments ORDER BY payment_date DESC, created_at DESC').map((r) => paymentToDomain(r, db));
  },
  byId(id: string): any | undefined {
    const db = requireEngine();
    const row = db.get<PaymentRow>('SELECT * FROM payments WHERE id = ?', [id]);
    return row ? paymentToDomain(row, db) : undefined;
  },
  insert(p: any): any {
    const db = requireEngine();
    return db.withTransaction((tx) => {
      const id = p.id || genId('pmt');
      tx.run(
        `INSERT INTO payments (id, payment_number, receipt_number, invoice_id, invoice_number, case_id, case_number, lab_id, lab_name,
                               amount, payment_method, payment_date, reference_number, notes, recorded_by, payment_type, advance_payment_id,
                               status, unapplied_amount, is_reversed, journal_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, p.payment_number ?? null, p.receipt_number ?? null, p.invoice_id ?? null, p.invoice_number ?? null,
         p.case_id ?? null, p.case_number ?? null, p.lab_id ?? null, p.lab_name ?? null,
         p.amount, p.payment_method, p.payment_date, p.reference_number ?? null, p.notes ?? null, p.recorded_by,
         p.payment_type ?? 'invoice_payment', p.advance_payment_id ?? null, p.status ?? 'posted',
         p.unapplied_amount ?? 0, p.is_reversed ? 1 : 0, p.journal_id ?? null, p.created_at ?? now()]
      );
      for (const att of p.attachments || []) {
        tx.run(
          `INSERT INTO payment_attachments (id, payment_id, filename, file_type, file_size, file_url, uploaded_at, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [att.id || genId('pa'), id, att.file_name, att.file_type, att.file_size ?? null, att.file_url, att.uploaded_at ?? now(), att.uploaded_by ?? null]
        );
      }
      for (const alloc of p.allocations || []) {
        tx.run(
          `INSERT INTO payment_allocations (id, source_type, source_id, source_ref, invoice_id, invoice_number, amount, allocated_at, allocated_by, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [alloc.id || genId('alloc'), alloc.source_type || 'payment', id, alloc.source_ref || p.payment_number || null,
           alloc.invoice_id, alloc.invoice_number ?? null, alloc.amount, alloc.allocated_at ?? now(), alloc.allocated_by ?? p.recorded_by ?? null, alloc.notes ?? null]
        );
      }
      return this.byId(id);
    });
  },
  update(id: string, updates: any): any | null {
    const db = requireEngine();
    return db.withTransaction((tx) => {
      const allowed = ['payment_number', 'receipt_number', 'invoice_id', 'invoice_number', 'case_id', 'case_number', 'lab_id', 'lab_name',
        'amount', 'payment_method', 'payment_date', 'reference_number', 'notes', 'status', 'unapplied_amount', 'is_reversed',
        'reversal_reason', 'reversed_at', 'reversed_by', 'journal_id'] as const;
      const sets: string[] = [];
      const params: any[] = [];
      for (const key of allowed) {
        if (key in updates) {
          sets.push(`${key} = ?`);
          params.push(typeof updates[key] === 'boolean' ? (updates[key] ? 1 : 0) : updates[key] ?? null);
        }
      }
      if (sets.length) {
        params.push(id);
        tx.run(`UPDATE payments SET ${sets.join(', ')} WHERE id = ?`, params);
      }
      if (updates.attachments) {
        tx.run('DELETE FROM payment_attachments WHERE payment_id = ?', [id]);
        for (const att of updates.attachments) {
          tx.run(
            `INSERT INTO payment_attachments (id, payment_id, filename, file_type, file_size, file_url, uploaded_at, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [att.id || genId('pa'), id, att.file_name, att.file_type, att.file_size ?? null, att.file_url, att.uploaded_at ?? now(), att.uploaded_by ?? null]
          );
        }
      }
      if (updates.allocations) {
        tx.run('DELETE FROM payment_allocations WHERE source_id = ?', [id]);
        for (const alloc of updates.allocations) {
          tx.run(
            `INSERT INTO payment_allocations (id, source_type, source_id, source_ref, invoice_id, invoice_number, amount, allocated_at, allocated_by, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [alloc.id || genId('alloc'), alloc.source_type || 'payment', id, alloc.source_ref || null,
             alloc.invoice_id, alloc.invoice_number ?? null, alloc.amount, alloc.allocated_at ?? now(), alloc.allocated_by ?? null, alloc.notes ?? null]
          );
        }
      }
      return this.byId(id);
    });
  },
  delete(id: string): boolean {
    const before = requireEngine().rowCount('payments');
    requireEngine().run('DELETE FROM payments WHERE id = ?', [id]);
    return requireEngine().rowCount('payments') < before;
  },
};

export const paymentAttachmentsRepo = {
  byPayment(paymentId: string): any[] {
    return requireEngine().all('SELECT * FROM payment_attachments WHERE payment_id = ? ORDER BY uploaded_at', [paymentId]);
  },
  insert(att: { payment_id: string; file_name: string; file_type: string; file_size?: string; file_url: string; uploaded_by?: string }): any {
    const id = genId('pa');
    requireEngine().run(
      `INSERT INTO payment_attachments (id, payment_id, filename, file_type, file_size, file_url, uploaded_at, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, att.payment_id, att.file_name, att.file_type, att.file_size ?? null, att.file_url, now(), att.uploaded_by ?? null]
    );
    return requireEngine().get('SELECT * FROM payment_attachments WHERE id = ?', [id]);
  },
  delete(id: string): void {
    requireEngine().run('DELETE FROM payment_attachments WHERE id = ?', [id]);
  },
};

// ─────────────────────────────────────────────────────────── advance payments

export interface AdvanceRow {
  id: string;
  payment_number: string;
  receipt_number?: string | null;
  lab_id: string;
  lab_name: string;
  amount: number;
  allocated_amount: number;
  remaining_amount: number;
  payment_method: string;
  payment_date: string;
  reference_number?: string | null;
  notes?: string | null;
  recorded_by: string;
  status: string;
  is_reversed: number;
  journal_id?: string | null;
  created_at: string;
}

function advanceToDomain(row: AdvanceRow, db: Db): any {
  return {
    ...row,
    is_reversed: !!row.is_reversed,
    attachments: db.all('SELECT * FROM payment_attachments WHERE payment_id = ? ORDER BY uploaded_at', [row.id]),
    allocations: db.all(
      'SELECT * FROM advance_allocations WHERE advance_id = ? ORDER BY allocated_at',
      [row.id]
    ),
  };
}

export const advancePaymentsRepo = {
  all(): any[] {
    const db = requireEngine();
    return db.all<AdvanceRow>('SELECT * FROM advance_payments ORDER BY payment_date DESC, created_at DESC').map((r) => advanceToDomain(r, db));
  },
  byId(id: string): any | undefined {
    const db = requireEngine();
    const row = db.get<AdvanceRow>('SELECT * FROM advance_payments WHERE id = ?', [id]);
    return row ? advanceToDomain(row, db) : undefined;
  },
  insert(a: any): any {
    const db = requireEngine();
    return db.withTransaction((tx) => {
      const id = a.id || genId('adv');
      tx.run(
        `INSERT INTO advance_payments (id, payment_number, receipt_number, lab_id, lab_name, amount, allocated_amount, remaining_amount,
                                       payment_method, payment_date, reference_number, notes, recorded_by, status, is_reversed, journal_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, a.payment_number, a.receipt_number ?? null, a.lab_id, a.lab_name, a.amount,
         a.allocated_amount ?? 0, a.remaining_amount ?? Math.max(0, (a.amount ?? 0) - (a.allocated_amount ?? 0)),
         a.payment_method, a.payment_date, a.reference_number ?? null, a.notes ?? null, a.recorded_by,
         a.status ?? 'available', a.is_reversed ? 1 : 0, a.journal_id ?? null, a.created_at ?? now()]
      );
      for (const att of a.attachments || []) {
        tx.run(
          `INSERT INTO payment_attachments (id, payment_id, filename, file_type, file_size, file_url, uploaded_at, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [att.id || genId('pa'), id, att.file_name, att.file_type, att.file_size ?? null, att.file_url, att.uploaded_at ?? now(), att.uploaded_by ?? null]
        );
      }
      for (const alloc of a.allocations || []) {
        tx.run(
          `INSERT INTO advance_allocations (id, advance_id, invoice_id, amount, allocated_at, allocated_by, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [alloc.id || genId('aa'), id, alloc.invoice_id, alloc.amount, alloc.allocated_at ?? now(), alloc.allocated_by ?? a.recorded_by ?? null, alloc.notes ?? null]
        );
      }
      return this.byId(id);
    });
  },
  update(id: string, updates: any): any | null {
    const db = requireEngine();
    return db.withTransaction((tx) => {
      const allowed = ['receipt_number', 'amount', 'allocated_amount', 'remaining_amount', 'payment_method', 'payment_date',
        'reference_number', 'notes', 'status', 'is_reversed', 'reversal_reason', 'reversed_at', 'reversed_by', 'journal_id'] as const;
      const sets: string[] = [];
      const params: any[] = [];
      for (const key of allowed) {
        if (key in updates) {
          sets.push(`${key} = ?`);
          params.push(typeof updates[key] === 'boolean' ? (updates[key] ? 1 : 0) : updates[key] ?? null);
        }
      }
      if (sets.length) {
        params.push(id);
        tx.run(`UPDATE advance_payments SET ${sets.join(', ')} WHERE id = ?`, params);
      }
      if (updates.attachments) {
        tx.run('DELETE FROM payment_attachments WHERE payment_id = ?', [id]);
        for (const att of updates.attachments) {
          tx.run(
            `INSERT INTO payment_attachments (id, payment_id, filename, file_type, file_size, file_url, uploaded_at, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [att.id || genId('pa'), id, att.file_name, att.file_type, att.file_size ?? null, att.file_url, att.uploaded_at ?? now(), att.uploaded_by ?? null]
          );
        }
      }
      return this.byId(id);
    });
  },
  delete(id: string): boolean {
    const before = requireEngine().rowCount('advance_payments');
    requireEngine().run('DELETE FROM advance_payments WHERE id = ?', [id]);
    return requireEngine().rowCount('advance_payments') < before;
  },
  addAllocation(advanceId: string, invoiceId: string, amount: number, by?: string): void {
    const db = requireEngine();
    db.run(
      `INSERT INTO advance_allocations (id, advance_id, invoice_id, amount, allocated_at, allocated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [genId('aa'), advanceId, invoiceId, amount, now(), by ?? null]
    );
  },
};

// ─────────────────────────────────────────────────────────── account adjustments

export interface AdjustmentRow {
  id: string;
  adjustment_number: string;
  credit_note_number?: string | null;
  lab_id: string;
  lab_name: string;
  type: string;
  amount: number;
  reason: string;
  date: string;
  reference_number?: string | null;
  invoice_id?: string | null;
  invoice_number?: string | null;
  notes?: string | null;
  recorded_by: string;
  approved_by?: string | null;
  status: string;
  is_reversed: number;
  journal_id?: string | null;
  created_at: string;
}

function adjustmentToDomain(row: AdjustmentRow, db: Db): any {
  return {
    ...row,
    is_reversed: !!row.is_reversed,
    attachments: db.all(
      'SELECT * FROM payment_attachments WHERE payment_id = ? ORDER BY uploaded_at',
      [row.id]
    ),
  };
}

export const adjustmentsRepo = {
  all(): any[] {
    const db = requireEngine();
    return db.all<AdjustmentRow>('SELECT * FROM account_adjustments ORDER BY date DESC, created_at DESC').map((r) => adjustmentToDomain(r, db));
  },
  byId(id: string): any | undefined {
    const db = requireEngine();
    const row = db.get<AdjustmentRow>('SELECT * FROM account_adjustments WHERE id = ?', [id]);
    return row ? adjustmentToDomain(row, db) : undefined;
  },
  insert(a: any): any {
    const db = requireEngine();
    return db.withTransaction((tx) => {
      const id = a.id || genId('adj');
      tx.run(
        `INSERT INTO account_adjustments (id, adjustment_number, credit_note_number, lab_id, lab_name, type, amount, reason, date,
                                          reference_number, invoice_id, invoice_number, notes, recorded_by, approved_by, status, is_reversed, journal_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, a.adjustment_number, a.credit_note_number ?? null, a.lab_id, a.lab_name, a.type, a.amount, a.reason, a.date,
         a.reference_number ?? null, a.invoice_id ?? null, a.invoice_number ?? null, a.notes ?? null, a.recorded_by,
         a.approved_by ?? null, a.status ?? 'posted', a.is_reversed ? 1 : 0, a.journal_id ?? null, a.created_at ?? now()]
      );
      for (const att of a.attachments || []) {
        tx.run(
          `INSERT INTO payment_attachments (id, payment_id, filename, file_type, file_size, file_url, uploaded_at, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [att.id || genId('pa'), id, att.file_name, att.file_type, att.file_size ?? null, att.file_url, att.uploaded_at ?? now(), att.uploaded_by ?? null]
        );
      }
      return this.byId(id);
    });
  },
  update(id: string, updates: any): any | null {
    const db = requireEngine();
    return db.withTransaction((tx) => {
      const allowed = ['status', 'is_reversed', 'reversal_reason', 'reversed_at', 'reversed_by', 'journal_id', 'approved_by'] as const;
      const sets: string[] = [];
      const params: any[] = [];
      for (const key of allowed) {
        if (key in updates) {
          sets.push(`${key} = ?`);
          params.push(typeof updates[key] === 'boolean' ? (updates[key] ? 1 : 0) : updates[key] ?? null);
        }
      }
      if (sets.length) {
        params.push(id);
        tx.run(`UPDATE account_adjustments SET ${sets.join(', ')} WHERE id = ?`, params);
      }
      return this.byId(id);
    });
  },
  delete(id: string): boolean {
    const before = requireEngine().rowCount('account_adjustments');
    requireEngine().run('DELETE FROM account_adjustments WHERE id = ?', [id]);
    return requireEngine().rowCount('account_adjustments') < before;
  },
};

// ─────────────────────────────────────────────────────────── journal

export interface JournalRow {
  id: string;
  journal_number: string;
  date: string;
  event_type: string;
  reference_type?: string | null;
  reference_id?: string | null;
  reference_number?: string | null;
  lab_id?: string | null;
  lab_name?: string | null;
  description: string;
  created_at: string;
  created_by: string;
}

function journalToDomain(row: JournalRow, db: Db): any {
  const lines = db.all(
    'SELECT * FROM journal_lines WHERE journal_id = ? ORDER BY rowid',
    [row.id]
  );
  return { ...row, lines };
}

export const journalRepo = {
  all(): any[] {
    const db = requireEngine();
    return db.all<JournalRow>('SELECT * FROM journal_entries ORDER BY date DESC, created_at DESC').map((r) => journalToDomain(r, db));
  },
  byId(id: string): any | undefined {
    const db = requireEngine();
    const row = db.get<JournalRow>('SELECT * FROM journal_entries WHERE id = ?', [id]);
    return row ? journalToDomain(row, db) : undefined;
  },
  forEntity(referenceId: string): any[] {
    const db = requireEngine();
    return db.all<JournalRow>(
      'SELECT * FROM journal_entries WHERE reference_id = ? ORDER BY created_at ASC',
      [referenceId]
    ).map((r) => journalToDomain(r, db));
  },
  insert(entry: any): any {
    const db = requireEngine();
    return db.withTransaction((tx) => {
      const id = entry.id || genId('je');
      tx.run(
        `INSERT INTO journal_entries (id, journal_number, date, event_type, reference_type, reference_id, reference_number, lab_id, lab_name, description, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, entry.journal_number, entry.date, entry.event_type, entry.reference_type ?? null, entry.reference_id ?? null,
         entry.reference_number ?? null, entry.lab_id ?? null, entry.lab_name ?? null, entry.description,
         entry.created_at ?? now(), entry.created_by]
      );
      for (const line of entry.lines || []) {
        tx.run(
          `INSERT INTO journal_lines (id, journal_id, account_code, account_name, account_type, debit, credit, description, lab_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [line.id || genId('jl'), id, line.account_code, line.account_name, line.account_type,
           line.debit ?? 0, line.credit ?? 0, line.description ?? null, line.lab_name ?? null]
        );
      }
      return this.byId(id);
    });
  },
  delete(id: string): void {
    requireEngine().run('DELETE FROM journal_entries WHERE id = ?', [id]);
  },
};

// ─────────────────────────────────────────────────────────── ledger

export interface LedgerRow {
  id: string;
  date: string;
  lab_id?: string | null;
  lab_name?: string | null;
  entry_type: string;
  reference_id: string;
  reference_number?: string | null;
  case_number?: string | null;
  doctor_name?: string | null;
  description: string;
  debit: number;
  credit: number;
  running_balance?: number | null;
  payment_method?: string | null;
  notes?: string | null;
  recorded_by?: string | null;
  journal_id?: string | null;
  created_at: string;
}

export const ledgerRepo = {
  all(): any[] {
    return requireEngine().all<LedgerRow>('SELECT * FROM ledger_entries ORDER BY date ASC, created_at ASC')
      .map((r) => ({ ...r, running_balance: r.running_balance ?? undefined }));
  },
  byLab(labId: string): any[] {
    return requireEngine().all<LedgerRow>(
      'SELECT * FROM ledger_entries WHERE lab_id = ? ORDER BY date ASC, created_at ASC',
      [labId]
    );
  },
  insert(entry: Omit<LedgerRow, 'id' | 'created_at' | 'running_balance'> & { id?: string; created_at?: string }): LedgerRow {
    const db = requireEngine();
    const id = entry.id || genId('led');
    db.run(
      `INSERT INTO ledger_entries (id, date, lab_id, lab_name, entry_type, reference_id, reference_number, case_number, doctor_name,
                                   description, debit, credit, payment_method, notes, recorded_by, journal_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, entry.date, entry.lab_id ?? null, entry.lab_name ?? null, entry.entry_type, entry.reference_id,
       entry.reference_number ?? null, entry.case_number ?? null, entry.doctor_name ?? null,
       entry.description, entry.debit ?? 0, entry.credit ?? 0, entry.payment_method ?? null,
       entry.notes ?? null, entry.recorded_by ?? null, entry.journal_id ?? null, entry.created_at ?? now()]
    );
    return db.get<LedgerRow>('SELECT * FROM ledger_entries WHERE id = ?', [id])!;
  },
  deleteForRef(entryType: string, referenceId: string): void {
    requireEngine().run('DELETE FROM ledger_entries WHERE entry_type = ? AND reference_id = ?', [entryType, referenceId]);
  },
  allRows(): LedgerRow[] {
    return this.all();
  },
  clear(): void {
    requireEngine().run('DELETE FROM ledger_entries');
  },
  /** Recomputes per-lab running balances deterministically (ordered by date, then insertion). */
  recomputeRunningBalance(): void {
    const db = requireEngine();
    db.withTransaction((tx) => {
      const rows = tx.all<{ id: string; lab_id: string | null; debit: number; credit: number }>(
        'SELECT id, lab_id, debit, credit FROM ledger_entries ORDER BY date ASC, created_at ASC, id ASC'
      );
      const balances = new Map<string, number>();
      for (const r of rows) {
        const key = r.lab_id || '_global';
        const bal = (balances.get(key) ?? 0) + (r.debit || 0) - (r.credit || 0);
        balances.set(key, bal);
        tx.run('UPDATE ledger_entries SET running_balance = ? WHERE id = ?', [bal, r.id]);
      }
    });
  },
};

// ─────────────────────────────────────────────────────────── reconciliation

export interface ReconciliationRow {
  id: string;
  payment_id?: string | null;
  reference_number?: string | null;
  method: string;
  amount: number;
  date: string;
  lab_id?: string | null;
  lab_name?: string | null;
  invoice_id?: string | null;
  invoice_number?: string | null;
  status: string;
  exception_reason?: string | null;
  notes?: string | null;
  proof_url?: string | null;
  verified_at?: string | null;
  verified_by?: string | null;
  created_at: string;
}

export const reconciliationRepo = {
  all(): ReconciliationRow[] {
    return requireEngine().all<ReconciliationRow>('SELECT * FROM reconciliation_items ORDER BY date DESC');
  },
  insert(item: Omit<ReconciliationRow, 'created_at'> & { created_at?: string }): ReconciliationRow {
    requireEngine().run(
      `INSERT INTO reconciliation_items (id, payment_id, reference_number, method, amount, date, lab_id, lab_name, invoice_id, invoice_number, status, exception_reason, notes, proof_url, verified_at, verified_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.id, item.payment_id ?? null, item.reference_number ?? null, item.method, item.amount, item.date,
       item.lab_id ?? null, item.lab_name ?? null, item.invoice_id ?? null, item.invoice_number ?? null,
       item.status ?? 'unmatched', item.exception_reason ?? null, item.notes ?? null, item.proof_url ?? null,
       item.verified_at ?? null, item.verified_by ?? null, item.created_at ?? now()]
    );
    return requireEngine().get<ReconciliationRow>('SELECT * FROM reconciliation_items WHERE id = ?', [item.id])!;
  },
  update(id: string, updates: Partial<ReconciliationRow>): void {
    const allowed = ['status', 'exception_reason', 'notes', 'invoice_id', 'invoice_number', 'verified_at', 'verified_by'] as const;
    const sets: string[] = [];
    const params: any[] = [];
    for (const key of allowed) {
      if (key in updates) {
        sets.push(`${key} = ?`);
        params.push((updates as any)[key] ?? null);
      }
    }
    if (!sets.length) return;
    params.push(id);
    requireEngine().run(`UPDATE reconciliation_items SET ${sets.join(', ')} WHERE id = ?`, params);
  },
  delete(id: string): void {
    requireEngine().run('DELETE FROM reconciliation_items WHERE id = ?', [id]);
  },
  clear(): void {
    requireEngine().run('DELETE FROM reconciliation_items');
  },
};

// ─────────────────────────────────────────────────────────── notifications

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string;
  case_id?: string | null;
  case_number?: string | null;
  invoice_id?: string | null;
  lab_id?: string | null;
  read: number;
  is_archived: number;
  priority?: string | null;
  link_url?: string | null;
  created_at: string;
}

function notifToDomain(row: NotificationRow): any {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    case_id: row.case_id ?? undefined,
    case_number: row.case_number ?? undefined,
    invoice_id: row.invoice_id ?? undefined,
    lab_id: row.lab_id ?? undefined,
    read: !!row.read,
    is_read: !!row.read,
    is_archived: !!row.is_archived,
    priority: row.priority ?? undefined,
    link_url: row.link_url ?? undefined,
    created_at: row.created_at,
  };
}

export const notificationsRepo = {
  all(): any[] {
    return requireEngine().all<NotificationRow>('SELECT * FROM notifications ORDER BY created_at DESC').map(notifToDomain);
  },
  insert(n: any): any {
    const id = n.id || genId('notif');
    requireEngine().run(
      `INSERT INTO notifications (id, type, title, message, case_id, case_number, invoice_id, lab_id, read, is_archived, priority, link_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, n.type, n.title, n.message, n.case_id ?? null, n.case_number ?? null, n.invoice_id ?? null,
       n.lab_id ?? null, (n.read ?? n.is_read) ? 1 : 0, n.is_archived ? 1 : 0, n.priority ?? null, n.link_url ?? null, n.created_at ?? now()]
    );
    return requireEngine().get('SELECT * FROM notifications WHERE id = ?', [id]);
  },
  markRead(id: string, isRead: boolean): void {
    requireEngine().run('UPDATE notifications SET read = ? WHERE id = ?', [isRead ? 1 : 0, id]);
  },
  markAllRead(): void {
    requireEngine().run('UPDATE notifications SET read = 1');
  },
  setArchived(id: string, archived: boolean): void {
    requireEngine().run('UPDATE notifications SET is_archived = ? WHERE id = ?', [archived ? 1 : 0, id]);
  },
  delete(id: string): void {
    requireEngine().run('DELETE FROM notifications WHERE id = ?', [id]);
  },
  clear(): void {
    requireEngine().run('DELETE FROM notifications');
  },
};

// ─────────────────────────────────────────────────────────── case templates

export interface CaseTemplateRow {
  id: string;
  template_name: string;
  case_type_id?: string | null;
  case_type_name?: string | null;
  description?: string | null;
  selected_teeth: string;
  shade?: string | null;
  instructions?: string | null;
  default_priority: string;
  created_at: string;
}

export const caseTemplatesRepo = {
  all(): CaseTemplateRow[] {
    return requireEngine().all<CaseTemplateRow>('SELECT * FROM case_templates ORDER BY created_at DESC');
  },
  insert(t: any): CaseTemplateRow {
    const id = t.id || genId('tpl');
    requireEngine().run(
      `INSERT INTO case_templates (id, template_name, case_type_id, case_type_name, description, selected_teeth, shade, instructions, default_priority, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, t.template_name, t.case_type_id ?? null, t.case_type_name ?? null, t.description ?? null,
       JSON.stringify(Array.isArray(t.selected_teeth) ? t.selected_teeth : []), t.shade ?? null,
       t.instructions ?? null, t.default_priority ?? 'normal', t.created_at ?? now()]
    );
    return requireEngine().get<CaseTemplateRow>('SELECT * FROM case_templates WHERE id = ?', [id])!;
  },
  delete(id: string): boolean {
    const before = requireEngine().rowCount('case_templates');
    requireEngine().run('DELETE FROM case_templates WHERE id = ?', [id]);
    return requireEngine().rowCount('case_templates') < before;
  },
};

// ─────────────────────────────────────────────────────────── vouchers

export interface VoucherRow {
  id: string;
  voucher_number: string;
  voucher_type: string;
  case_id: string;
  case_number?: string | null;
  lab_name?: string | null;
  doctor_name?: string | null;
  patient_name?: string | null;
  case_type_name?: string | null;
  amount?: number | null;
  saved_by: string;
  notes?: string | null;
  created_at: string;
}

export const vouchersRepo = {
  all(): VoucherRow[] {
    return requireEngine().all<VoucherRow>('SELECT * FROM saved_vouchers ORDER BY created_at DESC');
  },
  insert(v: Omit<VoucherRow, 'created_at'> & { created_at?: string }): VoucherRow {
    requireEngine().run(
      `INSERT INTO saved_vouchers (id, voucher_number, voucher_type, case_id, case_number, lab_name, doctor_name, patient_name, case_type_name, amount, saved_by, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [v.id, v.voucher_number, v.voucher_type, v.case_id, v.case_number ?? null, v.lab_name ?? null,
       v.doctor_name ?? null, v.patient_name ?? null, v.case_type_name ?? null, v.amount ?? null,
       v.saved_by, v.notes ?? null, v.created_at ?? now()]
    );
    return requireEngine().get<VoucherRow>('SELECT * FROM saved_vouchers WHERE id = ?', [v.id])!;
  },
  delete(id: string): boolean {
    const before = requireEngine().rowCount('saved_vouchers');
    requireEngine().run('DELETE FROM saved_vouchers WHERE id = ?', [id]);
    return requireEngine().rowCount('saved_vouchers') < before;
  },
};

// ─────────────────────────────────────────────────────────── audit

export interface AuditRow {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_ref?: string | null;
  reason?: string | null;
  old_state?: string | null;
  new_state?: string | null;
  notes?: string | null;
}

export const auditRepo = {
  all(): any[] {
    return requireEngine().all<AuditRow>('SELECT * FROM audit_events ORDER BY timestamp DESC').map((r) => ({
      ...r,
      entity_ref: r.entity_ref ?? undefined,
    }));
  },
  log(event: {
    actor?: string;
    action: string;
    entity_type: string;
    entity_id: string;
    entity_ref?: string;
    reason?: string;
    notes?: string;
    old_state?: any;
    new_state?: any;
    timestamp?: string;
  }): AuditRow {
    const id = genId('aud');
    requireEngine().run(
      `INSERT INTO audit_events (id, timestamp, actor, action, entity_type, entity_id, entity_ref, reason, old_state, new_state, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, event.timestamp ?? now(), event.actor ?? 'System', event.action, event.entity_type, event.entity_id,
       event.entity_ref ?? null, event.reason ?? null,
       event.old_state ? JSON.stringify(event.old_state) : null,
       event.new_state ? JSON.stringify(event.new_state) : null,
       event.notes ?? null]
    );
    return requireEngine().get<AuditRow>('SELECT * FROM audit_events WHERE id = ?', [id])!;
  },
  forEntity(entityId: string): any[] {
    return requireEngine().all<AuditRow>('SELECT * FROM audit_events WHERE entity_id = ? ORDER BY timestamp DESC', [entityId]);
  },
  clear(): void {
    requireEngine().run('DELETE FROM audit_events');
  },
};

// ─────────────────────────────────────────────────────────── settings & config

export const settingsRepo = {
  get(namespace: string, key: string): any | undefined {
    const row = requireEngine().get<{ value: string }>('SELECT value FROM settings WHERE namespace = ? AND key = ?', [namespace, key]);
    if (!row) return undefined;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  },
  set(namespace: string, key: string, value: any): void {
    requireEngine().run(
      `INSERT INTO settings (namespace, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [namespace, key, JSON.stringify(value), now()]
    );
  },
  all(namespace: string): Record<string, any> {
    const rows = requireEngine().all<{ key: string; value: string }>('SELECT key, value FROM settings WHERE namespace = ?', [namespace]);
    const out: Record<string, any> = {};
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.value);
      } catch {
        out[r.key] = r.value;
      }
    }
    return out;
  },
  deleteNamespace(namespace: string): void {
    requireEngine().run('DELETE FROM settings WHERE namespace = ?', [namespace]);
  },
};

export const notificationConfigRepo = {
  get(): any | undefined {
    const row = requireEngine().get<{ config_json: string }>('SELECT config_json FROM notification_config WHERE id = 1');
    return row ? JSON.parse(row.config_json) : undefined;
  },
  set(config: any): void {
    requireEngine().run(
      `INSERT INTO notification_config (id, config_json, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`,
      [JSON.stringify(config), now()]
    );
  },
};

export const emailTemplatesRepo = {
  all(): any[] {
    return requireEngine().all('SELECT * FROM email_templates ORDER BY key');
  },
  upsert(t: any): void {
    requireEngine().run(
      `INSERT INTO email_templates (id, key, name, subject, body_text, button_text, logo_url, color_scheme, footer_text, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET name = excluded.name, subject = excluded.subject, body_text = excluded.body_text,
         button_text = excluded.button_text, logo_url = excluded.logo_url, color_scheme = excluded.color_scheme,
         footer_text = excluded.footer_text, updated_at = excluded.updated_at`,
      [t.id, t.key, t.name, t.subject, t.body_text, t.button_text ?? null, t.logo_url ?? null,
       t.color_scheme ?? null, t.footer_text ?? null, t.updated_at ?? now()]
    );
  },
  resetToDefault(t: any): void {
    this.upsert(t);
  },
  deleteAll(): void {
    requireEngine().run('DELETE FROM email_templates');
  },
};

// ─────────────────────────────────────────────────────────── clinical specs

export const clinicalSpecsRepo = {
  materials: {
    all: () => requireEngine().all('SELECT * FROM clinical_materials ORDER BY name'),
    insert: (m: any) =>
      requireEngine().run(
        'INSERT OR REPLACE INTO clinical_materials (id, name, category, description, is_active, price_modifier) VALUES (?, ?, ?, ?, ?, ?)',
        [m.id, m.name, m.category, m.description ?? null, m.is_active ? 1 : 0, m.price_modifier ?? null]
      ),
    deleteAll: () => requireEngine().run('DELETE FROM clinical_materials'),
  },
  prepTypes: {
    all: () => requireEngine().all('SELECT * FROM clinical_prep_types ORDER BY name'),
    insert: (p: any) =>
      requireEngine().run(
        'INSERT OR REPLACE INTO clinical_prep_types (id, name, code, description, is_active) VALUES (?, ?, ?, ?, ?)',
        [p.id, p.name, p.code ?? null, p.description ?? null, p.is_active ? 1 : 0]
      ),
    deleteAll: () => requireEngine().run('DELETE FROM clinical_prep_types'),
  },
  shadeGuides: {
    all: () =>
      requireEngine().all<{ id: string; name: string; system: string; shades: string }>('SELECT * FROM shade_guides ORDER BY name')
        .map((r) => ({ ...r, shades: JSON.parse(r.shades || '[]') })),
    insert: (g: any) =>
      requireEngine().run(
        'INSERT OR REPLACE INTO shade_guides (id, name, system, shades) VALUES (?, ?, ?, ?)',
        [g.id, g.name, g.system, JSON.stringify(g.shades || [])]
      ),
    deleteAll: () => requireEngine().run('DELETE FROM shade_guides'),
  },
  implantBrands: {
    all: () =>
      requireEngine().all<{ id: string; name: string; country?: string | null; popular_models?: string | null; is_active: number }>('SELECT * FROM implant_brands ORDER BY name')
        .map((r) => ({ ...r, popular_models: r.popular_models ? JSON.parse(r.popular_models) : [], is_active: !!r.is_active })),
    insert: (b: any) =>
      requireEngine().run(
        'INSERT OR REPLACE INTO implant_brands (id, name, country, popular_models, is_active) VALUES (?, ?, ?, ?, ?)',
        [b.id, b.name, b.country ?? null, JSON.stringify(b.popular_models || []), b.is_active ? 1 : 0]
      ),
    deleteAll: () => requireEngine().run('DELETE FROM implant_brands'),
  },
};

// ─────────────────────────────────────────────────────────── chairside appointments

export interface ChairsideRow {
  id: string;
  time: string;
  period: string;
  patient: string;
  doctor: string;
  clinic: string;
  procedure: string;
  tooth?: string | null;
  shade?: string | null;
  status: string;
  case_ref?: string | null;
  created_at: string;
}

export const chairsideRepo = {
  all(): ChairsideRow[] {
    return requireEngine().all<ChairsideRow>('SELECT * FROM chairside_appointments ORDER BY created_at DESC');
  },
  insert(a: Omit<ChairsideRow, 'created_at'> & { created_at?: string }): ChairsideRow {
    requireEngine().run(
      `INSERT INTO chairside_appointments (id, time, period, patient, doctor, clinic, procedure, tooth, shade, status, case_ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [a.id, a.time, a.period, a.patient, a.doctor, a.clinic, a.procedure, a.tooth ?? null, a.shade ?? null,
       a.status ?? 'confirmed', a.case_ref ?? null, a.created_at ?? now()]
    );
    return requireEngine().get<ChairsideRow>('SELECT * FROM chairside_appointments WHERE id = ?', [a.id])!;
  },
  update(id: string, updates: Partial<ChairsideRow>): void {
    const allowed = ['time', 'period', 'patient', 'doctor', 'clinic', 'procedure', 'tooth', 'shade', 'status', 'case_ref'] as const;
    const sets: string[] = [];
    const params: any[] = [];
    for (const key of allowed) {
      if (key in updates) {
        sets.push(`${key} = ?`);
        params.push((updates as any)[key] ?? null);
      }
    }
    if (!sets.length) return;
    params.push(id);
    requireEngine().run(`UPDATE chairside_appointments SET ${sets.join(', ')} WHERE id = ?`, params);
  },
  delete(id: string): void {
    requireEngine().run('DELETE FROM chairside_appointments WHERE id = ?', [id]);
  },
  clear(): void {
    requireEngine().run('DELETE FROM chairside_appointments');
  },
};

// ─────────────────────────────────────────────────────────── app meta & stats

export const appMetaRepo = {
  get(key: string): string | undefined {
    const row = requireEngine().get<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', [key]);
    return row?.value;
  },
  set(key: string, value: string): void {
    requireEngine().run(
      `INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value]
    );
  },
};

export interface DbStats {
  users: number;
  labs: number;
  case_types: number;
  cases: number;
  invoices: number;
  payments: number;
  payment_attachments: number;
  advance_payments: number;
  account_adjustments: number;
  journal_entries: number;
  ledger_entries: number;
  notifications: number;
  audit_events: number;
  attachments: number;
  invoice_items: number;
}

export const statsRepo = {
  all(): DbStats {
    const db = requireEngine();
    const tables: (keyof DbStats)[] = ['users', 'labs', 'case_types', 'cases', 'invoices', 'payments',
      'payment_attachments', 'advance_payments', 'account_adjustments', 'journal_entries', 'ledger_entries',
      'notifications', 'audit_events', 'attachments', 'invoice_items'];
    const out = {} as DbStats;
    for (const t of tables) {
      out[t] = db.rowCount(t);
    }
    return out;
  },
};
