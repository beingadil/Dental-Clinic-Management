// @vitest-environment jsdom
/**
 * The Catalog → Shades tab manages the guides the odontogram reads. These
 * tests pin what the odontogram depends on: guides are created and shaded
 * exactly where the case form will find them (clinicalSpecsRepo).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { clinicalSpecsRepo } from '../../src/db/repos';

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    caseTypes: [],
    addCaseType: vi.fn(),
    updateCaseType: vi.fn(),
    deleteCaseType: vi.fn(),
    brandingSettings: { appName: 'Dental Solutions', primaryColor: '#0f766e' },
  }),
}));

import { CatalogView } from '../../src/components/catalog/CatalogView';

afterEach(cleanup);

beforeAll(async () => {
  const SQL = await initSqlJs();
  const engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);
});

beforeEach(() => {
  clinicalSpecsRepo.shadeGuides.deleteAll();
  clinicalSpecsRepo.shadeGuides.insert({
    id: 'vita-test',
    name: 'VITA Classical',
    system: 'vita_classical',
    shades: ['A1', 'A2', 'A3'],
  });
});

const openShades = () => {
  render(<CatalogView />);
  fireEvent.click(screen.getByRole('button', { name: 'Shades' }));
};

describe('Catalog → Shades', () => {
  it('lists the stored guide and its shades', () => {
    openShades();
    expect(screen.getByText('VITA Classical')).toBeTruthy();
    expect(screen.getByText('A1')).toBeTruthy();
    expect(screen.getByText('A2')).toBeTruthy();
  });

  it('adds a shade to a guide and persists it to the repo', () => {
    openShades();
    const input = screen.getByLabelText('Add a shade to VITA Classical');
    fireEvent.change(input, { target: { value: 'A5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add shade' }));

    expect(screen.getByText('A5')).toBeTruthy();
    const stored = clinicalSpecsRepo.shadeGuides.all().find((g) => g.id === 'vita-test');
    expect(stored?.shades).toContain('A5');
  });

  it('rejects a duplicate shade with an explanation', () => {
    openShades();
    const input = screen.getByLabelText('Add a shade to VITA Classical');
    fireEvent.change(input, { target: { value: 'A1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add shade' }));

    expect(screen.getByRole('alert').textContent).toMatch(/already in/i);
    const stored = clinicalSpecsRepo.shadeGuides.all().find((g) => g.id === 'vita-test');
    expect(stored?.shades.filter((s: string) => s === 'A1')).toHaveLength(1);
  });

  it('creates a whole new guide from a comma-separated shade list', () => {
    openShades();
    fireEvent.click(screen.getByRole('button', { name: /Add new guide/i }));
    fireEvent.change(screen.getByLabelText('Guide name'), { target: { value: 'IPS e.max' } });
    fireEvent.change(screen.getByLabelText('Shades (comma separated)'), { target: { value: 'E1, E2, E1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create guide' }));

    expect(screen.getByText('IPS e.max')).toBeTruthy();
    const stored = clinicalSpecsRepo.shadeGuides.all().find((g) => g.name === 'IPS e.max');
    expect(stored?.shades).toEqual(['E1', 'E2']); // deduped, order preserved
  });
});
