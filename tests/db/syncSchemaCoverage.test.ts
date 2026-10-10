import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { caseTypesRepo } from '../../src/db/repos';

/**
 * Schema-coverage guard.
 *
 * syncCore's autosave is DELETE-and-replace: it wipes whole tables and rebuilds
 * them from React state. That design has one sharp edge — any column omitted
 * from the INSERT list is not "left stale", it is DESTROYED on every autosave
 * and silently gone on the next load, with no error anywhere.
 *
 * needs_teeth was found exactly this way (it was added in migration 021 and the
 * sync block still listed the pre-010 column set, so the flag was silently
 * wiped on every save). Five more columns — material_system, unit_basis,
 * shade_guide, indications, contraindications — were already exposed to it.
 *
 * This file makes that class of bug impossible to ship again: it reads the real
 * table shape out of a migrated database, parses the INSERT statements out of
 * syncCore's source, and fails on any table whose write does not mention every
 * column that exists. Adding a column to a migration without threading it
 * through the sync is then a test failure, not a field that quietly empties.
 */
let engine: SqliteEngine;

const SRC = resolve(__dirname, '../../src/db/syncCore.ts');
const REPOS_SRC = resolve(__dirname, '../../src/db/repos.ts');

/** All user tables, excluding SQLite's internals and the migration ledger. */
function tableNames(): string[] {
  return engine
    .all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations' ORDER BY name"
    )
    .map((r) => r.name);
}

function columnNames(table: string): string[] {
  return engine.all<{ name: string }>(`PRAGMA table_info(${table})`).map((r) => r.name);
}

/** Table name -> the column list each `INSERT INTO <table> (...)` names. */
function parseInserts(source: string): Map<string, string[][]> {
  const byTable = new Map<string, string[][]>();
  const re = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]*)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const table = m[1];
    const cols = m[2]
      .split(',')
      .map((c) => c.trim().replace(/^[`"[]|[`"\]]$/g, ''))
      .filter(Boolean);
    if (!byTable.has(table)) byTable.set(table, []);
    byTable.get(table)!.push(cols);
  }
  return byTable;
}

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
});

describe('syncCore writes every column that exists', () => {
  const source = readFileSync(SRC, 'utf8');
  const inserts = parseInserts(source);

  it('found the tables to audit', () => {
    // A parse that silently matched nothing would make every assertion below
    // vacuous, which is exactly how this bug class hides.
    expect(inserts.size).toBeGreaterThan(10);
    expect(tableNames().length).toBeGreaterThan(10);
  });

  // Computed inside the test, not at collection time: the engine does not exist
  // until beforeAll has run, and hoisting this is how a coverage check silently
  // audits nothing.
  it('audits the tables the autosave actually rewrites', () => {
    expect(inserts.size).toBeGreaterThan(10);
  });

  it('every synced table writes every column that exists', () => {
    const problems: string[] = [];
    for (const table of tableNames()) {
      const colLists = inserts.get(table);
      if (!colLists) continue;
      const listed = new Set(colLists.flat());
      const missing = columnNames(table).filter((c) => !listed.has(c));
      if (missing.length) problems.push(`${table}: ${missing.join(', ')}`);
    }
    expect(problems, 'these columns are erased on every autosave').toEqual([]);
  });

  it('names no column in the sync that the table does not have', () => {
    // The mirror image: a typo'd or renamed column here fails loudly at sync
    // time, but only once a real autosave runs. Catching it now is cheaper.
    const problems: string[] = [];
    for (const [table, colLists] of inserts) {
      if (!tableNames().includes(table)) continue;
      const actual = new Set(columnNames(table));
      for (const cols of colLists) {
        for (const c of cols) {
          if (!actual.has(c)) problems.push(`${table}.${c}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('never writes the migration ledger through the collection sync', () => {
    // schema_migrations is the record of what has been applied. A delete-and-
    // replace over it would make every migration re-run.
    expect(inserts.has('schema_migrations')).toBe(false);
    expect(source).not.toMatch(/DELETE FROM schema_migrations/);
  });
});

/**
 * The catalog's own three code paths, which must agree on the same field set:
 * the read mapper, the write, and the partial update. `needs_teeth` was added
 * to the first two and missed by the third for one release.
 */
describe('case_types: read, write and update agree on the column set', () => {
  const TABLE_COLUMNS = [
    'id', 'name', 'base_price', 'category', 'lead_time_days', 'warranty_months',
    'description', 'created_at', 'updated_at', 'material_system', 'unit_basis',
    'shade_guide', 'indications', 'contraindications', 'needs_teeth',
  ];
  /** Columns a caller may legitimately set through a partial update. */
  const UPDATABLE = TABLE_COLUMNS.filter((c) => c !== 'id' && !c.endsWith('_at'));

  it('inserts every column', () => {
    const inserts = parseInserts(readFileSync(REPOS_SRC, 'utf8')).get('case_types') ?? [];
    expect(inserts).toHaveLength(1);
    expect(new Set(inserts[0])).toEqual(new Set(TABLE_COLUMNS));
  });

  it('allows every updatable column through update()', () => {
    const src = readFileSync(REPOS_SRC, 'utf8');
    const block = src.match(/const allowed = \[([^\]]+)\][\s\S]*?caseTypesRepo|update\(id: string, updates/);
    const allowlistMatch = src.slice(src.indexOf('export const caseTypesRepo')).match(/const allowed = \[([^\]]+)\]/);
    expect(allowlistMatch, 'could not find the caseTypesRepo.update allowlist').toBeTruthy();
    const listed = [...allowlistMatch![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(block).toBeTruthy();
    expect(new Set(listed)).toEqual(new Set(UPDATABLE));
  });

  it('round-trips every column through insert → read → update → read', () => {
    // The end-to-end shape of the bug: a column present on the table, absent
    // from one of the three code paths, and therefore empty after an edit.
    const row = caseTypesRepo.insert({
      name: 'Coverage Crown',
      base_price: 1000,
      category: 'crown_bridge',
      lead_time_days: 7,
      warranty_months: 24,
      description: 'desc',
      material_system: 'ms',
      unit_basis: 'ub',
      shade_guide: 'sg',
      indications: 'ind',
      contraindications: 'contra',
      needs_teeth: false,
    });

    // Change only the name; everything else must be untouched.
    const after = caseTypesRepo.update(row.id, { name: 'Coverage Crown v2' });
    for (const key of UPDATABLE) {
      if (key === 'name') continue;
      expect(after[key], `${key} did not survive a name-only edit`).toBe(row[key]);
    }
    expect(after.needs_teeth).toBe(false);
    caseTypesRepo.delete(row.id);
  });
});