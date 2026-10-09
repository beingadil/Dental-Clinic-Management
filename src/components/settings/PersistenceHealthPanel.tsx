import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCopy, Eraser, HardDrive, RefreshCw } from 'lucide-react';
import {
  clearFailureLog,
  exportFailureDiagnostics,
  getFailureSummary,
  type FailureCause,
  type FailureKind,
  type FailureSummary,
  type PersistenceFailure,
} from '../../db/failureLog';
import { getDesktopDatabasePath, getLastSaveAt, getLastSaveBackend, getLastSnapshotBytes } from '../../db/persistence';
import { getLastSyncSuccessAt } from '../../db/syncCore';

/**
 * Save & sync health panel (Settings > Database & Backup).
 *
 * Every persistence failure is appended to a persisted journal with its cause,
 * so this panel can answer the question the app used to be unable to answer:
 * "is it saving, and if not, why?" — with the exact SQLite statement when the
 * aborted transaction was a constraint, and with the snapshot size when the
 * store refused the write because it was too big.
 */

const CAUSE_LABEL: Record<FailureCause, string> = {
  'storage-full': 'Storage full',
  indexeddb: 'IndexedDB failed',
  'no-storage': 'No browser storage',
  'disk-io': 'Disk write failed',
  'data-constraint': 'Row rejected by schema',
  unknown: 'Unclassified',
};

/** Does this cause need the clinic to export a backup right now? */
const URGENT: FailureCause[] = ['storage-full', 'no-storage', 'disk-io'];

const KIND_LABEL: Record<FailureKind, string> = {
  save: 'Snapshot save',
  sync: 'Database sync',
  restore: 'Restore',
};

function backendLabel(): string {
  const desktopPath = getDesktopDatabasePath();
  if (desktopPath) return desktopPath;
  const backend = getLastSaveBackend();
  if (backend === 'indexeddb') return 'Browser IndexedDB (dsw_sqlite)';
  if (backend === 'localstorage') return 'Browser localStorage (legacy — ~5 MB ceiling)';
  if (backend === 'none') return 'No storage available';
  return 'Not saved yet this session';
}

function relative(at: string | null): string {
  if (!at) return 'never';
  const then = new Date(at).getTime();
  if (!Number.isFinite(then)) return at;
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86_400)}d ago`;
}

function kb(bytes: number): string {
  if (!bytes) return '—';
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * The journal's success time is the durable one, but it is only written when a
 * streak is cleared; this session's live timestamp fills the gap so a healthy
 * app does not claim it has never saved.
 */
function lastOk(fromJournal: string | null, fromSession: string | null): string {
  const at = fromJournal ?? fromSession;
  return at ? relative(at) : 'not yet this session';
}

export function PersistenceHealthPanel() {
  const [summary, setSummary] = useState<FailureSummary>(() => getFailureSummary());
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => setSummary(getFailureSummary()), []);

  useEffect(() => {
    // Three sources, all cheap: the journal itself, plus the existing banners'
    // events so a save that newly succeeds clears the verdict immediately.
    window.addEventListener('persistence:failures', refresh);
    window.addEventListener('db:save-status', refresh);
    window.addEventListener('sync:status', refresh);
    // The events above only fire on a transition — a save that keeps working
    // reports nothing. A slow tick keeps "last save OK" honest while the panel
    // is on screen, which is the whole point of the panel.
    const tick = setInterval(refresh, 10_000);
    return () => {
      clearInterval(tick);
      window.removeEventListener('persistence:failures', refresh);
      window.removeEventListener('db:save-status', refresh);
      window.removeEventListener('sync:status', refresh);
    };
  }, [refresh]);

  const copyDiagnostics = async () => {
    const text = exportFailureDiagnostics();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard is permission-gated; a download is the reliable fallback.
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `persistence-failures-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const totalFailures = summary.save.total + summary.sync.total + summary.restore.total;
  const failingNow = summary.save.streak > 0 || summary.sync.streak > 0;
  const urgent = summary.recent.some((f) => URGENT.includes(f.cause));

  const tone = failingNow
    ? urgent
      ? 'bg-rose-50 border-rose-300'
      : 'bg-amber-50 border-amber-300'
    : 'bg-emerald-50/70 border-emerald-200';

  return (
    <div className={`p-4 rounded-2xl border text-xs space-y-3 ${tone}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span
          className={`font-bold flex items-center gap-2 ${
            failingNow ? (urgent ? 'text-rose-800' : 'text-amber-800') : 'text-emerald-800'
          }`}
        >
          {failingNow ? (
            <AlertTriangle className="w-4 h-4" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-ink-success" />
          )}
          Save &amp; sync health —{' '}
          {failingNow
            ? `FAILING (save streak ${summary.save.streak}, sync streak ${summary.sync.streak})`
            : totalFailures > 0
              ? `RECOVERED after ${totalFailures} recorded failure${totalFailures === 1 ? '' : 's'}`
              : 'ALL SAVES SUCCEEDING'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/70 border border-slate-200 font-semibold text-slate-700 hover:bg-white"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button
            type="button"
            onClick={() => void copyDiagnostics()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/70 border border-slate-200 font-semibold text-slate-700 hover:bg-white"
          >
            <ClipboardCopy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy diagnostics'}
          </button>
          {totalFailures > 0 && (
            <button
              type="button"
              onClick={() => clearFailureLog()}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/70 border border-slate-200 font-semibold text-slate-700 hover:bg-white"
            >
              <Eraser className="w-3.5 h-3.5" /> Clear log
            </button>
          )}
        </div>
      </div>

      {/* Where the data actually goes, and how big the last snapshot was. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600 font-mono">
        <span className="flex items-center gap-1.5">
          <HardDrive className="w-3.5 h-3.5 text-indigo-600" />
          {backendLabel()}
        </span>
        <span>last snapshot {kb(getLastSnapshotBytes())}</span>
        <span>last save OK {lastOk(summary.save.lastSuccessAt, getLastSaveAt())}</span>
        <span>last sync OK {lastOk(summary.sync.lastSuccessAt, getLastSyncSuccessAt())}</span>
      </div>

      {totalFailures === 0 ? (
        <p className="text-slate-600">
          Every checkpoint has been written to storage since this log was last cleared. Nothing to report.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(['save', 'sync', 'restore'] as FailureKind[]).map((kind) => (
              <div key={kind} className="p-2.5 rounded-xl bg-white/70 border border-slate-100">
                <span className="font-bold text-slate-800 block">{KIND_LABEL[kind]}</span>
                <span className="text-slate-600">
                  {summary[kind].total} total · streak {summary[kind].streak}
                </span>
                <span className="block text-slate-500">
                  last {relative(summary[kind].lastFailureAt)}, succeeded{' '}
                  {lastOk(summary[kind].lastSuccessAt, kind === 'sync' ? getLastSyncSuccessAt() : getLastSaveAt())}
                </span>
              </div>
            ))}
          </div>

          {summary.firstFailureAt && (
            <p className="text-slate-600">
              Failures recorded since <strong>{new Date(summary.firstFailureAt).toLocaleString()}</strong>
              {summary.save.streak > 0 && (
                <>
                  {' '}
                  — the database has NOT been written to storage since the last success above, so anything
                  entered since then exists only in memory. Export a .dentalbackup now.
                </>
              )}
            </p>
          )}

          <div className="max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white/70">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-2 py-1.5 font-bold">When</th>
                  <th className="px-2 py-1.5 font-bold">Operation</th>
                  <th className="px-2 py-1.5 font-bold">Cause</th>
                  <th className="px-2 py-1.5 font-bold">Message</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[10px]">
                {summary.recent.map((f: PersistenceFailure) => (
                  <tr key={f.id} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">
                      {new Date(f.at).toLocaleString()}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap font-bold text-slate-700">
                      {KIND_LABEL[f.kind]}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <span
                        className={`px-1.5 py-0.5 rounded font-bold ${
                          URGENT.includes(f.cause)
                            ? 'bg-rose-100 text-rose-700'
                            : f.cause === 'data-constraint'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {CAUSE_LABEL[f.cause]}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-slate-600 break-words" title={`${f.message}${f.detail ? ` | ${f.detail}` : ''}`}>
                      {f.message}
                      {f.detail && <span className="block text-ink-muted">{f.detail}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-slate-500">
            Showing the newest {summary.recent.length} of {totalFailures} recorded failures. The log is kept in browser
            storage (not in the database), so it and "failing since" survive a restart — these counters used to reset to
            zero on every launch, which made a permanently broken save look healthy.
          </p>
        </>
      )}
    </div>
  );
}
