// @vitest-environment jsdom
/**
 * The QC panel — the first screen for the quality-control vertical.
 *
 * WHY THIS TEST EXISTS
 * `qcDomain.ts`, the `qcInspections` table, its repo and sync path, three
 * context commands and two test files all shipped without a single component
 * rendering any of it. A whole correctness subsystem was unreachable, which is
 * invisible to every other test in this repo because nothing mounts it.
 *
 * So this is a MOUNT test, not a domain test: it asserts the panel is reachable,
 * that it renders the derived state rather than re-deriving it, and — the part
 * that actually protects the operator — that it refuses to file a failure with
 * no reason code, since those codes are what the rework-rate report groups by.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CaseQcPanel } from '../../src/components/cases/CaseQcPanel';
import type { QcInspection, QcReceipt } from '../../src/types';

const recordQcCase = vi.fn<(...args: any[]) => QcReceipt>();
const getQcState = vi.fn<(...args: any[]) => any>();

const EMPTY_STATE = {
  case_id: 'case-1',
  inspection_no: 0,
  attempts: 0,
  passed: false,
  first_pass: false,
  failed_attempts: 0,
  gate_open: false,
};

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    qcInspections,
    getQcState,
    recordQcCase,
    user: { name: 'Nadia Sheikh' },
  }),
}));

let qcInspections: QcInspection[] = [];

const inspection = (over: Partial<QcInspection> = {}): QcInspection =>
  ({
    id: 'qc-1',
    case_id: 'case-1',
    case_number: 'DS-0042',
    inspection_no: 1,
    kind: 'inspection',
    result: 'pass',
    reason_code: null,
    reason_text: null,
    checklist: null,
    inspector: 'Nadia Sheikh',
    notes: null,
    supersedes_id: null,
    dedupe_key: 'k1',
    created_at: '2026-10-14 09:30',
    ...over,
  }) as QcInspection;

beforeEach(() => {
  cleanup();
  qcInspections = [];
  recordQcCase.mockReset();
  getQcState.mockReset();
  getQcState.mockReturnValue(EMPTY_STATE);
  recordQcCase.mockImplementation(() => ({ inspection: inspection({ id: 'new' }), case_state: EMPTY_STATE, notified: false }));
});

/** The header composes its state line from several nodes, so match on the
 *  rendered text of the panel rather than on any single text node. */
const panelText = (c: HTMLElement) => (c.textContent ?? '').replace(/\s+/g, ' ');

const openPanel = () => fireEvent.click(screen.getByRole('button', { expanded: false }));

describe('CaseQcPanel', () => {
  it('says plainly when a case has never been inspected', () => {
    const { container } = render(<CaseQcPanel caseId="case-1" caseNumber="DS-0042" />);
    expect(panelText(container)).toMatch(/not yet inspected/i);
  });

  it('renders the derived state the context gave it, not a local re-derivation', () => {
    getQcState.mockReturnValue({ ...EMPTY_STATE, inspection_no: 3, passed: false, failed_attempts: 2 });
    const { container } = render(<CaseQcPanel caseId="case-1" />);
    expect(panelText(container)).toMatch(/failed on inspection 3/i);
    expect(panelText(container)).toMatch(/2 rework rounds/i);
  });

  it('opens to reveal the composer', () => {
    render(<CaseQcPanel caseId="case-1" />);
    openPanel();
    expect(screen.getByText(/record inspection #1/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^record inspection$/i })).toBeTruthy();
  });

  it('refuses to record a failure with no reason code', () => {
    // The rework-rate report groups by reason code, so a blank one silently
    // skews it — and the operator has no way to see that from the form.
    render(<CaseQcPanel caseId="case-1" />);
    openPanel();
    fireEvent.click(screen.getByRole('radio', { name: /fail/i }));
    fireEvent.click(screen.getByRole('button', { name: /record inspection/i }));

    expect(screen.getByText(/needs a reason code/i)).toBeTruthy();
    expect(recordQcCase).not.toHaveBeenCalled();
  });

  it('refuses to record with no result chosen', () => {
    render(<CaseQcPanel caseId="case-1" />);
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: /record inspection/i }));
    expect(screen.getByText(/choose pass or fail first/i)).toBeTruthy();
    expect(recordQcCase).not.toHaveBeenCalled();
  });

  it('records a failure once a reason code is chosen', () => {
    render(<CaseQcPanel caseId="case-1" />);
    openPanel();
    fireEvent.click(screen.getByRole('radio', { name: /fail/i }));
    fireEvent.click(screen.getByRole('button', { name: /reason code/i }));
    fireEvent.click(screen.getByRole('option', { name: /occlusion/i }));
    fireEvent.click(screen.getByRole('button', { name: /record inspection/i }));

    expect(recordQcCase).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'record', case_id: 'case-1', result: 'fail', reason_code: 'occlusion' }),
    );
  });

  it('surfaces the refusal when the domain declines the write', () => {
    // e.g. an unknown case, or a duplicate dedupe key. The form must not look
    // like it succeeded.
    recordQcCase.mockReturnValue({ case_state: EMPTY_STATE, notified: false });
    render(<CaseQcPanel caseId="case-1" />);
    openPanel();
    fireEvent.click(screen.getByRole('radio', { name: /pass/i }));
    fireEvent.click(screen.getByRole('button', { name: /record inspection/i }));

    expect(screen.getByText(/was not recorded/i)).toBeTruthy();
  });

  it('shows the existing inspection log when opened', () => {
    qcInspections = [inspection()];
    getQcState.mockReturnValue({ ...EMPTY_STATE, inspection_no: 1, passed: true, first_pass: true });
    render(<CaseQcPanel caseId="case-1" />);
    openPanel();
    expect(screen.getByText(/inspection #1/i)).toBeTruthy();
    expect(screen.getByText('Nadia Sheikh · 2026-10-14 09:30')).toBeTruthy();
  });

  it('hides the composer entirely on a closed case', () => {
    render(<CaseQcPanel caseId="case-1" locked />);
    openPanel();
    expect(screen.getByText(/closed, so no further inspection/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^record inspection$/i })).toBeNull();
  });
});
