/**
 * Agentic loop — the planner.
 *
 * The registry is the single source of truth for what voice can do: every
 * registered tool becomes one callable by Groq. Groq returns a tool call;
 * we execute it; the result goes back; Groq narrates or asks the minimum
 * clarifying question. Figures always flow through the deterministic engines,
 * never the LLM.
 */
import { aiChatTools } from './voiceAiRouter';
import { VOICE_TOOLS, type VoiceToolContext } from './voiceRegistry';
import type { WriteCommand } from './voiceWrite';
import { REPORTS_TABS } from '../components/common/financeTabs';
import { invoiceBalanceDue } from './financeDomain';
import { formatContextForPrompt, type ClinicContextSnapshot } from './voiceContextCache';
import { TOOL_GROUP_IDS, groupMenu, toolsForDomains } from './voiceToolGroups';

export interface AgentResult {
  text: string;
  /** When the loop decided on a write action, the pending command for the amber panel. */
  pendingWrite?: WriteCommand;
  risk?: 'write' | 'destructive';
  navigateTo?: string;
  /** Tool output already final — return without another model round-trip. */
  direct?: boolean;
}

const MAX_ITER = 3;

/** Machine-readable parameter hints per tool id (names only — values are validated by the tool itself). */
const TOOL_PARAMS: Record<string, { required: string[]; optional: string[]; describe: string; kinds?: Record<string, 'number' | 'boolean' | 'array' | 'object'> }> = {
  cashCollected: { required: [], optional: ['period'], describe: 'Cash/advances collected. period: today|this month|this week|last month|all time' },
  overdueCases: { required: [], optional: [], describe: 'Cases overdue (delivery before today)' },
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
  case_notes_search: { required: ['query'], optional: [], describe: 'Search case notes by content across all cases' },
  case_count: { required: [], optional: ['clinic', 'status'], describe: 'Count cases. Optional: clinic name, status (draft|received|in_progress|qc|ready|delivered|revision|cancelled)' },
  cases_today: { required: [], optional: ['clinic'], describe: 'Cases due today. Optional: clinic name' },
  cases_by_clinic: { required: ['clinic'], optional: [], describe: 'All active cases for a clinic. Args: clinic name' },
  cases_by_status: { required: ['status'], optional: [], describe: 'All active cases in a status. Args: status (draft|received|in_progress|qc|ready|delivered|revision|cancelled)' },
  patient_cases: { required: ['patientName'], optional: [], describe: 'Find cases by patient name (partial match). Args: patient name' },
  invoice_by_amount: { required: ['amount'], optional: [], describe: 'Find invoices by amount. Args: PKR amount' },
  clinic_outstanding: { required: ['clinic'], optional: [], describe: 'Outstanding invoices for a clinic. Args: clinic name' },
  qc_pending: { required: [], optional: [], describe: 'Cases needing QC attention (failed or not yet inspected). No args.' },
  patient_search: { required: [], optional: ['query'], describe: 'Search patients by name, phone, address, or CNIC. Args: query' },
  cases_filter: { required: [], optional: ['status', 'clinic', 'priority', 'material', 'shade', 'teeth', 'fromDate', 'toDate'], describe: 'Filter cases by status, clinic, priority, date range, material, shade, teeth. Args: status, clinic, priority, material, shade, teeth, fromDate, toDate' },
  invoice_search_by_amount: { required: [], optional: ['minAmount', 'maxAmount'], describe: 'Find invoices by amount range. Args: minAmount, maxAmount' },
  report_generate: { required: ['clinic'], optional: ['month'], describe: 'Generate a monthly report for a clinic. Args: clinic name, month (YYYY-MM)' },
  user_list: { required: [], optional: [], describe: 'List system users. No args.' },
  theme_switch: { required: ['mode'], optional: [], describe: 'Switch the app theme. Args: mode (light|dark|system)' },
  backup_create: { required: [], optional: [], describe: 'Create a database backup. No args.' },
  delivery_calendar: { required: [], optional: ['date'], describe: 'Show cases due for delivery on a date (YYYY-MM-DD, defaults to today). Args: date' },
  shade_guide: { required: [], optional: [], describe: 'Show the VITA classical shade guide reference. No args.' },
  case_queue: { required: [], optional: [], describe: 'Show cases ready for dispatch (ready or in QC). No args.' },
  global_search: { required: [], optional: ['query'], describe: 'Search across all data — cases, invoices, clinics. Args: query' },
  delete_case_note: { required: ['caseNumber', 'noteText'], optional: [], describe: 'Delete a note from a case. Args: caseNumber, noteText (text from the note)' },
  delete_case_attachment: { required: ['caseNumber', 'fileName'], optional: [], describe: 'Delete an attachment from a case. Args: caseNumber, fileName' },
  create_case_from_template: { required: ['templateName', 'clinic'], optional: ['patientName', 'deliveryDate'], describe: 'Create a case from a saved template. Args: templateName, clinic, patientName, deliveryDate' },
  bulk_archive: { required: [], optional: [], describe: 'Archive all delivered cases older than 30 days. No args.' },
  delete_clinic: { required: ['clinic'], optional: [], describe: 'Delete a clinic and all its records (destructive). Args: clinic' },
  delete_clinic_contact: { required: ['clinic', 'contactName'], optional: [], describe: 'Remove a contact from a clinic. Args: clinic, contactName' },
  delete_clinic_address: { required: ['clinic', 'addressType'], optional: [], describe: 'Remove a clinic address. Args: clinic, addressType (billing|shipping|lab_location)' },
  delete_pricing_override: { required: ['clinic', 'caseType'], optional: [], describe: 'Remove a case-type price override at a clinic. Args: clinic, caseType' },
  set_doctor_preferred_lab: { required: ['doctorName', 'clinic'], optional: [], describe: 'Set a doctor’s preferred lab. Args: doctorName, clinic' },
  get_doctor_preferred_lab: { required: ['doctorName'], optional: [], describe: 'Find a doctor’s preferred lab. Args: doctorName' },
  case_types_list: { required: [], optional: [], describe: 'List catalog case types with prices. No args.' },
  clinical_specs: { required: ['caseType'], optional: [], describe: 'Clinical specs for a case type. Args: caseType' },
  catalog_categories: { required: [], optional: [], describe: 'List catalog categories. No args.' },
  sla_status: { required: [], optional: [], describe: 'Show SLA turnaround days per priority. No args.' },
  create_case_type: { required: ['name', 'basePrice'], optional: ['category', 'leadTimeDays', 'material', 'description'], describe: 'Add a catalog case type. Args: name, basePrice, category, leadTimeDays, material, description' },
  update_case_type: { required: ['name'], optional: ['basePrice', 'category', 'leadTimeDays', 'material', 'description'], describe: 'Update a catalog case type. Args: name, basePrice, category, leadTimeDays, material, description' },
  delete_case_type: { required: ['name'], optional: [], describe: 'Delete a catalog case type (destructive). Args: name' },
  set_sla_settings: { required: [], optional: ['urgent', 'high', 'normal', 'low'], describe: 'Set SLA turnaround days per priority. Args: urgent, high, normal, low' },
  aging_report: { required: [], optional: ['clinic'], describe: 'Outstanding-invoice ageing report. Args: clinic (optional)' },
  adjustments_list: { required: [], optional: ['clinic'], describe: 'Recent account adjustments. Args: clinic (optional)' },
  payments_list: { required: [], optional: ['clinic'], describe: 'Recent payments with receipt numbers. Args: clinic (optional)' },
  reconciliation_queue: { required: [], optional: [], describe: 'Bank reconciliation queue. No args.' },
  record_adjustment: { required: ['clinic', 'amount', 'type'], optional: ['reason'], describe: 'Record a credit note, debit adjustment or refund. Args: clinic, amount, type (credit_note|debit_adjustment|refund), reason' },
  delete_adjustment: { required: ['clinic'], optional: ['amount', 'referenceNumber'], describe: 'Delete an account adjustment (destructive). Args: clinic, amount, referenceNumber' },
  delete_payment: { required: ['receiptNumber'], optional: [], describe: 'Delete a payment receipt (destructive). Args: receiptNumber' },
  update_payment: { required: ['receiptNumber', 'amount'], optional: [], describe: 'Change a payment amount. Args: receiptNumber, amount' },
  issue_credit_note: { required: ['clinic', 'invoice', 'amount', 'reason'], optional: [], describe: 'Issue a credit note against an invoice. Args: clinic, invoice, amount, reason' },
  delete_invoice: { required: ['invoiceNumber'], optional: [], describe: 'Delete an invoice (destructive). Args: invoiceNumber' },
  reconcile_payment: { required: ['referenceNumber'], optional: ['notes'], describe: 'Mark a payment reconciled. Args: referenceNumber, notes' },
  flag_reconciliation: { required: ['referenceNumber', 'reason'], optional: [], describe: 'Flag a reconciliation exception. Args: referenceNumber, reason' },
  audit_trail: { required: [], optional: ['limit'], describe: 'Recent audit-trail events. Args: limit (optional)' },
  sync_status: { required: [], optional: [], describe: 'Check online/offline/desktop status. No args.' },
  templates_list: { required: [], optional: [], describe: 'List saved case templates. No args.' },
  vouchers_list: { required: [], optional: ['limit'], describe: 'List the saved voucher log (job slips / invoices). Args: limit (optional)', kinds: { limit: 'number' } },
  save_voucher: { required: ['caseNumber'], optional: ['voucherType'], describe: 'Log a job slip or invoice voucher for a case. Args: caseNumber, voucherType (job_slip|invoice)' },
  delete_voucher: { required: ['voucherNumber'], optional: [], describe: 'Delete a saved voucher (destructive). Args: voucherNumber' },
  dueToday: { required: [], optional: [], describe: 'Cases due today (priority-sorted) plus overdue. No args.' },
  standings: { required: [], optional: [], describe: 'Clinics ranked by outstanding receivable. No args.' },
  qc_state: { required: ['caseNumber'], optional: [], describe: 'QC state for a case — pass/fail, attempts, open gate. Args: caseNumber' },
  qc_gate_check: { required: ['caseNumber'], optional: [], describe: 'Whether a case may ship (passed QC). Args: caseNumber' },
  qc_inspection_log: { required: ['caseNumber'], optional: [], describe: 'QC inspection history for a case. Args: caseNumber' },
  qc_metrics_summary: { required: [], optional: [], describe: 'Lab-wide QC metrics: first-pass rate, rework, failure reasons. No args.' },
  qc_rework: { required: [], optional: [], describe: 'Cases currently in rework. No args.' },
  qc_reasons: { required: [], optional: [], describe: 'Top QC failure reason codes. No args.' },
  case_detail: { required: ['caseNumber'], optional: [], describe: 'Material, teeth, shade, procedure, dates and status for a case. Args: caseNumber' },
  case_search: { required: ['query'], optional: [], describe: 'Find cases by patient, type, clinic, doctor, material, shade, teeth or case number. Args: query' },
  case_timeline: { required: ['caseNumber'], optional: [], describe: 'Status history for a case in plain words. Args: caseNumber' },
  case_notes_list: { required: ['caseNumber'], optional: [], describe: 'Notes on a case (author, time, text). Args: caseNumber' },
  case_attachments: { required: ['caseNumber'], optional: [], describe: 'Files attached to a case. Args: caseNumber' },
  exportInvoicesCsv: { required: [], optional: [], describe: 'Export the invoice list as a CSV file. No args.' },
  exportTransactionsCsv: { required: [], optional: [], describe: 'Export the unified transaction register as CSV. No args.' },
  codebase: { required: ['query'], optional: [], describe: 'Answer a question about the app’s codebase or docs. Args: query' },
  applyAdvance: { required: ['clinic', 'amount', 'invoice'], optional: [], describe: 'Apply advance credit to an invoice. Args: clinic, amount, invoice', kinds: { amount: 'number' } },
  markInvoicePaid: { required: ['invoiceNumbers'], optional: [], describe: 'Mark one or more invoices paid in full. Args: invoiceNumbers', kinds: { invoiceNumbers: 'array' } },
  printSettingsSave: { required: [], optional: ['paper', 'margin', 'fontSize', 'showLogo', 'logoPosition', 'jobSlipStyle'], describe: 'Save the global print layout. Args: paper, margin, fontSize, showLogo, logoPosition, jobSlipStyle', kinds: { margin: 'number', fontSize: 'number', showLogo: 'boolean' } },
  printSectionsSave: { required: ['docKind', 'sections'], optional: [], describe: 'Set which sections print for a document kind. Args: docKind (invoice|job_slip|receipt|statement), sections', kinds: { sections: 'array' } },
  notificationConfigSave: { required: ['type'], optional: ['frequencies', 'escalation', 'thresholdDays', 'interval'], describe: 'Save notification cadence/escalation. Args: type (payment|overdue), frequencies, escalation, thresholdDays, interval', kinds: { frequencies: 'array', escalation: 'boolean', thresholdDays: 'number' } },
  closeMonth: { required: ['clinic', 'month'], optional: [], describe: 'Close a clinic month. Args: clinic, month (YYYY-MM)' },
  updateClinicDoctor: { required: ['clinic', 'doctorName'], optional: [], describe: 'Set the doctor for a clinic. Args: clinic, doctorName' },
  updateClinicField: { required: ['clinic', 'field', 'value'], optional: [], describe: 'Edit one clinic field. Args: clinic, field (name|phone|email|address|city|doctor), value' },
  updateStatus: { required: [], optional: [], describe: 'Report the app update state. No args.' },
  checkUpdates: { required: [], optional: [], describe: 'Run the update check now. No args.' },
  applyPatch: { required: [], optional: [], describe: 'Apply an available hot patch. No args.' },
  fillForm: { required: ['target'], optional: ['data'], describe: 'Pre-fill an open form. Args: target (record-transaction-modal|case-detail-modal), data', kinds: { data: 'object' } },
  help: { required: [], optional: [], describe: 'List everything voice can do. No args.' },
};

const toolsForApi = () =>
  VOICE_TOOLS.map((t) => {
    const hints = TOOL_PARAMS[t.id];
    // Include BOTH required and optional params in properties — OpenAI/Groq
    // requires every required property to exist in the properties schema.
    // Required params are type 'string'; optional params are nullable so the AI
    // can pass null when not provided (Groq sends null for omitted optional args).
    const requiredSet = new Set(hints?.required ?? []);
    const allParams = [...(hints?.required ?? []), ...(hints?.optional ?? [])];
    const propertyFor = (k: string) => {
      const kind = hints?.kinds?.[k];
      const required = requiredSet.has(k);
      if (kind === 'number') return required ? { type: 'number' } : { type: ['number', 'null'] };
      if (kind === 'boolean') return required ? { type: 'boolean' } : { type: ['boolean', 'null'] };
      if (kind === 'array') return { type: 'array', items: { type: 'string' } };
      if (kind === 'object') return { type: 'object', additionalProperties: true };
      return required ? { type: 'string' } : { type: ['string', 'null'] };
    };
    return {
      type: 'function' as const,
      function: {
        name: t.id,
        description: t.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(allParams.map((k) => [k, propertyFor(k)])),
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

  return `You are Jarvis, the voice assistant for Dental Solutions — a dental-lab billing app. Be friendly, warm, conversational. Answer naturally; use tools for data and actions. Keep answers short.

You may answer conversationally from clinic context, memory, and knowledge when no tool fits. You may ONLY answer figures, clinics, cases, invoices or case numbers by calling tools: never invent them.

If a required argument is missing or ambiguous, ask a short question.

Void/wipe/refund are never tools. Delete/purge go through deleteCase/purgeCase — user must confirm.

The user may speak loosely ("DS-0001", "Mir Dental", "the books", "what's owed"). Map to closest tool; ask if unsure.

Clinics and case numbers must match what exists; never fabricate.

For balances, outstanding amounts, who owes what or any clinic comparison, call standings, outstanding or clinic_outstanding — never answer those from the context summary.

If a request needs data you cannot see, say what you would need instead of guessing.

## Current Clinic Context
${ctxSection || 'No specific clinic context — ask which clinic the user means.'}${allClinics}`;
};

const KNOWN_CASE_NUMBER = /\bDS-\d+\b/i;
const STAGE_WORDS = /\b(ready|delivered|received|qc|quality|revision|rework|in progress|cancelled)\b/i;

/** Ask the user for a missing piece — used when the planner stalls. */
export const clarify = (question: string): AgentResult => ({ text: question });

/**
 * Step 1 of retrieval: ask the model which app areas this sentence needs.
 *
 * This is a normal tool call (not keyword matching): the model reads the group
 * menu and returns the domains it wants. Sending only those tool schemas keeps
 * each request inside free-tier token limits.
 */
const DOMAIN_TOOL = {
  type: 'function' as const,
  function: {
    name: 'select_domain',
    description: 'Choose the app areas needed to answer this request. You will receive those tools on the next step. Pick every area that could apply; pick none if the request is pure conversation.',
    parameters: {
      type: 'object',
      properties: {
        domains: {
          type: 'array',
          items: { type: 'string', enum: TOOL_GROUP_IDS },
          description: `One or more of: ${TOOL_GROUP_IDS.join(', ')}`,
        },
      },
      required: ['domains'],
    },
  },
};

const pickDomains = async (raw: string): Promise<string[]> => {
  const resp = await aiChatTools(
    [
      {
        role: 'system',
        content: `You route requests for Dental Solutions, a dental-lab billing app. Available areas:\n${groupMenu()}\n\nCall select_domain with the areas needed. Include 'cases' for anything about a specific case. Include 'billing' for money, invoices, payments or balances. If the request is only greeting/small talk, call select_domain with an empty list.`,
      },
      { role: 'user', content: raw },
    ],
    [DOMAIN_TOOL],
    { maxTokens: 60, timeoutMs: 9000, temperature: 0, tool_choice: 'required' },
  );
  const call = resp?.tool_calls?.[0];
  if (!call) return [];
  try {
    const parsed = JSON.parse(call.function.arguments || '{}') as { domains?: unknown };
    const list = Array.isArray(parsed.domains) ? parsed.domains.map(String) : [];
    return list.filter((d) => TOOL_GROUP_IDS.includes(d));
  } catch {
    return [];
  }
};

/** Execute a tool chosen by the planner; returns a user-ready message plus an optional pending write. */
const invokeApprovedTool = async (id: string, args: Record<string, unknown>, ctx: VoiceToolContext): Promise<AgentResult> => {
  const tool = VOICE_TOOLS.find((t) => t.id === id);
  if (!tool) return clarify(`I know that one as "${id}", but the app doesn't have it wired yet.`);
  const result = await tool.run(ctx, args);
  if (!result) return clarify(`I can do "${tool.description}", but I need more detail.`);
  if (result.kind === 'read') {
    // Read output is already natural language — return it directly. This saves
    // a whole second model round-trip (and its tokens) on every read.
    return { text: result.text ?? 'Done.', navigateTo: result.navigateTo, direct: true };
  }
  // It's an action — return it so the caller can show the confirmation panel.
  return { text: result.summary, pendingWrite: result.pending, risk: result.risk as 'write' | 'destructive', direct: true };
};

/** Run the agentic loop: model → tool → result → maybe ask, repeat up to MAX_ITER times. */
export const runAgenticLoop = async (raw: string, ctx: VoiceToolContext, clinicContext?: ClinicContextSnapshot | null): Promise<AgentResult | null> => {
  const allTools = toolsForApi();
  // Two-step retrieval keeps the request small: the model names the areas it
  // needs, then only those schemas (plus the always-on core) are sent.
  const domains = await pickDomains(raw);
  const wanted = toolsForDomains(domains);
  const tools = allTools.filter((t) => wanted.has(t.function.name));
  const messages: { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; name?: string }[] = [
    { role: 'system', content: systemPrompt(clinicContext, ctx) },
    { role: 'user', content: raw },
  ];
  for (let iter = 0; iter < MAX_ITER; iter += 1) {
    const resp = await aiChatTools(messages, tools, { maxTokens: 400, timeoutMs: 15000, temperature: 0.1, tool_choice: 'auto' });
    if (!resp || !resp.content && !resp.tool_calls?.length) return null;
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
      if (result.direct) return result;
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