/**
 * Voice tool registry - ONE declarative table for everything the assistant may do.
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
  getCaseDetail, getCaseSearch, getCaseTimeline, getCaseNotes, getCaseAttachments, getCaseNotesSearch,
  getCaseCount, getTodayCases, getCasesByClinic, getCasesByStatus,
  getPatientCases, getInvoiceByAmount, getClinicOutstanding, getQcPending,
  searchPatients, filterCases, searchInvoicesByAmount, generateReport, listUsers, switchTheme,
  getDeliveryCalendar, getCaseQueue, getShadeGuide, globalSearch,
  getCaseTypesList, getClinicalSpecs, getCatalogCategories, getSlaStatus, getAgingReport,
  getAdjustmentList, getPaymentList, getReconciliationQueue, getAuditTrail, getSyncStatus, getTemplateList,
  getVoucherList,
} from './voiceTools';
import { guessClinic } from './voiceTools';
import { selectCasesToAutoArchive } from '../context/hooks/autoArchive';
import { getTodayStr } from '../utils/dateUtils';
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
  /** Structured args from Groq - no regex matching on raw text. */
  run: (ctx: VoiceToolContext, args: Record<string, unknown>) => VoiceToolResult | Promise<VoiceToolResult>;
}

const folded = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** One-line summary of the auto-update phase - used by the update tools. */
const summarizeUpdatePhase = (phase: AutoUpdatePhase): string => {
  switch (phase.state) {
    case 'idle': return 'never checked this session';
    case 'checking': return 'a check is running';
    case 'up_to_date': return `up to date (${currentVersion()})`;
    case 'available': return `a newer app version is available (${phase.version})`;
    case 'patch_available': return `a hot patch is available (${phase.display_version})`;
    case 'patch_applying': return `a hot patch is applying (${phase.base_version})`;
    case 'patched': return `the hot patch ${phase.display_version} is applied - the app is reloading`;
    case 'failed': return `an update failed: ${phase.message}`;
    case 'patch_failed': return `a hot patch failed (${phase.message}) - open Settings → Updates to retry`;
    case 'handed_off': return `the update was sent to your browser (${phase.message})`;
    default: return `update state: ${phase.state}`;
  }
};

const clinicFor = (ctx: VoiceToolContext, q: string) => guessClinic(ctx, q);
type ClinicNeed = { error: string; clinic?: undefined } | { clinic: DentalLab; error?: undefined };
const needClinic = (ctx: VoiceToolContext, q: string): ClinicNeed => {
  const hit = clinicFor(ctx, q);
  if (hit && 'ambiguous' in hit) return { error: `Which clinic - ${hit.ambiguous.join(', ')}?` };
  if (!hit) {
    const cands = clinicCandidates(ctx, q);
    return { error: cands.length > 1 ? `Which clinic - ${cands.map((c) => c.name).join(', ')}?` : 'Which clinic should I use?' };
  }
  return { clinic: hit };
};

const NAV: Record<string, string> = {
  dashboard: 'dashboard', home: 'dashboard', overview: 'dashboard', landing: 'dashboard',
  case: 'cases', cases: 'cases', workstation: 'cases', dental_workstation: 'cases', records: 'cases',
  labs: 'labs', lab: 'labs', dental_clinics: 'labs', clinic: 'labs', clinics: 'labs',
  billing: 'billing', payments: 'billing', finance: 'billing', billing_and_invoices: 'billing',
  ledger: REPORTS_TABS[0].id, general_ledger: REPORTS_TABS[0].id, books: REPORTS_TABS[0].id,
  statement: REPORTS_TABS[1].id, statements: REPORTS_TABS[1].id, monthly: REPORTS_TABS[1].id,
  'monthly statement': REPORTS_TABS[1].id, vouchers: REPORTS_TABS[1].id,
  insights: REPORTS_TABS[2].id, insight: REPORTS_TABS[2].id, analytics: REPORTS_TABS[2].id,
  reports: REPORTS_ENTRY_ID,
  catalog: 'catalog', catalogue: 'catalog', pricing: 'catalog', price: 'catalog',
  price_list: 'catalog', invoices_and_pricing: 'catalog',
  notifications: 'notifications', alerts: 'notifications', inbox: 'notifications',
  system_inbox: 'notifications',
  settings: 'settings', preferences: 'settings', system_settings: 'settings', admin: 'settings',
  'print invoices': 'print-invoices', print_invoices: 'print-invoices', batch: 'print-invoices',
  'batch print': 'print-invoices',
};

/** Resolve the many phrasings of "open that screen" to a real view id. */
const resolveView = (raw: string): string | null => {
  const base = raw.trim().toLowerCase().replace(/[^a-z0-9 ]+/g, '');
  if (!base) return null;
  const candidates = [base, base.replace(/\s+/g, '_'), base.replace(/\s+/g, '')];
  for (const key of candidates) {
    if (NAV[key]) return NAV[key];
  }
  return null;
};

const tools: VoiceTool[] = [
  // ── Navigation ─────────────────────────────────────────────────────────
  {
    id: 'navigate', description: 'Open any screen in the app. Args: { view: string } — e.g. dashboard, cases, billing, labs, catalog, settings, print-invoices, ledger, statements, insights, notifications. Unresolved names are reported back, not silently dropped.', risk: 'read',
    run(_ctx, args) {
      const raw = String(args.view || '').trim();
      if (!raw) return null;
      const target = resolveView(raw);
      if (!target) {
        return {
          kind: 'read',
          text: `I could not find a screen called “${raw}”. The app screens are Dashboard, Dental Workstation (cases), Dental Clinics, Billing, Print Invoices, Catalog, Analytics & Reports, System Inbox or System Settings. Say one of those names.`,
        };
      }
      return { kind: 'read', text: `Opening ${raw}.`, navigateTo: target };
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
      if (!num) return { kind: 'read', text: 'Which case number — like DS-0393 — do you mean?' };
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
    run: () => ({ kind: 'read', text: `Top QC reason codes: ${qcReasonCodeList()} - Just ask: "Why did DS-XXXX fail?"` }),
  },
  {
    id: 'case_detail', description: 'DS-XXXX material, teeth, shade, procedure, prep, dates, status. Args: { caseNumber: string }', risk: 'read',
    run: (ctx, args) => {
      const num = String(args.caseNumber || '').match(/DS-\d+/i)?.[0]?.toUpperCase();
      if (!num) return { kind: 'read', text: 'Which case number — like DS-0001 — do you want? Or ask which material DS-0001 is.' };
      return { kind: 'read', text: getCaseDetail(ctx, num) };
    },
  },
  {
    id: 'case_search', description: 'Find cases by patient name, case type, clinic, doctor, material, shade, teeth, or case number. Args: { query: string }', risk: 'read',
    run: (ctx, args) => {
      const q2 = String(args.query || '');
      return { kind: 'read', text: getCaseSearch(ctx, q2) };
    },
  },
  {
    id: 'case_notes_search', description: 'Search case notes by content across all cases. Args: { query: string }', risk: 'read',
    run: (ctx, args) => {
      const q2 = String(args.query || '');
      return { kind: 'read', text: getCaseNotesSearch(ctx, q2) };
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
    id: 'case_count', description: 'Count cases (total, by clinic, or by status). Args: { clinic?, status? }', risk: 'read',
    run: (ctx, args) => {
      const clinicName = String(args.clinic || '');
      let clinicId: string | undefined;
      if (clinicName) {
        const lab = (ctx.labs || []).find((l) => l.name.toLowerCase().includes(clinicName.toLowerCase()));
        if (!lab) return { kind: 'read', text: `I could not find a clinic named "${clinicName}".` };
        clinicId = lab.id;
      }
      return { kind: 'read', text: getCaseCount(ctx, clinicId, status ? String(status) : undefined) };
    },
  },
  {
    id: 'cases_today', description: 'Cases due today (delivery date = today). Args: { clinic?: string } — clinic is optional clinic name', risk: 'read',
    run: (ctx, args) => {
      const clinicName = String(args.clinic || '');
      let clinicId: string | undefined;
      if (clinicName) {
        const lab = (ctx.labs || []).find((l) => l.name.toLowerCase().includes(clinicName.toLowerCase()));
        if (!lab) return { kind: 'read', text: `I could not find a clinic named "${clinicName}".` };
        clinicId = lab.id;
      }
      return { kind: 'read', text: getTodayCases(ctx, clinicId) };
    },
  },
  {
    id: 'cases_by_clinic', description: 'All active cases for a specific clinic. Args: { clinic: string } — clinic name', risk: 'read',
    run: (ctx, args) => {
      const clinicName = String(args.clinic || '');
      const lab = (ctx.labs || []).find((l) => l.name.toLowerCase().includes(clinicName.toLowerCase()));
      if (!lab) return { kind: 'read', text: `I could not find a clinic named "${clinicName}".` };
      return { kind: 'read', text: getCasesByClinic(ctx, lab.id) };
    },
  },
  {
    id: 'cases_by_status', description: 'All active cases in a given status. Args: { status: string } — status: draft|received|in_progress|qc|ready|delivered|revision|cancelled', risk: 'read',
    run: (ctx, args) => {
      const status = String(args.status || '');
      if (!status) return { kind: 'read', text: 'Which status? Like ready, delivered, qc, overdue, cancelled.' };
      return { kind: 'read', text: getCasesByStatus(ctx, status) };
    },
  },
  {
    id: 'patient_cases', description: 'Find cases by patient name (partial match). Args: { patientName: string }', risk: 'read',
    run: (ctx, args) => {
      const name = String(args.patientName || '');
      if (!name) return { kind: 'read', text: 'Which patient do you mean? Tell me the name.' };
      return { kind: 'read', text: getPatientCases(ctx, name) };
    },
  },
  {
    id: 'invoice_by_amount', description: 'Find invoices by amount. Args: { amount: number }', risk: 'read',
    run: (ctx, args) => {
      const amount = Number(args.amount || 0);
      if (!amount || amount <= 0) return { kind: 'read', text: 'Which amount? Tell me the PKR amount, like 5000 or 25000.' };
      return { kind: 'read', text: getInvoiceByAmount(ctx, amount) };
    },
  },
  {
    id: 'clinic_outstanding', description: 'Outstanding invoices for a clinic. Args: { clinic: string } — clinic name', risk: 'read',
    run: (ctx, args) => {
      const clinicName = String(args.clinic || '');
      const lab = (ctx.labs || []).find((l) => l.name.toLowerCase().includes(clinicName.toLowerCase()));
      if (!lab) return { kind: 'read', text: `I could not find a clinic named "${clinicName}".` };
      return { kind: 'read', text: getClinicOutstanding(ctx, lab.id) };
    },
  },
  {
    id: 'qc_pending', description: 'Cases needing QC attention (failed or not yet inspected). No args.', risk: 'read',
    run: (ctx) => ({ kind: 'read', text: getQcPending(ctx) }),
  },
  {
    id: 'patient_search', description: 'Search patients by name, phone, address, or case number across all clinics. Args: { query: string }', risk: 'read',
    run: (ctx, args) => {
      const q = String(args.query || '');
      if (!q) return { kind: 'read', text: 'What do you want to search for — a patient name, phone, or case number?' };
      return { kind: 'read', text: searchPatients(ctx, q) };
    },
  },
  {
    id: 'cases_filter', description: 'Filter cases by status, clinic, priority, date range, material, shade, or teeth. Args: { status?, clinic?, priority?, material?, shade?, teeth?, fromDate?, toDate? }', risk: 'read',
    run: (ctx, args) => {
      return { kind: 'read', text: filterCases(ctx, {
        status: args.status ? String(args.status) : undefined,
        clinic: args.clinic ? String(args.clinic) : undefined,
        priority: args.priority ? String(args.priority) : undefined,
        material: args.material ? String(args.material) : undefined,
        shade: args.shade ? String(args.shade) : undefined,
        teeth: args.teeth ? String(args.teeth) : undefined,
        fromDate: args.fromDate ? String(args.fromDate) : undefined,
        toDate: args.toDate ? String(args.toDate) : undefined,
      }) };
    },
  },
  {
    id: 'invoice_search_by_amount', description: 'Find invoices by amount range. Args: { minAmount?: number, maxAmount?: number }', risk: 'read',
    run: (ctx, args) => {
      const min = args.minAmount ? Number(args.minAmount) : undefined;
      const max = args.maxAmount ? Number(args.maxAmount) : undefined;
      if (!min && !max) return { kind: 'read', text: 'Which amount range? Like invoices over 50000 or between 10000 and 50000.' };
      return { kind: 'read', text: searchInvoicesByAmount(ctx, min, max) };
    },
  },
  {
    id: 'report_generate', description: 'Generate a monthly report for a clinic. Args: { clinic: string, month?: string } — month in YYYY-MM format', risk: 'read',
    run: (ctx, args) => {
      const clinicName = String(args.clinic || '');
      const clinic = (ctx.labs || []).find((l) => l.name.toLowerCase().includes(clinicName.toLowerCase()));
      if (!clinic) return { kind: 'read', text: `I could not find a clinic named "${clinicName}".` };
      const month = args.month ? String(args.month) : undefined;
      return { kind: 'read', text: generateReport(ctx, clinic.id, month) };
    },
  },
  {
    id: 'user_list', description: 'List system users. No args.', risk: 'read',
    run: () => ({ kind: 'read', text: listUsers() }),
  },
  {
    id: 'theme_switch', description: 'Switch the app theme. Args: { mode: "light"|"dark"|"system" }', risk: 'write',
    run: (_ctx, args) => {
      const mode = String(args.mode || '').toLowerCase();
      if (mode !== 'light' && mode !== 'dark' && mode !== 'system') return { kind: 'read', text: 'Which theme — light, dark, or system?' };
      const result = switchTheme(mode as 'light' | 'dark' | 'system');
      return { kind: 'read', text: result };
    },
  },
  {
    id: 'backup_create', description: 'Create a database backup. No args.', risk: 'read',
    run: () => ({ kind: 'read', text: 'I can create a backup for you. Go to Settings → Backup, or say "open settings" and navigate to the Backup tab.' }),
  },
  {
    id: 'delivery_calendar', description: 'Show cases due for delivery on a date. Args: { date?: string } — YYYY-MM-DD format, defaults to today', risk: 'read',
    run: (ctx, args) => {
      const date = args.date ? String(args.date) : undefined;
      return { kind: 'read', text: getDeliveryCalendar(ctx, date) };
    },
  },
  {
    id: 'shade_guide', description: 'Show the shade guide reference (VITA classical shades). No args.', risk: 'read',
    run: () => ({ kind: 'read', text: getShadeGuide() }),
  },
  {
    id: 'case_queue', description: 'Show cases ready for dispatch (ready or in QC status). No args.', risk: 'read',
    run: (ctx) => ({ kind: 'read', text: getCaseQueue(ctx) }),
  },
  {
    id: 'global_search', description: 'Search across all data — cases, invoices, clinics. Args: { query: string }', risk: 'read',
    run: (ctx, args) => {
      const q = String(args.query || '');
      if (!q) return { kind: 'read', text: 'What do you want to search for?' };
      return { kind: 'read', text: globalSearch(ctx, q) };
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
      if (!clinic || !amount || amount <= 0) return { kind: 'read', text: 'Sure — which payment? Tell me the amount and the clinic, like a payment of PKR 5,000 for Mir Dental.' };
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
      if (!clinic || !amount || amount <= 0) return { kind: 'read', text: 'Sure — which advance deposit? Tell me the amount and the clinic, like an advance deposit of PKR 5,000 for Mir Dental.' };
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
      if (!inv) return { kind: 'read', text: 'Sure — which invoice? Tell me the amount and the invoice, like applying advance PKR 25,000 to INV-0042.' };
      if (!amount || amount <= 0) return { kind: 'read', text: 'How much do you want applied — like 25,000 to INV-0042?' };
      return { kind: 'action', risk: 'write', pending: { kind: 'applyAdvance', amount, clinicHint: inv.lab_name, invoiceNumber: inv.invoice_number, method: 'bank' }, summary: `Apply advance PKR ${amount.toLocaleString()} to ${inv.invoice_number}` };
    },
  },
  {
    id: 'markInvoicePaid', description: 'Mark one or more invoices as paid in full. Args: { invoiceNumbers: string[] }', risk: 'write',
    run: (ctx, args) => {
      const unique = Array.from(new Set((args.invoiceNumbers as string[] || []).map((n) => n.toUpperCase())));
      if (!unique.length) return { kind: 'read', text: 'Sure — which invoices do you want marked paid? Tell me the numbers, like INV-0042, INV-0043.' };
      const invoices = ctx.invoices || [];
      const missing = unique.filter((n) => !invoices.find((i) => i.invoice_number.toUpperCase() === n));
      if (missing.length) return { kind: 'read', text: `No invoice ${missing.join(', ')} found.` };
      const total = unique.reduce((sum, n) => {
        const inv = invoices.find((i) => i.invoice_number.toUpperCase() === n)!;
        return sum + invoiceBalanceDue(inv);
      }, 0);
      return { kind: 'action', risk: 'write', pending: { kind: 'markPaid', amount: total, clinicHint: invoices[0].lab_name, invoiceNumbers: unique, method: 'bank' }, summary: `Mark ${unique.join(', ')} paid - PKR ${total.toLocaleString()} outstanding` };
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
      if (!Object.keys(patch).length) return { kind: 'read', text: 'What do you want to change in the print sections — paper, margins, font, logo or job-slip style?' };
      const next = { ...loadPrintSettings(), ...patch };
      return { kind: 'action', risk: 'write', pending: { kind: 'printSettingsSave', amount: 0, clinicHint: '', method: 'bank', printSettings: next }, summary: `Print settings - ${Object.entries(patch).map(([k, v]) => `${k}: ${v}`).join(', ')}` };
    },
  },
  {
    id: 'printSectionsSave', description: 'Set which sections print for a document kind. Args: { docKind: "invoice"|"job_slip"|"receipt"|"statement", sections: string[] }', risk: 'write',
    run: (ctx, args) => {
      if (ctx.user && !can(ctx.user, 'print:edit')) return { kind: 'read', text: 'Requires the "Edit print templates" permission.' };
      const kind = String(args.docKind || '').replace(/[ _]+/g, '_') as 'invoice' | 'job_slip' | 'receipt' | 'statement' | undefined;
      if (!kind) return { kind: 'read', text: 'Which document do you want printed — invoice, statement, receipt or job slip?' };
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
      return { kind: 'action', risk: 'write', pending: { kind: 'notificationConfigSave', amount: 0, clinicHint: '', method: 'bank', notification: cfg }, summary: `Notification config - ${pay ? 'payment' : 'overdue'} reminders ${frequencies.join(', ') || 'unchanged'}; escalation ${cfg.enable_escalation ? 'on' : 'off'} after ${cfg.escalation_threshold_days}d, ${cfg.recurring_interval}` };
    },
  },
  {
    id: 'addClinicContact', description: 'Add a contact to a clinic. Args: { clinic: string, contactName: string, contactPhone: string, contactEmail?: string, contactRole?: string, isPrimary?: boolean }', risk: 'write',
    run: (ctx, args) => {
      const clinic = clinicFor(ctx, String(args.clinic || ''));
      if (!clinic || 'ambiguous' in clinic) return { kind: 'read', text: 'Sure — which clinic and what contact? Tell me the contact name and the clinic, like adding contact Ahmed Khan to Mir Dental.' };
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
      if (!clinic || 'ambiguous' in clinic) return { kind: 'read', text: 'Sure — which clinic and what address? Like a billing address for Mir Dental: 1 Main Street.' };
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
      if (!name) return { kind: 'read', text: 'Sure — which clinic do you want to add? Tell me the name, like Mir Dental.' };
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
      if (!clinic || 'ambiguous' in clinic) return { kind: 'read', text: 'Sure — which clinic and which case type? Like Zirconia Crown at PKR 25,000 for Mir Dental.' };
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
      if (!month) return { kind: 'read', text: 'Sure — which month do you want to close? Like October 2026 for Mir Dental.' };
      const need = needClinic(ctx, String(args.clinic || ''));
      if (need.error !== undefined) return { kind: 'read', text: need.error };
      const again = closedMonthFor(month).has(need.clinic.id);
      const rows = clinicMonthSnapshots({ invoices: ctx.invoices, advancePayments: ctx.advancePayments, accountAdjustments: ctx.accountAdjustments, labs: ctx.labs }, month);
      const row = rows.find((r) => r.lab_id === need.clinic.id);
      const line = row ? `billed PKR ${row.billed.toLocaleString()}, collected PKR ${row.collected.toLocaleString()}, closing PKR ${Math.abs(row.closing_balance).toLocaleString()}` : 'no postings this month';
      return { kind: 'action', risk: 'write', pending: { kind: 'closeMonth', amount: 0, clinicHint: need.clinic.name, labId: need.clinic.id, labName: need.clinic.name, month, method: 'bank' }, summary: `${again ? 'Re-close' : 'Close'} ${formatMonthLabel(month)} - ${line}. Nothing locks; corrections re-close` };
    },
  },
  {
    id: 'setCaseStatus', description: 'Move a case to another workflow stage. Args: { caseNumber: string, targetStatus: "draft"|"received"|"in_progress"|"qc"|"ready"|"delivered"|"revision"|"cancelled" }', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      const target = String(args.targetStatus || '').toLowerCase();
      if (!caseNumber || !target) return { kind: 'read', text: 'Sure — which case do you want to move, and to which stage?' };
      return { kind: 'action', risk: 'write', pending: { kind: 'setCaseStatus', amount: 0, clinicHint: caseNumber, caseNumber, targetStatus: target, method: 'bank' }, summary: `Case ${caseNumber} moved to "${target}".` };
    },
  },
  {
    id: 'casePriority', description: 'Set the priority of one case. Args: { caseNumber: string, priority: "low"|"normal"|"high"|"urgent" }', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      let priority = String(args.priority || '').toLowerCase();
      if (priority === 'critical') priority = 'urgent';
      if (!caseNumber || !priority) return { kind: 'read', text: 'Sure — which case and what priority — like setting DS-0001 to high?' };
      return { kind: 'action', risk: 'write', pending: { kind: 'casePriority', amount: 0, clinicHint: caseNumber, caseNumber, priority, method: 'bank' }, summary: `Set priority of ${caseNumber} to "${priority}"` };
    },
  },
  {
    id: 'addCaseNote', description: 'Append a note to a case (500 chars). Args: { caseNumber: string, noteText: string }', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      const text = String(args.noteText || '').trim().slice(0, 500);
      if (!caseNumber || !text) return { kind: 'read', text: 'Sure — which case do you want the note on, and what should it say?' };
      return { kind: 'action', risk: 'write', pending: { kind: 'addCaseNote', amount: 0, clinicHint: caseNumber, caseNumber, noteText: text, method: 'bank' }, summary: `Add note to ${caseNumber}: "${text}"` };
    },
  },
  {
    id: 'recordQc', description: 'Record a QC inspection (pass/fail). Args: { caseNumber: string, qcResult: "pass"|"fail", qcReason?: string }', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      const qcResult = (args.qcResult === 'pass' || args.qcResult === 'fail' ? args.qcResult : 'pass') as 'pass' | 'fail';
      const reason = String(args.qcReason || '');
      if (!caseNumber || !qcResult) return { kind: 'read', text: 'Sure — which case and what QC result — pass or fail? If it failed, why: margin_fit, shade_mismatch, occlusion, contact_tightness, finish_polish, damage, dimension or other.' };
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
      if (!caseNumber) return { kind: 'read', text: 'Sure — which delivered case do you want to archive?' };
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
      if (!caseNumber) return { kind: 'read', text: 'Sure — which case and which fields — priority, shade, material, instructions, delivery date or teeth?' };
      if (!Object.keys(fields).length) return { kind: 'read', text: 'Sure — which fields — priority, shade, material, instructions, delivery date or teeth?' };
      const summary = Object.entries(fields).map(([k, v]) => `${k} = ${v}`).join(', ');
      return { kind: 'action', risk: 'write', pending: { kind: 'caseUpdateFields', amount: 0, clinicHint: caseNumber, caseNumber, updateFields: fields, method: 'bank' }, summary: `Update ${caseNumber}: ${summary}` };
    },
  },
  {
    id: 'bulkCaseStatus', description: 'Move several case numbers to one stage at once. Args: { caseNumbers: string[], targetStatus: string }', risk: 'write',
    run: (_ctx, args) => {
      const nums = Array.from(new Set((args.caseNumbers as string[] || []).map((n) => n.toUpperCase())));
      const targetStatus = String(args.targetStatus || '').toLowerCase();
      if (!nums.length || !targetStatus) return { kind: 'read', text: 'Sure — which cases do you want marked ready? Tell me the numbers, like DS-0001, DS-0002.' };
      const summary = `Move ${nums.length} case(s) (${nums.slice(0, 4).join(', ')}) to "${targetStatus}"`;
      return { kind: 'action', risk: 'write', pending: { kind: 'bulkCaseStatus', amount: 0, clinicHint: nums.join(', '), bulkCaseNumbers: nums, targetStatus, method: 'bank' }, summary };
    },
  },
  {
    id: 'restoreCase', description: 'Restore an archived case (unarchive it). Args: { caseNumber: string }', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      if (!caseNumber) return { kind: 'read', text: 'Sure — which case do you want restored?' };
      return { kind: 'action', risk: 'write', pending: { kind: 'restoreCase', amount: 0, clinicHint: caseNumber, caseNumber, method: 'bank' }, summary: `Restore ${caseNumber} (unarchive)` };
    },
  },
  {
    id: 'caseTemplateSave', description: 'Save a case as a reusable case template. Args: { caseNumber: string, templateName: string }', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      const templateName = String(args.templateName || '').replace(/["']/g, '').trim();
      if (!caseNumber || !templateName) return { kind: 'read', text: 'Sure — which case do you want saved as a template, and what template name?' };
      return { kind: 'action', risk: 'write', pending: { kind: 'caseTemplateSave', amount: 0, clinicHint: caseNumber, caseNumber, templateName, method: 'bank' }, summary: `Save template "${templateName}" from ${caseNumber}` };
    },
  },
  // ── Destructive tools (red typed confirm) ──────────────────────────────
  {
    id: 'deleteCase', description: 'Delete a case permanently. Args: { caseNumber: string }', risk: 'destructive',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      if (!caseNumber) return { kind: 'read', text: 'Sure — which case do you want deleted?' };
      return { kind: 'action', risk: 'destructive', pending: { kind: 'deleteCase', amount: 0, clinicHint: caseNumber, caseNumber, method: 'bank' }, summary: `Delete ${caseNumber} permanently` };
    },
  },
  {
    id: 'purgeCase', description: 'Permanently delete a case and purge its data. Args: { caseNumber: string }', risk: 'destructive',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      if (!caseNumber) return { kind: 'read', text: 'Sure — which case do you want purged? Its case, notes, attachments and QC data are removed for good.' };
      return { kind: 'action', risk: 'destructive', pending: { kind: 'purgeCase', amount: 0, clinicHint: caseNumber, caseNumber, method: 'bank' }, summary: `Purge ${caseNumber} - case, notes, attachments, QC data erased` };
    },
  },
  {
    id: 'cancelCase', description: 'Cancel a case. Args: { caseNumber: string }', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').toUpperCase();
      if (!caseNumber) return { kind: 'read', text: 'Sure — which case do you want cancelled?' };
      return { kind: 'action', risk: 'write', pending: { kind: 'setCaseStatus', amount: 0, clinicHint: caseNumber, caseNumber, targetStatus: 'cancelled', method: 'bank' }, summary: `Case ${caseNumber} cancelled.` };
    },
  },
  {
    id: 'updateClinicDoctor', description: 'Set the doctor for a clinic. Args: { clinic: string, doctorName: string }', risk: 'write',
    run: (_ctx, args) => {
      const clinic = String(args.clinic || '').trim();
      const doctor = String(args.doctorName || '').trim().replace(/^dr\.?\s*/i, 'Dr ');
      if (!clinic || !doctor || doctor.length < 2) return { kind: 'read', text: 'Sure — which clinic and which doctor? Tell me the doctor’s name, like Dr Tariq at Mir Dental.' };
      return { kind: 'action', risk: 'write', pending: { kind: 'updateClinicDoctor', amount: 0, clinicHint: clinic, doctorName: doctor, method: 'bank' }, summary: `Set doctor for ${clinic} to ${doctor}` };
    },
  },
  {
    id: 'updateClinicField', description: 'Edit a clinic field by voice. Args: { clinic: string, field: "name"|"phone"|"email"|"address"|"city"|"doctor", value: string }', risk: 'write',
    run: (_ctx, args) => {
      const field = String(args.field || '').toLowerCase() as 'name' | 'phone' | 'email' | 'address' | 'city' | 'doctor';
      const clinic = String(args.clinic || '').trim();
      const value = String(args.value || '').trim();
      if (!clinic || !value || value.length > 200) return { kind: 'read', text: 'Sure — which clinic and what phone number? Like 0300-1234567 for Mir Dental.' };
      return { kind: 'action', risk: 'write', pending: { kind: 'updateClinicField', amount: 0, clinicHint: clinic, field, value, method: 'bank' }, summary: `Update ${field} for ${clinic} to "${value}"` };
    },
  },
  {
    id: 'updateStatus', description: 'Report the app update state: up to date, a newer version is downloading, a hot patch is available, patch applying, patched, or an update failed. No args.', risk: 'read',
    run: async () => {
      const phase = getAutoUpdatePhase();
      const last = getLastUpdateCheck();
      let text = summarizeUpdatePhase(phase);
      if (last) text += ` - last check: ${last.state}${last.version ? ` (version ${last.version})` : ''} at ${last.at}`.replace(/-/, ',');
      return { kind: 'read', text: `Update status - ${text}.` };
    },
  },
  {
    id: 'checkUpdates', description: 'Run the update check now (app auto-checks on open, but you can ask again). Returns the update state. No args.', risk: 'read',
    run: async () => {
      const phase = await runAutoUpdate();
      const last = getLastUpdateCheck();
      let text = summarizeUpdatePhase(phase);
      if (last) text += ` - last check: ${last.state}${last.version ? ` (version ${last.version})` : ''} at ${last.at}`.replace(/-/, ',');
      return { kind: 'read', text: `Checked now - ${text}.` };
    },
  },
  {
    id: 'applyPatch', description: 'Apply the hot patch if one is available. No-op otherwise. No args.', risk: 'write',
    run: async () => {
      const phase = getAutoUpdatePhase();
      if (phase.state !== 'patch_available') {
        return { kind: 'read', text: `No hot patch is available - update state: ${summarizeUpdatePhase(phase)}.` };
      }
      const after = await applyPatch();
      if (after.state === 'patched') return { kind: 'read', text: `Applying the hot patch…` };
      if (after.state === 'patch_applying') return { kind: 'read', text: 'Hot patch applying - the app will reload when done.' };
      return { kind: 'read', text: `Hot patch not applied - state: ${summarizeUpdatePhase(after)}.` };
    },
  },
  // ── Help ───────────────────────────────────────────────────────────────
  {
    id: 'fillForm', description: 'Pre-fill an open form by voice. Args: { target: string, data: object }. target is one of: "record-transaction-modal" (the Record Payment form: fields amount, method, date, referenceNumber), "case-detail-modal" (New Case form, create mode: fields patientName, caseTypeId, price, shade, deliveryDate, instructions). The form fills now - review it on screen, then press submit (or say "cancel"). Does not commit anything.', risk: 'write',
    run: (_ctx, args) => {
      const target = String(args.target || '');
      const data = (args.data && typeof args.data === 'object' ? args.data : {}) as JarvisFormData;
      if (!target) return { kind: 'read', text: 'Which form do you want to fill — the record-payment form or the case-detail form?' };
      const ok = fillJarvisForm(target, data);
      if (!ok) {
        const available = jarvisFormTargets();
        return { kind: 'read', text: `No form named "${target}" is open${available.length ? `. Open one first - available forms: ${available.join(', ')}` : ''}. Tell me which one you want.` };
      }
      return { kind: 'read', text: `I filled ${target} - review it on screen and press submit, or press cancel.` };
    },
  },
  {
    id: 'help', description: 'List everything voice can do. No args.', risk: 'read',
    run: () => ({
      kind: 'read',
      text: 'Everything voice can do: open any screen (dashboard, cases, billing, ledger, settings), read balances/statements/ledgers, record payments/advances, update cases, manage clinics, export data, and more. Just ask naturally.',
    }),
  },
  // ── Case management extras ─────────────────────────────────────────────
  {
    id: 'delete_case_note', description: 'Delete a note from a case. Args: { caseNumber: string, noteText: string } — noteText is text from the note to delete.', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').trim().toUpperCase();
      const noteText = String(args.noteText || '').trim();
      if (!caseNumber || !noteText) return { kind: 'read', text: 'Which case, and which note text should I remove?' };
      return { kind: 'action', risk: 'write', summary: `Delete the note containing “${noteText.slice(0, 60)}” from ${caseNumber}?`, pending: { kind: 'deleteCaseNote', caseNumber, noteText, clinicHint: '', amount: 0, method: 'cash' } } as never;
    },
  },
  {
    id: 'delete_case_attachment', description: 'Delete a file attached to a case. Args: { caseNumber: string, fileName: string }.', risk: 'write',
    run: (_ctx, args) => {
      const caseNumber = String(args.caseNumber || '').trim().toUpperCase();
      const fileName = String(args.fileName || '').trim();
      if (!caseNumber || !fileName) return { kind: 'read', text: 'Which case, and which attachment should I remove?' };
      return { kind: 'action', risk: 'write', summary: `Delete attachment “${fileName}” from ${caseNumber}?`, pending: { kind: 'deleteCaseAttachment', caseNumber, fileName, clinicHint: '', amount: 0, method: 'cash' } } as never;
    },
  },
  {
    id: 'create_case_from_template', description: 'Create a new case from a saved template. Args: { templateName: string, clinic: string, patientName?: string, deliveryDate?: string }.', risk: 'write',
    run: (_ctx, args) => {
      const templateName = String(args.templateName || '').trim();
      const clinic = String(args.clinic || '').trim();
      if (!templateName || !clinic) return { kind: 'read', text: 'Which template and which clinic should the new case go to?' };
      return { kind: 'action', risk: 'write', summary: `Create a case from template “${templateName}” for ${clinic}?`, pending: { kind: 'createCaseFromTemplate', templateName, clinicHint: clinic, patientName: String(args.patientName || ''), deliveryDate: String(args.deliveryDate || ''), amount: 0, method: 'cash' } } as never;
    },
  },
  {
    id: 'bulk_archive', description: 'Archive all delivered cases older than 30 days in one action. No args.', risk: 'write',
    run: (ctx) => {
      const due = selectCasesToAutoArchive(ctx.cases || [], new Date(`${getTodayStr()}T00:00:00`));
      if (!due.length) return { kind: 'read', text: 'Nothing to archive — no delivered case is more than 30 days past delivery.' };
      return { kind: 'action', risk: 'write', summary: `Archive ${due.length} delivered case(s) older than 30 days?`, pending: { kind: 'bulkArchive', clinicHint: '', amount: 0, method: 'cash' } } as never;
    },
  },
  // ── Lab / clinic lifecycle ─────────────────────────────────────────────
  {
    id: 'delete_clinic', description: 'Delete a clinic and all its cases, invoices and history. Args: { clinic: string }. Destructive — requires the spoken token.', risk: 'destructive',
    run: (_ctx, args) => {
      const clinic = String(args.clinic || '').trim();
      if (!clinic) return { kind: 'read', text: 'Which clinic should I delete?' };
      return { kind: 'action', risk: 'destructive', summary: `Delete clinic “${clinic}” and everything under it?`, pending: { kind: 'deleteLab', clinicHint: clinic, caseNumber: clinic, amount: 0, method: 'cash' } } as never;
    },
  },
  {
    id: 'delete_clinic_contact', description: 'Remove a contact person from a clinic. Args: { clinic: string, contactName: string }.', risk: 'write',
    run: (_ctx, args) => {
      const clinic = String(args.clinic || '').trim();
      const contactName = String(args.contactName || '').trim();
      if (!clinic || !contactName) return { kind: 'read', text: 'Which clinic, and which contact should I remove?' };
      return { kind: 'action', risk: 'write', summary: `Remove contact “${contactName}” from ${clinic}?`, pending: { kind: 'deleteLabContact', clinicHint: clinic, contactName, amount: 0, method: 'cash' } } as never;
    },
  },
  {
    id: 'delete_clinic_address', description: 'Remove an address from a clinic. Args: { clinic: string, addressType: "billing"|"shipping"|"lab_location" }.', risk: 'write',
    run: (_ctx, args) => {
      const clinic = String(args.clinic || '').trim();
      const addressType = String(args.addressType || '').trim();
      if (!clinic || !addressType) return { kind: 'read', text: 'Which clinic, and which address type should I remove?' };
      return { kind: 'action', risk: 'write', summary: `Remove the ${addressType} address for ${clinic}?`, pending: { kind: 'deleteLabAddress', clinicHint: clinic, addressType: addressType as never, amount: 0, method: 'cash' } } as never;
    },
  },
  {
    id: 'delete_pricing_override', description: 'Remove a custom price override for a case type at a clinic. Args: { clinic: string, caseType: string }.', risk: 'write',
    run: (_ctx, args) => {
      const clinic = String(args.clinic || '').trim();
      const caseType = String(args.caseType || '').trim();
      if (!clinic || !caseType) return { kind: 'read', text: 'Which clinic, and which case type price should I reset?' };
      return { kind: 'action', risk: 'write', summary: `Remove the ${caseType} price override at ${clinic}?`, pending: { kind: 'deletePricingOverride', clinicHint: clinic, caseTypeName: caseType, amount: 0, method: 'cash' } } as never;
    },
  },
  {
    id: 'set_doctor_preferred_lab', description: 'Set which clinic/lab a doctor prefers. Args: { doctorName: string, clinic: string }.', risk: 'write',
    run: (_ctx, args) => {
      const doctorName = String(args.doctorName || '').trim();
      const clinic = String(args.clinic || '').trim();
      if (!doctorName || !clinic) return { kind: 'read', text: 'Which doctor, and which clinic should be their preferred lab?' };
      return { kind: 'action', risk: 'write', summary: `Set ${clinic} as the preferred lab for Dr ${doctorName}?`, pending: { kind: 'setDoctorPreferredLab', clinicHint: clinic, doctorName, amount: 0, method: 'cash' } } as never;
    },
  },
  {
    id: 'get_doctor_preferred_lab', description: 'Find a doctor’s preferred lab. Args: { doctorName: string }.', risk: 'read',
    run: (ctx, args) => {
      const q = String(args.doctorName || '').trim().toLowerCase();
      if (!q) return { kind: 'read', text: 'Which doctor?' };
      const hit = (ctx.doctorPreferences || []).find((d) => d.doctor_name.toLowerCase().includes(q));
      if (!hit) return { kind: 'read', text: `No preferred lab recorded for Dr ${String(args.doctorName || '')}.` };
      return { kind: 'read', text: `Dr ${hit.doctor_name} prefers ${hit.lab_name}.` };
    },
  },
  // ── Catalog extras ─────────────────────────────────────────────────────
  {
    id: 'case_types_list', description: 'List every case type in the catalog with its base price and lead time. No args.', risk: 'read',
    run: (ctx) => ({ kind: 'read', text: getCaseTypesList(ctx) }),
  },
  {
    id: 'clinical_specs', description: 'Clinical specifications for a case type — material system, shade guide, indications, contraindications, warranty. Args: { caseType: string }.', risk: 'read',
    run: (ctx, args) => ({ kind: 'read', text: getClinicalSpecs(ctx, String(args.caseType || '')) }),
  },
  {
    id: 'catalog_categories', description: 'List catalog categories with how many case types each has. No args.', risk: 'read',
    run: (ctx) => ({ kind: 'read', text: getCatalogCategories(ctx) }),
  },
  {
    id: 'sla_status', description: 'Show the current SLA turnaround promise (days) for each priority. No args.', risk: 'read',
    run: () => ({ kind: 'read', text: getSlaStatus() }),
  },
  {
    id: 'create_case_type', description: 'Add a new case type to the catalog. Args: { name: string, basePrice: number, category?, leadTimeDays?, material?, description? }.', risk: 'write',
    run: (_ctx, args) => {
      const name = String(args.name || '').trim();
      const basePrice = Number(args.basePrice || 0);
      if (!name || !basePrice) return { kind: 'read', text: 'What should the new case type be called, and what is its base price?' };
      return { kind: 'action', risk: 'write', summary: `Add case type “${name}” at PKR ${basePrice.toLocaleString()}?`, pending: { kind: 'addCaseType', caseTypeName: name, caseTypeBasePrice: basePrice, caseTypeCategory: String(args.category || ''), caseTypeLeaderDays: Number(args.leadTimeDays || 0), caseTypeMaterial: String(args.material || ''), caseTypeDescription: String(args.description || ''), clinicHint: '', amount: 0, method: 'cash' } } as never;
    },
  },
  {
    id: 'update_case_type', description: 'Change a case type’s price, category, lead time, material or description. Args: { name: string, basePrice?, category?, leadTimeDays?, material?, description? }.', risk: 'write',
    run: (_ctx, args) => {
      const name = String(args.name || '').trim();
      if (!name) return { kind: 'read', text: 'Which case type should I update?' };
      return { kind: 'action', risk: 'write', summary: `Update case type “${name}”?`, pending: { kind: 'updateCaseType', caseTypeName: name, caseTypeBasePrice: args.basePrice !== undefined ? Number(args.basePrice) : undefined, caseTypeCategory: args.category !== undefined ? String(args.category) : undefined, caseTypeLeaderDays: args.leadTimeDays !== undefined ? Number(args.leadTimeDays) : undefined, caseTypeMaterial: args.material !== undefined ? String(args.material) : undefined, caseTypeDescription: args.description !== undefined ? String(args.description) : undefined, clinicHint: '', amount: 0, method: 'cash' } } as never;
    },
  },
  {
    id: 'delete_case_type', description: 'Delete a case type from the catalog. Args: { name: string }. Destructive.', risk: 'destructive',
    run: (_ctx, args) => {
      const name = String(args.name || '').trim();
      if (!name) return { kind: 'read', text: 'Which case type should I delete?' };
      return { kind: 'action', risk: 'destructive', summary: `Delete case type “${name}” from the catalog?`, pending: { kind: 'deleteCaseType', caseTypeName: name, caseNumber: name, clinicHint: '', amount: 0, method: 'cash' } } as never;
    },
  },
  {
    id: 'set_sla_settings', description: 'Change the turnaround promise in days for a priority. Args: { urgent?, high?, normal?, low? } — at least one.', risk: 'write',
    run: (_ctx, args) => {
      const days = {
        urgent: args.urgent !== undefined ? Number(args.urgent) : undefined,
        high: args.high !== undefined ? Number(args.high) : undefined,
        normal: args.normal !== undefined ? Number(args.normal) : undefined,
        low: args.low !== undefined ? Number(args.low) : undefined,
      };
      if (Object.values(days).every((v) => v === undefined)) return { kind: 'read', text: 'Which priority should change, and to how many days?' };
      const parts = Object.entries(days).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} ${v}d`).join(', ');
      return { kind: 'action', risk: 'write', summary: `Set SLA turnaround: ${parts}?`, pending: { kind: 'slaSave', slaDays: days, clinicHint: '', amount: 0, method: 'cash' } } as never;
    },
  },
  // ── Billing depth ──────────────────────────────────────────────────────
  {
    id: 'aging_report', description: 'Outstanding-invoice ageing report — 0–30, 31–60, 61–90, 91–120 and 120+ day buckets. Args: { clinic?: string }.', risk: 'read',
    run: (ctx, args) => ({ kind: 'read', text: getAgingReport(ctx, args.clinic ? String(args.clinic) : undefined) }),
  },
  {
    id: 'adjustments_list', description: 'Recent account adjustments (credit notes, debit adjustments, refunds). Args: { clinic?: string }.', risk: 'read',
    run: (ctx, args) => ({ kind: 'read', text: getAdjustmentList(ctx, args.clinic ? String(args.clinic) : undefined) }),
  },
  {
    id: 'payments_list', description: 'Recent payments with their receipt numbers. Args: { clinic?: string }. Use this before editing or deleting a payment.', risk: 'read',
    run: (ctx, args) => ({ kind: 'read', text: getPaymentList(ctx, args.clinic ? String(args.clinic) : undefined) }),
  },
  {
    id: 'reconciliation_queue', description: 'Bank reconciliation queue — payments waiting to be matched or verified. No args.', risk: 'read',
    run: (ctx) => ({ kind: 'read', text: getReconciliationQueue(ctx) }),
  },
  {
    id: 'record_adjustment', description: 'Record an account adjustment: credit note, debit adjustment or refund. Args: { clinic: string, amount: number, type: "credit_note"|"debit_adjustment"|"refund", reason?: string }.', risk: 'write',
    run: (_ctx, args) => {
      const clinic = String(args.clinic || '').trim();
      const amount = Number(args.amount || 0);
      const type = String(args.type || '').trim() as 'credit_note' | 'debit_adjustment' | 'refund';
      if (!clinic || !amount || !['credit_note', 'debit_adjustment', 'refund'].includes(type)) return { kind: 'read', text: 'Which clinic, what amount, and is it a credit note, debit adjustment or refund?' };
      return { kind: 'action', risk: 'write', summary: `Record a ${type.replace(/_/g, ' ')} of PKR ${amount.toLocaleString()} for ${clinic}?`, pending: { kind: 'recordAdjustment', clinicHint: clinic, amount, adjustmentType: type, reason: String(args.reason || 'Recorded by voice'), method: 'cash' } } as never;
    },
  },
  {
    id: 'delete_adjustment', description: 'Delete an account adjustment. Args: { clinic: string, amount?: number, referenceNumber?: string }. List adjustments first if unsure.', risk: 'destructive',
    run: (_ctx, args) => {
      const clinic = String(args.clinic || '').trim();
      if (!clinic) return { kind: 'read', text: 'Which clinic’s adjustment should I delete, and what amount or reference?' };
      return { kind: 'action', risk: 'destructive', summary: `Delete the adjustment${args.amount ? ` of PKR ${Number(args.amount).toLocaleString()}` : ''} for ${clinic}?`, pending: { kind: 'deleteAdjustment', clinicHint: clinic, amount: Number(args.amount || 0), referenceNumber: String(args.referenceNumber || ''), caseNumber: `ADJ ${clinic}`, method: 'cash' } } as never;
    },
  },
  {
    id: 'delete_payment', description: 'Delete a payment receipt and reverse its allocation. Args: { receiptNumber: string }. Destructive.', risk: 'destructive',
    run: (_ctx, args) => {
      const receiptNumber = String(args.receiptNumber || '').trim();
      if (!receiptNumber) return { kind: 'read', text: 'Which receipt number should I delete? Say “list payments” first if you need the numbers.' };
      return { kind: 'action', risk: 'destructive', summary: `Delete payment ${receiptNumber}?`, pending: { kind: 'deletePayment', receiptNumber, caseNumber: receiptNumber, clinicHint: '', amount: 0, method: 'cash' } } as never;
    },
  },
  {
    id: 'update_payment', description: 'Change the amount on an existing payment receipt. Args: { receiptNumber: string, amount: number }.', risk: 'write',
    run: (_ctx, args) => {
      const receiptNumber = String(args.receiptNumber || '').trim();
      const amount = Number(args.amount || 0);
      if (!receiptNumber || !amount) return { kind: 'read', text: 'Which receipt, and what should the new amount be?' };
      return { kind: 'action', risk: 'write', summary: `Change payment ${receiptNumber} to PKR ${amount.toLocaleString()}?`, pending: { kind: 'updatePayment', receiptNumber, newAmount: amount, clinicHint: '', amount, method: 'cash' } } as never;
    },
  },
  {
    id: 'issue_credit_note', description: 'Issue a credit note against an invoice. Args: { clinic: string, invoice: string, amount: number, reason: string }.', risk: 'write',
    run: (_ctx, args) => {
      const clinic = String(args.clinic || '').trim();
      const invoiceNumber = String(args.invoice || '').trim().toUpperCase();
      const amount = Number(args.amount || 0);
      const reason = String(args.reason || '').trim();
      if (!clinic || !invoiceNumber || !amount || !reason) return { kind: 'read', text: 'Which clinic, invoice, amount and reason for the credit note?' };
      return { kind: 'action', risk: 'write', summary: `Issue a PKR ${amount.toLocaleString()} credit note on ${invoiceNumber} for ${clinic}?`, pending: { kind: 'issueCreditNote', clinicHint: clinic, invoiceNumber, amount, reason, method: 'cash' } } as never;
    },
  },
  {
    id: 'delete_invoice', description: 'Delete an invoice. Args: { invoiceNumber: string }. Destructive.', risk: 'destructive',
    run: (_ctx, args) => {
      const invoiceNumber = String(args.invoiceNumber || '').trim().toUpperCase();
      if (!invoiceNumber) return { kind: 'read', text: 'Which invoice number should I delete?' };
      return { kind: 'action', risk: 'destructive', summary: `Delete invoice ${invoiceNumber}?`, pending: { kind: 'deleteInvoice', invoiceNumber, caseNumber: invoiceNumber, clinicHint: '', amount: 0, method: 'cash' } } as never;
    },
  },
  {
    id: 'reconcile_payment', description: 'Mark a bank/cheque payment as reconciled against the bank statement. Args: { referenceNumber: string, notes?: string }.', risk: 'write',
    run: (_ctx, args) => {
      const referenceNumber = String(args.referenceNumber || '').trim();
      if (!referenceNumber) return { kind: 'read', text: 'Which payment reference should I reconcile?' };
      return { kind: 'action', risk: 'write', summary: `Mark payment ${referenceNumber} as reconciled?`, pending: { kind: 'reconcileItem', referenceNumber, reason: String(args.notes || ''), clinicHint: '', amount: 0, method: 'cash' } } as never;
    },
  },
  {
    id: 'flag_reconciliation', description: 'Flag a reconciliation exception on a payment (wrong amount, wrong reference). Args: { referenceNumber: string, reason: string }.', risk: 'write',
    run: (_ctx, args) => {
      const referenceNumber = String(args.referenceNumber || '').trim();
      const reason = String(args.reason || '').trim();
      if (!referenceNumber || !reason) return { kind: 'read', text: 'Which payment reference, and what is the exception?' };
      return { kind: 'action', risk: 'write', summary: `Flag ${referenceNumber} as a reconciliation exception — “${reason}”?`, pending: { kind: 'flagReconciliation', referenceNumber, reason, clinicHint: '', amount: 0, method: 'cash' } } as never;
    },
  },
  // ── Admin / diagnostics ────────────────────────────────────────────────
  {
    id: 'audit_trail', description: 'Show recent audit-trail events (who did what, when). Args: { limit?: number }.', risk: 'read',
    run: (ctx, args) => ({ kind: 'read', text: getAuditTrail(ctx, Number(args.limit || 8)) }),
  },
  {
    id: 'sync_status', description: 'Check whether the app is online, offline or running as the desktop build. No args.', risk: 'read',
    run: () => ({ kind: 'read', text: getSyncStatus() }),
  },
  {
    id: 'templates_list', description: 'List saved case templates. No args.', risk: 'read',
    run: (ctx) => ({ kind: 'read', text: getTemplateList(ctx) }),
  },
  // ── Saved vouchers (job slips / invoice log) ───────────────────────────
  {
    id: 'vouchers_list', description: 'List the saved voucher log — job slips and invoices already printed and logged. Args: { limit?: number }.', risk: 'read',
    run: (ctx, args) => ({ kind: 'read', text: getVoucherList(ctx, Number(args.limit || 8)) }),
  },
  {
    id: 'save_voucher', description: 'Log a voucher for a case — either a job slip or an invoice — into the saved voucher register. Args: { caseNumber: string, voucherType: "job_slip"|"invoice" }.', risk: 'write',
    run: (ctx, args) => {
      const caseNumber = String(args.caseNumber || '').trim().toUpperCase();
      const voucherType = String(args.voucherType || 'job_slip').trim() as 'job_slip' | 'invoice';
      if (!caseNumber) return { kind: 'read', text: 'Which case should I log a voucher for?' };
      if (!['job_slip', 'invoice'].includes(voucherType)) return { kind: 'read', text: 'Should that be a job slip or an invoice voucher?' };
      const target = (ctx.cases || []).find((c) => c.case_number.toUpperCase() === caseNumber);
      if (!target) return { kind: 'read', text: `I can’t find case ${caseNumber}.` };
      return { kind: 'action', risk: 'write', summary: `Log a ${voucherType.replace(/_/g, ' ')} voucher for ${caseNumber} (${target.lab_name})?`, pending: { kind: 'saveVoucher', caseNumber, clinicHint: target.lab_name, voucherType, amount: 0, method: 'cash' } } as never;
    },
  },
  {
    id: 'delete_voucher', description: 'Delete a saved voucher from the register. Args: { voucherNumber: string }. Destructive.', risk: 'destructive',
    run: (_ctx, args) => {
      const voucherNumber = String(args.voucherNumber || '').trim().toUpperCase();
      if (!voucherNumber) return { kind: 'read', text: 'Which voucher number should I delete?' };
      return { kind: 'action', risk: 'destructive', summary: `Delete voucher ${voucherNumber} from the register?`, pending: { kind: 'deleteVoucher', voucherNumber, caseNumber: voucherNumber, clinicHint: '', amount: 0, method: 'cash' } } as never;
    },
  },
];

export const VOICE_TOOLS = tools;

export const toolDescriptions = () => tools.map((t) => `• ${t.description}`).join('\n');

export const riskForResult = (result: VoiceToolResult): VoiceRisk =>
  (result && result.kind === 'action' ? result.risk : 'read') as VoiceRisk;

/** Machine-readable parameter hints per tool id - used to build Groq JSON Schema. */
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
