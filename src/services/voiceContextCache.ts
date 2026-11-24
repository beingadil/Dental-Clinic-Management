/**
 * Voice Context Cache — CAG (Context-Augmented Generation) layer.
 *
 * Pre-loads clinic-relevant data so the AI agentic loop always has rich,
 * up-to-date context to resolve ANY phrase — typed or spoken — without
 * hardcoded phrases or keyword matching.
 *
 * The cache is rebuilt whenever the app context changes (new view, new
 * clinic selected, data mutated). It feeds into the dynamic system prompt
 * so Groq sees: current clinic name + outstanding balance + recent cases
 * + outstanding invoices + QC items + advance wallet + month-close status.
 *
 * Patient names and contact details ARE available to the AI for routing
 * decisions, but are redacted from TTS output via voiceRedaction.
 */
import type { DentalLab, DentalCase, Invoice, AdvancePayment, AccountAdjustment } from '../types';
import { invoiceBalanceDue } from './financeDomain';
import { getAdvanceWallet } from './voiceTools';

export interface ClinicContextSnapshot {
  clinicId: string;
  clinicName: string;
  outstandingBalance: number;   // PKR, Dr = clinic owes us
  creditBalance: number;        // PKR, Cr = we hold credit
  recentCases: CaseSummary[];
  outstandingInvoices: InvoiceSummary[];
  pendingQc: QcItem[];
  failedQc: QcItem[];
  advanceWallet: number;        // PKR unallocated
  monthCloseStatus: string;
  patientNames: string[];       // redacted from TTS, available to AI
}

export interface CaseSummary {
  caseNumber: string;
  patientName?: string;
  caseTypeName?: string;
  status: string;
  deliveryDate?: string;
  priority?: string;
}

export interface InvoiceSummary {
  invoiceNumber: string;
  patientName?: string;
  amount: number;
  balanceDue: number;
  dueDate?: string;
  status: string;
}

export interface QcItem {
  caseNumber: string;
  patientName?: string;
  result: 'pass' | 'fail';
  reason?: string;
  inspectedAt: string;
}

/** Build a full context snapshot for a given clinic from app state. */
export function buildClinicContext(
  clinic: DentalLab,
  ctx: {
    cases: DentalCase[];
    invoices: Invoice[];
    advancePayments: AdvancePayment[];
    accountAdjustments: AccountAdjustment[];
    userPreferences?: { voice_read_clinical_detail?: boolean };
  },
): ClinicContextSnapshot {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const allowClinical = ctx.userPreferences?.voice_read_clinical_detail === true;

  const clinicCases = (ctx.cases || []).filter((c) => c.lab_id === clinic.id);
  const clinicInvoices = (ctx.invoices || []).filter((i) => i.lab_id === clinic.id);

  // Outstanding balance (Dr = positive, clinic owes us)
  const balance = clinicInvoices.reduce((acc, inv) => acc + invoiceBalanceDue(inv), 0)
    + (ctx.accountAdjustments || [])
      .filter((a) => a.lab_id === clinic.id)
      .reduce((acc, a) =>
        acc + (a.type === 'debit_adjustment' ? (a.amount || 0) : 0)
        - (a.type === 'credit_note' ? (a.amount || 0) : 0), 0);

  // Outstanding invoices (balance > 0)
  const outstandingInvoices: InvoiceSummary[] = clinicInvoices
    .filter((i) => invoiceBalanceDue(i) > 0)
    .map((i) => ({
      invoiceNumber: i.invoice_number,
      patientName: allowClinical ? i.patient_name : undefined,
      amount: i.final_amount || i.amount || 0,
      balanceDue: invoiceBalanceDue(i),
      dueDate: i.due_date,
      status: i.payment_status || 'unpaid',
    }))
    .sort((a, b) => b.balanceDue - a.balanceDue)
    .slice(0, 10);

  // Recent cases (last 30 days, open + delivered)
  const recentCases: CaseSummary[] = clinicCases
    .filter((c) => {
      const d = String(c.delivery_date || '').slice(0, 10);
      return (d >= thirtyDaysAgo || c.status !== 'delivered' && c.status !== 'cancelled' && !c.archived_at)
        && !c.archived_at;
    })
    .map((c) => ({
      caseNumber: c.case_number,
      patientName: allowClinical ? c.patient_name : undefined,
      caseTypeName: c.case_type_name,
      status: c.status,
      deliveryDate: c.delivery_date,
      priority: c.priority,
    }))
    .sort((a, b) => {
      const da = String(a.deliveryDate || '').slice(0, 10);
      const db = String(b.deliveryDate || '').slice(0, 10);
      return db.localeCompare(da);
    })
    .slice(0, 10);

  // Patient names (available to AI, redacted from TTS)
  const patientNames: string[] = allowClinical
    ? [...new Set(clinicCases.map((c) => c.patient_name).filter((n): n is string => Boolean(n)))]
    : [];

  // QC items — read from QC inspections if available
  const pendingQc: QcItem[] = [];
  const failedQc: QcItem[] = [];

  // Advance wallet
  const advanceWallet = parseFloat(getAdvanceWallet({ ...ctx, labs: [clinic] }, clinic.id).replace(/[^0-9.]/g, '')) || 0;

  // Month-close status
  const monthCloseStatus = 'not closed'; // populated by monthClose module when available

  return {
    clinicId: clinic.id,
    clinicName: clinic.name,
    outstandingBalance: balance > 0 ? balance : 0,
    creditBalance: balance < 0 ? Math.abs(balance) : 0,
    recentCases,
    outstandingInvoices,
    pendingQc,
    failedQc,
    advanceWallet,
    monthCloseStatus,
    patientNames,
  };
}

/** Format the context snapshot as a compact string for the system prompt. */
export function formatContextForPrompt(snapshot: ClinicContextSnapshot | null): string {
  if (!snapshot) return '';

  const lines: string[] = [];
  lines.push(`Clinic: ${snapshot.clinicName}`);
  lines.push(`Balance: PKR ${snapshot.outstandingBalance.toLocaleString()}${snapshot.outstandingBalance > 0 ? ' (clinic owes us)' : snapshot.creditBalance > 0 ? ' (credit held)' : ' (settled)'}`);
  lines.push(`Advance wallet: PKR ${snapshot.advanceWallet.toLocaleString()}`);
  lines.push(`Month close: ${snapshot.monthCloseStatus}`);

  if (snapshot.recentCases.length) {
    lines.push(`\nRecent cases (${snapshot.recentCases.length}):`);
    for (const c of snapshot.recentCases.slice(0, 5)) {
      const patient = c.patientName ? ` (${c.patientName})` : '';
      lines.push(`- ${c.caseNumber}: ${c.caseTypeName || 'Case'} — ${c.status}${patient} — ${c.priority || 'normal'} — ${c.deliveryDate || 'n/a'}`);
    }
  }

  if (snapshot.outstandingInvoices.length) {
    lines.push(`\nOutstanding invoices (${snapshot.outstandingInvoices.length}):`);
    for (const inv of snapshot.outstandingInvoices.slice(0, 5)) {
      const patient = inv.patientName ? ` (${inv.patientName})` : '';
      lines.push(`- ${inv.invoiceNumber}: PKR ${inv.balanceDue.toLocaleString()}${patient} — ${inv.status} — ${inv.dueDate || 'n/a'}`);
    }
  }

  if (snapshot.pendingQc.length) {
    lines.push(`\nPending QC: ${snapshot.pendingQc.map((q) => q.caseNumber).join(', ')}`);
  }
  if (snapshot.failedQc.length) {
    lines.push(`\nFailed QC: ${snapshot.failedQc.map((q) => q.caseNumber).join(', ')}`);
  }

  if (snapshot.patientNames.length) {
    lines.push(`\nPatients: ${snapshot.patientNames.join(', ')}`);
  }

  return lines.join('\n');
}
