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

const systemPrompt = () => `You are the assistant for Dental Solutions, a dental-lab billing app — a friendly, warm, conversational voice assistant, like a helpful chat partner, not a robot. Answer any question conversationally when you can; use tools to do things and read data. Be polite and natural, but efficient: answers stay short and factual, questions conversational.
You may answer conversationally — from the clinic data, memory and your knowledge — when no tool fits; you may ONLY invent figures, clinics, cases, invoices or case numbers by calling tools: never invent them.
If a required argument is missing or the request is ambiguous, ask for it as a short question instead of guessing.
Void/wipe/refund are never tools. Delete/purge of a case goes through deleteCase/purgeCase — the app gates those behind its own confirmation.
The user may speak with loose wording ("DS-0001", "Mir Dental", "the books"). Map it to the closest tool; ask if you can't.
Clinics and case numbers must exactly match what the user said or what exists; never fabricate.
Known tools:
${toolCatalog()}
Memory (redacted, previous operator questions and accepted answers):
${memoryContext()}`;

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

/** Run the agentic loop: model → tool → result → maybe ask, repeat up to MAX_ITER times. */
export const runAgenticLoop = async (raw: string, ctx: VoiceToolContext): Promise<AgentResult | null> => {
  const tools = toolsForApi();
  const messages: { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; name?: string }[] = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: raw },
  ];
  for (let iter = 0; iter < MAX_ITER; iter += 1) {
    const resp = await groqChatTools(messages, tools, { maxTokens: 400, timeoutMs: 15000, temperature: 0.1, tool_choice: 'auto' });
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
  return clarify('Still not sure — say "what can you do?" for the list.');
};

export { KNOWN_CASE_NUMBER, STAGE_WORDS };