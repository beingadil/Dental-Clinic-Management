import { describe, it, expect } from 'vitest';
import {
  QC_REASON_CODES,
  QC_REASON_LABELS,
  qcDedupeKey,
  qcReasonLabel,
  normalizeReasonCode,
  statusAfterQc,
  nextInspectionNo,
  effectiveQcEvents,
  deriveQcCaseState,
  deriveQcStates,
  qcGateSatisfied,
  computeQcMetrics,
  formatQcRate,
} from '../../src/services/qcDomain';
import { QcInspection, QcResult } from '../../src/types';

let seq = 0;
function inspection(overrides: Partial<QcInspection> & { case_id: string; result: QcResult }): QcInspection {
  seq += 1;
  return {
    id: `qc-${seq}`,
    case_number: 'DS-0001',
    inspection_no: 1,
    kind: 'inspection',
    reason_code: null,
    reason_text: null,
    checklist: null,
    inspector: 'Adil',
    notes: null,
    supersedes_id: null,
    dedupe_key: `key-${seq}`,
    created_at: `2026-09-2${Math.min(seq, 9)} 10:00`,
    ...overrides,
  };
}

describe('qcDomain — reason codes and identity', () => {
  it('normalizes free text into a known reason code, unknown text into "other"', () => {
    expect(normalizeReasonCode('shade_mismatch')).toBe('shade_mismatch');
    expect(normalizeReasonCode('Shade Mismatch')).toBe('shade_mismatch');
    expect(normalizeReasonCode('margin-fit')).toBe('margin_fit');
    expect(normalizeReasonCode('something new')).toBe('other');
    expect(normalizeReasonCode('')).toBeNull();
    expect(normalizeReasonCode(null)).toBeNull();
    expect(qcReasonLabel('occlusion')).toBe('Occlusion');
    expect(qcReasonLabel(null)).toBe('—');
  });

  it('every reason code has a label and a stable display order', () => {
    for (const code of QC_REASON_CODES) {
      expect(QC_REASON_LABELS[code]).toBeTruthy();
    }
    expect(QC_REASON_CODES[0]).toBe('occlusion');
  });

  it('produces a deterministic idempotency key (a retry cannot double-post)', () => {
    expect(qcDedupeKey('case-1', 2, 'fail', 'inspection')).toBe('inspection:case-1:2:fail');
    expect(qcDedupeKey('case-1', 2, 'fail', 'inspection')).toBe(qcDedupeKey('case-1', 2, 'fail', 'inspection'));
  });

  it('derives the next attempt number from the raw stream', () => {
    const events = [inspection({ case_id: 'case-1', result: 'fail' }), inspection({ case_id: 'case-2', result: 'fail' })];
    expect(nextInspectionNo(events, 'case-1')).toBe(2);
    expect(nextInspectionNo(events, 'case-9')).toBe(1);
  });
});

describe('qcDomain — per-case derivation', () => {
  it('reports an uninspected case as not passed, with the gate closed', () => {
    const state = deriveQcCaseState([], 'case-1');
    expect(state.attempts).toBe(0);
    expect(state.first_pass).toBe(false);
    expect(state.passed).toBe(false);
    expect(state.gate_open).toBe(false);
    expect(qcGateSatisfied(state)).toBe(false);
  });

  it('marks a single clean pass as a first pass and opens the gate', () => {
    const events = [inspection({ case_id: 'case-1', result: 'pass', inspector: 'Hina' })];
    const state = deriveQcCaseState(events, 'case-1');
    expect(state.attempts).toBe(1);
    expect(state.first_pass).toBe(true);
    expect(state.passed).toBe(true);
    expect(state.last_inspector).toBe('Hina');
    expect(qcGateSatisfied(state)).toBe(true);
  });

  it('keeps first_pass false once the case was reworked, even after a later pass', () => {
    const events = [
      inspection({ case_id: 'case-1', result: 'fail', reason_code: 'occlusion', inspection_no: 1 }),
      inspection({ case_id: 'case-1', result: 'pass', inspection_no: 2 }),
    ];
    const state = deriveQcCaseState(events, 'case-1');
    expect(state.attempts).toBe(2);
    expect(state.failed_attempts).toBe(1);
    expect(state.first_pass).toBe(false);
    expect(state.passed).toBe(true);
    expect(state.gate_open).toBe(true);
    expect(state.last_reason_code).toBeNull();
  });

  it('leaves the gate closed on the last failure and reports the structured reason', () => {
    const events = [
      inspection({ case_id: 'case-1', result: 'pass', inspection_no: 1 }),
      inspection({ case_id: 'case-1', result: 'fail', reason_code: 'margin_fit', inspection_no: 2 }),
    ];
    const state = deriveQcCaseState(events, 'case-1');
    expect(state.passed).toBe(false);
    expect(state.gate_open).toBe(false);
    expect(state.last_reason_code).toBe('margin_fit');
    expect(qcGateSatisfied(state)).toBe(false);
  });

  it('applies a correction by appending, without mutating the original fact', () => {
    const wrong = inspection({ case_id: 'case-1', result: 'fail', reason_code: 'damage', inspection_no: 1 });
    const fix = inspection({
      case_id: 'case-1', result: 'pass', inspection_no: 1,
      kind: 'correction', supersedes_id: wrong.id,
    });

    const live = effectiveQcEvents([wrong, fix]);
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(wrong.id);
    expect(live[0].result).toBe('pass');
    expect(wrong.result).toBe('fail'); // the original row is untouched

    const state = deriveQcCaseState([wrong, fix], 'case-1');
    expect(state.first_pass).toBe(true);
    expect(state.failed_attempts).toBe(0);
    expect(state.gate_open).toBe(true);
  });

  it('derives every case state in a single pass', () => {
    const events = [
      inspection({ case_id: 'case-1', result: 'pass' }),
      inspection({ case_id: 'case-2', result: 'fail', reason_code: 'shade_mismatch' }),
    ];
    const states = deriveQcStates(events);
    expect(Object.keys(states).sort()).toEqual(['case-1', 'case-2']);
    expect(states['case-1'].passed).toBe(true);
    expect(states['case-2'].last_reason_code).toBe('shade_mismatch');
  });
});

describe('qcDomain — lifecycle rules', () => {
  it('advances a passing case to ready and returns a failing case to revision', () => {
    expect(statusAfterQc('pass', 'qc')).toBe('ready');
    expect(statusAfterQc('fail', 'qc')).toBe('revision');
    expect(statusAfterQc('pass', 'revision')).toBe('ready');
  });

  it('never resurrects a cancelled or delivered case', () => {
    expect(statusAfterQc('fail', 'cancelled')).toBe('cancelled');
    expect(statusAfterQc('fail', 'delivered')).toBe('delivered');
  });
});

describe('qcDomain — metrics honesty', () => {
  it('returns null rates (never a fabricated 0%) when nothing was inspected', () => {
    const metrics = computeQcMetrics([], []);
    expect(metrics.inspected_cases).toBe(0);
    expect(metrics.first_pass_rate).toBeNull();
    expect(metrics.rework_rate).toBeNull();
    expect(metrics.top_reasons).toEqual([]);
    expect(formatQcRate(metrics.first_pass_rate)).toBe('—');
  });

  it('computes First-Pass QC over cases that completed QC', () => {
    const events = [
      inspection({ case_id: 'c1', result: 'pass', inspection_no: 1 }),
      inspection({ case_id: 'c2', result: 'fail', reason_code: 'occlusion', inspection_no: 1 }),
      inspection({ case_id: 'c2', result: 'pass', inspection_no: 2 }),
      inspection({ case_id: 'c3', result: 'fail', reason_code: 'occlusion', inspection_no: 1 }),
    ];
    const metrics = computeQcMetrics(events, []);
    expect(metrics.inspected_cases).toBe(3);
    expect(metrics.passed_cases).toBe(2);
    expect(metrics.first_pass_cases).toBe(1);
    expect(metrics.first_pass_rate).toBe(50);
    expect(formatQcRate(metrics.first_pass_rate)).toBe('50%');
    expect(metrics.inspections).toBe(4);
    expect(metrics.failed_inspections).toBe(2);
    expect(metrics.rework_cases).toBe(2);
    expect(metrics.rework_rate).toBe(67);
    expect(metrics.top_reasons[0]).toMatchObject({ code: 'occlusion', count: 2 });
  });

  it('tallies inspector throughput and keeps deleted cases out of the KPIs', () => {
    const events = [
      inspection({ case_id: 'c1', result: 'pass', inspector: 'Hina' }),
      inspection({ case_id: 'c2', result: 'fail', inspector: 'Hina', reason_code: 'damage' }),
      inspection({ case_id: 'gone', result: 'pass', inspector: 'Adil' }),
    ];
    const metrics = computeQcMetrics(events, [{ id: 'c1', status: 'ready' }, { id: 'c2', status: 'revision' }] as any);
    expect(metrics.inspected_cases).toBe(2);
    expect(metrics.inspector_counts[0]).toMatchObject({ inspector: 'Hina', inspections: 2, fails: 1 });
    expect(metrics.inspector_counts.map((t) => t.inspector)).not.toContain('Adil');
  });
});
