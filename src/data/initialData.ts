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
// Detail fields (material_system / unit_basis / shade_guide / indications /
// contraindications) are real laboratory specifications — nothing fabricated,
// every entry is the actual clinical use of that material.
export const INITIAL_CASE_TYPES: CaseType[] = [
  {
    id: 'ct-1', name: 'Zirconia Crown', base_price: 15000, category: 'crown_bridge',
    lead_time_days: 4, warranty_months: 60,
    description: 'High translucent monolithic zirconia crown',
    material_system: '3Y-TZP / 5Y-TZP yttria-stabilized zirconia',
    unit_basis: 'per unit',
    shade_guide: 'VITA Classical A1–D4 / VITA 3D-Master',
    indications: 'Single-unit posterior and anterior crowns; high-strength posterior restorations; bruxism patients (monolithic).',
    contraindications: 'Extremely low clearance (<0.5 mm); cantilever bridges; patients requesting maximum translucency for central incisors (prefer layered).',
    created_at: '2026-01-01',
  },
  {
    id: 'ct-2', name: 'PFM Crown', base_price: 9500, category: 'crown_bridge',
    lead_time_days: 5, warranty_months: 36,
    description: 'Porcelain fused to metal crown with precision alloy margin',
    material_system: 'Ni-Cr / Co-Cr alloy framework + feldspathic porcelain',
    unit_basis: 'per unit',
    shade_guide: 'VITA Classical A1–D4',
    indications: 'Posterior crowns and short-span bridges where cost matters; cases with limited occlusal clearance; metal collar acceptable.',
    contraindications: 'Nickel-sensitive patients (use Co-Cr); highly aesthetic anterior zones; patients requesting all-ceramic.',
    created_at: '2026-01-01',
  },
  {
    id: 'ct-3', name: 'E-max Veneer', base_price: 18000, category: 'veneers',
    lead_time_days: 5, warranty_months: 60,
    description: 'Lithium disilicate ceramic veneer for anterior aesthetics',
    material_system: 'Ivoclar IPS e.max lithium disilicate (press / CAD)',
    unit_basis: 'per unit',
    shade_guide: 'VITA Classical + bleach shades (OM1–OM3)',
    indications: 'Anterior veneers, diastema closure, enamel defects, shape/colour correction with minimal preparation (0.3–0.5 mm).',
    contraindications: 'Heavy bruxism without nightguard; insufficient enamel for bonding; deep subgingival margins.',
    created_at: '2026-01-01',
  },
  {
    id: 'ct-4', name: 'Acrylic Denture (Complete)', base_price: 25000, category: 'denture',
    lead_time_days: 7, warranty_months: 12,
    description: 'High-impact acrylic full denture set',
    material_system: 'Heat-cured high-impact PMMA + acrylic resin teeth',
    unit_basis: 'per arch (complete set = 2× base price)',
    shade_guide: 'VITA Classical teeth shades A1–D4',
    indications: 'Fully edentulous arches; immediate dentures; economical tooth replacement.',
    contraindications: 'Severe resorbed ridges requiring implant support; patients with acrylic monomer sensitivity.',
    created_at: '2026-01-01',
  },
  {
    id: 'ct-5', name: 'Metal Crown (Cast)', base_price: 7000, category: 'crown_bridge',
    lead_time_days: 4, warranty_months: 24,
    description: 'Non-precious cast metal crown',
    material_system: 'Ni-Cr / Co-Cr casting alloy',
    unit_basis: 'per unit',
    shade_guide: 'N/A — full metal restoration',
    indications: 'Non-visible posterior units, second molars, over-denture abutments, metal occlusal preference.',
    contraindications: 'Aesthetic zones; nickel allergy (specify Co-Cr); opposing gold restorations (galvanic concern).',
    created_at: '2026-01-01',
  },
  {
    id: 'ct-6', name: 'Implant Abutment & Crown', base_price: 32000, category: 'implant',
    lead_time_days: 7, warranty_months: 60,
    description: 'Custom titanium abutment + zirconia implant crown',
    material_system: 'Grade-5 titanium abutment (Ti-6Al-4V) + zirconia suprastructure',
    unit_basis: 'per implant restoration',
    shade_guide: 'VITA Classical A1–D4',
    indications: 'Single-unit implant restorations on standard platforms; screw- or cement-retained designs.',
    contraindications: 'Non-verified implant connection — torque driver & platform must be confirmed before fabrication.',
    created_at: '2026-01-01',
  },
  {
    id: 'ct-7', name: 'Zirconia Bridge (3-Unit)', base_price: 42000, category: 'crown_bridge',
    lead_time_days: 6, warranty_months: 60,
    description: '3-unit posterior multi-layered zirconia bridge',
    material_system: 'Multi-layered 4Y/5Y zirconia puck',
    unit_basis: 'per 3-unit span',
    shade_guide: 'VITA Classical A1–D4 / VITA 3D-Master',
    indications: 'Three-unit posterior bridges up to second molar; implant-supported 3-unit spans (with verified connectors ≥ 9 mm²).',
    contraindications: 'Spans beyond 3 units or to second molar in high-load bruxism; connector height under 4 mm.',
    created_at: '2026-01-01',
  },
  {
    id: 'ct-8', name: 'Composite Inlay/Onlay', base_price: 11000, category: 'crown_bridge',
    lead_time_days: 3, warranty_months: 24,
    description: 'Indirect lab composite restoration',
    material_system: 'Indirect micro-hybrid composite (light/heat cured)',
    unit_basis: 'per unit',
    shade_guide: 'VITA Classical A1–D4',
    indications: 'Conservative inlay/onlay for vital posterior teeth; under-cut conservative preparations where full crown unnecessary.',
    contraindications: 'Extensive cuspal coverage with heavy bruxism; subgingival margins beyond adhesive isolation.',
    created_at: '2026-01-01',
  },
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
 * Super Admin. Migration 009 removed the retired hidden service account.
 * Kept as an empty password-free shape so legacy import code still typechecks.
 */
export const INITIAL_USERS: UserProfile[] = [];

