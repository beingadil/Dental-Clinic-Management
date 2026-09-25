import { BrandingSettings, UserPreferences } from '../types';

/**
 * No bootstrap accounts ship with this build.
 *
 * Earlier revisions exported a `BOOTSTRAP_USERS` array containing documented
 * plaintext passwords (`███████`, `███████`, …). Those credentials are gone:
 * a fresh profile starts with an EMPTY users table and the login screen runs
 * its first-run setup (`createInitialAdmin`) to provision a Super Admin with a
 * password the operator chooses. Demo/documented credentials must never be
 * reintroduced here.
 */

/**
 * Dependency-free defaults shared by the DB layer (seeds, legacy migrator).
 * Mirrors the values exported by sqliteDbService so the UI never sees a
 * different default — but avoids importing the legacy localStorage service
 * (which touches window.localStorage at module load and breaks tests/SSR).
 */

/**
 * Fresh installs start with EMPTY identity fields — the operator enters their
 * own lab name, contacts and bank details in Settings → Branding. Print
 * documents and UI surfaces must treat blank fields gracefully (fallbacks or
 * "not configured" hints), never ship this build's real lab identity.
 * `primaryColor` and the warning toggles are product defaults, not identity.
 */
export const DEFAULT_BRANDING_SETTINGS: BrandingSettings = {
  appName: '',
  tagline: '',
  logoUrl: '',
  logoUrl2: '',
  primaryColor: '#4f46e5',
  phone: '',
  address: '',
  email: '',
  facebook: '',
  bankName: '',
  bankAccountTitle: '',
  bankAccountNumber: '',
  bankIban: '',
  enable24hWarning: true,
  warningThresholdHours: 24,
  warningHighlightColor: 'rose',
  warningHighlightStyle: 'border',
  cardBgColor: '#ffffff',
};

export const DEFAULT_USER_PREFS: UserPreferences = {
  channels: ['in_app', 'email'],
  frequency: 'real_time',
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  enabled_types: ['overdue_case', 'pending_payment', 'escalation', 'status_change'],
  unsubscribed_all: false,
  currency: 'PKR',
  default_turnaround_days: 3,
  default_priority: 'normal',
  auto_print_job_slips: false,
};
