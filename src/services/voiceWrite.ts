/**
 * Strict, allow-listed parser for the two write actions voice may issue:
 * record a payment and record an advance deposit. Anything else is not writable.
 */
export interface WriteCommand {
  kind: 'payment' | 'advance' | 'createClinic' | 'setCaseStatus' | 'updateClinicDoctor' | 'addCaseNote' | 'recordQc' | 'archiveCase' | 'updateClinicField' | 'printSettingsSave' | 'printSectionsSave' | 'notificationConfigSave' | 'closeMonth' | 'addClinicContact' | 'addClinicAddress' | 'addPricingOverride' | 'createCase' | 'applyAdvance' | 'markPaid' | 'bulkArchive';
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
}

const AMOUNT = /(?:pkr|rs\.?|rupees?)?\s*(\d[\d,]{0,12})/i;

const extractAmount = (text: string): number | null => {
  const m = text.match(AMOUNT);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const extractMethod = (text: string): WriteCommand['method'] => {
  const t = text.toLowerCase();
  if (/cheque|chk/.test(t)) return 'cheque';
  if (/cash/.test(t)) return 'cash';
  return 'bank';
};

const extractInvoice = (text: string): string | undefined => {
  const m = text.match(/(?:invoice|inv)[#:\s-]*(INV[-\d]+|\d{3,})/i);
  if (!m) return undefined;
  const num = m[1].toUpperCase();
  return /^INV/i.test(num) ? num : `INV-${num.padStart(4, '0')}`;
};

/** Extract clinic hint: "for X", "to X", "from X", or a bare trailing clinic-ish name. */
const extractClinicHint = (text: string): string => {
  const m = text.match(/(?:for|to|from|of)\s+([A-Za-z0-9 ()&-]{2,60})/i);
  return (m?.[1] || '').trim();
};

const isPayment = (t: string): boolean =>
  /^(record|add|post|take|receive|collect|accept)\s+(a\s+)?(payment|receipt|collection)\b/i.test(t.trim())
  || /^receive\s+(a\s+)?payment\b/i.test(t.trim());

const isCreateClinic = (t: string): boolean =>
  /^(add|create|new|make)\s+(a\s+)?(clinic|lab|dental clinic)\b/i.test(t.trim());

const extractClinicName = (text: string): string => {
  const m = text.match(/(?:add|create|new|make)\s+(?:a\s+)?(?:clinic|lab|dental clinic)\s+([A-Za-z0-9 ()&-]{2,60})/i);
  return (m?.[1] || '').trim();
};

const isAdvance = (t: string): boolean =>
  /^(record|add|post)\s+(an\s+)?(advance|deposit)\b/i.test(t.trim())
  || /^record\s+advance\s+deposit\b/i.test(t.trim());

export const parseWriteCommand = (text: string): WriteCommand | null => {
  const t = (text || '').trim();
  if (!t) return null;
  if (isCreateClinic(t)) {
    const name = extractClinicName(t);
    return name ? { kind: 'createClinic', amount: 0, clinicHint: name, method: 'bank' } : null;
  }
  const amount = extractAmount(t);
  const clinicHint = extractClinicHint(t);
  if (isPayment(t)) {
    if (amount === null || !clinicHint) return null;
    return { kind: 'payment', amount, clinicHint, invoiceNumber: extractInvoice(t), method: extractMethod(t) };
  }
  if (isAdvance(t)) {
    if (amount === null || !clinicHint) return null;
    return { kind: 'advance', amount, clinicHint, method: extractMethod(t) };
  }
  return null;
};
