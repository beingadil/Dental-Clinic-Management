/**
 * Voice tool registry — ONE declarative table for everything the assistant may do.
 *
 * Per AGENTS.md: NO hardcoded phrases. Intent resolution happens exclusively
 * via LLM Tool Calling (Groq). Each tool declares:
 *   - id        → function name Groq calls
 *   - description → when/why Groq should use it (the only signal Groq sees)
 *   - risk        → read / write / destructive confirmation contract
 *   - run(ctx, args) → executes the tool using structured args from Groq
 *
 * Confirmation contract:
 *   read        → runs silently (deterministic engine output)
 *   write       → amber confirmation panel, operator says "confirm"/taps Confirm
 *   destructive → typed confirmation: operator must type the token shown
 *                 (e.g. "DELETE DS-0393"); spoken "confirm" never mutates.
 * Permission re-checks happen inside each command's own service layer (canPost etc.).
 */

import type { VoiceContext } from './voiceTools';
import {
  getAdvanceWallet, getCashCollected, getClinicBalance, getLedgerAnswer, getMonthCloseStatus,
  getOverdueCases, getStandings, getStatementAnswer, getUnpaid, periodFromQuery,
  searchInvoicesInContext, getCodeAnswer, clinicCandidates, narrateStatement, getTodayBriefing,
  getQcCaseState, getQcInspectionLog, getQcSummary, getQcGateCheck, getQcReworkList, qcReasonCodeList,
  getCaseDetail, getCaseSearch, getCaseTimeline, getCaseNotes, getCaseAttachments,
} from './voiceTools';
import { guessClinic } from './voiceTools';
import { type WriteCommand, type CaseUpdateFields } from './voiceWrite';
import type { Invoice, DentalCase, DentalLab, AdvancePayment } from '../types';
import {
  loadPrintSettings,
} from './printSettings';
import { loadNotificationConfig } from './notificationSettings';
import { closedMonthFor, clinicMonthSnapshots } from './monthClose';
import { formatMonthLabel } from './monthlyStatement';
import { PRINT_SECTIONS } from '../components/print/printRenderer';
import { can } from './permissions';
import { downloadCSV } from './csvExport';
import { collectAllPayments } from './ledgerDomain';
import { buildUnifiedTransactions, transactionCsvRows } from './transactionRegister';
import { invoiceBalanceDue } from './financeDomain';
import { formatDoctorName } from '../utils/doctorName';
import { REPORTS_ENTRY_ID, REPORTS_TABS } from '../components/common/financeTabs';
import { fillJarvisForm, jarvisFormTargets, type JarvisFormData } from './jarvisForms';
import {
  applyPatch,
  getAutoUpdatePhase,
  getLastUpdateCheck,
  runAutoUpdate,
  type AutoUpdatePhase,
} from './updateInstaller';
import { currentVersion } from './updateService';

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
  /** Structured args from Groq — no regex matching on raw text. */
  run: (ctx: VoiceToolContext, args: Record<string, unknown>) => VoiceToolResult | Promise<VoiceToolResult>;
}

const folded = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** One-line summary of the auto-update phase — used by the update tools. */
const summarizeUpdatePhase = (phase: AutoUpdatePhase): string => {
  switch (phase.state) {
    case 'idle': return 'never checked this session';
    case 'checking': return 'a check is running';
    case 'up_to_date': return `up to date (${currentVersion()})`;
    case 'available': return `a newer app version is available (${phase.version})`;
    case 'patch_available': return `a hot patch is available (${phase.display_version})`;
    case 'patch_applying': return `a hot patch is applying (${phase.base_version})`;
    case 'patched': return `the hot patch ${phase.display_version} is applied — the app is reloading`;
    case 'failed': return `an update failed: ${phase.message}`;
    case 'patch_failed': return `a hot patch failed (${phase.message}) — open Settings → Updates to retry`;
    case 'handed_off': return `the update was sent to your browser (${phase.message})`;
    default: return `update state: ${phase.state}`;
  }
};

const clinicFor = (ctx: VoiceToolContext, q: string) => guessClinic(ctx, q);
type ClinicNeed = { error: string; clinic?: undefined } | { clinic: DentalLab; error?: undefined };
const needClinic = (ctx: VoiceToolContext, q: string): ClinicNeed => {
  const hit = clinicFor(ctx, q);
  if (hit && 'ambiguous' in hit) return { error: `Which clinic — ${hit.ambiguous.join(', ')}?` };
  if (!hit) {
    const cands = clinicCandidates(ctx, q);
    return { error: cands.length > 1 ? `Which clinic — ${cands.map((c) => c.name).join(', ')}?` : 'Which clinic should I use?' };
  }
  return { clinic: hit };
};

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
  // ── Navigation ─────────────────────────────────────────────────────────
  {
    id: 'navigate', description: 'Open any screen in the app. Args: { view: string } — one of: dashboard, cases, labs, clinics, billing, ledger, statements, insights, catalog, notifications, settings, print-invoices', risk: 'read',
    run(_ctx, args) {
      const view = String(args.view || '').trim().toLowerCase().replace(/\s+/g, '_');
      const target = NAV[view];
      return view ? { kind: 'read', text: `Opening ${String(args.view || '')}.`, navigateTo: target } : null;
    },
  },
  // ── Read tools ─────────────────────────────────────────────────────────
  {
    id: 'cashCollected', description: 'Cash/advances collected in a window. Args: { period?: "today"|"this month"|"this week"|"last month"|"all time" }', risk: 'read',
    run: (ctx, args) => {
      const period = String(args.period || 'today');
      const today = new Date().toISOString().slice(0, 10);
      const from = period === 'today' ? today : periodFromQuery(period).from;
      const to = period === 'today' ? today : periodFromQuery(period).to;
      return { kind: 'read', text: getCashCollected(ctx, from, to) };
    },
  },
  {
    id: 'overdueCases', description: 'Cases overdue (delivery before today). No args.', risk: 'read',
    run: (ctx) => ({ kind: 'read', text: getOverdueCases(ctx) }),
  },
  {
    id: 'dueToday', description: 'Cases due today (priority-sorted) and overdue. No args.', risk: 'read',
    run: (ctx) => ({ kind: 'read', text: getTodayBriefing(ctx) }),
  },
  {
    id: 'standings', description: 'Clinic standings by receivable. No args.', risk: 'read',
    run: (ctx) => ({ kind: 'read', text: getStandings(ctx) }),
  },
  {
    id: 'monthClose', description: 'Month close status. Args: { month?: "YYYY-MM" }', risk: 'read',
    run: (_ctx, args) => ({ kind: 'read', text: getMonthCloseStatus(String(args.month || '')) }),
  },
  {
    id: 'clinicBalance', description: "A clinic's net balance (Dr/Cr). Args: { clinic: string }", risk: 'read',
    run: (ctx, args) => {
      const q = String(args.clinic || '');
      const need = needClinic(ctx, q);
      if (need.error !== undefined) return { kind: 'read', text: need.error };
      const bal = getClinicBalance(ctx, need.clinic.id);
      return { kind: 'read', text: `${need.clinic.name}: PKR ${Math.abs(bal.signed).toLocaleString()} ${bal.label}.` };
    },
  },
  {
    id: 'narrate', description: 'Walk through a statement or ledger in plain language. Args: { clinic: string, period?: string }', risk: 'read',
    run: (ctx, args) => {
      const q = String(args.clinic || '') + ' ' + String(args.period || '');
      if (!/(statement|ledger|all time|this month|last month|20\d{2})/i.test(q)) return null;
      const need = needClinic(ctx, q);
      if (need.error !== undefined) return { kind: 'read', text: need.error };
      const period = periodFromQuery(q);
      const { from, to } = period.allTime ? { from: undefined, to: undefined } : period;
      return { kind: 'read', text: narrateStatement(ctx, need.clinic.id, from, to) };
    },
  },
  {
    id: 'briefing', description: 'Morning briefing: cash, deliveries, outstanding, overdue. No args.', risk: 'read',
    run: (ctx) => ({ kind: 'read', text: getTodayBriefing(ctx) }),
  },
  {
    id: 'qc_state', description: 'DS-XXXX QC pass/fail/attempt count and open gate. Args: { caseNumber: string }', risk: 'read',
    run: (ctx, args) => {
      const num = String(args.caseNumber || '').match(/DS-\d+/i)?.[0]?.toUpperCase() ?? null;
      return { kind: 'read', text: getQcCaseState(ctx, num) };
    },
  },
  {
    id: 'qc_gate_check', description: 'DS-XXXX: may it ship (passed QC)? Args: { caseNumber: string }', risk: 'read',
    run: (ctx, args) => {
      const num = String(args.caseNumber || '').match(/DS-\d+/i)?.[0]?.toUpperCase() ?? null;
      if (!num) return { kind: 'read', text: 'Which case number do you mean? For example: DS-0393.' };
      return { kind: 'read', text: getQcGateCheck(ctx, num) };
    },
  },
  {
    id: 'qc_inspection_log', description: 'QC history for DS-XXXX. Args: { caseNumber: string }', risk: 'read',
    run: (ctx, args) => {
      const num = String(args.caseNumber || '').match(/DS-\d+/i)?.[0]?.toUpperCase() ?? null;
      return { kind: 'read', text: getQcInspectionLog(ctx, num) };
    },
  },
  {
    id: 'qc_metrics_summary', description: 'Lab-wide QC summary: first-pass, rework, failure reasons. No args.', risk: 'read',
    run: (ctx) => ({ kind: 'read', text: getQcSummary(ctx) }),
  },
  {
    id: 'qc_rework', description: 'Cases currently in rework. No args.', risk: 'read',
    run: (ctx) => ({ kind: 'read', text: getQcReworkList(ctx) }),
  },
  {
    id: 'qc_reasons', description: 'Top QC reason codes. No args.', risk: 'read',
    run: () => ({ kind: 'read', text: `Top QC reason codes: ${qcReasonCodeList()} — To see why a case failed, ask me: "Why did DS-XXXX fail?"` }),
  },
  {
    id: 'case_detail', description: 'DS-XXXX material, teeth, shade, procedure, prep, dates, status. Args: { caseNumber: string }', risk: 'read',
    run: (ctx, args) => {
      const num = String(args.caseNumber || '').match(/DS-\d+/i)?.[0]?.toUpperCase();
      if (!num) return { kind: 'read', text: 'Tell me the case number you want - for example: DS-0001 - or ask which material DS-0001 is.' };
      return { kind: 'read', text: getCaseDetail(ctx, num) };
    },
  },
  {
    id: 'case_search', description: 'Find cases by patient/type/clinic/teeth. Args: { query: string }', risk: 'read',
    run: (ctx, args) => {
      const q2 = String(args.query || '');
      return { kind: 'read', text: getCaseSearch(ctx, q2) };
    },
  },
  {
    id: 'case_timeline', description: 'DS-XXXX status history in plain words. Args: { caseNumber: string }', risk: 'read',
    run: (ctx, args) => {
      const num = String(args.caseNumber || '').match(/DS-\d+/i)?.[0]?.toUpperCase();
      return { kind: 'read', text: getCaseTimeline(ctx, num) };
    },
  },
  {
    id: 'case_notes_list', description: 'Notes for a case (author, time, text). Args: { caseNumber: string }', risk: 'read',
    run: (ctx, args) => {
      const num = String(args.caseNumber || '').match(/DS-\d+/i)?.[0]?.toUpperCase();
      return { kind: 'read', text: getCaseNotes(ctx, num) };
    },
  },
  {
    id: 'case_attachments', description: 'Files on a case. Args: { caseNumber: string }', risk: 'read',
    run: (ctx, args) => {
      const num = String(args.caseNumber || '').match(/DS-\d+/i)?.[0]?.toUpperCase();
      return { kind: 'read', text: getCaseAttachments(ctx, num) };
    },
  },
  {
    id: 'exportInvoicesCsv', description: 'Export the invoice list as a CSV file. No args.', risk: 'read',
    run: (ctx) => {
      if (ctx.user && !can(ctx.user, 'reports:export')) return { kind: 'read', text: 'Requires the "Export reports" permission.' };
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
    id: 'exportTransactionsCsv', description: 'Export the unified transaction register as CSV. No args.', risk: 'read',
    run: (ctx) => {
      if (ctx.user && !can(ctx.user, 'reports:export')) return { kind: 'read', text: 'Requires the "Export reports" permission.' };
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
    id: 'statement', description: 'Monthly/All Time statement for a clinic. Args: { clinic: string, period?: string }', risk: 'read',
    run: (ctx, args) => {
      const q = String(args.clinic || '') + ' ' + String(args.period || '');
      const need = needClinic(ctx, q);
      if (need.error !== undefined) return { kind: 'read', text: need.error };
      const period = periodFromQuery(q);
      const { from, to } = period.allTime ? { from: undefined, to: undefined } : period;
      return { kind: 'read', text: `For ${need.clinic.name}: ${getStatementAnswer(ctx, need.clinic.id, from, to, period.allTime)}` };
    },
  },
  {
    id: 'ledger', description: 'A clinic ledger window. Args: { clinic: string, period?: string }', risk: 'read',
    run: (ctx, args) => {
      const q = String(args.clinic || '') + ' ' + String(args.period || '');
      const need = needClinic(ctx, q);
      if (need.error !== undefined) return { kind: 'read', text: need.error };
      const period = periodFromQuery(q);
      return { kind: 'read', text: `For ${need.clinic.name}: ${getLedgerAnswer(ctx, need.clinic.id, period.from, period.to)}` };
    },
  },
  {
    id: 'outstanding', description: 'Outstanding invoices for a clinic. Args: { clinic: string }', risk: 'read',
    run: (ctx, args) => {
      const q = String(args.clinic || '');
      const need = needClinic(ctx, q);
      if (need.error !== undefined) return { kind: 'read', text: need.error };
      return { kind: 'read', text: getUnpaid(ctx, need.clinic.id, { overdue: /overdue/.test(q.toLowerCase()) }) };
    },
  },
  {
    id: 'advanceWallet', description: 'Advance wallet for a clinic. Args: { clinic: string }', risk: 'read',
    run: (ctx, args) => {
      const q = String(args.clinic || '');
      const need = needClinic(ctx, q);
      if (need.error !== undefined) return { kind: 'read', text: need.error };
      return { kind: 'read', text: `For ${need.clinic.name}: ${getAdvanceWallet(ctx, need.clinic.id)}` };
    },
  },
  {
    id: 'invoiceSearch', description: 'Find invoices. Args: { query: string }', risk: 'read',
    run: (ctx, args) => {
      const q = String(args.query || '');
      return { kind: 'read', text: searchInvoicesInContext(ctx, q.trim() || q) };
    },
  },
  {
    id: 'codebase', description: 'Answer codebase/docs questions (RAG). Args: { query: string }', risk: 'read',
    run: async (_ctx, args) => {
      const q = String(args.query || '');
      const docs = await getCodeAnswer(q);
      return docs ? { kind: 'read', text: `From the codebase and docs:\n${docs}` } : null;
    },
  },
  // ── Write tools (auto-executed; destructive keeps the typed-token gate) ───────────────────────────────────
  {
    id: 'recordPayment', description: 'Record a payment (PKR amount, clinic). Args: { clinic: string, amount: number, method?: "cash"|"bank"|"cheque", invoice?: string }', risk: 'write',
    run: (_ctx, args) => {
      const clinic = String(args.clinic || '');
      const amount = Number(args.amount || 0);
      if (!clinic || !amount || amount <= 0) return { kind: 'read', text: 'Which payment do you mean? Tell me the amount and the clinic - for example, a payment of PKR 5,000 for Mir Dental.' };
      const method = (args.method === 'cash' || args.method === 'bank' || args.method === 'cheque' ? args.method : 'bank') as 'cash' | 'bank' | 'cheque';
      const invoice = String(args.invoice || '');
      return {
        kind: 'action',
        risk: 'write',
        pending: { kind: 'payment', amount, clinicHint: clinic, invoiceNumber: invoice || undefined, method },
        summary: `Payment of PKR ${amount.toLocaleString()} for ${clinic}`,
      };
    },
  },
  {
    id: 'recordAdvance', description: 'Record an advance deposit (PKR amount, clinic). Args: { clinic: string, amount: number, method?: "cash"|"bank"|"cheque" }', risk: 'write',
    run: (_ctx, args) => {
      const clinic = String(args.clinic || '');
      const amount = Number(args.amount || 0);
      if (!clinic || !amount || amount <= 0) return { kind: 'read', text: 'Which advance deposit do you mean? Tell me the amount and the clinic - for example, an advance deposit of PKR 5,000 for Mir Dental.' };
      const method = (args.method === 'cash' || args.method === 'bank' || args.method === 'cheque' ? args.method : 'bank') as 'cash' | 'bank' | 'cheque';
      return {
        kind: 'action',
        risk: 'write',
        pending: { kind: 'advance', amount, clinicHint: clinic, method },
        summary: `Advance deposit of PKR ${amount.toLocaleString()} for ${clinic}`,
      };
    },
  },
  {
    id: 'applyAdvance', description: 'Apply advance credit to an invoice. Args: { clinic: string, amount: number, invoice: string }', risk: 'write',
    run: (ctx, args) => {
      const inv = (ctx.invoices || []).find((i) => i.invoice_number === String(args.invoice || ''));
      const amount = Number(args.amount || 0);
      if (!inv) return { kind: 'read', text: 'Which invoice? Tell me the amount and the invoice - for example, applying advance PKR 25,000 to INV-0042.' };
      if (!amount || amount <= 0) return { kind: 'read', text: 'How much do you want applied? For example: 25,000 to INV-0042.' };
      return { kind: 'action', risk: 'write', pending: { kind: 'applyAdvance', amount, clinicHint: inv.lab_name, invoiceNumber: inv.invoice_number, method: 'bank' }, summary: `Apply advance PKR ${amount.toLocaleString()} to ${inv.invoice_number}` };
    },
  },
  {
    id: 'markInvoicePaid', description: 'Mark one or more invoices as paid in full. Args: { invoiceNumbers: string[] }', risk: 'write',
    run: (ctx, args) => {
      const unique = Array.from(new Set((args.invoiceNumbers as string[] || []).map((n) => n.toUpperCase())));
      if (!unique.length) return { kind: 'read', text: 'Which invoices do you want marked paid? Tell me the numbers - for example: INV-0042, INV-0043.' };
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
    id: 'printSettingsSave', description: 'Save the global print layout (paper, margins, font, logo, job-slip style). Args: { paper?: string, margin?: string, fontSize?: string, showLogo?: boolean, logoPosition?: string, jobSlipStyle?: string }', risk: 'write',
    run: (ctx, args) => {
      if (ctx.user && !can(ctx.user, 'print:edit')) return { kind: 'read', text: 'Requires the "Edit print templates" permission.' };
      const patch: Record<string, unknown> = {};
      if (args.paper) patch.paper = args.paper;
      if (args.margin) patch.margin = args.margin;
      if (args.fontSize) patch.fontSize = args.fontSize;
      if (args.showLogo !== undefined) patch.showLogo = args.showLogo;
      else if (typeof args.showLogo === 'string') patch.showLogo = args.showLogo !== 'false';
      if (args.logoPosition) patch.logoPosition = args.logoPosition;
      if (args.jobSlipStyle) patch.jobSlipStyle = args.jobSlipStyle;
      if (!Object.keys(patch).length) return { kind: 'read', text: 'What do you want to change in the print sections - paper, margins, font, logo or job-slip style?' };
      const next = { ...loadPrintSettings(), ...patch };
      return { kind: 'action', risk: 'write', pending: { kind: 'printSettingsSave', amount: 0, clinicHint: '', method: 'bank', printSettings: next }, summary: `Print settings — ${Object.entries(patch).map(([k, v]) => `${k}: ${v}`).join(', ')}` };
    },
  },
  {
    id: 'printSectionsSave', description: 'Set which sections print for a document kind. Args: { docKind: "invoice"|"job_slip"|"receipt"|"statement", sections: string[] }', risk: 'write',
    run: (ctx, args) => {
      if (ctx.user && !can(ctx.user, 'print:edit')) return { kind: 'read', text: 'Requires the "Edit print templates" permission.' };
      const kind = String(args.docKind || '').replace(/[ _]+/g, '_') as 'invoice' | 'job_slip' | 'receipt' | 'statement' | undefined;
      if (!kind) return { kind: 'read', text: 'Which document do you want printed - invoice, statement, receipt or job slip?' };
      const catalog = PRINT_SECTIONS[kind] || [];
      const ids = catalog.map((s) => s.id);
      const sections = Array.isArray(args.sections) ? args.sections as string[] : [];
      if (!sections.length) return { kind: 'read', text: `Options: ${ids.join(', ')}.` };
      return { kind: 'action', risk: 'write', pending: { kind: 'printSectionsSave', amount: 0, clinicHint: '', method: 'bank', docKind: kind, sections }, summary: `${kind} prints ${sections.join(', ')}` };
    },
  },
  {
    id: 'notificationConfigSave', description: 'Save notification cadence / escalation configuration. Args: { type: "payment"|"overdue", frequencies: string[], escalation?: boolean, thresholdDays?: number, interval?: "daily"|"every_3_days"|"weekly" }', risk: 'write',
    run: (ctx, args) => {
      if (ctx.user && !can(ctx.user, 'notifications:edit')) return { kind: 'read', text: 'Requires the "Edit notification config" permission.' };
      const cfg = loadNotificationConfig();
      const pay = String(args.type || '') === 'payment';
      const frequencies = Array.isArray(args.frequencies) ? args.frequencies as string[] : [];
      if (frequencies.length) { if (pay) cfg.payment_frequencies = frequencies; else cfg.overdue_frequencies = frequencies; }
      if (args.escalation !== undefined) cfg.enable_escalation = args.escalation === true;
      if (args.thresholdDays) cfg.escalation_threshold_days = Number(args.thresholdDays);
      if (args.interval) cfg.recurring_interval = (args.interval === 'daily' || args.interval === 'every_3_days' || args.interval === 'weekly' ? args.interval : 'daily') as 'daily' | 'every_3_days' | 'weekly';
      return { kind: 'action', risk: 'write', pending: { kind: 'notificationConfigSave', amount: 0, clinicHint: '', method: 'bank', notification: cfg }, summary: `Notification config — ${pay ? 'payment' : 'overdue'} reminders ${frequencies.join(', ') || 'unchanged'}; escalation ${cfg.enable_escalation ? 'on' : 'off'} after ${cfg.escalation_threshold_days}d, ${cfg.recurring_interval}` };
    },
  },
  {
    id: 'addClinicContact', description: 'Add a contact to a clinic. Args: { clinic: string, contactName: string, contactPhone: string, contactEmail?: string, contactRole?: string, isPrimary?: boolean }', risk: 'write',
    run: (ctx, args) => {
      const clinic = clinicFor(ctx, String(args.clinic || ''));
      if (!clinic || 'ambiguous' in clinic) return { kind: 'read', text: 'Which clinic and what contact? Tell me the contact name and the clinic - for example, adding contact Ahmed Khan to Mir Dental.' };
      return {
        kind: 'action',
        risk: 'write',
        pending: {
          kind: 'addClinicContact',
          amount: 0,
          clinicHint: clinic.name,
          contactName: String(args.contactName || ''),
          contactPhone: String(args.contactPhone || ''),
          contactEmail: String(args.contactEmail || ''),
          contactRole: String(args.contactRole || ''),
          isPrimary: Boolean(args.isPrimary),
          method: 'bank',
        },
        summary: `Add contact "${args.contactName}" for ${clinic.name}`,
      };
    },
  },
  {
    id: 'addClinicAddress', description: 'Add a billing/shipping/lab address for a clinic. Args: { clinic: string, addressType: "billing"|"shipping"|"lab_location", street: string, city: string, state: string, postalCode: string, country: string, isDefault?: boolean }', risk: 'write',
    run: (ctx, args) => {
      const clinic = (ctx.labs || []).find((l) => folded(l.name).startsWith(folded(String(args.clinic || '')))) || clinicFor(ctx, String(args.clinic || ''));
      if (!clinic || 'ambiguous' in clinic) return { kind: 'read', text: 'Which clinic and what address? Tell me the address - for example, a billing address for Mir Dental: 1 Main Street.' };
      return {
        kind: 'action',
        risk: 'write',
        pending: {
          kind: 'addClinicAddress',
          amount: 0,
          clinicHint: clinic.name,
          addressType: (args.addressType === 'billing' || args.addressType === 'shipping' || args.addressType === 'lab_location' ? args.addressType : 'billing') as 'billing' | 'shipping' | 'lab_location',
          street: String(args.street || ''),
          city: String(args.city || ''),
          state: String(args.state || ''),
          postalCode: String(args.postalCode || ''),
          country: String(args.country || ''),
          isDefault: Boolean(args.isDefault),
          method: 'bank',
        },
        summary: `Add ${args.addressType} address for ${clinic.name}: ${args.street}, ${args.city}`,
      };
    },
  },
  {
    id: 'createClinic', description: 'Create a new clinic. Args: { name: string, doctor?: string, phone?: string }', risk: 'write',
    run: (_ctx, args) => {
      const name = String(args.name || '').trim();
      if (!name) return { kind: 'read', text: 'Which clinic do you want to add? Tell me the clinic name - for example: Mir Dental.' };
      return {
        kind: 'action',
        risk: 'write',
        pending: { kind: 'createClinic', amount: 0, clinicHint: name, doctorName: String(args.doctorName || ''), phone: String(args.phone || ''), method: 'bank' },
        summary: `Create clinic "${name}"`,
      };
    },
  },
  {
    id: 'addPricingOverride', description: 'Set a pricing override for a case type at a clinic. Args: { clinic: string, caseType: string, customPrice: number, discountPercentage?: number, effectiveDate?: string }', risk: 'write',
    run: (ctx, args) => {
      const clinic = (ctx.labs || []).find((l) => folded(l.name).startsWith(folded(String(args.clinic || '')))) || clinicFor(ctx, String(args.clinic || ''));
      if (!clinic || 'ambiguous' in clinic) return { kind: 'read', text: 'Which clinic and which case type? Tell me the case type and the price - for example: Zirconia Crown at PKR 25,000 for Mir Dental.' };
      const wanted = String(args.caseType || '').toLowerCase();
      const ct = (ctx.caseTypes || []).find((c) => c.name.toLowerCase() === wanted)
        || (ctx.caseTypes || []).find((c) => c.name.toLowerCase().includes(wanted));
      if (!ct) return { kind: 'read', text: `No case type "${args.caseType}". Known: ${(ctx.caseTypes || []).slice(0, 4).map((c) => c.name).join(', ')}.` };
      const customPrice = Number(args.customPrice || 0);
      return {
        kind: 'action',
        risk: 'write',
        pending: {
          kind: 'addPricingOverride',
          amount: 0,
          clinicHint: clinic.name,
          caseTypeId: ct.id,
          caseTypeName: ct.name,
          standardPrice: ct.base_price,
          customPrice,
          discountPercentage: args.discountPercentage ? Number(args.discountPercentage) : undefined,
          effectiveDate: String(args.effectiveDate || ''),
          method: 'bank',
        },
        summary: `Pricing override for ${ct.name} at ${clinic.name}: PKR ${customPrice.toLocaleString()}`,
      };
    },
  },
  {
    id: 'closeMonth', description: 'Close a clinic month. Args: { clinic: string, month: "YYYY-MM" }', risk: 'write',
    run: (ctx, args) => {
      const month = String(args.month || '');
      if (!month) return { kind: 'read', text: 'Which month do you want to close? Tell me the month and clinic - for example: October 2026 for Mir Dental.' };
      const need = needClinic(ctx, String(args.clinic || ''));
      if (need.error !== undefined) return { kind: 'read', text: need.error };
      const again = closedMonthFor(month).has(need.clinic.id);
      const rows = clinicMonthSnapshots({ invoices: ctx.invoices, advancePayments: ctx.advancePayments, accountAdjustments: ctx.accountAdjustments, labs: ctx.labs }, month);
      const row = rows.find((r) => r.lab_id === need.clinic.id);
      const line = row ? `billed PKR ${row.billed.toLocaleString()}, collected PKR ${row.collected.toLocaleString()}, closing PKR ${Math.abs(row.closing_balance).toLocaleString()}` : 'no postings this month';
      return { kind: 'action', risk: 'write', pending: { kind: 'closeMonth', amount: 0, clinicHint: need.clinic.name, labId: need.clinic.id, labName: need.clinic.name, month, method: 'bank' }, summary: `${again ? 'Re-close' : 'Close'} ${formatMonthLabel(month)} — ${line}. Nothing locks; corrections re-close` };
    },
  },
  {
    id: 'setCaseStatus', description: 'Move a case to another workflow stage. Args: { caseNumber: string, targetStatus: "draft"|"received"|"in_progress"|"qc"|"ready"|"delivered"|"revision"|"cancelled" }', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      const target = String(args.targetStatus || '').toLowerCase();
      if (!caseNumber || !target) return { kind: 'read', text: 'Which case do you want to move, and to which stage?' };
      return { kind: 'action', risk: 'write', pending: { kind: 'setCaseStatus', amount: 0, clinicHint: caseNumber, caseNumber, targetStatus: target, method: 'bank' }, summary: `Case ${caseNumber} moved to "${target}".` };
    },
  },
  {
    id: 'casePriority', description: 'Set the priority of one case. Args: { caseNumber: string, priority: "low"|"normal"|"high"|"urgent" }', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      let priority = String(args.priority || '').toLowerCase();
      if (priority === 'critical') priority = 'urgent';
      if (!caseNumber || !priority) return { kind: 'read', text: 'Which case and what priority? For example: set the priority of DS-0001 to high.' };
      return { kind: 'action', risk: 'write', pending: { kind: 'casePriority', amount: 0, clinicHint: caseNumber, caseNumber, priority, method: 'bank' }, summary: `Set priority of ${caseNumber} to "${priority}"` };
    },
  },
  {
    id: 'addCaseNote', description: 'Append a note to a case (500 chars). Args: { caseNumber: string, noteText: string }', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      const text = String(args.noteText || '').trim().slice(0, 500);
      if (!caseNumber || !text) return { kind: 'read', text: 'Which case do you want the note on, and what should it say?' };
      return { kind: 'action', risk: 'write', pending: { kind: 'addCaseNote', amount: 0, clinicHint: caseNumber, caseNumber, noteText: text, method: 'bank' }, summary: `Add note to ${caseNumber}: "${text}"` };
    },
  },
  {
    id: 'recordQc', description: 'Record a QC inspection (pass/fail). Args: { caseNumber: string, qcResult: "pass"|"fail", qcReason?: string }', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      const qcResult = (args.qcResult === 'pass' || args.qcResult === 'fail' ? args.qcResult : 'pass') as 'pass' | 'fail';
      const reason = String(args.qcReason || '');
      if (!caseNumber || !qcResult) return { kind: 'read', text: 'Which case and what QC result - pass or fail? If it failed, why: margin_fit, shade_mismatch, occlusion, contact_tightness, finish_polish, damage, dimension or other.' };
      if (qcResult === 'fail' && !reason) {
        return { kind: 'read', text: 'QC fail needs a reason: margin_fit, shade_mismatch, occlusion, contact_tightness, finish_polish, damage, dimension, other.' };
      }
      return { kind: 'action', risk: 'write', pending: { kind: 'recordQc', amount: 0, clinicHint: caseNumber, caseNumber, qcResult, qcReason: reason || undefined, method: 'bank' }, summary: `Record QC ${qcResult.toUpperCase()}${reason ? ` (${reason})` : ''} for ${caseNumber}` };
    },
  },
  {
    id: 'archiveCase', description: 'Archive a delivered case. Args: { caseNumber: string }', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      if (!caseNumber) return { kind: 'read', text: 'Which delivered case do you want to archive?' };
      return { kind: 'action', risk: 'write', pending: { kind: 'archiveCase', amount: 0, clinicHint: caseNumber, caseNumber, method: 'bank' }, summary: `Archive ${caseNumber}` };
    },
  },
  {
    id: 'caseUpdateFields', description: 'Update a case: priority, shade, material, instructions, teeth, delivery date. Args: { caseNumber: string, priority?: string, shade?: string, material?: string, instructions?: string, teeth?: number[], delivery_date?: string }', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      const fields: CaseUpdateFields = {};
      if (args.priority) fields.priority = String(args.priority).toLowerCase() === 'critical' ? 'urgent' : String(args.priority);
      if (args.shade) fields.shade = String(args.shade).toUpperCase().replace(/\s+/g, '');
      if (args.material) fields.material = String(args.material);
      if (args.instructions) fields.instructions = String(args.instructions).slice(0, 500);
      if (args.teeth) fields.teeth = Array.isArray(args.teeth) ? args.teeth as number[] : [];
      if (args.delivery_date) fields.delivery_date = String(args.delivery_date);
      if (!caseNumber) return { kind: 'read', text: 'Which case and which fields - priority, shade, material, instructions, delivery date or teeth?' };
      if (!Object.keys(fields).length) return { kind: 'read', text: 'Tell me which fields - priority, shade, material, instructions, delivery date or teeth.' };
      const summary = Object.entries(fields).map(([k, v]) => `${k} = ${v}`).join(', ');
      return { kind: 'action', risk: 'write', pending: { kind: 'caseUpdateFields', amount: 0, clinicHint: caseNumber, caseNumber, updateFields: fields, method: 'bank' }, summary: `Update ${caseNumber}: ${summary}` };
    },
  },
  {
    id: 'bulkCaseStatus', description: 'Move several case numbers to one stage at once. Args: { caseNumbers: string[], targetStatus: string }', risk: 'write',
    run: (_ctx, args) => {
      const nums = Array.from(new Set((args.caseNumbers as string[] || []).map((n) => n.toUpperCase())));
      const targetStatus = String(args.targetStatus || '').toLowerCase();
      if (!nums.length || !targetStatus) return { kind: 'read', text: 'Which cases do you want marked ready? Tell me the numbers - for example: DS-0001, DS-0002.' };
      const summary = `Move ${nums.length} case(s) (${nums.slice(0, 4).join(', ')}) to "${targetStatus}"`;
      return { kind: 'action', risk: 'write', pending: { kind: 'bulkCaseStatus', amount: 0, clinicHint: nums.join(', '), bulkCaseNumbers: nums, targetStatus, method: 'bank' }, summary };
    },
  },
  {
    id: 'restoreCase', description: 'Restore an archived case (unarchive it). Args: { caseNumber: string }', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      if (!caseNumber) return { kind: 'read', text: 'Which case do you want restored?' };
      return { kind: 'action', risk: 'write', pending: { kind: 'restoreCase', amount: 0, clinicHint: caseNumber, caseNumber, method: 'bank' }, summary: `Restore ${caseNumber} (unarchive)` };
    },
  },
  {
    id: 'caseTemplateSave', description: 'Save a case as a reusable case template. Args: { caseNumber: string, templateName: string }', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      const templateName = String(args.templateName || '').replace(/["']/g, '').trim();
      if (!caseNumber || !templateName) return { kind: 'read', text: 'Which case do you want saved as a template, and what template name?' };
      return { kind: 'action', risk: 'write', pending: { kind: 'caseTemplateSave', amount: 0, clinicHint: caseNumber, caseNumber, templateName, method: 'bank' }, summary: `Save template "${templateName}" from ${caseNumber}` };
    },
  },
  // ── Destructive tools (red typed confirm) ──────────────────────────────
  {
    id: 'deleteCase', description: 'Delete a case permanently. Args: { caseNumber: string }', risk: 'destructive',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      if (!caseNumber) return { kind: 'read', text: 'Which case do you want deleted?' };
      return { kind: 'action', risk: 'destructive', pending: { kind: 'deleteCase', amount: 0, clinicHint: caseNumber, caseNumber, method: 'bank' }, summary: `Delete ${caseNumber} permanently` };
    },
  },
  {
    id: 'purgeCase', description: 'Permanently delete a case and purge its data. Args: { caseNumber: string }', risk: 'destructive',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      if (!caseNumber) return { kind: 'read', text: 'Which case do you want purged? Its case, notes, attachments and QC data are removed for good.' };
      return { kind: 'action', risk: 'destructive', pending: { kind: 'purgeCase', amount: 0, clinicHint: caseNumber, caseNumber, method: 'bank' }, summary: `Purge ${caseNumber} — case, notes, attachments, QC data erased` };
    },
  },
  {
    id: 'cancelCase', description: 'Cancel a case. Args: { caseNumber: string }', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      if (!caseNumber) return { kind: 'read', text: 'Which case do you want cancelled?' };
      return { kind: 'action', risk: 'write', pending: { kind: 'setCaseStatus', amount: 0, clinicHint: caseNumber, caseNumber, targetStatus: 'cancelled', method: 'bank' }, summary: `Case ${caseNumber} cancelled.` };
    },
  },
  {
    id: 'updateClinicDoctor', description: 'Set the doctor for a clinic. Args: { clinic: string, doctorName: string }', risk: 'write',
    run: (_ctx, args) => {
      const clinic = String(args.clinic || '').trim();
      const doctor = String(args.doctorName || '').trim().replace(/^dr\.?\s*/i, 'Dr ');
      if (!clinic || !doctor || doctor.length < 2) return { kind: 'read', text: 'Which clinic and which doctor? Tell me the doctor’s name - for example: Dr Tariq at Mir Dental.' };
      return { kind: 'action', risk: 'write', pending: { kind: 'updateClinicDoctor', amount: 0, clinicHint: clinic, doctorName: doctor, method: 'bank' }, summary: `Set doctor for ${clinic} to ${doctor}` };
    },
  },
  {
    id: 'updateClinicField', description: 'Edit a clinic field by voice. Args: { clinic: string, field: "name"|"phone"|"email"|"address"|"city"|"doctor", value: string }', risk: 'write',
    run: (_ctx, args) => {
      const field = String(args.field || '').toLowerCase() as 'name' | 'phone' | 'email' | 'address' | 'city' | 'doctor';
      const clinic = String(args.clinic || '').trim();
      const value = String(args.value || '').trim();
      if (!clinic || !value || value.length > 200) return { kind: 'read', text: 'Which clinic and what phone number? For example: 0300-1234567 for Mir Dental.' };
      return { kind: 'action', risk: 'write', pending: { kind: 'updateClinicField', amount: 0, clinicHint: clinic, field, value, method: 'bank' }, summary: `Update ${field} for ${clinic} to "${value}"` };
    },
  },
  {
    id: 'updateStatus', description: 'Report the app update state: up to date, a newer version is downloading, a hot patch is available, patch applying, patched, or an update failed. No args.', risk: 'read',
    run: async () => {
      const phase = getAutoUpdatePhase();
      const last = getLastUpdateCheck();
      let text = summarizeUpdatePhase(phase);
      if (last) text += ` — last check: ${last.state}${last.version ? ` (version ${last.version})` : ''} at ${last.at}`.replace(/—/, ',');
      return { kind: 'read', text: `Update status — ${text}.` };
    },
  },
  {
    id: 'checkUpdates', description: 'Run the update check now (app auto-checks on open, but you can ask again). Returns the update state. No args.', risk: 'read',
    run: async () => {
      const phase = await runAutoUpdate();
      const last = getLastUpdateCheck();
      let text = summarizeUpdatePhase(phase);
      if (last) text += ` — last check: ${last.state}${last.version ? ` (version ${last.version})` : ''} at ${last.at}`.replace(/—/, ',');
      return { kind: 'read', text: `Checked now — ${text}.` };
    },
  },
  {
    id: 'applyPatch', description: 'Apply the hot patch if one is available. No-op otherwise. No args.', risk: 'write',
    run: async () => {
      const phase = getAutoUpdatePhase();
      if (phase.state !== 'patch_available') {
        return { kind: 'read', text: `No hot patch is available — update state: ${summarizeUpdatePhase(phase)}.` };
      }
      const after = await applyPatch();
      if (after.state === 'patched') return { kind: 'read', text: `Applying the hot patch…` };
      if (after.state === 'patch_applying') return { kind: 'read', text: 'Hot patch applying — the app will reload when done.' };
      return { kind: 'read', text: `Hot patch not applied — state: ${summarizeUpdatePhase(after)}.` };
    },
  },
  // ── Help ───────────────────────────────────────────────────────────────
  {
    id: 'fillForm', description: 'Pre-fill an open form by voice. Args: { target: string, data: object }. target is one of: "record-transaction-modal" (the Record Payment form: fields amount, method, date, referenceNumber), "case-detail-modal" (New Case form, create mode: fields patientName, caseTypeId, price, shade, deliveryDate, instructions). The form fills now — review it on screen, then press submit (or say "cancel"). Does not commit anything.', risk: 'write',
    run: (_ctx, args) => {
      const target = String(args.target || '');
      const data = (args.data && typeof args.data === 'object' ? args.data : {}) as JarvisFormData;
      if (!target) return { kind: 'read', text: 'Which form do you want to fill - the record-payment form or the case-detail form?' };
      const ok = fillJarvisForm(target, data);
      if (!ok) {
        const available = jarvisFormTargets();
        return { kind: 'read', text: `No form named "${target}" is open${available.length ? `. Open one first — available forms: ${available.join(', ')}` : ''}. Tell me which one you want.` };
      }
      return { kind: 'read', text: `I filled ${target} - review it on screen and press submit, or press cancel.` };
    },
  },
  {
    id: 'help', description: 'List everything voice can do. No args.', risk: 'read',
    run: () => ({
      kind: 'read',
      text: [
        'Everything voice can do right now:',
        '• Open any screen: "Open dashboard", "Open general ledger", "Open statements", "Open settings"',
        '• Read: due-today ("what is due today?"), morning briefing, walk me through a statement, cash collected today, overdue cases, standings, month close, clinic balance, statement, ledger, outstanding, advance wallet',
        '• Export: "Export invoices", "Export transactions"',
        '• Clinics: add contacts, addresses, pricing overrides',
        '• Settings/print: "Invoice sections only brand, lineItems, totals", "Print settings A4", "Set notifications 1 day before"',
        '• Billing: "Record payment of PKR 5,000 for Mir Dental", "Apply advance PKR 25,000 to INV-0042", "Mark INV-0042 paid", "Mark INV-0042, INV-0043 paid"',
        '• Cases: "show cases", "DS-0001" (then just "ready" / "delivered" / "QC pass" / "archive"), "Mark case DS-0393 ready", "update DS-0001 — shade A2, priority urgent", "set DS-0001 priority high", "mark DS-0001, DS-0002 ready", "restore DS-0001", "save DS-0001 as template “Follow-up”"',
        '• Delete (typed confirm): "delete DS-0001", "purge DS-0001"',
        '• Write (amber confirmation): "Add clinic Mir Dental", "Mark case DS-0393 ready", "Update doctor for Mir Dental to Dr Tariq", "Update phone for Mir Dental to 0300-1234567", "Add note on case DS-0393", "QC pass/fail case DS-0393", "Archive case DS-0393"',
        '• Code/docs: "How does the monthly statement compute closing balance?"',
        'Destructive actions (void, delete, wipe) stay behind the app confirmation.',
      ].join('\n'),
    }),
  },
];

export const VOICE_TOOLS = tools;

export const toolDescriptions = () => tools.map((t) => `• ${t.description}`).join('\n');

export const riskForResult = (result: VoiceToolResult): VoiceRisk =>
  (result && result.kind === 'action' ? result.risk : 'read') as VoiceRisk;

/** Machine-readable parameter hints per tool id — used to build Groq JSON Schema. */
export const TOOL_PARAMS: Record<string, { required: string[]; optional: string[] }> = {
  navigate: { required: ['view'], optional: [] },
  cashCollected: { required: [], optional: ['period'] },
  overdueCases: { required: [], optional: [] },
  dueToday: { required: [], optional: [] },
  standings: { required: [], optional: [] },
  monthClose: { required: [], optional: ['month'] },
  clinicBalance: { required: ['clinic'], optional: [] },
  narrate: { required: ['clinic'], optional: ['period'] },
  briefing: { required: [], optional: [] },
  qc_state: { required: ['caseNumber'], optional: [] },
  qc_gate_check: { required: ['caseNumber'], optional: [] },
  qc_inspection_log: { required: ['caseNumber'], optional: [] },
  qc_metrics_summary: { required: [], optional: [] },
  qc_rework: { required: [], optional: [] },
  qc_reasons: { required: [], optional: [] },
  case_detail: { required: ['caseNumber'], optional: [] },
  case_search: { required: ['query'], optional: [] },
  case_timeline: { required: ['caseNumber'], optional: [] },
  case_notes_list: { required: ['caseNumber'], optional: [] },
  case_attachments: { required: ['caseNumber'], optional: [] },
  exportInvoicesCsv: { required: [], optional: [] },
  exportTransactionsCsv: { required: [], optional: [] },
  statement: { required: ['clinic'], optional: ['period'] },
  ledger: { required: ['clinic'], optional: ['period'] },
  outstanding: { required: ['clinic'], optional: [] },
  advanceWallet: { required: ['clinic'], optional: [] },
  invoiceSearch: { required: ['query'], optional: [] },
  codebase: { required: ['query'], optional: [] },
  recordPayment: { required: ['clinic', 'amount'], optional: ['method', 'invoice'] },
  recordAdvance: { required: ['clinic', 'amount'], optional: ['method'] },
  applyAdvance: { required: ['invoice', 'amount'], optional: ['clinic'] },
  markInvoicePaid: { required: ['invoiceNumbers'], optional: [] },
  printSettingsSave: { required: [], optional: ['paper', 'margin', 'fontSize', 'showLogo', 'logoPosition', 'jobSlipStyle'] },
  printSectionsSave: { required: ['docKind', 'sections'], optional: [] },
  notificationConfigSave: { required: ['type', 'frequencies'], optional: ['escalation', 'thresholdDays', 'interval'] },
  addClinicContact: { required: ['clinic', 'contactName', 'contactPhone'], optional: ['contactEmail', 'contactRole', 'isPrimary'] },
  addClinicAddress: { required: ['clinic', 'addressType', 'street', 'city', 'state', 'postalCode', 'country'], optional: ['isDefault'] },
  createClinic: { required: ['name'], optional: ['doctor', 'phone'] },
  addPricingOverride: { required: ['clinic', 'caseType', 'customPrice'], optional: ['discountPercentage', 'effectiveDate'] },
  closeMonth: { required: ['clinic', 'month'], optional: [] },
  setCaseStatus: { required: ['caseNumber', 'targetStatus'], optional: [] },
  casePriority: { required: ['caseNumber', 'priority'], optional: [] },
  addCaseNote: { required: ['caseNumber', 'noteText'], optional: [] },
  recordQc: { required: ['caseNumber', 'qcResult'], optional: ['qcReason'] },
  archiveCase: { required: ['caseNumber'], optional: [] },
  caseUpdateFields: { required: ['caseNumber'], optional: ['priority', 'shade', 'material', 'instructions', 'teeth', 'delivery_date'] },
  bulkCaseStatus: { required: ['caseNumbers', 'targetStatus'], optional: [] },
  restoreCase: { required: ['caseNumber'], optional: [] },
  caseTemplateSave: { required: ['caseNumber', 'templateName'], optional: [] },
  deleteCase: { required: ['caseNumber'], optional: [] },
  purgeCase: { required: ['caseNumber'], optional: [] },
  cancelCase: { required: ['caseNumber'], optional: [] },
  updateClinicDoctor: { required: ['clinic', 'doctorName'], optional: [] },
  updateClinicField: { required: ['clinic', 'field', 'value'], optional: [] },
  fillForm: { required: ['target', 'data'], optional: [] },
  updateStatus: { required: [], optional: [] },
  checkUpdates: { required: [], optional: [] },
  applyPatch: { required: [], optional: [] },
  help: { required: [], optional: [] },
};
