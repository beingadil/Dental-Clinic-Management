import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  createBackup,
  serializeBackup,
  parseBackupFile,
  validateBackup,
  applyRestoredBytes,
  APP_VERSION,
} from '../../services/backupService';
import { currentVersion } from '../../services/updateService';
import { exportSqliteFile } from '../../services/sqliteStorage';
import { initEngineFromBytes, getDatabase } from '../../db';
import { 
  Settings, 
  ShieldCheck, 
  Database, 
  Download, 
  Upload, 
  RefreshCw, 
  CheckCircle2,
  AlertCircle,
  CreditCard,
  Image as ImageIcon,
  Check,
  Palette,
  Trash2,
  AlertTriangle,
  XCircle,
  HardDrive,
  Sliders,
  X,
  FileText,
  Building,
  DollarSign,
  BookmarkCheck,
  Paperclip,
  CheckSquare,
  User,
  Users,
  Key,
  Plus,
  Lock,
  UserPlus,
  Edit3,
  ShieldAlert,
  Mail,
  Code,
  Table,
  Printer,
  ArrowUpCircle,
  Loader2
} from 'lucide-react';
import { loadPrintSettings, savePrintSettings, PrintSettings } from '../../services/printSettings';
import {
  runAutoUpdate,
  onAutoUpdatePhase,
  getAutoUpdatePhase,
  getLastUpdateCheck,
  AutoUpdatePhase,
  isDesktopShell,
} from '../../services/updateInstaller';
import { getUpdateHistory, UpdateHistoryEntry } from '../../services/updateHistory';

export const SettingsView: React.FC = () => {
  const { 
    user, 
    users,
    addUser,
    updateUser,
    deleteUser,
    changePassword,
    cases,
    labs,
    invoices,
    caseTypes,
    savedVouchers,
    caseNotes,
    caseAttachments,
    userPreferences,
    updateUserPreferences,
    brandingSettings, 
    updateBrandingSettings, 
    getBackupData, 
    restoreBackupData, 
    resetToDemoData,
    wipeAllData
  } = useApp();

  const [activeTab, setActiveTab] = useState<'branding' | 'account' | 'users' | 'backup' | 'testing' | 'preferences' | 'print' | 'updates'>('branding');
  const [brandingForm, setBrandingForm] = useState(brandingSettings);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [backupMessage, setBackupMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Global print settings (Settings → Print & Documents)
  const [printSettingsForm, setPrintSettingsForm] = useState<PrintSettings>(() => loadPrintSettings());
  const [printSaved, setPrintSaved] = useState(false);

  // Auto-update engine (dashboard pill + this card share one phase store)
  const [autoPhase, setAutoPhase] = useState<AutoUpdatePhase>(() => getAutoUpdatePhase());
  useEffect(() => onAutoUpdatePhase(setAutoPhase), []);
  // Persisted update history — re-read whenever the phase moves so the log
  // reflects the run that just happened.
  const [updateHistory, setUpdateHistory] = useState<UpdateHistoryEntry[]>(() => getUpdateHistory());
  useEffect(() => { setUpdateHistory(getUpdateHistory()); }, [autoPhase]);

  // My Account form state
  const [accountForm, setAccountForm] = useState({
    name: user?.name || '',
    username: user?.username || '',
    email: user?.email || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [accountMsg, setAccountMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // User Management state
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    username: '',
    email: '',
    role: 'Technician' as 'Lab Admin' | 'Technician' | 'Billing Manager',
    password: ''
  });
  const [userMsg, setUserMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingUserRole, setEditingUserRole] = useState<'Lab Admin' | 'Technician' | 'Billing Manager'>('Technician');
  const [resetPwdUserId, setResetPwdUserId] = useState<string | null>(null);
  const [resetPwdValue, setResetPwdValue] = useState('');

  // Modal State for Testing Data Wipe
  const [showWipeModal, setShowWipeModal] = useState(false);
  const [wipeConfirmText, setWipeConfirmText] = useState('');
  const [wipeSuccess, setWipeSuccess] = useState(false);

  const isAdmin = user?.role === 'Lab Admin' || user?.role === 'Super Admin' || user?.isSuperAdmin;
  const visibleUsers = users.filter((u) => !u.isSuperAdmin && u.username !== 'adil');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // ---- Backup / restore / update state (Phase 8 & 9) ----
  const [busy, setBusy] = useState<null | 'backup' | 'restore' | 'check'>(null);
  const [pendingRestore, setPendingRestore] = useState<{
    pkg: ReturnType<typeof parseBackupFile>;
    errors: string[];
    warnings: string[];
    created_at?: string;
    app_version?: string;
    schema_version?: number;
    table_counts?: Record<string, number>;
  } | null>(null);

  // Calculate local storage size estimate
  const storageMetrics = useMemo(() => {
    let totalBytes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('dsw_')) {
          const val = localStorage.getItem(key) || '';
          totalBytes += key.length + val.length;
        }
      }
    } catch (e) {
      // ignore
    }
    const totalKb = (totalBytes / 1024).toFixed(1);
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
      totalKb
    };
  }, [cases, labs, invoices, savedVouchers, caseTypes, caseNotes, caseAttachments]);

  // Live SQLite table statistics (real database, not legacy localStorage counts)
  const liveTableStats = useMemo(() => {
    try {
      const db = getDatabase();
      return db
        .all<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'schema_migrations' AND name NOT LIKE 'legacy_%' ORDER BY name`
        )
        .map((t) => ({
        name: t.name,
        rows: db.rowCount(t.name),
      }));
    } catch {
      return [];
    }
  }, []);

  // Handle Branding Changes
  const handleBrandingChange = (key: keyof typeof brandingSettings, value: string) => {
    setBrandingForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert('Logo image size must be under 2MB.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setBrandingForm((prev) => ({ ...prev, logoUrl: base64 }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveBranding = (e: React.FormEvent) => {
    e.preventDefault();
    updateBrandingSettings(brandingForm);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleSavePrintSettings = (e: React.FormEvent) => {
    e.preventDefault();
    savePrintSettings(printSettingsForm);
    setPrintSaved(true);
    setTimeout(() => setPrintSaved(false), 3000);
  };

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

  // Reset to Demo Data
  const handleResetDemo = () => {
    if (confirm('Reset system to default demo state? This restores sample lab cases, partner labs, catalog pricing, and demo invoices.')) {
      resetToDemoData();
      setBackupMessage({
        type: 'success',
        text: 'System state restored to fresh initial demo data.'
      });
      setTimeout(() => setBackupMessage(null), 4000);
    }
  };

  // Total Data Wipe for Software Testing
  const handleExecuteFullWipe = () => {
    wipeAllData();
    setShowWipeModal(false);
    setWipeConfirmText('');
    setWipeSuccess(true);
    setBackupMessage({
      type: 'success',
      text: 'ALL SYSTEM DATA WIPED CLEAN! System is now completely empty for fresh testing.'
    });
    setTimeout(() => setWipeSuccess(false), 5000);
    setTimeout(() => setBackupMessage(null), 6000);
  };

  return (
    <div className="space-y-6">
      {/* Header Title Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Settings className="w-7 h-7 text-indigo-600" />
            System Control & Settings
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Manage laboratory branding, custom bank billing, SQLite backups, software testing reset, and system wipe tools.
          </p>
        </div>

        {/* Quick Storage Badge */}
        <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 px-3.5 py-1.5 rounded-2xl text-xs font-semibold text-slate-700 self-start md:self-auto">
          <HardDrive className="w-4 h-4 text-indigo-600" />
          <span>Local Storage DB: <strong className="text-slate-900 font-mono">{storageMetrics.totalKb} KB</strong></span>
        </div>
      </div>

      {/* Admin Authorization Card */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white font-bold text-lg flex items-center justify-center shadow-md shadow-indigo-600/20">
            {user?.name ? user.name.charAt(0).toUpperCase() : 'D'}
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-sm">{user?.name || 'Dr. Zeeshan (Admin)'}</h3>
            <p className="text-xs text-slate-500">
              {user?.email || 'admin@dentalsolutions.pk'} • Role: <strong className="uppercase text-indigo-600">{user?.role || 'Lab Admin'}</strong>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-3.5 py-1.5 rounded-full text-xs font-bold border border-emerald-200 self-start md:self-auto">
          <ShieldCheck className="w-4 h-4 text-emerald-600" /> Master System Administrator Authorized
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap border-b border-slate-200 space-x-1">
        <button
          onClick={() => setActiveTab('branding')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'branding'
              ? 'border-slate-900 text-slate-900 bg-slate-50'
              : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Palette className="w-4 h-4" />
          <span>Branding & Identity</span>
        </button>

        <button
          onClick={() => setActiveTab('account')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'account'
              ? 'border-slate-900 text-slate-900 bg-slate-50'
              : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <User className="w-4 h-4" />
          <span>My Account & Security</span>
        </button>

        {isAdmin && (
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'users'
                ? 'border-slate-900 text-slate-900 bg-slate-50'
                : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>User Management</span>
            <span className="px-1.5 py-0.5 bg-slate-200 text-slate-700 text-[10px] font-bold uppercase rounded">
              Admin
            </span>
          </button>
        )}

        <button
          onClick={() => setActiveTab('backup')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'backup'
              ? 'border-slate-900 text-slate-900 bg-slate-50'
              : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Database & Backup</span>
        </button>

        <button
          onClick={() => setActiveTab('testing')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'testing'
              ? 'border-slate-900 text-slate-900 bg-slate-50'
              : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Trash2 className="w-4 h-4 text-slate-600" />
          <span>System Reset</span>
          <span className="px-1.5 py-0.5 bg-slate-200 text-slate-700 text-[10px] font-bold uppercase rounded">
            Danger
          </span>
        </button>

        <button
          onClick={() => setActiveTab('preferences')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'preferences'
              ? 'border-slate-900 text-slate-900 bg-slate-50'
              : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>Application Defaults</span>
        </button>

        <button
          onClick={() => setActiveTab('print')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'print'
              ? 'border-slate-900 text-slate-900 bg-slate-50'
              : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Printer className="w-4 h-4" />
          <span>Print & Documents</span>
        </button>

        <button
          onClick={() => setActiveTab('updates')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'updates'
              ? 'border-slate-900 text-slate-900 bg-slate-50'
              : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <ArrowUpCircle className="w-4 h-4" />
          <span>Updates</span>
        </button>
      </div>

      {/* Global Message Alert */}
      {backupMessage && (
        <div className={`p-3.5 rounded-xl text-xs font-medium flex items-center gap-2.5 shadow-2xs ${
          backupMessage.type === 'success' 
            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
            : 'bg-rose-50 text-rose-800 border border-rose-200'
        }`}>
          {backupMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
          <span>{backupMessage.text}</span>
        </div>
      )}

      {/* TAB 1: BRANDING & IDENTITY */}
      {activeTab === 'branding' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-slate-100 text-slate-700 rounded-lg">
                <Palette className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">Dashboard Branding & Identity</h2>
                <p className="text-xs text-slate-500">Changes update the header, navigation sidebar, case job slips, and invoices in real time</p>
              </div>
            </div>

            {saveSuccess && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold border border-emerald-200 animate-in fade-in">
                <Check className="w-3.5 h-3.5 text-emerald-600" /> Saved to Local Storage!
              </div>
            )}
          </div>

          <form onSubmit={handleSaveBranding} className="space-y-6">
            {/* Live Preview Bar */}
            <div className="p-4 bg-slate-900 rounded-xl text-white flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {brandingForm.logoUrl ? (
                  <img 
                    src={brandingForm.logoUrl} 
                    alt="Logo Preview" 
                    className="w-12 h-12 rounded-lg object-contain bg-white p-1 border border-slate-700 shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-indigo-600 text-white font-bold text-lg flex items-center justify-center shrink-0">
                    {brandingForm.appName ? brandingForm.appName.substring(0, 2).toUpperCase() : 'DS'}
                  </div>
                )}
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Live Header Preview</span>
                  <span className="text-sm font-bold text-white block">{brandingForm.appName || 'Dental Solutions'}</span>
                  <span className="text-xs text-slate-400 block">{brandingForm.tagline || 'Serving Smiles • Digital Dental Laboratory'}</span>
                </div>
              </div>

              <div className="text-right text-xs text-slate-300 font-mono hidden md:block border-l border-slate-800 pl-4">
                <p>{brandingForm.phone || '0333-0473797'}</p>
                <p className="text-[11px] text-slate-400">{brandingForm.email || 'info@dentalsolutions.pk'}</p>
              </div>
            </div>

            {/* Logo Upload Section */}
            <div className="space-y-3">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">Dashboard Logo</label>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                {brandingForm.logoUrl ? (
                  <div className="relative group">
                    <img 
                      src={brandingForm.logoUrl} 
                      alt="Current Logo" 
                      className="w-16 h-16 rounded-2xl object-contain bg-slate-50 border border-slate-200 p-1 shadow-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setBrandingForm((prev) => ({ ...prev, logoUrl: '' }))}
                      className="absolute -top-2 -right-2 w-5 h-5 bg-rose-500 text-white rounded-full text-xs font-bold flex items-center justify-center shadow-md hover:bg-rose-600 cursor-pointer"
                      title="Remove Logo"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-2xl bg-slate-100 border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 shrink-0">
                    <ImageIcon className="w-6 h-6" />
                    <span className="text-[9px] font-bold mt-1">No Logo</span>
                  </div>
                )}

                <div className="space-y-2 flex-1 w-full">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-xs"
                    >
                      <Upload className="w-4 h-4 text-indigo-400" />
                      <span>Upload Logo Image</span>
                    </button>
                  </div>

                  <div>
                    <input
                      type="text"
                      placeholder="Or enter direct Logo URL (https://...)"
                      value={brandingForm.logoUrl || ''}
                      onChange={(e) => handleBrandingChange('logoUrl', e.target.value)}
                      className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Form Inputs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Dashboard / Lab Title *</label>
                <input
                  type="text"
                  value={brandingForm.appName}
                  onChange={(e) => handleBrandingChange('appName', e.target.value)}
                  placeholder="e.g. Dental Solutions"
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500/20 font-semibold"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Tagline / Subtitle</label>
                <input
                  type="text"
                  value={brandingForm.tagline}
                  onChange={(e) => handleBrandingChange('tagline', e.target.value)}
                  placeholder="e.g. Serving Smiles • Digital Dental Laboratory"
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Official Contact Phone</label>
                <input
                  type="text"
                  value={brandingForm.phone || ''}
                  onChange={(e) => handleBrandingChange('phone', e.target.value)}
                  placeholder="e.g. 0333-0473797"
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Official Email Address</label>
                <input
                  type="email"
                  value={brandingForm.email || ''}
                  onChange={(e) => handleBrandingChange('email', e.target.value)}
                  placeholder="e.g. info@dentalsolutions.pk"
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1">Laboratory Physical Address</label>
                <input
                  type="text"
                  value={brandingForm.address || ''}
                  onChange={(e) => handleBrandingChange('address', e.target.value)}
                  placeholder="e.g. Batala Street Near Railway Park, Gill Road, Gujranwala."
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
                />
              </div>
            </div>

            {/* Bank Details for Billing Vouchers */}
            <div className="pt-4 border-t border-slate-100 space-y-3">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-indigo-600" /> Bank Details for Billing Vouchers
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Bank Name</label>
                  <input
                    type="text"
                    value={brandingForm.bankName || ''}
                    onChange={(e) => handleBrandingChange('bankName', e.target.value)}
                    placeholder="e.g. Meezan Bank Ltd"
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Account Title</label>
                  <input
                    type="text"
                    value={brandingForm.bankAccountTitle || ''}
                    onChange={(e) => handleBrandingChange('bankAccountTitle', e.target.value)}
                    placeholder="e.g. Dental Solutions Lab"
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Account Number</label>
                  <input
                    type="text"
                    value={brandingForm.bankAccountNumber || ''}
                    onChange={(e) => handleBrandingChange('bankAccountNumber', e.target.value)}
                    placeholder="e.g. 01020304050607"
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">IBAN Number</label>
                  <input
                    type="text"
                    value={brandingForm.bankIban || ''}
                    onChange={(e) => handleBrandingChange('bankIban', e.target.value)}
                    placeholder="e.g. PK36MEZN00010203..."
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Workstation Visual Warning & Div Highlighting Settings */}
            <div className="pt-6 border-t border-slate-100 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    Workstation 24-Hour Due Date Warning & Div Highlighting System
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Configure how cases approaching due dates are visually highlighted across Kanban cards and Table View rows
                  </p>
                </div>

                {/* Toggle Switch */}
                <label className="flex items-center gap-2 cursor-pointer select-none self-start sm:self-auto bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                  <input
                    type="checkbox"
                    checked={brandingForm.enable24hWarning !== false}
                    onChange={(e) => setBrandingForm((prev) => ({ ...prev, enable24hWarning: e.target.checked }))}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-slate-800">Enable 24h Red Warning</span>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Warning Threshold Hours */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Warning Threshold (Hours Before Due)
                  </label>
                  <select
                    value={brandingForm.warningThresholdHours ?? 24}
                    onChange={(e) => setBrandingForm((prev) => ({ ...prev, warningThresholdHours: Number(e.target.value) }))}
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 focus:bg-white"
                  >
                    <option value={12}>12 Hours (Urgent Same-Day)</option>
                    <option value={24}>24 Hours (Next Day Due - Standard)</option>
                    <option value={36}>36 Hours (1.5 Days)</option>
                    <option value={48}>48 Hours (2 Days Lead Time)</option>
                    <option value={72}>72 Hours (3 Days Lead Time)</option>
                  </select>
                </div>

                {/* Warning Highlight Color Theme */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Highlight Color Theme
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: 'rose', name: 'Rose Red', bg: 'bg-rose-600' },
                      { id: 'red', name: 'Crimson', bg: 'bg-red-600' },
                      { id: 'amber', name: 'Amber', bg: 'bg-amber-500' },
                      { id: 'purple', name: 'Purple', bg: 'bg-purple-600' },
                      { id: 'indigo', name: 'Indigo', bg: 'bg-indigo-600' },
                      { id: 'emerald', name: 'Emerald', bg: 'bg-emerald-600' },
                    ].map((clr) => (
                      <button
                        type="button"
                        key={clr.id}
                        onClick={() => setBrandingForm((prev) => ({ ...prev, warningHighlightColor: clr.id as any }))}
                        className={`p-2 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1.5 border cursor-pointer transition-all ${
                          (brandingForm.warningHighlightColor || 'rose') === clr.id
                            ? 'border-slate-900 ring-2 ring-slate-900/20 bg-slate-100 font-extrabold text-slate-900'
                            : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full ${clr.bg}`} />
                        <span>{clr.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Highlight Visual Style Mode */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Highlight Visual Style
                  </label>
                  <select
                    value={brandingForm.warningHighlightStyle || 'border'}
                    onChange={(e) => setBrandingForm((prev) => ({ ...prev, warningHighlightStyle: e.target.value as any }))}
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 focus:bg-white"
                  >
                    <option value="border">Border Glow + Animated Icon</option>
                    <option value="solid">Solid Banner Top Header</option>
                    <option value="badge">Pulsing Warning Tag Badge</option>
                    <option value="full">Full Highlight Background Fill</option>
                  </select>
                </div>
              </div>

              {/* Custom Div Card Background Color */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Workstation Card Background Tint
                </label>
                <div className="flex flex-wrap items-center gap-2.5">
                  {[
                    { code: '#ffffff', label: 'Pure White' },
                    { code: '#f8fafc', label: 'Soft Slate' },
                    { code: '#fefcfb', label: 'Warm Ivory' },
                    { code: '#f0f9ff', label: 'Cool Cyan' },
                    { code: '#f5f3ff', label: 'Soft Lavender' },
                  ].map((preset) => (
                    <button
                      type="button"
                      key={preset.code}
                      onClick={() => setBrandingForm((prev) => ({ ...prev, cardBgColor: preset.code }))}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 border cursor-pointer transition-all ${
                        (brandingForm.cardBgColor || '#ffffff') === preset.code
                          ? 'border-indigo-600 ring-2 ring-indigo-600/30 font-bold bg-white text-indigo-900'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span className="w-3.5 h-3.5 rounded-full border border-slate-300 shadow-xs shrink-0" style={{ backgroundColor: preset.code }} />
                      <span>{preset.label}</span>
                    </button>
                  ))}
                  <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-500 pl-2">Custom:</span>
                    <input
                      type="color"
                      value={brandingForm.cardBgColor || '#ffffff'}
                      onChange={(e) => setBrandingForm((prev) => ({ ...prev, cardBgColor: e.target.value }))}
                      className="w-7 h-7 rounded-lg cursor-pointer border-0 p-0"
                      title="Custom Color"
                    />
                  </div>
                </div>
              </div>

              {/* LIVE CARD PREVIEW IN SETTINGS */}
              <div className="mt-3 p-4 bg-slate-900 text-white rounded-2xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-300 block">
                    Live Workstation Card Highlighting Preview
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Threshold: <strong className="text-white">{brandingForm.warningThresholdHours || 24} Hours</strong>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-900">
                  {/* Normal Card Preview */}
                  <div 
                    className="rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-2"
                    style={{ backgroundColor: brandingForm.cardBgColor || '#ffffff' }}
                  >
                    <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                      <span>DS-0042 • Normal Case</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-slate-100 text-slate-600 uppercase font-semibold">Normal</span>
                    </div>
                    <p className="text-[11px] text-slate-600">Zirconia Crown (A2) • Dr. Tariq</p>
                    <p className="text-[10px] text-slate-400 font-mono">Due: 2026-08-10 (Standard Lead Time)</p>
                  </div>

                  {/* Warning Highlighted Card Preview */}
                  <div 
                    className={`rounded-2xl p-3.5 border shadow-md space-y-2 relative transition-all ${
                      (brandingForm.warningHighlightColor || 'rose') === 'rose'
                        ? 'border-rose-500 ring-2 ring-rose-500/40'
                        : (brandingForm.warningHighlightColor) === 'red'
                        ? 'border-red-600 ring-2 ring-red-600/40'
                        : (brandingForm.warningHighlightColor) === 'amber'
                        ? 'border-amber-500 ring-2 ring-amber-500/40'
                        : (brandingForm.warningHighlightColor) === 'purple'
                        ? 'border-purple-500 ring-2 ring-purple-500/40'
                        : (brandingForm.warningHighlightColor) === 'indigo'
                        ? 'border-indigo-500 ring-2 ring-indigo-500/40'
                        : 'border-emerald-500 ring-2 ring-emerald-500/40'
                    }`}
                    style={{ 
                      backgroundColor: brandingForm.warningHighlightStyle === 'full' 
                        ? ((brandingForm.warningHighlightColor || 'rose') === 'rose' ? '#fff1f2' : '#fef2f2')
                        : (brandingForm.cardBgColor || '#ffffff') 
                    }}
                  >
                    {brandingForm.warningHighlightStyle === 'solid' && (
                      <div className="bg-rose-600 text-white text-[10px] font-black px-2.5 py-1 rounded-t-xl -mx-3.5 -mt-3.5 mb-2 flex items-center justify-between">
                        <span>DUE WITHIN {brandingForm.warningThresholdHours || 24} HOURS</span>
                        <span className="uppercase text-[9px] bg-white/20 px-1.5 py-0.2 rounded">URGENT</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                      <div className="flex items-center gap-1.5">
                        <span>DS-0018 • High Priority</span>
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600 animate-bounce" />
                      </div>
                      <span className="px-2 py-0.5 rounded-md text-[9px] font-extrabold bg-rose-600 text-white uppercase shadow-xs">
                        DUE IN 8H
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-700 font-semibold">E-max Veneers (BL2) • Dr. Ayesha</p>
                    
                    <div className="flex items-center justify-between text-[11px] font-extrabold text-rose-700 pt-1.5 border-t border-rose-100">
                      <span>⏰ Due Today (Expires Soon)</span>
                      <span className="text-[10px] underline">Fast-Track QC</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg text-xs shadow-2xs transition-colors flex items-center gap-2 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Save Branding Settings</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB: MY ACCOUNT & PASSWORD */}
      {activeTab === 'account' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-slate-100 text-slate-700 rounded-lg">
                <User className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">My Account Profile & Security</h2>
                <p className="text-xs text-slate-500">Update your account display name, login username, email, or security password</p>
              </div>
            </div>
          </div>

          {accountMsg && (
            <div className={`p-3.5 rounded-2xl text-xs font-semibold flex items-center gap-2 ${
              accountMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}>
              {accountMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
              <span>{accountMsg.text}</span>
            </div>
          )}

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setAccountMsg(null);
              if (!user) return;

              // Password change logic
              if (accountForm.newPassword) {
                if (accountForm.newPassword !== accountForm.confirmPassword) {
                  setAccountMsg({ type: 'error', text: 'New passwords do not match.' });
                  return;
                }
                const res = await changePassword(user.id, accountForm.currentPassword, accountForm.newPassword);
                if (!res.success) {
                  setAccountMsg({ type: 'error', text: res.message });
                  return;
                }
              }

              updateUser(user.id, {
                name: accountForm.name,
                username: accountForm.username,
                email: accountForm.email
              });

              setAccountMsg({ type: 'success', text: 'Account settings & credentials updated successfully!' });
              setAccountForm((prev) => ({ ...prev, currentPassword: '', newPassword: '', confirmPassword: '' }));
              setTimeout(() => setAccountMsg(null), 4000);
            }}
            className="space-y-5"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Full Display Name</label>
                <input
                  type="text"
                  required
                  value={accountForm.name}
                  onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Login Username</label>
                <input
                  type="text"
                  required
                  value={accountForm.username}
                  onChange={(e) => setAccountForm({ ...accountForm, username: e.target.value })}
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={accountForm.email}
                  onChange={(e) => setAccountForm({ ...accountForm, email: e.target.value })}
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 space-y-4">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-indigo-600" /> Change Security Password
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Current Password</label>
                  <input
                    type="password"
                    placeholder="Enter current password"
                    value={accountForm.currentPassword}
                    onChange={(e) => setAccountForm({ ...accountForm, currentPassword: e.target.value })}
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">New Password</label>
                  <input
                    type="password"
                    placeholder="New password"
                    value={accountForm.newPassword}
                    onChange={(e) => setAccountForm({ ...accountForm, newPassword: e.target.value })}
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Confirm New Password</label>
                  <input
                    type="password"
                    placeholder="Confirm new password"
                    value={accountForm.confirmPassword}
                    onChange={(e) => setAccountForm({ ...accountForm, confirmPassword: e.target.value })}
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Save Profile Changes</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB: USER MANAGEMENT (ADMIN ONLY) */}
      {activeTab === 'users' && isAdmin && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">System User Accounts</h2>
                <p className="text-xs text-slate-500">Only Admins can register new laboratory personnel or manage credentials</p>
              </div>
            </div>

            <button
              onClick={() => {
                setShowAddUserModal(true);
                setUserMsg(null);
                setNewUserForm({ name: '', username: '', email: '', role: 'Technician', password: '' });
              }}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-600/20 flex items-center gap-2 cursor-pointer self-start sm:self-auto"
            >
              <UserPlus className="w-4 h-4" />
              <span>Add New User</span>
            </button>
          </div>

          {userMsg && (
            <div className={`p-3.5 rounded-2xl text-xs font-semibold flex items-center gap-2 ${
              userMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}>
              {userMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
              <span>{userMsg.text}</span>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[10px] bg-slate-50/50">
                  <th className="p-3">User & Name</th>
                  <th className="p-3">Username</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">System Role</th>
                  <th className="p-3">Joined Date</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      No additional users registered. Click "Add New User" above to create one.
                    </td>
                  </tr>
                ) : (
                  visibleUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3 font-bold text-slate-900 flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-[10px]">
                          {u.name ? u.name.substring(0, 2).toUpperCase() : 'US'}
                        </div>
                        {u.name}
                      </td>
                      <td className="p-3 font-mono font-semibold text-slate-700">{u.username}</td>
                      <td className="p-3 text-slate-600">{u.email}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          u.role === 'Lab Admin' ? 'bg-indigo-100 text-indigo-700' :
                          u.role === 'Technician' ? 'bg-amber-100 text-amber-800' :
                          'bg-emerald-100 text-emerald-800'
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="p-3 text-slate-400 text-[11px]">{u.created_at || '2026-01-01'}</td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setResetPwdUserId(u.id);
                              setResetPwdValue('');
                            }}
                            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-indigo-600 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                            title="Reset Password"
                          >
                            <Key className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline text-[11px]">Password</span>
                          </button>

                          <button
                            onClick={() => {
                              if (confirm(`Are you sure you want to remove user "${u.name}"?`)) {
                                deleteUser(u.id);
                                setUserMsg({ type: 'success', text: `User account "${u.name}" deleted.` });
                                setTimeout(() => setUserMsg(null), 4000);
                              }
                            }}
                            className="p-1.5 hover:bg-rose-50 rounded-lg text-rose-500 hover:text-rose-700 cursor-pointer"
                            title="Delete User"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: BACKUP & RESTORE */}
      {activeTab === 'backup' && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-5">
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
              <span>{storageMetrics.totalKb} KB Local Data</span>
            </span>
          </div>

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
        </div>
      )}

      {/* TAB 3: TESTING & SYSTEM RESET (DANGER ZONE) */}
      {activeTab === 'testing' && (
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
                  <p className="text-xs text-slate-500">Current live counts of database entities currently stored in local browser state</p>
                </div>
              </div>

              <span className="px-3 py-1 bg-indigo-100 text-indigo-800 font-mono text-xs font-bold rounded-full">
                Storage: {storageMetrics.totalKb} KB
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-center">
                <div className="flex items-center justify-center gap-1 text-slate-400 mb-1">
                  <FileText className="w-3.5 h-3.5" />
                </div>
                <span className="text-xl font-black text-slate-900 block">{storageMetrics.casesCount}</span>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Cases</span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-center">
                <div className="flex items-center justify-center gap-1 text-slate-400 mb-1">
                  <Building className="w-3.5 h-3.5" />
                </div>
                <span className="text-xl font-black text-slate-900 block">{storageMetrics.labsCount}</span>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Partner Labs</span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-center">
                <div className="flex items-center justify-center gap-1 text-slate-400 mb-1">
                  <DollarSign className="w-3.5 h-3.5" />
                </div>
                <span className="text-xl font-black text-slate-900 block">{storageMetrics.invoicesCount}</span>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Invoices</span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-center">
                <div className="flex items-center justify-center gap-1 text-slate-400 mb-1">
                  <BookmarkCheck className="w-3.5 h-3.5" />
                </div>
                <span className="text-xl font-black text-slate-900 block">{storageMetrics.vouchersCount}</span>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Vouchers</span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-center">
                <div className="flex items-center justify-center gap-1 text-slate-400 mb-1">
                  <CheckSquare className="w-3.5 h-3.5" />
                </div>
                <span className="text-xl font-black text-slate-900 block">{storageMetrics.catalogCount}</span>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Catalog Items</span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-center">
                <div className="flex items-center justify-center gap-1 text-slate-400 mb-1">
                  <Paperclip className="w-3.5 h-3.5" />
                </div>
                <span className="text-xl font-black text-slate-900 block">{storageMetrics.attachmentsCount}</span>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Attachments</span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-center">
                <div className="flex items-center justify-center gap-1 text-slate-400 mb-1">
                  <FileText className="w-3.5 h-3.5" />
                </div>
                <span className="text-xl font-black text-slate-900 block">{storageMetrics.notesCount}</span>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Case Notes</span>
              </div>
            </div>
          </div>

          {/* Software Testing Actions Panel */}
          <div className="bg-white rounded-3xl border border-rose-200 shadow-sm p-6 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-rose-100">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-rose-100 text-rose-600 rounded-2xl">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Option 1: Reset to Demo Data */}
              <div className="p-6 bg-slate-50 border border-amber-200 rounded-3xl space-y-4 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-amber-700 font-extrabold text-xs uppercase tracking-wider">
                    <RefreshCw className="w-4 h-4 text-amber-600" /> Factory Demo Reset
                  </div>
                  <h3 className="font-bold text-slate-900 text-base">Reset to Standard Demo State</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Restores baseline initial demo data (sample cases, partner labs, standard catalog prices, and demo billing invoices). Use this if you want to restore standard demo content.
                  </p>
                </div>

                <button
                  onClick={handleResetDemo}
                  className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Restore Factory Demo State</span>
                </button>
              </div>

              {/* Option 2: Complete System Data Wipe / Delete Everything */}
              <div className="p-6 bg-rose-50/80 border border-rose-300 rounded-3xl space-y-4 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-rose-700 font-extrabold text-xs uppercase tracking-wider">
                    <Trash2 className="w-4 h-4 text-rose-600" /> Complete System Purge
                  </div>
                  <h3 className="font-bold text-slate-900 text-base">DELETE EVERYTHING (Wipe All Data)</h3>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    <strong>For Software Testing:</strong> Instantly deletes ALL cases, invoices, vouchers, partner labs, notes, attachments, and cached local storage. Leaves a 100% blank slate.
                  </p>
                </div>

                <button
                  onClick={() => setShowWipeModal(true)}
                  className="w-full py-3 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-lg shadow-rose-600/30 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>RESET / DELETE EVERYTHING</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: APPLICATION PREFERENCES */}
      {activeTab === 'preferences' && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl">
                <Sliders className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Application Defaults & System Preferences</h2>
                <p className="text-xs text-slate-500">Configure global currency, default turnaround times, and notification thresholds</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Billing Currency</label>
              <select
                value={userPreferences?.currency || 'PKR'}
                onChange={(e) => updateUserPreferences({ currency: e.target.value })}
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold"
              >
                <option value="PKR">Pakistani Rupee (PKR - ₨)</option>
                <option value="USD">US Dollar (USD - $)</option>
                <option value="EUR">Euro (EUR - €)</option>
                <option value="GBP">British Pound (GBP - £)</option>
                <option value="AED">UAE Dirham (AED)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Default Turnaround Time (Days)</label>
              <input
                type="number"
                min="1"
                max="30"
                value={userPreferences?.default_turnaround_days || 5}
                onChange={(e) => updateUserPreferences({ default_turnaround_days: Number(e.target.value) })}
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Default Priority for New Cases</label>
              <select
                value={userPreferences?.default_priority || 'normal'}
                onChange={(e) => updateUserPreferences({ default_priority: e.target.value as any })}
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold capitalize"
              >
                <option value="low">Low Priority</option>
                <option value="normal">Normal Priority</option>
                <option value="rush">Rush Priority</option>
                <option value="urgent">Urgent Priority</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Auto-Save Voucher Log</label>
              <select
                value={userPreferences?.auto_print_job_slips ? 'true' : 'false'}
                onChange={(e) => updateUserPreferences({ auto_print_job_slips: e.target.value === 'true' })}
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold"
              >
                <option value="true">Enabled (Auto-log to voucher registry on print)</option>
                <option value="false">Disabled (Manual prompt only)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL FOR TOTAL SYSTEM DATA WIPE */}
      {showWipeModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 border border-slate-200 shadow-2xl space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-rose-100 text-rose-600 rounded-2xl">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">Confirm Total Data Wipe</h3>
                  <p className="text-xs text-rose-600 font-bold uppercase tracking-wider">Software Testing Action</p>
                </div>
              </div>

              <button
                onClick={() => {
                  setShowWipeModal(false);
                  setWipeConfirmText('');
                }}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl space-y-2 text-xs text-rose-900">
              <p className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
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
                Type <span className="font-mono text-rose-600 font-black">DELETE</span> below to confirm:
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
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <Trash2 className="w-4 h-4" /> Permanently Delete All Data
              </button>
            </div>
          </div>
        </div>
      )}
      {/* MODAL: ADD NEW USER */}
      {showAddUserModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 border border-slate-200 shadow-2xl space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">Add New System User</h3>
                  <p className="text-xs text-slate-500">Create login credentials for new staff member</p>
                </div>
              </div>

              <button
                onClick={() => setShowAddUserModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newUserForm.username.trim() || !newUserForm.name.trim() || !newUserForm.password) {
                  return;
                }
                if (users.some((u) => u.username.toLowerCase() === newUserForm.username.trim().toLowerCase())) {
                  alert('Username already exists. Please choose a different username.');
                  return;
                }

                addUser({
                  name: newUserForm.name.trim(),
                  username: newUserForm.username.trim().toLowerCase(),
                  email: newUserForm.email.trim() || `${newUserForm.username.trim().toLowerCase()}@dentalsolutions.pk`,
                  role: newUserForm.role,
                  password: newUserForm.password
                });

                setShowAddUserModal(false);
                setUserMsg({ type: 'success', text: `User "${newUserForm.name}" created successfully!` });
                setTimeout(() => setUserMsg(null), 4000);
              }}
              className="space-y-4 text-xs"
            >
              <div>
                <label className="block font-bold text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Usman Tech"
                  value={newUserForm.name}
                  onChange={(e) => setNewUserForm({ ...newUserForm, name: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Login Username *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. usman"
                  value={newUserForm.username}
                  onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Email Address</label>
                <input
                  type="email"
                  placeholder="e.g. usman@dentalsolutions.pk"
                  value={newUserForm.email}
                  onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">System Role *</label>
                <select
                  value={newUserForm.role}
                  onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value as any })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                >
                  <option value="Lab Admin">Lab Admin (Full Access)</option>
                  <option value="Technician">Technician (Lab Works & Cases)</option>
                  <option value="Billing Manager">Billing Manager (Invoices & Vouchers)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Account Password *</label>
                <input
                  type="password"
                  required
                  placeholder="Set initial password"
                  value={newUserForm.password}
                  onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md shadow-indigo-600/20 cursor-pointer flex items-center gap-1.5"
                >
                  <UserPlus className="w-4 h-4" /> Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RESET USER PASSWORD */}
      {resetPwdUserId && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 border border-slate-200 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-indigo-600" />
                <h3 className="font-extrabold text-slate-900 text-sm">Reset Password</h3>
              </div>
              <button onClick={() => setResetPwdUserId(null)} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Set a new password for account <strong className="text-slate-900 font-mono">{users.find((u) => u.id === resetPwdUserId)?.username}</strong>:
            </p>

            <input
              type="password"
              placeholder="Enter new password"
              value={resetPwdValue}
              onChange={(e) => setResetPwdValue(e.target.value)}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white"
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setResetPwdUserId(null)}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!resetPwdValue}
                onClick={() => {
                  updateUser(resetPwdUserId, { password: resetPwdValue });
                  setResetPwdUserId(null);
                  setUserMsg({ type: 'success', text: 'User password reset successfully!' });
                  setTimeout(() => setUserMsg(null), 4000);
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer"
              >
                Update Password
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'print' && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-5">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
            <div className="p-2.5 bg-slate-100 text-slate-600 rounded-2xl">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Print &amp; Documents</h2>
              <p className="text-xs text-slate-500">Global defaults for every printed invoice, job slip, receipt and statement. Per-document sections live in the Print Studio module.</p>
            </div>
          </div>

          <form onSubmit={handleSavePrintSettings} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Paper Size</label>
                <select
                  value={printSettingsForm.paper}
                  onChange={(e) => setPrintSettingsForm((p) => ({ ...p, paper: e.target.value as PrintSettings['paper'] }))}
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold"
                >
                  <option value="a4">A4 (210 × 297 mm)</option>
                  <option value="letter">US Letter (8.5 × 11 in)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Page Margins</label>
                <select
                  value={printSettingsForm.margin}
                  onChange={(e) => setPrintSettingsForm((p) => ({ ...p, margin: e.target.value as PrintSettings['margin'] }))}
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold"
                >
                  <option value="narrow">Narrow (8 mm)</option>
                  <option value="normal">Normal (12 mm)</option>
                  <option value="wide">Wide (18 mm)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Text Size</label>
                <select
                  value={printSettingsForm.fontSize}
                  onChange={(e) => setPrintSettingsForm((p) => ({ ...p, fontSize: e.target.value as PrintSettings['fontSize'] }))}
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold"
                >
                  <option value="compact">Compact</option>
                  <option value="normal">Normal</option>
                  <option value="large">Large</option>
                </select>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 space-y-4">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Logo on Printed Documents</h3>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={printSettingsForm.showLogo}
                  onChange={(e) => setPrintSettingsForm((p) => ({ ...p, showLogo: e.target.checked }))}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <span className="text-xs font-bold text-slate-800">Print the lab logo on documents</span>
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Logo Position</label>
                  <select
                    value={printSettingsForm.logoPosition}
                    disabled={!printSettingsForm.showLogo}
                    onChange={(e) => setPrintSettingsForm((p) => ({ ...p, logoPosition: e.target.value as PrintSettings['logoPosition'] }))}
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold disabled:opacity-50"
                  >
                    <option value="left">Left (letterhead style)</option>
                    <option value="center">Centered above name</option>
                    <option value="right">Right</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <p className="text-[11px] text-slate-500">Upload or replace the logo itself in Branding &amp; Identity. Documents preview live in Print Studio.</p>
                </div>
                {printSettingsForm.logoPosition === 'right' && (
                  <p className="md:col-span-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    Right placement mirrors the letterhead — logo right, contact block moves left.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer"
              >
                Save Print Settings
              </button>
              {printSaved && (
                <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Saved — applies to all documents
                </span>
              )}
            </div>
          </form>
        </div>
      )}

      {activeTab === 'updates' && (
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
      )}
    </div>
  );
};
