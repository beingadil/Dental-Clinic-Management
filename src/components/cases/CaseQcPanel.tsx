/**
 * Quality control panel — the screen the QC subsystem was built for.
 *
 * WHY THIS FILE EXISTS NOW
 * The whole quality-control vertical shipped long before any UI: `qcDomain.ts`
 * (240 lines), the `qcInspections` table, its repo and sync path, three context
 * commands (`recordQcCase`, `getQcState`, `getQcMetrics`), derived state
 * derivation, reason codes, first-pass metrics and two test files. Every part of
 * it was correct, covered and completely unreachable — not one component rendered
 * it, while the app still advertised "Quality Control" in a notification preset
 * and put "Technician & QC" on the printed job slip.
 *
 * This is the thin UI over that domain. It deliberately adds NO rules: every
 * decision (what the next inspection number is, what a correction supersedes,
 * what status the case lands in, whether the gate is satisfied) already lives in
 * `qcDomain` and is unit-tested there. The panel's whole job is to collect a
 * result and show what came back.
 *
 * Append-only, like the domain. A wrong inspection is AMENDED with a correction
 * that supersedes it, never edited in place or deleted — so the record of what
 * was inspected when survives an error, which is the whole reason a QC trail is
 * worth keeping.
 */
import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  QC_REASON_CODES,
  QC_REASON_LABELS,
  effectiveQcEvents,
} from '../../services/qcDomain';
import type { QcInspection, QcReasonCode, QcResult } from '../../types';
import {
  CheckCircle2,
  XCircle,
  RotateCcw,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface CaseQcPanelProps {
  caseId: string;
  caseNumber?: string;
  /** Cases in a delivered/cancelled state are closed; a QC write is refused. */
  locked?: boolean;
}

type ComposerResult = QcResult | '';

export const CaseQcPanel: React.FC<CaseQcPanelProps> = ({ caseId, caseNumber, locked = false }) => {
  const { qcInspections, getQcState, recordQcCase, user } = useApp();

  const state = getQcState(caseId);

  /* `effectiveQcEvents` is the domain's own filter: it drops events that a later
     correction superseded. Reading the raw array here would show a failed
     inspection that had since been corrected as still failing. */
  const events = useMemo(
    () =>
      effectiveQcEvents(qcInspections)
        .filter((e) => e.case_id === caseId)
        .sort((a, b) => (a.inspection_no === b.inspection_no ? a.created_at.localeCompare(b.created_at) : a.inspection_no - b.inspection_no)),
    [qcInspections, caseId],
  );

  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ComposerResult>('');
  const [reasonCode, setReasonCode] = useState<QcReasonCode | ''>('');
  const [reasonText, setReasonText] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [correcting, setCorrecting] = useState<QcInspection | null>(null);

  const resetComposer = () => {
    setResult('');
    setReasonCode('');
    setReasonText('');
    setNotes('');
    setError('');
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!result) {
      setError('Choose pass or fail first.');
      return;
    }
    // A failure without a reason is unactionable — the reason codes are what the
    // rework-rate report groups by, so a blank one silently skews it.
    if (result === 'fail' && !reasonCode) {
      setError('A failure needs a reason code so the rework report can group it.');
      return;
    }

    const receipt = correcting
      ? recordQcCase({
          action: 'correct',
          id: correcting.id,
          result,
          reason_code: reasonCode || undefined,
          reason_text: reasonText.trim() || undefined,
          notes: notes.trim() || undefined,
          inspector: user?.name,
        })
      : recordQcCase({
          action: 'record',
          case_id: caseId,
          result,
          reason_code: reasonCode || undefined,
          reason_text: reasonText.trim() || undefined,
          notes: notes.trim() || undefined,
          inspector: user?.name,
        });

    if (!receipt.inspection) {
      setError('That inspection was not recorded. Reload the case and try again.');
      return;
    }
    resetComposer();
    setCorrecting(null);
  };

  const startCorrection = (e: QcInspection) => {
    setCorrecting(e);
    setResult(e.result);
    setReasonCode(e.reason_code ?? '');
    setReasonText(e.reason_text ?? '');
    setNotes('');
    setError('');
  };

  /* The header reads the DOMAIN's answer, not a local count of the array it
     was handed. Deriving "has this been inspected" from `events.length` here
     meant two sources of truth for one question: the status line came from
     `getQcState` while the "not yet inspected" branch came from a local filter,
     so the two could disagree — and the derived state is the one that is
     tested in `qcDomain`. */
  const inspected = state.inspection_no > 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white" data-purpose="qc-panel">
      {/* ── Header: the state, always visible, never a form ─────────────── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer rounded-2xl hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span
            className={`p-2 rounded-xl shrink-0 ${
              !inspected
                ? 'bg-slate-100 text-slate-500'
                : state.passed
                  ? 'bg-emerald-50 text-emerald-600'
                  : 'bg-rose-50 text-rose-600'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Quality control
            </span>
            <span className="block text-[11px] text-slate-500">
              {inspected
                ? `${state.passed ? 'Passed' : 'Failed'} on inspection ${state.inspection_no}${
                    state.first_pass
                      ? ' · first-pass'
                      : state.failed_attempts > 0
                        ? ` · ${state.failed_attempts} rework round${state.failed_attempts === 1 ? '' : 's'}`
                        : ''
                  }`
                : 'Not yet inspected'}
            </span>
          </span>
        </span>

        <span className="flex items-center gap-2 shrink-0">
          {state.failed_attempts > 0 && (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-amber-50 text-amber-700">
              Rework
            </span>
          )}
          {open ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-slate-100 pt-4 space-y-4">
          {/* ── Inspection history ──────────────────────────────────────── */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
              Inspection log
            </p>
            {events.length === 0 ? (
              <p className="text-xs text-slate-500">
                No inspection recorded for {caseNumber || 'this case'} yet.
              </p>
            ) : (
              <ol className="space-y-2">
                {events.map((e) => (
                  <li
                    key={e.id}
                    className="rounded-xl bg-slate-50 px-3 py-2.5 flex items-start gap-2.5"
                  >
                    <span className="shrink-0 mt-0.5">
                      {e.result === 'pass' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-600" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-800">
                          {e.kind === 'correction' ? 'Correction' : 'Inspection'} #{e.inspection_no}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                            e.result === 'pass'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {e.result === 'pass' ? 'PASS' : 'FAIL'}
                        </span>
                        {e.reason_code && (
                          <span className="text-[10px] font-semibold text-slate-600">
                            {QC_REASON_LABELS[e.reason_code] || e.reason_code}
                          </span>
                        )}
                      </div>
                      {e.reason_text && (
                        <p className="text-[11px] text-slate-600 mt-0.5">{e.reason_text}</p>
                      )}
                      {e.notes && <p className="text-[11px] text-slate-500 mt-0.5">{e.notes}</p>}
                      <p className="text-[10px] text-slate-400 mt-1 font-mono">
                        {e.inspector} · {e.created_at}
                      </p>
                    </div>
                    {!locked && (
                      <button
                        type="button"
                        onClick={() => startCorrection(e)}
                        className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer"
                        title="Record a correction. The original entry is kept."
                      >
                        <RotateCcw className="w-3 h-3" /> Amend
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* ── Composer ───────────────────────────────────────────────── */}
          {locked ? (
            <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <AlertTriangle className="w-3.5 h-3.5" />
              This case is closed, so no further inspection can be recorded.
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-3 pt-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {correcting
                  ? `Amend inspection #${correcting.inspection_no}`
                  : `Record inspection #${state.inspection_no + 1}`}
              </p>

              {correcting && (
                <p className="text-[11px] text-amber-700 flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5" />
                  Amending does not delete the original — both stay in the log.
                </p>
              )}

              <div className="flex gap-2">
                {(['pass', 'fail'] as const).map((r) => (
                  <label
                    key={r}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-bold cursor-pointer transition-colors ${
                      result === r
                        ? r === 'pass'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-rose-500 bg-rose-50 text-rose-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="qc-result"
                      value={r}
                      checked={result === r}
                      onChange={() => setResult(r)}
                      className="sr-only"
                    />
                    {r === 'pass' ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5" />
                    )}
                    {r === 'pass' ? 'Pass' : 'Fail'}
                  </label>
                ))}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Reason code {result === 'fail' ? '' : '(optional)'}
                </label>
                <select
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value as QcReasonCode | '')}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
                >
                  <option value="">— none —</option>
                  {QC_REASON_CODES.map((code) => (
                    <option key={code} value={code}>
                      {QC_REASON_LABELS[code]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  What was found
                </label>
                <input
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  placeholder={result === 'fail' ? 'e.g. Marginal fit at the distal margin' : 'Optional detail'}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 resize-y"
                />
              </div>

              {error && <p className="text-[11px] text-rose-600">{error}</p>}

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="px-3 py-2 text-xs font-bold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  {correcting ? 'Record amendment' : 'Record inspection'}
                </button>
                {correcting && (
                  <button
                    type="button"
                    onClick={() => {
                      setCorrecting(null);
                      resetComposer();
                    }}
                    className="px-3 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
};
