// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DatePickerSingle } from '../../src/components/common/DatePickerSingle';
import { todayISO } from '../../src/components/common/DatePickerRange';

afterEach(cleanup);

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <DatePickerSingle label="Received Date" value={value} onChange={setValue} />
      <span data-testid="value">{value || 'EMPTY'}</span>
    </div>
  );
}

describe('DatePickerSingle', () => {
  it('shows the placeholder until a date is picked', () => {
    render(<Harness />);
    expect(screen.getByText('Not set')).toBeTruthy();
    expect(screen.getByTestId('value').textContent).toBe('EMPTY');
  });

  it('picks today from the quick chip and emits a plain YYYY-MM-DD value', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Received Date' }));
    fireEvent.click(screen.getByRole('button', { name: /^today$/i }));
    expect(screen.getByTestId('value').textContent).toBe(todayISO());
  });

  it('navigates months and selects a calendar day', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Received Date' }));
    fireEvent.click(screen.getByRole('button', { name: /next month/i }));
    const day = screen.getAllByRole('button', { name: '15' })[0];
    fireEvent.click(day);
    // Whatever day was picked, the value is a bare ISO date and the popup closed.
    expect(screen.getByTestId('value').textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.queryByRole('button', { name: /next month/i })).toBeNull();
  });

  it('clears the value back to empty', () => {
    render(<Harness initial="2026-10-03" />);
    expect(screen.getAllByText('2026-10-03').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Received Date' }));
    fireEvent.click(screen.getByRole('button', { name: /clear received date/i }));
    expect(screen.getByTestId('value').textContent).toBe('EMPTY');
  });

  it('never rejects a past date — receipt is a historical fact', () => {
    const onChange = vi.fn();
    render(<DatePickerSingle label="Received Date" value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Received Date' }));
    fireEvent.change(screen.getByLabelText(/received date value/i), { target: { value: '2020-01-02' } });
    expect(onChange).toHaveBeenCalledWith('2020-01-02');
  });
});