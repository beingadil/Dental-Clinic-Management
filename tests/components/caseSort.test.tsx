// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

const store = vi.hoisted(() => ({ cases: [] as unknown[] }));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    cases: store.cases,
    labs: [],
    caseTypes: [],
    searchTerm: '',
    setSearchTerm: () => {},
    updateCase: () => {},
    brandingSettings: {},
    todayStr: '2026-10-10',
    archiveCase: () => {},
    restoreCase: () => {},
    deleteCasePermanently: () => {},
  }),
}));

import { CaseListView } from '../../src/components/cases/CaseListView';
import { DentalCase } from '../../src/types';

afterEach(cleanup);

/** Build a case with sensible defaults; `overrides` drives the sort test. */
const makeCase = (overrides: Partial<DentalCase> & { id: string }): DentalCase =>
  ({
    case_number: 'DS-0001',
    patient_name: 'Patient',
    lab_id: 'lab-1',
    lab_name: 'Clinic',
    case_type_id: 'ct-1',
    case_type_name: 'Zirconia',
    doctor_name: 'Tariq Mahmood',
    selected_teeth: [11],
    delivery_date: '2026-12-01',
    received_date: '2026-10-01',
    priority: 'normal',
    price: 100,
    discount: 0,
    final_price: 100,
    status: 'received',
    created_at: '2026-10-01 09:00',
    updated_at: '2026-10-01 09:00',
    history: [],
    ...overrides,
  }) as DentalCase;

/** Case IDs in the order the table rendered them. */
const renderedOrder = (): string[] =>
  screen
    .getAllByRole('row')
    .slice(1) // drop the header row
    .map((row) => within(row).getAllByRole('cell')[1].textContent?.trim() ?? '');

const SORTABLE_CASES: DentalCase[] = [
  makeCase({
    id: 'c1',
    case_number: 'DS-0003',
    patient_name: 'Zara',
    lab_name: 'Alpha Dental',
    case_type_name: 'Zirconia',
    doctor_name: 'Umar Farooq',
    delivery_date: '2026-12-20',
    received_date: '2026-10-05',
    priority: 'low',
    final_price: 500,
    created_at: '2026-10-03 09:00',
    updated_at: '2026-10-09 09:00',
  }),
  makeCase({
    id: 'c2',
    case_number: 'DS-0010',
    patient_name: 'Ali',
    lab_name: 'Bravo Dental',
    case_type_name: 'PFM',
    doctor_name: 'Ayesha Khan',
    delivery_date: '2026-11-10',
    received_date: '2026-10-01',
    priority: 'urgent',
    final_price: 9000,
    created_at: '2026-10-01 09:00',
    updated_at: '2026-10-02 09:00',
  }),
  makeCase({
    id: 'c3',
    case_number: 'DS-0002',
    patient_name: 'Bilal',
    lab_name: 'Charlie Dental',
    case_type_name: 'Acrylic',
    doctor_name: 'Bilal Ahmed',
    delivery_date: '2026-12-01',
    received_date: null, // pre-received-date row
    priority: 'high',
    final_price: 1200,
    created_at: '2026-10-02 09:00',
    updated_at: '2026-10-01 09:00',
  }),
];

describe('case list ordering', () => {
  it('opens on the newest registered case, not the earliest delivery', () => {
    // The defect this default fixes: delivery_date ascending put the case the
    // operator had just typed at the very bottom of the list.
    store.cases = SORTABLE_CASES;
    render(<CaseListView />);

    // DS-0003 registered last, so it leads despite the latest delivery date.
    expect(renderedOrder()).toEqual(['DS-0003', 'DS-0002', 'DS-0010']);
  });

  it('offers every sort key in the dropdown, grouped', () => {
    store.cases = SORTABLE_CASES;
    render(<CaseListView />);

    const select = screen.getByLabelText('Sort cases by') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    const groups = Array.from(select.querySelectorAll('optgroup')).map((g) => g.label);

    expect(values).toContain('created_at');
    expect(values).toContain('received_date');
    expect(values).toContain('case_number');
    expect(values).toContain('patient_name');
    expect(values).toContain('doctor_name');
    expect(values).toContain('lab_name');
    expect(values).toContain('final_price');
    expect(groups).toEqual(['Recently added', 'Delivery', 'Case', 'Work']);

    // Default selection is the newest-first option itself.
    expect(select.value).toBe('created_at');
  });

  it('names the direction on the toggle, not just an unlabelled icon', () => {
    store.cases = SORTABLE_CASES;
    render(<CaseListView />);

    // Descending by default, and the label says which way it flips.
    expect(screen.getByLabelText(/Sorted descending/)).toBeTruthy();
  });
});