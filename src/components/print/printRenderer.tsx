import React from 'react';
import { DentalCase, Invoice, BrandingSettings, PaymentRecord } from '../../types';
import { TOOTH_NAMES, SHADE_COLORS, getToothLayout } from '../cases/Odontogram';

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
    { id: 'invoiceTable', label: 'Invoice ledger table', hint: 'All invoices in period' },
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
  labName?: string;
  payment?: PaymentRecord | null;
  period?: { from: string; to: string };
}

export const PrintDocument: React.FC<PrintDocumentProps> = ({
  kind,
  sections,
  branding,
  printSettings,
  caseData,
  invoice,
  labName,
  payment,
  period,
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

  const toothDetails = (caseData?.tooth_details || {}) as Record<number, any>;

  /* Honest settlement label — read from the invoice itself, never guessed. */
  const invStatus = (() => {
    if (!invoice) return null;
    const due = Math.max(0, invoice.final_amount - (invoice.amount_paid || 0));
    if (due <= 0) return { label: 'PAID IN FULL', tone: 'paid' as const };
    if ((invoice.amount_paid || 0) > 0) return { label: 'PARTIALLY PAID', tone: 'partial' as const };
    return { label: 'PAYMENT DUE', tone: 'due' as const };
  })();

  const invPayments = invoice?.payments || [];
  const latestPayment = payment || invPayments[invPayments.length - 1] || null;

  const statementInvoices: Invoice[] = invoice ? [invoice] : [];

  // Dynamic page setup — the chosen paper size + margin become the actual
  // @page rule for printing (overrides the 12mm stylesheet default).
  const pageMarginMm = margin === 'narrow' ? 8 : margin === 'wide' ? 18 : 12;
  const pageSetupCss = `@page { size: ${paper === 'letter' ? 'letter' : 'A4'}; margin: ${pageMarginMm}mm; }`;

  return (
    <div className={`print-doc bg-white text-slate-900 print-fs-${fontSize}`} style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
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
        </div>
      )}

      {/* ============ JOB SLIP ============ */}
      {kind === 'job_slip' && caseData && (
        <>
          {on(sections, 'clinicDoctor') && (
            <div className="grid grid-cols-2 gap-4 mb-3">
              <Field label="Dental Clinic" value={caseData.lab_name} />
              <Field label="Referring Doctor" value={`Dr. ${caseData.doctor_name}`} />
            </div>
          )}
          {on(sections, 'patient') && (
            <div className="grid grid-cols-2 gap-4 mb-3">
              <Field label="Patient Name / ID" value={caseData.patient_name || '—'} />
              <Field label="Units" value={String(caseData.selected_teeth.length)} />
            </div>
          )}
          {on(sections, 'caseMeta') && (
            <div className="grid grid-cols-3 gap-4 mb-4">
              <Field label="Case #" value={caseData.case_number} />
              <Field label="Priority" value={caseData.priority.toUpperCase()} />
              <Field label="Delivery Due" value={caseData.delivery_date} />
            </div>
          )}
          {on(sections, 'teeth') && (
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
          {on(sections, 'odontogram') && (
            <PrintOdontogram
              selectedTeeth={caseData.selected_teeth}
              toothDetails={toothDetails}
            />
          )}
          {on(sections, 'shade') && (
            <div className="mb-4 text-[11px]">
              <span className="font-bold">Shade: </span>{caseData.shade || '—'}
              {caseData.shade && SHADE_COLORS[caseData.shade] && (
                <span className="inline-block align-middle ml-1 border border-slate-400" style={{ width: 12, height: 12, background: SHADE_COLORS[caseData.shade] }} />
              )}
              <span className="font-bold ml-4">Material: </span>{caseData.material || '—'}
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
                <Field label="Doctor" value={`Dr. ${invoice.doctor_name || '—'}`} />
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
          {on(sections, 'lineItems') && (
            <table className="w-full border-collapse text-[11px] mb-4">
              <thead>
                <tr>
                  {['Description', 'Units', 'Rate', 'Amount'].map((h) => (
                    <th key={h} className={`border border-slate-300 bg-slate-100 px-2 py-1.5 text-[10px] uppercase tracking-wider font-bold ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-300 px-2 py-1.5">
                    <span className="font-semibold">{invoice.case_type_name}</span>
                    {invoice.case_number && <span className="text-slate-500"> · Case {invoice.case_number}</span>}
                    {caseData?.selected_teeth && caseData.selected_teeth.length > 0 && (
                      <div className="text-slate-500">Teeth: {caseData.selected_teeth.map((t) => `#${t}`).join(', ')}</div>
                    )}
                    {(caseData?.material || caseData?.shade) && (
                      <div className="text-slate-500">
                        {[caseData?.material, caseData?.shade && `Shade ${caseData.shade}`].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5">{caseData?.selected_teeth?.length || 1}</td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right">{money(invoice.amount)}</td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right">{money(invoice.amount)}</td>
                </tr>
                {invoice.discount > 0 && (
                  <tr>
                    <td className="border border-slate-300 px-2 py-1.5">Discount</td>
                    <td className="border border-slate-300 px-2 py-1.5"></td>
                    <td className="border border-slate-300 px-2 py-1.5 text-right">-</td>
                    <td className="border border-slate-300 px-2 py-1.5 text-right">-{money(invoice.discount)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {on(sections, 'totals') && (
            <div className="flex justify-end mb-4">
              <table className="w-72 border-collapse text-[11px]">
                <tbody>
                  <tr className="border border-slate-300">
                    <td className="px-3 py-1.5 text-slate-600">Subtotal</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{money(invoice.amount)}</td>
                  </tr>
                  {invoice.discount > 0 && (
                    <tr className="border border-slate-300 border-t-0">
                      <td className="px-3 py-1.5 text-slate-600">Discount</td>
                      <td className="px-3 py-1.5 text-right">-{money(invoice.discount)}</td>
                    </tr>
                  )}
                  <tr className="border border-slate-300 border-t-0">
                    <td className="px-3 py-1.5 font-bold uppercase tracking-wider">Net Payable</td>
                    <td className="px-3 py-1.5 text-right font-bold">{money(invoice.final_amount)}</td>
                  </tr>
                  <tr className="border border-slate-300 border-t-0">
                    <td className="px-3 py-1.5 text-slate-600">Amount Paid</td>
                    <td className="px-3 py-1.5 text-right text-emerald-700">{money(invoice.amount_paid || 0)}</td>
                  </tr>
                  <tr className="border-2 border-slate-900 bg-slate-100">
                    <td className="px-3 py-2 font-bold uppercase tracking-wider">Balance Due</td>
                    <td className="px-3 py-2 text-right text-sm font-bold">
                      {money(Math.max(0, invoice.final_amount - (invoice.amount_paid || 0)))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {on(sections, 'paymentHistory') && (invoice.payments || []).filter((p) => !p.is_reversed).length > 0 && (
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
                  {invoice.payments.filter((p) => !p.is_reversed).map((p) => (
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
              <Field label="Doctor" value={`Dr. ${invoice.doctor_name || '—'}`} />
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
              <Field label="Balance After Payment" value={money(invoice.final_amount - (invoice.amount_paid || 0))} />
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
              <Field label="Generated" value={new Date().toISOString().slice(0, 10)} />
            </div>
          )}
          {on(sections, 'period') && period && (
            <div className="mb-3 text-[11px]">
              <span className="font-bold">Period: </span>{period.from} → {period.to}
            </div>
          )}
          {on(sections, 'invoiceTable') && (
            <table className="w-full border-collapse text-[11px] mb-4">
              <thead>
                <tr>
                  {['Invoice #', 'Date', 'Case', 'Amount', 'Paid', 'Balance', 'Status'].map((h) => (
                    <th key={h} className="border border-slate-400 bg-slate-100 px-2 py-1 text-left font-bold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statementInvoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="border border-slate-400 px-2 py-1 font-bold">{inv.invoice_number}</td>
                    <td className="border border-slate-400 px-2 py-1">{inv.issue_date || inv.created_at?.slice(0, 10) || '—'}</td>
                    <td className="border border-slate-400 px-2 py-1">{inv.case_number || '—'}</td>
                    <td className="border border-slate-400 px-2 py-1 text-right">{money(inv.final_amount)}</td>
                    <td className="border border-slate-400 px-2 py-1 text-right">{money(inv.amount_paid || 0)}</td>
                    <td className="border border-slate-400 px-2 py-1 text-right">{money(inv.final_amount - (inv.amount_paid || 0))}</td>
                    <td className="border border-slate-400 px-2 py-1 capitalize">{inv.payment_status}</td>
                  </tr>
                ))}
                {statementInvoices.length === 0 && (
                  <tr><td colSpan={7} className="border border-slate-400 px-2 py-4 text-center italic text-slate-500">No invoices in this period.</td></tr>
                )}
              </tbody>
            </table>
          )}
          {on(sections, 'balanceSummary') && (
            <div className="flex justify-end mb-4">
              <table className="text-[11px] w-64">
                <tbody>
                  <tr><td className="py-0.5 text-slate-600">Total Billed</td><td className="py-0.5 text-right font-bold">{money(statementInvoices.reduce((s, i) => s + i.final_amount, 0))}</td></tr>
                  <tr><td className="py-0.5 text-slate-600">Total Paid</td><td className="py-0.5 text-right">{money(statementInvoices.reduce((s, i) => s + (i.amount_paid || 0), 0))}</td></tr>
                  <tr className="border-t-2 border-slate-900"><td className="py-1 font-bold">Outstanding</td><td className="py-1 text-right font-bold">{money(statementInvoices.reduce((s, i) => s + (i.final_amount - (i.amount_paid || 0)), 0))}</td></tr>
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
