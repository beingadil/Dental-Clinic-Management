// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

/* Two clinics, one with two cases (newest first) and one with none, so the
   table's per-clinic case count and "latest case" column are both exercised. */
const { LABS, CASES } = vi.hoisted(() => ({
  LABS: [
    { id: 'lab-1', name: 'Al-Noor Clinic', contact_person: 'Dr. Aslam', phone: '0300-1234567', email: 'alnoor@example.com', address: 'F-7 Markaz' },
    { id: 'lab-2', name: 'Bright Smile Dental', contact_person: 'Dr. Khan', phone: '0321-7654321', email: 'bright@example.com', address: 'Bahria Town' },
  ],
  CASES: [
    { id: 'c-1', case_number: 'DS-3002', lab_id: 'lab-1', status: 'in_progress', created_at: '2026-03-04 10:00', delivery_date: '2026-03-20' },
    { id: 'c-2', case_number: 'DS-3001', lab_id: 'lab-1', status: 'delivered', created_at: '2026-02-04 10:00', delivery_date: '2026-02-20' },
  ],
}));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({ labs: LABS, cases: CASES, addLab: () => {} }),
}));

import { LabListView } from '../../src/components/labs/LabListView';

const VIEW_KEY = 'dentlab_clinics_view_mode';

/** The card grid has no table; the list view is one table for all clinics. */
const listTable = () => screen.queryByRole('table');

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('Dental Clinics list view', () => {
  it('opens on the card grid, as the module has always done', () => {
    render(<LabListView />);

    expect(screen.getByText('Cards')).toBeTruthy();
    expect(listTable()).toBeNull();
  });

  it('switches to a dense table with every contact column', () => {
    render(<LabListView />);
    fireEvent.click(screen.getByText('List'));

    const table = listTable()!;
    expect(table).toBeTruthy();
    for (const heading of [
      'Dental Clinic',
      'Doctor',
      'Phone',
      'Email',
      'Address',
      'Cases',
      'Latest Case',
      'Action',
    ]) {
      expect(within(table).getByText(heading)).toBeTruthy();
    }
  });

  it('lists one row per clinic with its contacts and case count', () => {
    render(<LabListView />);
    fireEvent.click(screen.getByText('List'));

    const row = within(listTable()!)
      .getByText('Al-Noor Clinic')
      .closest('tr') as HTMLElement;
    expect(within(row).getByText('Dr. Aslam')).toBeTruthy();
    expect(within(row).getByText('0300-1234567')).toBeTruthy();
    expect(within(row).getByText('alnoor@example.com')).toBeTruthy();
    expect(within(row).getByText('F-7 Markaz')).toBeTruthy();
    expect(within(row).getByText('2')).toBeTruthy(); // two cases
    expect(within(row).getByText('DS-3002')).toBeTruthy(); // newest case, not the first in the array
  });

  it('says so when a clinic has no cases rather than showing a blank cell', () => {
    render(<LabListView />);
    fireEvent.click(screen.getByText('List'));

    const row = within(listTable()!)
      .getByText('Bright Smile Dental')
      .closest('tr') as HTMLElement;
    expect(within(row).getByText('0')).toBeTruthy();
    expect(within(row).getByText('No cases')).toBeTruthy();
  });

  it('filters the list by clinic name, doctor, email or address', () => {
    render(<LabListView />);
    fireEvent.click(screen.getByText('List'));

    fireEvent.change(screen.getByPlaceholderText(/Search clinic name/), {
      target: { value: 'bahria' },
    });

    expect(within(listTable()!).getByText('Bright Smile Dental')).toBeTruthy();
    expect(within(listTable()!).queryByText('Al-Noor Clinic')).toBeNull();
  });

  it('remembers the chosen view for the next visit', () => {
    render(<LabListView />);
    fireEvent.click(screen.getByText('List'));
    expect(localStorage.getItem(VIEW_KEY)).toBe('list');

    cleanup();
    render(<LabListView />);
    expect(listTable()).toBeTruthy();
  });
});