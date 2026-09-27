import React, { useState, useEffect } from 'react';
import { currentVersion } from '../../services/updateService';
import {
  runAutoUpdate,
  onAutoUpdatePhase,
  getAutoUpdatePhase,
  getLastUpdateCheck,
  AutoUpdatePhase,
} from '../../services/updateInstaller';
import { getUpdateHistory, UpdateHistoryEntry } from '../../services/updateHistory';
import { ArrowUpCircle, Loader2, RefreshCw } from 'lucide-react';

export const UpdatesTab: React.FC = () => {
  const [autoPhase, setAutoPhase] = useState<AutoUpdatePhase>(() => getAutoUpdatePhase());
  useEffect(() => onAutoUpdatePhase(setAutoPhase), []);
  const [updateHistory, setUpdateHistory] = useState<UpdateHistoryEntry[]>(() => getUpdateHistory());
  useEffect(() => { setUpdateHistory(getUpdateHistory()); }, [autoPhase]);

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-5">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl">
            <ArrowUpCircle className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Software Updates</h2>
            <p className="text-xs text-slate-500">The app checks automatically on start. Updates are checksum-verified before anything is installed; offline machines use the Import Offline Update package below.</p>
          </div>
        </div>
        <span className="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-100">
          v{currentVersion()}
        </span>
      </div>

      {autoPhase.state === 'available' && (
        <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-900 flex items-center justify-between gap-3">
          <span className="font-bold">Dental Solutions v{autoPhase.version} is available</span>
          <button
            onClick={() => runAutoUpdate()}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-[11px] cursor-pointer flex items-center gap-1.5 shrink-0"
          >
            <ArrowUpCircle className="w-3.5 h-3.5" /> Update Now
            </button>
        </div>
      )}
      {(autoPhase.state === 'downloading' || autoPhase.state === 'verifying' || autoPhase.state === 'installing') && (
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
          <span className="font-bold">
            {autoPhase.state === 'downloading'
              ? `Downloading v${autoPhase.version}${autoPhase.total > 0 ? ` — ${Math.round((autoPhase.received / autoPhase.total) * 100)}%` : '…'}`
              : autoPhase.state === 'verifying'
              ? `Verifying v${autoPhase.version}…`
              : `Installing v${autoPhase.version} — the app will restart automatically`}
          </span>
        </div>
      )}
      {autoPhase.state === 'failed' && (
        <p className="text-xs text-slate-500">{autoPhase.message}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
          <p className="text-xs font-bold text-slate-800">Automatic checking</p>
          <p className="text-[11px] text-slate-600">Runs when the dashboard loads and hourly afterwards. Silent when up to date; nothing is installed without verification against the published SHA-256.</p>
        </div>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
          <p className="text-xs font-bold text-slate-800">Silent install</p>
          <p className="text-[11px] text-slate-600">Installs per-user — no administrator rights needed. The installer is checksum-verified, the database is backed up first, and the app restarts itself on the new version. Offline machines: import a verified .dentalupdate package from the Database &amp; Backup tab.</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          onClick={() => runAutoUpdate()}
          disabled={autoPhase.state === 'checking' || autoPhase.state === 'downloading' || autoPhase.state === 'verifying' || autoPhase.state === 'installing'}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs cursor-pointer flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${autoPhase.state === 'checking' ? 'animate-spin' : ''}`} />
          Check &amp; Install Now
        </button>
        {getLastUpdateCheck() && (
          <span className="text-[11px] text-slate-500 self-center">
            Last check: {new Date(getLastUpdateCheck()!.at).toLocaleString()} — {getLastUpdateCheck()!.state}
          </span>
        )}
      </div>

      {updateHistory.length > 0 ? (
        <div className="pt-3 border-t border-slate-100">
          <p className="text-xs font-bold text-slate-800 mb-1">Update history</p>
          <ul className="divide-y divide-slate-100">
            {updateHistory.slice(0, 8).map((h, i) => (
              <li key={`${h.at}-${i}`} className="py-2 flex items-start gap-2.5 text-[11px]">
                <span
                  className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                    h.state === 'installed'
                      ? 'bg-emerald-500'
                      : h.state === 'available'
                      ? 'bg-indigo-500'
                      : h.state === 'up_to_date'
                      ? 'bg-slate-300'
                      : 'bg-rose-500'
                  }`}
                />
                <div className="min-w-0">
                  <p className="font-bold text-slate-700">
                    {h.state === 'available' && `v${h.version} available`}
                    {h.state === 'installed' && `Updated to v${h.version}`}
                    {h.state === 'failed' && `Update failed${h.version !== currentVersion() ? ` (v${h.version})` : ''}`}
                    {h.state === 'up_to_date' && 'Checked — up to date'}
                    <span className="font-normal text-slate-400"> · {new Date(h.at).toLocaleString()}</span>
                  </p>
                  {h.message && (
                    <p className="text-slate-500 truncate" title={h.message}>{h.message}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 border-t border-slate-100 pt-3">No update activity recorded yet.</p>
      )}
    </div>
  );
};
