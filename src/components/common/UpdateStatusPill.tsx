import { useEffect, useState } from 'react';
import { RefreshCw, ArrowUpCircle, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  runAutoUpdate,
  onAutoUpdatePhase,
  AutoUpdatePhase,
  isDesktopShell,
} from '../../services/updateInstaller';

/**
 * Dashboard auto-update pill. Mounts with the dashboard, which triggers the
 * app's automatic update check (once per session — the engine is a singleton).
 *
 * - up to date / offline: renders nothing (never nags)
 * - update available: small pill; one click starts verify→install
 * - downloading/verifying/installing: live progress
 * - failure: silent unless it happened during an explicit user-initiated run
 */
export function UpdateStatusPill() {
  const [phase, setPhase] = useState<AutoUpdatePhase>({ state: 'idle' });

  useEffect(() => {
    const unsub = onAutoUpdatePhase(setPhase);
    runAutoUpdate(); // singleton — the check happens once per session
    return () => { unsub(); };
  }, []);

  if (phase.state === 'idle' || phase.state === 'checking' || phase.state === 'up_to_date') {
    return null;
  }

  if (phase.state === 'available') {
    return (
      <div className="flex justify-end">
        <button
          onClick={() => runAutoUpdate()}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-full shadow-sm cursor-pointer flex items-center gap-1.5"
        >
          <ArrowUpCircle className="w-3.5 h-3.5" />
          Update to v{phase.version}
        </button>
      </div>
    );
  }

  if (phase.state === 'downloading') {
    const pct = phase.total > 0 ? Math.round((phase.received / phase.total) * 100) : null;
    return (
      <div className="flex justify-end">
        <div className="px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-800 text-[11px] font-bold rounded-full flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Downloading v{phase.version}{pct !== null ? ` — ${pct}%` : '…'}
        </div>
      </div>
    );
  }

  if (phase.state === 'verifying' || phase.state === 'installing') {
    return (
      <div className="flex justify-end">
        <div className="px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-800 text-[11px] font-bold rounded-full flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {phase.state === 'verifying' ? `Verifying v${phase.version}…` : `Installing v${phase.version} — the app will restart`}
        </div>
      </div>
    );
  }

  // failed — only make a fuss when auto-install isn't possible here
  const webShell = !isDesktopShell();
  return (
    <div className="flex justify-end">
      <div
        className={`px-3 py-1.5 text-[11px] font-bold rounded-full flex items-center gap-2 ${webShell ? 'bg-amber-50 border border-amber-300 text-amber-800' : 'bg-slate-50 border border-slate-200 text-slate-500'}`}
        title={phase.message}
      >
        {webShell ? <AlertCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
        <span className="max-w-[320px] truncate">{phase.message}</span>
      </div>
    </div>
  );
}
