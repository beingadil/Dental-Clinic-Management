import { BrandingSettings, UserPreferences } from '../types';

/**
 * First-login bootstrap accounts. The DATABASE NEVER STORES these values —
 * seeds.ts hashes them with PBKDF2 at first boot. They are documented default
 * credentials (like router admin pages) and MUST be changed on first login by
 * each account (Settings → My Account & Security).
 */
export const BOOTSTRAP_USERS = [
  {
    id: 'u-super',
    username: 'adil',
    email: 'adil@dentalsolutions.pk',
    name: 'Adil (Super Admin)',
    role: 'Super Admin',
    password: 'adil123',
    isSuperAdmin: true,
    created_at: '2026-01-01',
  },
  {
    id: 'u-1',
    username: 'admin',
    email: 'admin@dentalsolutions.pk',
    name: 'Dr. Zeeshan (Admin)',
    role: 'Lab Admin',
    password: 'admin123',
    isSuperAdmin: false,
    created_at: '2026-01-01',
  },
  {
    id: 'u-2',
    username: 'hamza',
    email: 'hamza@dentalsolutions.pk',
    name: 'Hamza Tech',
    role: 'Technician',
    password: 'tech123',
    isSuperAdmin: false,
    created_at: '2026-01-01',
  },
  {
    id: 'u-3',
    username: 'billing',
    email: 'billing@dentalsolutions.pk',
    name: 'Sana Billing',
    role: 'Billing Manager',
    password: 'bill123',
    isSuperAdmin: false,
    created_at: '2026-01-01',
  },
] as const;

/**
 * Dependency-free defaults shared by the DB layer (seeds, legacy migrator).
 * Mirrors the values exported by sqliteDbService so the UI never sees a
 * different default — but avoids importing the legacy localStorage service
 * (which touches window.localStorage at module load and breaks tests/SSR).
 */

export const DEFAULT_BRANDING_SETTINGS: BrandingSettings = {
  appName: 'Dental Solutions',
  tagline: 'Serving Smiles • Digital Dental Laboratory',
  logoUrl: '',
  primaryColor: '#4f46e5',
  phone: '0333-0473797',
  address: 'Batala Street Near Railway Park, Gill Road, Gujranwala.',
  email: 'info@dentalsolutions.pk',
  facebook: 'Dental Solutions',
  bankName: 'Meezan Bank Ltd',
  bankAccountTitle: 'Dental Solutions Lab',
  bankAccountNumber: '01020304050607',
  bankIban: 'PK36MEZN0001020304050607',
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
