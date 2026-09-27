import { describe, it, expect } from 'vitest';
import { selectCasesToAutoArchive, AUTO_ARCHIVE_DAYS } from '../../src/context/hooks/autoArchive';
import type { DentalCase } from '../../src/types';

const TODAY = new Date('2026-09-27T10:30:00.000Z');

function makeCase(overrides: Partial<DentalCase> = {}): DentalCase {
  return {
    id: 'case-1',
    case_number: 'CASE-0001',
    clinic_id: 'lab-1',
    patient_name: 'Patient',
    doctor_name: 'Dr. Test',
    status: 'delivered',
    delivery_date: '2026-06-01',
    created_at: '2026-05-01',
    updated_at: '2026-05-01',
    ...overrides,
  } as DentalCase;
}

describe('selectCasesToAutoArchive', () => {
  it('exports a 30-day window', () => {
    expect(AUTO_ARCHIVE_DAYS).toBe(30);
  });

  it('selects a delivered case older than 30 days', () => {
    const old = makeCase({ id: 'a', delivery_date: '2026-06-01' });
    expect(selectCasesToAutoArchive([old], TODAY)).toEqual([old]);
  });

  it('does not select a delivered case within the last 30 days', () => {
    const recent = makeCase({ id: 'b', delivery_date: '2026-09-15' });
    expect(selectCasesToAutoArchive([recent], TODAY)).toEqual([]);
  });

  it('does not select a case delivered exactly 30 days ago (boundary)', () => {
    const edge = makeCase({ id: 'c', delivery_date: '2026-08-28' }); // exactly 30 days before TODAY
    expect(selectCasesToAutoArchive([edge], TODAY)).toEqual([]);
  });

  it('selects a case one day past the boundary', () => {
    const edge = makeCase({ id: 'd', delivery_date: '2026-08-27' });
    expect(selectCasesToAutoArchive([edge], TODAY).map((c) => c.id)).toEqual(['d']);
  });

  it('ignores cases that are not delivered', () => {
    const notDelivered = [
      makeCase({ id: 'e1', status: 'received' as any, delivery_date: '2026-06-01' }),
      makeCase({ id: 'e2', status: 'in_progress' as any, delivery_date: '2026-06-01' }),
      makeCase({ id: 'e3', status: 'completed' as any, delivery_date: '2026-06-01' }),
    ];
    expect(selectCasesToAutoArchive(notDelivered, TODAY)).toEqual([]);
  });

  it('ignores already-archived cases', () => {
    const archived = makeCase({ id: 'f', archived_at: '2026-09-01T00:00:00.000Z' });
    expect(selectCasesToAutoArchive([archived], TODAY)).toEqual([]);
  });

  it('ignores cases with missing or invalid delivery dates', () => {
    const broken = [
      makeCase({ id: 'g1', delivery_date: undefined }),
      makeCase({ id: 'g2', delivery_date: '' }),
      makeCase({ id: 'g3', delivery_date: 'not-a-date' }),
    ];
    expect(selectCasesToAutoArchive(broken, TODAY)).toEqual([]);
  });

  it('only touches the matching subset and leaves everything else alone', () => {
    const batch = [
      makeCase({ id: 'h1', delivery_date: '2026-06-01' }),                 // old delivered → archive
      makeCase({ id: 'h2', delivery_date: '2026-09-20' }),                 // recent delivered → keep
      makeCase({ id: 'h3', status: 'received' as any }),                   // wrong status → keep
      makeCase({ id: 'h4', archived_at: '2026-09-02T00:00:00.000Z' }),     // already archived → keep
    ];
    expect(selectCasesToAutoArchive(batch, TODAY).map((c) => c.id)).toEqual(['h1']);
  });
});
