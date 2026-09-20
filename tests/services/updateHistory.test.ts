import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { seedDatabase } from '../../src/db/seeds';
import { settingsRepo } from '../../src/db/repos';
import { getUpdateHistory, recordUpdateHistory } from '../../src/services/updateHistory';

/**
 * Update-history log (Settings → Updates):
 * - events persist to SQLite via settingsRepo and survive re-reads
 * - newest-first ordering with capped length
 * - never throws on corrupt/absent storage
 */

let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
  await seedDatabase();
});

describe('update history log', () => {
  beforeEach(() => {
    settingsRepo.set('updates', 'history', []);
  });

  it('starts empty on a fresh database', () => {
    expect(getUpdateHistory()).toEqual([]);
  });

  it('records events newest-first and persists them', () => {
    recordUpdateHistory({ version: '2.3.2', state: 'available' });
    recordUpdateHistory({ version: '2.3.2', state: 'installed', message: 'silent install started' });

    const history = getUpdateHistory();
    expect(history).toHaveLength(2);
    expect(history[0].state).toBe('installed');
    expect(history[0].message).toBe('silent install started');
    expect(history[1].state).toBe('available');
    expect(history[0].at).toBeTruthy();
    expect(new Date(history[0].at).getTime()).not.toBeNaN();
  });

  it('stamps the running version as from_version', () => {
    recordUpdateHistory({ version: '9.9.9', state: 'failed', message: 'checksum mismatch' });
    const [latest] = getUpdateHistory();
    expect(latest.from_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(latest.version).toBe('9.9.9');
  });

  it('caps the log at 50 entries', () => {
    for (let i = 0; i < 60; i++) {
      recordUpdateHistory({ version: `1.0.${i}`, state: 'up_to_date' });
    }
    expect(getUpdateHistory().length).toBeLessThanOrEqual(50);
  });

  it('returns an empty list when storage holds corrupt JSON', () => {
    // Bypass settingsRepo to write genuinely corrupt JSON into the cell —
    // the repo layer always JSON-encodes, so raw SQL is the only way in.
    engine.run(
      `INSERT INTO settings (namespace, key, value, updated_at) VALUES ('updates', 'history', '{not json', '')
       ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value`
    );
    expect(getUpdateHistory()).toEqual([]);
  });
});
