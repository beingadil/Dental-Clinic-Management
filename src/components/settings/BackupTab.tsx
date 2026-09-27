import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import {
  createBackup,
  serializeBackup,
  parseBackupFile,
  validateBackup,
  applyRestoredBytes,
  APP_VERSION,
} from '../../services/backupService';
import { exportSqliteFile } from '../../services/sqliteStorage';
import {
  getBackupSchedule,
  saveBackupSchedule,
  getBackupRuns,
  runScheduledBackup,
  isDesktopShell as isDesktopShellForBackups,
  BackupScheduleState,
  BackupRun,
} from '../../services/backupScheduler';
import { runRestoreDrill, RestoreDrillResult } from '../../services/restoreDrill';
import { initEngineFromBytes, getDatabase } from '../../db';
import {
  Settings,
  ShieldCheck,
  Database,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  XCircle,
  HardDrive,
  X,
  Table,
  Check,
} from 'lucide-react';

/** TAB: BACKUP & RESTORE (+ boot integrity self-check) — extracted from
    SettingsView (P3 split); backupMessage and liveTableStats are shared with
    the container via props. */
export const BackupTab: React.FC<{
  backupMessage: { type: 'success' | 'error'; text: string } | null;
  setBackupMessage: (m: { type: 'success' | 'error'; text: string } | null) => void;
  liveTableStats: { name: string; rows: number }[];
}> = ({ backupMessage, setBackupMessage, liveTableStats }) => {
  const {
    cases,
    labs,
    invoices,
    caseTypes,
    savedVouchers,
    caseNotes,
    caseAttachments,
    getBackupData,
    integrityReport,
  } = useApp();

  const [backupSchedule, setBackupSchedule] = useState<BackupScheduleState>(() => getBackupSchedule());
  const [backupRuns, setBackupRuns] = useState<BackupRun[]>(() => getBackupRuns());
  const [backupBusy, setBackupBusy] = useState(false);
  const handleBackupScheduleChange = (patch: Partial<BackupScheduleState>) => {
    setBackupSchedule(saveBackupSchedule(patch));
  };
  const handleRunBackupNow = async () => {
    setBackupBusy(true);
    try {
      await runScheduledBackup('manual', true);
      setBackupSchedule(getBackupSchedule());
      setBackupRuns(getBackupRuns());
    } finally {
      setBackupBusy(false);
    }
  };

  // Restore drill — proves the backup→restore pipeline on a temp engine
  const [drillBusy, setDrillBusy] = useState(false);
  const [drillResult, setDrillResult] = useState<RestoreDrillResult | null>(null);
  const handleRestoreDrill = async () => {
    setDrillBusy(true);
    try {
      setDrillResult(await runRestoreDrill());
    } finally {
      setDrillBusy(false);
    }
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // ---- Backup / restore state (Phase 8) ----
  const [busy, setBusy] = useState<null | 'backup' | 'restore'>(null);
  const [pendingRestore, setPendingRestore] = useState<{
    pkg: ReturnType<typeof parseBackupFile>;
    errors: string[];
    warnings: string[];
    created_at?: string;
    app_version?: string;
    schema_version?: number;
    table_counts?: Record<string, number>;
  } | null>(null);

  // Storage metrics (shared with the System Reset tab diagnostics in the
  // original monolith — kept local here; reset tab computes its own counts)
  const storageMetrics = useMemo(() => {
    const notesCount = Object.values(caseNotes).reduce((acc: number, curr: any) => acc + (Array.isArray(curr) ? curr.length : 0), 0);
    const attachmentsCount = Object.values(caseAttachments).reduce((acc: number, curr: any) => acc + (Array.isArray(curr) ? curr.length : 0), 0);
    return {
      casesCount: cases.length,
      labsCount: labs.length,
      invoicesCount: invoices.length,
      vouchersCount: savedVouchers.length,
      catalogCount: caseTypes.length,
      notesCount,
      attachmentsCount,
    };
  }, [cases, labs, invoices, savedVouchers, caseTypes, caseNotes, caseAttachments]);

  // ---- Phase 8: portable .dentalbackup export ----
  const handleExportDentalBackup = async () => {
    setBusy('backup');
    try {
      const pkg = await createBackup();
      const blob = new Blob([serializeBackup(pkg)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dentalsolutions_${APP_VERSION}_${new Date().toISOString().slice(0, 10)}.dentalbackup`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const tables = Object.entries(pkg.manifest.table_counts).filter(([, n]) => n > 0);
      setBackupMessage({
        type: 'success',
        text: `Backup verified (checksum OK) — ${tables.length} tables, ${(pkg.manifest.db_size_bytes / 1024).toFixed(1)} KB. File downloaded.`,
      });
    } catch (err: any) {
      setBackupMessage({ type: 'error', text: `Backup failed: ${err?.message || 'unknown error'}` });
    } finally {
      setBusy(null);
      setTimeout(() => setBackupMessage(null), 6000);
    }
  };

  // ---- Phase 8: restore pipeline (validate → confirm → safety snapshot → swap engine) ----
  const handleSelectRestoreFile = async (file: File) => {
    setBusy('restore');
    try {
      const text = await file.text();
      const pkg = parseBackupFile(text);
      const verdict = await validateBackup(pkg);
      setPendingRestore({
        pkg,
        errors: verdict.errors,
        warnings: verdict.warnings,
        created_at: verdict.manifest?.created_at,
        app_version: verdict.manifest?.app_version,
        schema_version: verdict.manifest?.schema_version,
        table_counts: verdict.manifest?.table_counts,
      });
    } catch (err: any) {
      setBackupMessage({ type: 'error', text: `Could not read backup: ${err?.message || 'invalid file'}` });
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestore || pendingRestore.errors.length > 0) return;
    setBusy('restore');
    try {
      await applyRestoredBytes(pendingRestore.pkg, (bytes) =>
        initEngineFromBytes(bytes)
      );
      setPendingRestore(null);
      setBackupMessage({
        type: 'success',
        text: 'Restore complete — database swapped to the backup payload. Reloading…',
      });
      setTimeout(() => window.location.reload(), 1200);
    } catch (err: any) {
      setBackupMessage({ type: 'error', text: `Restore failed: ${err?.message || 'unknown error'}` });
    } finally {
      setBusy(null);
      setTimeout(() => setBackupMessage(null), 6000);
    }
  };

  // SQLite .SQL Dump Export
  const handleExportSqliteDump = () => {
    try {
      const data = getBackupData();
      const filename = exportSqliteFile(data);
      setBackupMessage({
        type: 'success',
        text: `Successfully exported SQLite database script: ${filename}`
      });
      setTimeout(() => setBackupMessage(null), 5000);
    } catch (err) {
      setBackupMessage({
        type: 'error',
        text: 'Failed to generate SQLite SQL dump.'
      });
    }
  };

  return (      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-5">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-2xl">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Application Data Backup & Offline Portability</h2>
            <p className="text-xs text-slate-500">Portable checksummed <code>.dentalbackup</code> packages — the entire SQLite database in one verifiable file</p>
          </div>
        </div>
        <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold rounded-full flex items-center gap-1.5">
          <HardDrive className="w-3.5 h-3.5 text-emerald-600" />
          <span>{liveTableStats.reduce((a, t) => a + t.rows, 0).toLocaleString()} rows in SQLite</span>
        </span>
      </div>

      {/* BOOT INTEGRITY SELF-CHECK — verify FK pragma, orphan rows, ledger
          balance; computed at boot by AppContext, surfaced here. */}
      <IntegrityPanel />

      {backupMessage && (
        <div className={`p-4 rounded-2xl text-xs font-semibold flex items-center justify-between gap-2 shadow-xs ${
          backupMessage.type === 'success'
            ? 'bg-emerald-50 text-emerald-900 border border-emerald-300'
            : 'bg-rose-50 text-rose-900 border border-rose-300'
        }`}>
          <div className="flex items-center gap-2.5">
            {backupMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <span>{backupMessage.text}</span>
          </div>
          <button
            onClick={() => setBackupMessage(null)}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Export */}
        <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs uppercase tracking-wider">
                <Database className="w-4 h-4" /> SQLite & Offline Database Export
              </div>
              <span className="text-[10px] font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md border border-indigo-100">
                Offline Engine
              </span>
            </div>

            <h3 className="font-bold text-slate-900 text-base">Export Portable Backup</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Downloads a single <code>.dentalbackup</code> file containing the live SQLite database with a SHA-256 integrity manifest. Restorable on any installation — browser or desktop.
            </p>

            <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1 text-[11px] text-slate-600">
              <div className="flex justify-between font-semibold">
                <span>Dental Cases & Notes:</span>
                <strong className="text-slate-900">{storageMetrics.casesCount} cases ({storageMetrics.notesCount} notes)</strong>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Billing & Vouchers:</span>
                <strong className="text-slate-900">{storageMetrics.invoicesCount} invoices, {storageMetrics.vouchersCount} vouchers</strong>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Partner Labs & Catalog:</span>
                <strong className="text-slate-900">{storageMetrics.labsCount} labs, {storageMetrics.catalogCount} items</strong>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
            <button
              onClick={handleExportDentalBackup}
              disabled={busy === 'backup'}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Download className="w-4 h-4 text-emerald-200" />
              <span>{busy === 'backup' ? 'Verifying…' : 'Export .dentalbackup'}</span>
            </button>
            <button
              onClick={handleExportSqliteDump}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Download className="w-4 h-4 text-blue-200" />
              <span>Export SQLite (.SQL)</span>
            </button>
          </div>
        </div>

        {/* Import / Restore */}
        <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-wider">
                <Upload className="w-4 h-4" /> Restore Database State
              </div>
              <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md border border-emerald-100">
                Offline Sync
              </span>
            </div>

            <h3 className="font-bold text-slate-900 text-base">Restore From Backup</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Import a <code>.dentalbackup</code> package. The file is validated (header, schema version, SHA-256 checksum) before anything is touched, a safety snapshot of current data is taken, and only then is the database swapped — followed by an automatic reload.
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".dentalbackup,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleSelectRestoreFile(f);
            }}
            className="hidden"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy === 'restore'}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>{busy === 'restore' ? 'Processing…' : 'Select & Validate Backup File'}</span>
          </button>

          {pendingRestore && (
            <div className={`p-3 rounded-xl border text-[11px] space-y-2 ${
              pendingRestore.errors.length > 0
                ? 'bg-rose-50 border-rose-300 text-rose-900'
                : 'bg-emerald-50 border-emerald-300 text-emerald-900'
            }`}>
              <p className="font-bold">
                {pendingRestore.errors.length > 0
                  ? 'Validation failed — restore blocked.'
                  : 'Backup valid — ready to restore.'}
              </p>
              {pendingRestore.created_at && (
                <p>Created: {new Date(pendingRestore.created_at).toLocaleString()} · App v{pendingRestore.app_version} · Schema v{pendingRestore.schema_version}</p>
              )}
              {pendingRestore.table_counts && (
                <p className="font-mono">
                  {Object.entries(pendingRestore.table_counts).filter(([, n]) => (n ?? 0) > 0).map(([t, n]) => `${t}: ${n}`).join(' · ') || 'Empty database'}
                </p>
              )}
              {pendingRestore.warnings.map((w, i) => <p key={i} className="text-amber-700 font-semibold flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {w}</p>)}
              {pendingRestore.errors.map((er, i) => <p key={i} className="font-semibold text-rose-700 flex items-start gap-1"><XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {er}</p>)}
              {pendingRestore.errors.length === 0 && (
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    onClick={() => setPendingRestore(null)}
                    className="px-3 py-1.5 bg-white/70 hover:bg-white text-slate-700 font-bold rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmRestore}
                    disabled={busy === 'restore'}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold rounded-lg shadow cursor-pointer"
                  >
                    {busy === 'restore' ? 'Restoring…' : 'Restore & Reload (replaces all data)'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* SQLite Relational Tables Inspector */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-xs">
            <Table className="w-4 h-4 text-blue-600" />
            <span>Live SQLite Relational Schema & Table Metrics</span>
          </div>
          <span className="text-[10px] font-mono text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
            {liveTableStats.length} Relational Tables
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
          {liveTableStats.map((tbl) => (
            <div key={tbl.name} className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between">
              <div>
                <span className="font-mono font-bold text-slate-900 block text-[11px]">{tbl.name}</span>
              </div>
              <span className="px-2 py-0.5 bg-slate-100 font-mono font-bold text-slate-700 text-[11px] rounded-md">
                {tbl.rows} rows
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Automatic backups */}
      <div className="p-6 bg-white border border-slate-200 rounded-2xl space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-sm uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4 text-emerald-600" /> Automatic Backups
          </div>
          {backupSchedule.lastRun ? (
            <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
              Last automatic backup: {new Date(backupSchedule.lastRun).toLocaleString()}
            </span>
          ) : (
            <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
              No automatic backup yet — runs shortly after first launch
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Backup frequency</label>
            <select
              value={backupSchedule.frequency}
              onChange={(e) => handleBackupScheduleChange({ frequency: e.target.value as BackupScheduleState['frequency'] })}
              className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
            >
              <option value="off">Off (manual only)</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Keep last (copies)</label>
            <select
              value={backupSchedule.keep}
              onChange={(e) => handleBackupScheduleChange({ keep: Number(e.target.value) })}
              className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
            >
              <option value="3">3</option>
              <option value="7">7</option>
              <option value="14">14</option>
              <option value="30">30</option>
            </select>
          </div>

          <button
            onClick={handleRunBackupNow}
            disabled={backupBusy}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Database className="w-4 h-4 text-emerald-200" />
            <span>{backupBusy ? 'Backing up…' : 'Back Up Now'}</span>
          </button>

          <button
            onClick={handleRestoreDrill}
            disabled={drillBusy}
            className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-300" />
            <span>{drillBusy ? 'Verifying…' : 'Verify Restore'}</span>
          </button>
        </div>

        {drillResult && (
          <div className={`p-3 rounded-xl text-xs font-semibold flex items-start gap-2 border ${
            drillResult.ok
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}>
            {drillResult.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
            <div>
              <span className="font-bold">{drillResult.ok ? 'Restore drill PASSED' : 'Restore drill FAILED'}</span>
              <span className="block font-normal">{drillResult.detail}</span>
            </div>
            <button onClick={() => setDrillResult(null)} className="ml-auto text-slate-400 hover:text-slate-600 p-0.5">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <p className="text-[11px] text-slate-500 leading-relaxed">
          {isDesktopShellForBackups() ? (
            <>Automatic backups are timestamped copies of the live SQLite file stored in the app data folder — zero-click recovery points. Oldest copies beyond the retention count are pruned automatically.</>
          ) : (
            <>In the browser the latest automatic backup is kept as a verified snapshot in local storage. For off-machine safety, export a <code>.dentalbackup</code> file regularly.</>
          )}
        </p>

        {backupRuns.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-100">
            <table className="w-full text-[11px]">
              <tbody>
                {backupRuns.slice(0, 8).map((r, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-1.5 text-slate-500 font-mono whitespace-nowrap">{new Date(r.at).toLocaleString()}</td>
                    <td className="px-2 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded font-bold ${r.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                        {r.ok ? 'OK' : 'FAILED'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-slate-600">{r.reason}</td>
                    <td className="px-3 py-1.5 text-slate-500 truncate max-w-[220px]" title={r.detail || ''}>{r.detail || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

/** Boot integrity verdict panel — reads the AppContext-computed report. */
function IntegrityPanel() {
  const { integrityReport } = useApp();

  if (!integrityReport) {
    return (
      <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 text-xs text-slate-500 flex items-center gap-2">
        <Settings className="w-4 h-4 animate-spin" />
        <span>Running boot integrity self-check…</span>
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-2xl border text-xs space-y-2 ${
      integrityReport.ok
        ? 'bg-emerald-50/70 border-emerald-200'
        : 'bg-rose-50 border-rose-300'
    }`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className={`font-bold flex items-center gap-2 ${
          integrityReport.ok ? 'text-emerald-800' : 'text-rose-800'
        }`}>
          {integrityReport.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-rose-600" />}
          Database integrity self-check — {integrityReport.ok ? 'ALL CHECKS PASSED' : 'ISSUES FOUND'}
        </span>
        <span className="text-[10px] font-mono text-slate-500">
          {new Date(integrityReport.ranAt).toLocaleString()}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
        {integrityReport.findings.map((f) => (
          <div key={f.check} className="flex items-start gap-2 p-2 bg-white/70 rounded-lg border border-slate-100">
            {f.ok ? <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 text-rose-600 mt-0.5 shrink-0" />}
            <div className="min-w-0">
              <span className="font-bold text-slate-800 block">{f.check}</span>
              <span className="text-slate-600 break-words">{f.detail}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

