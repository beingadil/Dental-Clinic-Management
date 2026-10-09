import React, { useEffect, useState } from 'react';
import {
  ArrowUpCircle,
  CheckCircle2,
  Loader2,
  Power,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  applyStagedUpdate,
  AutoUpdatePhase,
  discardStagedUpdate,
  ensureAutoUpdateCheck,
  isAutoUpdateBusy,
  onAutoUpdatePhase,
  runAutoUpdate,
} from '../../services/updateInstaller';

/**
 * The auto-installer UI — the app's ONLY update surface.
 *
 * It replaces the old "a newer installer is available, download it from your
 * browser" banner, which could never update the app on its own. The updater
 * now does the whole mechanical job (download → checksum → database backup)
 * on its own and stops here; the app is closed only when the user presses
 * "Restart & Apply Updates".
 *
 * Two layouts share one state machine:
 * - `floating`: app-wide, bottom-centre, silent when there is nothing to say.
 * - `inline`:   Settings → Updates, always rendered with the full detail.
 */

type Step = {
  key: string;
  label: string;
  hint?: string;
  done: boolean;
  active: boolean;
  failed?: boolean;
};

const MB = 1024 * 1024;

function formatBytes(n: number): string {
  if (!n || n < 0) return '';
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function buildSteps(phase: AutoUpdatePhase, version: string | null): Step[] {
  const order: Record<string, number> = {
    checking: 0,
    available: 1,
    downloading: 2,
    verifying: 3,
    backing_up: 4,
    ready_to_apply: 5,
    applying: 6,
  };
  const rank = order[phase.state] ?? -1;
  const failedStep = phase.state === 'failed';
  const at = (n: number) => ({
    done: !failedStep && rank > n,
    active: !failedStep && rank === n,
    failed: false,
  });
  return [
    { key: 'check', label: 'Checking for updates', ...at(0) },
    {
      key: 'download',
      label: version ? `Downloading v${version}` : 'Downloading the installer',
      ...at(1),
    },
    { key: 'verify', label: 'Verifying the installer (SHA-256)', ...at(2) },
    { key: 'backup', label: 'Backing up your clinic data', ...at(3) },
    { key: 'ready', label: 'Ready to apply', ...at(4) },
  ];
}

export function AutoUpdatePanel({ variant = 'floating' }: { variant?: 'floating' | 'inline' }) {
  const floating = variant === 'floating';
  const [phase, setPhase] = useState<AutoUpdatePhase>({ state: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => onAutoUpdatePhase(setPhase), []);

  // One automatic check per session, started from the app shell so it no
  // longer depends on which view happens to be mounted.
  useEffect(() => {
    if (floating) ensureAutoUpdateCheck();
  }, [floating]);

  const version =
    phase.state === 'idle' || phase.state === 'checking' || phase.state === 'up_to_date'
      ? null
      : (phase as { version: string }).version;

  const busy = isAutoUpdateBusy(phase);
  const ready = phase.state === 'ready_to_apply';
  const applying = phase.state === 'applying';
  const failed = phase.state === 'failed';
  const steps = buildSteps(phase, version);
  const progress =
    phase.state === 'downloading' && phase.total > 0
      ? Math.min(100, Math.round((phase.received / phase.total) * 100))
      : null;

  // Floating: only speak up when there is something to do or report.
  if (floating && (phase.state === 'idle' || phase.state === 'up_to_date' || phase.state === 'checking')) {
    return null;
  }
  if (floating && phase.state === 'available') {
    return null; // the download starts by itself; no interstitial needed
  }
  if (floating && phase.state === 'failed' && dismissed) {
    return null; // a failed attempt can be swept away; Settings keeps the log
  }

  const shell = floating
    ? 'fixed bottom-5 left-1/2 -translate-x-1/2 z-[9998] w-[440px] max-w-[calc(100vw-2rem)]'
    : '';

  const headline: Record<string, string> = {
    downloading: 'Installing the update automatically',
    verifying: 'Verifying the installer',
    backing_up: 'Backing up your data',
    ready_to_apply: 'Update ready to install',
    applying: 'Restarting and applying the update',
    failed: 'Update needs attention',
  };

  const title = headline[phase.state] ?? 'Software update';

  return (
    <div className={shell} role="status" aria-live="polite">
      <div
        className={`bg-white rounded-2xl border shadow-lg overflow-hidden ${
          ready || applying
            ? 'border-indigo-300'
            : failed
              ? 'border-rose-200'
              : 'border-slate-200'
        }`}
      >
        {/* Header */}
        <div
          className={`px-4 py-3 flex items-center gap-2.5 ${
            ready || applying
              ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white'
              : failed
                ? 'bg-rose-50 border-b border-rose-100'
                : 'bg-slate-50 border-b border-slate-100'
          }`}
        >
          <div className={`p-2 rounded-xl ${ready || applying ? 'bg-white/15' : 'bg-indigo-50 text-indigo-600'}`}>
            {ready || applying ? (
              <ArrowUpCircle className="w-4 h-4" />
            ) : failed ? (
              <TriangleAlert className="w-4 h-4 text-ink-danger" />
            ) : (
              <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-bold truncate ${ready || applying ? '' : failed ? 'text-rose-900' : 'text-slate-900'}`}>
              {title}
            </p>
            <p className={`text-[11px] truncate ${ready || applying ? 'text-indigo-100' : failed ? 'text-rose-700' : 'text-slate-500'}`}>
              {version
                ? `Dental Solutions v${version}${phase.state === 'ready_to_apply' ? ' — verified and on disk' : ''}`
                : 'Dental Solutions'}
            </p>
          </div>
          {!busy && !ready && floating && (
            <button
              onClick={() => setDismissed(true)}
              className={`p-1 rounded-lg cursor-pointer ${ready || applying ? 'hover:bg-white/15' : 'hover:bg-slate-100'}`}
              aria-label="Hide"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="px-4 py-3 space-y-3">
          {/* Download progress */}
          {progress !== null && (
            <div className="space-y-1">
              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-[width] duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500 font-medium">
                {progress}% · {formatBytes(phase.state === 'downloading' ? phase.received : 0)}
                {phase.state === 'downloading' && phase.total > 0
                  ? ` of ${formatBytes(phase.total)}`
                  : ''}
              </p>
            </div>
          )}
          {phase.state === 'downloading' && progress === null && (
            <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full w-1/3 rounded-full bg-indigo-400 animate-pulse" />
            </div>
          )}

          {/* Step list — inline layout only, so the floating card stays compact */}
          {!floating && (
            <ul className="space-y-1.5">
              {steps.map((s) => (
                <li key={s.key} className="flex items-center gap-2 text-[11px]">
                  {s.done ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  ) : s.active ? (
                    <Loader2 className="w-3.5 h-3.5 text-indigo-600 animate-spin shrink-0" />
                  ) : (
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-200 shrink-0" />
                  )}
                  <span className={s.done ? 'text-ink-muted' : s.active ? 'text-slate-800 font-bold' : 'text-ink-muted'}>
                    {s.label}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Staged / applied confirmation */}
          {phase.state === 'ready_to_apply' && (
            <div className="flex items-start gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
              <ShieldCheck className="w-4 h-4 text-ink-success shrink-0 mt-0.5" />
              <p className="text-[11px] text-emerald-900">
                The installer{phase.bytes > 0 ? ` (${formatBytes(phase.bytes)})` : ''} is
                downloaded, checksum-verified, and your database was backed up. Restart to
                install it — the app closes and reopens on v{phase.version} automatically.
              </p>
            </div>
          )}
          {phase.state === 'applying' && (
            <p className="text-[11px] text-indigo-800 font-bold">
              Closing the app now — the installer finishes in the background and reopens
              Dental Solutions on the new version. This takes a few seconds.
            </p>
          )}
          {failed && <p className="text-[11px] text-rose-700">{phase.message}</p>}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {ready && (
              <>
                <button
                  onClick={() => void applyStagedUpdate()}
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-xl cursor-pointer flex items-center gap-1.5"
                >
                  <Power className="w-3.5 h-3.5" />
                  Restart &amp; Apply Updates
                </button>
                <button
                  onClick={() => void discardStagedUpdate()}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold rounded-xl cursor-pointer"
                >
                  Not now
                </button>
              </>
            )}
            {failed && (
              <button
                onClick={() => void runAutoUpdate()}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-xl cursor-pointer flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Try again
              </button>
            )}
            {!floating && (
              <button
                onClick={() => void runAutoUpdate()}
                disabled={busy}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-[11px] font-bold rounded-xl cursor-pointer flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                Check for updates
              </button>
            )}
            {!floating && phase.state === 'up_to_date' && (
              <span className="text-[11px] text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> You are on the latest version
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}