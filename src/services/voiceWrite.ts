/**
 * The `WriteCommand` contract the voice layer hands the app on fire — one
 * AI-executed action (record a payment, move a case, …). The AI agentic loop
 * in `voiceRegistry.ts` is the ONLY place commands are resolved from speech;
 * this module is just the data shape (destructive actions, risk).
 */
export interface CaseUpdateFields {
  priority?: string;
  shade?: string;
  material?: string;
  instructions?: string;
  delivery_date?: string;
  teeth?: number[];
}

export interface WriteCommand {
  kind: 'payment' | 'advance' | 'createClinic' | 'setCaseStatus' | 'updateClinicField' | 'addCaseNote' | 'recordQc' | 'archiveCase' | 'updateClinicDoctor' | 'bulkArchive'
  | 'caseUpdateFields' | 'casePriority' | 'bulkCaseStatus' | 'restoreCase' | 'caseTemplateSave' | 'deleteCase' | 'purgeCase' | 'addClinicContact' | 'addClinicAddress' | 'addPricingOverride' | 'createCase' | 'applyAdvance' | 'markPaid' | 'printSettingsSave' | 'printSectionsSave' | 'notificationConfigSave' | 'closeMonth';
  amount: number;
  clinicHint: string;
  invoiceNumber?: string;
  method: 'cash' | 'bank' | 'cheque';
  /** For setCaseStatus */
  caseNumber?: string;
  /** Target workflow stage ('ready' | 'delivered' | 'qc' | …). */
  targetStatus?: string;
  /** New doctor name for updateClinicDoctor. */
  doctorName?: string;
  /** Free text for addCaseNote. */
  noteText?: string;
  /** QC outcome for recordQcInspection. */
  qcResult?: 'pass' | 'fail';
  qcReason?: string;
  /** For updateClinicField */
  field?: 'name' | 'phone' | 'email' | 'address' | 'city' | 'doctor';
  value?: string;
  /** Contact for addClinicContact. */
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactRole?: string;
  isPrimary?: boolean;
  /** Address for addClinicAddress. */
  addressType?: 'billing' | 'shipping' | 'lab_location';
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  isDefault?: boolean;
  /** Pricing override for addPricingOverride. */
  caseTypeId?: string;
  caseTypeName?: string;
  standardPrice?: number;
  customPrice?: number;
  discountPercentage?: number;
  effectiveDate?: string;
  /** Print settings object for printSettingsSave (PrintSettings). */
  printSettings?: unknown;
  /** Document kind for printSectionsSave (invoice | job_slip | receipt | statement). */
  docKind?: 'invoice' | 'job_slip' | 'receipt' | 'statement';
  /** Section ids for printSectionsSave. */
  sections?: string[];
  /** NotificationConfig for notificationConfigSave. */
  notification?: unknown;
  /** 'YYYY-MM' for closeMonth. */
  month?: string;
  labId?: string;
  labName?: string;
  /** Guided case creation */
  patientName?: string;
  deliveryDate?: string;
  /** Guided case creation — charted teeth (FDI). */
  teeth?: number[];
  /** Guided case creation — priority level. */
  priority?: string;
  /** Guided case creation — VITA shade. */
  shade?: string;
  /** One or more invoice numbers for bulk settlement. */
  invoiceNumbers?: string[];
  /** Fields to update — setCaseStatus's sibling write (update case fields). */
  updateFields?: CaseUpdateFields;
  /** Bulk-archive: delivered case ids. */
  bulkCaseNumbers?: string[];
  /** Template name — saveAsTemplate. */
  templateName?: string;
}
