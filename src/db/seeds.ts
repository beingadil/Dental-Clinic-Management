import { caseTypesRepo, emailTemplatesRepo, notificationConfigRepo, settingsRepo, clinicalSpecsRepo, appMetaRepo } from './repos';
import { ensureSequenceTable } from './sequences';
import { DEFAULT_MATERIALS, DEFAULT_PREP_TYPES, DEFAULT_SHADE_GUIDES, DEFAULT_IMPLANT_BRANDS } from '../services/clinicalSpecsService';
import {
  INITIAL_CASE_TYPES,
  INITIAL_NOTIFICATION_CONFIG,
  INITIAL_EMAIL_TEMPLATES,
  INITIAL_USER_PREFERENCES,
} from '../data/initialData';
import { DEFAULT_BRANDING_SETTINGS } from './defaults';

/**
 * Idempotent first-boot seeding. Only fills empty tables — never overwrites
 * user data. Runs after migrations, before the app renders.
 */

export async function seedDatabase(): Promise<void> {
  // --- users ---
  // Deliberately empty: no account (and no password) ships with the app. A fresh
  // profile provisions its first Super Admin through the login screen's setup
  // flow, so the operator chooses the credential. Legacy users are imported by
  // legacyMigrator when old data exists.

  // --- case types / catalog ---
  if (caseTypesRepo.all().length === 0) {
    for (const ct of INITIAL_CASE_TYPES) caseTypesRepo.insert(ct);
  }

  // --- clinical specs (materials, prep types, shade guides, implant brands) ---
  if (clinicalSpecsRepo.materials.all().length === 0) {
    for (const m of DEFAULT_MATERIALS) clinicalSpecsRepo.materials.insert(m);
  }
  if (clinicalSpecsRepo.prepTypes.all().length === 0) {
    for (const p of DEFAULT_PREP_TYPES) clinicalSpecsRepo.prepTypes.insert(p);
  }
  if (clinicalSpecsRepo.shadeGuides.all().length === 0) {
    for (const g of DEFAULT_SHADE_GUIDES) clinicalSpecsRepo.shadeGuides.insert(g);
  }
  if (clinicalSpecsRepo.implantBrands.all().length === 0) {
    for (const b of DEFAULT_IMPLANT_BRANDS) clinicalSpecsRepo.implantBrands.insert(b);
  }

  // --- settings namespaces ---
  if (settingsRepo.get('branding', 'settings') === undefined) {
    settingsRepo.set('branding', 'settings', DEFAULT_BRANDING_SETTINGS);
  }
  if (settingsRepo.get('preferences', 'global') === undefined) {
    settingsRepo.set('preferences', 'global', INITIAL_USER_PREFERENCES);
  }
  if (notificationConfigRepo.get() === undefined) {
    notificationConfigRepo.set(INITIAL_NOTIFICATION_CONFIG);
  }
  if (emailTemplatesRepo.all().length === 0) {
    for (const t of INITIAL_EMAIL_TEMPLATES) emailTemplatesRepo.upsert(t);
  }

  // --- document number sequences ---
  ensureSequenceTable();
  appMetaRepo.set('seeded_at', new Date().toISOString());
}
