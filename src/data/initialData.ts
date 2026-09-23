import { 
  DentalCase, 
  DentalLab, 
  CaseType, 
  Invoice, 
  AppNotification, 
  CaseTemplate, 
  LabContact, 
  LabAddress, 
  LabPricingOverride, 
  LabReview, 
  DoctorPreferredLab, 
  NotificationConfig, 
  EmailTemplate, 
  UserPreferences,
  AdvancePayment,
  AccountAdjustment,
  JournalEntry,
  AuditEvent,
  ReconciliationItem,
  UserProfile
} from '../types';

// Standard Production Dental Laboratory Case Types & Material Catalog
export const INITIAL_CASE_TYPES: CaseType[] = [
  { id: 'ct-1', name: 'Zirconia Crown', base_price: 15000, description: 'High translucent monolithic zirconia crown', created_at: '2026-01-01' },
  { id: 'ct-2', name: 'PFM Crown', base_price: 9500, description: 'Porcelain fused to metal crown with precision alloy margin', created_at: '2026-01-01' },
  { id: 'ct-3', name: 'E-max Veneer', base_price: 18000, description: 'Lithium disilicate ceramic veneer for anterior aesthetics', created_at: '2026-01-01' },
  { id: 'ct-4', name: 'Acrylic Denture (Complete)', base_price: 25000, description: 'High-impact acrylic full denture set', created_at: '2026-01-01' },
  { id: 'ct-5', name: 'Metal Crown (Cast)', base_price: 7000, description: 'Non-precious cast metal crown', created_at: '2026-01-01' },
  { id: 'ct-6', name: 'Implant Abutment & Crown', base_price: 32000, description: 'Custom titanium abutment + zirconia implant crown', created_at: '2026-01-01' },
  { id: 'ct-7', name: 'Zirconia Bridge (3-Unit)', base_price: 42000, description: '3-unit posterior multi-layered zirconia bridge', created_at: '2026-01-01' },
  { id: 'ct-8', name: 'Composite Inlay/Onlay', base_price: 11000, description: 'Indirect lab composite restoration', created_at: '2026-01-01' },
];

// Production Clean State: Empty Seeded Data for fresh operational deployment
export const INITIAL_LABS: DentalLab[] = [];
export const INITIAL_LAB_CONTACTS: LabContact[] = [];
export const INITIAL_LAB_ADDRESSES: LabAddress[] = [];
export const INITIAL_PRICING_OVERRIDES: LabPricingOverride[] = [];
export const INITIAL_LAB_REVIEWS: LabReview[] = [];
export const INITIAL_DOCTOR_PREFERENCES: DoctorPreferredLab[] = [];
export const INITIAL_CASES: DentalCase[] = [];
export const INITIAL_INVOICES: Invoice[] = [];
export const INITIAL_ADVANCE_PAYMENTS: AdvancePayment[] = [];
export const INITIAL_ADJUSTMENTS: AccountAdjustment[] = [];
export const INITIAL_NOTIFICATIONS: AppNotification[] = [];
export const INITIAL_TEMPLATES: CaseTemplate[] = [];
export const INITIAL_JOURNAL_ENTRIES: JournalEntry[] = [];
export const INITIAL_AUDIT_EVENTS: AuditEvent[] = [];
export const INITIAL_RECONCILIATION_ITEMS: ReconciliationItem[] = [];

export const INITIAL_NOTIFICATION_CONFIG: NotificationConfig = {
  overdue_frequencies: ['1_day_before', 'on_due_date', '1_day_after', '3_days_after', '7_days_after'],
  payment_frequencies: ['1_day_before', 'on_due_date', '3_days_after', '7_days_after', '14_days_after'],
  enable_escalation: true,
  escalation_threshold_days: 7,
  recurring_interval: 'daily',
};

export const INITIAL_EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'et-1',
    key: 'overdue_case',
    name: 'Overdue Case Reminder',
    subject: 'Action Required: Dental Case {{case_number}} is Overdue',
    body_text: 'Dear {{doctor_name}},\n\nThis is a notification from Dental Solutions regarding case {{case_number}} for {{lab_name}}. The scheduled delivery date was {{delivery_date}}. Our technicians are actively finalizing this case.\n\nPlease contact our case coordinator for immediate dispatch details.',
    button_text: 'View Case Status',
    logo_url: '',
    color_scheme: '#2563eb',
    footer_text: 'Dental Solutions • Precision Dental Laboratory Management System',
    updated_at: '2026-01-01',
  },
  {
    id: 'et-2',
    key: 'pending_payment',
    name: 'Pending Payment Reminder',
    subject: 'Payment Reminder: Invoice {{invoice_number}} for {{lab_name}}',
    body_text: 'Dear {{lab_name}},\n\nWe kindly remind you that payment for invoice {{invoice_number}} (Amount: PKR {{final_amount}}) is due on {{due_date}}.\n\nPlease process payment via bank transfer or cheque.',
    button_text: 'Pay / View Invoice',
    logo_url: '',
    color_scheme: '#059669',
    footer_text: 'Dental Solutions • Billing Department',
    updated_at: '2026-01-01',
  },
  {
    id: 'et-3',
    key: 'escalation',
    name: 'Escalation Alert',
    subject: 'ESCALATION ALERT: High Priority Case {{case_number}} Requires Immediate Review',
    body_text: 'ATTENTION LAB MANAGEMENT:\n\nCase {{case_number}} (Priority: URGENT) has exceeded the escalation threshold. Immediate supervisor intervention is required.',
    button_text: 'Open Escalation Workspace',
    logo_url: '',
    color_scheme: '#dc2626',
    footer_text: 'Dental Solutions • Automated Safety Protocol',
    updated_at: '2026-01-01',
  },
  {
    id: 'et-4',
    key: 'payment_received',
    name: 'Payment Received Confirmation',
    subject: 'Receipt: Payment Confirmed for Invoice {{invoice_number}}',
    body_text: 'Dear {{lab_name}},\n\nThank you! We have received your payment of PKR {{amount_paid}} for invoice {{invoice_number}}.\n\nYour account has been updated.',
    button_text: 'Download Receipt',
    logo_url: '',
    color_scheme: '#0d9488',
    footer_text: 'Dental Solutions • Accounts Receivable',
    updated_at: '2026-01-01',
  }
];

export const INITIAL_USER_PREFERENCES: UserPreferences = {
  channels: ['in_app', 'email'],
  frequency: 'real_time',
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  enabled_types: ['overdue_case', 'pending_payment', 'escalation', 'status_change'],
  unsubscribed_all: false,
};

/**
 * No demo/bootstrap users ship with this build.
 *
 * Earlier revisions seeded demo accounts (adil / Zeeshan / hamza / Sana) into
 * fresh installs via the legacy localStorage fallback; the legacy migrator
 * then carried them into SQLite. Fresh profiles now start with an EMPTY users
 * table — the login screen's first-run setup provisions the operator's own
 * Super Admin, and the hidden service account is seeded by `serviceAccount.ts`.
 * Kept as an empty password-free shape so legacy import code still typechecks.
 */
export const INITIAL_USERS: UserProfile[] = [];

