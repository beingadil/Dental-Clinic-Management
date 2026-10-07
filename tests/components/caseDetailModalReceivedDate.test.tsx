// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const addCase = vi.fn((_payload: Record<string, unknown>) => ({ id: 'case-new' }));
const updateCase = vi.fn();

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [{ id: 'lab-1', name: 'Cases Clinic' }],
    caseTypes: [{ id: 'ct-1', name: 'Zirconia', base_price: 500 }],
    pricingOverrides: [],
    addCase,
    updateCase,
    deleteCase: vi.fn(),
    saveAsTemplate: vi.fn(),
    getDoctorPreferredLab: vi.fn(() => null),
    setDoctorPreferredLab: vi.fn(),
    caseAttachments: {},
    addCaseAttachment: vi.fn(),
    deleteCaseAttachment: vi.fn(),
    user: { id: 'u1', name: 'Tester', role: 'Technician' },
  }),
}));

import { CaseDetailModal } from '../../src/components/cases/CaseDetailModal';
import { todayISO } from '../../src/components/common/DatePickerRange';

afterEach(() => {
  cleanup();
  addCase.mockClear();
  updateCase.mockClear();
});

/** Fill the wizard's required basics and land on the schedule step. */
async function openScheduleStep() {
  render(<CaseDetailModal initialShade="A2" onClose={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText(/Dr\. Tariq Mahmood/i), { target: { value: 'Dr. Test' } });
  await waitFor(() => expect(screen.queryByRole('button', { name: /continue/i })).toBeTruthy());
  // The case type is required before the wizard leaves the basics step.
  const typeSelect = screen.getAllByRole('combobox')[1] ?? screen.getAllByRole('combobox')[0];
  fireEvent.change(typeSelect, { target: { value: 'ct-1' } });
  fireEvent.click(screen.getByRole('button', { name: /continue/i })); // → teeth step
  await waitFor(() => expect(screen.getAllByText(/FDI Charting/i).length).toBeGreaterThan(0));
  // The chart step requires at least one tooth before it will advance.
  fireEvent.click(screen.getByRole('button', { name: /upper arch/i }));
  fireEvent.click(screen.getByRole('button', { name: /continue/i })); // → schedule step
  await waitFor(() => expect(screen.getByRole('button', { name: 'Received Date' })).toBeTruthy());
  // The modal refuses a commit within STEP_SETTLE_MS of arriving on a step.
  await new Promise((r) => setTimeout(r, 400));
}

/** Press the last-step commit button and wait for the write to land. */
async function createCase() {
  fireEvent.click(screen.getByRole('button', { name: /create dental case/i }));
  await waitFor(() => expect(addCase).toHaveBeenCalled(), { timeout: 3000 });
}

describe('CaseDetailModal — Received Date on the job entry form', () => {
  it('pre-fills today and saves it, without making it a required field', async () => {
    await openScheduleStep();

    const picker = screen.getByRole('button', { name: 'Received Date' });
    expect(picker.textContent).toContain(todayISO());

    // The delivery date is untouched by the received date.
    await createCase();
    const payload = addCase.mock.calls[0]![0];
    expect(payload.received_date).toBe(todayISO());
    // The promised future date still drives SLA/overdue and is still required.
    expect(payload.delivery_date).toBeTruthy();
  });

  it('saves a back-dated received date when the operator picks an earlier day', async () => {
    await openScheduleStep();

    fireEvent.click(screen.getByRole('button', { name: 'Received Date' }));
    fireEvent.change(screen.getByLabelText(/received date value/i), { target: { value: '2026-01-15' } });

    await createCase();
    expect(addCase.mock.calls[0]![0].received_date).toBe('2026-01-15');
  });

  it('still saves with no received date at all (the field is optional)', async () => {
    await openScheduleStep();

    fireEvent.click(screen.getByRole('button', { name: 'Received Date' }));
    fireEvent.click(screen.getByRole('button', { name: /clear received date/i }));

    await createCase();
    expect(addCase.mock.calls[0]![0].received_date).toBeNull();
  });
});