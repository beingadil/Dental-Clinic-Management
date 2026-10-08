import { describe, it, expect } from 'vitest';
import {
  formatTeeth,
  formatReceivedDate,
  formatDeliveryDate,
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

  describe('formatReceivedDate', () => {
    it("formats the operator's received date", () => {
      expect(formatReceivedDate(baseCase)).toBe('Sep 30, 2026');
    });

    it('falls back to the registration day when no received date was entered', () => {
      expect(formatReceivedDate({ ...baseCase, received_date: null })).toBe(
        'Sep 28, 2026',
      );
    });

    it('is empty when the case carries no date at all, so the row drops', () => {
      expect(
        formatReceivedDate({ ...baseCase, received_date: null, created_at: '' }),
      ).toBe('');
    });
  });

  describe('formatDeliveryDate', () => {
    it("formats the operator's promised day", () => {
      expect(formatDeliveryDate(baseCase)).toBe('Oct 20, 2026');
    });

    it('is empty when the case was never promised a day', () => {
      // An unpromised case stores '' (what CaseTemplateModal writes), and
      // imported rows can carry padding — both must drop the row.
      expect(formatDeliveryDate({ ...baseCase, delivery_date: '' })).toBe('');
      expect(formatDeliveryDate({ ...baseCase, delivery_date: '   ' })).toBe('');
    });

    it('never falls back to the received date, which would relabel the promise', () => {
      expect(
        formatDeliveryDate({ ...baseCase, delivery_date: '', received_date: '2026-09-30' }),
      ).toBe('');
    });
  });

  describe('caseDetailLines', () => {
    it('includes only the case identity rows, in reading order', () => {
      expect(caseDetailLines(baseCase).map((l) => l.label)).toEqual([
        'Patient',
        'Procedure',
        'Teeth',
        'Shade',
        'Received Date',
        'Delivery Date',
      ]);
    });

    it('shows the received and promised days as separate rows', () => {
      const lines = caseDetailLines(baseCase);
      expect(lines.find((l) => l.label === 'Received Date')?.value).toBe('Sep 30, 2026');
      expect(lines.find((l) => l.label === 'Delivery Date')?.value).toBe('Oct 20, 2026');
    });

    it('leaves doctor, material and units to the case record', () => {
      const labels = caseDetailLines(baseCase).map((l) => l.label);
      expect(labels).not.toContain('Doctor');
      expect(labels).not.toContain('Material');
      expect(labels).not.toContain('Units');
      expect(labels).not.toContain('Status');
    });

    it('omits rows whose value is missing instead of printing a blank', () => {
      const lines = caseDetailLines({
        ...baseCase,
        patient_name: '',
        case_type_name: '',
        case_type: '',
        shade: '',
        received_date: null,
        delivery_date: '',
        created_at: '',
      });
      // Teeth always render (a dash when the case has none); the rest drop out.
      expect(lines.map((l) => l.label)).toEqual(['Teeth']);
      expect(lines.every((l) => !!l.value)).toBe(true);
    });

    it('falls back to case_type when case_type_name is empty', () => {
      const line = caseDetailLines({ ...baseCase, case_type_name: '' }).find(
        (l) => l.label === 'Procedure',
      );
      expect(line?.value).toBe('Zirconia Crown');
    });

    it('carries the patient name and shade straight off the case', () => {
      const lines = caseDetailLines(baseCase);
      expect(lines.find((l) => l.label === 'Patient')?.value).toBe('Ayesha Khan');
      expect(lines.find((l) => l.label === 'Shade')?.value).toBe('A2');
    });
  });

  describe('caseDetailText', () => {
    it('renders one pipe-separated narration string', () => {
      const text = caseDetailText(baseCase);
      expect(text).toContain('Patient: Ayesha Khan');
      expect(text).toContain('Procedure: Zirconia Crown');
      expect(text).toContain('Teeth: #11, #12, #21');
      expect(text).toContain('Shade: A2');
      expect(text).toContain('Received Date: Sep 30, 2026');
      expect(text).toContain('Delivery Date: Oct 20, 2026');
      expect(text).not.toContain('Doctor:');
      expect(text).not.toContain('Units:');
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