// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { GlassSelect } from '../../src/components/common/ui/GlassSelect';

/* The Daily Lab Report's type filter used to be pick-one. The operator's real
   question is "zirconia AND e.max this month", so the dropdown became a
   checklist: rows carry tick boxes, a tick does not close the menu, and an
   empty selection means "every type" rather than a dead trigger. */

const OPTIONS = [
  { value: 'Zirconia', label: 'Zirconia' },
  { value: 'E.max', label: 'E.max' },
  { value: 'PFM Crown', label: 'PFM Crown' },
];

afterEach(cleanup);

/** Wired exactly the way DailyReportView wires it: controlled state. */
const Harness = ({ initial = [] }: { initial?: string[] }) => {
  const [values, setValues] = useState<string[]>(initial);
  return (
    <GlassSelect
      multiple
      ariaLabel="Case types"
      values={values}
      onValuesChange={setValues}
      options={OPTIONS}
      emptyLabel="All types"
    />
  );
};

const trigger = () => screen.getByRole('button', { name: 'Case types' });
const open = () => fireEvent.click(trigger());
const option = (label: string) => screen.getByRole('option', { name: label });

describe('the multi-select glass dropdown', () => {
  it('says "All types" while nothing is ticked', () => {
    render(<Harness />);
    expect(trigger().textContent).toContain('All types');
  });

  it('keeps the menu open while ticking, so several types take one opening', () => {
    render(<Harness />);
    open();
    expect(screen.getAllByRole('option')).toHaveLength(3);

    fireEvent.click(option('Zirconia'));
    expect(option('Zirconia').getAttribute('aria-selected')).toBe('true');
    // Still on screen after the first tick.
    expect(screen.getAllByRole('option')).toHaveLength(3);

    fireEvent.click(option('E.max'));
    expect(option('E.max').getAttribute('aria-selected')).toBe('true');
    expect(option('Zirconia').getAttribute('aria-selected')).toBe('true');
  });

  it('names the first type and counts the rest on the trigger', () => {
    render(<Harness />);
    open();
    fireEvent.click(option('Zirconia'));
    expect(trigger().textContent).toContain('Zirconia');
    fireEvent.click(option('E.max'));
    expect(trigger().textContent).toContain('Zirconia +1');
  });

  it('un-ticks a type that is ticked again', () => {
    render(<Harness initial={['Zirconia', 'E.max']} />);
    open();
    fireEvent.click(option('Zirconia'));
    expect(option('Zirconia').getAttribute('aria-selected')).toBe('false');
    expect(option('E.max').getAttribute('aria-selected')).toBe('true');
  });

  it('still closes on a pick in single mode', () => {
    const picked: string[] = [];
    render(
      <GlassSelect
        ariaLabel="Single"
        value=""
        onChange={(v) => picked.push(v)}
        options={OPTIONS}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Single' }));
    fireEvent.click(option('E.max'));
    expect(picked).toEqual(['E.max']);
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});
