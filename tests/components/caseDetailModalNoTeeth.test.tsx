// @vitest-environment jsdom
/**
 * A catalog product flagged `needs_teeth: false` must not force the operator
 * through tooth charting. The wizard drops the chart's requirement, says why on
 * the step, and — the part that matters downstream — COMMITS empty teeth and no
 * shade, so every output surface (job slip, invoice, lab card, ledger) omits
 * them without needing to know about the flag at all.
 *
 * A product that omits the flag (every row saved before migration 021) must
 * keep behaving exactly as it did: charting still required.
 *
 * THE CATALOG COMES FROM SQLITE, NOT FROM A LITERAL.
 *
 * This file used to build its three products as a hand-written object array
 * passed straight through a mocked `useApp`. That array was shaped like what
 * `caseTypeToDomain` produces, so it agreed with the read path only by
 * coincidence — and the whole point of the flag is that the read path is where
 * absent-vs-false is resolved. Had `caseTypeToDomain` ever changed, this test
 * would have kept passing against a catalog shape the app can no longer
 * produce.
 *
 * Instead the test creates a real in-memory engine, applies migrations, and
 * inserts the rows with SQL, then hands the modal `caseTypesRepo.all()`. The
 * `ct-legacy` row is written WITHOUT a `needs_teeth` key at all, which is
 * exactly what a pre-migration-021 database looks like on disk; resolving it to
 * "required" is then the DEFAULT clause's doing, not a property of the test.
 */
import React from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import initSqlJs from 'sql.js';
import { SqliteEngine } from '../../src/db/engine';
import { setDatabase } from '../../src/db/core';
import { caseTypesRepo } from '../../src/db/repos';

const addCase = vi.fn((_payload: Record<string, unknown>) => ({ id: 'case-new' }));
const updateCase = vi.fn();

/**
 * The catalog the modal sees, read back through the real repository. Evaluated
 * lazily inside `useApp` so it picks up whatever the database holds at render
 * time rather than capturing a snapshot at module load.
 */
const readCatalog = () => caseTypesRepo.all();

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    labs: [{ id: 'lab-1', name: 'Cases Clinic' }],
    caseTypes: readCatalog(),
    pricingOverrides: [],
    addCase,
    updateCase,
    deleteCase: vi.fn(),
    saveAsTemplate: vi.fn(),
    getDoctorPreferredLab: vi.fn(() => null),
    setDoctorPreferredLab: vi.fn(),
    caseAttachments: {},
    addCaseAttachment: vi.fn(),
    deleteCaseAttachment: vi.fn(),
    user: { id: 'u1', name: 'Tester', role: 'Technician' },
  }),
}));

import { CaseDetailModal } from '../../src/components/cases/CaseDetailModal';

let engine: SqliteEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = await SqliteEngine.create(SQL, null);
  engine.migrate();
  setDatabase(engine);

  // A product that IS per-tooth work — flag on explicitly.
  caseTypesRepo.insert({ id: 'ct-tooth', name: 'Zirconia Crown', base_price: 500, needs_teeth: true });

  // A pre-migration-021 product: written with no needs_teeth key whatsoever, so
  // the migration's DEFAULT 1 supplies it, exactly as it did on a real upgrade.
  engine.run(
    `INSERT INTO case_types (id, name, base_price, created_at) VALUES ('ct-legacy', 'Retainer', 400, '2026-01-01')`
  );

  // A product that is NOT per-tooth work.
  caseTypesRepo.insert({ id: 'ct-retainer', name: 'Clear Retainer', base_price: 450, needs_teeth: false });
});

afterEach(() => {
  cleanup();
  addCase.mockClear();
  updateCase.mockClear();
});

const DOCTOR_PLACEHOLDER = /Tariq Mahmood/i;

/**
 * The read path, asserted before the UI depends on it. If the repository ever
 * resolved absent-vs-false differently, these fail here — naming the mapping —
 * instead of surfacing as a confusing wizard assertion.
 */
describe('the catalog these tests read is the real SQLite one', () => {
  it('stores needs_teeth=0 only where it was explicitly turned off', () => {
    const rows = Object.fromEntries(caseTypesRepo.all().map((ct) => [ct.id, ct]));
    expect(rows['ct-retainer'].needs_teeth).toBe(false);
    expect(rows['ct-tooth'].needs_teeth).toBe(true);
    // The point of the whole file: a row with no flag reads as REQUIRED.
    expect(rows['ct-legacy'].needs_teeth).toBe(true);
    // And the raw column really is absent-by-default rather than faked.
    expect(
      engine.get<{ needs_teeth: number }>('SELECT needs_teeth FROM case_types WHERE id = ?', ['ct-legacy'])
        ?.needs_teeth
    ).toBe(1);
  });
});

/** Fill the basics step and choose `caseTypeId`, then advance to the chart step. */
async function reachChartStep(caseTypeId: string) {
  render(<CaseDetailModal initialShade="A2" onClose={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText(DOCTOR_PLACEHOLDER), { target: { value: 'Tariq Test' } });
  await waitFor(() => expect(screen.queryByRole('button', { name: /continue/i })).toBeTruthy());
  const typeSelect = screen.getAllByRole('combobox')[1] ?? screen.getAllByRole('combobox')[0];
  fireEvent.change(typeSelect, { target: { value: caseTypeId } });
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
  await waitFor(() => expect(screen.getAllByText(/FDI Charting/i).length).toBeGreaterThan(0));
}

/** The chart seeds #11 and #21 so a crown is never accidentally empty. */
async function clearChart() {
  fireEvent.click(screen.getByRole('button', { name: /^clear \(\d+\)$/i }));
  await waitFor(() => expect(screen.queryByRole('button', { name: /^clear/i })).toBeNull());
}

/** From the schedule step, press the commit button and wait for the write. */
async function commit() {
  // The modal refuses a commit within STEP_SETTLE_MS of arriving on a step.
  await new Promise((r) => setTimeout(r, 400));
  fireEvent.click(screen.getByRole('button', { name: /create dental case/i }));
  await waitFor(() => expect(addCase).toHaveBeenCalled(), { timeout: 3000 });
  return addCase.mock.calls[0]![0];
}

describe('CaseDetailModal — a product that is not per-tooth work', () => {
  it('explains that charting does not apply and does not render the chart', async () => {
    await reachChartStep('ct-retainer');

    expect(screen.getByText(/Not applicable to this product/i)).toBeTruthy();
    expect(screen.getByText(/Clear Retainer is not per-tooth work/i)).toBeTruthy();
    // The 32-tooth chart is not rendered at all — a hidden chart still costs
    // ~27ms of odontogram render on every step transition.
    expect(screen.queryByRole('button', { name: /upper arch/i })).toBeNull();
    expect(screen.queryByText(/UNITS? ACTIVE/)).toBeNull();
  });

  it('advances past the chart step with nothing selected', async () => {
    await reachChartStep('ct-retainer');
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Received Date' })).toBeTruthy());
    // No validation error on the step it just left.
    expect(screen.queryByText(/At least one tooth must be selected/i)).toBeNull();
  });

  it('commits empty teeth and no shade, so every output omits them', async () => {
    await reachChartStep('ct-retainer');
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Received Date' })).toBeTruthy());

    const payload = await commit();

    // The commit is the contract every output surface relies on: emptiness,
    // not the catalog flag. A fake "#11" or an inherited A2 would print.
    expect(payload.selected_teeth).toEqual([]);
    expect(payload.tooth_details).toEqual({});
    expect(payload.shade).toBe('');
    // Everything else about the case is still captured.
    expect(payload.case_type_id).toBe('ct-retainer');
    expect(payload.case_type_name).toBe('Clear Retainer');
    expect(payload.delivery_date).toBeTruthy();
  });

  it('still offers the photo upload on the chart step', async () => {
    await reachChartStep('ct-retainer');
    // Suppressing charting must not suppress the rest of the step.
    expect(screen.getByText(/Scans & photos/i)).toBeTruthy();
  });
});

describe('CaseDetailModal — a per-tooth product is unchanged', () => {
  it('still requires at least one tooth when the flag is true', async () => {
    await reachChartStep('ct-tooth');
    // Charting is on screen and selectable.
    expect(screen.getByRole('button', { name: /upper arch/i })).toBeTruthy();
    await clearChart();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // Blocked, with the error on the step.
    await waitFor(() => expect(screen.getByText(/At least one tooth must be selected/i)).toBeTruthy());
    expect(addCase).not.toHaveBeenCalled();
  });

  it('still requires teeth when the catalog row predates the flag', async () => {
    // Written to SQL with no needs_teeth column value at all — the migration's
    // DEFAULT must read as "required", not "unknown, so skip it". Every product
    // saved before migration 021 looks like this on disk.
    await reachChartStep('ct-legacy');
    await clearChart();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(screen.getByText(/At least one tooth must be selected/i)).toBeTruthy());
    expect(screen.queryByText(/Not applicable to this product/i)).toBeNull();
  });

  it('commits the charted teeth and shade', async () => {
    await reachChartStep('ct-tooth');
    fireEvent.click(screen.getByRole('button', { name: /upper arch/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Received Date' })).toBeTruthy());

    const payload = await commit();
    expect((payload.selected_teeth as string[]).length).toBeGreaterThan(0);
    expect(payload.shade).toBe('A2');
  });
});