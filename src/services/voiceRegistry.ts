/**
 * Voice tool registry — ONE declarative table for everything the assistant may do.
 *
 * Every tool declares its risk level and confirmation contract up front:
 *   read        → runs silently (deterministic engine output)
 *   write       → amber confirmation panel, operator says "confirm"/taps Confirm
 *   destructive → same panel wording but with the destructive consequence text
 *                 (void / delete / edit money / month reopen). Verbal "yes" confirms.
 * Permission re-checks happen inside each command's own service layer (canPost etc.).
 */
import type { VoiceContext } from './voiceTools';
import {
  getAdvanceWallet, getCashCollected, getClinicBalance, getLedgerAnswer, getMonthCloseStatus,
  getOverdueCases, getStandings, getStatementAnswer, getUnpaid, monthFromQuery, periodFromQuery,
  searchInvoicesInContext, getCodeAnswer, clinicCandidates, narrateStatement, getTodayBriefing, openCasesSummary,
  getDueTodayBriefing, bulkArchivePreview,
} from './voiceTools';
import { guessClinic } from './voiceTools';
import { parseWriteCommand, type WriteCommand } from './voiceWrite';
import type { Invoice, DentalCase, DentalLab, AdvancePayment } from '../types';
import {
  loadPrintSettings, loadDocumentSections,
} from './printSettings';
import { loadNotificationConfig } from './notificationSettings';
import { closedMonthFor, clinicMonthSnapshots } from './monthClose';
import { formatMonthLabel } from './monthlyStatement';
import { PRINT_SECTIONS, DEFAULT_ENABLED } from '../components/print/printRenderer';
import { can } from './permissions';
import { downloadCSV } from './csvExport';
import { collectAllPayments } from './ledgerDomain';
import { buildUnifiedTransactions, transactionCsvRows } from './transactionRegister';
import { invoiceBalanceDue } from './financeDomain';
import { formatDoctorName } from '../utils/doctorName';

export type VoiceRisk = 'read' | 'write' | 'destructive';
export type ConfirmMode = 'none' | 'confirm';

export interface VoiceApi {
  labs: DentalLab[];
  invoices: Invoice[];
  cases: DentalCase[];
  advancePayments: AdvancePayment[];
  /** navigate the whole app */
  setCurrentView: (view: string) => void;
  addLab: (lab: Omit<DentalLab, 'id' | 'created_at' | 'rating' | 'reviews_count' | 'opening_balance' | 'opening_balance_type'>) => DentalLab;
  updateLab: (id: string, updates: Partial<DentalLab>) => void;
  updateCase: (id: string, updates: Partial<DentalCase>, note?: string) => void;
  addCaseNote: (caseId: string, noteText: string, author: string) => void;
  recordQcCase: (command: import('../types').QcCommand) => import('../types').QcReceipt;
  archiveCase: (id: string) => void;
  recordTransactionV2: (command: { clinicId: string; amount: number; method: 'cash' | 'bank' | 'cheque'; date: string; notes?: string; allocations: { invoiceId: string; amount: number }[]; saveRemainingAsAdvance?: boolean; isVerified?: boolean }) => { receiptNumber: string };
  recordAdvanceDepositV2: (command: { clinicId: string; amount: number; method: 'cash' | 'bank' | 'cheque'; date: string; notes?: string; isVerified?: boolean }) => { receiptNumber: string };
}

export interface VoiceToolContext extends VoiceContext {
  api: VoiceApi;
  allowClinicalDetail?: boolean;
}

export interface VoiceToolMatch { kind: 'read'; text: string; navigateTo?: string }
/** A tool proposes an action; execution happens only after operator confirmation. */
export interface VoiceToolAction {
  kind: 'action';
  risk: VoiceRisk;
  pending: WriteCommand;
  /** shown in the amber panel + spoken */
  summary: string;
}
export type VoiceToolResult = VoiceToolMatch | VoiceToolAction | null;

export interface VoiceTool {
  id: string;
  description: string;
  risk: VoiceRisk;
  match?: RegExp;
  run: (ctx: VoiceToolContext, q: string) => VoiceToolResult | Promise<VoiceToolResult>;
}

const folded = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const clinicFor = (ctx: VoiceToolContext, q: string) => guessClinic(ctx, q);
type ClinicNeed = { error: string; clinic?: undefined } | { clinic: DentalLab; error?: undefined };
const needClinic = (ctx: VoiceToolContext, q: string): ClinicNeed => {
  const hit = clinicFor(ctx, q);
  if (hit && 'ambiguous' in hit) return { error: `Which clinic — ${hit.ambiguous.join(', ')}?` };
  if (!hit) {
    const m = q.match(/(?:for|of)\s+([A-Za-z0-9 ()&-]{2,})/i);
    const cands = clinicCandidates(ctx, m?.[1]?.trim());
    return { error: cands.length > 1 ? `Which clinic — ${cands.map((c) => c.name).join(', ')}?` : 'Which clinic should I use?' };
  }
  return { clinic: hit };
};

import { REPORTS_ENTRY_ID, REPORTS_TABS } from '../components/common/financeTabs';
const NAV: Record<string, string> = {
  dashboard: 'dashboard', home: 'dashboard', overview: 'dashboard',
  case: 'cases', cases: 'cases', workstation: 'cases', 'dental workstation': 'cases', records: 'cases',
  labs: 'labs', lab: 'labs', clinics: 'labs', clinic: 'labs', 'dental clinics': 'labs',
  billing: 'billing', payments: 'billing', finance: 'billing', 'payment receive': 'billing',
  ledger: REPORTS_TABS[0].id, 'general ledger': REPORTS_TABS[0].id, books: REPORTS_TABS[0].id,
  statement: REPORTS_TABS[1].id, statements: REPORTS_TABS[1].id, monthly: REPORTS_TABS[1].id, 'monthly statement': REPORTS_TABS[1].id, vouchers: REPORTS_TABS[1].id,
  insights: REPORTS_TABS[2].id, insight: REPORTS_TABS[2].id, analytics: REPORTS_TABS[2].id, reports: REPORTS_ENTRY_ID,
  catalog: 'catalog', catalogue: 'catalog', pricing: 'catalog', price: 'catalog',
  notifications: 'notifications', alerts: 'notifications', inbox: 'notifications',
  settings: 'settings', preferences: 'settings',
  'print invoices': 'print-invoices', batch: 'print-invoices', 'batch print': 'print-invoices',
};

const tools: VoiceTool[] = [
  {
    id: 'navigate', description: 'Open any screen in the app', risk: 'read',
    run(_ctx, q) {
      const m = folded(q).match(/^(?:open|show|go to|navigate to|take me to)\s+([a-z -]{2,40})$/);
      if (!m) return null;
      const view = NAV[m[1].trim()];
      return view ? { kind: 'read', text: `Opening ${m[1].trim()}.`, navigateTo: view } : null;
    },
  },
  {
    id: 'cashCollected', description: 'Cash collected in a window', risk: 'read',
    match: /cash collected|collection today|money in|income today|collection\b/,
    run: (ctx, q) => {
      const period = periodFromQuery(q);
      const from = /today/.test(folded(q)) ? new Date().toISOString().slice(0, 10) : period.from;
      const to = /today/.test(folded(q)) ? new Date().toISOString().slice(0, 10) : period.to;
      return { kind: 'read', text: getCashCollected(ctx, from, to) };
    },
  },
  {
    id: 'overdueCases', description: 'Overdue cases', risk: 'read',
    match: /overdue case|cases overdue|pending cases/,
    run: (ctx) => ({ kind: 'read', text: getOverdueCases(ctx) }),
  },
  {
    id: 'dueToday', description: 'Cases due today (priority-sorted) and overdue', risk: 'read',
    match: /due today|what(?:'| is) (?:due|owed|delivered|delivering)|what(?:'s| is) due/i,
    run: (ctx) => ({ kind: 'read', text: getDueTodayBriefing(ctx) }),
  },
  {
    id: 'bulkArchive', description: 'Archive delivered cases whose delivery is 30+ days old', risk: 'write',
    match: /^archive (all delivered|delivered (cases )?older|bulk archive|all delivered)/i,
    run: (ctx) => {
      const preview = bulkArchivePreview(ctx);
      if (!preview.count) return { kind: 'read', text: preview.preview };
      return { kind: 'action', risk: 'write', pending: { kind: 'bulkArchive', amount: preview.count, clinicHint: 'All clinics', method: 'bank' }, summary: preview.preview };
    },
  },
  {
    id: 'standings', description: 'Clinic standings by receivable', risk: 'read',
    match: /standings|best clinic|top clinic|worst clinic|who owes/,
    run: (ctx) => ({ kind: 'read', text: getStandings(ctx) }),
  },
  {
    id: 'monthClose', description: 'Month close status', risk: 'read',
    match: /month.?close|closed month|month closed/,
    run: (_ctx, q) => ({ kind: 'read', text: getMonthCloseStatus(monthFromQuery(q)) }),
  },
  {
    id: 'clinicBalance', description: "A clinic's net balance (Dr/Cr)", risk: 'read',
    match: /balance|owe|udhar/,
    run: (ctx, q) => {
      const need = needClinic(ctx, q);
      if (need.error !== undefined) return { kind: 'read', text: need.error };
      const bal = getClinicBalance(ctx, need.clinic.id);
      return { kind: 'read', text: `${need.clinic.name}: PKR ${Math.abs(bal.signed).toLocaleString()} ${bal.label}.` };
    },
  },
  {
    id: 'narrate', description: 'Walk through a statement or ledger in plain language', risk: 'read',
    match: /^(walk me through|narrate|explain|summari[zs]e)\b/i,
    run: (ctx, q) => {
      if (!/(statement|ledger|all time|this month|last month|october|september|november|august|2026)/i.test(q)) return null;
      const need = needClinic(ctx, q);
      if (need.error !== undefined) return { kind: 'read', text: need.error };
      const period = periodFromQuery(q);
      const { from, to } = period.allTime ? { from: undefined, to: undefined } : period;
      return { kind: 'read', text: narrateStatement(ctx, need.clinic.id, from, to) };
    },
  },
  {
    id: 'briefing', description: 'Morning briefing: cash, deliveries, outstanding, overdue', risk: 'read',
    match: /briefing|what needs me today|what is due today/,
    run: (ctx) => ({ kind: 'read', text: getTodayBriefing(ctx) }),
  },
  {
    id: 'exportInvoicesCsv', description: 'Export the invoice list as a CSV file', risk: 'read',
    match: /^export\b.*\binvoices?\b|\binvoices?\b.*\bexport/i,
    run: (ctx) => {
      if (ctx.user && !can(ctx.user, 'reports:export')) return { kind: 'read', text: 'Requires the “Export reports” permission.' };
      const rows: (string | number | null | undefined)[][] = [['Invoice #', 'Case #', 'Dental Clinic', 'Doctor', 'Material / Type', 'Final Amount (PKR)', 'Amount Paid (PKR)', 'Remaining (PKR)', 'Status', 'Due Date']];
      for (const inv of ctx.invoices || []) {
        rows.push([
          inv.invoice_number, inv.case_number, inv.lab_name, formatDoctorName(inv.doctor_name || '', ''),
          inv.case_type_name, inv.final_amount || inv.amount || 0, inv.amount_paid || 0,
          invoiceBalanceDue(inv), String(inv.payment_status || '').toUpperCase(), inv.due_date,
        ]);
      }
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCSV(`Dental_Solutions_Invoices_${stamp}`, rows);
      return { kind: 'read', text: `Exporting ${rows.length - 1} invoices to the downloads folder.` };
    },
  },
  {
    id: 'exportTransactionsCsv', description: 'Export the unified transaction register as CSV', risk: 'read',
    match: /^export\b.*\b(transactions?|transaction register|register|transactions?)\b/i,
    run: (ctx) => {
      if (ctx.user && !can(ctx.user, 'reports:export')) return { kind: 'read', text: 'Requires the “Export reports” permission.' };
      const register = buildUnifiedTransactions({
        allPayments: collectAllPayments(ctx.invoices || []),
        advancePayments: ctx.advancePayments || [],
        accountAdjustments: ctx.accountAdjustments || [],
        invoices: ctx.invoices || [],
      });
      const rows = transactionCsvRows(register);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCSV(`Dental_Solutions_Transactions_${stamp}`, rows);
      return { kind: 'read', text: `Exporting ${rows.length - 1} transactions to the downloads folder.` };
    },
  },
  {
    id: 'applyAdvance', description: 'Apply advance credit to an invoice', risk: 'write',
    match: /^(apply|use)\s+(an?|the)?\s*(advance|credit)\b.*(to|on|against)/i,
    run: (ctx, q) => {
      const inv = (ctx.invoices || []).find((i) => q.toUpperCase().includes(i.invoice_number.toUpperCase()));
      const amountMatch = q.match(/(?:pkr|rs\.?|rupees?)?\s*(\d[\d,]{0,12})/i);
      const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : 0;
      if (!inv) return { kind: 'read', text: 'Which invoice? Say e.g. “Apply advance PKR 25,000 to INV-0042”.' };
      if (!amount || amount <= 0) return { kind: 'read', text: 'How much? Say e.g. “Apply advance PKR 25,000 to INV-0042”.' };
      return { kind: 'action', risk: 'write', pending: { kind: 'applyAdvance', amount, clinicHint: inv.lab_name, invoiceNumber: inv.invoice_number, method: 'bank' }, summary: `Apply advance PKR ${amount.toLocaleString()} to ${inv.invoice_number}` };
    },
  },
  {
    id: 'markInvoicePaid', description: 'Mark one or more invoices as paid in full', risk: 'write',
    match: /^(mark|settle|clear)\s+(invoices?\s+)?(INV-\d+(?:\s*(?:,|and)\s*)*INV-\d+)?\s*(as\s+)?paid\b/i,
    run: (ctx, q) => {
      const found = (q.match(/INV-\d+/gi) || []).map((n) => n.toUpperCase());
      const unique = Array.from(new Set(found));
      if (!unique.length) return { kind: 'read', text: 'Say e.g. “Mark INV-0042 paid” or “Mark INV-0042, INV-0043 paid”.' };
      const invoices = ctx.invoices || [];
      const missing = unique.filter((n) => !invoices.find((i) => i.invoice_number.toUpperCase() === n));
      if (missing.length) return { kind: 'read', text: `No invoice ${missing.join(', ')} found.` };
      const total = unique.reduce((sum, n) => {
        const inv = invoices.find((i) => i.invoice_number.toUpperCase() === n)!;
        return sum + invoiceBalanceDue(inv);
      }, 0);
      return { kind: 'action', risk: 'write', pending: { kind: 'markPaid', amount: total, clinicHint: invoices[0].lab_name, invoiceNumbers: unique, method: 'bank' }, summary: `Mark ${unique.join(', ')} paid — PKR ${total.toLocaleString()} outstanding` };
    },
  },
  {
    id: 'printSettingsSave', description: 'Save the global print layout (paper, margins, font, logo, job-slip style)', risk: 'write',
    match: /^(set|change|update|use)\b.*\b(paper|a4|letter|margin|font|logo|job slip)/i,
    run: (ctx, q) => {
      if (ctx.user && !can(ctx.user, 'print:edit')) return { kind: 'read', text: 'Requires the “Edit print templates” permission.' };
      const patch: Record<string, unknown> = {};
      const paper = q.match(/\b(a4|letter)\b/i)?.[1]?.toLowerCase(); if (paper) patch.paper = paper;
      const margin = q.match(/\b(narrow|normal|wide)\b/i)?.[1]?.toLowerCase(); if (margin) patch.margin = margin;
      const fsize = q.match(/\b(compact|normal|large)\b/i)?.[1]?.toLowerCase(); if (fsize) patch.fontSize = fsize;
      if (/\b(hide|no|without|off)\s+logo|logo (off|hidden)/i.test(q)) patch.showLogo = false;
      else if (/\blogo\b/i.test(q)) patch.showLogo = true;
      const lp = q.match(/logo.{0,12}\b(left|center|right)\b/i)?.[1]?.toLowerCase(); if (lp) patch.logoPosition = lp;
      const js = q.match(/job slip(?: style)? (compact|full)/i)?.[1]?.toLowerCase(); if (js) patch.jobSlipStyle = js;
      if (!Object.keys(patch).length) return { kind: 'read', text: 'Say what to change — paper, margins, font, logo, or job-slip style.' };
      const next = { ...loadPrintSettings(), ...patch };
      return { kind: 'action', risk: 'write', pending: { kind: 'printSettingsSave', amount: 0, clinicHint: '', method: 'bank', printSettings: next }, summary: `Print settings — ${Object.entries(patch).map(([k, v]) => `${k}: ${v}`).join(', ')}` };
    },
  },
  {
    id: 'printSectionsSave', description: 'Set which sections print for a document kind (invoice/statement/receipt/job_slip)', risk: 'write',
    match: /^(set|change|update|reset)\b.*\b(invoice|job.?slip|receipt|statement)\b.*(section|print)|\b(invoice|job.?slip|receipt|statement) sections\b/i,
    run: (ctx, q) => {
      if (ctx.user && !can(ctx.user, 'print:edit')) return { kind: 'read', text: 'Requires the “Edit print templates” permission.' };
      const kindMatch = q.match(/job.?slip|receipt|statement|invoice/i)?.[0]?.toLowerCase().replace(/[ _]+/g, '_');
      const kind = (kindMatch === 'jobslip' ? 'job_slip' : kindMatch) as 'invoice' | 'job_slip' | 'receipt' | 'statement' | undefined;
      if (!kind) return { kind: 'read', text: 'Say which document — invoice, statement, receipt or job slip.' };
      const catalog = PRINT_SECTIONS[kind] || [];
      const ids = catalog.map((s) => s.id);
      if (/\b(reset|default)\b/.test(q)) {
        return { kind: 'action', risk: 'write', pending: { kind: 'printSectionsSave', amount: 0, clinicHint: '', method: 'bank', docKind: kind, sections: [...DEFAULT_ENABLED[kind]] }, summary: `Reset ${kind} sections to defaults` };
      }
      const hits = ids.filter((id) => q.toLowerCase().includes(id.toLowerCase()));
      let sections: string[] | null = null;
      if (/\b(only|just)\b/i.test(q)) sections = hits.length ? hits : null;
      else if (/\b(without|hide|exclude|remove|drop)\b/i.test(q)) {
        const current = loadDocumentSections(kind, DEFAULT_ENABLED[kind]);
        sections = current.filter((id) => !hits.includes(id));
      }
      if (!sections || !sections.length) return { kind: 'read', text: `Say e.g. “invoice sections only ${ids.slice(0, 3).join(', ')}” or “invoice sections without ${ids[0]}”. Options: ${ids.join(', ')}.` };
      return { kind: 'action', risk: 'write', pending: { kind: 'printSectionsSave', amount: 0, clinicHint: '', method: 'bank', docKind: kind, sections }, summary: `${kind} prints ${sections.join(', ')}` };
    },
  },
  {
    id: 'notificationConfigSave', description: 'Save notification cadence / escalation configuration', risk: 'write',
    match: /^(set|change|update|enable|disable|turn)\b.*\b(notif|reminder|remind|escalation|cadence)/i,
    run: (ctx, q) => {
      if (ctx.user && !can(ctx.user, 'notifications:edit')) return { kind: 'read', text: 'Requires the “Edit notification config” permission.' };
      const cfg = loadNotificationConfig();
      const was = JSON.stringify(cfg);
      const pay = /\b(payment|invoice|pending)\b/i.test(q);
      const FREQ: [RegExp, string][] = [
        [/1 day before/i, '1_day_before'], [/on (the )?due date/i, 'on_due_date'], [/1 day after/i, '1_day_after'],
        [/3 days after/i, '3_days_after'], [/7 days after/i, '7_days_after'], [/14 days after/i, '14_days_after'],
      ];
      const hits = FREQ.filter(([re]) => re.test(q)).map(([, id]) => id);
      if (FREQ.some(([re]) => re.test(q))) { if (pay) cfg.payment_frequencies = hits; else cfg.overdue_frequencies = hits; }
      if (/enable|turn on.*escalation/i.test(q)) cfg.enable_escalation = true;
      if (/disable|turn off.*escalation/i.test(q)) cfg.enable_escalation = false;
      const thr = q.match(/escalat\w*[^0-9]{0,20}(\d{1,2})\s*days?/i); if (thr) cfg.escalation_threshold_days = +thr[1];
      if (/\b(daily|every day)\b/i.test(q)) cfg.recurring_interval = 'daily';
      else if (/every 3 days/i.test(q)) cfg.recurring_interval = 'every_3_days';
      else if (/\b(weekly|every week)\b/i.test(q)) cfg.recurring_interval = 'weekly';
      if (JSON.stringify(cfg) === was) return { kind: 'read', text: 'Nothing recognized — say e.g. “payment reminders 1 day before and on due date, escalate after 7 days weekly”.' };
      return { kind: 'action', risk: 'write', pending: { kind: 'notificationConfigSave', amount: 0, clinicHint: '', method: 'bank', notification: cfg }, summary: `Notification config — ${pay ? 'payment' : 'overdue'} reminders ${(pay ? cfg.payment_frequencies : cfg.overdue_frequencies).join(', ') || 'unchanged'}; escalation ${cfg.enable_escalation ? 'on' : 'off'} after ${cfg.escalation_threshold_days}d, ${cfg.recurring_interval}` };
    },
  },
  {
    id: 'addClinicContact', description: 'Add a contact to a clinic (phone required; may be primary)', risk: 'write',
    match: /^(add|create|new)\s+(a\s+)?contact\s+/i,
    run: (ctx, q) => {
      const top = q.match(/^(?:add|create|new)\s+(?:a\s+)?contact\s+([A-Za-z][A-Za-z .'-]{1,59}?)\s+(?:to|for|at)\s+(.+)$/i);
      if (!top) return { kind: 'read', text: 'Say: “Add contact Ahmed Khan to Mir Dental, phone 0300-1122334, primary”.' };
      const name = top[1].trim();
      const rest = top[2];
      const clinic = clinicFor(ctx, rest);
      if (!clinic || 'ambiguous' in clinic) return { kind: 'read', text: 'Which clinic? Say, for example: “Add contact Ahmed Khan to Mir Dental”.' };
      const details = rest.slice(rest.toLowerCase().indexOf(String(clinic.name).toLowerCase()) + clinic.name.length);
      const phone = details.match(/(?:phone|mobile|cell|number)?\s*:?\s*(\+?\d[\d\s()-]{6,19}\d)/i)?.[1]?.trim();
      if (!phone) return { kind: 'read', text: 'A phone number is required: “Add contact Ahmed Khan to Mir Dental, phone 0300-1122334”.' };
      const email = details.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0];
      const role = details.match(/\brole\s*[:=]?\s*([A-Za-z -]{2,30})/i)?.[1]?.trim();
      const isPrimary = /\bprimary\b|\bmain contact\b/i.test(details);
      const repl = (ctx.labContacts || []).find((c) => c.lab_id === clinic.id && c.is_primary);
      const summary = `Add contact “${name}” (${phone}) for ${clinic.name}${isPrimary ? ' as PRIMARY' : ''}${repl ? ` — replaces primary “${repl.name}”` : ''}`;
      return { kind: 'action', risk: 'write', pending: { kind: 'addClinicContact', amount: 0, clinicHint: clinic.name, contactName: name, contactPhone: phone, contactEmail: email, contactRole: role, isPrimary, method: 'bank' }, summary };
    },
  },
  {
    id: 'addClinicAddress', description: 'Add a billing/shipping/lab address for a clinic', risk: 'write',
    match: /^(add|create|new)\s+(a\s+)?(billing|shipping|lab[_ ]?location)\s+address\s+for\s+/i,
    run: (ctx, q) => {
      const m = q.match(/^(?:add|create|new)\s+(?:a\s+)?(billing|shipping|lab[_ ]?location)\s+address\s+for\s+([A-Za-z0-9 ()&-]{2,60})\s*[:\-]\s*(.+)$/i);
      if (!m) return { kind: 'read', text: 'Say: “Add billing address for Mir Dental: 12 Main Blvd, Lahore, Punjab 54000, Pakistan”.' };
      const type = m[1].toLowerCase().replace(/ /g, '_') as 'billing' | 'shipping' | 'lab_location';
      const clinic = (ctx.labs || []).find((l) => folded(l.name).startsWith(folded(m[2]))) || clinicFor(ctx, m[2]);
      if (!clinic || 'ambiguous' in clinic) return { kind: 'read', text: 'Which clinic? Say, for example: “Add billing address for Mir Dental: …”.' };
      const parts = m[3].split(',').map((s) => s.trim()).filter(Boolean);
      const isDefault = /\bdefault\b|\bprimary\b/i.test(m[3]);
      const postal = m[3].match(/\b(\d{5,6})\b/)?.[1];
      const country = parts[parts.length - 1]?.replace(/\bdefault\b|\bprimary\b/gi, '').trim();
      const street = parts[0];
      const city = parts[1];
      const state = parts[2]?.replace(/\d{5,6}/g, '').trim();
      if (!street || !city || !state || !postal || !country || country.length < 2) {
        return { kind: 'read', text: 'Need street, city, state, postal code and country: “Add billing address for Mir Dental: 12 Main Blvd, Lahore, Punjab 54000, Pakistan”.' };
      }
      const repl = isDefault ? (ctx.labAddresses || []).find((a) => a.lab_id === clinic.id && a.type === type && a.is_default) : undefined;
      const summary = `Add ${type} address for ${clinic.name}: ${street}, ${city}${isDefault ? ' as DEFAULT' : ''}${repl ? ` — replaces existing default address “${repl.street}, ${repl.city}”` : ''}`;
      return { kind: 'action', risk: 'write', pending: { kind: 'addClinicAddress', amount: 0, clinicHint: clinic.name, addressType: type, street, city, state, postalCode: postal, country, isDefault, method: 'bank' }, summary };
    },
  },
  {
    id: 'addPricingOverride', description: 'Set or replace a clinic pricing override for a case type', risk: 'write',
    match: /^(add|set|create|update)\s+(a\s+)?(pricing override|price override|override)\s+for\s+/i,
    run: (ctx, q) => {
      const m = q.match(/^(?:add|set|create|update)\s+(?:a\s+)?(?:pricing override|price override|override)\s+for\s+([A-Za-z0-9 ()&-]{2,60})\s*[:\-]\s*(.+)$/i);
      if (!m) return { kind: 'read', text: 'Say: “Add pricing override for Mir Dental: Zirconia Crown at PKR 25,000”.' };
      const clinic = (ctx.labs || []).find((l) => folded(l.name).startsWith(folded(m[1]))) || clinicFor(ctx, m[1]);
      if (!clinic || 'ambiguous' in clinic) return { kind: 'read', text: 'Which clinic? Say, for example: “Add pricing override for Mir Dental: Zirconia Crown at PKR 25,000”.' };
      const tail = m[2];
      const ctM = tail.match(/^(.+?)\s+(?:at|@|for)\s+(?:pkr|rs\.?|rupees?)?\s*(\d[\d,]*)/i);
      if (!ctM) return { kind: 'read', text: 'Include the case type and price: “Add pricing override for Mir Dental: Zirconia Crown at PKR 25,000”.' };
      const wanted = ctM[1].trim().toLowerCase();
      const ct = (ctx.caseTypes || []).find((c) => c.name.toLowerCase() === wanted)
        || (ctx.caseTypes || []).find((c) => c.name.toLowerCase().includes(wanted));
      if (!ct) return { kind: 'read', text: `No case type “${ctM[1].trim()}”. Known: ${(ctx.caseTypes || []).slice(0, 4).map((c) => c.name).join(', ')}.` };
      const customPrice = Number(ctM[2].replace(/,/g, ''));
      const discount = tail.match(/(\d{1,2}(?:\.\d+)?)\s*%/)?.[1];
      const eff = tail.match(/(?:effective|from)\s*(\d{4}-\d{2}-\d{2})/i)?.[1];
      const repl = (ctx.pricingOverrides || []).find((p) => p.lab_id === clinic.id && p.case_type_id === ct.id);
      const summary = `Pricing override for ${ct.name} at ${clinic.name}: PKR ${customPrice.toLocaleString()} (std PKR ${ct.base_price.toLocaleString()})${repl ? ` — replaces existing override PKR ${repl.custom_price.toLocaleString()}` : ''}${discount ? `, ${discount}% off` : ''}`;
      return { kind: 'action', risk: 'write', pending: { kind: 'addPricingOverride', amount: 0, clinicHint: clinic.name, caseTypeId: ct.id, caseTypeName: ct.name, standardPrice: ct.base_price, customPrice, discountPercentage: discount ? Number(discount) : undefined, effectiveDate: eff, method: 'bank' }, summary };
    },
  },
  {
    id: 'closeMonth', description: 'Close a clinic month (statement of record; re-close anytime)', risk: 'write',
    match: /^(close|re-?close)\b.*\b(month|20\d{2}(-\d{2})?|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|october)\b/i,
    run: (ctx, q) => {
      const month = monthFromQuery(q) ?? q.match(/\b20\d{2}-(0[1-9]|1[0-2])\b/)?.[0] ?? null;
      if (!month) return { kind: 'read', text: 'Say which month — “Close October 2026 for Mir Dental”.' };
      const need = needClinic(ctx, q);
      if (need.error !== undefined) return { kind: 'read', text: need.error };
      const again = closedMonthFor(month).has(need.clinic.id);
      const rows = clinicMonthSnapshots({ invoices: ctx.invoices, advancePayments: ctx.advancePayments, accountAdjustments: ctx.accountAdjustments, labs: ctx.labs }, month);
      const row = rows.find((r) => r.lab_id === need.clinic.id);
      const line = row ? `billed PKR ${row.billed.toLocaleString()}, collected PKR ${row.collected.toLocaleString()}, closing PKR ${Math.abs(row.closing_balance).toLocaleString()}` : 'no postings this month';
      return { kind: 'action', risk: 'write', pending: { kind: 'closeMonth', amount: 0, clinicHint: need.clinic.name, labId: need.clinic.id, labName: need.clinic.name, month, method: 'bank' }, summary: `${again ? 'Re-close' : 'Close'} ${formatMonthLabel(month)} — ${line}. Nothing locks; corrections re-close` };
    },
  },
  {
    id: 'openCases', description: 'List the open (active, non-delivered, non-cancelled) cases', risk: 'read',
    match: /^(show|list)\s+(open\s+|current\s+|all\s+)?cases\b|^cases$/i,
    run: (ctx) => ({ kind: 'read', text: openCasesSummary(ctx) }),
  },
  {
    id: 'statement', description: 'Monthly/All Time statement for a clinic', risk: 'read',
    match: /statement|monthly/,
    run: (ctx, q) => {
      const need = needClinic(ctx, q);
      if (need.error !== undefined) return { kind: 'read', text: need.error };
      const period = periodFromQuery(q);
      const { from, to } = period.allTime ? { from: undefined, to: undefined } : period;
      return { kind: 'read', text: `For ${need.clinic.name}: ${getStatementAnswer(ctx, need.clinic.id, from, to, period.allTime)}` };
    },
  },
  {
    id: 'ledger', description: 'A clinic ledger window', risk: 'read',
    match: /ledger/,
    run: (ctx, q) => {
      const need = needClinic(ctx, q);
      if (need.error !== undefined) return { kind: 'read', text: need.error };
      const period = periodFromQuery(q);
      return { kind: 'read', text: `For ${need.clinic.name}: ${getLedgerAnswer(ctx, need.clinic.id, period.from, period.to)}` };
    },
  },
  {
    id: 'outstanding', description: 'Outstanding invoices for a clinic', risk: 'read',
    match: /overdue|unpaid|outstanding|baki/,
    run: (ctx, q) => {
      const need = needClinic(ctx, q);
      if (need.error !== undefined) return { kind: 'read', text: need.error };
      return { kind: 'read', text: getUnpaid(ctx, need.clinic.id, { overdue: /overdue/.test(folded(q)) }) };
    },
  },
  {
    id: 'advanceWallet', description: 'Advance wallet for a clinic', risk: 'read',
    match: /advance\s*(wallet|credit)|credits?\s*applied\s*to\s*us/i,
    run: (ctx, q) => {
      const need = needClinic(ctx, q);
      if (need.error !== undefined) return { kind: 'read', text: need.error };
      return { kind: 'read', text: `For ${need.clinic.name}: ${getAdvanceWallet(ctx, need.clinic.id)}` };
    },
  },
  {
    id: 'invoiceSearch', description: 'Find invoices', risk: 'read',
    match: /search|find|look up|invoice/,
    run: (ctx, q) => ({ kind: 'read', text: searchInvoicesInContext(ctx, q.replace(/^(search for|find|look up|invoice)\s*/i, '').trim() || q) }),
  },
  {
    id: 'codebase', description: 'Answer codebase/docs questions (RAG)', risk: 'read',
    match: /^how (does|do|is)\b|^what is\b|^where is\b|^why\b|codebase|help me/,
    run: async (_ctx, q) => {
      const docs = await getCodeAnswer(q);
      return docs ? { kind: 'read', text: `From the codebase and docs:\n${docs}` } : null;
    },
  },
  {
    id: 'recordPayment', description: 'Record a payment (PKR amount, clinic)', risk: 'write',
    match: /^(record|add|post|take|receive|collect|accept)\s+(a\s+)?(payment|receipt|collection)\b/i,
    run: (_ctx, q) => {
      const cmd = parseWriteCommand(q);
      if (!cmd || cmd.kind !== 'payment') return null;
      return { kind: 'action', risk: 'write', pending: cmd, summary: `Payment of PKR ${cmd.amount.toLocaleString()} for ${cmd.clinicHint}` };
    },
  },
  {
    id: 'recordAdvance', description: 'Record an advance deposit (PKR amount, clinic)', risk: 'write',
    match: /^(record|add|post)\s+(an\s+)?(advance|deposit)\b/i,
    run: (_ctx, q) => {
      const cmd = parseWriteCommand(q);
      if (!cmd || cmd.kind !== 'advance') return null;
      return { kind: 'action', risk: 'write', pending: cmd, summary: `Advance deposit of PKR ${cmd.amount.toLocaleString()} for ${cmd.clinicHint}` };
    },
  },
  {
    id: 'createClinic', description: 'Create a new clinic (with duplicate detection)', risk: 'write',
    match: /^(add|create|new|make)\s+(a\s+)?(clinic|lab)\b/i,
    run: (ctx, q) => {
      const cmd = parseWriteCommand(q);
      if (!cmd || cmd.kind !== 'createClinic') return null;
      const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const wanted = norm(cmd.clinicHint);
      const existing = (ctx.labs || []).find((l) => norm(l.name) === wanted);
      if (existing) {
        return { kind: 'read', text: `Clinic “${existing.name}” already exists — I will not duplicate it. Say “Open labs” to view it or “Update doctor for ${existing.name} to <name>” if you meant to change it.` };
      }
      return { kind: 'action', risk: 'write', pending: cmd, summary: `Create clinic “${cmd.clinicHint}”` };
    },
  },
  {
    id: 'cancelCase', description: 'Cancel a case', risk: 'write',
    match: /^cancel\s+(the\s+)?(case\s*)?(DS-\d+)\b/i,
    run: (_ctx, q) => {
      const m = q.match(/(DS-\d+)/i);
      if (!m) return { kind: 'read', text: 'Say which case — e.g. “Cancel case DS-0393”.' };
      return { kind: 'action', risk: 'write', pending: { kind: 'setCaseStatus', amount: 0, clinicHint: m[1].toUpperCase(), caseNumber: m[1].toUpperCase(), targetStatus: 'cancelled', method: 'bank' }, summary: `Confirm: Cancel case ${m[1].toUpperCase()}` };
    },
  },
  {
    id: 'setCaseStatus', description: 'Move a case to another workflow stage (ready/delivered/QC/…)', risk: 'write',
    match: /^(mark|move|set|advance|change|cancel|put|route|send|place|shift)\s+(the\s+)?(case\s*)?(DS-\d+)\s*(to|as|on|into)?\s*(draft|received|in progress|in_progress|qc|quality|ready|delivered|revision|rework|cancelled)\b.*$/i,
    run: (_ctx, q) => {
      const cancelOnly = q.match(/^cancel\s+(the\s+)?(case\s*)?(DS-\d+)\b/i);
      if (cancelOnly) {
        const caseNumber = cancelOnly[3].toUpperCase();
        return { kind: 'action', risk: 'write', pending: { kind: 'setCaseStatus', amount: 0, clinicHint: caseNumber, caseNumber, targetStatus: 'cancelled', method: 'bank' }, summary: `Confirm: Cancel case ${caseNumber}` };
      }
      const m = q.match(/DS-\d+/i);
      const statusWord = q.match(/(draft|received|in progress|in_progress|qc|quality|ready|delivered|revision|rework|cancelled)/i)?.[1]?.toLowerCase();
      const map: Record<string, string> = {
        'draft': 'draft', 'received': 'received', 'in progress': 'in_progress', 'in_progress': 'in_progress',
        'qc': 'qc', 'quality': 'qc', 'ready': 'ready', 'delivered': 'delivered',
        'revision': 'revision', 'rework': 'revision', 'cancelled': 'cancelled',
      };
      const target = map[statusWord || ''];
      if (!m || !target) return { kind: 'read', text: 'Say which case and which stage, e.g. “Mark case DS-0393 ready”.' };
      const caseNumber = m[0].toUpperCase();
      return { kind: 'action', risk: 'write', pending: { kind: 'setCaseStatus', amount: 0, clinicHint: caseNumber, caseNumber, targetStatus: target, method: 'bank' }, summary: `Confirm: Move case ${caseNumber} to “${target}”` };
    },
  },
  {
    id: 'updateClinicDoctor', description: 'Set the doctor for a clinic', risk: 'write',
    match: /^(set|update|change)\s+(the\s+)?doctor\s+(for|of|at)\s+([A-Za-z0-9 ()&-]{2,40})\s+(to|as)\s+(.+)$/i,
    run: (_ctx, q) => {
      const m = q.match(/^(?:set|update|change)\s+(?:the\s+)?doctor\s+(?:for|of|at)\s+([A-Za-z0-9 ()&-]{2,40})\s+(?:to|as)\s+(.+)$/i);
      const clinic = m?.[1]?.trim();
      const doctor = m?.[2]?.trim().replace(/^dr\.?\s*/i, 'Dr ');
      if (!clinic || !doctor || doctor.length < 2) return { kind: 'read', text: 'Say “Update doctor for Mir Dental to Dr Tariq”.' };
      return { kind: 'action', risk: 'write', pending: { kind: 'updateClinicDoctor', amount: 0, clinicHint: clinic, doctorName: doctor, method: 'bank' }, summary: `Set doctor for ${clinic} to ${doctor}` };
    },
  },
  {
    id: 'addCaseNote', description: 'Append a note to a case (500 chars)', risk: 'write',
    match: /^(add|post|log)\s+(a\s+)?note\s+(on|for|to)\s+(case\s+)?(DS-\d+)\s*[:\-]?\s*(.+)$/i,
    run: (_ctx, q) => {
      const m = q.match(/(DS-\d+)\s*[:\-]?\s*(.+)$/i);
      const caseNumber = m?.[1]?.toUpperCase();
      const text = (m?.[2] || '').trim().slice(0, 500);
      if (!caseNumber || !text) return { kind: 'read', text: 'Say: “Add note on case DS-0393: doctor approved wax-up by phone”.' };
      return { kind: 'action', risk: 'write', pending: { kind: 'addCaseNote', amount: 0, clinicHint: caseNumber, caseNumber, noteText: text, method: 'bank' }, summary: `Add note to ${caseNumber}: “${text}”` };
    },
  },
  {
    id: 'recordQc', description: 'Record a QC inspection (pass/fail)', risk: 'write',
    match: /^(record|log|file)?\s*qc\s+(pass|passed|fail|failed)\s+(case\s+)?(DS-\d+)(?:\s+(occlusion|shade_mismatch|margin_fit|contact_tightness|finish_polish|damage|dimension|other))?/i,
    run: (_ctx, q) => {
      const m = q.match(/qc\s+(pass|passed|fail|failed)\s+(case\s+)?(DS-\d+)(?:\s+(occlusion|shade_mismatch|margin_fit|contact_tightness|finish_polish|damage|dimension|other))?/i);
      if (!m) return { kind: 'read', text: 'Say: “QC pass case DS-0393” or “QC fail case DS-0393 margin_fit”.' };
      const result = /pass/i.test(m[1]) ? 'pass' : 'fail';
      const caseNumber = m[3].toUpperCase();
      const reason = m[4]?.toLowerCase();
      if (result === 'fail' && !reason) {
        return { kind: 'read', text: 'QC fail needs a reason: margin_fit, shade_mismatch, occlusion, contact_tightness, finish_polish, damage, dimension, other. Say: “QC fail case DS-0393 margin_fit”.' };
      }
      return { kind: 'action', risk: 'write', pending: { kind: 'recordQc', amount: 0, clinicHint: caseNumber, caseNumber, qcResult: result, qcReason: reason, method: 'bank' }, summary: `Record QC ${result.toUpperCase()}${reason ? ` (${reason})` : ''} for ${caseNumber}` };
    },
  },
  {
    id: 'archiveCase', description: 'Archive a delivered case', risk: 'write',
    match: /^(archive|complete|close)\s+(case\s+)?(DS-\d+)\b/i,
    run: (_ctx, q) => {
      const m = q.match(/(DS-\d+)/i);
      const caseNumber = m?.[1]?.toUpperCase();
      if (!caseNumber) return { kind: 'read', text: 'Say: “Archive case DS-0393” — works on delivered cases.' };
      return { kind: 'action', risk: 'write', pending: { kind: 'archiveCase', amount: 0, clinicHint: caseNumber, caseNumber, method: 'bank' }, summary: `Archive ${caseNumber}` };
    },
  },
  {
    id: 'updateClinicField', description: 'Edit a clinic field by voice (name, phone, email, address, city, doctor)', risk: 'write',
    match: /^(update|set|change|edit)\s+(?:the\s+)?(phone|email|address|doctor|name|city)\s+(?:for|of|at)\s+([A-Za-z0-9 ()&-]{2,40})\s+(?:to|as)\s+(.+)$/i,
    run: (_ctx, q) => {
      const m = q.match(/^(?:update|set|change|edit)\s+(?:the\s+)?(phone|email|address|doctor|name|city)\s+(?:for|of|at)\s+([A-Za-z0-9 ()&-]{2,40})\s+(?:to|as)\s+(.+)$/i);
      const field = (m?.[1] || '').toLowerCase() as 'phone' | 'email' | 'address' | 'doctor' | 'name' | 'city';
      const clinic = m?.[2]?.trim();
      const value = (m?.[3] || '').trim();
      if (!clinic || !value || value.length > 200) return { kind: 'read', text: 'Say: “Update phone for Mir Dental to 0300-1234567”.' };
      return { kind: 'action', risk: 'write', pending: { kind: 'updateClinicField', amount: 0, clinicHint: clinic, field, value, method: 'bank' }, summary: `Update ${field} for ${clinic} to “${value}”` };
    },
  },
  {
    id: 'help', description: 'List everything voice can do', risk: 'read',
    match: /^(what can you do|help|commands|capabilities|list commands|what are you capable of|how can you help)\b/,
    run: () => ({
      kind: 'read',
      text: [
        'Everything voice can do right now:',
        '• Open any screen: “Open dashboard”, “Open general ledger”, “Open statements”, “Open settings”',
        '• Read: due-today (“what is due today?”), morning briefing, walk me through a statement, cash collected today, overdue cases, standings, month close, clinic balance, statement, ledger, outstanding, advance wallet',
        '• Export: “Export invoices”, “Export transactions”',
        '• Clinics: add contacts, addresses, pricing overrides',
        '• Settings/print: “Invoice sections only brand, lineItems, totals”, “Print settings A4”, “Set notifications 1 day before”',
        '• Billing: “Record payment of PKR 5,000 for Mir Dental”, “Apply advance PKR 25,000 to INV-0042”, “Mark INV-0042 paid”, “Mark INV-0042, INV-0043 paid”',
        '• Cases: “show cases”, “DS-0001” (then just “ready” / “delivered” / “QC pass” / “archive”), “Mark case DS-0393 ready”',
        '• Write (amber confirmation): “Add clinic Mir Dental”, “Mark case DS-0393 ready”, “Update doctor for Mir Dental to Dr Tariq”, “Update phone for Mir Dental to 0300-1234567”, “Add note on case DS-0393”, “QC pass/fail case DS-0393”, “Archive case DS-0393”',
        '• Code/docs: “How does the monthly statement compute closing balance?”',
        'Destructive actions (void, delete, wipe) stay behind the app confirmation.',
      ].join('\n'),
    }),
  },
];

export const VOICE_TOOLS = tools;

const matchTools = (q: string): VoiceTool[] => {
  const f = folded(q);
  return tools.filter((t) => (t.match ? t.match.test(t.id === 'navigate' ? f : q) : true));
};

export const toolDescriptions = () => tools.map((t) => `• ${t.description}`).join('\n');

/** Dispatch a query through the registry. First matching tool wins; null = unmatched. */
export const runVoiceTool = async (ctx: VoiceToolContext, raw: string): Promise<VoiceToolResult> => {
  const q = (raw || '').trim();
  if (!q) return null;
  const candidates = matchTools(q);
  for (const tool of candidates) {
    const result = await tool.run(ctx, q);
    if (result) return result;
  }
  return null;
};

export const riskForResult = (result: VoiceToolResult): VoiceRisk =>
  (result && result.kind === 'action' ? result.risk : 'read') as VoiceRisk;
