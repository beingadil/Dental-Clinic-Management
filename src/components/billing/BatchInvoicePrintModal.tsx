import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Invoice } from '../../types';
import { DatePickerRange, todayISO } from '../common/DatePickerRange';
import { getDateStr, getTodayStr } from '../../utils/dateUtils';
import { formatDoctorName } from '../../utils/doctorName';
import { findCaseForInvoice } from '../../services/ledgerCaseDetail';
import { PrintDocument, DEFAULT_ENABLED } from '../print/printRenderer';
import { SavePdfButton } from '../print/SavePdfButton';
import { loadPrintSettings, loadDocumentSections } from '../../services/printSettings';
import '../print/printStyles.css';
import { Printer, X, FileSpreadsheet, Building2, CheckCircle2 } from 'lucide-react';
import { Modal } from '../common/ui';

interface BatchInvoicePrintModalProps {
  /** Clinic pre-selected from the billing filter, if any. */
  initialLabId?: string;
  onClose: () => void;
}

const firstOfMonth = (d: Date = new Date()) =>
  getDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
const lastOfMonth = (d: Date = new Date()) =>
  getDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
const lastMonthStart = () => {
  const n = new Date();
  return firstOfMonth(new Date(n.getFullYear(), n.getMonth() - 1, 1));
};
const lastMonthEnd = () => {
  const n = new Date();
  return lastOfMonth(new Date(n.getFullYear(), n.getMonth() - 1, 1));
};

export const BatchInvoicePrintModal: React.FC<BatchInvoicePrintModalProps> = ({
  initialLabId,
  onClose,
}) => {
  const { labs, invoices, cases, brandingSettings, saveVoucherToSystem } = useApp();

  const [labId, setLabId] = useState<string>(initialLabId || labs[0]?.id || '');
  // Default the period to today, matching every other billing tab; the quick
  // ranges below are the way out to a wider window.
  const [from, setFrom] = useState<string>(() => todayISO());
  const [to, setTo] = useState<string>(() => todayISO());
  const [excluded, setExcluded] = useState<string[]>([]);
  const [printSettings] = useState(() => loadPrintSettings());
  /* Same stored invoice content list as the single-invoice dialog. */
  const [invoiceSections] = useState<string[]>(() =>
    loadDocumentSections('invoice', DEFAULT_ENABLED.invoice)
  );
  /* Statement section list for the one-sheet batch summary. */
  const [statementSections] = useState<string[]>(() =>
    loadDocumentSections('statement', DEFAULT_ENABLED.statement)
  );

  const dateOf = (inv: Invoice) => String(inv.issue_date || inv.created_at || '').slice(0, 10);

  /* Unpaid invoices for the chosen clinic inside the chosen period — real rows
     only, oldest first so the printed stack matches the ledger sequence. */
  const unpaidInvoices = useMemo(() => {
    return invoices
      .filter((inv) => {
        if (inv.lab_id !== labId) return false;
        const due = inv.final_amount - (inv.amount_paid || 0) - (inv.credit_notes_total || 0);
        if (due <= 0) return false;
        const d = dateOf(inv);
        if (!d) return true;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      })
      .sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
  }, [invoices, labId, from, to]);

  const selected = unpaidInvoices.filter((inv) => !excluded.includes(inv.id));
  const selectedTotal = selected.reduce(
    (sum, inv) => sum + Math.max(0, inv.final_amount - (inv.amount_paid || 0) - (inv.credit_notes_total || 0)),
    0
  );

  const toggle = (id: string) =>
    setExcluded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectedClinic = labs.find((l) => l.id === labId);

  const handlePrint = () => {
    if (selected.length === 0) return;
    // Every printed billing document is logged, one voucher per invoice.
    selected.forEach((inv) => {
      const due = Math.max(0, inv.final_amount - (inv.amount_paid || 0) - (inv.credit_notes_total || 0));
      saveVoucherToSystem({
        voucher_number: inv.invoice_number,
        voucher_type: 'invoice',
        case_id: inv.case_id,
        case_number: inv.case_number,
        lab_name: inv.lab_name,
        doctor_name: inv.doctor_name,
        patient_name: inv.patient_name || 'Clinical Patient',
        case_type_name: inv.case_type_name,
        amount: inv.final_amount,
        notes: `Batch print (${selected.length} invoices) ${from || 'start'} → ${to || 'today'} — Paid: PKR ${(inv.amount_paid || 0).toLocaleString()} | Balance: PKR ${due.toLocaleString()}`,
      });
    });
    setTimeout(() => window.print(), 100);
  };

  return (
    // Card = print area, exactly like the single-invoice dialog: one sheet per
    // selected invoice, nothing wrapping the sheets in `.no-print`. The shared
    // Modal adds no wrapper of its own, so that contract is preserved.
    <Modal
      open
      onClose={onClose}
      label="Batch invoice printing"
      hideClose
      maxWidth="max-w-5xl"
      backdropClassName="bg-slate-900/70 no-print-backdrop"
      cardClassName="print-area printable-area relative"
      headerClassName="no-print flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
      header={
        <>
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-slate-100 p-2 text-slate-700">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Batch Print Unpaid Invoices</h3>
              <p className="text-xs text-slate-500">
                Pick a clinic and a period — all unpaid invoices print on one summary sheet.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SavePdfButton
              suggestedName={`Unpaid-Invoices-${getTodayStr()}.pdf`}
              disabled={selected.length === 0}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-white border border-slate-300 px-4 py-1.5 text-xs font-bold text-slate-700 shadow-xs transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handlePrint}
              disabled={selected.length === 0}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-ink-muted"
            >
              <Printer className="h-4 w-4" /> Print {selected.length || ''} Invoice{selected.length === 1 ? '' : 's'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </>
      }
    >

        {/* Controls */}
        <div className="no-print grid grid-cols-1 gap-4 border-b border-slate-200 bg-slate-50/60 px-6 py-4 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600">
              <Building2 className="h-3.5 w-3.5 text-indigo-600" /> Clinic
            </label>
            <select
              value={labId}
              onChange={(e) => {
                setLabId(e.target.value);
                setExcluded([]);
              }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-900 focus:border-indigo-600 focus:outline-none"
            >
              {labs.length === 0 && <option value="">No clinics registered</option>}
              {labs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.doctor_name ? ` — ${formatDoctorName(l.doctor_name)}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-7">
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600">
              Period
            </label>
            <DatePickerRange
              from={from}
              to={to}
              className="w-full [&>button]:w-full [&>button]:justify-start"
              quickRanges={[
                { label: 'Today', from: todayISO(), to: todayISO() },
                { label: 'This Month', from: firstOfMonth(), to: lastOfMonth() },
                { label: 'Last Month', from: lastMonthStart(), to: lastMonthEnd() },
                { label: 'All Time', from: '', to: '' },
              ]}
              onChange={(f, t) => {
                setFrom(f);
                setTo(t);
              }}
            />
          </div>
        </div>

        {/* Selection list */}
        <div className="no-print max-h-72 overflow-y-auto border-b border-slate-100">
          {unpaidInvoices.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-bold text-slate-800">No unpaid invoices in this period</p>
              <p className="mt-1 text-xs text-slate-500">
                {selectedClinic
                  ? `${selectedClinic.name} has no outstanding invoices between ${from || 'the earliest record'} and ${to || 'today'}.`
                  : 'Select a clinic to continue.'}
              </p>
            </div>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-white text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th scope="col" className="w-10 py-2.5 pl-6">✓</th>
                  <th scope="col" className="py-2.5 px-3">Invoice</th>
                  <th scope="col" className="py-2.5 px-3">Case</th>
                  <th scope="col" className="py-2.5 px-3">Doctor</th>
                  <th scope="col" className="py-2.5 px-3">Date</th>
                  <th scope="col" className="py-2.5 px-6 text-right">Balance Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {unpaidInvoices.map((inv) => {
                  const due = Math.max(
                    0,
                    inv.final_amount - (inv.amount_paid || 0) - (inv.credit_notes_total || 0)
                  );
                  const isOn = !excluded.includes(inv.id);
                  const linkedCase = findCaseForInvoice(inv, cases);
                  return (
                    <tr key={inv.id} className={isOn ? 'bg-indigo-50/40' : 'bg-white'}>
                      <td className="py-2.5 pl-6 align-top">
                        <input
                          type="checkbox"
                          checked={isOn}
                          onChange={() => toggle(inv.id)}
                          className="h-4 w-4 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="py-2.5 px-3 align-top font-mono font-bold text-slate-900">{inv.invoice_number}</td>
                      {/* The job behind the invoice, so the operator can see
                          what they are about to print without opening each
                          case. Falls back to the bare case number. */}
                      <td className="py-2.5 px-3 align-top text-slate-600">
                        <span className="font-semibold text-slate-800">{inv.case_number || '—'}</span>
                        {linkedCase && (
                          <span className="mt-0.5 block text-[11px] leading-tight">
                            {[linkedCase.patient_name, linkedCase.case_type_name || linkedCase.case_type]
                              .filter(Boolean)
                              .join(' · ') || null}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 align-top text-slate-600">
                        {formatDoctorName(inv.doctor_name)}
                      </td>
                      <td className="py-2.5 px-3 align-top text-slate-500">
                        {String(inv.issue_date || inv.created_at || '').slice(0, 10) || '—'}
                      </td>
                      <td className="py-2.5 px-6 text-right align-top font-mono font-bold text-slate-900">
                        PKR {due.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-100 text-xs font-bold text-slate-900">
                  <td colSpan={5} className="py-3 pl-6 uppercase tracking-wider">
                    {selected.length} of {unpaidInvoices.length} invoices selected
                  </td>
                  <td className="py-3 px-6 text-right font-mono">PKR {selectedTotal.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Paper preview — ONE summary sheet listing every selected unpaid
            invoice (no per-invoice page breaks). NOT `.no-print`: the preview
            shell must stay printable, otherwise the whole batch comes out
            blank (the card above carries print-area). */}
        <div className="print-preview-shell">
          <div className={printSettings.paper === 'letter' ? 'print-preview-page paper-letter' : 'print-preview-page'}>
            <div>
              {selected.length === 0 ? (
                <div className="py-16 text-center text-xs text-ink-muted">
                  <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                  Nothing selected to print.
                </div>
              ) : (
                <PrintDocument
                  kind="statement"
                  sections={statementSections}
                  branding={brandingSettings}
                  printSettings={printSettings}
                  invoices={selected}
                  cases={cases}
                  labName={selectedClinic?.name}
                  period={{ from, to }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Screen footer */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-3">
          <span className="text-xs text-slate-500">
            Each printed invoice is logged to billing history.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg bg-slate-100 px-4 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200"
          >
            Close
          </button>
        </div>
    </Modal>
  );
};
