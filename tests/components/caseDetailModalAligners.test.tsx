// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { addDaysISO, todayISO } from '../../src/components/common/DatePickerRange';

/**
 * Clear Aligners (per stage) — catalog-driven job type. The wizard reveals
 * the arch stage panel on the TEETH step (aligners carry no chart), bills
 * stages × catalog rate up front, and seeds a 30-day due date (an aligner
 * cycle runs scan → print → trim → collect, far past the 10-day SLA).
 */

const addCase = vi.fn((_payload: Record<string, unknown>) => ({ id: 'case-new' }));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [{ id: 'lab-1', name: 'Speedy Smiles' }], // preselected first lab
    caseTypes: [
      { id: 'ct-1', name: 'Zirconia', base_price: 500 },
      { id: 'ct-aligners', name: 'Clear Aligners (per stage)', base_price: 500, needs_teeth: false },
    ],
    pricingOverrides: [],
    addCase,
    updateCase: vi.fn(),
    deleteCase: vi.fn(),
    saveAsTemplate: vi.fn(),
    getDoctorPreferredLab: vi.fn(() => null),
    setDoctorPreferredLab: vi.fn(),
    caseAttachments: {},
    addCaseAttachment: vi.fn(),
    deleteCaseAttachment: vi.fn(),
    user: { id: 'u1', name: 'Tester', role: 'Clinic Entry Manager' },
  }),
  useOptionalApp: () => null,
}));

import { CaseDetailModal } from '../../src/components/cases/CaseDetailModal';

afterEach(() => {
  cleanup();
  addCase.mockClear();
});

function selectAligners() {
  const procedure = screen.getByRole('button', { name: /case procedure/i });
  fireEvent.click(procedure);
  const opt = screen.getAllByRole('option').find((o) => /clear aligners/i.test(o.textContent || ''))!;
  fireEvent.click(opt);
}

describe('Clear Aligners — wizard + capture', () => {
  it('shows the arch panel on the teeth step, not the basics step', () => {
    render(<CaseDetailModal initialShade="A2" onClose={vi.fn()} />);
    expect(screen.queryByText('Aligner Series')).toBeNull();
    fireEvent.change(document.getElementById('case-doctor-name')!, { target: { value: 'Fareed Ali' } });
    selectAligners();
    fireEvent.click(screen.getByRole('button', { name: /continue/i })); // → teeth step
    expect(screen.getByText('Aligner Series')).toBeTruthy();
  });

  it('re-prices stages × rate and records the series on save', async () => {
    render(<CaseDetailModal initialShade="A2" onClose={vi.fn()} />);

    fireEvent.change(document.getElementById('case-patient-name')!, { target: { value: 'Tariq Test' } });
    fireEvent.change(document.getElementById('case-doctor-name')!, { target: { value: 'Fareed Ali' } });

    selectAligners();
    fireEvent.click(screen.getByRole('button', { name: /continue/i })); // → teeth step

    // 20 upper trays, 0 lower → 20 × 500 = 10,000 (price recomputed live)
    const upper = document.getElementById('case-aligner-u') as HTMLInputElement;
    fireEvent.change(upper, { target: { value: '20' } });

    fireEvent.click(screen.getByRole('button', { name: /continue/i })); // → schedule step

    const price = document.getElementById('case-price') as HTMLInputElement;
    expect(price.value).toBe('10000');

    // Aligner SLA: delivery date seeded 30 days out (visible on the schedule step).
    const deliveryInput = document.getElementById('case-delivery-date') as HTMLButtonElement;
    expect(deliveryInput.textContent).toContain(addDaysISO(todayISO(), 30));

    // The commit is refused inside STEP_SETTLE_MS of arriving on the step.
    await new Promise((r) => setTimeout(r, 450));
    fireEvent.click(screen.getByRole('button', { name: /create dental case/i }));

    await waitFor(() => expect(addCase).toHaveBeenCalled(), { timeout: 3000 });
    const payload = addCase.mock.calls[0]![0];
    expect(payload.aligner_upper_count).toBe(20);
    expect(payload.aligner_lower_count).toBe(0);
    expect(payload.price).toBe(10000);
    expect(payload.final_price).toBe(10000);
    expect(payload.case_type_name).toMatch(/clear aligners/i);
    expect(payload.delivery_date).toBe(addDaysISO(todayISO(), 30));
  });

  it('blocks Continue until at least one arch has stages', async () => {
    render(<CaseDetailModal initialShade="A2" onClose={vi.fn()} />);

    fireEvent.change(document.getElementById('case-doctor-name')!, { target: { value: 'Fareed Ali' } });

    selectAligners();
    fireEvent.click(screen.getByRole('button', { name: /continue/i })); // → teeth step

    // 0 stages on both arches — Continue must refuse and point at the fields.
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByText(/enter stages for at least one arch/i)).toBeTruthy();
    expect(document.getElementById('case-aligner-u')).toBeTruthy(); // still on the panel
  });
});
