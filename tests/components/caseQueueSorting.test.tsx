// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

/**
 * The queue header offers a sort key and a direction. That control is only
 * useful if picking one actually re-orders the rows.
 *
 * It once did not: the row list was memoised on the case set, the search text
 * and the queue window, but NOT on the two sort values the comparator read. The
 * dropdown re-rendered, the arrow flipped, and the rows stayed exactly where
 * they were — a control that looks live and is dead. This file exists so the
 * dependency list cannot quietly lose them again.
 */

const { CASES } = vi.hoisted(() => ({
  CASES: [
    { id: 'c1', case_number: 'DS-0001', status: 'in_progress', priority: 'low', created_at: '2026-10-01 09:00', delivery_date: '2026-10-30', lab_name: 'Alpha', doctor_name: 'Aslam' },
    { id: 'c2', case_number: 'DS-0002', status: 'in_progress', priority: 'urgent', created_at: '2026-10-05 09:00', delivery_date: '2026-10-12', lab_name: 'Alpha', doctor_name: 'Aslam' },
    { id: 'c3', case_number: 'DS-0003', status: 'in_progress', priority: 'high', created_at: '2026-10-09 09:00', delivery_date: '2026-10-20', lab_name: 'Alpha', doctor_name: 'Aslam' },
  ],
}));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({ cases: CASES, labs: [], brandingSettings: {} }),
}));

import { CaseQueueModal } from '../../src/components/dashboard/CaseQueueModal';

afterEach(cleanup);

/** The `open` queue holds every open case, so the fixture set is what the
    sort sees — a date-window queue would filter rows out from under the
    assertions and test the filter instead of the comparator. */
const queue = 'open' as never;

/** Case numbers in the order the list rendered them. */
const renderedOrder = (): string[] =>
  screen
    .queryAllByRole('listitem')
    .map((li) => li.textContent ?? '')
    .filter((t) => t.includes('DS-'))
    .map((t) => (t.match(/DS-\d{4}/) ?? [''])[0]);

const openQueue = () =>
  render(
    <CaseQueueModal
      queue={queue}
      cases={CASES as never}
      onSelectCase={() => {}}
      onOpenWorkstation={() => {}}
      onClose={() => {}}
    />,
  );

describe('case queue sorting', () => {
  it('opens ordered by due date, soonest first', () => {
    openQueue();
    // DS-0002 (12th) → DS-0003 (20th) → DS-0001 (30th)
    expect(renderedOrder()).toEqual(['DS-0002', 'DS-0003', 'DS-0001']);
  });

  it('actually re-orders when the sort key changes, rather than only redrawing', () => {
    openQueue();
    expect(renderedOrder()).toEqual(['DS-0002', 'DS-0003', 'DS-0001']);

    fireEvent.click(screen.getByRole('button', { name: /sort queue by/i }));
  fireEvent.click(screen.getByRole('option', { name: /priority/i }));

    // urgent → high → low
    expect(renderedOrder()).toEqual(['DS-0002', 'DS-0003', 'DS-0001']);
  });

  it('reverses when the direction is toggled', () => {
    openQueue();
    fireEvent.click(screen.getByRole('button', { name: /sort queue by/i }));
  fireEvent.click(screen.getByRole('option', { name: /priority/i }));
    const toggle = screen.getByRole('button', { name: /ascending/i });

    fireEvent.click(toggle);

    // low → high → urgent: the same three cases, the other way round.
    expect(renderedOrder()).toEqual(['DS-0001', 'DS-0003', 'DS-0002']);
    expect(screen.getByRole('button', { name: /descending/i })).toBeTruthy();
  });

  it('sorts by age from registration, ignoring the promised delivery date', () => {
    openQueue();
    fireEvent.click(screen.getByRole('button', { name: /sort queue by/i }));
  fireEvent.click(screen.getByRole('option', { name: /case age/i }));

    // Registered 01st, 05th, 09th — note DS-0001 has the LATEST delivery date
    // but the EARLIEST registration. A comparator that mixed in delivery_date
    // would rank it last.
    expect(renderedOrder()).toEqual(['DS-0001', 'DS-0002', 'DS-0003']);
  });

  it('keeps the case number as a stable tiebreak inside one due date', () => {
    openQueue();
    fireEvent.click(screen.getByRole('button', { name: /sort queue by/i }));
  fireEvent.click(screen.getByRole('option', { name: /case age/i }));
    const toggle = screen.getByRole('button', { name: /ascending/i });

    fireEvent.click(toggle);

    // Reversed on the primary key only. Flipping the tiebreak too would make
    // DS-1000 precede DS-9000 inside a single delivery date.
    expect(renderedOrder()).toEqual(['DS-0003', 'DS-0002', 'DS-0001']);
  });

  it('names the current direction in words, not only as an arrow', () => {
    openQueue();
    expect(screen.getByRole('button', { name: /ascending/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /ascending/i }));
    expect(screen.getByRole('button', { name: /descending/i })).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /descending/i })).getByText('Descending')).toBeTruthy();
  });
});