import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { GlassSelect } from '../common/ui/GlassSelect';
import { auditRepo } from '../../db/repos';
import { Sliders, LayoutGrid, Lock, LockOpen, Save, Trash2, Play, RotateCcw, Sun, Moon, Monitor } from 'lucide-react';
import { isThemeMode, type ThemeMode } from '../../theme/theme';
import { useDashboardLayout, type DashboardDensity } from '../../components/dashboard/useDashboardLayout';
import { PANEL_KEYS } from '../../components/dashboard/panelRegistry';
import { setGroqKey, clearGroqKey, groqKeyPresent, groqEnabled } from '../../services/voiceGroq';
import { listMemories, clearMemories } from '../../services/voiceMemory';


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
/** Theme choices shown as a three-way segmented control, not a select: the
    point of the control is that 'System' is a peer of Light and Dark, and a
    dropdown hides that it is the default. */
const THEME_OPTIONS: { value: ThemeMode; label: string; hint: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'light', label: 'Light', hint: 'Always light, regardless of the device setting.', Icon: Sun },
  { value: 'dark', label: 'Dark', hint: 'Always dark. Easier in a dim surgery or lab bay.', Icon: Moon },
  { value: 'system', label: 'System', hint: 'Follows this device\u2019s appearance, and switches with it.', Icon: Monitor },
];

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
        <GlassSelect
          value={userPreferences?.dashboard_density || 'default'}
          onChange={(v) => updateUserPreferences({ dashboard_density: v as DashboardDensity })}
          ariaLabel="Dashboard density"
          className="w-full p-2.5 text-xs font-bold"
          options={DENSITY_OPTIONS.map((d) => ({ value: d.value, label: d.label }))}
        />
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
          className={`ds-tap shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white cursor-pointer ${activeCustom ? 'bg-slate-700 hover:bg-slate-800' : 'bg-fill-success hover:bg-emerald-700'}`}
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
            className="ds-tap inline-flex items-center gap-1.5 px-3 py-2 ds-glass-pill text-xs font-bold cursor-pointer"
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
                    className="text-ink-muted hover:text-indigo-600 cursor-pointer p-1 rounded-lg"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { layout.deleteNamed(n); setError(null); }}
                    title={`Delete layout "${n}"`}
                    className="text-ink-muted hover:text-ink-danger cursor-pointer p-1 rounded-lg"
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
const VoiceExtras: React.FC<{
  voiceUri?: string;
  onVoiceUri: (uri: string) => void;
}> = ({ voiceUri, onVoiceUri }) => {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [memoryCount, setMemoryCount] = useState(() => listMemories().length);
  const uk = groqKeyPresent();
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">System voice</label>
      <GlassSelect
        value={voiceUri || ''}
        onChange={onVoiceUri}
        ariaLabel="System voice"
        className="mt-1 w-full p-2 text-xs font-bold"
        options={[
          { value: '', label: 'Use system default' },
          ...voices.slice(0, 40).map((v) => ({ value: v.voiceURI, label: `${v.name} (${v.lang})` })),
        ]}
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <div>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Local memory (learns from us)</span>
          <span className="text-[10px] text-slate-400">{memoryCount} redacted Q/A pairs stored on this device. Never sent to Groq.</span>
        </div>
        <button type="button" onClick={() => { clearMemories(); setMemoryCount(0); }} className="rounded-lg border border-slate-300 px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100">Clear memory</button>
      </div>
      {uk && <p className="mt-2 text-[10px] font-semibold text-emerald-700">Groq routing ON — memory digest is included (redacted) so routing stays consistent.</p>}
    </div>
  );
};

const GroqKeyControl: React.FC = () => {
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<string>('');
  const present = groqKeyPresent();
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Groq API key (optional)</label>
          <p className="mt-0.5 text-[10px] text-slate-400">Stored locally only; never committed or shipped in the installer. Removing it disables Groq immediately.</p>
        </div>
        <span className={`text-[10px] font-bold ${groqEnabled() ? 'text-emerald-600' : 'text-slate-400'}`}>
          {groqEnabled() ? 'GROQ ON' : 'GROQ OFF'}
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={present ? 'Key saved — enter a new key to replace' : 'gsk_…'}
          autoComplete="off"
          aria-label="Groq API key"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
        />
        <button
          type="button"
          onClick={() => {
            if (!key.trim()) return;
            setGroqKey(key);
            setKey('');
            setStatus('Saved. Groq routing enabled.');
            window.setTimeout(() => setStatus(''), 1500);
          }}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            clearGroqKey();
            setKey('');
            setStatus('Cleared. Offline answers only.');
            window.setTimeout(() => setStatus(''), 1500);
          }}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100"
        >
          Clear
        </button>
      </div>
      {status && <p className="mt-1.5 text-[10px] font-semibold text-emerald-700">{status}</p>}
    </div>
  );
};

export const PreferencesTab: React.FC = () => {
  const { user, userPreferences, updateUserPreferences } = useApp();
  const themeMode: ThemeMode = isThemeMode(userPreferences?.theme_mode) ? userPreferences.theme_mode : 'system';

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Application Defaults & System Preferences</h2>
            <p className="text-xs text-slate-500">Default turnaround times, new-case defaults and notification thresholds</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
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
          <GlassSelect
            value={userPreferences?.default_priority || 'normal'}
            onChange={(v) => updateUserPreferences({ default_priority: v as any })}
            ariaLabel="Default priority"
            className="w-full p-2.5 text-xs font-bold capitalize"
            options={[
              { value: 'low', label: 'Low Priority' },
              { value: 'normal', label: 'Normal Priority' },
              { value: 'rush', label: 'Rush Priority' },
              { value: 'urgent', label: 'Urgent Priority' },
            ]}
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">Interface Zoom</label>
          <GlassSelect
            value={String(userPreferences?.ui_zoom || 1)}
            onChange={(v) => updateUserPreferences({ ui_zoom: Number(v) })}
            ariaLabel="Interface zoom"
            className="w-full p-2.5 text-xs font-bold"
            options={[
              { value: '0.85', label: 'Smaller (85%)' },
              { value: '1', label: 'Default (100%)' },
              { value: '1.1', label: 'Larger (110%)' },
              { value: '1.25', label: 'Largest (125%)' },
            ]}
          />
          <p className="text-[11px] text-slate-500 mt-1">Applies to the whole interface instantly; printed documents are never scaled.</p>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">Theme</label>
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-50 border border-slate-200 rounded-xl">
            {THEME_OPTIONS.map(({ value, label, Icon }) => {
              const active = themeMode === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => updateUserPreferences({ theme_mode: value })}
                  className={[
                    'ds-tap inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer',
                    active
                      ? 'bg-white text-indigo-700 shadow-2xs ring-1 ring-slate-200'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60',
                  ].join(' ')}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {THEME_OPTIONS.find((t) => t.value === themeMode)?.hint}
          </p>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">Auto-Save Voucher Log</label>
          <GlassSelect
            value={userPreferences?.auto_print_job_slips ? 'true' : 'false'}
            onChange={(v) => updateUserPreferences({ auto_print_job_slips: v === 'true' })}
            ariaLabel="Auto-print job slips"
            className="w-full p-2.5 text-xs font-bold"
            options={[
              { value: 'true', label: 'Enabled (Auto-log to voucher registry on print)' },
              { value: 'false', label: 'Disabled (Manual prompt only)' },
            ]}
          />
        </div>

        {/* Professional settings */}
        <div className="md:col-span-2 pt-4 border-t border-slate-100">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">Professional Settings</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Date Format</label>
              <GlassSelect
                value={userPreferences?.date_format || 'DD/MM/YYYY'}
                onChange={(v) => updateUserPreferences({ date_format: v as any })}
                ariaLabel="Date format"
                className="w-full p-2.5 text-xs font-bold"
                options={[
                  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/12/2026)' },
                  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (12/31/2026)' },
                  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2026-12-31)' },
                ]}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Number Format</label>
              <GlassSelect
                value={userPreferences?.number_format || '1,000.00'}
                onChange={(v) => updateUserPreferences({ number_format: v as any })}
                ariaLabel="Number format"
                className="w-full p-2.5 text-xs font-bold"
                options={[
                  { value: '1,000.00', label: '1,000.00 (comma thousands, dot decimal)' },
                  { value: '1.000,00', label: '1.000,00 (dot thousands, comma decimal)' },
                ]}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Time Zone</label>
              <GlassSelect
                value={userPreferences?.time_zone || 'local'}
                onChange={(v) => updateUserPreferences({ time_zone: v })}
                ariaLabel="Time zone"
                className="w-full p-2.5 text-xs font-bold"
                options={[
                  { value: 'local', label: 'Local (device time zone)' },
                  { value: 'Asia/Karachi', label: 'Asia/Karachi (PKT, UTC+5)' },
                  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST, UTC+4)' },
                  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
                  { value: 'America/New_York', label: 'America/New_York (EST/EDT)' },
                  { value: 'UTC', label: 'UTC' },
                ]}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Auto-Backup Interval</label>
              <GlassSelect
                value={String(userPreferences?.auto_backup_interval_min ?? 0)}
                onChange={(v) => updateUserPreferences({ auto_backup_interval_min: Number(v) })}
                ariaLabel="Auto-backup interval"
                className="w-full p-2.5 text-xs font-bold"
                options={[
                  { value: '0', label: 'Off (manual only)' },
                  { value: '15', label: 'Every 15 minutes' },
                  { value: '30', label: 'Every 30 minutes' },
                  { value: '60', label: 'Every hour' },
                  { value: '1440', label: 'Daily' },
                ]}
              />
            </div>
          </div>
        </div>

        <DashboardLayoutCard />

        {/* Voice Assistant — OFF by default; Groq remains an opt-in channel
            wired in a later phase (docs/VOICE_ASSISTANT.md). */}
        <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Voice Assistant</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Offline speech output; speech input and Groq routing arrive in later phases.</p>
            </div>
            <GlassSelect
              value={userPreferences?.voice_enabled ? 'true' : 'false'}
              onChange={(v) => updateUserPreferences({ voice_enabled: v === 'true' })}
              ariaLabel="Voice assistant enabled"
              className="w-44 p-2 text-xs font-bold"
              options={[
                { value: 'false', label: 'Off (default)' },
                { value: 'true', label: 'On' },
              ]}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Locale</label>
              <GlassSelect
                value={userPreferences?.voice_locale || 'en-PK'}
                onChange={(v) => updateUserPreferences({ voice_locale: v })}
                ariaLabel="Voice locale"
                className="w-full p-2 text-xs font-bold"
                options={[
                  { value: 'en-PK', label: 'English (Pakistan)' },
                  { value: 'en-US', label: 'English (US)' },
                  { value: 'en-GB', label: 'English (UK)' },
                ]}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Speech rate</label>
              <GlassSelect
                value={String(userPreferences?.voice_tts_rate ?? 1)}
                onChange={(v) => updateUserPreferences({ voice_tts_rate: Number(v) })}
                ariaLabel="Speech rate"
                className="w-full p-2 text-xs font-bold"
                options={[
                  { value: '0.75', label: 'Slow' },
                  { value: '1', label: 'Normal' },
                  { value: '1.25', label: 'Fast' },
                ]}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Confirmation</label>
              <GlassSelect
                value={userPreferences?.voice_confirmation_mode || 'writes-only'}
                onChange={(v) => updateUserPreferences({ voice_confirmation_mode: v as 'always' | 'writes-only' | 'off' })}
                ariaLabel="Voice confirmation mode"
                className="w-full p-2 text-xs font-bold"
                options={[
                  { value: 'always', label: 'Always confirm' },
                  { value: 'writes-only', label: 'Confirm writes only' },
                  { value: 'off', label: 'Off' },
                ]}
              />
            </div>
          </div>
          {user?.isSuperAdmin === true && (
            <GlassSelect
              value={userPreferences?.voice_read_clinical_detail ? 'true' : 'false'}
              onChange={(v) => updateUserPreferences({ voice_read_clinical_detail: v === 'true' })}
              ariaLabel="Read clinical detail aloud"
              className="w-full p-2 text-xs font-bold border border-amber-200"
              options={[
                { value: 'false', label: 'Never read clinical detail aloud (default)' },
                { value: 'true', label: 'Super Admin: read clinical detail (teeth / shade / procedure)' },
              ]}
            />
          )}
          <GroqKeyControl />
          <GlassSelect
            value={userPreferences?.voice_cloud_transcription ? 'true' : 'false'}
            onChange={(v) => updateUserPreferences({ voice_cloud_transcription: v === 'true' })}
            ariaLabel="Cloud microphone (Groq Whisper)"
            className="w-full p-2 text-xs font-bold border border-dashed border-indigo-200"
            options={[
              { value: 'false', label: 'Built-in mic (Chrome/Edge online) — default' },
              { value: 'true', label: 'Cloud microphone — Groq Whisper (audio is sent to Groq; needs key; off by default)' },
            ]}
          />
          <VoiceExtras voiceUri={userPreferences?.voice_tts_voice_uri} onVoiceUri={(v) => updateUserPreferences({ voice_tts_voice_uri: v || undefined })} />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">Auto-Archive Delivered Cases</label>
          <GlassSelect
            value={userPreferences?.auto_archive_completed_cases === false ? 'false' : 'true'}
            onChange={(v) => updateUserPreferences({ auto_archive_completed_cases: v === 'true' })}
            ariaLabel="Auto-archive completed cases"
            className="w-full p-2.5 text-xs font-bold"
            options={[
              { value: 'true', label: 'Enabled (Archive delivered cases older than 30 days on startup)' },
              { value: 'false', label: 'Disabled (Cases stay in the workstation until archived manually)' },
            ]}
          />
        </div>
      </div>

    </div>
  );
};
