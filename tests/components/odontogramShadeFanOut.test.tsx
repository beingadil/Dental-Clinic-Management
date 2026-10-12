// @vitest-environment jsdom
/**
 * A shade picked once applies to the WHOLE charted selection.
 *
 * The operator matches a bridge's abutments and pontics to each other, so one
 * click means "the job is this shade". `applyShade` wrote to `selectedToothId`
 * alone, so a 3-unit case came out with 3 different shades from a single click,
 * and the inspector then displayed the shade the operator had NOT just picked.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useState } from 'react';
import Odontogram from '../../src/components/cases/Odontogram';

afterEach(cleanup);

/**
 * Mirror every onChange payload into state.
 *
 * Writing into a plain object and reading it from a sibling element does NOT
 * work: `onChange` fires during the odontogram's own render/commit, so the
 * <output> never re-renders and always shows the initial value — the test then
 * fails on an artefact of the harness rather than on the behaviour.
 */
function ShadeProbe({ teeth }: { teeth: number[] }) {
  const [shadeByTooth, setShadeByTooth] = useState<Record<number, string>>({});
  return (
    <>
      <Odontogram
        initialSelected={teeth}
        onChange={(data) => setShadeByTooth(data.shadeByTooth ?? {})}
      />
      <output data-testid="shades">{JSON.stringify(shadeByTooth)}</output>
    </>
  );
}

const readShades = () =>
  JSON.parse(screen.getByTestId('shades').textContent || '{}') as Record<number, string>;

/** The shade swatch buttons are the only ones labelled with a shade code. */
const pickShade = (label: string) => {
  fireEvent.click(screen.getByRole('button', { name: label }));
};

describe('Odontogram — shade applies to the whole selection', () => {
  it('writes the shade to every charted tooth when 3 are selected', () => {
    render(<ShadeProbe teeth={[11, 21, 26]} />);

    pickShade('2M2');

    const shades = readShades();
    // The regression: only the inspected tooth used to receive the shade, so
    // this map came back with 2 of the 3 still on their old value.
    expect(shades[11]).toBe('2M2');
    expect(shades[21]).toBe('2M2');
    expect(shades[26]).toBe('2M2');
  });

  it('leaves a per-tooth override working when exactly one tooth is charted', () => {
    render(<ShadeProbe teeth={[16]} />);

    pickShade('3M3');

    expect(readShades()[16]).toBe('3M3');
  });

  it('does not touch teeth that were never selected', () => {
    render(<ShadeProbe teeth={[11, 21]} />);

    pickShade('1M1');

    const shades = readShades();
    expect(shades[11]).toBe('1M1');
    expect(shades[21]).toBe('1M1');
    // #46 was never charted, so it must have no shade at all.
    expect(shades[46]).toBeUndefined();
  });
});