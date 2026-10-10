// @vitest-environment jsdom
/**
 * The batch print modal's save confirmation.
 *
 * Every batch print logs one voucher per document to billing history. The flag
 * that recorded this was declared as `const [, setSavedSuccess] = useState(false)`
 * — the value was discarded and nothing rendered it, so an operator who printed
 * a batch got no confirmation the run had been recorded anywhere. The
 * confirmation is rendered now, and names how many documents were logged.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const { CASE, CASE2, saved } = vi.hoisted(() => {
  const kase = (n: number) => ({
    id: `case-${n}`,
    case_number: `DS-200${n}`,
    patient_name: `Patient ${n}`,
    lab_id: 'lab-1',
    lab_name: 'Cases Clinic',
    case_type_id: 'ct-1',
    case_type_name: 'Zirconia Crown',
    units_count: 3,
    doctor_name: 'Dr. Tariq Mahmood',
    selected_teeth: [21, 11],
    shade: 'A2',
    material: 'Zirconia',
    delivery_date: '2026-12-20',
    received_date: '2026-10-03',
    priority: 'normal',
    price: 30000,
    discount: 0,
    final_price: 30000,
    status: 'received',
    created_at: '2026-10-01 09:00',
    updated_at: '2026-10-01 09:00',
    history: [],
  });
  return { CASE: kase(1), CASE2: kase(2), saved: [] as unknown[] };
});

// Print settings read SQLite through the settings repo; the layout under test is
// the shipped default, so the store is stubbed out entirely.
vi.mock('../../src/services/printSettings', () => ({
  loadPrintSettings: () => ({
    paper: 'a4',
    margin: 'normal',
    fontSize: 'normal',
    showLogo: true,
    logoPosition: 'left',
    jobSlipStyle: 'full',
  }),
  loadDocumentSections: (_kind: string, fallback: string[]) => [...fallback],
}));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    invoices: [],
    saveVoucherToSystem: (voucher: unknown) => {
      saved.push(voucher);
    },
    brandingSettings: { appName: 'DENTAL SOLUTIONS' },
  }),
}));

import { BulkPrintModal } from '../../src/components/cases/BulkPrintModal';
import type { DentalCase } from '../../src/types';

// jsdom has no ResizeObserver, and the modal's sheet-fit hook constructs one
// on mount to rescale the A4 previews. The hook's own fit pass runs first and
// no-ops on jsdom's zero-width layout, so the stub only needs to satisfy the
// constructor, observe() and disconnect() calls.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  saved.length = 0;
  // Printing fires on the same click that logs the vouchers; jsdom's
  // window.print is a "Not implemented" throw, and the suite fails on stray
  // unhandled errors.
  vi.spyOn(window, 'print').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

const printBatch = async (cases: unknown[]) => {
  render(<BulkPrintModal selectedCases={cases as DentalCase[]} onClose={() => {}} />);
  fireEvent.click(screen.getByText('Print All Batch Documents'));
  // The vouchers are logged synchronously, but window.print is deferred by 60ms
  // so the preview paints first. Wait it out here: left unawaited, the timer
  // fires after afterEach has restored the real print and jsdom logs a
  // "Not implemented: window.print" error into the suite output.
  await new Promise((resolve) => setTimeout(resolve, 90));
};

describe('BulkPrintModal save confirmation', () => {
  it('claims nothing before anything has been printed', () => {
    render(<BulkPrintModal selectedCases={[CASE] as unknown as DentalCase[]} onClose={() => {}} />);

    expect(screen.queryByText(/logged to billing history/)).toBeNull();
    expect(saved).toHaveLength(0);
  });

  it('confirms the batch was logged, and how many documents', async () => {
    await printBatch([CASE, CASE2]);

    expect(saved).toHaveLength(2);
    expect(screen.getByText('2 job slips logged to billing history')).toBeTruthy();
  });

  it('singularises the count for a single document', async () => {
    await printBatch([CASE]);

    expect(saved).toHaveLength(1);
    expect(screen.getByText('1 job slip logged to billing history')).toBeTruthy();
  });
});
