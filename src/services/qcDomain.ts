import {
  CaseStatus,
  DentalCase,
  QcCaseState,
  QcInspection,
  QcInspectorTally,
  QcMetrics,
  QcReasonCode,
  QcReasonTally,
  QcResult,
} from '../types';

/**
 * Quality Control domain — pure rules, derivation and metrics for the QC
 * module. Storage-agnostic: `src/db/repos.ts` (qcInspectionsRepo) persists the
 * append-only inspection stream; this layer turns that stream into per-case
 * state, gate decisions and KPIs. No engine, no React, no side effects —
 * mirrors `financeDomain.ts` / `prioritySla.ts`.
 */

/** Habitual defect reasons offered by the inspection form (order = display order). */
export const QC_REASON_CODES: QcReasonCode[] = [
  'occlusion',
  'shade_mismatch',
  'margin_fit',
  'contact_tightness',
  'finish_polish',
  'damage',
  'dimension',
  'other',
];

export const QC_REASON_LABELS: Record<QcReasonCode, string> = {
  occlusion: 'Occlusion',
  shade_mismatch: 'Shade Mismatch',
  margin_fit: 'Margin Fit',
  contact_tightness: 'Contact Tightness',
  finish_polish: 'Finish / Polish',
  damage: 'Damage',
  dimension: 'Dimension / Fit Error',
  other: 'Other',
};

/** Statuses from which a case is still "in flight" through the QC gate. */
export const QC_IN_FLIGHT_STATUSES: CaseStatus[] = ['received', 'in_progress', 'qc', 'revision'];

/** Statuses that a QC pass unlocks and a QC failure refuses. */
export const QC_GATED_STATUSES: CaseStatus[] = ['ready', 'delivered'];

export const QC_EMPTY_DISPLAY = '—';

/** Coerce arbitrary stored text into a known reason code (unknown → `other`). */
export function normalizeReasonCode(raw?: string | null): QcReasonCode | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (QC_REASON_CODES as string[]).includes(value) ? (value as QcReasonCode) : 'other';
}

export function qcReasonLabel(code?: string | null): string {
  const normalized = normalizeReasonCode(code);
  return normalized ? QC_REASON_LABELS[normalized] : QC_EMPTY_DISPLAY;
}

/**
 * Deterministic idempotency key of an inspection fact. Mirrors the
 * `ledger_entries` UNIQUE(entry_type, reference_id) guard: re-appending the same
 * physical inspection is rejected by the database instead of duplicating work.
 */
export function qcDedupeKey(caseId: string, inspectionNo: number, result: QcResult, kind: string): string {
  return `${kind}:${caseId}:${inspectionNo}:${result}`;
}

/** Status transition implied by an inspection result. */
export function statusAfterQc(result: QcResult, current?: CaseStatus): CaseStatus {
  if (current === 'cancelled' || current === 'delivered') return current;
  return result === 'pass' ? 'ready' : 'revision';
}

/** Next attempt number for a case (1 when it has never been inspected). */
export function nextInspectionNo(events: QcInspection[], caseId: string): number {
  return events.filter((e) => e.case_id === caseId && e.kind === 'inspection').length + 1;
}

function orderEvents(events: QcInspection[]): QcInspection[] {
  return [...events].sort((a, b) => {
    const bySequence = (a.inspection_no || 0) - (b.inspection_no || 0);
    if (bySequence !== 0) return bySequence;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
}

/**
 * Effective stream = inspection events minus the ones superseded by a later
 * correction. Nothing is ever mutated or deleted: a mistake is amended by
 * appending a correction that names the event it replaces.
 */
export function effectiveQcEvents(events: QcInspection[]): QcInspection[] {
  /* A correction re-states the outcome of the inspection it replaces: the
     audit row stays in place (same attempt, same timestamp) and only its
     meaning is amended — so the corrected result is what the metrics count. */
  const corrected = new Map<string, QcInspection>();
  for (const correction of events) {
    if (correction.kind === 'correction' && correction.supersedes_id) {
      corrected.set(String(correction.supersedes_id), correction);
    }
  }

  return events
    .filter((e) => e.kind === 'inspection')
    .map((original) => {
      const fix = corrected.get(original.id);
      if (!fix) return original;
      return {
        ...original,
        result: fix.result,
        reason_code: fix.reason_code ?? null,
        reason_text: fix.reason_text ?? null,
        notes: fix.notes ?? original.notes,
      };
    });
}

/** Derive the live quality state of one case from the raw stream. */
export function deriveQcCaseState(events: QcInspection[], caseId: string): QcCaseState {
  const attempts = orderEvents(effectiveQcEvents(events.filter((e) => e.case_id === caseId)));
  const last = attempts[attempts.length - 1];

  return {
    case_id: caseId,
    inspection_no: attempts.length,
    attempts: attempts.length,
    passed: !!last && last.result === 'pass',
    first_pass: attempts.length > 0 && attempts[0].result === 'pass',
    failed_attempts: attempts.filter((a) => a.result === 'fail').length,
    last_result: last?.result,
    last_reason_code: normalizeReasonCode(last?.reason_code ?? null),
    last_inspected_at: last?.created_at,
    last_inspector: last?.inspector,
    gate_open: !!last && last.result === 'pass',
  };
}

/** Derive the live quality state of every inspected case (single pass over the stream). */
export function deriveQcStates(events: QcInspection[]): Record<string, QcCaseState> {
  const live = effectiveQcEvents(events);
  const byCase = new Map<string, QcInspection[]>();
  for (const event of live) {
    const bucket = byCase.get(event.case_id);
    if (bucket) bucket.push(event);
    else byCase.set(event.case_id, [event]);
  }

  const states: Record<string, QcCaseState> = {};
  for (const [caseId, forCase] of byCase) {
    const ordered = orderEvents(forCase);
    const last = ordered[ordered.length - 1];
    states[caseId] = {
      case_id: caseId,
      inspection_no: ordered.length,
      attempts: ordered.length,
      passed: last.result === 'pass',
      first_pass: ordered[0].result === 'pass',
      failed_attempts: ordered.filter((a) => a.result === 'fail').length,
      last_result: last.result,
      last_reason_code: normalizeReasonCode(last.reason_code ?? null),
      last_inspected_at: last.created_at,
      last_inspector: last.inspector,
      gate_open: last.result === 'pass',
    };
  }
  return states;
}

/** True when the case carries a passing inspection and may be released. */
export function qcGateSatisfied(state?: QcCaseState | null): boolean {
  return !!state?.gate_open;
}

/**
 * Aggregate quality KPIs. `first_pass_rate` is computed over cases that
 * completed QC (passed) and is `null` — never 0 — when nothing has been
 * inspected yet, so the dashboard can honestly show an em dash.
 */
export function computeQcMetrics(
  events: QcInspection[],
  cases: Pick<DentalCase, 'id' | 'status'>[] = []
): QcMetrics {
  const statusById = new Map(cases.map((c) => [c.id, c.status]));
  /* One population rule for every KPI: only cases that still exist count, so the
     dashboard can never show self-contradicting numbers after a case is deleted. */
  const inScope = (caseId: string) => statusById.size === 0 || statusById.has(caseId);

  const live = effectiveQcEvents(events).filter((e) => inScope(e.case_id));
  const states = Object.values(deriveQcStates(events)).filter((s) => inScope(s.case_id));

  const passedStates = states.filter((s) => s.passed);
  const firstPassStates = passedStates.filter((s) => s.first_pass);
  const reworkStates = states.filter((s) => s.failed_attempts > 0);
  const failures = live.filter((e) => e.result === 'fail');

  const reasonCounts = new Map<QcReasonCode, number>();
  for (const failure of failures) {
    const code = normalizeReasonCode(failure.reason_code ?? null) ?? 'other';
    reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + 1);
  }
  const top_reasons: QcReasonTally[] = QC_REASON_CODES
    .map((code) => ({ code, label: QC_REASON_LABELS[code], count: reasonCounts.get(code) ?? 0 }))
    .filter((tally) => tally.count > 0)
    .sort((a, b) => b.count - a.count);

  const inspectorMap = new Map<string, QcInspectorTally>();
  for (const event of live) {
    const key = event.inspector || 'Unknown';
    const tally = inspectorMap.get(key) ?? { inspector: key, inspections: 0, passes: 0, fails: 0 };
    tally.inspections += 1;
    if (event.result === 'pass') tally.passes += 1;
    else tally.fails += 1;
    inspectorMap.set(key, tally);
  }

  return {
    inspected_cases: states.length,
    passed_cases: passedStates.length,
    first_pass_cases: firstPassStates.length,
    first_pass_rate: passedStates.length === 0
      ? null
      : Math.round((firstPassStates.length / passedStates.length) * 100),
    inspections: live.length,
    failed_inspections: failures.length,
    rework_cases: reworkStates.length,
    rework_rate: states.length === 0
      ? null
      : Math.round((reworkStates.length / states.length) * 100),
    top_reasons,
    inspector_counts: [...inspectorMap.values()].sort((a, b) => b.inspections - a.inspections),
  };
}

/** Render a nullable rate for the UI: `—` when there is no data, never a fake 0%. */
export function formatQcRate(rate: number | null): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return QC_EMPTY_DISPLAY;
  return `${Math.round(rate)}%`;
}


