/**
 * An invoice belongs to the day its case was RECEIVED, not the day the row was
 * keyed.
 *
 * Invoices used to be stamped from the clock, so work that arrived on 2 October
 * and was entered in November sat in November in the invoice list, the General
 * Ledger and the monthly statement. Two halves fix that and neither is enough
 * alone:
 *
 *   1. a new invoice takes the case's received day (`businessDayFor`), and
 *   2. migration 029 re-dates every invoice already on disk to the same rule,
 *      so an upgraded database does not keep showing the old one.
 *
 * The migration's guards are the part that must not regress: a missing or
 * malformed received date leaves the invoice exactly where it was — a migration
 * must never invent a business day.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { seedDatabase } from '../../src/db/seeds';
import { casesRepo, caseTypesRepo, invoicesRepo, labsRepo } from '../../src/db/repos';
import { MIGRATION_029_INVOICE_BUSINESS_DAY } from '../../src/db/migrations';
import { businessDayFor } from '../../src/utils/dateUtils';

const LAB_ID = 'lab-business-day';
const PRODUCT = { id: '', name: '' };

let engine: SqliteEngine;

const makeCase = (id: string, caseNumber: string, receivedDate: string | null) =>
  casesRepo.insert({
    id,
    case_number: caseNumber,
    lab_id: LAB_ID,
    lab_name: 'Business Day Clinic',
    case_type_id: PRODUCT.id,
    case_type_name: PRODUCT.name,
    doctor_name: 'Dr Test',
    selected_teeth: [11],
    delivery_date: '2026-11-20',
    received_date: receivedDate,
    priority: 'normal',
    price: 1000,
    discount: 0,
    final_price: 1000,
    status: 'received',
    created_at: '2026-11-02 10:00',
  } as never);

const makeInvoice = (id: string, invoiceNumber: string, caseId: string | null, day: string) =>
  invoicesRepo.insert({
    id,
    invoice_number: invoiceNumber,
    case_id: caseId,
    lab_id: LAB_ID,
    lab_name: 'Business Day Clinic',
    amount: 1000,
    discount: 0,
    final_amount: 1000,
    amount_paid: 0,
    payment_status: 'unpaid',
    issue_date: day,
    created_at: day,
  } as never);

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
  await seedDatabase();

  labsRepo.insert({ id: LAB_ID, name: 'Business Day Clinic' });
  const product = caseTypesRepo.all()[0] as { id: string; name: string };
  PRODUCT.id = product.id;
  PRODUCT.name = product.name;
});

const runMigration = () => {
  for (const statement of MIGRATION_029_INVOICE_BUSINESS_DAY.statements) engine.run(statement);
};

describe('businessDayFor', () => {
  it('takes the received day when the operator gave a real date', () => {
    expect(businessDayFor('2026-10-02', '2026-11-03')).toBe('2026-10-02');
    // A timestamp-shaped value is still that day.
    expect(businessDayFor('2026-10-02 09:30', '2026-11-03')).toBe('2026-10-02');
  });

  it('falls back to the keying day when the received date is absent or junk', () => {
    for (const value of [null, undefined, '', '   ', 'not-a-date', '2026-10']) {
      expect(businessDayFor(value as string | null, '2026-11-03')).toBe('2026-11-03');
    }
  });
});

describe('migration 029 — existing invoices follow the received day', () => {
  it('moves an invoice from the keying month into the received month', () => {
    makeCase('case-oct', 'DS-9101', '2026-10-02');
    makeInvoice('inv-oct', 'INV-9101', 'case-oct', '2026-11-03');

    runMigration();

    const inv = invoicesRepo.byId('inv-oct') as { issue_date: string; created_at: string };
    // Both dates move: issue_date is what prints, created_at is what the
    // reports read as the booking day.
    expect(inv.issue_date).toBe('2026-10-02');
    expect(inv.created_at).toBe('2026-10-02');
  });

  it('leaves an invoice alone when its case has no received date', () => {
    makeCase('case-null', 'DS-9102', null);
    makeInvoice('inv-null', 'INV-9102', 'case-null', '2026-11-03');

    runMigration();

    const inv = invoicesRepo.byId('inv-null') as { issue_date: string };
    expect(inv.issue_date).toBe('2026-11-03');
  });

  it('never invents a day from free text or a partial date', () => {
    makeCase('case-junk', 'DS-9103', 'sometime in October');
    makeInvoice('inv-junk', 'INV-9103', 'case-junk', '2026-11-03');
    makeCase('case-partial', 'DS-9104', '2026-10');
    makeInvoice('inv-partial', 'INV-9104', 'case-partial', '2026-11-03');

    runMigration();

    expect((invoicesRepo.byId('inv-junk') as { issue_date: string }).issue_date).toBe('2026-11-03');
    expect((invoicesRepo.byId('inv-partial') as { issue_date: string }).issue_date).toBe('2026-11-03');
  });

  it('skips invoices with no case to read a received date from', () => {
    makeInvoice('inv-standalone', 'INV-9105', null, '2026-11-03');

    runMigration();

    expect((invoicesRepo.byId('inv-standalone') as { issue_date: string }).issue_date).toBe('2026-11-03');
  });
});
