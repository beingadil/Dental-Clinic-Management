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
  /** First-class case/job reference — relational, never parsed from narration. */
  case_id?: string;
  case_number?: string;
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

type TransactionType = 
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

interface CaseStatusHistory {
  id: string;
  case_id: string;
  status: CaseStatus;
  notes?: string;
  timestamp: string;
  updated_by: string;
}

type ToothPrepType = 'crown' | 'veneer' | 'inlay_onlay' | 'abutment' | 'pontic' | 'implant' | 'coping';

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
  /** Bench this case is routed to. See utils/labDepartments for the list. */
  department?: string | null;
  delivery_date: string;
  /** Day the lab received the job. Optional; slips print this instead of the delivery date. */
  received_date?: string | null;
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
  /* Archive lifecycle: undefined/NULL = active case; ISO string = archived. */
  archived_at?: string | null;
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
  /**
   * Date this override starts applying, `YYYY-MM-DD`.
   *
   * Optional at runtime even though the field exists: `syncCore` writes
   * `po.effective_date ?? null`, and every row that predates the column has no
   * date at all. An undated override applies always — see
   * `services/pricingOverride.ts`, which is the only thing allowed to decide.
   */
  effective_date?: string;
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
  /**
   * Money the clinic already owed before it was entered into the system.
   *
   * Stored on the clinic rather than as a one-off adjustment row so it has a
   * home that can be read and corrected: the ledger derives its opening entry
   * from this field, which is what keeps the two from ever disagreeing. An
   * adjustment row would work for the books but leave no editable record of
   * what the starting figure was.
   */
  opening_balance: number;
  /**
   * Whether the opening balance is a debit (clinic owes you) or a credit
   * (you owe the clinic). Defaults to 'debit' — the common case.
   */
  opening_balance_type: 'debit' | 'credit';
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
  journal_id?: string;
}

export interface AccountAdjustment {
  id: string;
  adjustment_number: string; // e.g. ADJ-0001 or CR-0001
  credit_note_number?: string;
  lab_id: string;
  lab_name: string;
  type: 'credit_note' | 'debit_adjustment' | 'refund' | 'write_off';
  amount: number;
  reason: string;
  date: string;
  reference_number?: string;
  invoice_id?: string;
  invoice_number?: string;
  /** Relational case context (derived from the adjustment's invoice). */
  case_id?: string;
  case_number?: string;
  notes?: string;
  recorded_by: string;
  approved_by?: string;
  created_at: string;
  attachments?: PaymentAttachment[];
  status?: 'draft' | 'pending_approval' | 'posted';
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
  | 'opening_balance';

export interface LedgerEntry {
  id: string;
  date: string;
  lab_id: string;
  lab_name: string;
  entry_type: LedgerEntryType;
  type?: LedgerEntryType;
  reference_id: string; // invoice_id, payment_id, advance_id, or adjustment_id
  reference_number: string; // INV-XXXX, PAY-XXXX, ADV-XXXX, ADJ-XXXX
  /** Relational case/job reference — from the source doc's case_id, never narration. */
  case_id?: string;
  case_number?: string;
  doctor_name?: string;
  description: string;
  debit: number; // Receivable increase (Invoice, Debit Adjustment, Refund)
  credit: number; // Receivable decrease (Payment, Advance Payment, Credit Note)
  running_balance: number; // Calculated running outstanding balance
  /** Exact posting instant (ISO). The single ordering key for the whole ledger:
      same-day entries keep their true posting sequence instead of colliding. */
  posted_at?: string;
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
  opening_balance: number; // Debt the clinic carried in before the system
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

/**
 * An operator-managed material category (migration 023).
 *
 * `id` is the stable key written to `case_types.category`; `name` is what the
 * operator sees and is freely editable. Renaming therefore never touches a
 * product row — the product keeps pointing at the same id.
 */
export interface CatalogCategory {
  id: string;
  name: string;
  sort_order: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CaseType {
  id: string;
  name: string;
  base_price: number; // PKR
  /* Foreign key to `catalog_categories.id` (migration 023).
     Was a five-value union, which made a user-added category unrepresentable
     without editing this file and rebuilding. The five seeded ids are unchanged
     ('crown_bridge' | 'implant' | 'denture' | 'orthodontic' | 'veneers'), so
     every existing row still satisfies its old type — but the set is now open.
     Treat it as a plain string: the id must exist in `catalog_categories`, which
     `categoryRepo` is what enforces (see `deleteBlockedReason`). */
  category?: string;
  lead_time_days?: number;
  warranty_months?: number;
  description?: string;
  /* Catalog detail (all optional — existing rows simply leave them null). */
  material_system?: string;   // e.g. '3Y-TZP zirconia', 'lithium disilicate'
  unit_basis?: string;        // how the base price is counted, e.g. 'per unit'
  shade_guide?: string;       // default shade system, e.g. 'VITA Classical A1–D4'
  indications?: string;       // clinical indications
  contraindications?: string; // when NOT to use
  /**
   * Whether this product is per-tooth work. False means the case wizard skips
   * charting and every output omits teeth and shade. Absent is read as true, so
   * a product saved before migration 021 keeps its existing meaning.
   */
  needs_teeth?: boolean;
  created_at: string;
}

type NotificationType = 'overdue_case' | 'pending_payment' | 'escalation' | 'status_change' | 'unpaid_invoice' | 'system';

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
  /**
   * Fallback turnaround for the `normal` priority, in days.
   *
   * It used to be called "the default turnaround time" and nothing read it —
   * the real mechanism is `services/prioritySla.ts`, which owns a per-priority
   * table editable in Catalog → SLA. This field is now the fallback that table
   * falls back to for `normal` when no row exists, so the control does
   * something instead of pretending to.
   */
  default_turnaround_days?: number;
  default_priority?: PriorityLevel;
  auto_print_job_slips?: boolean;
  /** Boot sweep: archive delivered cases older than 30 days automatically. */
  auto_archive_completed_cases?: boolean;
  /** Global interface zoom (screen only; print output is never scaled). */
  ui_zoom?: number;
  /** Interface theme. 'system' follows the OS/browser preference. */
  theme_mode?: 'light' | 'dark' | 'system';
  /**
   * How many columns the monthly statement shows.
   *
   * 'compact' (the default) shows the seven a reader needs to read the
   * statement at all; 'full' shows all twelve, for the months being audited.
   * The screen, the PDF and the workbook all read this one setting, so the
   * document an operator exports is the document they were reading.
   */
  statement_columns?: 'compact' | 'full';
  /** Display time zone for timestamps. 'local' follows the device. */
  time_zone?: string;
  /** Auto-backup interval in minutes (0 = off). */
  auto_backup_interval_min?: number;
  /** Date display format. */
  date_format?: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  /** Number display format. */
  number_format?: '1,000.00' | '1.000,00';

  /** Active dashboard layout: 'default' or the name of a saved arrangement
   *  (registry lives beside this key in the per-user preferences blob, written
   *  by useDashboardLayout). Persisted per user.
   */
  dashboard_layout_id?: string;
  /** Dashboard panel density. 'default' inherits the app-wide scale;
   *  'compact' tightens padding and reduces panel font scale;
   *  'roomy' expands padding for readability.
   */
  dashboard_density?: 'default' | 'compact' | 'roomy';
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  name: string;
  role: string; // built-in roles + custom roles created in Settings → Users (RBAC v4)
  password?: string;
  avatar?: string;
  isSuperAdmin?: boolean; // Superadmin account is hidden from User Management list
  permissions?: string[]; // RBAC v3: per-user granted actions (overrides role baseline)
  is_active?: boolean; // soft-disable flag enforced at login (RBAC v2)
  is_hidden?: number; // DB flag: never shown in any user list (service account)
  created_at?: string;
  /** Clinics the user may see. Absent/empty = unrestricted (opt-in scoping). */
  clinic_ids?: string[];
}

/** RBAC v4: a role definition. Built-ins ship as is_system rows; custom roles
 *  are created by the Super Admin in Settings → Users and carry their own
 *  baseline permission ticks (users keep explicit per-user overrides). */
export interface RoleDef {
  id: string;
  name: string;
  description?: string;
  permissions: string[]; // baseline tick set for newly created users of this role
  is_system: boolean;
  created_at?: string;
}

export interface BrandingSettings {
  appName: string;
  tagline: string;
  lab_name?: string;
  logoUrl?: string;
  /** Optional second mark — printed beside the primary logo on invoices. */
  logoUrl2?: string;
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

  // Global print defaults (Settings → Print; per-document section toggles live in each print dialog)
  printPaper?: 'a4' | 'letter';
  printMargin?: 'narrow' | 'normal' | 'wide';
  printFontSize?: 'compact' | 'normal' | 'large';
  printShowLogo?: boolean;
  printLogoPosition?: 'left' | 'center' | 'right';
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
type QcEventKind = 'inspection' | 'correction';

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


