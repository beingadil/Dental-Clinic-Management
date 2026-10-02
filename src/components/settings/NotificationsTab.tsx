import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { getTodayStr } from '../../utils/dateUtils';
import { auditRepo } from '../../db/repos';
import type { EmailTemplate, NotificationConfig } from '../../types';
import {
  loadNotificationConfig,
  saveNotificationConfig,
  loadEmailTemplates,
  saveEmailTemplate,
  resetEmailTemplate,
  renderTemplatePreview,
  announceNotificationConfigChanged,
  CADENCE_OPTIONS,
  RECURRING_INTERVALS,
} from '../../services/notificationSettings';
import { canManageSystem } from '../../services/permissions';
import { resolveBrandSwatch } from '../../services/brandingTheme';
import { PreviewFrame } from '../common/ui';
import { Bell, Mail, Check, RotateCcw, Copy, ShieldCheck } from 'lucide-react';

/**
 * TAB: NOTIFICATIONS & TEMPLATES (D1).
 *
 * The two halves of the reminder feature that previously had no reader:
 * the cadence stored in `notification_config` (now honoured by the app's
 * overdue/unpaid sweeps) and the four `email_templates` rows.
 *
 * Delivery is deliberately offline — this app runs on a lab workstation with
 * no mail server — so a template can be rendered and copied for sending from
 * the lab's own mailbox. Nothing here claims to send mail.
 */
export const NotificationsTab: React.FC = () => {
  const { user, brandingSettings, updateUserPreferences, userPreferences } = useApp();
  const canEdit = canManageSystem(user, 'notifications:edit');

  const [config, setConfig] = useState<NotificationConfig>(() => loadNotificationConfig());
  const [templates, setTemplates] = useState<EmailTemplate[]>(() => loadEmailTemplates());
  const [activeKey, setActiveKey] = useState<EmailTemplate['key']>('overdue_case');
  const [savedNote, setSavedNote] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const active = templates.find((t) => t.key === activeKey) || templates[0];
  const accent = resolveBrandSwatch(brandingSettings?.primaryColor);

  const sampleValues = useMemo(() => {
    const today = getTodayStr();
    return {
      lab_name: brandingSettings?.lab_name || brandingSettings?.appName || 'Dental Solutions',
      app_name: brandingSettings?.appName || 'Dental Solutions',
      case_number: 'DS-0042',
      doctor_name: 'Dr. Ayesha Khan',
      delivery_date: today,
      invoice_number: 'INV-2026-0042',
      final_amount: '48,500',
      due_date: today,
      escalation_days: String(config.escalation_threshold_days || 7),
    };
  }, [brandingSettings?.lab_name, brandingSettings?.appName, config.escalation_threshold_days]);

  const flash = (text: string, type: 'success' | 'error' = 'success') => {
    setSavedNote({ type, text });
    setTimeout(() => setSavedNote(null), 3500);
  };

  const toggleFrequency = (key: 'overdue_frequencies' | 'payment_frequencies', id: string) => {
    setConfig((prev) => {
      const list = prev[key] || [];
      const next = list.includes(id) ? list.filter((f) => f !== id) : [...list, id];
      return { ...prev, [key]: next };
    });
  };

  const handleSaveConfig = () => {
    if (!canEdit) return;
    const before = loadNotificationConfig();
    saveNotificationConfig(config);
    try {
      auditRepo.log({
        actor: user?.name || 'Unknown',
        action: 'update',
        entity_type: 'notification_settings',
        entity_id: 'notification_config',
        entity_ref: 'Reminder cadence',
        notes: 'Reminder cadence and escalation updated',
        old_state: before,
        new_state: config,
      });
    } catch { /* audit is best-effort: never block a settings save */ }
    announceNotificationConfigChanged();
    flash('Reminder cadence saved — the app re-reads it immediately.');
  };

  const handleSaveTemplate = () => {
    if (!canEdit || !active) return;
    const before = active;
    saveEmailTemplate(active);
    try {
      auditRepo.log({
        actor: user?.name || 'Unknown',
        action: 'update',
        entity_type: 'email_template',
        entity_id: active.key,
        entity_ref: active.name,
        notes: `Template "${active.name}" updated`,
        old_state: before,
        new_state: active,
      });
    } catch { /* best-effort */ }
    setTemplates(loadEmailTemplates());
    flash(`Template "${active.name}" saved.`);
  };

  const handleResetTemplate = () => {
    if (!canEdit || !active) return;
    const restored = resetEmailTemplate(active.key);
    setTemplates(loadEmailTemplates());
    flash(`"${restored.name}" restored to the shipped default.`);
  };

  const handleCopy = async () => {
    if (!active) return;
    const text = [
      `Subject: ${renderTemplatePreview(active.subject, sampleValues)}`,
      '',
      renderTemplatePreview(active.body_text, sampleValues),
      '',
      active.button_text ? `[${active.button_text}]` : '',
      active.footer_text || '',
    ].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      flash('Rendered message copied — paste it into your mail client.');
    } catch {
      flash('Clipboard unavailable; select the preview text and copy manually.', 'error');
    }
  };

  const patchActive = (patch: Partial<EmailTemplate>) => {
    setTemplates((prev) => prev.map((t) => (t.key === activeKey ? { ...t, ...patch } : t)));
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-brand-50 text-brand-600 rounded-2xl">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Reminder Cadence</h2>
              <p className="text-xs text-slate-500">
                When the app raises overdue-case and outstanding-invoice reminders. Saving applies
                immediately — the next sweep reads this config, not a copy.
              </p>
            </div>
          </div>
          {savedNote && (
            <span
              role="status"
              className={`text-[11px] font-bold flex items-center gap-1 shrink-0 ${
                savedNote.type === 'success' ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              <Check className="w-3.5 h-3.5" /> {savedNote.text}
            </span>
          )}
        </div>

        {!canEdit && (
          <p className="flex items-center gap-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            Read-only — changing reminder settings requires an admin account.
          </p>
        )}

        {([
          { key: 'overdue_frequencies' as const, label: 'Overdue cases', help: 'Reminders for cases past their promised delivery date.' },
          { key: 'payment_frequencies' as const, label: 'Outstanding invoices', help: 'Reminders for invoices at or past their due date.' },
        ]).map((group) => (
          <div key={group.key} className="space-y-2">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">{group.label}</h3>
            <p className="text-[11px] text-slate-500">{group.help}</p>
            <div className="flex flex-wrap gap-1.5">
              {CADENCE_OPTIONS.map((option) => {
                const on = (config[group.key] || []).includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={on}
                    disabled={!canEdit}
                    onClick={() => toggleFrequency(group.key, option.id)}
                    className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                      on
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
          <label className="flex items-center gap-2 cursor-pointer select-none self-end pb-1">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={config.enable_escalation}
              onChange={(e) => setConfig((prev) => ({ ...prev, enable_escalation: e.target.checked }))}
              className="w-4 h-4 rounded text-brand-600 focus:ring-brand-600/40 cursor-pointer"
            />
            <span className="text-xs font-bold text-slate-800">Escalate unresolved reminders</span>
          </label>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Escalate after (days unpaid)</label>
            <input
              type="number"
              min={1}
              max={90}
              disabled={!canEdit || !config.enable_escalation}
              value={config.escalation_threshold_days || 7}
              onChange={(e) => setConfig((prev) => ({ ...prev, escalation_threshold_days: Math.max(1, Number(e.target.value) || 1) }))}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Repeat interval</label>
            <select
              disabled={!canEdit}
              value={config.recurring_interval}
              onChange={(e) => setConfig((prev) => ({ ...prev, recurring_interval: e.target.value as NotificationConfig['recurring_interval'] }))}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold disabled:opacity-50"
            >
              {RECURRING_INTERVALS.map((i) => (
                <option key={i.id} value={i.id}>{i.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            disabled={!canEdit}
            onClick={handleSaveConfig}
            className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save Reminder Cadence
          </button>
          <p className="text-[11px] text-slate-500">
            Nothing is ever left out: once an item runs past the last ticked reminder it keeps
            reminding, so a receivable can never silently drop off the tray.
          </p>
        </div>
      </div>

      {/* ── Templates ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-5">
        <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100">
          <div className="p-2.5 bg-slate-100 text-slate-600 rounded-2xl">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Message Templates</h2>
            <p className="text-xs text-slate-500">
              The wording behind each reminder. Placeholders like {'{{case_number}}'} are filled
              from the real record; the preview below uses a live sample.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {templates.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={t.key === activeKey}
              onClick={() => setActiveKey(t.key)}
              className={`rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                t.key === activeKey
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>

        {active && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Template name</label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={active.name}
                  onChange={(e) => patchActive({ name: e.target.value })}
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Subject line</label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={active.subject}
                  onChange={(e) => patchActive({ subject: e.target.value })}
                  className="w-full p-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Body</label>
                <textarea
                  rows={9}
                  disabled={!canEdit}
                  value={active.body_text}
                  onChange={(e) => patchActive({ body_text: e.target.value })}
                  className="w-full p-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl leading-relaxed disabled:opacity-60"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Button label</label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={active.button_text}
                    onChange={(e) => patchActive({ button_text: e.target.value })}
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Footer</label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={active.footer_text}
                    onChange={(e) => patchActive({ footer_text: e.target.value })}
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl disabled:opacity-60"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={handleSaveTemplate}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save Template
                </button>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={handleResetTemplate}
                  className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Reset to default
                </button>
              </div>
            </div>

            <PreviewFrame
              label="Template preview"
              artefact="statement"
              hint={`Accent: ${accent.name}`}
              bodyClassName="p-4 bg-slate-50"
              actions={
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <Copy className="w-3 h-3" /> Copy message
                </button>
              }
            >
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100" style={{ backgroundColor: accent.tokens['50'] }}>
                  <p className="text-xs font-bold" style={{ color: accent.tokens['700'] }}>
                    {renderTemplatePreview(active.subject, sampleValues)}
                  </p>
                </div>
                <div className="px-4 py-4 space-y-3">
                  <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {renderTemplatePreview(active.body_text, sampleValues)}
                  </p>
                  {active.button_text && (
                    <span
                      className="inline-block rounded-lg px-3.5 py-2 text-xs font-bold text-white"
                      style={{ backgroundColor: accent.tokens['600'] }}
                    >
                      {active.button_text}
                    </span>
                  )}
                  {active.footer_text && (
                    <p className="text-[11px] text-slate-500 border-t border-slate-100 pt-2">
                      {active.footer_text}
                    </p>
                  )}
                </div>
              </div>
              <p className="mt-3 text-[11px] text-slate-500">
                Sample data — the real values come from the case or invoice being reminded about.
                Delivery is manual by design: this workstation has no mail server, so a rendered
                message is copied out for sending.
              </p>
            </PreviewFrame>
          </div>
        )}
      </div>

      {/* Preferences hand-off: the per-user notification switches live in
          Application Defaults; this keeps them discoverable from here. */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6">
        <h2 className="text-base font-bold text-slate-900">My Notification Preferences</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Channel and quiet hours are per user, so they stay on your account rather than the lab's.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Delivery channel</label>
            <select
              value={(userPreferences?.channels || ['in_app']).includes('email') ? 'email' : 'in_app'}
              onChange={(e) => updateUserPreferences({ channels: [e.target.value as 'in_app' | 'email'] })}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold"
            >
              <option value="in_app">In-app tray only</option>
              <option value="email">In-app tray + email draft</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Frequency</label>
            <select
              value={userPreferences?.frequency || 'real_time'}
              onChange={(e) => updateUserPreferences({ frequency: e.target.value as 'real_time' | 'daily_digest' | 'weekly_digest' })}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold"
            >
              <option value="real_time">Real time</option>
              <option value="daily_digest">Daily digest</option>
              <option value="weekly_digest">Weekly digest</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
