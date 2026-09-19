import React from 'react';
import { DentalCase, Invoice, BrandingSettings, PaymentRecord } from '../../types';
import { TOOTH_NAMES, SHADE_COLORS } from '../cases/Odontogram';

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
  caseData,
  invoice,
  labName,
  payment,
  period,
}) => {
  const lab = branding;
  const title =
    kind === 'job_slip' ? 'DENTAL LAB JOB SLIP'
    : kind === 'invoice' ? 'INVOICE'
    : kind === 'receipt' ? 'PAYMENT RECEIPT'
    : 'ACCOUNT STATEMENT';

  const toothDetails = (caseData?.tooth_details || {}) as Record<number, any>;

  const invPayments = invoice?.payments || [];
  const latestPayment = payment || invPayments[invPayments.length - 1] || null;

  const statementInvoices: Invoice[] = invoice ? [invoice] : [];

  return (
    <div className="print-doc bg-white text-slate-900" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
      {on(sections, 'brand') && (
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-3">
          <div className="flex items-center gap-3">
            {lab.logoUrl && <img src={lab.logoUrl} alt="" className="h-12 w-12 object-contain" />}
            <div>
              <div className="text-xl font-bold tracking-tight">{lab.lab_name || lab.appName || 'Dental Lab'}</div>
              {lab.tagline && <div className="text-[11px] italic text-slate-600">{lab.tagline}</div>}
            </div>
          </div>
          <div className="text-right text-[10px] text-slate-600 leading-relaxed">
            {lab.address && <div>{lab.address}</div>}
            {lab.phone && <div>Tel: {lab.phone}</div>}
            {lab.email && <div>{lab.email}</div>}
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
            <div className="grid grid-cols-3 gap-4 mb-3 text-[11px]">
              <Field label="Invoice #" value={invoice.invoice_number} />
              <Field label="Issue Date" value={invoice.issue_date || invoice.created_at?.slice(0, 10) || '—'} />
              <Field label="Due Date" value={invoice.due_date || '—'} />
            </div>
          )}
          {on(sections, 'billTo') && (
            <div className="grid grid-cols-3 gap-4 mb-4 text-[11px]">
              <Field label="Bill To (Clinic)" value={invoice.lab_name} />
              <Field label="Doctor" value={`Dr. ${invoice.doctor_name || '—'}`} />
              <Field label="Patient" value={invoice.patient_name || '—'} />
            </div>
          )}
          {on(sections, 'lineItems') && (
            <table className="w-full border-collapse text-[11px] mb-4">
              <thead>
                <tr>
                  {['Description', 'Units', 'Rate', 'Amount'].map((h) => (
                    <th key={h} className={`border border-slate-400 bg-slate-100 px-2 py-1 text-left font-bold ${h === 'Amount' ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-400 px-2 py-1">
                    {invoice.case_type_name}
                    {invoice.case_number && <span className="text-slate-500"> · Case {invoice.case_number}</span>}
                  </td>
                  <td className="border border-slate-400 px-2 py-1">1</td>
                  <td className="border border-slate-400 px-2 py-1 text-right">{money(invoice.amount)}</td>
                  <td className="border border-slate-400 px-2 py-1 text-right">{money(invoice.amount)}</td>
                </tr>
                {invoice.discount > 0 && (
                  <tr>
                    <td className="border border-slate-400 px-2 py-1">Discount</td>
                    <td className="border border-slate-400 px-2 py-1"></td>
                    <td className="border border-slate-400 px-2 py-1 text-right">-</td>
                    <td className="border border-slate-400 px-2 py-1 text-right">-{money(invoice.discount)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {on(sections, 'totals') && (
            <div className="flex justify-end mb-4">
              <table className="text-[11px] w-64">
                <tbody>
                  <tr><td className="py-0.5 text-slate-600">Total</td><td className="py-0.5 text-right font-bold">{money(invoice.amount)}</td></tr>
                  {invoice.discount > 0 && <tr><td className="py-0.5 text-slate-600">Discount</td><td className="py-0.5 text-right">-{money(invoice.discount)}</td></tr>}
                  <tr className="border-t border-slate-400"><td className="py-0.5 font-bold">Net Payable</td><td className="py-0.5 text-right font-bold">{money(invoice.final_amount)}</td></tr>
                  <tr><td className="py-0.5 text-slate-600">Paid</td><td className="py-0.5 text-right text-emerald-700">{money(invoice.amount_paid || 0)}</td></tr>
                  <tr className="border-t-2 border-slate-900"><td className="py-1 font-bold">Balance Due</td><td className="py-1 text-right font-bold">{money(invoice.final_amount - (invoice.amount_paid || 0))}</td></tr>
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
