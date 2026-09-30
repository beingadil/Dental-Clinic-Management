import React from 'react';
import { useApp } from '../../context/AppContext';
import { Sliders } from 'lucide-react';

/** TAB: APPLICATION PREFERENCES — extracted verbatim from SettingsView (P3 split). */
export const PreferencesTab: React.FC = () => {
  const { userPreferences, updateUserPreferences } = useApp();

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
          <p className="text-[11px] text-slate-400 mt-1">Applies to the whole interface instantly; printed documents are never scaled.</p>
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
    </div>
  );
};
