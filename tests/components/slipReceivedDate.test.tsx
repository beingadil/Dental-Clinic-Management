// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// LabCardSlip pulls branding from the app context; the slip body under test
// does not depend on it, so a stub context keeps this a pure render test.
vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({ brandingSettings: { appName: 'DENTAL SOLUTIONS', tagline: '', phone: '', email: '', address: '' } }),
}));

import { JobSlipCard } from '../../src/components/print/JobSlipCard';
import { LabCardSlip } from '../../src/components/cases/LabCardSlip';
import { receivedDateFor } from '../../src/utils/dateUtils';
import { DentalCase } from '../../src/types';

afterEach(cleanup);

const baseCase: DentalCase = {
  id: 'c1',
  case_number: 'DS-2001',
  patient_name: 'Ali Raza',
  lab_id: 'lab-1',
  lab_name: 'Cases Clinic',
  case_type_id: 'ct-1',
  case_type_name: 'Zirconia',
  doctor_name: 'Dr. Test',
  selected_teeth: [11, 12],
  shade: 'A2',
  // A FUTURE promised date, weeks away from receipt.
  delivery_date: '2026-12-20',
  received_date: '2026-10-03',
  priority: 'normal',
  price: 100,
  discount: 0,
  final_price: 100,
  instructions: 'Check margins',
  status: 'received',
  created_at: '2026-10-01 09:00',
  updated_at: '2026-10-01 09:00',
  history: [],
};

describe('received date on slips', () => {
  it('falls back to the registration day when no received date was captured', () => {
    expect(receivedDateFor({ received_date: '2026-10-03', created_at: '2026-10-01 09:00' })).toBe('2026-10-03');
    expect(receivedDateFor({ received_date: null, created_at: '2026-10-01 09:00' })).toBe('2026-10-01');
    expect(receivedDateFor({ received_date: '   ', created_at: '2026-10-01T09:00' })).toBe('2026-10-01');
    // Never falls back to the delivery date.
    expect(receivedDateFor({ received_date: null, created_at: '' })).toBe('');
  });

  it('prints the received date on the 100×95 job tag, not the delivery date', () => {
    render(<JobSlipCard caseData={baseCase} labName="DENTAL SOLUTIONS" />);
    expect(screen.getByText('RECEIVED')).toBeTruthy();
    expect(screen.getByText('03-10-2026')).toBeTruthy();
    expect(screen.queryByText('DUE')).toBeNull();
    expect(screen.queryByText('20-12-2026')).toBeNull();
    expect(screen.queryByText(/delivery date/i)).toBeNull();
  });

  it('prints the received date on the A4 slip, not the delivery date', () => {
    render(<LabCardSlip caseData={baseCase} />);
    expect(screen.getByText('Received Date:')).toBeTruthy();
    expect(screen.getByText('03-10-2026')).toBeTruthy();
    expect(screen.queryByText('Delivery Date:')).toBeNull();
    expect(screen.queryByText('20-12-2026')).toBeNull();
  });

  it('falls back to the registration day on a pre-019 case', () => {
    const legacy = { ...baseCase, received_date: null };
    render(<JobSlipCard caseData={legacy} labName="DENTAL SOLUTIONS" />);
    expect(screen.getByText('01-10-2026')).toBeTruthy();
    expect(screen.queryByText('20-12-2026')).toBeNull();
  });
});