export interface ClinicalMaterial {
  id: string;
  name: string;
  category: string; // 'zirconia' | 'glass_ceramic' | 'metal' | 'polymer' | 'hybrid'
  description?: string;
  is_active: boolean;
  price_modifier?: number;
}

export interface ClinicalPrepType {
  id: string;
  name: string;
  code?: string;
  description?: string;
  is_active: boolean;
}

export interface ClinicalShadeGuide {
  id: string;
  name: string;
  system: 'vita_classical' | 'vita_3d' | 'bleach' | 'custom';
  shades: string[];
}

export interface ClinicalImplantBrand {
  id: string;
  name: string;
  country?: string;
  popular_models?: string[];
  is_active: boolean;
}

export interface ClinicalSpecsState {
  materials: ClinicalMaterial[];
  prepTypes: ClinicalPrepType[];
  shadeGuides: ClinicalShadeGuide[];
  implantBrands: ClinicalImplantBrand[];
}

export const DEFAULT_MATERIALS: ClinicalMaterial[] = [
  { id: 'mat-1', name: 'Zirconia (Multi-layer 3D Pro)', category: 'zirconia', description: 'High aesthetics with gradient translucency for anterior & posterior restorations', is_active: true },
  { id: 'mat-2', name: 'High Translucency Zirconia (HT)', category: 'zirconia', description: 'Maximum flexural strength for long-span bridges & posterior crowns', is_active: true },
  { id: 'mat-3', name: 'IPS e.max CAD / Lithium Disilicate', category: 'glass_ceramic', description: 'Premium all-ceramic for anterior veneers, inlays, and single crowns', is_active: true },
  { id: 'mat-4', name: 'PFM (Porcelain Fused to Metal - CoCr)', category: 'metal', description: 'Classic porcelain fused to nickel-free cobalt chrome alloy', is_active: true },
  { id: 'mat-5', name: 'Full Cast Metal / High-Noble Gold', category: 'metal', description: 'Biocompatible full cast gold/metal alloy for conservative molars', is_active: true },
  { id: 'mat-6', name: 'PMMA / Composite Temporary', category: 'polymer', description: 'High-density milled acrylic for long-term diagnostic temporaries', is_active: true },
  { id: 'mat-7', name: 'Titanium Custom Milling', category: 'metal', description: 'CAD/CAM custom milled titanium bar or custom implant abutment', is_active: true },
  { id: 'mat-8', name: 'PEEK / BioHPP Polymer Framework', category: 'polymer', description: 'Lightweight, shock-absorbing framework for implant overdentures', is_active: true },
];

export const DEFAULT_PREP_TYPES: ClinicalPrepType[] = [
  { id: 'crown', name: 'Full Contour Crown', code: 'FC', description: 'Full coverage anatomical crown', is_active: true },
  { id: 'veneer', name: 'Laminate Veneer', code: 'VEN', description: 'Facial aesthetic porcelain veneer', is_active: true },
  { id: 'inlay_onlay', name: 'Inlay / Onlay / Tabletop', code: 'IN/ON', description: 'Conservative partial indirect restoration', is_active: true },
  { id: 'pontic', name: 'Bridge Pontic Unit', code: 'PON', description: 'Intermediate pontic for fixed dental prosthesis', is_active: true },
  { id: 'abutment', name: 'Custom Implant Abutment', code: 'ABUT', description: 'Individual titanium/zirconia hybrid abutment', is_active: true },
  { id: 'implant', name: 'Screw-Retained Implant Crown', code: 'IMP-CR', description: 'Direct screw-retained implant restoration', is_active: true },
  { id: 'coping', name: 'Coping / Substructure', code: 'COP', description: 'Core framework for layered ceramics', is_active: true },
  { id: 'post_core', name: 'Cast Post & Core', code: 'POST', description: 'Custom endodontic root canal foundation post', is_active: true },
];

export const DEFAULT_SHADE_GUIDES: ClinicalShadeGuide[] = [
  {
    id: 'vita_classical',
    name: 'VITA Classical A1-D4',
    system: 'vita_classical',
    shades: ['A1', 'A2', 'A3', 'A3.5', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D2', 'D3', 'D4'],
  },
  {
    id: 'bleach_shades',
    name: 'VITA Bleached Shades (OM/BL)',
    system: 'bleach',
    shades: ['BL1', 'BL2', 'BL3', 'BL4', 'OM1', 'OM2', 'OM3'],
  },
  {
    id: 'vita_3d',
    name: 'VITA 3D-Master Essential',
    system: 'vita_3d',
    shades: ['1M1', '1M2', '2M1', '2M2', '2M3', '3M1', '3M2', '3M3', '4M1', '4M2', '5M1'],
  },
];

export const DEFAULT_IMPLANT_BRANDS: ClinicalImplantBrand[] = [
  { id: 'nobel', name: 'Nobel Biocare', country: 'Sweden', popular_models: ['NobelActive', 'NobelReplace CC', 'NobelParallel'], is_active: true },
  { id: 'straumann', name: 'Straumann', country: 'Switzerland', popular_models: ['BLX', 'Bone Level Tapered (BLT)', 'Tissue Level'], is_active: true },
  { id: 'zimmer', name: 'Zimmer Biomet', country: 'USA', popular_models: ['Tapered Screw-Vent', 'Trabecular Metal'], is_active: true },
  { id: 'osstem', name: 'Osstem / Hiossen', country: 'South Korea', popular_models: ['ETIII SA', 'MS System', 'ET IV'], is_active: true },
  { id: 'megagen', name: 'MegaGen', country: 'South Korea', popular_models: ['AnyRidge', 'AnyOne', 'ST'], is_active: true },
  { id: 'neodent', name: 'Neodent', country: 'Brazil / Straumann Group', popular_models: ['Grand Morse', 'Helix GM', 'Drive GM'], is_active: true },
];

const STORAGE_KEY = 'dental_solutions_clinical_specs';

import { clinicalSpecsRepo } from '../db/repos';

function getDbHelpers(): { clinicalSpecsRepo: typeof clinicalSpecsRepo } | null {
  // Repo calls throw if the DB engine isn't ready yet; callers below catch
  // that and fall back to localStorage. No eager probe needed.
  return { clinicalSpecsRepo };
}

function rowToPrepType(r: any): ClinicalPrepType {
  return { id: r.id, name: r.name, code: r.code ?? undefined, description: r.description ?? undefined, is_active: !!r.is_active };
}

function rowToMaterial(r: any): ClinicalMaterial {
  return { id: r.id, name: r.name, category: r.category, description: r.description ?? undefined, is_active: !!r.is_active, price_modifier: r.price_modifier ?? undefined };
}

function seedDbFromDefaults(repo: typeof import('../db/repos')['clinicalSpecsRepo']) {
  // Non-transactional best-effort seed of a fresh database
  DEFAULT_MATERIALS.forEach((m) => { try { repo.materials.insert(m); } catch { /* ignore */ } });
  DEFAULT_PREP_TYPES.forEach((p) => { try { repo.prepTypes.insert(p); } catch { /* ignore */ } });
  DEFAULT_SHADE_GUIDES.forEach((g) => { try { repo.shadeGuides.insert(g); } catch { /* ignore */ } });
  DEFAULT_IMPLANT_BRANDS.forEach((b) => { try { repo.implantBrands.insert(b); } catch { /* ignore */ } });
}

export function getClinicalSpecs(): ClinicalSpecsState {
  const db = getDbHelpers();
  if (db) {
    try {
      const dbMaterials = db.clinicalSpecsRepo.materials.all().map(rowToMaterial);
      const dbPreps = db.clinicalSpecsRepo.prepTypes.all().map(rowToPrepType);
      const dbShades = db.clinicalSpecsRepo.shadeGuides.all() as ClinicalShadeGuide[];
      const dbImplants = db.clinicalSpecsRepo.implantBrands.all() as ClinicalImplantBrand[];

      if (dbMaterials.length === 0 && dbPreps.length === 0 && dbShades.length === 0 && dbImplants.length === 0) {
        // Fresh DB — seed from defaults, then re-read
        seedDbFromDefaults(db.clinicalSpecsRepo);
        return {
          materials: db.clinicalSpecsRepo.materials.all().map(rowToMaterial),
          prepTypes: db.clinicalSpecsRepo.prepTypes.all().map(rowToPrepType),
          shadeGuides: db.clinicalSpecsRepo.shadeGuides.all() as ClinicalShadeGuide[],
          implantBrands: db.clinicalSpecsRepo.implantBrands.all() as ClinicalImplantBrand[],
        };
      }

      return {
        materials: dbMaterials,
        prepTypes: dbPreps,
        shadeGuides: dbShades,
        implantBrands: dbImplants,
      };
    } catch (err) {
      console.error('Failed to read clinical specs from SQLite — falling back to localStorage:', err);
    }
  }

  // Fallback: localStorage (legacy path)
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        materials: DEFAULT_MATERIALS,
        prepTypes: DEFAULT_PREP_TYPES,
        shadeGuides: DEFAULT_SHADE_GUIDES,
        implantBrands: DEFAULT_IMPLANT_BRANDS,
      };
    }
    const parsed = JSON.parse(raw);
    return {
      materials: parsed.materials || DEFAULT_MATERIALS,
      prepTypes: parsed.prepTypes || DEFAULT_PREP_TYPES,
      shadeGuides: parsed.shadeGuides || DEFAULT_SHADE_GUIDES,
      implantBrands: parsed.implantBrands || DEFAULT_IMPLANT_BRANDS,
    };
  } catch (err) {
    console.error('Failed to parse clinical specs from localStorage:', err);
    return {
      materials: DEFAULT_MATERIALS,
      prepTypes: DEFAULT_PREP_TYPES,
      shadeGuides: DEFAULT_SHADE_GUIDES,
      implantBrands: DEFAULT_IMPLANT_BRANDS,
    };
  }
}

export function saveClinicalSpecs(specs: ClinicalSpecsState): void {
  // Primary write: SQLite (survives resets, included in backups)
  const db = getDbHelpers();
  if (db) {
    try {
      db.clinicalSpecsRepo.materials.deleteAll();
      db.clinicalSpecsRepo.prepTypes.deleteAll();
      db.clinicalSpecsRepo.shadeGuides.deleteAll();
      db.clinicalSpecsRepo.implantBrands.deleteAll();
      specs.materials.forEach((m) => db.clinicalSpecsRepo.materials.insert(m));
      specs.prepTypes.forEach((p) => db.clinicalSpecsRepo.prepTypes.insert(p));
      specs.shadeGuides.forEach((g) => db.clinicalSpecsRepo.shadeGuides.insert(g));
      specs.implantBrands.forEach((b) => db.clinicalSpecsRepo.implantBrands.insert(b));
    } catch (err) {
      console.error('Failed to write clinical specs to SQLite:', err);
    }
  }

  // Mirror write: localStorage kept in sync as legacy fallback
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(specs));
  } catch (err) {
    console.error('Failed to save clinical specs:', err);
  }

  window.dispatchEvent(new CustomEvent('clinical-specs-updated', { detail: specs }));
}
