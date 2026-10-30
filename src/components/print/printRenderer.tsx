import { invoiceBalanceDue } from '../../services/financeDomain';
import React from 'react';
import { DentalCase, Invoice, BrandingSettings, PaymentRecord } from '../../types';
import { TOOTH_NAMES, SHADE_COLORS, getToothLayout } from '../cases/Odontogram';
import { getTodayStr } from '../../utils/dateUtils';
import { formatDoctorName } from '../../utils/doctorName';
import { caseHasChartedTeeth, billableUnits } from '../../utils/catalogToothRequirement';
import {
  CASE_DETAIL_SEP,
  caseDetailInlineText,
  caseDetailLines,
  findCaseForInvoice,
  formatReceivedDate,
  INVOICE_DETAIL_OMIT,
  STATEMENT_DETAIL_OMIT,
} from '../../services/ledgerCaseDetail';
import type { InvoiceAccountPosition } from '../../services/invoiceAccount';

export type DocumentKind = 'job_slip' | 'invoice' | 'receipt' | 'statement';

export interface PrintSectionDef {
  id: string;
  label: string;
  hint: string;
}

export const PRINT_SECTIONS: Record<DocumentKind, PrintSectionDef[]> = {
  job_slip: [
    { id: 'brand', label: 'Lab letterhead', hint: 'Name, tagline, contact details' },
    { id: 'docTitle', label: 'Document title', hint: 'DENTAL LAB JOB SLIP' },
    { id: 'clinicDoctor', label: 'Clinic & doctor block', hint: 'Referred by' },
    { id: 'patient', label: 'Patient details', hint: 'Name / ID' },
    { id: 'caseMeta', label: 'Case meta', hint: 'Case #, priority, delivery date' },
    { id: 'teeth', label: 'FDI teeth & prep table', hint: 'Per-unit charting' },
    { id: 'odontogram', label: 'Printable odontogram', hint: 'Arch chart with case units marked' },
    { id: 'shade', label: 'Shade & material summary', hint: 'Global shade / material' },
    { id: 'instructions', label: 'Doctor instructions', hint: 'Special notes' },
    { id: 'signature', label: 'Signature lines', hint: 'Technician & QC' },
    { id: 'footer', label: 'Page footer', hint: 'Contact line' },
  ],
  invoice: [
    { id: 'brand', label: 'Lab letterhead', hint: 'Name, tagline, contact details' },
    { id: 'docTitle', label: 'Document title', hint: 'INVOICE' },
    { id: 'billTo', label: 'Bill-to block', hint: 'Clinic, doctor, patient' },
    { id: 'invoiceMeta', label: 'Invoice meta', hint: 'Invoice #, issue & due date' },
    { id: 'lineItems', label: 'Line items', hint: 'Case units & pricing' },
    { id: 'totals', label: 'Totals & balance', hint: 'Amount, paid, balance' },
    { id: 'paymentHistory', label: 'Payment history', hint: 'Recorded payments (hidden when none)' },
    { id: 'bank', label: 'Bank payment details', hint: 'From Settings > Branding' },
    { id: 'terms', label: 'Payment terms note', hint: 'Due-on-receipt note' },
    { id: 'signature', label: 'Authorized signature', hint: 'Signatory line' },
    { id: 'footer', label: 'Page footer', hint: 'Contact line' },
  ],
  receipt: [
    { id: 'brand', label: 'Lab letterhead', hint: 'Name, tagline, contact details' },
    { id: 'docTitle', label: 'Document title', hint: 'PAYMENT RECEIPT' },
    { id: 'receivedFrom', label: 'Received-from block', hint: 'Clinic, doctor, patient' },
    { id: 'paymentDetails', label: 'Payment details', hint: 'Amount, method, reference' },
    { id: 'appliesTo', label: 'Applies-to summary', hint: 'Invoice & case, balance after' },
    { id: 'signature', label: 'Received-by signature', hint: 'Signatory line' },
    { id: 'footer', label: 'Page footer', hint: 'Contact line' },
  ],
  statement: [
    { id: 'brand', label: 'Lab letterhead', hint: 'Name, tagline, contact details' },
    { id: 'docTitle', label: 'Document title', hint: 'ACCOUNT STATEMENT' },
    { id: 'statementFor', label: 'Statement-for block', hint: 'Clinic identity' },
    { id: 'period', label: 'Statement period', hint: 'Date range' },
    { id: 'invoiceTable', label: 'Invoice ledger table', hint: 'Invoices + the case each bills' },
    { id: 'balanceSummary', label: 'Balance summary', hint: 'Totals & outstanding' },
    { id: 'footer', label: 'Page footer', hint: 'Contact line' },
  ],
};

export const DEFAULT_ENABLED: Record<DocumentKind, string[]> = {
  job_slip: PRINT_SECTIONS.job_slip.map((s) => s.id),
  invoice: PRINT_SECTIONS.invoice.map((s) => s.id),
  receipt: PRINT_SECTIONS.receipt.map((s) => s.id),
  statement: PRINT_SECTIONS.statement.map((s) => s.id),
};

const on = (sections: string[], id: string) => sections.includes(id);
const money = (n: number) => `PKR ${(n || 0).toLocaleString()}`;
/* Ledger sign convention: positive is a receivable (Dr), negative is money we
   hold on the clinic's behalf (Cr). The suffix is what stops an opening credit
   from reading as an amount the clinic still owes. */
const signedMoney = (n: number) => {
  const value = n || 0;
  if (value < 0) return `${money(Math.abs(value))} Cr`;
  if (value > 0) return `${money(value)} Dr`;
  return money(0);
};

/* Separator for the inline case-detail line.
   Spelled with an escape rather than a literal `·` so a mangled byte in an
   editor or a shell round-trip cannot silently turn the join into something
   else. It bit us once: a PowerShell rewrite corrupted the literal and the
   printed row read "Ali Raza A? Retainer" instead of the separator. */
/* Shared account-position block used by both the single invoice and the batch
   statement. Keeping one renderer means the two documents cannot drift apart
   about how an advance deposit or a prior balance is shown. */
const AccountBalanceBlock: React.FC<{
  position: InvoiceAccountPosition;
  amountLabel: string;
  paidLabel: string;
  appliedNote?: string;
}> = ({ position, amountLabel, paidLabel, appliedNote }) => (
  <div className="mb-4 flex justify-end">
    {/* 320px, not 288px: at 288 the closing row could not hold "CLOSING BALANCE
        (DR)" and its figure at once, so the label wrapped to two lines and the
        amount broke after "PKR" — the one figure on the sheet that must read as
        a single number. The figures below are also nowrap for the same reason. */}
    <div className="w-80">
      <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">
        Account Balance
      </div>
      <table className="w-full border-collapse text-[11px]">
        <tbody>
          <tr className="border border-slate-300">
            <td className="px-3 py-1 text-slate-600">Opening Balance</td>
            <td className="whitespace-nowrap px-3 py-1 text-right font-semibold">
              {signedMoney(position.openingBalance)}
            </td>
          </tr>
          {position.advanceDeposit > 0 && (
            <tr className="border border-slate-300 border-t-0">
              <td className="py-1 pl-6 pr-3 text-slate-500">Advance Deposit (we owe)</td>
              <td className="whitespace-nowrap px-3 py-1 text-right text-ink-success">
                {money(position.advanceDeposit)}
              </td>
            </tr>
          )}
          <tr className="border border-slate-300 border-t-0">
            <td className="px-3 py-1 text-slate-600">{amountLabel}</td>
            <td className="whitespace-nowrap px-3 py-1 text-right">{money(position.invoiceAmount)}</td>
          </tr>
          <tr className="border border-slate-300 border-t-0">
            <td className="px-3 py-1 text-slate-600">{paidLabel}</td>
            <td className="whitespace-nowrap px-3 py-1 text-right text-ink-success">
              {money(position.cashPaid)}
            </td>
          </tr>
          {position.creditNotes > 0 && (
            <tr className="border border-slate-300 border-t-0">
              <td className="px-3 py-1 text-slate-600">Credit Notes</td>
              <td className="whitespace-nowrap px-3 py-1 text-right text-ink-success">
                -{money(position.creditNotes)}
              </td>
            </tr>
          )}
          <tr className="border-2 border-slate-900 bg-slate-100">
            <td className="whitespace-nowrap px-3 py-2 font-bold uppercase tracking-wider">
              {position.closingBalance < 0
                ? 'Closing Balance (Cr)'
                : position.closingBalance > 0
                ? 'Closing Balance (Dr)'
                : 'Closing Balance'}
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-right text-sm font-bold">
              {money(Math.abs(position.closingBalance))}
            </td>
          </tr>
        </tbody>
      </table>
      {position.advanceApplied > 0 && (
        <div className="mt-1 text-right text-[9px] text-slate-500">
          {money(position.advanceApplied)} {appliedNote || 'of this invoice was settled from the advance deposit.'}
        </div>
      )}
    </div>
  </div>
);

/* The inline case separator, re-exported from the shared formatter so the
   printed cell and the paginator that prices it spell it once. */
export const SEP = CASE_DETAIL_SEP;

/**
 * Settlement status for a printed invoice, derived from the BALANCE.
 *
 * Not read off `payment_status`, because those two disagree the moment a
 * credit note is applied: the stored status can still say `paid` while the
 * printed balance is non-zero, or `unpaid` once the balance is cleared. What
 * the operator reads on paper has to agree with the number on the same row,
 * so the balance wins.
 *
 * One helper rather than two derivations: the single invoice and the batch
 * statement row print the same column, and when each had its own inline
 * ternary the batch row fell back to the stored `payment_status` — so the two
 * documents disagreed about the same invoice. Shared, so they cannot.
 */
export const invoiceStatus = (
  balance: number,
  paid: number | undefined,
): { label: 'Full' | 'Partial' | 'Unpaid'; className: string } => {
  if (balance <= 0) return { label: 'Full', className: 'font-bold text-emerald-700' };
  if ((paid || 0) > 0) return { label: 'Partial', className: 'font-bold text-amber-700' };
  return { label: 'Unpaid', className: 'font-bold text-rose-700' };
};

interface PrintDocumentProps {
  kind: DocumentKind;
  sections: string[];
  branding: BrandingSettings;
  printSettings?: {
    paper?: 'a4' | 'letter';
    margin?: 'narrow' | 'normal' | 'wide';
    fontSize?: 'compact' | 'normal' | 'large';
    showLogo?: boolean;
    logoPosition?: 'left' | 'center' | 'right';
  };
  caseData?: DentalCase | null;
  invoice?: Invoice | null;
  /** Statement mode: the full invoice list to summarize on one sheet. */
  invoices?: Invoice[] | null;
  /**
   * Statement mode: the cases behind those invoices.
   *
   * A statement that prints only an invoice number cannot be reconciled —
   * the clinic receiving it cannot tell WHICH job the money is for. The
   * block per row is the same `caseDetailLines` the ledger screen, the
   * clinic statement and the invoice drawer print, so the four cannot drift.
   * Omitting it degrades to the bare case number rather than breaking.
   */
  cases?: DentalCase[] | null;
  labName?: string;
  payment?: PaymentRecord | null;
  period?: { from: string; to: string } | null;
  /**
   * Batch statement paging.
   *
   * A batch of invoices can exceed one sheet, so the statement renders one
   * page per chunk and the caller passes where this page sits in the run.
   * `page`/`pageCount` drive the "Page x of y" marker so a clinic can tell a
   * continued sheet from a fresh statement. `showBalance` is false on every
   * page but the last: totals belong to the whole run, so repeating them per
   * page would double-count when someone adds the sheets up.
   */
  page?: { page: number; pageCount: number };
  showBalance?: boolean;
  /**
   * Which invoices the balance block sums. On a paginated run this is the
   * WHOLE selection, not the rows on this page — the last sheet's totals must
   * be the statement's totals, not that page's slice.
   */
  balanceInvoices?: Invoice[] | null;
  advanceBalance?: number;
  /**
   * Invoice mode: the clinic's account position before and after this invoice.
   *
   * The line-item table only knows this invoice's own amount and payments. A
   * clinic that already holds an advance with us, or carries earlier unpaid
   * invoices, needs that brought-forward money on the sheet as well — without
   * it the printed closing balance says the deposit never happened. Optional
   * so job slips, receipts and statements render exactly as before.
   */
  accountPosition?: InvoiceAccountPosition | null;
}

export const PrintDocument: React.FC<PrintDocumentProps> = ({
  kind,
  sections,
  branding,
  printSettings,
  caseData,
  invoice,
  invoices: invoicesProp,
  cases: casesProp,
  labName,
  payment,
  period,
  page,
  showBalance = true,
  balanceInvoices,
  advanceBalance = 0,
  accountPosition = null,
}) => {
  const lab = branding;
  const paper = printSettings?.paper || 'a4';
  const margin = printSettings?.margin || 'normal';
  const fontSize = printSettings?.fontSize || 'normal';
  const showLogo = printSettings?.showLogo !== false;
  const logoPos = printSettings?.logoPosition || 'left';
  const title =
    kind === 'job_slip' ? 'DENTAL LAB JOB SLIP'
    : kind === 'invoice' ? 'INVOICE'
    : kind === 'receipt' ? 'PAYMENT RECEIPT'
    : 'ACCOUNT STATEMENT';

  const toothDetails = ((caseData ?? null)?.tooth_details || {}) as Record<number, any>;

  /* Every tooth-dependent block below is gated on the shared "did this case
     actually get charted?" rule, not on the catalog flag. A product flagged
     "no teeth" commits an empty array, so this is the single condition that
     keeps the job slip, invoice and statement from disagreeing with what the
     operator charted. */
  const hasTeeth = caseHasChartedTeeth(caseData);

  /* Honest settlement label — read from the invoice itself, never guessed. */
  const invStatus = (() => {
    if (!invoice) return null;
    const due = invoiceBalanceDue(invoice);
    if (due <= 0) return { label: 'PAID IN FULL', tone: 'paid' as const };
    if ((invoice.amount_paid || 0) > 0) return { label: 'PARTIALLY PAID', tone: 'partial' as const };
    return { label: 'PAYMENT DUE', tone: 'due' as const };
  })();

  const invPayments = invoice?.payments || [];
  const latestPayment = payment || invPayments[invPayments.length - 1] || null;

  const statementInvoices: Invoice[] = invoicesProp
    ? [...invoicesProp]
    : (invoice ? [invoice] : []);
  const statementCases = casesProp ?? [];

  /* The invoice sheet's own copy of the case behind the invoice.
     Resolved with the SHARED `findCaseForInvoice`, never a local `find`: the
     batch sheet walks invoices and resolves cases the same way, so printing one
     invoice alone and printing it inside a batch must name the same job. The
     inline version this replaces could match a case whose id happened to equal
     this invoice's case number, which bound the sheet to the wrong patient. */
  const invoiceCase = invoice ? findCaseForInvoice(invoice, casesProp ?? []) : null;
  /* Same rows as the statement's case block and the invoice drawer's case card,
     from the same formatter — so the single invoice, the batch statement and
     the screen cannot drift apart. */
  /* Invoice case rows. Teeth and Delivery Date are suppressed here, and only
     here: a printed invoice is a billing document, so the reader needs what
     was made and how much, not the charting list or the bench date — and the
     operator asked for those to come off. `Units` replaces the tooth list and
     carries the same "4 units" wording the line item above already uses.
     The job slip keeps both, because the bench genuinely needs them.
     INVOICE_DETAIL_OMIT is shared with statementPagination so the sheet
     budget is priced from the same rows that print. */
  const invoiceCaseDetail = invoiceCase
    ? caseDetailLines(invoiceCase, { omit: INVOICE_DETAIL_OMIT })
    : [];

  /* Prefer the case the caller resolved; fall back to the one we looked up, so
     a caller that passes only `cases` still gets teeth, units and the case
     block instead of a silently emptier invoice. */
  const resolvedCase = caseData ?? invoiceCase;

  /* ---- Invoice line, rebuilt as a receivable row ----------------------
     The operator asked for the printed invoice to read as one scannable line
     per case — "adil - zirconia, 4 units" — with Amount / Paid / Balance /
     Status alongside, so a monthly or fortnightly run can be read without
     totalling anything by hand.

     Deliberately NOT carried over from the old table:
       - "Teeth: #21, #22, #23, #24" — replaced by the unit count. The tooth
         list is chart-level detail; on paper it wrapped the row and told the
         reader nothing they could not get from the unit count.
       - the separate Rate column. It rendered `money(invoice.amount)`, i.e.
         byte-identical to Amount, so it was a column that cost width and
         said nothing.
       - the per-case-number prefix. The invoice number is already in the meta
         block directly above.
     Each part is dropped when absent rather than rendered empty, so an
     invoice with no patient on file prints "zirconia, 4 units" and not
     " - zirconia, 4 units". */
  const invoicePatient = invoice?.patient_name || resolvedCase?.patient_name || '';
  const invoiceCaseType = invoice?.case_type_name || '';
  const invoiceUnits = billableUnits(resolvedCase);
  const invoiceLineLabel = [
    [invoicePatient, invoiceCaseType].filter(Boolean).join(' - ') || invoiceCaseType || 'Case work',
    invoiceUnits > 0 ? `${invoiceUnits} unit${invoiceUnits === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  // Net of discount and any credit notes, floored at zero: a credit note
  // larger than the invoice is a data problem, not a negative amount to print.
  const invoiceBalance = Math.max(
    0,
    (invoice?.final_amount ?? 0) - (invoice?.amount_paid || 0) - (invoice?.credit_notes_total || 0),
  );

  const { label: invoiceStatusLabel, className: invoiceStatusClass } =
    invoiceStatus(invoiceBalance, invoice?.amount_paid);

  /* The balance block must total the whole run even when the table is split
     across sheets, so it sums `balanceInvoices` when the caller supplies it. */
  const balanceRows = balanceInvoices ?? statementInvoices;
  const balanceCases = balanceRows.reduce((s, i) => s + (i.final_amount || 0), 0);
  const balancePaid = balanceRows.reduce((s, i) => s + (i.amount_paid || 0), 0);
  const balanceDue = balanceRows.reduce((s, i) => s + invoiceBalanceDue(i), 0);
  /* Unallocated advance is money the clinic holds with us, so it settles the
     account on the credit side: due minus advance. Negative = we owe them. */
  const closingNet = balanceDue - (advanceBalance || 0);

  // Dynamic page setup — the chosen paper size + margin become the actual
  // @page rule for printing (overrides the 12mm stylesheet default).
  const pageMarginMm = margin === 'narrow' ? 8 : margin === 'wide' ? 18 : 12;
  const pageSetupCss = `@page { size: ${paper === 'letter' ? 'letter' : 'A4'}; margin: ${pageMarginMm}mm; }`;

  return (
    <div className={`print-doc bg-white text-slate-900 print-fs-${fontSize}`} style={{ fontFamily: 'Georgia, "Times New Roman", serif', backgroundColor: '#ffffff', color: '#0f172a' }}>
      <style>{pageSetupCss}</style>
      {on(sections, 'brand') && (
        <div
          className={`flex items-start gap-4 border-b-2 border-slate-900 pb-3 ${
            logoPos === 'center' ? 'flex-col items-center text-center' : 'justify-between'
          }`}
        >
          <div className="flex items-center gap-3">
            {showLogo && lab.logoUrl && <img src={lab.logoUrl} alt="" className="h-14 w-14 object-contain" />}
            <div>
              <div className="text-xl font-bold tracking-tight">{lab.lab_name || lab.appName || 'Dental Lab'}</div>
              {lab.tagline && <div className="text-[11px] italic text-slate-600">{lab.tagline}</div>}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className={`${logoPos === 'center' ? 'text-center' : 'text-right'} text-[10px] text-slate-600 leading-relaxed`}>
              {lab.address && <div>{lab.address}</div>}
              {lab.phone && <div>Tel: {lab.phone}</div>}
              {lab.email && <div>{lab.email}</div>}
            </div>
            {showLogo && lab.logoUrl2 && (
              <img src={lab.logoUrl2} alt="" className="h-12 w-12 shrink-0 object-contain" />
            )}
          </div>
        </div>
      )}

      {on(sections, 'docTitle') && (
        <div className="text-center mt-4 mb-4">
          <span className="inline-block border-2 border-slate-900 px-6 py-1 text-sm font-bold tracking-[0.25em]">{title}</span>
          {/* Sheet counter — only meaningful when a run spans several pages.
              `pageCount > 1` keeps single-page documents untouched. */}
          {page && page.pageCount > 1 && (
            <div className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
              Page {page.page} of {page.pageCount}
              {page.page > 1 && ' (continued)'}
            </div>
          )}
        </div>
      )}

      {/* ============ JOB SLIP ============ */}
      {kind === 'job_slip' && caseData && (
        <>
          {on(sections, 'clinicDoctor') && (
            <div className="grid grid-cols-2 gap-4 mb-3">
              <Field label="Dental Clinic" value={caseData.lab_name} />
              <Field label="Referring Doctor" value={formatDoctorName(caseData.doctor_name)} />
            </div>
          )}
          {on(sections, 'patient') && (
            <div className="grid grid-cols-2 gap-4 mb-3">
              <Field label="Patient Name / ID" value={caseData.patient_name || '—'} />
              {/* A product that is not per-tooth work is still one billable
                  unit — a retainer is one piece of lab work, not zero. Printing
                  "0" would read as a charting failure on a case that is complete. */}
              <Field label="Units" value={String(billableUnits(caseData))} />
            </div>
          )}
          {on(sections, 'caseMeta') && (
            <div className="grid grid-cols-3 gap-4 mb-4">
              <Field label="Case #" value={caseData.case_number} />
              <Field label="Priority" value={caseData.priority.toUpperCase()} />
              <Field label="Delivery Due" value={caseData.delivery_date} />
            </div>
          )}
          {on(sections, 'teeth') && hasTeeth && (
            <table className="w-full border-collapse text-[11px] mb-4">
              <thead>
                <tr>
                  {['Tooth', 'Name', 'Prep', 'Material', 'Shade', 'Notes'].map((h) => (
                    <th key={h} className="border border-slate-400 bg-slate-100 px-2 py-1 text-left font-bold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {caseData.selected_teeth.map((t) => {
                  const d = toothDetails[t] || {};
                  return (
                    <tr key={t}>
                      <td className="border border-slate-400 px-2 py-1 font-bold">#{t}</td>
                      <td className="border border-slate-400 px-2 py-1">{TOOTH_NAMES[t]?.split('(')[0] || ''}</td>
                      <td className="border border-slate-400 px-2 py-1 capitalize">{String(d.prep_type || 'crown').replace(/_/g, ' ')}</td>
                      <td className="border border-slate-400 px-2 py-1">{d.material || caseData.material || ''}</td>
                      <td className="border border-slate-400 px-2 py-1">{d.shade || caseData.shade || ''}</td>
                      <td className="border border-slate-400 px-2 py-1">{d.notes || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {on(sections, 'odontogram') && hasTeeth && (
            <PrintOdontogram
              selectedTeeth={caseData.selected_teeth}
              toothDetails={toothDetails}
            />
          )}
          {on(sections, 'shade') && (
            <div className="mb-4 text-[11px]">
              {/* Shade is omitted entirely for a product that is not per-tooth
                  work; printing an em dash would read as a missing value rather
                  than a deliberate "this does not apply". */}
              {caseData.shade && (
                <span className="mr-4">
                  <span className="font-bold">Shade: </span>{caseData.shade}
                  {SHADE_COLORS[caseData.shade] && (
                    <span className="inline-block align-middle ml-1 border border-slate-400" style={{ width: 12, height: 12, background: SHADE_COLORS[caseData.shade] }} />
                  )}
                </span>
              )}
              <span className="font-bold">Material: </span>{caseData.material || '—'}
            </div>
          )}
          {on(sections, 'instructions') && caseData.instructions && (
            <div className="mb-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Doctor Instructions</div>
              <div className="border border-slate-300 rounded p-2 text-[11px] whitespace-pre-wrap min-h-[48px]">{caseData.instructions}</div>
            </div>
          )}
          {on(sections, 'signature') && (
            <div className="grid grid-cols-2 gap-8 mt-10">
              <SigLine label="Technician" />
              <SigLine label="Quality Control" />
            </div>
          )}
        </>
      )}

      {/* ============ INVOICE ============ */}
      {kind === 'invoice' && invoice && (
        <>
          {on(sections, 'invoiceMeta') && (
            <div className="mt-3 mb-4 grid grid-cols-4 gap-3 text-[11px]">
              <Field label="Invoice #" value={invoice.invoice_number} />
              <Field label="Case #" value={invoice.case_number || '—'} />
              <Field label="Issue Date" value={invoice.issue_date || invoice.created_at?.slice(0, 10) || '—'} />
              <Field label="Due Date" value={invoice.due_date || '—'} />
            </div>
          )}
          {on(sections, 'billTo') && (
            <div className="mb-4 flex items-start justify-between gap-4 border border-slate-300 p-3">
              <div className="grid flex-1 grid-cols-3 gap-3 text-[11px]">
                <Field label="Bill To (Clinic)" value={invoice.lab_name} />
                <Field label="Doctor" value={formatDoctorName(invoice.doctor_name)} />
                <Field label="Patient" value={invoice.patient_name || '—'} />
              </div>
              {invStatus && (
                <span
                  className={`shrink-0 border px-3 py-1 text-[10px] font-bold tracking-[0.14em] ${
                    invStatus.tone === 'paid'
                      ? 'border-emerald-600 text-emerald-700'
                      : invStatus.tone === 'partial'
                      ? 'border-amber-600 text-amber-700'
                      : 'border-slate-900 text-slate-900'
                  }`}
                >
                  {invStatus.label}
                </span>
              )}
            </div>
          )}
          {/* The job behind the money — the SAME block the batch statement
              prints per row and the invoice drawer shows on screen, from the
              same formatter. Without it a single-invoice print named the
              patient and the product but not the teeth, shade or the two bench
              dates, so the two print paths disagreed about the same invoice.
              Lives under `billTo` rather than a new section id on purpose:
              `loadDocumentSections` keeps only ids already stored, so a new
              section would stay invisible to anyone who saved a section list. */}
          {on(sections, 'billTo') && invoiceCaseDetail.length > 0 && (
            <div className="mb-3">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                Case Details
              </div>
              {/* Inline, for the same reason as the batch row: a bordered grid
                  of labelled pairs costs four lines per invoice and was the
                  main reason a monthly run spilled onto a second sheet. */}
              <div className="text-[10px] leading-tight text-slate-700">
                {invoiceCaseDetail.map((d) => d.value).join(SEP)}
              </div>
            </div>
          )}
          {on(sections, 'lineItems') && (
            <>
              {/* Received date sits here rather than in the invoice meta block:
                  the operator asked for "the day it received", which is the CASE
                  received_date (when the work reached the lab) — a different
                  thing from invoice.issue_date, the day it was billed. */}
              {resolvedCase?.received_date && (
                <div className="mb-2 text-[10px] text-slate-600">
                  <span className="font-bold uppercase tracking-wider text-slate-500">Date Received: </span>
                  {/* Formatted, not the raw ISO string. The batch statement's Date
                      column already prints this case through formatReceivedDate, so
                      the two documents would otherwise disagree about the same
                      date — one "2026-10-03", the other "Oct 3, 2026". */}
                  {formatReceivedDate(resolvedCase)}
                </div>
              )}
              <table className="w-full border-collapse text-[11px] mb-3">
                <thead>
                  <tr>
                    {['Description', 'Amount', 'Paid', 'Balance', 'Status'].map((h) => (
                      <th key={h} className={`border border-slate-300 bg-slate-100 px-2 py-1.5 text-[10px] uppercase tracking-wider font-bold ${h === 'Description' ? 'text-left' : 'text-center'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {/* One cell carries the whole case: patient, what was made,
                        and how much work. Previously the teeth were listed as
                        "Teeth: #21, #22, #23, #24" — the operator asked for
                        "4 units" instead, because on a printout the tooth list
                        is noise they cannot act on and it wraps the row. */}
                    <td className="border border-slate-300 px-2 py-1.5">
                      <span className="font-semibold">{invoiceLineLabel}</span>
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5 text-right">{money(invoice.final_amount)}</td>
                    <td className="border border-slate-300 px-2 py-1.5 text-right">{money(invoice.amount_paid)}</td>
                    <td className="border border-slate-300 px-2 py-1.5 text-right font-semibold">{money(invoiceBalance)}</td>
                    <td className="border border-slate-300 px-2 py-1.5 text-center">
                      <span className={invoiceStatusClass}>{invoiceStatusLabel}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
          {on(sections, 'totals') && invoice.discount > 0 && (
            /* Discount only.
               This block used to repeat Subtotal / Net Payable / Amount Paid /
               Balance Due, all four of which now sit in the line-item table one
               row above — same numbers, twice on the same sheet, which is
               exactly the bulk the operator asked to cut. What it alone still
               explains is the discount arithmetic: gross minus discount is the
               Amount on the row. When there is no discount the block prints
               nothing at all rather than restating the table. */
            <div className="flex justify-end mb-3">
              <table className="w-64 border-collapse text-[11px]">
                <tbody>
                  <tr className="border border-slate-300">
                    <td className="px-3 py-1.5 text-slate-600">Gross</td>
                    <td className="px-3 py-1.5 text-right">{money(invoice.amount)}</td>
                  </tr>
                  <tr className="border border-slate-300 border-t-0">
                    <td className="px-3 py-1.5 text-slate-600">Discount</td>
                    <td className="px-3 py-1.5 text-right">-{money(invoice.discount)}</td>
                  </tr>
                  <tr className="border border-slate-300 border-t-0">
                    <td className="px-3 py-1.5 font-bold uppercase tracking-wider">Net</td>
                    <td className="px-3 py-1.5 text-right font-bold">{money(invoice.final_amount)}</td>
                  </tr>
                  <tr className="border border-slate-300 border-t-0">
                    <td className="px-3 py-1.5 text-slate-600">Paid</td>
                    <td className="px-3 py-1.5 text-right text-emerald-700">{money(invoice.amount_paid || 0)}</td>
                  </tr>
                  <tr className="border-2 border-slate-900 bg-slate-100">
                    <td className="px-3 py-2 font-bold uppercase tracking-wider">Balance Due</td>
                    <td className="px-3 py-2 text-right text-sm font-bold">
                      {money(invoiceBalanceDue(invoice))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {/* Account position — the part an invoice cannot see on its own.
              The line-item table answers "what is this invoice worth and what
              has been paid against it"; this answers "where does the clinic's
              account stand after it". They are deliberately separate because
              the table must keep showing this invoice's full amount even when
              an advance settles half of it. */}
          {on(sections, 'totals') && accountPosition && (
            <AccountBalanceBlock
              position={accountPosition}
              amountLabel="This Invoice"
              paidLabel="Paid (cash / bank)"
            />
          )}
          {on(sections, 'paymentHistory') && (invoice.payments || []).length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Payment History</div>
              <table className="w-full border-collapse text-[10px]">
                <thead>
                  <tr>
                    {['Date', 'Receipt #', 'Method', 'Amount'].map((h) => (
                      <th key={h} className={`border border-slate-300 bg-slate-50 px-2 py-1 font-bold ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoice.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="border border-slate-300 px-2 py-1">{p.payment_date || '—'}</td>
                      <td className="border border-slate-300 px-2 py-1">{p.receipt_number || p.payment_number || '—'}</td>
                      <td className="border border-slate-300 px-2 py-1 capitalize">{p.payment_method || '—'}</td>
                      <td className="border border-slate-300 px-2 py-1 text-right">{money(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {on(sections, 'bank') && lab.bankName && (
            <div className="border border-slate-300 rounded p-3 text-[10px] mb-4 text-slate-700">
              <div className="font-bold uppercase tracking-wider text-slate-500 mb-1">Bank Transfer Details</div>
              <div>{lab.bankName}{lab.bankAccountTitle ? ` · ${lab.bankAccountTitle}` : ''}</div>
              {lab.bankAccountNumber && <div>A/C: {lab.bankAccountNumber}</div>}
              {lab.bankIban && <div>IBAN: {lab.bankIban}</div>}
            </div>
          )}
          {on(sections, 'terms') && (
            <p className="text-[10px] italic text-slate-600 mb-4">
              Payment is due upon receipt. Please quote invoice number {invoice.invoice_number} with your transfer.
            </p>
          )}
          {on(sections, 'signature') && (
            <div className="grid grid-cols-2 gap-8 mt-10">
              <SigLine label="Authorized Signature" />
              <SigLine label="Date" />
            </div>
          )}
        </>
      )}

      {/* ============ RECEIPT ============ */}
      {kind === 'receipt' && invoice && (
        <>
          {on(sections, 'receivedFrom') && (
            <div className="grid grid-cols-3 gap-4 mb-3 text-[11px]">
              <Field label="Received From" value={invoice.lab_name} />
              <Field label="Doctor" value={formatDoctorName(invoice.doctor_name)} />
              <Field label="Patient" value={invoice.patient_name || '—'} />
            </div>
          )}
          {on(sections, 'paymentDetails') && latestPayment && (
            <div className="grid grid-cols-2 gap-4 mb-3 text-[11px]">
              <Field label="Receipt #" value={latestPayment.receipt_number || latestPayment.payment_number || '—'} />
              <Field label="Payment Date" value={latestPayment.payment_date || '—'} />
              <Field label="Amount Received" value={money(latestPayment.amount)} />
              <Field label="Method" value={`${latestPayment.payment_method || '—'}${latestPayment.reference_number ? ` · ${latestPayment.reference_number}` : ''}`} />
            </div>
          )}
          {on(sections, 'paymentDetails') && !latestPayment && (
            <p className="text-[11px] italic text-slate-500 mb-3">No payment recorded on this invoice yet.</p>
          )}
          {on(sections, 'appliesTo') && (
            <div className="grid grid-cols-3 gap-4 mb-4 text-[11px]">
              <Field label="Applies to Invoice" value={invoice.invoice_number} />
              <Field label="Case" value={invoice.case_number || '—'} />
              <Field label="Balance After Payment" value={money(invoiceBalanceDue(invoice))} />
            </div>
          )}
          {on(sections, 'signature') && (
            <div className="grid grid-cols-2 gap-8 mt-10">
              <SigLine label="Received By" />
              <SigLine label="Date" />
            </div>
          )}
        </>
      )}

      {/* ============ STATEMENT ============ */}
      {kind === 'statement' && (
        <>
          {on(sections, 'statementFor') && (
            <div className="grid grid-cols-2 gap-4 mb-3 text-[11px]">
              <Field label="Statement For" value={labName || '—'} />
              <Field label="Generated" value={getTodayStr()} />
            </div>
          )}
          {on(sections, 'period') && period && (
            <div className="mb-3 text-[11px]">
              <span className="font-bold">Period: </span>{period.from} → {period.to}
            </div>
          )}
          {/* Continued sheets restate which slice of the run this is. Without
              it, page 2 is indistinguishable from a separate statement. */}
          {page && page.pageCount > 1 && page.page > 1 && (
            <div className="mb-3 text-[11px]">
              <span className="font-bold">Period (continued): </span>{period ? `${period.from} → ${period.to}` : '—'}
            </div>
          )}
          {on(sections, 'invoiceTable') && (
            <table className="w-full border-collapse text-[11px] mb-4">
              <thead>
                <tr>
                  {/* `Received` is the day the lab took the job in, which is
                      what a clinic reconciles against. It used to print the
                      invoice's own issue date, so a statement mixed two
                      different clocks in one row. Falls back to the invoice date
                      only when the invoice has no resolvable case at all —
                      otherwise the column would be blank for exactly the rows a
                      clinic most needs to chase. */}
                  {['Date', 'Invoice #', 'Case', 'Price', 'Units', 'Total', 'Paid'].map((h) => (
                    <th key={h} className={h === 'Paid' ? 'border border-slate-400 bg-slate-100 px-2 py-0.5 text-center font-bold' : 'border border-slate-400 bg-slate-100 px-2 py-0.5 text-left font-bold'} style={{ backgroundColor: '#f1f5f9', color: '#0f172a' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statementInvoices.map((inv) => {
                  const linkedCase = findCaseForInvoice(inv, statementCases);
                  // Shade moves OUT of this block entirely and the received
                  // date moves UP into the `Date` column, so both are
                  // suppressed here rather than printed twice on one row.
                  // Teeth and Delivery Date go for the same reason the single
                  // invoice suppresses them: a billing row should read as
                  // "patient, procedure, N units", and the charting list plus
                  // the bench date only made the cell tall. `Units` is kept.
                  /* Statement rows show the tooth list instead of the unit
                     count — units are a column above, teeth are what the
                     clinic reconciles against in the case detail line. */
                  /* The omit list is STATEMENT_DETAIL_OMIT, shared with
                     statementPagination. It used to be written inline here
                     while the paginator priced INVOICE_DETAIL_OMIT — two
                     different lists, so the paginator measured a cell with
                     Units on it and the sheet printed a tooth list instead. */
                  const detailText = linkedCase
                    ? caseDetailInlineText(linkedCase, { omit: STATEMENT_DETAIL_OMIT })
                    : '';
                  const received = linkedCase ? formatReceivedDate(linkedCase) : '';
                  /* Per-unit base price and the unit count behind this invoice. */
                  const units = linkedCase
                    ? linkedCase.units_count || (linkedCase.selected_teeth?.length || 0) || 1
                    : 1;
                  const pricePerUnit = linkedCase && units > 0
                    ? linkedCase.price / units
                    : inv.final_amount;
                  return (
                  /* `py-0.5`, not `py-1`: 4px of vertical padding per cell is
                     8px of dead height on a row whose text box is 13px, and a
                     statement runs to dozens of rows. Measured at 21px bare /
                     33px with a one-line detail, against 25 / 37 before —
                      four more invoices on an A4 sheet before the paginator
                     has to start a new one. statementPagination.ROW_PX_BARE is
                     measured from THIS markup. */
                  <tr key={inv.id}>
                    {/* Date leads the row. The operator reads a statement as
                        "what arrived, when", so the day the work came in sits
                        left of the invoice number rather than second to it.
                        Header and body moved together — the two are separate
                        maps, and swapping one alone would silently misalign
                        every column under it. */}
                    <td className="border border-slate-400 px-2 py-0.5 align-top">
                      {received || inv.issue_date || inv.created_at?.slice(0, 10) || '—'}
                    </td>
                    <td className="border border-slate-400 px-2 py-0.5 align-top font-bold">{inv.invoice_number}</td>
                    {/* The job the invoice is against. The received date is NOT
                        repeated here: the `Date` column above already
                        carries it, and printing the same date twice on one row
                        reads as two different facts.

                        One line, not a nested definition grid. This used to be
                        a bordered 2-column <dl> with "PATIENT 3578 /
                        PROCEDURE Zirconia / TEETH #35, #36, #45, #46 / DELIVERY
                        DATE ..." — four labelled pairs inside a box inside a
                        cell, which made every invoice row four lines tall and
                        pushed a fortnightly run onto extra sheets. A billing
                        reader wants the case identified, not annotated, so the
                        facts are joined inline and the labels drop away; the
                        same words are all still present. */}
                    <td className="border border-slate-400 px-2 py-0.5 align-top">
                      <span className="block font-semibold">{inv.case_number || '—'}</span>
                      {detailText && (
                        <div className="text-[9px] leading-tight text-slate-700">
                          {detailText}
                        </div>
                      )}
                    </td>
                    <td className="border border-slate-400 px-2 py-0.5 text-right align-top">{money(pricePerUnit)}</td>
                    <td className="border border-slate-400 px-2 py-0.5 text-right align-top">{units}</td>
                    <td className="border border-slate-400 px-2 py-0.5 text-right align-top font-bold">{money(inv.final_amount)}</td>
                    <td className="border border-slate-400 px-2 py-0.5 align-top font-semibold">
                      {invoiceBalanceDue(inv) <= 0 ? 'Full' : (inv.amount_paid || 0) > 0 ? 'Partial' : 'Unpaid'}
                    </td>
                  </tr>
                  );
                })}
                {statementInvoices.length === 0 && (
                  <tr><td colSpan={7} className="border border-slate-400 px-2 py-4 text-center italic text-slate-500">No invoices in this period.</td></tr>
                )}
              </tbody>
            </table>
          )}
          {on(sections, 'balanceSummary') && showBalance && accountPosition && (
            <AccountBalanceBlock
              position={accountPosition}
              amountLabel={balanceRows.length === 1 ? 'This Invoice' : 'Cases Amount'}
              paidLabel="Paid"
              appliedNote="of the selected invoices was settled from advance deposits."
            />
          )}
          {on(sections, 'balanceSummary') && showBalance && !accountPosition && (
            <div className="flex justify-end mb-4">
              <table className="text-[11px] w-64">
                <tbody>
                  <tr><td className="py-0.5 text-slate-600">Cases Amount</td><td className="py-0.5 text-right font-bold">{money(balanceCases)}</td></tr>
                  <tr><td className="py-0.5 text-slate-600">Paid</td><td className="py-0.5 text-right">{money(balancePaid)}</td></tr>
                  {advanceBalance > 0 && (
                    <tr><td className="py-0.5 text-slate-600">Advance Credit (we owe)</td><td className="py-0.5 text-right text-ink-success">{money(advanceBalance)}</td></tr>
                  )}
                  <tr className="border-t-2 border-slate-900">
                    <td className="py-1 font-bold">
                      {closingNet < 0 ? 'Closing Balance (Cr)' : closingNet > 0 ? 'Closing Balance (Dr)' : 'Closing Balance'}
                    </td>
                    <td className="py-1 text-right font-bold">{money(Math.abs(closingNet))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {on(sections, 'footer') && (
        <div className="border-t border-slate-300 mt-8 pt-2 text-center text-[9px] text-slate-500">
          {lab.appName || lab.lab_name || 'Dental Lab'}{lab.phone ? ` · ${lab.phone}` : ''}{lab.email ? ` · ${lab.email}` : ''} — Thank you for your business.
        </div>
      )}
    </div>
  );
};

/**
 * Paper-friendly 32-tooth FDI arch chart for job slips: case units are filled
 * solid (photocopies cleanly), the rest stay as hairline outlines. Purely
 * monochrome — no screen colors.
 */
const PrintOdontogram: React.FC<{
  selectedTeeth: number[];
  toothDetails: Record<number, any>;
}> = ({ selectedTeeth, toothDetails }) => (
  <div className="mb-4">
    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Odontogram</div>
    <svg viewBox="0 0 1000 680" className="w-full h-auto" role="img" aria-label="32-tooth FDI chart with case units marked">
      <line x1="500" y1="84" x2="500" y2="580" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="4 6" />
      {getToothLayout().map(({ id, arch, x, y, rotation }) => {
        const active = selectedTeeth.includes(id);
        const prep = String(toothDetails[id]?.prep_type || '');
        return (
          <g key={id} transform={`translate(${x} ${y}) rotate(${rotation})`}>
            <circle r="10" fill={active ? '#0f172a' : '#ffffff'} stroke={active ? '#0f172a' : '#94a3b8'} strokeWidth="1.5" />
            {active && prep === 'implant' && <circle r="3.5" fill="#ffffff" stroke="none" />}
            <text
              x="0"
              y={arch === 'upper' ? -18 : 26}
              textAnchor="middle"
              transform={`rotate(${-rotation})`}
              fontSize="12"
              fontWeight={active ? 700 : 500}
              fill={active ? '#0f172a' : '#64748b'}
            >
              {id}
            </text>
          </g>
        );
      })}
      <text x="500" y="36" textAnchor="middle" fontSize="11" letterSpacing="3" fill="#94a3b8">MAXILLA</text>
      <text x="500" y="664" textAnchor="middle" fontSize="11" letterSpacing="3" fill="#94a3b8">MANDIBLE</text>
    </svg>
    <div className="text-[10px] text-slate-600 mt-1">
      <span className="font-bold">Case units:</span>{' '}
      {selectedTeeth.length ? selectedTeeth.join(', ') : '—'}
      {selectedTeeth.length === 1 && String(toothDetails[selectedTeeth[0]]?.prep_type || '') && (
        <span> · Prep: {String(toothDetails[selectedTeeth[0]].prep_type).replace(/_/g, ' ')}</span>
      )}
    </div>
  </div>
);

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
    <div className="font-semibold">{value || '—'}</div>
  </div>
);

const SigLine: React.FC<{ label: string }> = ({ label }) => (
  <div className="pt-8">
    <div className="border-t border-slate-500 w-48" />
    <div className="text-[9px] uppercase tracking-wider text-slate-500 mt-1">{label}</div>
  </div>
);
