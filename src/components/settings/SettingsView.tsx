import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { initBackupScheduler } from '../../services/backupScheduler';
import { getDatabase } from '../../db';
import {
  Settings,
  ShieldCheck,
  Database,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Palette,
  Trash2,
  Sliders,
  User,
  Users,
  Printer,
  ArrowUpCircle,
  Bell,
} from 'lucide-react';
import { TabsNav } from '../common/ui';
import { canManageSystem, type SystemAction } from '../../services/permissions';
import { BrandingTab } from './BrandingTab';
import { AccountTab } from './AccountTab';
import { UsersTab } from './UsersTab';
import { BackupTab } from './BackupTab';
import { TestingTab } from './TestingTab';
import { PreferencesTab } from './PreferencesTab';
import { PrintTab } from './PrintTab';
import { UpdatesTab } from './UpdatesTab';
import { NotificationsTab } from './NotificationsTab';

/** Settings container (P3 split): header, tabs, shared backupMessage +
    liveTableStats; each tab lives in its own file. */
export const SettingsView: React.FC = () => {
  const { user } = useApp();
  const isAdmin = user?.role === 'Lab Admin' || user?.role === 'Super Admin' || user?.isSuperAdmin;
  // F2: tab visibility now FOLLOWS the permission matrix. canManageSystem is
  // the single owner of "may this role touch this area"; every guarded tab
  // re-checks at its action sites too (hiding is not enforcement).
  const may = (a: SystemAction) => canManageSystem(user, a) || (isAdmin && a !== 'users:manage');

  const [activeTab, setActiveTab] = useState<'branding' | 'account' | 'users' | 'backup' | 'testing' | 'preferences' | 'print' | 'updates' | 'notifications'>('branding');
  const [backupMessage, setBackupMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    initBackupScheduler();
  }, []);

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

  // D9 — one registry drives both the wide-screen rail and the narrow-screen
  // segmented control, so a permission change can never hide a tab in one
  // layout while leaving it reachable in the other.
  const tabDefs = [
    { id: 'branding', label: 'Branding & Identity', icon: Palette, group: 'Identity & Print', allowed: may('branding:edit') },
    { id: 'print', label: 'Print & Documents', icon: Printer, group: 'Identity & Print', allowed: may('print:edit') },
    { id: 'notifications', label: 'Notifications & Templates', icon: Bell, group: 'Identity & Print', allowed: true },
    { id: 'account', label: 'My Account & Security', icon: User, group: 'Account & Access', allowed: true },
    { id: 'users', label: 'User Management', icon: Users, group: 'Account & Access', allowed: may('users:manage') },
    { id: 'preferences', label: 'Application Defaults', icon: Sliders, group: 'Account & Access', allowed: true },
    { id: 'backup', label: 'Database & Backup', icon: Database, group: 'Data & System', allowed: may('backup:restore') },
    { id: 'testing', label: 'System Reset', icon: Trash2, group: 'Data & System', allowed: may('data:wipe') },
    { id: 'updates', label: 'Updates', icon: ArrowUpCircle, group: 'Data & System', allowed: true },
  ] as const;
  const visibleTabs = tabDefs.filter((t) => t.allowed);
  const tabGroups = visibleTabs.reduce<Record<string, { id: string; label: string; icon: typeof Palette }[]>>((acc, t) => {
    (acc[t.group] = acc[t.group] || []).push(t);
    return acc;
  }, {});

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
          <span>SQLite Database: <strong className="text-slate-900 font-mono">{liveTableStats.reduce((a, t) => a + t.rows, 0).toLocaleString()} rows</strong></span>
        </div>
      </div>

      {/* Identity card — one honest glassmorphic card, real role only */}
      <div className="bg-white/70 backdrop-blur-md border border-white/60 rounded-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_8px_24px_-12px_rgba(15,23,42,0.12)] p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white font-bold text-lg flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
            {user?.name ? user.name.charAt(0).toUpperCase() : 'D'}
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-sm">{user?.name || 'My Account'}</h3>
            <p className="text-xs text-slate-500">{user?.email || 'Not set'}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 bg-white/60 text-slate-700 px-3.5 py-1.5 rounded-full text-xs font-semibold border border-white/80 self-start md:self-auto">
          <ShieldCheck className={`w-4 h-4 ${isAdmin ? 'text-indigo-600' : 'text-ink-muted'}`} />
          <span>Role: <strong className="text-slate-900">{user?.role || '—'}</strong></span>
        </div>
      </div>

      {/* D9 — grouped rail at 1280px and up, segmented control below that. */}
      <div className="xl:grid xl:grid-cols-[240px_minmax(0,1fr)] xl:gap-6 xl:items-start">
        <nav
          aria-label="Settings sections"
          className="hidden xl:block xl:sticky xl:top-6 bg-white rounded-2xl border border-slate-200 shadow-2xs p-3"
        >
          {Object.entries(tabGroups).map(([group, tabs]) => (
            <div key={group} className="mb-3 last:mb-0">
              <p className="px-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-500">
                {group}
              </p>
              <ul className="space-y-0.5">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  const active = activeTab === tab.id;
                  return (
                    <li key={tab.id}>
                      <button
                        type="button"
                        onClick={() => setActiveTab(tab.id as typeof activeTab)}
                        aria-current={active ? 'page' : undefined}
                        className={`w-full flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left text-xs font-semibold transition-colors cursor-pointer ${
                          active
                            ? 'bg-brand-50 text-brand-700 border-brand-200'
                            : 'text-slate-600 border-transparent hover:bg-slate-50'
                        }`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-brand-600' : 'text-ink-muted'}`} />
                        <span className="truncate">{tab.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-6">
          <div className="xl:hidden">
            <TabsNav
              activeTab={activeTab}
              onChange={(t) => setActiveTab(t)}
              variant="pills"
              tabs={visibleTabs.map(({ id, label, icon }) => ({ id, label, icon }))}
            />
          </div>

      {/* Global Message Alert */}
      {backupMessage && (
        <div className={`p-3.5 rounded-xl text-xs font-medium flex items-center gap-2.5 shadow-2xs ${
          backupMessage.type === 'success' 
            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
            : 'bg-rose-50 text-rose-800 border border-rose-200'
        }`}>
          {backupMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-ink-success shrink-0" /> : <AlertCircle className="w-4 h-4 text-ink-danger shrink-0" />}
          <span>{backupMessage.text}</span>
        </div>
      )}

      {activeTab === 'branding' && may('branding:edit') && <BrandingTab />}
      {activeTab === 'account' && <AccountTab />}
      {activeTab === 'users' && may('users:manage') && <UsersTab />}
      {activeTab === 'backup' && may('backup:restore') && (
        <BackupTab
          backupMessage={backupMessage}
          setBackupMessage={setBackupMessage}
        />
      )}
      {activeTab === 'testing' && may('data:wipe') && <TestingTab />}
      {activeTab === 'preferences' && <PreferencesTab />}
      {activeTab === 'print' && may('print:edit') && <PrintTab />}
      {activeTab === 'updates' && <UpdatesTab />}
      {activeTab === 'notifications' && <NotificationsTab />}
        </div>
      </div>
    </div>
  );
};
