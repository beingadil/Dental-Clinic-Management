// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// jsdom does not implement scrollIntoView; GlassSelect calls it when a menu opens.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * The case-entry form is driven by keyboard in the lab: Enter must walk
 * patient → clinic → doctor → procedure → Continue in order, and picking a
 * clinic must auto-fill the doctor from that clinic's own record — retyping
 * the same referent on every case was the tax the lab complained about.
 */

const addCase = vi.fn((_payload: Record<string, unknown>) => ({ id: 'case-new' }));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [
      { id: 'lab-1', name: 'Speedy Smiles', phone: '555-0100', doctor_name: 'Sana Malik' },
      { id: 'lab-2', name: 'Bright Clinic', phone: '555-0200', doctor_name: 'Imran Qureshi' },
    ],
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
  it('Enter walks patient → clinic → doctor → procedure → Continue', async () => {
    render(<CaseDetailModal initialShade="A2" onClose={vi.fn()} />);

    const patient = document.getElementById('case-patient-name')!;
    patient.focus();
    fireEvent.change(patient, { target: { value: 'Tariq Test' } });
    fireEvent.keyDown(patient, { key: 'Enter' });
    expect(document.activeElement).toBe(document.getElementById('case-lab-id'));

    const clinic = document.getElementById('case-lab-id')!;
    fireEvent.keyDown(clinic, { key: 'Enter' });
    expect(document.activeElement).toBe(document.getElementById('case-doctor-name'));

    const doctor = document.getElementById('case-doctor-name')!;
    fireEvent.change(doctor, { target: { value: 'Fareed Ali' } });
    fireEvent.keyDown(doctor, { key: 'Enter' });
    expect(document.activeElement).toBe(document.getElementById('case-type-id'));

    const procedure = document.getElementById('case-type-id')!;
    // Type "z" on the closed trigger — Zirconia commits in place, no menu.
    fireEvent.keyDown(procedure, { key: 'z' });
    await waitFor(() => expect(procedure.textContent).toContain('Zirconia'));

    fireEvent.keyDown(procedure, { key: 'Enter' });
    expect(document.activeElement).toBe(document.getElementById('case-step-continue'));
  });

  it('auto-fills the doctor of the preselected clinic on open', () => {
    render(<CaseDetailModal initialShade="A2" onClose={vi.fn()} />);
    // The wizard preselects the first clinic (Speedy Smiles, doctor Sana Malik)
    const doctor = document.getElementById('case-doctor-name') as HTMLInputElement;
    expect(doctor.value).toBe('Sana Malik');
  });

  it('selecting a clinic writes that clinic\'s doctor into the field', () => {
    render(<CaseDetailModal initialShade="A2" onClose={vi.fn()} />);

    // Note: the wizard preselects the FIRST clinic (Speedy Smiles) on open,
    // so this test picks the OTHER one to exercise a real change.
    fireEvent.click(screen.getByRole('button', { name: /laboratory/i }));
    fireEvent.click(
      screen.getAllByRole('option').find((o) => /bright clinic/i.test(o.textContent || ''))!,
    );

    const doctor = document.getElementById('case-doctor-name') as HTMLInputElement;
    expect(doctor.value).toBe('Imran Qureshi');
  });

  it('doctor auto-fill never clobbers a manually typed name', () => {
    render(<CaseDetailModal initialShade="A2" onClose={vi.fn()} />);

    // Starts on the preselected first clinic — switch to the other one first.
    fireEvent.click(screen.getByRole('button', { name: /laboratory/i }));
    fireEvent.click(
      screen.getAllByRole('option').find((o) => /bright clinic/i.test(o.textContent || ''))!,
    );
    expect((document.getElementById('case-doctor-name') as HTMLInputElement).value).toBe('Imran Qureshi');

    const doctor = document.getElementById('case-doctor-name') as HTMLInputElement;
    fireEvent.change(doctor, { target: { value: 'Manual Person' } });

    fireEvent.click(screen.getByRole('button', { name: /laboratory/i }));
    fireEvent.click(
      screen.getAllByRole('option').find((o) => /speedy smiles/i.test(o.textContent || ''))!,
    );
    expect((document.getElementById('case-doctor-name') as HTMLInputElement).value).toBe('Manual Person');
  });
});
