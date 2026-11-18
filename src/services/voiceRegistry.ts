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
  searchInvoicesInContext, getCodeAnswer, clinicCandidates, narrateStatement, getTodayBriefing,
} from './voiceTools';
import { guessClinic } from './voiceTools';
import { parseWriteCommand, type WriteCommand } from './voiceWrite';
import type { Invoice, DentalCase, DentalLab, AdvancePayment } from '../types';

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

const NAV: Record<string, string> = {
  dashboard: 'dashboard', home: 'dashboard', overview: 'dashboard',
  case: 'cases', cases: 'cases', workstation: 'cases', 'dental workstation': 'cases', records: 'cases',
  labs: 'labs', lab: 'labs', clinics: 'labs', clinic: 'labs', 'dental clinics': 'labs',
  billing: 'billing', payments: 'billing', finance: 'billing', 'payment receive': 'billing',
  ledger: 'general_ledger', 'general ledger': 'general_ledger', books: 'general_ledger',
  statement: 'statements', statements: 'statements', monthly: 'statements', 'monthly statement': 'statements', vouchers: 'statements',
  insights: 'insights', insight: 'insights', analytics: 'insights', reports: 'analytics',
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
    match: /advance|wallet/,
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
    match: /^(record|add|post)\s+(a\s+)?(payment|receipt|collection)\b/i,
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
    id: 'setCaseStatus', description: 'Move a case to another workflow stage (ready/delivered/QC/…)', risk: 'write',
    match: /^(mark|move|set|advance|change)\s+(the\s+)?case\s*(DS-\d+)?\s*(to|as)?\s*(draft|received|in progress|in_progress|qc|quality|ready|delivered|revision|rework|cancelled)\b/i,
    run: (_ctx, q) => {
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
      return { kind: 'action', risk: 'write', pending: { kind: 'setCaseStatus', amount: 0, clinicHint: caseNumber, caseNumber, targetStatus: target, method: 'bank' }, summary: `Move case ${caseNumber} to “${target}”` };
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
        '• Read: morning briefing (“morning briefing”), walk me through a statement (“walk me through Mir Dental statement last month”), cash collected today, overdue cases, standings, month close, clinic balance, statement, ledger, outstanding, advance wallet',
        '• Search: “Find invoice INV-0042”',
        '• Write (amber confirmation): “Record payment of PKR 5,000 for Mir Dental”, “Record advance deposit of PKR 2,000”, “Add clinic Mir Dental”, “Mark case DS-0393 ready”, “Update doctor for Mir Dental to Dr Tariq”, “Update phone for Mir Dental to 0300-1234567”, “Add note on case DS-0393”, “QC pass/fail case DS-0393”, “Archive case DS-0393”',
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
