// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/**
 * The clinic chooser is shared by the General Ledger, the batch print dialog
 * and the payment recorder, so three surfaces now reach a clinic the same way.
 *
 * Two things it must keep doing, because each was a real complaint:
 *
 *   - Find a clinic by doctor or city, not only by the exact name the app
 *     stores. A front desk identifies a practice by its dentist far more often
 *     than by the label on the record.
 *   - Close on an outside click. A picker that stays pinned open until something
 *     is chosen traps the operator in it.
 */

const LABS = [
  { id: 'lab-1', name: 'Al-Noor Clinic', doctor_name: 'Aslam', city: 'F-7 Markaz', code: 'AN01', phone: '0300-1234567' },
  { id: 'lab-2', name: 'Bright Smile Dental', doctor_name: 'Khan', city: 'Bahria Town', code: 'BS02', phone: '0321-7654321' },
  { id: 'lab-3', name: 'DDS Scan Centre', doctor_name: 'Zain', city: 'Gulberg', code: 'DS03', phone: '0333-9998887' },
];

import { ClinicPicker } from '../../src/components/common/ui/ClinicPicker';

afterEach(cleanup);

const trigger = () => document.querySelector('[role="combobox"]') as HTMLElement;
const options = () => Array.from(document.querySelectorAll('[role="option"]'));
const filterBox = () =>
  document.querySelector('input[placeholder="Type to filter clinics…"]') as HTMLInputElement;

const setup = (props: Partial<React.ComponentProps<typeof ClinicPicker>> = {}) => {
  const onChange = vi.fn();
  render(<ClinicPicker clinics={LABS as never} value={null} onChange={onChange} {...props} />);
  return { onChange };
};

describe('ClinicPicker', () => {
  it('starts closed and shows nothing selected until a clinic is picked', () => {
    setup();
    expect(options()).toHaveLength(0);
    expect(trigger().textContent).toContain('Select clinic');
  });

  it('lists every clinic once opened', () => {
    setup();
    fireEvent.click(trigger());
    expect(options()).toHaveLength(3);
  });

  it('shows the current pick on the closed trigger', () => {
    setup({ value: 'lab-2' });
    expect(trigger().textContent).toContain('Bright Smile Dental');
  });

  it('finds a clinic by doctor, not only by name', () => {
    setup();
    fireEvent.click(trigger());
    // "Khan" is the doctor on Bright Smile Dental; nothing else carries it.
    fireEvent.change(filterBox(), { target: { value: 'Khan' } });
    expect(options()).toHaveLength(1);
    expect(options()[0].textContent).toContain('Bright Smile Dental');
  });

  it('finds a clinic by city and by phone', () => {
    setup();
    fireEvent.click(trigger());

    fireEvent.change(filterBox(), { target: { value: 'Bahria' } });
    expect(options()[0].textContent).toContain('Bright Smile Dental');

    fireEvent.change(filterBox(), { target: { value: '0333-9998887' } });
    expect(options()[0].textContent).toContain('DDS Scan Centre');
  });

  it('says so when the filter matches nothing', () => {
    setup();
    fireEvent.click(trigger());
    fireEvent.change(filterBox(), { target: { value: 'zzzz' } });
    expect(options()).toHaveLength(0);
    expect(screen.getByText(/No saved clinic matching "zzzz"/)).toBeTruthy();
  });

  it('reports the pick and closes', () => {
    const { onChange } = setup();
    fireEvent.click(trigger());
    fireEvent.change(filterBox(), { target: { value: 'Gulberg' } });
    fireEvent.click(options()[0]);

    expect(onChange).toHaveBeenCalledWith('lab-3');
    expect(options()).toHaveLength(0);
  });

  it('closes on an outside click rather than pinning itself open', () => {
    setup();
    fireEvent.click(trigger());
    expect(options().length).toBeGreaterThan(0);

    fireEvent.mouseDown(document.body);
    expect(options()).toHaveLength(0);
  });

  it('marks the current clinic in the list', () => {
    setup({ value: 'lab-1' });
    fireEvent.click(trigger());
    const selected = options().filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain('Al-Noor Clinic');
  });

  it('explains an empty clinic list differently from an empty search', () => {
    // "No clinics registered" is a setup problem; "no match" is a typo. They
    // need different words, so the caller supplies the label.
    const emptyLabel = (q: string) => (q ? `No match: ${q}` : 'No clinics registered');
    setup({ clinics: [] as never, emptyLabel });
    fireEvent.click(trigger());
    expect(screen.getByText('No clinics registered')).toBeTruthy();
  });
});