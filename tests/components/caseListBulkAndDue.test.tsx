// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

/**
 * Two properties of the case list are load-bearing and easy to regress,
 * because both were once wrong in ways that looked fine on screen:
 *
 *   1. The "Due" badge must be derived from `delivery_date`, not from age.
 *      An age-based band painted a perfectly healthy 20-day case red, because
 *      it had no idea the case had already been delivered on time.
 *
 *   2. A bulk status change writes to EVERY selected row at once, and
 *      "Delivered" removes those cases from the active workstation. It must go
 *      through a confirmation that names the count — a bare button meant one
 *      stray click could clear the whole queue.
 */

const store = vi.hoisted(() => ({
  cases: [] as unknown[],
  updateCase: vi.fn(),
}));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    cases: store.cases,
    labs: [{ id: 'lab-1', name: 'Alpha Dental', phone: '0300-1234567' }],
    caseTypes: [],
    searchTerm: '',
    setSearchTerm: () => {},
    updateCase: store.updateCase,
    brandingSettings: {},
    /* Frozen "today" so the due arithmetic is deterministic. */
    todayStr: '2026-10-10',
    archiveCase: () => {},
    restoreCase: () => {},
    deleteCasePermanently: () => {},
    getQcState: () => ({ attempts: 0 }),
  }),
}));

import { CaseListView } from '../../src/components/cases/CaseListView';
import { DentalCase } from '../../src/types';

afterEach(() => {
  cleanup();
  store.updateCase.mockClear();
});

const makeCase = (overrides: Partial<DentalCase> & { id: string }): DentalCase =>
  ({
    case_number: 'DS-0001',
    patient_name: 'Patient',
    lab_id: 'lab-1',
    lab_name: 'Alpha Dental',
    case_type_id: 'ct-1',
    case_type_name: 'Zirconia',
    doctor_name: 'Tariq Mahmood',
    selected_teeth: [11],
    delivery_date: '2026-10-20',
    received_date: '2026-09-20',
    priority: 'normal',
    price: 100,
    discount: 0,
    final_price: 100,
    status: 'received',
    created_at: '2026-09-20 09:00',
    updated_at: '2026-09-20 09:00',
    history: [],
    ...overrides,
  }) as DentalCase;

/** Force the table view — the kanban cards are not where these assertions live. */
const useTableView = () => {
  const tableToggle = screen
    .getAllByRole('button')
    .find((b) => b.getAttribute('title')?.toLowerCase().includes('table'));
  if (tableToggle) fireEvent.click(tableToggle);
};

/** Tick the row checkbox for `caseNumber` so it enters the bulk selection. */
const selectCase = (caseNumber: string) => {
  const row = screen.getAllByRole('row').find((r) => r.textContent?.includes(caseNumber));
  if (!row) throw new Error(`row for ${caseNumber} not rendered`);
  const box = within(row).getAllByRole('checkbox')[0] ?? within(row).getByRole('checkbox');
  fireEvent.click(box);
};

describe('case list due badge', () => {
  it('counts down to the delivery date rather than up from the received date', () => {
    store.cases = [
      makeCase({ id: 'c1', case_number: 'DS-0001', delivery_date: '2026-10-13' }), // 3 days out
      makeCase({ id: 'c2', case_number: 'DS-0002', delivery_date: '2026-10-10' }), // due today
      makeCase({ id: 'c3', case_number: 'DS-0003', delivery_date: '2026-10-08' }), // 2 days late
      makeCase({ id: 'c4', case_number: 'DS-0004', delivery_date: '' }), // no promise date
    ];
    render(<CaseListView />);
    useTableView();

    expect(screen.getByText('3d left')).toBeTruthy();
    expect(screen.getByText('Due today')).toBeTruthy();
    expect(screen.getByText('2d late')).toBeTruthy();
  });

  it('does not call a long-running case overdue when it is still inside its delivery promise', () => {
    // Registered three weeks ago, but promised for a week from now. An
    // age-based band coloured this rose and called it a problem.
    store.cases = [
      makeCase({
        id: 'c1',
        case_number: 'DS-0001',
        received_date: '2026-09-20',
        created_at: '2026-09-20 09:00',
        delivery_date: '2026-10-17',
      }),
    ];
    render(<CaseListView />);
    useTableView();

    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('DS-0001'));
    if (!row) throw new Error('row not rendered');

    expect(within(row).getByText('7d left')).toBeTruthy();
    // Scoped to the row: this file carries responsive label duplicates in
    // hidden spans, so an unscoped /late/ match proves nothing.
    expect(within(row).queryByText(/late/)).toBeNull();
    // The real claim — the badge is not in the overdue (rose) treatment.
    expect(row.querySelector('.text-rose-700')).toBeNull();
  });

  it('labels a case with no promised date rather than inventing a countdown', () => {
    store.cases = [makeCase({ id: 'c1', case_number: 'DS-0001', delivery_date: '' })];
    render(<CaseListView />);
    useTableView();
    expect(screen.getByText('—')).toBeTruthy();
  });
});

describe('bulk status change', () => {
  beforeEach(() => {
    store.cases = [
      makeCase({ id: 'c1', case_number: 'DS-0001' }),
      makeCase({ id: 'c2', case_number: 'DS-0002' }),
    ];
  });

  /** The confirmation overlay, scoped so it cannot be confused with the
      identically-labelled toolbar buttons behind it. */
  const confirmDialog = () =>
    within(screen.getByRole('dialog', { name: /Confirm bulk status change/i }));

  it('writes nothing until the operator confirms', () => {
    render(<CaseListView />);
    useTableView();
    selectCase('DS-0001');

    fireEvent.click(screen.getByTitle(/Mark all 1 selected case\(s\) as Delivered/i));
    expect(store.updateCase).not.toHaveBeenCalled();

    fireEvent.click(confirmDialog().getByRole('button', { name: /^Mark Delivered$/i }));
    expect(store.updateCase).toHaveBeenCalledTimes(1);
    expect(store.updateCase).toHaveBeenCalledWith(
      'c1',
      { status: 'delivered' },
      expect.stringContaining('Delivered'),
    );
  });

  it('names the number of cases at risk, so a wide selection is visible before it lands', () => {
    render(<CaseListView />);
    useTableView();
    selectCase('DS-0001');
    selectCase('DS-0002');

    fireEvent.click(screen.getByTitle(/Mark all 2 selected case\(s\) as Delivered/i));
    expect(confirmDialog().getByText(/Mark 2 cases as Delivered\?/)).toBeTruthy();
    expect(store.updateCase).not.toHaveBeenCalled();
  });

  it('abandons the write when the confirmation is cancelled', () => {
    render(<CaseListView />);
    useTableView();
    selectCase('DS-0001');

    fireEvent.click(screen.getByTitle(/Mark all 1 selected case\(s\) as Delivered/i));
    fireEvent.click(confirmDialog().getByRole('button', { name: /^Cancel$/i }));

    expect(store.updateCase).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /Confirm bulk status change/i })).toBeNull();
  });

  it('warns that Delivered empties the workstation, since that is the cost of a misclick', () => {
    render(<CaseListView />);
    useTableView();
    selectCase('DS-0001');

    fireEvent.click(screen.getByTitle(/Mark all 1 selected case\(s\) as Delivered/i));
    expect(confirmDialog().getByText(/leave the active workstation/i)).toBeTruthy();
  });

  it('offers the intermediate stages too, so the queue is not only forward-settable', () => {
    render(<CaseListView />);
    useTableView();
    selectCase('DS-0001');

    expect(screen.getByTitle(/as Received$/i)).toBeTruthy();
    expect(screen.getByTitle(/as In Progress$/i)).toBeTruthy();
    expect(screen.getByTitle(/as Delivered$/i)).toBeTruthy();
  });
});