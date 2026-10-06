import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { auditRepo } from '../../db/repos';
import { canManageSystem } from '../../services/permissions';
import { ConfirmDialog } from '../common/ui';
import { Sliders, ShieldCheck, LayoutGrid, Lock, LockOpen, Save, Trash2, Play, RotateCcw } from 'lucide-react';
import { useDashboardLayout, type DashboardDensity } from '../../components/dashboard/useDashboardLayout';
import { PANEL_KEYS } from '../../components/dashboard/panelRegistry';

/** The surfaces a currency change actually repaints — D6 requires the dialog to
    name them, so the admin confirms against real screens rather than a label. */
const CURRENCY_SURFACES = [
  'Every invoice, receipt and statement of account',
  'The payments register and general ledger ledger amounts',
  'Billing reports, vouchers and the dashboard totals',
  'New invoice and payment-entry forms (default currency)',
];

/**
 * Dashboard layout preferences (Settings-owned keys).
 *
 * Density and the unlock switch live in UserPreferences; the layout registry is
 * owned by `useDashboardLayout`, and this card drives it through that hook
 * rather than re-implementing the registry over the raw repo blob. Two
 * hand-rolled copies of the read-modify-write is exactly how a saved layout
 * ended up being deleted by the next preference change.
 *
 * The unlock switch writes `dashboard_layout_id`: 'default' = locked (drag
 * disabled), anything else = unlocked for arranging.
 */
const DENSITY_OPTIONS: { value: DashboardDensity; label: string; hint: string }[] = [
  { value: 'compact', label: 'Compact', hint: 'Tighter padding, smaller type — more panels above the fold' },
  { value: 'default', label: 'Default', hint: 'The standard dashboard density' },
  { value: 'roomy', label: 'Roomy', hint: 'Wider padding, larger type — easier reading, more scrolling' },
];

const DashboardLayoutCard: React.FC = () => {
  const { user, userPreferences, updateUserPreferences } = useApp();
  const userId = user?.id;
  const layout = useDashboardLayout(userId, PANEL_KEYS);
  // The lock is a UserPreferences field and lives in context state. It used to
  // be read back from the repo under a dotted `dashboard.layoutId` key that
  // nothing ever wrote, so the toggle re-rendered its "Locked" copy forever:
  // the click DID unlock (dashboard_layout_id changed), the label just never
  // saw it. Read the same field we write.
  const activeId = userPreferences?.dashboard_layout_id ?? 'default';
  const activeCustom = activeId !== 'default';

  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // The lock lives in UserPreferences and goes through context — writing the
  // repo directly here would be reverted by the settings domain's next merged
  // write, which only preserves the three dashboard.* keys it knows about.
  const toggleLock = () => {
    const next = activeCustom ? 'default' : 'custom';
    updateUserPreferences({ dashboard_layout_id: next });
    try { auditRepo.log({ actor: user?.name || 'Unknown', action: 'update', entity_type: 'settings', entity_id: 'dashboard_layout', entity_ref: 'Dashboard layout lock', notes: next === 'custom' ? 'Panel drag-and-drop unlocked' : 'Panel drag-and-drop locked', old_state: { layout: activeId }, new_state: { layout: next } }); } catch { /* audit is best-effort */ }
    setError(null);
  };

  const density = (userPreferences?.dashboard_density ?? 'default') as DashboardDensity;

  const saveLayout = () => {
    setError(null);
    const name = newName.trim();
    if (!name) { setError('Give the layout a name first.'); return; }
    if (name === 'default') { setError('"default" is reserved for the built-in layout.'); return; }
    if (layout.layouts[name]) { setError(`"${name}" already exists — apply it or pick another name.`); return; }
    if (!layout.saveNamed(name, density)) { setError('Sign in to save a layout.'); return; }
    // Activation goes through context (see toggleLock — direct repo writes of
    // this key get reverted by the next settings-domain merge).
    updateUserPreferences({ dashboard_layout_id: name });
    setNewName('');
  };

  /**
   * Switch the dashboard to a saved arrangement.
   *
   * Density is part of the snapshot, so applying a layout that was saved
   * "compact" restores compact too — otherwise the layout half-applies and the
   * user sees panels in an order they did not choose. The dashboard reads
   * density from UserPreferences, which is why it has to be written there.
   */
  const applyLayout = (name: string) => {
    const applied = layout.applyNamed(name);
    if (applied === null) { setError(`"${name}" could not be applied.`); return; }
    updateUserPreferences({ dashboard_layout_id: name, dashboard_density: applied });
    setError(null);
  };

  /** Back to the built-in canonical order and no manual arrangement. */
  const applyDefault = () => {
    layout.applyNamed('default');
    updateUserPreferences({ dashboard_layout_id: 'default' });
    setError(null);
  };

  const names = Object.keys(layout.layouts).sort((a, b) => a.localeCompare(b));

  return (
    <div className="p-6 bg-white border border-slate-200 rounded-2xl space-y-4">
      <div className="flex items-center gap-2 text-slate-900 font-bold text-sm uppercase tracking-wider">
        <LayoutGrid className="w-4 h-4 text-indigo-600" /> Dashboard Layouts
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Save the current panel arrangement under a name, apply it again later,
        and choose panel density. Unlocking drag-and-drop lets panels be dragged
        into a manual order on the dashboard; the choice is saved per user.
      </p>

      {/* Density */}
      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1">Panel density</label>
        <select
          value={userPreferences?.dashboard_density || 'default'}
          onChange={(e) => updateUserPreferences({ dashboard_density: e.target.value as DashboardDensity })}
          className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold"
        >
          {DENSITY_OPTIONS.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-slate-500">{DENSITY_OPTIONS.find((d) => d.value === (userPreferences?.dashboard_density || 'default'))?.hint}</p>
      </div>

      {/* Lock toggle */}
      <div className="flex items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
        <div className="min-w-0">
          <span className="text-xs font-bold text-slate-800 block">Drag-and-drop panel reordering</span>
          <span className="text-[11px] text-slate-500">{activeCustom ? 'Unlocked — drag panels by their cards on the dashboard.' : 'Locked — unlock to drag panels into a manual order.'}</span>
        </div>
        <button
          type="button"
          onClick={toggleLock}
          className={`ds-tap shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white cursor-pointer ${activeCustom ? 'bg-slate-700 hover:bg-slate-800' : 'bg-emerald-600 hover:bg-emerald-700'}`}
        >
          {activeCustom ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
          {activeCustom ? 'Freeze arrangement' : 'Unlock arranging'}
        </button>
      </div>

      {/* Named layouts */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => { setNewName(e.target.value); setError(null); }}
            placeholder="Layout name (e.g. Morning review)"
            className="flex-1 p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-semibold"
          />
          <button
            type="button"
            onClick={saveLayout}
            className="ds-tap inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" /> Save current
          </button>
        </div>
        {error && <p className="text-[11px] font-semibold text-rose-700">{error}</p>}
        {names.length > 0 && (
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
            {names.map((n) => (
              <li key={n} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className={`text-xs font-bold truncate ${activeId === n ? 'text-indigo-700' : 'text-slate-800'}`}>
                  {n}
                  {activeId === n && <span className="ml-1.5 text-[10px] font-semibold text-indigo-500">active</span>}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => applyLayout(n)}
                    title={`Apply layout "${n}"`}
                    className="text-slate-400 hover:text-indigo-600 cursor-pointer p-1 rounded-lg"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { layout.deleteNamed(n); setError(null); }}
                    title={`Delete layout "${n}"`}
                    className="text-slate-400 hover:text-rose-600 cursor-pointer p-1 rounded-lg"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={applyDefault}
          disabled={activeId === 'default'}
          className="ds-tap inline-flex items-center gap-1.5 px-3 py-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Use built-in order
        </button>
      </div>
    </div>
  );
};

/** TAB: APPLICATION PREFERENCES — extracted verbatim from SettingsView (P3 split). */
export const PreferencesTab: React.FC = () => {
  const { user, userPreferences, updateUserPreferences } = useApp();
  // D6 — the billing currency is a lab-wide consequence, so it follows the
  // admin-only system actions rather than the per-user preference switches.
  const mayChangeCurrency = canManageSystem(user, 'currency:edit');
  const [pendingCurrency, setPendingCurrency] = useState<string | null>(null);
  const currentCurrency = userPreferences?.currency || 'PKR';

  const applyCurrency = () => {
    if (!pendingCurrency) return;
    const from = currentCurrency;
    updateUserPreferences({ currency: pendingCurrency });
    try {
      auditRepo.log({
        actor: user?.name || 'Unknown',
        action: 'update',
        entity_type: 'settings',
        entity_id: 'currency',
        entity_ref: 'Billing currency',
        notes: `Billing currency changed from ${from} to ${pendingCurrency}`,
        old_state: { currency: from },
        new_state: { currency: pendingCurrency },
      });
    } catch { /* audit is best-effort: never block a preference save */ }
    setPendingCurrency(null);
  };

  return (
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
            value={currentCurrency}
            disabled={!mayChangeCurrency}
            onChange={(e) => setPendingCurrency(e.target.value)}
            className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <option value="PKR">Pakistani Rupee (PKR - ₨)</option>
            <option value="USD">US Dollar (USD - $)</option>
            <option value="EUR">Euro (EUR - €)</option>
            <option value="GBP">British Pound (GBP - £)</option>
            <option value="AED">UAE Dirham (AED)</option>
          </select>
          {!mayChangeCurrency ? (
            <p className="mt-1 text-[11px] text-amber-700 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              Admin only — changing the billing currency repaints money on every screen.
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-slate-500">
              Changing this asks for confirmation first and is written to the audit trail.
            </p>
          )}
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
          <label className="block text-xs font-bold text-slate-700 mb-1">Interface Zoom</label>
          <select
            value={String(userPreferences?.ui_zoom || 1)}
            onChange={(e) => updateUserPreferences({ ui_zoom: Number(e.target.value) })}
            className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold"
          >
            <option value="0.85">Smaller (85%)</option>
            <option value="1">Default (100%)</option>
            <option value="1.1">Larger (110%)</option>
            <option value="1.25">Largest (125%)</option>
          </select>
          <p className="text-[11px] text-slate-500 mt-1">Applies to the whole interface instantly; printed documents are never scaled.</p>
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

        <DashboardLayoutCard />

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">Auto-Archive Delivered Cases</label>
          <select
            value={userPreferences?.auto_archive_completed_cases === false ? 'false' : 'true'}
            onChange={(e) => updateUserPreferences({ auto_archive_completed_cases: e.target.value === 'true' })}
            className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold"
          >
            <option value="true">Enabled (Archive delivered cases older than 30 days on startup)</option>
            <option value="false">Disabled (Cases stay in the workstation until archived manually)</option>
          </select>
        </div>
      </div>

      <ConfirmDialog
        open={pendingCurrency !== null}
        title={`Change billing currency to ${pendingCurrency ?? ''}?`}
        tone="indigo"
        consequences={CURRENCY_SURFACES}
        confirmLabel="Change currency"
        onConfirm={applyCurrency}
        onCancel={() => setPendingCurrency(null)}
      >
        <p className="text-xs text-slate-500">
          Recorded amounts keep their stored values; only how they are displayed changes. This
          change is logged against your account.
        </p>
      </ConfirmDialog>
    </div>
  );
};
