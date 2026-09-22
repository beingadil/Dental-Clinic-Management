import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { seedDatabase } from '../../src/db/seeds';
import { runLegacyMigration, getLastLegacyReport } from '../../src/db/legacyMigrator';
import { usersRepo, casesRepo, invoicesRepo, appMetaRepo, chairsideRepo, settingsRepo } from '../../src/db/repos';

/**
 * End-to-end boot simulation: migrate → seed → legacy import → verify.
 * Uses a memory localStorage shim to prove the legacy import path without a browser.
 */

function memoryLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
    _store: store,
  };
}

const shim = memoryLocalStorage();
(globalThis as any).localStorage = shim;

let engine: SqliteEngine;

async function freshBoot(): Promise<SqliteEngine> {
  for (const k of [...shim._store.keys()]) shim.removeItem(k);
  const SQL = await initSqlJs();
  const eng = await SqliteEngine.create(SQL, null);
  eng.migrate();
  setDatabase(eng);
  await seedDatabase();
  return eng;
}

describe('boot simulation (migrate → seed → legacy import)', () => {
  beforeEach(async () => {
    engine = await freshBoot();
  });

  it('fresh profile: seeds defaults, ships no accounts, import scan finds nothing to bring over', async () => {
    // Secure by default — an empty users table forces the first-run setup flow.
    expect(usersRepo.count()).toBe(0);
    expect(usersRepo.byUsername('adil')).toBeUndefined();
    const report = await runLegacyMigration();
    expect(report.ran).toBe(true); // scan executes once, finds nothing
    const totalImported = Object.values(report.tables).reduce((s, t) => s + t.imported, 0);
    expect(totalImported).toBe(0);
    // the legacy scan must not fabricate an administrator either
    expect(usersRepo.count()).toBe(0);
  });

  it('legacy profile: imports patients, cases, invoices, payments with proof images', async () => {
    // Simulate an existing browser profile from the pre-SQLite app:
    shim._store.set('dsw_sqlite_labs', JSON.stringify([
      { id: 'lab-1', name: 'Legacy Dental Clinic', phone: '0300-1112223', created_at: '2026-01-01' },
    ]));
    shim._store.set('dsw_sqlite_cases', JSON.stringify([
      {
        id: 'case-1', case_number: 'DS-0001', patient_name: 'Ahmed Khan', lab_id: 'lab-1',
        lab_name: 'Legacy Dental Clinic', case_type_id: 'ct-1', case_type_name: 'Zirconia Crown',
        doctor_name: 'Dr. Bilal', selected_teeth: [11, 12], delivery_date: '2026-09-01',
        priority: 'high', price: 15000, discount: 0, final_price: 15000, status: 'delivered',
        created_at: '2026-08-01', updated_at: '2026-08-20',
        history: [{ id: 'h1', case_id: 'case-1', status: 'delivered', timestamp: '2026-08-20', updated_by: 'Hamza' }],
      },
    ]));
    shim._store.set('dsw_sqlite_invoices', JSON.stringify([
      {
        id: 'inv-1', invoice_number: 'INV-0001', case_id: 'case-1', case_number: 'DS-0001',
        lab_id: 'lab-1', lab_name: 'Legacy Dental Clinic', doctor_name: 'Dr. Bilal',
        amount: 15000, discount: 0, final_amount: 15000, amount_paid: 10000,
        payment_status: 'partial', due_date: '2026-09-15', created_at: '2026-08-20',
        payments: [
          {
            id: 'pay-1', payment_number: 'PAY-0001', invoice_id: 'inv-1', invoice_number: 'INV-0001',
            amount: 10000, payment_method: 'bank', payment_date: '2026-08-25', recorded_by: 'Sana',
            created_at: '2026-08-25',
            attachments: [
              { id: 'att-p1', file_name: 'transfer-slip.png', file_type: 'image/png', file_size: '120 KB', file_url: 'data:image/png;base64,AAAA', uploaded_at: '2026-08-25', uploaded_by: 'Sana' },
            ],
          },
        ],
      },
    ]));
    shim._store.set('dsw_custom_chairside_appts', JSON.stringify([
      { id: 'appt-1', time: '10:00', period: 'AM', patient: 'Ahmed Khan', doctor: 'Dr. Bilal', clinic: 'Legacy Dental Clinic', procedure: 'Crown Try-in', tooth: 'FDI #11', shade: 'A2', status: 'confirmed' },
    ]));
    shim._store.set('dsw_branding', JSON.stringify({ appName: 'Legacy Branding', phone: '0420-9998888' }));

    const report = await runLegacyMigration();
    expect(report.ran).toBe(true);
    expect(report.tables['labs']?.imported).toBe(1);
    expect(report.tables['cases']?.imported).toBe(1);
    expect(report.tables['invoices']?.imported).toBe(1);
    expect(report.tables['payments']?.imported).toBe(1);
    expect(report.tables['chairside_appointments']?.imported).toBe(1);

    // Domain data survived the trip:
    const c = casesRepo.byCaseNumber('DS-0001');
    expect(c?.patient_name).toBe('Ahmed Khan');
    expect(c?.selected_teeth).toEqual([11, 12]);
    expect(c?.history.length).toBe(1);

    const inv = invoicesRepo.byInvoiceNumber('INV-0001');
    expect(inv?.final_amount).toBe(15000);
    expect(inv?.payments.length).toBe(1);
    expect(inv?.payments[0].attachments.length).toBe(1);
    expect(inv?.payments[0].attachments[0].filename).toBe('transfer-slip.png');

    expect(chairsideRepo.all().length).toBe(1);
    expect(settingsRepo.get('branding', 'settings')?.appName).toBe('Legacy Branding');

    // counters realigned so the next generated numbers never collide:
    const report2 = getLastLegacyReport();
    expect(report2?.ran).toBe(true);
    expect(appMetaRepo.get('legacy_import_done')).toBe('true');
  });

  it('runs exactly once — second call is a no-op', async () => {
    shim._store.set('dsw_sqlite_labs', JSON.stringify([
      { id: 'lab-2', name: 'Once Only Clinic', created_at: '2026-01-01' },
    ]));
    const r1 = await runLegacyMigration();
    expect(r1.ran).toBe(true);
    const r2 = await runLegacyMigration();
    expect(r2.ran).toBe(false);
  });

  it('quarantines corrupt records into legacy_backup with a report entry', async () => {
    shim._store.set('dsw_sqlite_cases', JSON.stringify([
      { id: 'case-bad', case_number: 'DS-BAD', lab_id: 'missing-lab', delivery_date: '2026-09-01' }, // lab missing → FK fail
      null, // total garbage
      { id: 'case-ok', case_number: 'DS-0002', patient_name: 'Valid Patient', lab_id: 'missing-lab', doctor_name: 'Dr. V', delivery_date: '2026-09-02', status: 'received' },
    ]));
    const report = await runLegacyMigration();
    const problems = report.tables['cases']?.problems.length ?? 0;
    expect(problems).toBeGreaterThanOrEqual(1);
    const quarantined = engine.all("SELECT COUNT(*) AS n FROM legacy_backup WHERE table_name = 'cases'");
    expect(Number(quarantined[0].n)).toBeGreaterThanOrEqual(1);
  });
});

