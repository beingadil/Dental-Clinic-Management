import { describe, it, expect } from 'vitest';
import {
  formatTeeth,
  caseDetailLines,
  caseDetailText,
  findCaseForEntry,
} from '../../src/services/ledgerCaseDetail';
import type { DentalCase, LedgerEntry } from '../../src/types';

const baseCase: DentalCase = {
  id: 'case-1',
  case_number: 'DS-0117',
  patient_name: 'Ayesha Khan',
  lab_id: 'lab-1',
  lab_name: 'Alpha Lab',
  case_type_id: 'ct-1',
  case_type_name: 'Zirconia Crown',
  case_type: 'Zirconia Crown',
  units_count: 3,
  doctor_name: 'Dr. Tariq Mahmood',
  selected_teeth: [21, 11, 12],
  shade: 'A2',
  material: 'Zirconia',
  delivery_date: '2026-10-20',
  received_date: '2026-09-30',
  priority: 'normal',
  price: 1000,
  discount: 0,
  final_price: 1000,
  status: 'received',
  created_at: '2026-09-28T09:00:00.000Z',
  updated_at: '2026-09-28T09:00:00.000Z',
  history: [],
};

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry =>
  ({
    id: 'e1',
    entry_date: '2026-10-01',
    description: 'Invoice',
    debit: 1000,
    credit: 0,
    running_balance: 1000,
    ...over,
  }) as LedgerEntry;

describe('ledgerCaseDetail', () => {
  describe('formatTeeth', () => {
    it('sorts FDI teeth numerically and prefixes them', () => {
      expect(formatTeeth(baseCase)).toBe('#11, #12, #21');
    });

    it('falls back to a dash when the case has no teeth', () => {
      expect(formatTeeth({ ...baseCase, selected_teeth: [] })).toBe('—');
    });
  });

  describe('caseDetailLines', () => {
    it('includes every populated detail row in reading order', () => {
      expect(caseDetailLines(baseCase).map((l) => l.label)).toEqual([
        'Procedure',
        'Doctor',
        'Patient',
        'Teeth',
        'Shade',
        'Material',
        'Units',
        'Received',
        'Delivery',
      ]);
    });

    it('omits rows whose value is missing instead of printing a blank', () => {
      const lines = caseDetailLines({
        ...baseCase,
        case_type_name: '',
        case_type: '',
        shade: '',
        material: '',
        units_count: 0,
      });
      expect(lines.map((l) => l.label)).not.toContain('Procedure');
      expect(lines.map((l) => l.label)).not.toContain('Shade');
      expect(lines.map((l) => l.label)).not.toContain('Material');
      expect(lines.map((l) => l.label)).not.toContain('Units');
      // Doctor/patient/teeth/dates survive.
      expect(lines.map((l) => l.label)).toEqual([
        'Doctor',
        'Patient',
        'Teeth',
        'Received',
        'Delivery',
      ]);
    });

    it('falls back to case_type when case_type_name is empty', () => {
      const line = caseDetailLines({ ...baseCase, case_type_name: '' }).find(
        (l) => l.label === 'Procedure',
      );
      expect(line?.value).toBe('Zirconia Crown');
    });

    it('uses the stored received date rather than the delivery date', () => {
      const lines = caseDetailLines(baseCase);
      expect(lines.find((l) => l.label === 'Received')?.value).not.toBe(
        lines.find((l) => l.label === 'Delivery')?.value,
      );
    });

    it('falls back to the case creation day when received_date is empty', () => {
      const line = caseDetailLines({ ...baseCase, received_date: null }).find(
        (l) => l.label === 'Received',
      );
      // created_at is 2026-09-28 — the received row must reflect that day.
      expect(line?.value).toBe('Sep 28, 2026');
    });
  });

  describe('caseDetailText', () => {
    it('renders one pipe-separated narration string', () => {
      const text = caseDetailText(baseCase);
      expect(text).toContain('Procedure: Zirconia Crown');
      expect(text).toContain('Doctor: Dr. Tariq Mahmood');
      expect(text).toContain('Teeth: #11, #12, #21');
      expect(text).toContain('Units: 3');
      expect(text.split(' • ').length).toBe(caseDetailLines(baseCase).length);
    });
  });

  describe('findCaseForEntry', () => {
    const cases = [baseCase, { ...baseCase, id: 'case-2', case_number: 'DS-0118' }];

    it('matches on case id', () => {
      expect(findCaseForEntry(entry({ case_id: 'case-2' }), cases)?.id).toBe('case-2');
    });

    it('falls back to the case number when the id is stale', () => {
      expect(
        findCaseForEntry(entry({ case_id: 'gone', case_number: 'DS-0117' }), cases)
          ?.case_number,
      ).toBe('DS-0117');
    });

    it('returns null for a payment entry with no case reference', () => {
      expect(findCaseForEntry(entry(), cases)).toBeNull();
    });
  });
});