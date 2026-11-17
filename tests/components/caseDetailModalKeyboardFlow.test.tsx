// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';

/**
 * The case-entry form is driven by keyboard in the lab: Enter must walk
 * patient → doctor → clinic → procedure → Continue in order, and the
 * procedure select must commit a typeahead ("z" → Zirconia) on Enter.
 * Nothing here requires Tab, a mouse, or opening a menu.
 */

const addCase = vi.fn((_payload: Record<string, unknown>) => ({ id: 'case-new' }));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [{ id: 'lab-1', name: 'Speedy Smiles', phone: '555-0100' }],
    caseTypes: [{ id: 'ct-1', name: 'Zirconia', base_price: 500 }],
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

describe('CaseDetailModal — keyboard flow through the basics grid', () => {
  it('Enter walks patient → doctor → clinic → procedure → Continue', async () => {
    render(<CaseDetailModal initialShade="A2" onClose={vi.fn()} />);

    const patient = document.getElementById('case-patient-name')!;
    patient.focus();
    fireEvent.change(patient, { target: { value: 'Tariq Test' } });
    fireEvent.keyDown(patient, { key: 'Enter' });
    expect(document.activeElement).toBe(document.getElementById('case-doctor-name'));

    const doctor = document.getElementById('case-doctor-name')!;
    fireEvent.change(doctor, { target: { value: 'Fareed Ali' } });
    fireEvent.keyDown(doctor, { key: 'Enter' });
    expect(document.activeElement).toBe(document.getElementById('case-lab-id'));

    const clinic = document.getElementById('case-lab-id')!;
    fireEvent.keyDown(clinic, { key: 'Enter' });
    expect(document.activeElement).toBe(document.getElementById('case-type-id'));

    const procedure = document.getElementById('case-type-id')!;
    // Type "z" on the closed trigger — Zirconia commits in place, no menu.
    fireEvent.keyDown(procedure, { key: 'z' });
    await waitFor(() => expect(procedure.textContent).toContain('Zirconia'));

    fireEvent.keyDown(procedure, { key: 'Enter' });
    expect(document.activeElement).toBe(document.getElementById('case-step-continue'));
  });

  it('plain typing inside the patient field does not commit anything silently', () => {
    render(<CaseDetailModal initialShade="A2" onClose={vi.fn()} />);
    const patient = document.getElementById('case-patient-name') as HTMLInputElement;
    patient.focus();
    fireEvent.change(patient, { target: { value: 'Zainab' } });
    expect(patient.value).toBe('Zainab');
  });
});
