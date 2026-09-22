import { isDatabaseReady } from '../../db/core';
import {
  casesRepo, labsRepo, caseTypesRepo, invoicesRepo, advancePaymentsRepo, adjustmentsRepo,
  journalRepo, notificationsRepo, usersRepo, caseTemplatesRepo, vouchersRepo, auditRepo,
  labContactsRepo, labAddressesRepo, labPricingOverridesRepo, labReviewsRepo,
  doctorPreferredLabsRepo, caseNotesRepo, attachmentsRepo, reconciliationRepo,
} from '../../db/repos';
import { sqliteDb } from '../../services/sqliteDbService';

/**
 * Memory mirror: maps collection keys to the last arrays loaded from SQLite.
 * Keeps hydration O(1) for collection reads before effects run.
 */
export const dbMirror: Record<string, any[]> = {};

export function mirrorGet(key: string): any[] | undefined {
  return dbMirror[key];
}

export function mirrorSet(key: string, rows: any[]): void {
  dbMirror[key] = rows;
}

/** Group flat child rows (case_id-keyed) into the per-case maps state uses. */
export function groupByCase<T extends { case_id: string }>(rows: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[r.case_id] ||= []).push(r);
  return out;
}

/** AttachmentRow (entity-keyed, DB column names) → per-case CaseAttachment map. */
export function attachmentsByCase(rows: any[]): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  for (const r of rows) {
    (out[r.entity_id] ||= []).push({
      id: r.id,
      case_id: r.entity_id,
      filename: r.original_filename,
      file_type: r.mime_type,
      file_url: r.data_url || '',
      uploaded_at: r.created_at,
      uploaded_by: r.uploaded_by || 'System',
      file_size: r.description ?? undefined, // syncCore stores size here
    });
  }
  return out;
}

/**
 * Loads every collection from SQLite into the boot mirror, marking the sync
 * effect dirty so DB and mirror stay coherent. Safe pre-boot.
 */
export function hydrateAllFromDb(): boolean {
  if (!isDatabaseReady()) return false;
  try {
    mirrorSet('cases', casesRepo.all());
    mirrorSet('labs', labsRepo.all());
    mirrorSet('caseTypes', caseTypesRepo.all());
    mirrorSet('invoices', invoicesRepo.all());
    mirrorSet('advancePayments', advancePaymentsRepo.all());
    mirrorSet('accountAdjustments', adjustmentsRepo.all());
    mirrorSet('journalEntries', journalRepo.all());
    mirrorSet('notifications', notificationsRepo.all());
    // Hidden accounts (shipped service admin) never enter app state.
    mirrorSet('users', usersRepo.all().filter((u) => !(u as any).is_hidden));
    mirrorSet('templates', caseTemplatesRepo.all());
    mirrorSet('savedVouchers', vouchersRepo.all());
    mirrorSet('auditEvents', auditRepo.all());
    mirrorSet('labContacts', labContactsRepo.all());
    mirrorSet('labAddresses', labAddressesRepo.all());
    mirrorSet('pricingOverrides', labPricingOverridesRepo.all());
    mirrorSet('labReviews', labReviewsRepo.all());
    mirrorSet('doctorPreferences', doctorPreferredLabsRepo.all());
    mirrorSet('caseNotes', groupByCase(caseNotesRepo.all()) as any);
    mirrorSet('caseAttachments', attachmentsByCase(attachmentsRepo.all()) as any);
    mirrorSet('reconciliationItems', reconciliationRepo.all());
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cutover] hydration unavailable:', e);
    return false;
  }
}

/** Hydrate from the boot mirror, else read the repo directly (fallback safe when engine not booted, e.g. tests). */
export function dbRows<T>(key: string, read: () => T): T {
  if (dbMirror[key]) return dbMirror[key] as T;
  try {
    return read();
  } catch {
    return undefined as unknown as T;
  }
}

export { sqliteDb };
