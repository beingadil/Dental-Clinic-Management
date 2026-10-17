import { describe, it, expect } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';

describe('migration 025 adds opening_balance columns to labs', () => {
  it('labs table has both columns after full migration', async () => {
    const SQL = await initSqlJs();
    const eng = await SqliteEngine.create(SQL, null);
    eng.migrate();
    const cols = eng.all<{ name: string }>('PRAGMA table_info("labs")').map((r) => r.name);
    console.log('labs columns:', cols.join(', '));
    expect(cols).toContain('opening_balance');
    expect(cols).toContain('opening_balance_type');
  });

  it('upgrades a v24 database (no opening_balance) to v25', async () => {
    const SQL = await initSqlJs();
    // Build a v24 database by running all migrations except 025
    const eng = await SqliteEngine.create(SQL, null);
    const { MIGRATIONS } = await import('../../src/db/migrations');
    const without25 = MIGRATIONS.filter((m: any) => m.version !== 25);
    eng.migrate(without25);
    const colsBefore = eng.all<{ name: string }>('PRAGMA table_info("labs")').map((r) => r.name);
    console.log('before 025:', colsBefore.join(', '));
    expect(colsBefore).not.toContain('opening_balance');

    // Now run 025
    const m25 = MIGRATIONS.find((m: any) => m.version === 25)!;
    eng.migrate([m25]);
    const colsAfter = eng.all<{ name: string }>('PRAGMA table_info("labs")').map((r) => r.name);
    console.log('after 025:', colsAfter.join(', '));
    expect(colsAfter).toContain('opening_balance');
    expect(colsAfter).toContain('opening_balance_type');
  });
});