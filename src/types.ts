export type CaseStatus = 
  | 'draft'
  | 'received' 
  | 'in_progress' 
  | 'qc' 
  | 'ready' 
  | 'delivered' 
  | 'revision' 
  | 'cancelled';

export type PriorityLevel = 'low' | 'normal' | 'high' | 'urgent';

export type PaymentMethod = 'cash' | 'bank' | 'cheque' | 'advance';

export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

export type PaymentStatusV2 = 'draft' | 'pending_verification' | 'posted' | 'reconciled' | 'reversed' | 'failed';

export type InvoiceStatusV2 = 'draft' | 'open' | 'partially_paid' | 'paid' | 'overdue' | 'disputed' | 'voided';

export type AdvanceCreditStatus = 'available' | 'partially_allocated' | 'fully_allocated' | 'on_hold' | 'refunded' | 'reversed';

export type AdjustmentType = 'credit_note' | 'write_off' | 'debit_adjustment' | 'refund' | 'reversal';

export interface PaymentAllocation {
  id: string;
  source_type: 'payment' | 'advance';
  source_id: string;
  source_ref: string;
  invoice_id: string;
  invoice_number: string;
  amount: number;
  allocated_at: string;
  allocated_by: string;
  notes?: string;
}

export interface JournalLine {
  id: string;
  account_code: string;
  account_name: string;
  account_type: 'asset' | 'liability' | 'revenue' | 'expense' | 'equity';
  debit: number;
  credit: number;
  description?: string;
  lab_name?: string;
}

export interface JournalEntry {
  id: string;
  journal_number: string;
  date: string;
  event_type: string;
  reference_type: string;
  reference_id: string;
  reference_number: string;
  lab_id: string;
  lab_name: string;
  description: string;
  lines: JournalLine[];
  created_at: string;
  created_by: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_ref: string;
  reason?: string;
  old_state?: any;
  new_state?: any;
  notes?: string;
}

export interface ReconciliationItem {
  id: string;
  payment_id: string;
  reference_number: string;
  method: 'bank' | 'cheque' | 'cash' | 'advance';
  amount: number;
  date: string;
  lab_id: string;
  lab_name: string;
  invoice_id?: string;
  invoice_number?: string;
  status: 'unmatched' | 'suggested_match' | 'matched' | 'verified' | 'exception';
  exception_reason?: string;
  notes?: string;
  proof_url?: string;
  verified_at?: string;
  verified_by?: string;
}

export type TransactionType = 
  | 'invoice_payment' 
  | 'advance_payment' 
  | 'advance_allocation' 
  | 'credit_note' 
  | 'debit_adjustment' 
  | 'refund';

export interface CaseAttachment {
  id: string;
  case_id: string;
  filename: string;
  file_type: string;
  file_url: string; // base64 or URL
  uploaded_at: string;
  uploaded_by: string;
  file_size?: string;
}

export interface CaseNote {
  id: string;
  case_id: string;
  note_text: string;
  author: string;
  created_at: string;
  updated_at?: string;
}

export interface CaseStatusHistory {
  id: string;
  case_id: string;
  status: CaseStatus;
  notes?: string;
  timestamp: string;
  updated_by: string;
}

export type ToothPrepType = 'crown' | 'veneer' | 'inlay_onlay' | 'abutment' | 'pontic' | 'implant' | 'coping';

export interface ToothDetail {
  tooth_number: number; // FDI e.g. 11
  shade?: string;
  prep_type?: ToothPrepType | string;
  material?: string;
  notes?: string;
  implant_brand?: string;
  implant_size?: string;
}

export interface DentalCase {
  id: string;
  case_number: string; // e.g. DS-0001
  patient_name?: string;
  lab_id: string;
  lab_name: string;
  case_type_id: string;
  case_type_name: string;
  case_type?: string;
  units_count?: number;
  doctor_name: string;
  selected_teeth: number[]; // FDI tooth numbers e.g. [11, 12, 21]
  tooth_details?: Record<number, ToothDetail>;
  shade?: string;
  material?: string;
  delivery_date: string;
  priority: PriorityLevel;
  price: number;
  discount: number;
  final_price: number;
  instructions?: string;
  photo_url?: string;
  status: CaseStatus;
  created_at: string;
  updated_at: string;
  history: CaseStatusHistory[];
  attachments?: CaseAttachment[];
}

export interface CaseTemplate {
  id: string;
  template_name: string;
  case_type_id: string;
  case_type_name: string;
  description?: string;
  selected_teeth: number[];
  shade?: string;
  instructions?: string;
  default_priority: PriorityLevel;
  created_at: string;
}

export interface LabContact {
  id: string;
  lab_id: string;
  name: string;
  phone: string;
  email: string;
  role?: string;
  notes?: string;
  is_primary: boolean;
}

export interface LabAddress {
  id: string;
  lab_id: string;
  type: 'billing' | 'shipping' | 'lab_location';
  street: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  is_default: boolean;
}

export interface LabPricingOverride {
  id: string;
  lab_id: string;
  case_type_id: string;
  case_type_name: string;
  standard_price: number;
  custom_price: number;
  discount_percentage?: number;
  effective_date: string;
}

export interface LabReview {
  id: string;
  lab_id: string;
  rating: number; // 1-5
  review_text?: string;
  reviewer_name: string;
  case_number?: string;
  created_at: string;
}

export interface DentalLab {
  id: string;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  city?: string;
  doctor_name?: string;
  code?: string;
  notes?: string;
  rating: number;
  reviews_count: number;
  created_at: string;
}

export interface DoctorPreferredLab {
  id: string;
  doctor_name: string;
  lab_id: string;
  lab_name: string;
  created_at: string;
}

export interface PaymentAttachment {
  id: string;
  payment_id: string;
  file_name: string;
  file_type: string; // e.g. 'image/png', 'image/jpeg'
  file_size?: string;
  file_url: string; // base64 or URL
  uploaded_at: string;
  uploaded_by?: string;
}

export interface PaymentRecord {
  id: string;
  payment_number?: string; // e.g. PAY-0001
  receipt_number?: string; // e.g. REC-0001
  invoice_id: string;
  invoice_number?: string; // e.g. INV-0001
  case_id?: string;
  case_number?: string;
  lab_id?: string;
  lab_name?: string;
  amount: number;
  payment_method: PaymentMethod;
  payment_date: string;
  reference_number?: string; // Transaction ID / Cheque # / Slip #
  notes?: string;
  recorded_by: string;
  created_at?: string;
  attachments?: PaymentAttachment[];
  payment_type?: TransactionType;
  advance_payment_id?: string; // If paid via advance credit
  status?: PaymentStatusV2;
  allocations?: PaymentAllocation[];
  unapplied_amount?: number;
  is_reversed?: boolean;
  reversal_reason?: string;
  reversed_at?: string;
  reversed_by?: string;
  journal_id?: string;
}

export interface AdvancePayment {
  id: string;
  payment_number: string; // e.g. ADV-0001
  receipt_number?: string; // e.g. REC-0001
  lab_id: string;
  lab_name: string;
  amount: number; // Total deposit received
  allocated_amount: number; // Amount applied to invoices
  remaining_amount: number; // Available credit balance
  payment_method: 'cash' | 'bank' | 'cheque';
  payment_date: string;
  reference_number?: string; // Transaction ID / Cheque #
  notes?: string;
  recorded_by: string;
  created_at: string;
  attachments?: PaymentAttachment[];
  status?: AdvanceCreditStatus;
  allocations?: PaymentAllocation[];
  is_reversed?: boolean;
  reversal_reason?: string;
  reversed_at?: string;
  reversed_by?: string;
  journal_id?: string;
}

export interface AccountAdjustment {
  id: string;
  adjustment_number: string; // e.g. ADJ-0001 or CR-0001
  credit_note_number?: string;
  lab_id: string;
  lab_name: string;
  type: 'credit_note' | 'debit_adjustment' | 'refund' | 'write_off' | 'reversal';
  amount: number;
  reason: string;
  date: string;
  reference_number?: string;
  invoice_id?: string;
  invoice_number?: string;
  notes?: string;
  recorded_by: string;
  approved_by?: string;
  created_at: string;
  attachments?: PaymentAttachment[];
  status?: 'draft' | 'pending_approval' | 'posted' | 'reversed';
  is_reversed?: boolean;
  reversal_reason?: string;
  reversed_at?: string;
  reversed_by?: string;
  journal_id?: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  case_id: string;
  case_number: string;
  lab_id: string;
  lab_name: string;
  case_type_id?: string;
  case_type_name: string;
  doctor_name: string;
  patient_name?: string;
  amount: number;
  discount: number;
  final_amount: number;
  amount_paid: number;
  payment_status: PaymentStatus;
  status_v2?: InvoiceStatusV2;
  issue_date?: string;
  due_date: string;
  created_at: string;
  payments: PaymentRecord[];
  credit_notes_total?: number;
  journal_id?: string;
}

export type LedgerEntryType = 
  | 'invoice' 
  | 'payment' 
  | 'advance_payment' 
  | 'advance_allocation' 
  | 'credit_note' 
  | 'write_off'
  | 'debit_adjustment' 
  | 'refund'
  | 'reversal';

export interface LedgerEntry {
  id: string;
  date: string;
  lab_id: string;
  lab_name: string;
  entry_type: LedgerEntryType;
  type?: LedgerEntryType;
  reference_id: string; // invoice_id, payment_id, advance_id, or adjustment_id
  reference_number: string; // INV-XXXX, PAY-XXXX, ADV-XXXX, ADJ-XXXX
  case_number?: string;
  doctor_name?: string;
  description: string;
  debit: number; // Receivable increase (Invoice, Debit Adjustment, Refund)
  credit: number; // Receivable decrease (Payment, Advance Payment, Credit Note)
  running_balance: number; // Calculated running outstanding balance
  payment_method?: PaymentMethod;
  attachments_count?: number;
  attachments?: PaymentAttachment[];
  notes?: string;
  recorded_by?: string;
  journal_id?: string;
}

export interface LabFinancialSummary {
  total_invoiced: number;
  totalInvoiced?: number;
  total_paid: number;
  total_advance_received: number;
  advance_balance: number; // Available unallocated advance credit
  advanceCreditBalance?: number;
  available_advance?: number;
  total_credit_notes: number;
  total_debit_adjustments: number;
  outstanding_balance: number; // Due amount (max 0 if net credit)
  netOutstanding?: number;
  net_balance: number; // Debits - Credits (negative means clinic has credit surplus!)
  invoices_count: number;
  unpaid_invoices_count: number;
  partial_invoices_count: number;
  paid_invoices_count: number;
  payments_count: number;
  advance_count: number;
}

export type ClinicFinancialSummary = LabFinancialSummary;
export type DentalClinic = DentalLab;
export type Clinic = DentalLab;

export interface CaseType {
  id: string;
  name: string;
  base_price: number; // PKR
  category?: 'crown_bridge' | 'implant' | 'denture' | 'orthodontic' | 'veneers';
  lead_time_days?: number;
  warranty_months?: number;
  description?: string;
  created_at: string;
}

export type NotificationType = 'overdue_case' | 'pending_payment' | 'escalation' | 'status_change' | 'unpaid_invoice' | 'system';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  case_id?: string;
  case_number?: string;
  invoice_id?: string;
  lab_id?: string;
  read?: boolean;
  is_read?: boolean;
  is_archived?: boolean;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  link_url?: string;
  created_at: string;
}

export interface NotificationConfig {
  overdue_frequencies: string[]; // e.g., ['1_day_before', 'on_due_date', '1_day_after', '3_days_after', '7_days_after']
  payment_frequencies: string[]; // e.g., ['1_day_before', 'on_due_date', '3_days_after', '7_days_after', '14_days_after']
  enable_escalation: boolean;
  escalation_threshold_days: number;
  recurring_interval: 'daily' | 'every_3_days' | 'weekly';
}

export interface EmailTemplate {
  id: string;
  key: 'overdue_case' | 'pending_payment' | 'escalation' | 'payment_received';
  name: string;
  subject: string;
  body_text: string;
  button_text: string;
  logo_url?: string;
  color_scheme: string;
  footer_text: string;
  updated_at: string;
}

export interface UserPreferences {
  channels: ('in_app' | 'email')[];
  frequency: 'real_time' | 'daily_digest' | 'weekly_digest';
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  enabled_types: NotificationType[];
  unsubscribed_all: boolean;
  currency?: string;
  default_turnaround_days?: number;
  default_priority?: PriorityLevel;
  auto_print_job_slips?: boolean;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  name: string;
  role: 'Lab Admin' | 'Technician' | 'Billing Manager' | 'Super Admin';
  password?: string;
  avatar?: string;
  isSuperAdmin?: boolean; // Superadmin account is hidden from User Management list
  created_at?: string;
}

export interface BrandingSettings {
  appName: string;
  tagline: string;
  lab_name?: string;
  logoUrl?: string;
  primaryColor?: string;
  phone?: string;
  address?: string;
  email?: string;
  facebook?: string;
  bankName?: string;
  bankAccountTitle?: string;
  bankAccountNumber?: string;
  bankIban?: string;

  // Workstation Warning & Highlighting Customizations
  enable24hWarning?: boolean;
  warningThresholdHours?: number; // Default 24 hours
  warningHighlightColor?: 'rose' | 'red' | 'amber' | 'emerald' | 'indigo' | 'purple';
  warningHighlightStyle?: 'border' | 'solid' | 'badge' | 'full';
  cardBgColor?: string;

  // Global print defaults (Settings → Print; per-document section toggles live in Print Studio)
  printPaper?: 'a4' | 'letter';
  printMargin?: 'narrow' | 'normal' | 'wide';
  printFontSize?: 'compact' | 'normal' | 'large';
  printShowLogo?: boolean;
  printLogoPosition?: 'left' | 'center' | 'right';
}

export interface InvoiceLineItem {
  id: string;
  description: string;
  teeth_numbers?: number[];
  quantity: number;
  unit_price: number;
  total_price: number;
}

export interface SavedVoucher {
  id: string;
  voucher_number: string;
  voucher_type: 'job_slip' | 'invoice';
  case_id: string;
  case_number: string;
  lab_name: string;
  doctor_name: string;
  patient_name?: string;
  case_type_name?: string;
  amount?: number;
  created_at: string;
  saved_by: string;
  notes?: string;
}

// ─────────────────────────────────────────────────────────── quality control (QC)

/** Outcome of a single quality inspection. */
export type QcResult = 'pass' | 'fail';

/** Structured defect categories used by the inspection form and the failure analytics. */
export type QcReasonCode =
  | 'occlusion'
  | 'shade_mismatch'
  | 'margin_fit'
  | 'contact_tightness'
  | 'finish_polish'
  | 'damage'
  | 'dimension'
  | 'other';

/** `inspection` appends a new fact; `correction` amends a mistaken fact without mutating it. */
export type QcEventKind = 'inspection' | 'correction';

/** One immutable row of the append-only QC stream (`qc_inspections` table). */
export interface QcInspection {
  id: string;
  case_id: string;
  case_number?: string | null;
  /** 1-based, per case: the number of the inspection attempt. */
  inspection_no: number;
  kind: QcEventKind;
  result: QcResult;
  reason_code?: QcReasonCode | null;
  reason_text?: string | null;
  /** JSON TEXT: free-form checklist items confirmed during the inspection. */
  checklist?: string | null;
  inspector: string;
  notes?: string | null;
  /** Set on `correction` events: the event this one replaces. */
  supersedes_id?: string | null;
  /** Idempotency guard — the same physical event can never be appended twice. */
  dedupe_key: string;
  created_at: string;
}

/** Derived (never stored) quality state of one case. */
export interface QcCaseState {
  case_id: string;
  /** Number of effective inspections recorded for the case. */
  inspection_no: number;
  attempts: number;
  passed: boolean;
  /** Passed on the very first inspection, with no rework in between. */
  first_pass: boolean;
  failed_attempts: number;
  last_result?: QcResult;
  last_reason_code?: QcReasonCode | null;
  last_inspected_at?: string;
  last_inspector?: string;
  /** True when the case may advance to ready/delivered. */
  gate_open: boolean;
}

export interface QcReasonTally {
  code: QcReasonCode;
  label: string;
  count: number;
}

export interface QcInspectorTally {
  inspector: string;
  inspections: number;
  passes: number;
  fails: number;
}

/** Aggregated quality KPIs for the dashboard/analytics surfaces. */
export interface QcMetrics {
  inspected_cases: number;
  passed_cases: number;
  first_pass_cases: number;
  /** null when there is no data yet — the UI renders an em dash, never a fabricated number. */
  first_pass_rate: number | null;
  inspections: number;
  failed_inspections: number;
  rework_cases: number;
  rework_rate: number | null;
  top_reasons: QcReasonTally[];
  inspector_counts: QcInspectorTally[];
}

/** Union command accepted by `useApp().recordQcCase()` — record or correct, nothing else. */
export type QcCommand =
  | {
      action: 'record';
      case_id: string;
      result: QcResult;
      reason_code?: QcReasonCode;
      reason_text?: string;
      checklist?: string[];
      notes?: string;
      inspector?: string;
    }
  | {
      action: 'correct';
      /** id of the inspection being corrected. */
      id: string;
      result: QcResult;
      reason_code?: QcReasonCode;
      reason_text?: string;
      notes?: string;
      inspector?: string;
    };

export interface QcReceipt {
  /** The appended event; absent when the write was refused (unknown case, duplicate). */
  inspection?: QcInspection;
  case_state: QcCaseState;
  /** Case status after the QC write (unchanged when the case was locked or not found). */
  status_after?: CaseStatus;
  /** True when a notification was pushed to the feed. */
  notified: boolean;
}


