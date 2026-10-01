import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { userPreferencesRepo } from '../../src/db/userPreferencesRepo';

/**
 * D4 / migration 014: per-user preferences. One JSON row per user, FK to
 * users with cascade delete, round-trip through the repo.
 */
describe('migration 014 — user_preferences', () => {
  let engine: SqliteEngine;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    engine = await SqliteEngine.create(SQL, null);
    engine.migrate();
    setDatabase(engine);
  });

  it('creates the table with FK cascade to users', () => {
    const cols = engine.all<{ name: string }>("SELECT name FROM pragma_table_info('user_preferences')").map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['user_id', 'value', 'updated_at']));
    const fk = engine.all<{ table: string; on_delete: string }>("SELECT \"table\", on_delete FROM pragma_foreign_key_list('user_preferences')");
    expect(fk[0].table).toBe('users');
    expect(fk[0].on_delete).toBe('CASCADE');
    const row = engine.get<{ value: string }>("SELECT value FROM app_meta WHERE key = 'schema_version'");
    expect(row?.value).toBe('14');
  });

  const seedUser = (id: string) =>
    engine.run(
      `INSERT INTO users (id, username, email, name, role, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, 'Technician', 'hash', 'salt', '2026-10-01')`,
      [id, id, `${id}@x`, id]
    );

  it('round-trips a preferences JSON blob per user (upsert on re-save)', () => {
    // FK is ON: preference rows require a real parent user (by design).
    seedUser('user-1');
    seedUser('user-2');
    userPreferencesRepo.set('user-1', { ui_zoom: 1.1, some_toggle: true });
    expect(userPreferencesRepo.get('user-1')).toEqual({ ui_zoom: 1.1, some_toggle: true });

    userPreferencesRepo.set('user-1', { ui_zoom: 0.85 });
    expect(userPreferencesRepo.get('user-1')).toEqual({ ui_zoom: 0.85 });

    userPreferencesRepo.set('user-2', { ui_zoom: 1.25 });
    expect(userPreferencesRepo.get('user-2')).toEqual({ ui_zoom: 1.25 });
    expect(userPreferencesRepo.get('user-1')).toEqual({ ui_zoom: 0.85 });
  });

  it('user deletion cascades their preferences away', () => {
    seedUser('u-del');
    userPreferencesRepo.set('u-del', { ui_zoom: 1.1 });
    expect(userPreferencesRepo.get('u-del')).toBeDefined();
    engine.run('DELETE FROM users WHERE id = ?', ['u-del']);
    expect(userPreferencesRepo.get('u-del')).toBeUndefined();
  });
});
