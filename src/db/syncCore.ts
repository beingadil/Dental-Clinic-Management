import { getDatabase, isDatabaseReady } from './core';

/**
 * Collection syncer: persists the AppContext collections into SQLite inside
 * ONE transaction (delete-and-replace per table, FK-safe ordering). This is
 * the write-through engine for the cutover: React state remains the UI
 * mirror, SQLite is the authoritative store, and the old parallel
 * localStorage writes are gone.
 *
 * Users are intentionally NOT synced here — credential rows are managed
 * exclusively through usersRepo with proper async hashing.
 */

export interface SyncCollections {
  cases: any[];
  labs: any[];
  caseTypes: any[];
  invoices: any[];
  advancePayments: any[];
  accountAdjustments: any[];
  journalEntries: any[];
  reconciliationItems: any[];
  notifications: any[];
  savedVouchers: any[];
  auditEvents: any[];
  templates: any[];
  labContacts: any[];
  labAddresses: any[];
  pricingOverrides: any[];
  labReviews: any[];
  doctorPreferences: any[];
  caseNotes: Record<string, any[]>;
  caseAttachments: Record<string, any[]>;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let lastError: string | null = null;

export function getLastSyncError(): string | null {
  return lastError;
}

/** Debounced entry point (called from a useEffect on every state change). */
export function syncCollectionsToDb(collections: SyncCollections): void {
  if (!isDatabaseReady()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    try {
      syncNow(collections);
      lastError = null;
    } catch (e: any) {
      lastError = e?.message || String(e);
      // eslint-disable-next-line no-console
      console.error('[sync] SQLite collection sync failed:', lastError);
    }
  }, 150);
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function syncNow(c: SyncCollections): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.withTransaction((tx) => {
    // ── labs (+ children) — parents of cases/invoices ──
    tx.run('DELETE FROM labs');
    for (const l of c.labs) {
      tx.run(
        `INSERT INTO labs (id, name, code, contact_person, phone, email, address, city, doctor_name, notes, rating, reviews_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [l.id, l.name, l.code ?? null, l.contact_person ?? null, l.phone ?? null, l.email ?? null,
         l.address ?? null, l.city ?? null, l.doctor_name ?? null, l.notes ?? null,
         l.rating ?? 5, l.reviews_count ?? 0, l.created_at ?? now, now]
      );
      for (const ct of c.labContacts.filter((x) => x.lab_id === l.id)) {
        tx.run(
          `INSERT OR REPLACE INTO lab_contacts (id, lab_id, name, phone, email, role, notes, is_primary, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [ct.id, l.id, ct.name ?? '', ct.phone ?? '', ct.email ?? null, ct.role ?? null,
           ct.notes ?? null, ct.is_primary ? 1 : 0, ct.created_at ?? now]
        );
      }
      for (const ad of c.labAddresses.filter((x) => x.lab_id === l.id)) {
        tx.run(
          `INSERT OR REPLACE INTO lab_addresses (id, lab_id, type, street, city, state, postal_code, country, is_default, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [ad.id, l.id, ad.type ?? 'lab_location', ad.street ?? '', ad.city ?? '', ad.state ?? '',
           ad.postal_code ?? '', ad.country ?? '', ad.is_default ? 1 : 0, ad.created_at ?? now]
        );
      }
      for (const po of c.pricingOverrides.filter((x) => x.lab_id === l.id)) {
        tx.run(
          `INSERT OR REPLACE INTO lab_pricing_overrides (id, lab_id, case_type_id, case_type_name, standard_price, custom_price, discount_percentage, effective_date, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [po.id, l.id, po.case_type_id ?? null, po.case_type_name ?? null, po.standard_price ?? 0,
           po.custom_price ?? 0, po.discount_percentage ?? null, po.effective_date ?? null, po.created_at ?? now]
        );
      }
      for (const rv of c.labReviews.filter((x) => x.lab_id === l.id)) {
        tx.run(
          `INSERT OR REPLACE INTO lab_reviews (id, lab_id, rating, review_text, reviewer_name, case_number, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [rv.id, l.id, rv.rating ?? 5, rv.review_text ?? null, rv.reviewer_name ?? 'Unknown',
           rv.case_number ?? null, rv.created_at ?? now]
        );
      }
    }
    tx.run('DELETE FROM doctor_preferred_labs');
    for (const d of c.doctorPreferences) {
      tx.run(
        `INSERT OR REPLACE INTO doctor_preferred_labs (id, doctor_name, lab_id, lab_name, created_at) VALUES (?, ?, ?, ?, ?)`,
        [d.id, d.doctor_name ?? '', d.lab_id, d.lab_name ?? '', d.created_at ?? now]
      );
    }

    // ── catalog ──
    tx.run('DELETE FROM case_types');
    for (const ct of c.caseTypes) {
      tx.run(
        `INSERT INTO case_types (id, name, base_price, category, lead_time_days, warranty_months, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ct.id, ct.name, ct.base_price ?? 0, ct.category ?? null, ct.lead_time_days ?? null,
         ct.warranty_months ?? null, ct.description ?? null, ct.created_at ?? now, now]
      );
    }

    // ── cases (+ teeth, history, notes, attachments) ──
    tx.run('DELETE FROM cases');
    // Child tables are wiped explicitly: the rebuild below re-inserts every row,
    // and FK cascade cannot be relied upon on every engine/connection.
    tx.run('DELETE FROM case_teeth');
    tx.run('DELETE FROM case_status_history');
    tx.run('DELETE FROM case_notes');
    tx.run("DELETE FROM attachments WHERE entity_type = 'case'");
    for (const cse of c.cases) {
      tx.run(
        `INSERT INTO cases (id, case_number, patient_name, lab_id, lab_name, case_type_id, case_type_name, units_count, doctor_name,
                            selected_teeth, tooth_details, shade, material, delivery_date, priority, price, discount, final_price,
                            instructions, photo_url, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [cse.id, cse.case_number, cse.patient_name ?? null, cse.lab_id, cse.lab_name,
         cse.case_type_id ?? null, cse.case_type_name ?? null, cse.units_count ?? null, cse.doctor_name ?? '',
         JSON.stringify(cse.selected_teeth ?? []), cse.tooth_details ? JSON.stringify(cse.tooth_details) : null,
         cse.shade ?? null, cse.material ?? null, cse.delivery_date, cse.priority ?? 'normal',
         cse.price ?? 0, cse.discount ?? 0, cse.final_price ?? 0, cse.instructions ?? null,
         cse.photo_url ?? null, cse.status ?? 'received', cse.created_at ?? now, cse.updated_at ?? now]
      );
      const details = cse.tooth_details || {};
      for (const tooth of cse.selected_teeth || []) {
        const d = details[tooth] || {};
        tx.run(
          `INSERT INTO case_teeth (case_id, tooth_number, shade, prep_type, material, notes, implant_brand, implant_size)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [cse.id, tooth, d.shade ?? null, d.prep_type ?? null, d.material ?? null,
           d.notes ?? null, d.implant_brand ?? null, d.implant_size ?? null]
        );
      }
      for (const h of cse.history || []) {
        tx.run(
          `INSERT INTO case_status_history (id, case_id, status, notes, timestamp, updated_by) VALUES (?, ?, ?, ?, ?, ?)`,
          [h.id || genId('h'), cse.id, h.status, h.notes ?? null, h.timestamp ?? now, h.updated_by ?? 'System']
        );
      }
      for (const n of c.caseNotes[cse.id] || []) {
        tx.run(
          `INSERT INTO case_notes (id, case_id, note_text, author, created_at) VALUES (?, ?, ?, ?, ?)`,
          [n.id, cse.id, n.note_text ?? '', n.author ?? 'System', n.created_at ?? now]
        );
      }
      for (const a of c.caseAttachments[cse.id] || []) {
        tx.run(
          `INSERT INTO attachments (id, entity_type, entity_id, original_filename, stored_filename, mime_type, size_bytes, checksum, description, storage_path, data_url, uploaded_by, created_at)
           VALUES (?, 'case', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [a.id, cse.id, a.filename ?? 'file', a.filename ?? 'file', a.file_type ?? 'application/octet-stream',
           null, null, a.file_size ?? null, `cases/${cse.id}/${a.id}`, a.file_url ?? '', a.uploaded_by ?? null, a.uploaded_at ?? now]
        );
      }
    }

    // ── case templates ──
    tx.run('DELETE FROM case_templates');
    for (const t of c.templates) {
      tx.run(
        `INSERT INTO case_templates (id, template_name, case_type_id, case_type_name, description, selected_teeth, shade, instructions, default_priority, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.id, t.template_name ?? 'Template', t.case_type_id ?? null, t.case_type_name ?? null,
         t.description ?? null, JSON.stringify(Array.isArray(t.selected_teeth) ? t.selected_teeth : []),
         t.shade ?? null, t.instructions ?? null, t.default_priority ?? 'normal', t.created_at ?? now]
      );
    }

    // ── invoices (+ payments + proof attachments) — after labs & cases ──
    tx.run('DELETE FROM invoices');
    // Payments and their proof attachments are fully rebuilt below (invoice
    // payments + advance payments), so they are wiped explicitly up front.
    tx.run('DELETE FROM payment_attachments');
    tx.run('DELETE FROM payments');
    for (const inv of c.invoices) {
      tx.run(
        `INSERT INTO invoices (id, invoice_number, case_id, case_number, lab_id, lab_name, case_type_id, case_type_name, doctor_name, patient_name,
                               amount, discount, final_amount, amount_paid, payment_status, status_v2, issue_date, due_date, journal_id, credit_notes_total, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [inv.id, inv.invoice_number, inv.case_id || null, inv.case_number || null, inv.lab_id, inv.lab_name,
         inv.case_type_id ?? null, inv.case_type_name ?? null, inv.doctor_name || null, inv.patient_name ?? null,
         inv.amount ?? 0, inv.discount ?? 0, inv.final_amount ?? 0, inv.amount_paid ?? 0,
         inv.payment_status ?? 'unpaid', inv.status_v2 ?? 'open', inv.issue_date ?? null,
         inv.due_date || null, inv.journal_id ?? null, inv.credit_notes_total ?? 0,
         inv.created_at ?? now, now]
      );
      (inv.payments || []).forEach((p: any, pIdx: number) => {
        const pid = p.id || `${inv.id}-p${pIdx}`;
        tx.run(
          `INSERT INTO payments (id, payment_number, receipt_number, invoice_id, invoice_number, case_id, case_number, lab_id, lab_name,
                                 amount, payment_method, payment_date, reference_number, notes, recorded_by, payment_type, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [pid, p.payment_number || null, p.receipt_number || null, inv.id, inv.invoice_number,
           p.case_id || inv.case_id || null, p.case_number || inv.case_number || null,
           p.lab_id || inv.lab_id, p.lab_name || inv.lab_name,
           p.amount, p.payment_method, p.payment_date, p.reference_number || null, p.notes || null,
           p.recorded_by || 'System', p.payment_type || 'invoice_payment', p.status ?? 'posted',
           p.created_at || p.payment_date || now]
        );
        for (const a of p.attachments || []) {
          tx.run(
            `INSERT INTO payment_attachments (id, payment_id, filename, file_type, file_size, file_url, uploaded_at, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [a.id || genId('pa'), pid, a.file_name ?? 'proof', a.file_type ?? 'application/octet-stream',
             a.file_size ?? null, a.file_url ?? '', a.uploaded_at ?? now, a.uploaded_by ?? null]
          );
        }
      });
    }

    // ── advances ──
    tx.run('DELETE FROM advance_payments');
    for (const adv of c.advancePayments) {
      tx.run(
        `INSERT INTO advance_payments (id, payment_number, receipt_number, lab_id, lab_name, amount, allocated_amount, remaining_amount,
                                       payment_method, payment_date, reference_number, notes, recorded_by, status, is_reversed, journal_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [adv.id, adv.payment_number, adv.receipt_number || null, adv.lab_id, adv.lab_name, adv.amount,
         adv.allocated_amount ?? 0, adv.remaining_amount ?? 0, adv.payment_method, adv.payment_date,
         adv.reference_number || null, adv.notes || null, adv.recorded_by, adv.status ?? 'available',
         adv.is_reversed ? 1 : 0, adv.journal_id ?? null, adv.created_at ?? now]
      );
      for (const a of adv.attachments || []) {
        tx.run(
          `INSERT INTO payment_attachments (id, payment_id, filename, file_type, file_size, file_url, uploaded_at, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [a.id || genId('pa'), adv.id, a.file_name ?? 'proof', a.file_type ?? 'application/octet-stream',
           a.file_size ?? null, a.file_url ?? '', a.uploaded_at ?? now, a.uploaded_by ?? null]
        );
      }
    }

    // ── adjustments ──
    tx.run('DELETE FROM account_adjustments');
    for (const adj of c.accountAdjustments) {
      tx.run(
        `INSERT INTO account_adjustments (id, adjustment_number, credit_note_number, lab_id, lab_name, type, amount, reason, date,
                                          reference_number, invoice_id, invoice_number, notes, recorded_by, approved_by, status, is_reversed, journal_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [adj.id, adj.adjustment_number, adj.credit_note_number || null, adj.lab_id, adj.lab_name,
         adj.type, adj.amount, adj.reason, adj.date, adj.reference_number || null,
         adj.invoice_id || null, adj.invoice_number || null, adj.notes || null, adj.recorded_by,
         adj.approved_by ?? null, adj.status ?? 'posted', adj.is_reversed ? 1 : 0,
         adj.journal_id ?? null, adj.created_at ?? now]
      );
      for (const a of adj.attachments || []) {
        tx.run(
          `INSERT INTO payment_attachments (id, payment_id, filename, file_type, file_size, file_url, uploaded_at, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [a.id || genId('pa'), adj.id, a.file_name ?? 'proof', a.file_type ?? 'application/octet-stream',
           a.file_size ?? null, a.file_url ?? '', a.uploaded_at ?? now, a.uploaded_by ?? null]
        );
      }
    }

    // ── journal ──
    tx.run('DELETE FROM journal_entries');
    for (const j of c.journalEntries) {
      tx.run(
        `INSERT INTO journal_entries (id, journal_number, date, event_type, reference_type, reference_id, reference_number, lab_id, lab_name, description, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [j.id, j.journal_number, j.date, j.event_type, j.reference_type || null, j.reference_id || null,
         j.reference_number || null, j.lab_id || null, j.lab_name || null, j.description,
         j.created_at ?? now, j.created_by]
      );
      for (const line of j.lines || []) {
        tx.run(
          `INSERT INTO journal_lines (id, journal_id, account_code, account_name, account_type, debit, credit, description, lab_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [line.id || genId('jl'), j.id, line.account_code, line.account_name, line.account_type,
           line.debit || 0, line.credit || 0, line.description || null, line.lab_name || null]
        );
      }
    }

    // ── reconciliation ──
    tx.run('DELETE FROM reconciliation_items');
    for (const r of c.reconciliationItems) {
      tx.run(
        `INSERT INTO reconciliation_items (id, payment_id, reference_number, method, amount, date, lab_id, lab_name, invoice_id, invoice_number, status, exception_reason, notes, proof_url, verified_at, verified_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.payment_id || null, r.reference_number || null, r.method, r.amount, r.date,
         r.lab_id || null, r.lab_name || null, r.invoice_id || null, r.invoice_number || null,
         r.status ?? 'unmatched', r.exception_reason || null, r.notes || null, r.proof_url || null,
         r.verified_at || null, r.verified_by || null, r.created_at ?? now]
      );
    }

    // ── vouchers ──
    tx.run('DELETE FROM saved_vouchers');
    for (const v of c.savedVouchers) {
      tx.run(
        `INSERT INTO saved_vouchers (id, voucher_number, voucher_type, case_id, case_number, lab_name, doctor_name, patient_name, case_type_name, amount, saved_by, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.id, v.voucher_number, v.voucher_type, v.case_id, v.case_number || null, v.lab_name || null,
         v.doctor_name || null, v.patient_name || null, v.case_type_name ?? null, v.amount ?? null,
         v.saved_by, v.notes || null, v.created_at ?? now]
      );
    }

    // ── notifications ──
    tx.run('DELETE FROM notifications');
    for (const n of c.notifications) {
      tx.run(
        `INSERT INTO notifications (id, type, title, message, case_id, case_number, invoice_id, lab_id, read, is_archived, priority, link_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [n.id, n.type, n.title, n.message, n.case_id || null, n.case_number || null,
         n.invoice_id || null, n.lab_id || null, (n.is_read || n.read) ? 1 : 0,
         n.is_archived ? 1 : 0, n.priority || null, n.link_url || null, n.created_at ?? now]
      );
    }

    // ── audit ──
    tx.run('DELETE FROM audit_events');
    for (const a of c.auditEvents) {
      tx.run(
        `INSERT INTO audit_events (id, timestamp, actor, action, entity_type, entity_id, entity_ref, reason, old_state, new_state, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [a.id, a.timestamp, a.actor, a.action, a.entity_type, a.entity_id, a.entity_ref || null,
         a.reason || null, a.old_state ? JSON.stringify(a.old_state) : null,
         a.new_state ? JSON.stringify(a.new_state) : null, a.notes || null]
      );
    }
  });
}
