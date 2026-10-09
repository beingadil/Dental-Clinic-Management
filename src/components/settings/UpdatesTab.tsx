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
import { ArrowUpCircle, CheckCircle2, TriangleAlert } from 'lucide-react';

/**
 * Settings → Software Updates.
 *
 * The tab renders the SAME installer UI as the floating panel (one phase
 * machine, two layouts) plus the audit trail: what the updater did, when, and
 * whether an earlier staged install ever landed.
 */
export const UpdatesTab: React.FC = () => {
  const [phase, setPhase] = useState<AutoUpdatePhase>({ state: 'idle' });
  useEffect(() => onAutoUpdatePhase(setPhase), []);
  const [updateHistory, setUpdateHistory] = useState<UpdateHistoryEntry[]>(() => getUpdateHistory());
  useEffect(() => { setUpdateHistory(getUpdateHistory()); }, [phase]);
  const [diag, setDiag] = useState<UpdateDiagnostics | null>(null);
  useEffect(() => { void readUpdateDiagnostics().then(setDiag); }, [phase]);
  const lastCheck = getLastUpdateCheck();

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-5">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl">
            <ArrowUpCircle className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Software Updates</h2>
            <p className="text-xs text-slate-500">
              Dental Solutions downloads and verifies updates on its own, then asks before
              restarting. Nothing is installed until the SHA-256 matches the published
              checksum, and your database is backed up first.
            </p>
          </div>
        </div>
        <span className="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-100">
          v{currentVersion()}
        </span>
      </div>

      {/* The installer itself — identical to the floating panel, no second copy
          of the update logic to drift out of sync. */}
      <AutoUpdatePanel variant="inline" />

      {/* What the last staged install actually did — the receipt is the truth. */}
      {diag && diag.receipt_status === 'settled' && diag.receipt && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-ink-success" />
          <p className="text-[11px] text-emerald-800">
            Last update verified: v{diag.receipt.version} staged {diag.receipt.staged_at || ''} and now
            running (checksum matched).
          </p>
        </div>
      )}
      {diag && diag.receipt_status === 'pending' && diag.receipt && !diag.staged_installer_present && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 flex items-start gap-2">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5 text-ink-danger" />
          <div>
            <p className="font-bold">An earlier update was interrupted</p>
            <p className="text-[11px] text-rose-800 mt-0.5">
              v{diag.receipt.version} was downloaded and verified, but its installer is no longer on
              disk — restarting will NOT complete it. Use “Check for updates” above to download it again.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
          <p className="text-xs font-bold text-slate-800">Automatic checking</p>
          <p className="text-[11px] text-slate-600">
            Runs once when the app starts, then hourly. Silent when you are up to date.
          </p>
        </div>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
          <p className="text-xs font-bold text-slate-800">Verified before it touches disk</p>
          <p className="text-[11px] text-slate-600">
            The installer is SHA-256 checked while it streams and re-checked at the moment it runs.
            A mismatch aborts with nothing installed.
          </p>
        </div>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
          <p className="text-xs font-bold text-slate-800">You decide when to restart</p>
          <p className="text-[11px] text-slate-600">
            The update is staged in the background; the app only closes when you press
            “Restart &amp; Apply Updates”. Installs per-user — no administrator rights.
          </p>
        </div>
      </div>

      {lastCheck && (
        <p className="text-[11px] text-slate-500">
          Last check: {new Date(lastCheck.at).toLocaleString()} — {lastCheck.state}
        </p>
      )}

      {updateHistory.length > 0 ? (
        <div className="pt-3 border-t border-slate-100">
          <p className="text-xs font-bold text-slate-800 mb-1">Update history</p>
          <ul className="divide-y divide-slate-100">
            {updateHistory.slice(0, 8).map((h, i) => (
              <li key={`${h.at}-${i}`} className="py-2 flex items-start gap-2.5 text-[11px]">
                <span
                  className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                    h.state === 'installed'
                      ? 'bg-fill-success'
                      : h.state === 'available'
                        ? 'bg-indigo-500'
                        : h.state === 'up_to_date'
                          ? 'bg-slate-300'
                          : 'bg-fill-danger'
                  }`}
                />
                <div className="min-w-0">
                  <p className="font-bold text-slate-700">
                    {h.state === 'available' && `v${h.version} detected`}
                    {h.state === 'installed' && `Updated to v${h.version}`}
                    {h.state === 'failed' && `Update failed${h.version !== currentVersion() ? ` (v${h.version})` : ''}`}
                    {h.state === 'up_to_date' && 'Checked — up to date'}
                    <span className="font-normal text-ink-muted"> · {new Date(h.at).toLocaleString()}</span>
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
        <p className="text-[11px] text-slate-500 border-t border-slate-100 pt-3">No update activity recorded yet.</p>
      )}
    </div>
  );
};