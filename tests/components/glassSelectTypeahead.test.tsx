// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { GlassSelect } from '../../src/components/common/ui/GlassSelect';

/**
 * Closed-trigger typeahead (native <select> semantics): printable characters
 * on the focused trigger narrow and commit the choice in place — focusing
 * "Case procedure" and pressing "z" lands on "Zirconia" WITHOUT opening the
 * menu, which is how the job-entry form expects to be driven.
 *
 * Regression guard: Enter must advance to the next field when onEnterAdvance
 * is wired (the case-entry form), and must still open the menu otherwise.
 */

const OPTIONS = [
  { value: 'zir', label: 'Zirconia' },
  { value: 'pfm', label: 'PFM Crown' },
  { value: 'emax', label: 'E.max Lithium Disilicate' },
  { value: 'pmma', label: 'PMMA' },
];

afterEach(cleanup);

const Harness = ({ onEnterAdvance }: { onEnterAdvance?: () => void }) => {
  const [value, setValue] = useState('');
  return (
    <GlassSelect
      ariaLabel="Case procedure / type"
      value={value}
      onChange={setValue}
      onEnterAdvance={onEnterAdvance}
      searchable
      options={OPTIONS}
    />
  );
};

const trigger = () => screen.getByRole('button', { name: 'Case procedure / type' });

describe('closed-trigger typeahead', () => {
  it('commits the first label starting with the typed letter', () => {
    render(<Harness />);
    fireEvent.keyDown(trigger(), { key: 'z' });
    expect(trigger().textContent).toContain('Zirconia');
  });

  it('commits the match for later letters too (case-insensitive)', () => {
    render(<Harness />);
    fireEvent.keyDown(trigger(), { key: 'e' });
    expect(trigger().textContent).toContain('E.max');
  });

  it('falls back to a substring match when nothing starts with the buffer', () => {
    render(<Harness />);
    // No label starts with "a"; Zirconia is the first that CONTAINS it.
    fireEvent.keyDown(trigger(), { key: 'a' });
    expect(trigger().textContent).toContain('Zirconia');
  });

  it('accumulates into a buffer across keystrokes', () => {
    render(<Harness />);
    fireEvent.keyDown(trigger(), { key: 'z' }); // Zirconia
    fireEvent.keyDown(trigger(), { key: 'i' }); // buffer "zi" — still Zirconia
    expect(trigger().textContent).toContain('Zirconia');
  });

  it('Enter advances to the next field instead of opening the menu', () => {
    const advance = vi.fn();
    render(<Harness onEnterAdvance={advance} />);
    fireEvent.keyDown(trigger(), { key: 'z' });
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    expect(advance).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Enter still opens the menu when onEnterAdvance is not wired', () => {
    render(<Harness />);
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    expect(screen.queryByRole('listbox')).toBeTruthy();
  });

  it('ArrowDown still opens the menu even with onEnterAdvance wired', () => {
    const advance = vi.fn();
    render(<Harness onEnterAdvance={advance} />);
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).toBeTruthy();
    expect(advance).not.toHaveBeenCalled();
  });
});
