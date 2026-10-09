import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  CheckCircle2,
  AlertTriangle,
  Trash2,
  X,
  FileText,
  Building,
  DollarSign,
  BookmarkCheck,
  CheckSquare,
  Paperclip,
  HardDrive,
  Database,
} from 'lucide-react';

/** TAB: TESTING & SYSTEM RESET (DANGER ZONE) — extracted verbatim from
    SettingsView (P3 split); the global backupMessage lives in the container. */
export const TestingTab: React.FC = () => {
  const { cases, labs, invoices, caseTypes, savedVouchers, caseNotes, caseAttachments, wipeAllData, resetToDemoData } = useApp();

  const [showWipeModal, setShowWipeModal] = useState(false);
  const [wipeConfirmText, setWipeConfirmText] = useState('');
  const [wipeSuccess, setWipeSuccess] = useState(false);

  const notesCount = Object.values(caseNotes).reduce((acc: number, curr: any) => acc + (Array.isArray(curr) ? curr.length : 0), 0);
  const attachmentsCount = Object.values(caseAttachments).reduce((acc: number, curr: any) => acc + (Array.isArray(curr) ? curr.length : 0), 0);
  const storageMetrics = {
    casesCount: cases.length,
    labsCount: labs.length,
    invoicesCount: invoices.length,
    vouchersCount: savedVouchers.length,
    catalogCount: caseTypes.length,
    notesCount,
    attachmentsCount,
  };

  // Reset to Demo Data
  // Total Data Wipe for Software Testing
  const handleExecuteFullWipe = () => {
    wipeAllData();
    setShowWipeModal(false);
    setWipeConfirmText('');
    setWipeSuccess(true);
    setTimeout(() => setWipeSuccess(false), 5000);
  };

  return (
    <div className="space-y-6">
      {/* Storage Diagnostic Overview */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">System Entity & Storage Diagnostics</h2>
              <p className="text-xs text-slate-500">Live counts of records in the SQLite database on this machine</p>
            </div>
          </div>

        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-center">
            <div className="flex items-center justify-center gap-1 text-ink-muted mb-1">
              <FileText className="w-3.5 h-3.5" />
            </div>
            <span className="text-xl font-bold text-slate-900 block">{storageMetrics.casesCount}</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">Cases</span>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-center">
            <div className="flex items-center justify-center gap-1 text-ink-muted mb-1">
              <Building className="w-3.5 h-3.5" />
            </div>
            <span className="text-xl font-bold text-slate-900 block">{storageMetrics.labsCount}</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">Partner Labs</span>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-center">
            <div className="flex items-center justify-center gap-1 text-ink-muted mb-1">
              <DollarSign className="w-3.5 h-3.5" />
            </div>
            <span className="text-xl font-bold text-slate-900 block">{storageMetrics.invoicesCount}</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">Invoices</span>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-center">
            <div className="flex items-center justify-center gap-1 text-ink-muted mb-1">
              <BookmarkCheck className="w-3.5 h-3.5" />
            </div>
            <span className="text-xl font-bold text-slate-900 block">{storageMetrics.vouchersCount}</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">Vouchers</span>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-center">
            <div className="flex items-center justify-center gap-1 text-ink-muted mb-1">
              <CheckSquare className="w-3.5 h-3.5" />
            </div>
            <span className="text-xl font-bold text-slate-900 block">{storageMetrics.catalogCount}</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">Catalog Items</span>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-center">
            <div className="flex items-center justify-center gap-1 text-ink-muted mb-1">
              <Paperclip className="w-3.5 h-3.5" />
            </div>
            <span className="text-xl font-bold text-slate-900 block">{storageMetrics.attachmentsCount}</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">Attachments</span>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-center">
            <div className="flex items-center justify-center gap-1 text-ink-muted mb-1">
              <FileText className="w-3.5 h-3.5" />
            </div>
            <span className="text-xl font-bold text-slate-900 block">{storageMetrics.notesCount}</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase">Case Notes</span>
          </div>
        </div>
      </div>

      {/* Software Testing Actions Panel */}
      <div className="bg-white rounded-3xl border border-rose-200 shadow-sm p-6 space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-rose-100">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-rose-100 text-ink-danger rounded-2xl">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Software Testing & Data Reset Console</h2>
              <p className="text-xs text-slate-500">
                Use these control tools while testing the application to quickly populate sample demo data or clear everything for a clean test run.
              </p>
            </div>
          </div>
        </div>

        {wipeSuccess && (
          <div className="p-3.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-ink-success shrink-0" />
            <span>ALL SYSTEM DATA WIPED CLEAN! System is now completely empty for fresh testing.</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Complete System Data Wipe / Delete Everything */}
          <div className="p-6 bg-rose-50/80 border border-rose-300 rounded-3xl space-y-4 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-rose-700 font-extrabold text-xs uppercase tracking-wider">
                <Trash2 className="w-4 h-4 text-ink-danger" /> Complete System Purge
              </div>
              <h3 className="font-bold text-slate-900 text-base">DELETE EVERYTHING (Wipe All Data)</h3>
              <p className="text-xs text-slate-700 leading-relaxed">
                <strong>For Software Testing:</strong> Instantly deletes ALL cases, invoices, vouchers, partner labs, notes, attachments, and cached local storage. Leaves a 100% blank slate.
              </p>
            </div>

            <button
              onClick={() => setShowWipeModal(true)}
              className="w-full py-3 bg-rose-600 hover:bg-rose-700 active:scale-[0.99] text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete everything — wipe all data</span>
            </button>
          </div>

          {/* F13: resetToDemoData existed in the auth domain with no UI caller;
              surfaced as the supported training/demonstration reset path. */}
          <div className="p-6 bg-indigo-50/60 border border-indigo-200 rounded-3xl space-y-4 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-indigo-700 font-extrabold text-xs uppercase tracking-wider">
                <Database className="w-4 h-4 text-indigo-600" /> Load Sample Data
              </div>
              <h3 className="font-bold text-slate-900 text-base">Reset to Demo Data</h3>
              <p className="text-xs text-slate-700 leading-relaxed">
                Replaces current data with a small built-in sample set — useful for training staff or demonstrating the workflow. Your user account and branding stay.
              </p>
            </div>

            <button
              onClick={() => { resetToDemoData(); setWipeSuccess(true); setTimeout(() => setWipeSuccess(false), 5000); }}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Database className="w-4 h-4" />
              <span>Reset to demo data</span>
            </button>
          </div>
        </div>
      </div>

      {/* CONFIRMATION MODAL FOR TOTAL SYSTEM DATA WIPE */}
      {showWipeModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 border border-slate-200 shadow-2xl space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-rose-100 text-ink-danger rounded-2xl">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">Confirm Total Data Wipe</h3>
                  <p className="text-xs text-ink-danger font-bold uppercase tracking-wider">Software Testing Action</p>
                </div>
              </div>

              <button
                onClick={() => {
                  setShowWipeModal(false);
                  setWipeConfirmText('');
                }}
                className="p-1 text-ink-muted hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl space-y-2 text-xs text-rose-900">
              <p className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-ink-danger shrink-0" />
                <span>Warning: You are about to permanently delete everything!</span>
              </p>
              <ul className="list-disc list-inside space-y-1 text-rose-800 text-[11px] font-medium">
                <li>{storageMetrics.casesCount} Dental Cases & Clinical Notes</li>
                <li>{storageMetrics.invoicesCount} Financial Billing Invoices</li>
                <li>{storageMetrics.vouchersCount} Saved Job Slips & Vouchers</li>
                <li>{storageMetrics.labsCount} Registered Partner Dental Labs</li>
                <li>All attachments and local storage cache</li>
              </ul>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">
                Type <span className="font-mono text-ink-danger font-bold">DELETE</span> below to confirm:
              </label>
              <input
                type="text"
                value={wipeConfirmText}
                onChange={(e) => setWipeConfirmText(e.target.value)}
                placeholder="Type DELETE"
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-xl font-mono uppercase font-bold focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowWipeModal(false);
                  setWipeConfirmText('');
                }}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={wipeConfirmText.trim().toUpperCase() !== 'DELETE'}
                onClick={handleExecuteFullWipe}
                className={`px-5 py-2.5 font-bold text-xs rounded-xl flex items-center gap-2 shadow-md transition-all ${
                  wipeConfirmText.trim().toUpperCase() === 'DELETE'
                    ? 'bg-rose-600 hover:bg-rose-700 text-white cursor-pointer'
                    : 'bg-slate-200 text-ink-muted cursor-not-allowed'
                }`}
              >
                <Trash2 className="w-4 h-4" /> Permanently Delete All Data
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
