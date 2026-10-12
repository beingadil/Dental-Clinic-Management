/**
 * Migration 023 — user-managed catalog categories.
 *
 * Categories were a hardcoded five-element array in `CatalogView.tsx`. These
 * pin the two things that decide whether existing catalog data survives:
 *
 *  1. THE BACKFILL NEEDS NO REMAP. The seeded ids equal the legacy category
 *     strings, so every product already points at a valid row the instant the
 *     INSERT lands. Had the migration generated fresh ids without rewriting
 *     `case_types.category`, every product would have been orphaned and dropped
 *     out of every filter and print at once.
 *  2. AN UNKNOWN LEGACY STRING IS ADOPTED, NOT DROPPED. A hand-edited database
 *     can hold a category the UI never offered; it becomes a real row rather than
 *     an orphan that silently vanishes from the filter list.
 *
 * Plus the delete contract, which is the part that can lose money: the default
 * path REFUSES while products hold the category and names them.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { categoryRepo, caseTypesRepo, slugifyCategory } from '../../src/db/repos';
import { MIGRATIONS } from '../../src/db/migrations';

let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
});

/** Reset to the post-023 baseline: five categories, no products. */
function seedBaseline() {
  engine.run('DELETE FROM case_types');
  engine.run('DELETE FROM catalog_categories');
  for (const [id, name, sort_order] of [
    ['crown_bridge', 'Crown & Bridge', 10],
    ['implant', 'Implant Prosthetics', 20],
    ['denture', 'Dentures & Removables', 30],
    ['orthodontic', 'Orthodontic & Aligners', 40],
    ['veneers', 'Veneers & Aesthetics', 50],
  ] as const) {
    engine.run('INSERT INTO catalog_categories (id, name, sort_order) VALUES (?, ?, ?)', [id, name, sort_order]);
  }
}

const addProduct = (id: string, name: string, category: string) =>
  caseTypesRepo.insert({ id, name, base_price: 1000, category });

beforeEach(seedBaseline);

describe('migration 023 — catalog_categories', () => {
  it('seeds the five shipped categories with ids matching the legacy strings', () => {
    const rows = categoryRepo.all();
    expect(rows.map((r) => r.id)).toEqual([
      'crown_bridge',
      'implant',
      'denture',
      'orthodontic',
      'veneers',
    ]);
    expect(rows[0].name).toBe('Crown & Bridge');
  });

  it('leaves an existing product already pointing at its category — no remap needed', () => {
    // The whole point of seeding ids equal to the legacy strings: a product
    // written before the migration resolves to a real row immediately.
    addProduct('ct-1', 'Zirconia Crown', 'crown_bridge');
    addProduct('ct-2', 'E-max Veneer', 'veneers');

    expect(categoryRepo.countProducts('crown_bridge')).toBe(1);
    expect(categoryRepo.countProducts('veneers')).toBe(1);
    expect(caseTypesRepo.byId('ct-1')?.category).toBe('crown_bridge');
  });

  it('adopts a legacy category string that was never in the hardcoded array', () => {
    // A hand-edited database, or a row from a build that offered a value the
    // current UI does not. It must become a real row, not an orphan that
    // silently disappears from the filter list.
    // NOTE: seedBaseline() wipes case_types, so it has to run BEFORE the stray
    // row is inserted — calling it after would delete the very row under test.
    engine.run(
      `INSERT INTO case_types (id, name, base_price, category, created_at)
       VALUES ('ct-x', 'Oddity', 1000, 'sleep_apnea', '2026-01-01')`
    );
    // Re-run the adopt INSERT the migration uses.
    engine.run(
      `INSERT OR IGNORE INTO catalog_categories (id, name, sort_order)
       SELECT lower(replace(replace(trim(category), ' ', '_'), '-', '_')),
              replace(trim(category), '_', ' '), 900
       FROM case_types
       WHERE category IS NOT NULL AND trim(category) <> ''`
    );

    const adopted = categoryRepo.byId('sleep_apnea');
    expect(adopted).toBeDefined();
    expect(adopted!.name).toBe('sleep apnea');
    expect(categoryRepo.countProducts('sleep_apnea')).toBe(1);
  });
});

describe('migration 023 — the case_types rebuild', () => {
  it('actually lifted the CHECK: a new category accepts a product', () => {
    // THE regression this whole rebuild exists to prevent. With the original
    // `CHECK (category IN (...))` still in place, `create()` would succeed and
    // every save of a material in that category would throw
    // "CHECK constraint failed" — the category visible in the dropdown but
    // unusable. Assert the constraint is gone, not just that the row exists.
    const cat = categoryRepo.create('Sleep Apnea Splint');
    expect(() => addProduct('ct-new', 'Night Guard', cat.id)).not.toThrow();
    expect(caseTypesRepo.byId('ct-new')?.category).toBe('sleep_apnea_splint');
  });

  it('preserves every column and the constraints that still matter', () => {
    engine.run(
      `INSERT INTO case_types (id, name, base_price, category, lead_time_days, warranty_months,
         description, material_system, unit_basis, shade_guide, indications, contraindications,
         needs_teeth, created_at)
       VALUES ('ct-keep','Keep Me',5000,'implant',5,24,'d','ms','per unit','sg','ind','contra',0,'2026-01-01')`
    );
    const kept = caseTypesRepo.byId('ct-keep')!;

    // Columns added by 010 and 021 must survive the copy — a rebuild that
    // listed only the original seven would silently drop them.
    expect(kept.material_system).toBe('ms');
    expect(kept.unit_basis).toBe('per unit');
    expect(kept.shade_guide).toBe('sg');
    expect(kept.indications).toBe('ind');
    expect(kept.contraindications).toBe('contra');
    // NOT NULL DEFAULT 1 for needs_teeth must still be there.
    expect(kept.needs_teeth).toBe(false);
    expect(kept.warranty_months).toBe(24);
  });

  it('still enforces the base_price guard', () => {
    expect(() =>
      engine.run(`INSERT INTO case_types (id, name, base_price, created_at) VALUES ('bad','Bad',-1,'2026-01-01')`)
    ).toThrow();
  });

  it('still enforces the case-insensitive unique name', () => {
    addProduct('ct-a', 'Zirconia Crown', 'veneers');
    expect(() => addProduct('ct-b', 'zirconia crown', 'veneers')).toThrow();
  });

  it('upgrades a live pre-023 database without losing the catalog or pricing', async () => {
    // The honest upgrade test: a real engine taken only through migrations 1–22,
    // populated, then migrated forward by the real runner.
    //
    // An earlier draft of this test instead renamed `case_types` aside and
    // dropped it by hand to fake the pre-023 shape. That rewrote the child
    // table's FK clause to point at the throwaway name, so foreign_key_check
    // then reported a dangling reference that the real migration never causes —
    // the failure was in the simulation, not the migration. Only a real replay
    // exercises the actual rename/DROP ordering.
    const SQL = await initSqlJs();
    const fresh = await SqliteEngine.create(SQL, null);
    fresh.migrate(MIGRATIONS.slice(0, 22)); // stop before 023

    // Pre-023 data a live clinic would plausibly hold.
    fresh.run(
      `INSERT INTO case_types (id, name, base_price, category, lead_time_days, warranty_months,
         description, material_system, unit_basis, shade_guide, indications, contraindications,
         needs_teeth, created_at)
       VALUES ('ct-1','Zirconia Crown',15000,'crown_bridge',5,60,'d','3Y-TZP','per unit','VITA','ind','contra',1,'2026-01-01')`
    );
    fresh.run(`INSERT INTO labs (id, name, contact_person, created_at) VALUES ('lab-1','Lab One','Dr X','2026-01-01')`);
    fresh.run(
      `INSERT INTO lab_pricing_overrides (id, lab_id, case_type_id, custom_price, standard_price, created_at)
       VALUES ('po-1','lab-1','ct-1',13000,15000,'2026-01-01')`
    );
    // NOTE: a stray `category = 'sleep_apnea'` row is deliberately NOT inserted
    // here. Pre-023 the CHECK constraint made it impossible to store — the
    // insert below is rejected by the database itself — so that state can only
    // exist in a hand-edited file. The adoption path is covered separately,
    // where the CHECK is lifted to create the condition it defends against.

    setDatabase(fresh);
    try {
      fresh.migrate(); // applies 023 through the real runner

      // The catalog row survived intact, with every column.
      const kept = caseTypesRepo.byId('ct-1')!;
      expect(kept.name).toBe('Zirconia Crown');
      expect(kept.base_price).toBe(15000);
      expect(kept.material_system).toBe('3Y-TZP');
      expect(kept.needs_teeth).toBe(true);
      expect(kept.category).toBe('crown_bridge');

      // The negotiated pricing row survived the parent-table rebuild — this is
      // what would have been destroyed by an unguarded ON DELETE CASCADE.
      expect(fresh.get<{ custom_price: number }>('SELECT custom_price FROM lab_pricing_overrides WHERE id = ?', ['po-1'])?.custom_price).toBe(13000);
      expect(fresh.all('PRAGMA foreign_key_check')).toHaveLength(0);

      // Every pre-023 category resolved to a real row, with no remapping.
      expect(categoryRepo.byId('crown_bridge')!.name).toBe('Crown & Bridge');
      expect(categoryRepo.all().map((c) => c.id)).toEqual([
        'crown_bridge', 'implant', 'denture', 'orthodontic', 'veneers',
      ]);

      // And a brand-new category genuinely round-trips through a product.
      const cat = categoryRepo.create('Bruxism Splint');
      addProduct('ct-new', 'Night Guard', cat.id);
      expect(caseTypesRepo.byId('ct-new')?.category).toBe('bruxism_splint');
    } finally {
      // Restore the module-level engine for the rest of the file.
      setDatabase(engine);
    }
  });
});

it('survives delete-then-re-add without orphaning anything', () => {
    addProduct('ct-1', 'Zirconia Crown', 'crown_bridge');

    // Blocked while a product holds it.
    expect(categoryRepo.delete('crown_bridge').ok).toBe(false);

    // Still blocked on retry — the product has to actually move first.
    expect(categoryRepo.delete('crown_bridge').ok).toBe(false);
    expect(categoryRepo.reassignProducts('crown_bridge', 'veneers')).toBe(1);

    // Free only once empty.
    expect(categoryRepo.delete('crown_bridge').ok).toBe(true);
    const readded = categoryRepo.create('Crown & Bridge');

    // The id is the SLUG of the label, and the seeded ids are hand-written
    // abbreviations, so a re-add can differ from the original. Safe, not
    // corruption: delete() only succeeds on an empty category, so no product
    // could have been referencing the id that vanished, and nothing else stores
    // a category id. Asserted so the behaviour is pinned, not accidental.
    expect(readded.name).toBe('Crown & Bridge');
    expect(categoryRepo.byId(readded.id)).toBeDefined();
    expect(caseTypesRepo.byId('ct-1')?.category).toBe('veneers');
  });

describe('categoryRepo — create / update', () => {
  it('adds a category and derives a stable slug from its name', () => {
    const c = categoryRepo.create('Sleep Apnea Splint');
    expect(c.id).toBe('sleep_apnea_splint');
    expect(c.name).toBe('Sleep Apnea Splint');
    expect(categoryRepo.all()).toHaveLength(6);
  });

  it('is idempotent on an identical name', () => {
    const first = categoryRepo.create('Night Guard');
    const second = categoryRepo.create('  night guard  ');
    expect(second.id).toBe(first.id);
    expect(categoryRepo.all()).toHaveLength(6);
  });

  it('disambiguates two names that slug to the same id', () => {
    // "Retainer" and "Retainers" both reduce to `retainer`; a plain INSERT
    // would throw on the duplicate primary key with no explanation.
    const a = categoryRepo.create('Retainer');
    const b = categoryRepo.create('Retainers');
    expect(a.id).toBe('retainer');
    expect(b.id).toBe('retainers');
  });

  it('appends new categories after the existing ones', () => {
    const c = categoryRepo.create('Bruxism Splint');
    expect(c.sort_order).toBeGreaterThan(50);
    expect(categoryRepo.all().at(-1)!.id).toBe('bruxism_splint');
  });

  it('rejects an empty name', () => {
    expect(() => categoryRepo.create('   ')).toThrow();
    expect(() => categoryRepo.create('!!!')).toThrow();
  });

  it('renames without touching a single product', () => {
    addProduct('ct-1', 'Zirconia Crown', 'crown_bridge');
    categoryRepo.update('crown_bridge', 'Crowns & Fixed Bridges');

    expect(categoryRepo.byId('crown_bridge')!.name).toBe('Crowns & Fixed Bridges');
    // The id is the stable key, so the product keeps its category through a rename.
    expect(categoryRepo.countProducts('crown_bridge')).toBe(1);
  });

  it('refuses a rename that collides with another category', () => {
    expect(() => categoryRepo.update('implant', 'crown & BRIDGE')).toThrow(/already exists/i);
    expect(categoryRepo.byId('implant')!.name).toBe('Implant Prosthetics');
  });
});

describe('categoryRepo — the three delete paths', () => {
  it('BLOCKS by default and names the products holding the category', () => {
    addProduct('ct-1', 'Zirconia Crown', 'crown_bridge');
    addProduct('ct-5', 'Metal Crown (Cast)', 'crown_bridge');

    const res = categoryRepo.delete('crown_bridge');

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('in_use');
    // The refusal has to be actionable — "cannot delete" alone tells the
    // operator nothing about what to move first.
    expect(res.blockingProducts.map((p) => p.name)).toEqual(['Metal Crown (Cast)', 'Zirconia Crown']);
    expect(categoryRepo.byId('crown_bridge')).toBeDefined();
  });

  it('deletes freely once nothing holds the category', () => {
    const res = categoryRepo.delete('orthodontic');
    expect(res.ok).toBe(true);
    expect(categoryRepo.byId('orthodontic')).toBeUndefined();
  });

  it('REASSIGN moves the products, then deletes', () => {
    addProduct('ct-1', 'Zirconia Crown', 'crown_bridge');
    addProduct('ct-5', 'Metal Crown (Cast)', 'crown_bridge');

    const res = categoryRepo.deleteWithReassign('crown_bridge', 'veneers');

    expect(res.ok).toBe(true);
    expect(categoryRepo.byId('crown_bridge')).toBeUndefined();
    expect(caseTypesRepo.byId('ct-1')?.category).toBe('veneers');
    expect(caseTypesRepo.byId('ct-5')?.category).toBe('veneers');
    // Nothing destroyed — this is the path that must be recoverable.
    expect(caseTypesRepo.all()).toHaveLength(2);
  });

  it('reassign refuses a same-category or unknown destination', () => {
    addProduct('ct-1', 'Zirconia Crown', 'crown_bridge');
    expect(() => categoryRepo.deleteWithReassign('crown_bridge', 'crown_bridge')).toThrow();
    expect(() => categoryRepo.deleteWithReassign('crown_bridge', 'nope')).toThrow();
  });

  it('CASCADE deletes the products and the category', () => {
    addProduct('ct-1', 'Zirconia Crown', 'crown_bridge');
    addProduct('ct-5', 'Metal Crown (Cast)', 'crown_bridge');

    const res = categoryRepo.deleteWithCascade('crown_bridge');

    expect(res.ok).toBe(true);
    expect(res.removedProducts).toBe(2);
    expect(categoryRepo.byId('crown_bridge')).toBeUndefined();
    expect(caseTypesRepo.all()).toHaveLength(0);
  });

  it('never deletes the last remaining category', () => {
    // The form's dropdown must always have something to select; an uncategorised
    // product is not a state the UI can represent.
    for (const c of categoryRepo.all()) categoryRepo.delete(c.id);
    const last = categoryRepo.all()[0];
    expect(last).toBeDefined();

    const res = categoryRepo.delete(last!.id);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('last_category');
    expect(categoryRepo.all()).toHaveLength(1);
  });

  it('a cascade cannot empty the catalog either', () => {
    for (const c of categoryRepo.all().slice(1)) categoryRepo.delete(c.id);
    const last = categoryRepo.all()[0];
    addProduct('ct-1', 'Zirconia Crown', last!.id);

    const res = categoryRepo.deleteWithCascade(last!.id);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('last_category');
  });
});

describe('slugifyCategory', () => {
  it('produces a stable URL-safe id', () => {
    expect(slugifyCategory('Crown & Bridge')).toBe('crown_bridge');
    expect(slugifyCategory('  Sleep   Apnea  Splint ')).toBe('sleep_apnea_splint');
    expect(slugifyCategory('Ortho/Aligners')).toBe('ortho_aligners');
    expect(slugifyCategory('---')).toBe('');
  });
});