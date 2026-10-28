// @vitest-environment jsdom
import { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  DatePickerRange,
  standardQuickRanges,
} from '../../src/components/common/DatePickerRange';

afterEach(cleanup);

function Harness({ initialFrom = '', initialTo = '' }: { initialFrom?: string; initialTo?: string }) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  return (
    <div>
      <DatePickerRange
        from={from}
        to={to}
        onChange={(f, t) => {
          setFrom(f);
          setTo(t);
        }}
      />
      <span data-testid="range">{`${from || 'EMPTY'}..${to || 'EMPTY'}`}</span>
    </div>
  );
}

describe('standardQuickRanges', () => {
  it('builds the one shared preset list from any anchor day', () => {
    expect(standardQuickRanges('2026-03-15')).toEqual([
      { label: 'Today', from: '2026-03-15', to: '2026-03-15' },
      { label: 'Yesterday', from: '2026-03-14', to: '2026-03-14' },
      { label: 'Last 7 Days', from: '2026-03-09', to: '2026-03-15' },
      { label: 'This Month', from: '2026-03-01', to: '2026-03-31' },
      { label: 'Last Month', from: '2026-02-01', to: '2026-02-28' },
      { label: 'All Time', from: '', to: '' },
    ]);
  });

  it('handles leap years, month ends and January rollover', () => {
    const lastMonth = (day: string) =>
      standardQuickRanges(day).find((p) => p.label === 'Last Month');
    expect(lastMonth('2024-03-15')).toEqual({
      label: 'Last Month',
      from: '2024-02-01',
      to: '2024-02-29',
    });
    expect(lastMonth('2026-01-10')).toEqual({
      label: 'Last Month',
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(lastMonth('2026-03-31')).toEqual({
      label: 'Last Month',
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('counts Last 7 Days as today plus the six days before it', () => {
    const seven = standardQuickRanges('2026-10-28').find((p) => p.label === 'Last 7 Days');
    expect(seven).toEqual({ label: 'Last 7 Days', from: '2026-10-22', to: '2026-10-28' });
  });
});

describe('DatePickerRange', () => {
  it('labels an empty range All Time', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: /all time/i })).toBeTruthy();
  });

  it('offers the same presets everywhere, including Custom Range', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /all time/i }));

    for (const label of ['Today', 'Yesterday', 'Last 7 Days', 'This Month', 'Last Month', 'All Time', 'Custom Range']) {
      expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0);
    }
  });

  it('applies Last Month in one click and shows the preset name', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /all time/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Last Month' }));

    const expected = standardQuickRanges().find((p) => p.label === 'Last Month')!;
    expect(screen.getByTestId('range').textContent).toBe(`${expected.from}..${expected.to}`);
    expect(screen.getByRole('button', { name: /last month/i })).toBeTruthy();
    // A preset is a complete decision: the popup closes on the same click.
    expect(screen.queryByRole('dialog', { name: /choose date range/i })).toBeNull();
  });

  it('keeps a custom range open and marks Custom Range active', () => {
    render(<Harness initialFrom="2026-09-03" initialTo="2026-09-09" />);
    fireEvent.click(screen.getByRole('button', { name: /2026-09-03/i }));
    const custom = screen.getByRole('button', { name: 'Custom Range' });
    expect(custom.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(custom);
    expect(screen.getByRole('dialog', { name: /choose date range/i })).toBeTruthy();
  });

  it('keeps the calendar on the month being picked after choosing a start date', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /all time/i }));

    const monthValue = () => Number((screen.getByLabelText('Month') as HTMLSelectElement).value);
    const startMonth = monthValue();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    const pickedMonth = (startMonth + 11) % 12;
    expect(monthValue()).toBe(pickedMonth);

    fireEvent.click(screen.getByRole('button', { name: '15' }));
    // The pick switched the calendar to the end date; the view must not jump
    // back to today's month when that happens.
    expect(monthValue()).toBe(pickedMonth);
  });

  it('clears back to All Time', () => {
    render(<Harness initialFrom="2026-09-03" initialTo="2026-09-09" />);
    fireEvent.click(screen.getByRole('button', { name: /clear date range/i }));
    expect(screen.getByTestId('range').textContent).toBe('EMPTY..EMPTY');
    expect(screen.getByRole('button', { name: /all time/i })).toBeTruthy();
  });
});
