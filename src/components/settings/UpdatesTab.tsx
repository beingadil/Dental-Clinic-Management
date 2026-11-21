import React, { useState, useEffect } from 'react';
import { currentVersion } from '../../services/updateService';
import {
  getLastUpdateCheck,
  onAutoUpdatePhase,
  AutoUpdatePhase,
  readUpdateDiagnostics,
  UpdateDiagnostics,
} from '../../services/updateInstaller';
import { getUpdateHistory, UpdateHistoryEntry } from '../../services/updateHistory';
import { AutoUpdatePanel } from '../common/AutoUpdatePanel';
import {
  ArrowUpCircle,
  CheckCircle2,
  Clock,
  History,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';

/**
 * Settings → Software Updates.
 *
 * Redesigned as a status card + version history timeline. The raw diagnostics
 * dump is gone; the receipt (what the last staged install actually did) is
 * shown only when it matters, as a single line.
 */
export const UpdatesTab: React.FC = () => {
  const [phase, setPhase] = useState<AutoUpdatePhase>({ state: 'idle' });
  useEffect(() => onAutoUpdatePhase(setPhase), []);
  const [updateHistory, setUpdateHistory] = useState<UpdateHistoryEntry[]>(() => getUpdateHistory());
  useEffect(() => { setUpdateHistory(getUpdateHistory()); }, [phase]);
  const [diag, setDiag] = useState<UpdateDiagnostics | null>(null);
  useEffect(() => { void readUpdateDiagnostics().then(setDiag); }, [phase]);
  const lastCheck = getLastUpdateCheck();

  const isAvailable = phase.state === 'available';
  const isDownloading = phase.state === 'downloading';
  const isFailed = phase.state === 'failed';
  const isHandedOff = phase.state === 'handed_off';
  const isPatchAvailable = phase.state === 'patch_available';
  const isPatchApplying = phase.state === 'patch_applying';
  const isPatched = phase.state === 'patched';
  const isPatchFailed = phase.state === 'patch_failed';

  const statusTone = isPatchFailed
    ? 'bg-rose-50 border-rose-200 text-rose-900'
    : isPatchAvailable || isPatchApplying
      ? 'bg-indigo-50 border-indigo-200 text-indigo-900'
      : isPatched
        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
        : isFailed
          ? 'bg-rose-50 border-rose-200 text-rose-900'
          : isAvailable || isHandedOff
            ? 'bg-indigo-50 border-indigo-200 text-indigo-900'
            : 'bg-emerald-50 border-emerald-200 text-emerald-900';

  const statusLabel = isPatchFailed
    ? 'Hot patch failed'
    : isPatchAvailable
      ? 'Hot patch available'
      : isPatchApplying
        ? 'Applying hot patch…'
        : isPatched
          ? 'Patch applied'
          : isFailed
            ? 'Update failed'
            : isAvailable
              ? 'Update available'
              : isDownloading
                ? 'Downloading…'
                : isHandedOff
                  ? 'Installer opened in browser'
                  : 'Up to date';

  const StatusIcon = isPatchFailed || isFailed
    ? TriangleAlert
    : isPatchAvailable || isPatchApplying || isPatched || isAvailable || isHandedOff
      ? ArrowUpCircle
      : CheckCircle2;

  const iconBg = isPatchFailed || isFailed
    ? 'bg-rose-100 text-rose-700'
    : isPatchAvailable || isPatchApplying
      ? 'bg-indigo-100 text-indigo-700'
      : isPatched || isAvailable
        ? 'bg-emerald-100 text-emerald-700'
        : 'bg-emerald-100 text-emerald-700';

  return (
    <div className="space-y-6">
      {/* Status card */}
      <div className={`rounded-2xl border p-6 ${statusTone}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${iconBg}`}>
              <StatusIcon className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold">{statusLabel}</h2>
              <p className="text-xs mt-0.5 opacity-80">
                {isPatchAvailable
                  ? 'A hot patch targets your current version — one click, no reinstall.'
                  : isPatchApplying
                    ? 'Applying the hot patch — the app reloads when it is done.'
                    : isPatched
                      ? 'Hot patch applied — the app reloaded to the new version.'
                      : isPatchFailed
                        ? (phase.state === 'patch_failed' ? phase.message : 'The last hot-patch attempt did not complete. Try again in Settings → Software Updates.')
                        : isFailed
                          ? (phase.state === 'failed' ? phase.message : 'The last update attempt did not complete. Try again below.')
                          : isHandedOff
                            ? (phase.state === 'handed_off' ? phase.message : '')
                            : isAvailable
                              ? 'A new version is ready to download and install.'
                              : 'Dental Solutions is running the latest version.'}
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-60">Current version</div>
            <div className="text-lg font-mono font-bold">v{currentVersion()}</div>
          </div>
        </div>

        {/* Installer — identical to the floating panel, no second copy of the
            update logic to drift out of sync. */}
        <div className="mt-4">
          <AutoUpdatePanel variant="inline" />
        </div>

        {/* Last check timestamp */}
        {lastCheck && (
          <p className="text-[11px] mt-3 opacity-70 flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            Last check: {new Date(lastCheck.at).toLocaleString()} — {lastCheck.state}
          </p>
        )}
      </div>

      {/* Receipt — shown only when it matters */}
      {diag && diag.receipt_status === 'settled' && diag.receipt && (
        <div className="flex items-start gap-2.5 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
          <p className="text-[11px] text-emerald-800">
            Last update verified: v{diag.receipt.version} staged {diag.receipt.staged_at || ''} and now running (checksum matched).
          </p>
        </div>
      )}
      {diag && diag.receipt_status === 'pending' && diag.receipt && !diag.staged_installer_present && (
        <div className="flex items-start gap-2.5 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
          <div>
            <p className="font-bold">An earlier update was interrupted</p>
            <p className="text-[11px] text-rose-800 mt-0.5">
              v{diag.receipt.version} was downloaded and verified, but its installer is no longer on disk — restarting will NOT complete it. Use "Check for updates" above to download it again.
            </p>
          </div>
        </div>
      )}

      {/* Trust signals — compact row, not three separate cards */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          Automatic check on launch
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          SHA-256 verified
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          Database backed up before install
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
          Hot patch — SHA-256 verified writes under dist/ only
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          Per-user install, no admin rights
        </span>
      </div>

      {/* Version history timeline */}
      {updateHistory.length > 0 ? (
        <div className="pt-2">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-4 h-4 text-slate-500" />
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Update history</h3>
          </div>
          <ol className="relative border-l border-slate-200 ml-2 space-y-3">
            {updateHistory.slice(0, 8).map((h, i) => (
              <li key={`${h.at}-${i}`} className="ml-4">
                <span
                  className={`absolute -left-1.5 mt-1 w-3 h-3 rounded-full border-2 border-white ${
                    h.state === 'installed'
                      ? 'bg-emerald-500'
                      : h.state === 'patch_applied'
                        ? 'bg-emerald-500'
                        : h.state === 'available' || h.state === 'handed_off' || h.state === 'patch_available'
                          ? 'bg-indigo-500'
                          : h.state === 'up_to_date'
                            ? 'bg-slate-300'
                            : 'bg-rose-500'
                  }`}
                />
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-800">
                    {h.state === 'available' && `v${h.version} detected`}
                    {h.state === 'installed' && `Updated to v${h.version}`}
                    {h.state === 'handed_off' && `v${h.version} installer opened in browser`}
                    {h.state === 'failed' && `Update failed${h.version !== currentVersion() ? ` (v${h.version})` : ''}`}
                    {h.state === 'up_to_date' && 'Checked — up to date'}
                    {h.state === 'patch_available' && `Hot patch available — v${h.version}`}
                    {h.state === 'patch_applied' && `Hot patch applied — v${h.version}`}
                    {h.state === 'patch_failed' && `Hot patch failed${h.message ? ` — ${h.message}` : ''}`}
                  </span>
                  <span className="text-[11px] text-slate-400">{new Date(h.at).toLocaleString()}</span>
                </div>
                {h.message && (
                  <p className="text-[11px] text-slate-500 truncate mt-0.5" title={h.message}>{h.message}</p>
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 border-t border-slate-100 pt-3">No update activity recorded yet.</p>
      )}
    </div>
  );
};