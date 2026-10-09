/**
 * The dashboard's update pill.
 *
 * The floating auto-installer panel is a modal card that takes over the
 * screen. The dashboard is where a clinic actually spends its day, so this is
 * a single compact row that stays out of the way and escalates only as the
 * update gets closer to needing the user:
 *
 *   available      → "v2.18.0 is available" + [Install]
 *   downloading    → progress, no buttons (the work is already under way)
 *   ready_to_apply → "v2.18.0 is ready" + [Restart & Apply]
 *   failed         → the reason + [Try again]
 *
 * It deliberately renders nothing when there is nothing to say. The state
 * machine is the shared one in services/updateInstaller, so this pill and the
 * floating panel can never disagree about what is happening.
 */

import React, { useEffect, useState } from 'react';
import {
  ArrowUpCircle,
  CheckCircle2,
  Download,
  Loader2,
  Power,
  RefreshCw,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  applyStagedUpdate,
  AutoUpdatePhase,
  isAutoUpdateBusy,
  onAutoUpdatePhase,
  runAutoUpdate,
} from '../../services/updateInstaller';

const MB = 1024 * 1024;

function formatBytes(n: number): string {
  if (!n || n < 0) return '';
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function UpdatePill() {
  const [phase, setPhase] = useState<AutoUpdatePhase>({ state: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => onAutoUpdatePhase(setPhase), []);

  // A new phase is always worth re-showing: the user dismissed the old news,
  // not the next one.
  useEffect(() => {
    setDismissed(false);
  }, [phase.state]);

  const busy = isAutoUpdateBusy(phase);
  const version =
    phase.state === 'idle' || phase.state === 'checking' || phase.state === 'up_to_date'
      ? null
      : (phase as { version?: string }).version;

  const progress =
    phase.state === 'downloading' && phase.total > 0
      ? Math.min(100, Math.round((phase.received / phase.total) * 100))
      : null;

  if (dismissed) return null;

  let tone = 'border-slate-200 bg-white text-slate-700';
  let icon: React.ReactNode = null;
  let label: string | null = null;
  let actions: React.ReactNode = null;

  switch (phase.state) {
    case 'available':
      tone = 'border-indigo-200 bg-indigo-50 text-indigo-900';
      icon = <Download className="w-4 h-4 text-indigo-600 shrink-0" />;
      label = `Dental Solutions v${phase.version} is available`;
      actions = (
        <button
          onClick={() => void runAutoUpdate()}
          className="ml-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5" />
          Install
        </button>
      );
      break;

    case 'downloading':
    case 'verifying':
    case 'backing_up': {
      tone = 'border-slate-200 bg-white text-slate-700';
      icon = <Loader2 className="w-4 h-4 text-indigo-600 animate-spin shrink-0" />;
      const what =
        phase.state === 'downloading'
          ? progress !== null
            ? `Downloading v${version} — ${progress}%`
            : `Downloading v${version}`
          : phase.state === 'verifying'
            ? `Verifying v${version}`
            : `Backing up your data before v${version}`;
      label =
        phase.state === 'downloading' && progress !== null && phase.total > 0
          ? `${what} (${formatBytes(phase.received)} of ${formatBytes(phase.total)})`
          : what;
      break;
    }

    case 'ready_to_apply':
      tone = 'border-emerald-200 bg-emerald-50 text-emerald-900';
      icon = <ArrowUpCircle className="w-4 h-4 text-ink-success shrink-0" />;
      label = `v${phase.version} is downloaded and verified — restart to install it`;
      actions = (
        <button
          onClick={() => void applyStagedUpdate()}
          className="ml-2 px-3 py-1.5 bg-fill-success hover:bg-emerald-700 text-white text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5"
        >
          <Power className="w-3.5 h-3.5" />
          Restart &amp; Apply
        </button>
      );
      break;

    case 'applying':
      tone = 'border-indigo-200 bg-indigo-50 text-indigo-900';
      icon = <Loader2 className="w-4 h-4 text-indigo-600 animate-spin shrink-0" />;
      label = `Restarting to install v${version}…`;
      break;

    case 'failed':
      tone = 'border-rose-200 bg-rose-50 text-rose-900';
      icon = <TriangleAlert className="w-4 h-4 text-ink-danger shrink-0" />;
      label = phase.message;
      actions = (
        <button
          onClick={() => void runAutoUpdate()}
          className="ml-2 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5 shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Try again
        </button>
      );
      break;

    default:
      // idle / checking / up_to_date — nothing the dashboard needs to say.
      label = null;
  }

  if (!label) return null;

  return (
    <div role="status" aria-live="polite">
      <div
        className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border shadow-xs text-xs ${tone}`}
      >
        {icon}
        <span className="font-semibold truncate">{label}</span>
        {actions}
        {!busy && phase.state !== 'applying' && (
          <button
            onClick={() => setDismissed(true)}
            aria-label="Hide update notice"
            className="ml-auto p-1 rounded-lg hover:bg-black/5 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5 opacity-60" />
          </button>
        )}
        {busy && (
          <span className="ml-auto flex items-center gap-1 text-[11px] opacity-70 shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Working…
          </span>
        )}
      </div>
    </div>
  );
}