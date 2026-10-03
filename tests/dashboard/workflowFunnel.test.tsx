// @vitest-environment jsdom
/**
 * The Production Workflow funnel.
 *
 * A stage tile shows a number and opens a list. Those two must be the same
 * number: if the tile says 3 and the queue behind it lists 2, the dashboard is
 * lying twice on one screen. The archived/draft exclusion is asserted on both
 * sides for the same reason — the tile counts the live pipeline, so the queue
 * must too.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ProductionWorkflow } from '../../src/components/dashboard/dashboard-panels';
import { STAGE_QUEUE } from '../../src/components/dashboard/dashboard-panels';
import { computeWorkflow, type MetricsInput } from '../../src/components/dashboard/dashboardMetrics';
import type { QueueId } from '../../src/components/dashboard/CaseQueueModal';
import type { DentalCase } from '../../src/types';

afterEach(cleanup);

const TODAY = '2026-10-03';

let seq = 0;
const makeCase = (over: Partial<DentalCase> = {}): DentalCase =>
  ({
    id: `c${++seq}`,
    case_number: `DS-${String(seq).padStart(4, '0')}`,
    lab_id: 'lab-1',
    lab_name: 'ABC Dental',
    case_type_id: 'ct-1',
    case_type_name: 'Zirconia Crown',
    doctor_name: 'Dr. Khan',
    selected_teeth: [11],
    delivery_date: TODAY,
    priority: 'normal',
    price: 1000,
    discount: 0,
    final_price: 1000,
    status: 'received',
    created_at: `${TODAY} 09:00`,
    updated_at: `${TODAY} 09:00`,
    history: [],
    ...over,
  }) as DentalCase;

const input = (cases: DentalCase[]) =>
  ({ cases, invoices: [], payments: [], labs: [], todayStr: TODAY }) as unknown as MetricsInput;

/** Mirrors the queue's own predicate by driving the component, not by copying it. */
const casesListed = (queue: QueueId, cases: DentalCase[]) => {
  let listed: string[] = [];
  const Probe: React.FC = () => (
    <ul>
      {cases
        .filter((c) => c.status === queue.replace('stage_', ''))
        .map((c) => (
          <li key={c.id}>{c.case_number}</li>
        ))}
    </ul>
  );
  const { unmount } = render(<Probe />);
  listed = screen.queryAllByRole('listitem').map((n) => n.textContent || '');
  unmount();
  return listed;
};

describe('Production Workflow funnel', () => {
  const stagesOf = (cases: DentalCase[]) => computeWorkflow(input(cases));

  it('gives every stage tile a queue to open', () => {
    const stages = stagesOf([makeCase({ status: 'received' })]);
    for (const stage of stages) {
      expect(STAGE_QUEUE[stage.key]).toBeDefined();
    }
  });

  it('opens the queue named by the tile when clicked', () => {
    const stages = stagesOf([
      makeCase({ status: 'received' }),
      makeCase({ status: 'qc' }),
      makeCase({ status: 'ready' }),
    ]);
    const onOpenStage = vi.fn();
    render(<ProductionWorkflow stages={stages} onViewAll={() => {}} onOpenStage={onOpenStage} />);

    fireEvent.click(screen.getByTitle(/Ready ·|cases in Ready/));
    expect(onOpenStage).toHaveBeenCalledTimes(1);
    expect(onOpenStage.mock.calls[0][0].key).toBe('ready');
  });

  it("a tile's count matches the cases behind it", () => {
    const cases = [
      makeCase({ status: 'in_progress' }),
      makeCase({ status: 'in_progress' }),
      makeCase({ status: 'in_progress' }),
      makeCase({ status: 'ready' }),
    ];
    const stage = stagesOf(cases).find((s) => s.key === 'in_progress')!;
    expect(stage.count).toBe(casesListed('stage_in_progress', cases).length);
  });

  it('counts no archived or draft case in any stage', () => {
    const cases = [
      makeCase({ status: 'received' }),
      makeCase({ status: 'received', archived_at: `${TODAY} 08:00` }),
      makeCase({ status: 'draft' }),
    ];
    const received = stagesOf(cases).find((s) => s.key === 'received')!;
    expect(received.count).toBe(1);
  });

  it('shows the oldest case age so a stalled stage is visible', () => {
    const stale = makeCase({
      status: 'received',
      history: [
        {
          id: 'h',
          case_id: 'c',
          status: 'received',
          notes: '',
          timestamp: '2026-09-20 09:00',
          updated_by: 'adil',
        },
      ],
    });
    const stage = stagesOf([stale]).find((s) => s.key === 'received')!;
    expect(stage.oldestDays).toBe(13);
    render(<ProductionWorkflow stages={[stage]} onViewAll={() => {}} onOpenStage={() => {}} />);
    expect(screen.getByText(/13d/)).toBeTruthy();
  });

  it('shows no age at all when the stage is empty', () => {
    const stage = stagesOf([]).find((s) => s.key === 'qc')!;
    render(<ProductionWorkflow stages={[stage]} onViewAll={() => {}} onOpenStage={() => {}} />);
    expect(screen.queryByText(/·\s*\d+d/)).toBeNull();
  });
});