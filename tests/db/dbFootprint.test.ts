import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';

/**
 * The empty-database floor is not a cosmetic number. The webview keeps the
 * whole SQLite database in memory as bytes and re-encodes that byte array into
 * IndexedDB on every checkpoint, so every page the schema occupies at rest is
 * paid for on every single save, forever — and on the legacy localStorage path
 * it counted against a ~5 MB quota that the app could hit with a 3.7 MB file.
 *
 * Two things keep the floor honest, and both are guarded here:
 *
 *  1. Migration 017 drops twelve indexes that no statement the app can issue
 *     will ever use (the app filters in JavaScript after `SELECT * FROM t`).
 *  2. `SqliteEngine.compact()` (VACUUM) runs after any migration that applied,
 *     because a dropped index only releases its pages to the freelist — the
 *     exported byte length does not shrink until the file is rebuilt.
 *
 * Measured, before -> after, on this exact schema:
 *   569,344 B -> 524,288 B  =  45,056 B  =  exactly 11 x 4,096-byte pages
 * (twelve indexes dropped, one replacement created).
 */

const PAGE = 4096;
const FLOOR_CEILING = 540_000;

let SQL: any;
let engine: SqliteEngine;

/** Raw sql.js handle, for measurements the engine's typed API does not expose. */
function raw(e: SqliteEngine): any {
  return (e as unknown as { db: any }).db;
}

function indexesOf(e: SqliteEngine): string[] {
  const res = raw(e).exec(
    "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return res.length ? res[0].values.map((v: any[]) => String(v[0])) : [];
}

function bytes(e: SqliteEngine): number {
  return raw(e).export().length;
}

function queryPlan(e: SqliteEngine, sql: string): string {
  return raw(e).exec(`EXPLAIN QUERY PLAN ${sql}`)[0].values.map((v: any[]) => String(v[3])).join(' | ');
}

beforeAll(async () => {
  SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
});

describe('empty database footprint', () => {
  it('migrates to a floor under the ceiling', () => {
    expect(bytes(engine)).toBeLessThanOrEqual(FLOOR_CEILING);
  });

  it('leaves no unreleased freelist pages after the drop-index migration', () => {
    const freelist = raw(engine).exec('PRAGMA freelist_count')[0].values[0][0];
    const pages = raw(engine).exec('PRAGMA page_count')[0].values[0][0];
    expect(freelist).toBe(0);
    expect(pages * PAGE).toBe(bytes(engine));
  });

  it('drops every index migration 017 declared dead, and keeps no duplicate', () => {
    const dead = [
      'idx_cases_delivery',
      'idx_cases_archived',
      'idx_invoices_status',
      'idx_payments_lab',
      'idx_alloc_invoice',
      'idx_alloc_source',
      'idx_journal_ref',
      'idx_audit_entity',
      'idx_notif_read',
      'idx_ledger_ref',
      'idx_print_templates_kind',
    ];
    const live = indexesOf(engine);
    for (const name of dead) expect(live).not.toContain(name);
    expect(new Set(live).size).toBe(live.length);
  });

  it('replaces the unusable composite index with one the source_id filter can use', () => {
    expect(indexesOf(engine)).toContain('idx_alloc_source_id');
    expect(queryPlan(engine, 'SELECT * FROM payment_allocations WHERE source_id = ?')).toContain(
      'USING INDEX idx_alloc_source_id',
    );
    expect(queryPlan(engine, 'DELETE FROM payment_allocations WHERE source_id = ?')).toContain(
      'USING INDEX idx_alloc_source_id',
    );
  });

  it('keeps the index the QC ordering query actually uses', () => {
    // idx_qc_created is deliberately KEPT — qcRepo.all() orders by created_at.
    expect(indexesOf(engine)).toContain('idx_qc_created');
    expect(queryPlan(engine, 'SELECT * FROM qc_inspections ORDER BY created_at')).toContain('idx_qc_created');
  });

  it('holds the index count steady so a new index must be a deliberate decision', () => {
    // A drift alarm, not a law: if this fails, work out what the new index buys
    // (see the EXPLAIN QUERY PLAN note in migration 017) before bumping the number.
    expect(indexesOf(engine)).toHaveLength(18);
  });
});

describe('compact()', () => {
  it('reclaims pages freed by deleting rows', () => {
    const e = engine;
    const before = bytes(e);
    e.transaction((tx) => {
      for (let i = 0; i < 500; i++) {
        tx.run(
          "INSERT INTO notifications (id, type, title, message, created_at, read) VALUES (?, 'system', 't', 'm', '2026-01-01T00:00:00.000Z', 0)",
          [`probe-${i}`],
        );
      }
    });
    const grown = bytes(e);
    expect(grown).toBeGreaterThan(before);

    e.transaction((tx) => tx.run("DELETE FROM notifications WHERE id LIKE 'probe-%'"));

    // Without VACUUM the deleted pages stay on the freelist and still count.
    expect(raw(e).exec('PRAGMA freelist_count')[0].values[0][0]).toBeGreaterThan(0);
    const stillBloated = bytes(e);

    e.compact();

    expect(raw(e).exec('PRAGMA freelist_count')[0].values[0][0]).toBe(0);
    expect(bytes(e)).toBeLessThan(stillBloated);
    expect(bytes(e)).toBeLessThanOrEqual(before);
  });
});
