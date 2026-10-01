import { notificationConfigRepo, emailTemplatesRepo } from '../db/repos';
import { INITIAL_NOTIFICATION_CONFIG, INITIAL_EMAIL_TEMPLATES } from '../data/initialData';
import type { EmailTemplate, NotificationConfig } from '../types';

/**
 * D1 — the single reader/writer for reminder settings.
 *
 * Both the Settings → Notifications tab and the app's reminder sweeps go
 * through here, so the cadence the admin ticks is exactly the cadence the
 * sweeping code reads (no second interpretation, no render-scope snapshot).
 * Every accessor is failure-tolerant: a missing table or unparsable row falls
 * back to the shipped defaults instead of taking the app down on boot.
 */

const TEMPLATE_KEYS: EmailTemplate['key'][] = ['overdue_case', 'pending_payment', 'escalation', 'payment_received'];

export const REMINDER_KINDS = [
  { id: 'overdue_cases' as const, label: 'Overdue cases', configKey: 'overdue_frequencies' as const },
  { id: 'pending_payment' as const, label: 'Outstanding invoices', configKey: 'payment_frequencies' as const },
];

export const CADENCE_OPTIONS = [
  { id: '1_day_before', label: '1 day before' },
  { id: 'on_due_date', label: 'On the due date' },
  { id: '1_day_after', label: '1 day after' },
  { id: '3_days_after', label: '3 days after' },
  { id: '7_days_after', label: '7 days after' },
  { id: '14_days_after', label: '14 days after' },
];

export const RECURRING_INTERVALS: { id: NotificationConfig['recurring_interval']; label: string }[] = [
  { id: 'daily', label: 'Every day' },
  { id: 'every_3_days', label: 'Every 3 days' },
  { id: 'weekly', label: 'Every week' },
];

/** Reminder config, defaults included. */
export function loadNotificationConfig(): NotificationConfig {
  try {
    const stored = notificationConfigRepo.get() as NotificationConfig | undefined;
    if (!stored || typeof stored !== 'object') return { ...INITIAL_NOTIFICATION_CONFIG };
    return {
      ...INITIAL_NOTIFICATION_CONFIG,
      ...stored,
      overdue_frequencies: Array.isArray(stored.overdue_frequencies)
        ? stored.overdue_frequencies
        : INITIAL_NOTIFICATION_CONFIG.overdue_frequencies,
      payment_frequencies: Array.isArray(stored.payment_frequencies)
        ? stored.payment_frequencies
        : INITIAL_NOTIFICATION_CONFIG.payment_frequencies,
    };
  } catch {
    return { ...INITIAL_NOTIFICATION_CONFIG };
  }
}

export function saveNotificationConfig(config: NotificationConfig): void {
  notificationConfigRepo.set(config);
}

/**
 * The Settings tab announces a cadence change on this event so the app's
 * reminder sweeps re-run immediately instead of waiting for the next
 * case/invoice edit to happen to trigger them.
 */
export const NOTIFICATION_CONFIG_CHANGED = 'dental:notification-config-changed';

export function announceNotificationConfigChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTIFICATION_CONFIG_CHANGED));
}

/**
 * The cadence a sweep should apply for a reminder kind, or `undefined` when it
 * has nothing to apply (which the builders read as "legacy: remind about every
 * item"). An empty list is deliberately treated as "no cadence" rather than
 * "never remind", so a half-edited config can never silence a sweep.
 */
export function readNotificationCadence(kind: 'overdue_cases' | 'pending_payment' = 'overdue_cases'): string[] | undefined {
  const config = loadNotificationConfig();
  const list = kind === 'pending_payment' ? config.payment_frequencies : config.overdue_frequencies;
  return Array.isArray(list) && list.length > 0 ? list : undefined;
}

/** Every template row, backfilled with any shipped template the DB is missing. */
export function loadEmailTemplates(): EmailTemplate[] {
  let stored: EmailTemplate[] = [];
  try {
    stored = (emailTemplatesRepo.all() as EmailTemplate[]) || [];
  } catch {
    stored = [];
  }
  const byKey = new Map(stored.map((t) => [t.key, t]));
  // A key can exist in the DB without the newest shipped columns; the shipped
  // row is the fallback for every field the stored row left empty.
  return TEMPLATE_KEYS.map((key) => {
    const shipped = INITIAL_EMAIL_TEMPLATES.find((t) => t.key === key)!;
    const row = byKey.get(key);
    return row ? { ...shipped, ...row } : { ...shipped };
  });
}

export function saveEmailTemplate(template: EmailTemplate): void {
  emailTemplatesRepo.upsert({ ...template, updated_at: new Date().toISOString() });
}

/** Restore one template to the shipped default (used by "Reset"). */
export function resetEmailTemplate(key: EmailTemplate['key']): EmailTemplate {
  const shipped = INITIAL_EMAIL_TEMPLATES.find((t) => t.key === key)!;
  const restored = { ...shipped, updated_at: new Date().toISOString() };
  emailTemplatesRepo.upsert(restored);
  return restored;
}

/**
 * Fill `{{placeholder}}` tokens with sample values so the editor can show a
 * real-looking letter offline. Unknown tokens are left visible on purpose —
 * an unresolved token should look unresolved, not silently vanish.
 */
export function renderTemplatePreview(text: string, values: Record<string, string>): string {
  return (text || '').replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : value;
  });
}
