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
  // The app ships with ZERO accounts. The operator-facing Super Admin is
  // created through the login screen's first-run setup flow, so the operator
  // chooses that credential. Legacy users are imported by legacyMigrator
  // when old data exists.

  // --- case types / catalog ---
  if (caseTypesRepo.all().length === 0) {
    for (const ct of INITIAL_CASE_TYPES) caseTypesRepo.insert(ct);
  } else {
    // Upgraded installs: fill ONLY the still-null specification fields on the
    // known shipped catalog rows. User-created rows and any non-null field are
    // never touched — real data always wins over shipped defaults.
    const byName = new Map(INITIAL_CASE_TYPES.map((ct) => [ct.name.toLowerCase(), ct]));
    for (const existing of caseTypesRepo.all()) {
      const spec = byName.get(String(existing.name || '').toLowerCase());
      if (!spec) continue;
      const patch: Record<string, string | number> = {};
      for (const key of ['material_system', 'unit_basis', 'shade_guide', 'indications', 'contraindications'] as const) {
        if (!existing[key] && spec[key]) patch[key] = spec[key];
      }
      for (const key of ['lead_time_days', 'warranty_months'] as const) {
        if ((existing[key] === undefined || existing[key] === null) && spec[key]) patch[key] = spec[key];
      }
      if (!existing.category && spec.category) patch.category = spec.category;
      if (Object.keys(patch).length > 0) caseTypesRepo.update(existing.id, patch);
    }
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
