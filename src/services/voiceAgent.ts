/**
 * Agentic loop — the planner.
 *
 * The registry is the single source of truth for what voice can do: every
 * registered tool becomes one callable by Groq. Groq returns a tool call;
 * we execute it; the result goes back; Groq narrates or asks the minimum
 * clarifying question. Figures always flow through the deterministic engines,
 * never the LLM.
 */
import { groqChatTools } from './voiceGroq';
import { memoryContext } from './voiceMemory';
import { VOICE_TOOLS, type VoiceToolContext } from './voiceRegistry';
import type { WriteCommand } from './voiceWrite';
import { REPORTS_TABS } from '../components/common/financeTabs';
import { invoiceBalanceDue } from './financeDomain';
import { formatContextForPrompt, type ClinicContextSnapshot } from './voiceContextCache';

export interface AgentResult {
  text: string;
  /** When the loop decided on a write action, the pending command for the amber panel. */
  pendingWrite?: WriteCommand;
  risk?: 'write' | 'destructive';
  navigateTo?: string;
}

const MAX_ITER = 3;

/** Machine-readable parameter hints per tool id (names only — values are validated by the tool itself). */
const TOOL_PARAMS: Record<string, { required: string[]; optional: string[]; describe: string }> = {
  cashCollected: { required: [], optional: ['period'], describe: 'Cash/advances collected. period: today|this month|this week|last month|all time' },
  overdueCases: { required: [], optional: [], describe: 'Cases overdue (delivery before today)' },
  balance: { required: ['clinic'], optional: ['period', 'metric'], describe: 'Net balance of a clinic (Dr/Cr). metric: balance|advance' },
  clinicBalance: { required: ['clinic'], optional: [], describe: 'Net balance of a clinic (Dr/Cr)' },
  statement: { required: ['clinic'], optional: ['period'], describe: 'Monthly or All-Time statement for a clinic' },
  ledger: { required: ['clinic'], optional: ['period'], describe: 'Ledger (postings) for a clinic' },
  outstanding: { required: ['clinic'], optional: ['overdueOnly', 'limit'], describe: 'Outstanding invoices for a clinic' },
  advanceWallet: { required: ['clinic'], optional: [], describe: 'Advance wallet for a clinic' },
  invoiceSearch: { required: ['query'], optional: [], describe: 'Find invoices by number/case/patient/clinic/amount' },
  narrate: { required: ['clinic'], optional: ['period'], describe: 'Plain-language walk-through of a clinic statement' },
  briefing: { required: [], optional: [], describe: 'Morning briefing: cash, deliveries, outstanding, overdue' },
  monthClose: { required: ['clinic', 'month'], optional: [], describe: 'Close a clinic month (YYYY-MM)' },
  navigate: { required: ['view'], optional: [], describe: `Open a screen. view: dashboard|cases|labs|${REPORTS_TABS[0].id}|${REPORTS_TABS[1].id}|${REPORTS_TABS[2].id}|catalog|notifications|settings|print-invoices` },
  recordPayment: { required: ['clinic', 'amount'], optional: ['method', 'invoice'], describe: 'Record a payment. method: cash|bank|cheque' },
  recordAdvance: { required: ['clinic', 'amount'], optional: ['method'], describe: 'Record an advance deposit' },
  addClinicContact: { required: ['clinic', 'contactName', 'phone'], optional: ['email', 'role', 'isPrimary'], describe: 'Add a contact to a clinic' },
  addClinicAddress: { required: ['clinic', 'type', 'street', 'city', 'state', 'postalCode', 'country'], optional: ['isDefault'], describe: 'Add an address for a clinic. type: billing|shipping|lab_location' },
  addPricingOverride: { required: ['clinic', 'caseType', 'customPrice'], optional: ['discountPercentage', 'effectiveDate'], describe: 'Set a pricing override for a case type at a clinic' },
  createClinic: { required: ['name'], optional: ['doctor', 'phone'], describe: 'Create a new clinic' },
  setCaseStatus: { required: ['caseNumber', 'status'], optional: [], describe: 'Move case to status. status: draft|received|in_progress|qc|ready|delivered|revision|cancelled' },
  addCaseNote: { required: ['caseNumber', 'note'], optional: [], describe: 'Add a note on a case' },
  recordQc: { required: ['caseNumber', 'result'], optional: ['reason'], describe: 'Record QC pass/fail. fail requires reason' },
  archiveCase: { required: ['caseNumber'], optional: [], describe: 'Archive a delivered case' },
  caseUpdateFields: { required: ['caseNumber'], optional: [], describe: 'Update DS-XXXX fields — set fields "priority", "shade", "material", "instructions", "delivery_date", "teeth" with values; e.g. update DS-0001 — shade A2, priority urgent' },
  casePriority: { required: ['caseNumber', 'priority'], optional: [], describe: 'Set a case priority (low|normal|high|urgent)' },
  bulkCaseStatus: { required: ['bulkCaseNumbers', 'targetStatus'], optional: [], describe: 'Move several case numbers to a stage (e.g. ready, delivered)' },
  restoreCase: { required: ['caseNumber'], optional: [], describe: 'Restore an archived case' },
  caseTemplateSave: { required: ['caseNumber', 'templateName'], optional: [], describe: 'Save a case as a template' },
  deleteCase: { required: ['caseNumber'], optional: [], describe: 'Delete a case permanently (app-confirmed)' },
  purgeCase: { required: ['caseNumber'], optional: [], describe: 'Permanently delete a case + data (app-confirmed)' },
  cancelCase: { required: ['caseNumber'], optional: [], describe: 'Cancel a case' },
  addNote: { required: ['caseNumber', 'note'], optional: [], describe: 'Add a note on a case' },
  case_notes_search: { required: ['query'], optional: [], describe: 'Search case notes by content across all cases' },
  case_count: { required: [], optional: ['clinic', 'status'], describe: 'Count cases. Optional: clinic name, status (draft|received|in_progress|qc|ready|delivered|revision|cancelled)' },
  cases_today: { required: [], optional: ['clinic'], describe: 'Cases due today. Optional: clinic name' },
  cases_by_clinic: { required: ['clinic'], optional: [], describe: 'All active cases for a clinic. Args: clinic name' },
  cases_by_status: { required: ['status'], optional: [], describe: 'All active cases in a status. Args: status (draft|received|in_progress|qc|ready|delivered|revision|cancelled)' },
  patient_cases: { required: ['patientName'], optional: [], describe: 'Find cases by patient name (partial match). Args: patient name' },
  invoice_by_amount: { required: ['amount'], optional: [], describe: 'Find invoices by amount. Args: PKR amount' },
  clinic_outstanding: { required: ['clinic'], optional: [], describe: 'Outstanding invoices for a clinic. Args: clinic name' },
  qc_pending: { required: [], optional: [], describe: 'Cases needing QC attention (failed or not yet inspected). No args.' },
};

const toolCatalog = () =>
  VOICE_TOOLS.map((t) => {
    const hints = TOOL_PARAMS[t.id];
    return `- ${t.id}: ${t.description}${hints ? ` (args: ${hints.describe})` : ''}`;
  }).join('\n');

const toolsForApi = () =>
  VOICE_TOOLS.map((t) => {
    const hints = TOOL_PARAMS[t.id];
    return {
      type: 'function' as const,
      function: {
        name: t.id,
        description: t.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries((hints?.optional ?? []).map((k) => [k, { type: 'string' }])),
          required: hints?.required ?? [],
        },
      },
    };
  });

/** Build a one-line summary of every clinic for the system prompt. */
const allClinicsSummary = (ctx: VoiceToolContext): string => {
  const labs = ctx.labs || [];
  if (!labs.length) return 'No clinics registered yet.';
  return labs
    .map((lab) => {
      const invs = (ctx.invoices || []).filter((i) => i.lab_id === lab.id);
      const balance = invs.reduce((acc, inv) => acc + invoiceBalanceDue(inv), 0);
      const openCases = (ctx.cases || []).filter((c) => c.lab_id === lab.id && c.status !== 'delivered' && c.status !== 'cancelled' && !c.archived_at).length;
      return `- ${lab.name}: ${openCases} open case(s), ${invs.length} invoice(s), outstanding PKR ${Math.abs(balance).toLocaleString()}${balance > 0 ? ' (clinic owes us)' : balance < 0 ? ' (credit held)' : ' (settled)'}`;
    })
    .join('\n');
};

const systemPrompt = (clinicContext?: ClinicContextSnapshot | null, ctx?: VoiceToolContext) => {
  const ctxSection = clinicContext ? formatContextForPrompt(clinicContext) : '';
  const allClinics = ctx ? `\n## All Clinics\n${allClinicsSummary(ctx)}` : '';

  return `You are Jarvis, the voice assistant for Dental Solutions — a dental-lab billing app. You are friendly, warm, and conversational, like a helpful colleague who knows the clinic's books. Answer any question naturally when you can; use tools to read data or do things. Keep answers short and factual; questions conversational.

You may answer conversationally — from clinic context, memory, and your knowledge — when no tool fits. You may ONLY answer figures, clinics, cases, invoices or case numbers by calling tools: never invent them.

If a required argument is missing or the request is ambiguous, ask for it as a short question instead of guessing.

Void/wipe/refund are never tools. Delete/purge of a case goes through deleteCase/purgeCase — the app gates those behind its own confirmation, and the user must speak or type the confirmation.

The user may speak with loose wording ("DS-0001", "Mir Dental", "the books", "what's owed", "show me yesterday's work", "is DS-0393 ready yet?"). Map it to the closest tool; ask if you can't.

Clinics and case numbers must exactly match what the user said or what exists; never fabricate.

## Current Clinic Context
${ctxSection || 'No specific clinic context — ask which clinic the user means.'}${allClinics}

## How to search
- Case numbers: DS-XXXX (e.g., DS-0001)
- Patient names: full or partial name
- Clinics: full or partial name
- Money: PKR amounts
- Teeth: FDI numbers (e.g., "26 27")
- Materials: Zirconia Crown, PFM, Emax, etc.
- Shades: A1, A2, A3, B1, etc.
- Priorities: low, normal, high, urgent
- Statuses: draft, received, in_progress, qc, ready, delivered, revision, cancelled

## Known tools
${toolCatalog()}

## Memory (redacted, previous operator questions and accepted answers)
${memoryContext()}`;
};

const KNOWN_CASE_NUMBER = /\bDS-\d+\b/i;
const STAGE_WORDS = /\b(ready|delivered|received|qc|quality|revision|rework|in progress|cancelled)\b/i;

/** Ask the user for a missing piece — used when the planner stalls. */
export const clarify = (question: string): AgentResult => ({ text: question });

/** Execute a tool chosen by the planner; returns a user-ready message plus an optional pending write. */
const invokeApprovedTool = async (id: string, args: Record<string, unknown>, ctx: VoiceToolContext): Promise<AgentResult> => {
  const tool = VOICE_TOOLS.find((t) => t.id === id);
  if (!tool) return clarify(`I know that one as "${id}", but the app doesn't have it wired yet.`);
  const result = await tool.run(ctx, args);
  if (!result) return clarify(`I can do "${tool.description}", but I need more detail.`);
  if (result.kind === 'read') {
    return { text: result.text ?? 'Done.', navigateTo: result.navigateTo };
  }
  // It's an action — return it so the caller can show the confirmation panel.
  return { text: result.summary, pendingWrite: result.pending, risk: result.risk as 'write' | 'destructive' };
};

/**
 * Groq can 429, 5xx or time out transiently — retry a couple of times with a
 * short backoff so a busy moment doesn't dead-end the query into the fixed
 * fallback. Returns null only when every attempt failed.
 */
const callGroq = async (
  messages: Parameters<typeof groqChatTools>[0],
  tools: Parameters<typeof groqChatTools>[1],
  opts: Parameters<typeof groqChatTools>[2],
): Promise<Awaited<ReturnType<typeof groqChatTools>>> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const resp = await groqChatTools(messages, tools, opts);
    if (resp) return resp;
    if (attempt + 1 < 2) await new Promise((r) => setTimeout(r, 900));
  }
  return null;
};

/** Run the agentic loop: model → tool → result → maybe ask, repeat up to MAX_ITER times. */
export const runAgenticLoop = async (raw: string, ctx: VoiceToolContext, clinicContext?: ClinicContextSnapshot | null): Promise<AgentResult | null> => {
  const tools = toolsForApi();
  const messages: { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; name?: string }[] = [
    { role: 'system', content: systemPrompt(clinicContext, ctx) },
    { role: 'user', content: raw },
  ];
  for (let iter = 0; iter < MAX_ITER; iter += 1) {
    const resp = await callGroq(messages, tools, { maxTokens: 400, timeoutMs: 15000, temperature: 0.1, tool_choice: 'auto' });
    if (!resp) return null;
    if (!resp.tool_calls?.length) {
      return { text: resp.content ?? 'Done.' };
    }
    for (const call of resp.tool_calls) {
      const name = call.function?.name;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* keep empty */ }
      const toolMsg: { role: 'tool'; content: string; tool_call_id: string; name: string } = {
        role: 'tool',
        content: '',
        tool_call_id: call.id ?? String(Math.random()),
        name: name ?? 'tool',
      };
      const result = await invokeApprovedTool(name, args, ctx);
      if (result.navigateTo) return result;
      toolMsg.content = result.text ?? JSON.stringify(result);
      messages.push(toolMsg);
    }
    const lastTool = messages[messages.length - 1];
    if (lastTool?.role === 'tool' && lastTool.content?.startsWith('{')) {
      try {
        const parsed = JSON.parse(lastTool.content) as { kind?: string; summary?: string; pendingWrite?: WriteCommand; risk?: string; navigateTo?: string };
        if (parsed?.navigateTo) return { text: `Opening ${parsed.navigateTo}.`, navigateTo: parsed.navigateTo };
      } catch { /* fall through */ }
    }
  }
  return clarify("I'm not sure what you mean — could you say it a different way?");
};

export { KNOWN_CASE_NUMBER, STAGE_WORDS };