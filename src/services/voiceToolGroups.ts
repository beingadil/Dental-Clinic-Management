/**
 * Domain groups for tool retrieval.
 *
 * Jarvis has 100+ tools. Sending every schema on every request overflows free
 * tiers (Groq ≈8k tokens/min) before the user's sentence is even counted, so the
 * model first picks the app areas it needs (a `select_domain` tool call — still
 * LLM tool calling, never keyword matching), and only those schemas are sent.
 *
 * Rules:
 *   - CORE_TOOLS are always available — navigation, search, help and the
 *     cross-domain lookups that most sentences lean on.
 *   - Every tool id must be routable: in CORE_TOOLS or in a group (a few, like
 *     the CSV exports, deliberately appear in two groups).
 *   - Unknown ids are simply never routed; the drift check in `check-groups`
 *     catches anything that falls through the cracks.
 */

export interface VoiceToolGroup {
  id: string;
  label: string;
  /** Shown to the model in the router step — the only routing signal. */
  blurb: string;
  tools: string[];
}

/** Always sent, whatever the request is. Keep this list short. */
export const CORE_TOOLS = [
  'navigate',
  'global_search',
  'help',
  'briefing',
  'narrate',
  'patient_search',
  'case_search',
  'case_detail',
  'case_count',
  // Money is the app's daily question; these stay available so a balance
  // question never depends on the router guessing the right area.
  'standings',
  'outstanding',
  'clinicBalance',
  'invoiceSearch',
];

export const TOOL_GROUPS: VoiceToolGroup[] = [
  {
    id: 'cases',
    label: 'Cases',
    blurb: 'case lists, counts, filters, queues, due dates, delivery calendar, case notes/attachments/timeline, patient cases, case status or priority changes, QC on a case, archiving, deleting or restoring cases, templates, pre-filling the new-case form',
    tools: [
      'case_count', 'cases_today', 'cases_by_clinic', 'cases_by_status', 'cases_filter',
      'patient_cases', 'case_notes_search', 'case_notes_list', 'case_attachments',
      'case_timeline', 'delivery_calendar', 'case_queue', 'dueToday', 'overdueCases',
      'setCaseStatus', 'casePriority', 'addCaseNote', 'recordQc', 'archiveCase', 'caseUpdateFields',
      'bulkCaseStatus', 'restoreCase', 'caseTemplateSave', 'deleteCase', 'purgeCase', 'cancelCase',
      'delete_case_note', 'delete_case_attachment', 'create_case_from_template', 'bulk_archive',
      'templates_list', 'fillForm',
    ],
  },
  {
    id: 'billing',
    label: 'Billing & payments',
    blurb: 'invoices, balances, statements, ledger, outstanding receivables, cash collected, advance wallet, recording payments or advance deposits, applying advance credit, marking invoices paid, ageing report, adjustments/credit notes/refunds, payment receipts, reconciliation, closing a month',
    tools: [
      'cashCollected', 'monthClose', 'clinicBalance', 'standings', 'outstanding', 'statement',
      'ledger', 'advanceWallet', 'invoiceSearch', 'invoice_by_amount', 'invoice_search_by_amount',
      'clinic_outstanding', 'exportInvoicesCsv', 'exportTransactionsCsv', 'recordPayment',
      'recordAdvance', 'applyAdvance', 'markInvoicePaid', 'closeMonth', 'aging_report',
      'adjustments_list', 'payments_list', 'reconciliation_queue', 'record_adjustment',
      'delete_adjustment', 'delete_payment', 'update_payment', 'issue_credit_note', 'delete_invoice',
      'reconcile_payment', 'flag_reconciliation',
    ],
  },
  {
    id: 'clinics',
    label: 'Clinics & doctors',
    blurb: 'clinic profiles, contacts, addresses, price overrides, doctor assignment, doctor preferred lab, creating, editing or deleting a clinic',
    tools: [
      'createClinic', 'addClinicContact', 'addClinicAddress', 'addPricingOverride',
      'updateClinicDoctor', 'updateClinicField', 'delete_clinic', 'delete_clinic_contact',
      'delete_clinic_address', 'delete_pricing_override', 'set_doctor_preferred_lab',
      'get_doctor_preferred_lab',
    ],
  },
  {
    id: 'catalog',
    label: 'Catalog & SLA',
    blurb: 'case types and their prices, categories, clinical specifications, shade guide, SLA turnaround promises',
    tools: [
      'case_types_list', 'catalog_categories', 'clinical_specs', 'shade_guide', 'sla_status',
      'create_case_type', 'update_case_type', 'delete_case_type', 'set_sla_settings',
    ],
  },
  {
    id: 'qc',
    label: 'Quality control',
    blurb: 'QC state, ship gate, inspection history, first-pass and rework metrics, failure reasons, cases in rework',
    tools: [
      'qc_state', 'qc_gate_check', 'qc_inspection_log', 'qc_metrics_summary', 'qc_rework',
      'qc_reasons', 'qc_pending',
    ],
  },
  {
    id: 'print',
    label: 'Printing & vouchers',
    blurb: 'print layout and document sections, saved job slips and invoice vouchers, CSV exports',
    tools: [
      'printSettingsSave', 'printSectionsSave', 'vouchers_list', 'save_voucher', 'delete_voucher',
      'exportInvoicesCsv', 'exportTransactionsCsv',
    ],
  },
  {
    id: 'admin',
    label: 'Admin & settings',
    blurb: 'users, theme, backups, notifications, app updates and hot patches, audit trail, sync/online status, reports, questions about the app itself',
    tools: [
      'user_list', 'theme_switch', 'backup_create', 'notificationConfigSave', 'updateStatus',
      'checkUpdates', 'applyPatch', 'audit_trail', 'sync_status', 'report_generate', 'codebase',
    ],
  },
];

/** Union of core tools plus every tool in the chosen groups. */
export const toolsForDomains = (domains: string[]): Set<string> => {
  const ids = new Set(CORE_TOOLS);
  for (const group of TOOL_GROUPS) {
    if (!domains.includes(group.id)) continue;
    for (const id of group.tools) ids.add(id);
  }
  return ids;
};

export const TOOL_GROUP_IDS = TOOL_GROUPS.map((g) => g.id);

/** Router description line used in the `select_domain` prompt. */
export const groupMenu = (): string =>
  TOOL_GROUPS.map((g) => `- ${g.id} (${g.label}): ${g.blurb}`).join('\n');
