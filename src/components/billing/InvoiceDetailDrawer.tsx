import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Invoice, PaymentRecord, AccountAdjustment } from '../../types';
import { formatPKR, deriveInvoiceStatus } from '../../services/financeDomain';
import { 
  X, 
  FileText, 
  Calendar, 
  Building2, 
  User, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Scale, 
  Printer, 
  Plus, 
  ArrowDownLeft, 
  ShieldCheck, 
  ExternalLink,
  ChevronRight,
  Receipt,
  FileDown,
  ArrowLeftRight
} from 'lucide-react';

interface InvoiceDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  onOpenPaymentModal: (invoice: Invoice) => void;
  onOpenCreditNoteModal: (invoice: Invoice) => void;
  onOpenJournalModal: (referenceId: string) => void;
  onPrintInvoice: (invoice: Invoice) => void;
  onViewReceipt: (payment: PaymentRecord) => void;
  onReversePayment: (payment: PaymentRecord) => void;
}

export const InvoiceDetailDrawer: React.FC<InvoiceDetailDrawerProps> = ({
  isOpen,
  onClose,
  invoice,
  onOpenPaymentModal,
  onOpenCreditNoteModal,
  onOpenJournalModal,
  onPrintInvoice,
  onViewReceipt,
  onReversePayment
}) => {
  const { cases, accountAdjustments, journalEntries } = useApp();
  const [jvOpen, setJvOpen] = useState(false);

  if (!isOpen || !invoice) return null;

  const linkedCase = cases.find((c) => c.id === invoice.case_id);
  const creditNotes = accountAdjustments.filter(
    (a) => a.invoice_id === invoice.id && !a.is_reversed
  );

  const totalPaid = invoice.amount_paid || 0;
  const totalCredits = invoice.credit_notes_total || 0;
  const netDue = Math.max(0, invoice.final_amount - totalPaid - totalCredits);

  const isPaid = netDue <= 0;
  const statusV2 = invoice.status_v2 || deriveInvoiceStatus(invoice.final_amount, totalPaid, invoice.due_date, totalCredits);

  // Journal entries linked to this invoice or any of its payments
  const linkedJournals = journalEntries.filter(
    (j) => j.reference_number === invoice.invoice_number || j.reference_id === invoice.id ||
      (invoice.payments || []).some((p) => p.id === j.reference_id || p.payment_number === j.reference_number)
  );

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/50 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 font-mono">
                  {invoice.invoice_number}
                </h2>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase ${
                  isPaid
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : totalPaid > 0
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {statusV2.replace('_', ' ')}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {invoice.patient_name || 'Walk-in Patient'} · {invoice.case_type_name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onPrintInvoice(invoice)}
              className="p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition-colors"
              title="Print Official Invoice Statement"
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Clinic & Due Summary Card */}
          <div className="p-4 rounded-xl bg-slate-900 text-white shadow-sm flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 font-medium uppercase tracking-wider block mb-1">
                Outstanding Balance Due
              </span>
              <span className="text-2xl font-bold font-mono text-white">
                {formatPKR(netDue)}
              </span>
              <div className="text-xs text-slate-300 mt-1 flex items-center gap-2">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                <span>{invoice.lab_name}</span>
              </div>
            </div>

            <div className="text-right space-y-1">
              <div className="text-xs text-slate-400">Total Billed: <strong className="text-white font-mono">{formatPKR(invoice.final_amount)}</strong></div>
              <div className="text-xs text-emerald-400">Total Settled: <strong className="font-mono">{formatPKR(totalPaid)}</strong></div>
              {totalCredits > 0 && (
                <div className="text-xs text-amber-400">Credit Notes: <strong className="font-mono">{formatPKR(totalCredits)}</strong></div>
              )}
            </div>
          </div>

          {/* Bill-To — the person this invoice belongs to */}
          <div className="p-4 rounded-xl border border-slate-200 bg-white">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Billed For Patient</span>
                <span className="text-base font-bold text-slate-900 truncate block">
                  {invoice.patient_name || linkedCase?.patient_name || 'Walk-in Patient'}
                </span>
                <div className="flex items-center gap-2 mt-1 text-xs text-slate-600 flex-wrap">
                  <span className="inline-flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-slate-400" /> Dr. {invoice.doctor_name || linkedCase?.doctor_name || '—'}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" /> {invoice.lab_name}
                  </span>
                  {invoice.case_number && (
                    <span className="font-mono font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                      {invoice.case_number}
                    </span>
                  )}
                </div>
              </div>
              {invoice.case_type_name && (
                <div className="text-right shrink-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Procedure</span>
                  <span className="text-xs font-semibold text-slate-800">{invoice.case_type_name}</span>
                </div>
              )}
            </div>
          </div>

          {/* Key Dates & Reference Grid */}
          <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3.5 rounded-lg border border-slate-200">
            <div>
              <span className="text-slate-500 block mb-0.5">Invoice Date</span>
              <span className="font-semibold text-slate-800">{invoice.issue_date || invoice.created_at?.slice(0, 10)}</span>
            </div>
            <div>
              <span className="text-slate-500 block mb-0.5">Due Date</span>
              <span className="font-semibold text-slate-800">{invoice.due_date || 'Due upon receipt'}</span>
            </div>
          </div>

          {/* Linked Dental Case Metadata */}
          {linkedCase && (
            <div className="p-4 rounded-lg border border-slate-200 bg-white space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-slate-500" />
                  Clinical Case Information
                </span>
                <span className="font-mono text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                  {linkedCase.case_number}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block">Patient Name</span>
                  <span className="font-semibold text-slate-900">{linkedCase.patient_name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Doctor / Surgeon</span>
                  <span className="font-semibold text-slate-900">Dr. {linkedCase.doctor_name || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Case Type</span>
                  <span className="font-semibold text-slate-900">{linkedCase.case_type}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Shade Guide</span>
                  <span className="font-semibold text-slate-900">{linkedCase.shade || 'A2'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Units / Teeth</span>
                  <span className="font-semibold text-slate-900">{linkedCase.units_count || 1} Unit(s)</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Status</span>
                  <span className="font-semibold capitalize text-slate-900">{linkedCase.status.replace('_', ' ')}</span>
                </div>
              </div>
            </div>
          )}

          {/* Settlement / Payments Timeline */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
                Payment Allocations & Receipts ({(invoice.payments || []).length})
              </h3>
              {netDue > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenPaymentModal(invoice)}
                  className="px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-md border border-emerald-200 flex items-center gap-1 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Collect Payment
                </button>
              )}
            </div>

            {(!invoice.payments || invoice.payments.length === 0) ? (
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
                No payments have been applied to this invoice yet.
              </div>
            ) : (
              <div className="space-y-2">
                {invoice.payments.map((pmt) => (
                  <div
                    key={pmt.id}
                    className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
                      pmt.is_reversed ? 'bg-red-50/50 border-red-200 opacity-60' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-900">{pmt.payment_number}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 uppercase">
                          {pmt.payment_method}
                        </span>
                        {pmt.is_reversed && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700 uppercase">
                            REVERSED
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-2">
                        <span>{pmt.payment_date}</span>
                        {pmt.reference_number && <span>• Ref: {pmt.reference_number}</span>}
                        <span>• Recorded by: {pmt.recorded_by}</span>
                      </div>
                      {pmt.is_reversed && pmt.reversal_reason && (
                        <div className="text-[10px] text-red-700 italic">
                          Reason: {pmt.reversal_reason}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`font-mono font-bold text-sm ${
                        pmt.is_reversed ? 'text-slate-400 line-through' : 'text-emerald-700'
                      }`}>
                        {formatPKR(pmt.amount)}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onViewReceipt(pmt)}
                          className="p-1.5 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                          title="View Official Receipt"
                        >
                          <Receipt className="w-4 h-4" />
                        </button>
                        {!pmt.is_reversed && (
                          <button
                            type="button"
                            onClick={() => onReversePayment(pmt)}
                            className="p-1.5 rounded text-red-500 hover:text-red-700 hover:bg-red-50 transition-colors"
                            title="Reverse Payment (Audit Correction)"
                          >
                            <ArrowLeftRight className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* System Ledger Entry (JV) — collapsed by default */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/60">
            <button
              type="button"
              onClick={() => setJvOpen((v) => !v)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-slate-400" />
                System Ledger Entry (Journal Voucher)
                {linkedJournals.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[10px] font-bold">{linkedJournals.length}</span>
                )}
              </span>
              <ChevronRight className={`w-4 h-4 transition-transform ${jvOpen ? 'rotate-90' : ''}`} />
            </button>
            {jvOpen && (
              <div className="px-4 pb-3.5 space-y-2">
                {linkedJournals.length === 0 ? (
                  <p className="text-[11px] text-slate-400 italic">No journal entries recorded for this invoice yet.</p>
                ) : (
                  linkedJournals.map((j) => (
                    <div key={j.id} className="bg-white rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-mono text-xs font-bold text-slate-800">{j.journal_number}</span>
                        <button
                          type="button"
                          onClick={() => onOpenJournalModal(invoice.invoice_number)}
                          className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                        >
                          Open in Ledger
                        </button>
                      </div>
                      <div className="text-[11px] text-slate-500 mb-2">{j.date} · {j.description}</div>
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="text-slate-400 uppercase tracking-wider">
                            <th className="text-left font-bold py-0.5">Account</th>
                            <th className="text-right font-bold py-0.5">Debit</th>
                            <th className="text-right font-bold py-0.5">Credit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {j.lines.map((l) => (
                            <tr key={l.id} className="border-t border-slate-100">
                              <td className="py-1 text-slate-700">{l.account_code} · {l.account_name}</td>
                              <td className="py-1 text-right font-mono text-slate-700">{l.debit ? formatPKR(l.debit) : '—'}</td>
                              <td className="py-1 text-right font-mono text-slate-700">{l.credit ? formatPKR(l.credit) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Credit Notes & Adjustments */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-amber-600" />
                Credit Notes & Write-Offs ({creditNotes.length})
              </h3>
              {netDue > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenCreditNoteModal(invoice)}
                  className="px-2.5 py-1 text-xs font-semibold bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-md border border-amber-200 flex items-center gap-1 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Issue Credit Note
                </button>
              )}
            </div>

            {creditNotes.length === 0 ? (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
                No credit notes or write-offs issued against this invoice.
              </div>
            ) : (
              <div className="space-y-2">
                {creditNotes.map((cn) => (
                  <div key={cn.id} className="p-3 rounded-lg bg-amber-50/50 border border-amber-200 text-xs flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-amber-900">{cn.adjustment_number}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 uppercase">
                          {cn.type}
                        </span>
                      </div>
                      <p className="text-[11px] text-amber-800 mt-0.5">{cn.reason}</p>
                    </div>
                    <span className="font-mono font-bold text-sm text-amber-700">
                      -{formatPKR(cn.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Drawer Bottom Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <button
            type="button"
            onClick={() => onPrintInvoice(invoice)}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-2 shadow-2xs transition-colors"
          >
            <Printer className="w-4 h-4 text-slate-500" />
            Print Official Invoice
          </button>

          <div className="flex items-center gap-2">
            {netDue > 0 && (
              <button
                type="button"
                onClick={() => onOpenPaymentModal(invoice)}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center gap-1.5 shadow-xs transition-colors"
              >
                <ArrowDownLeft className="w-4 h-4" />
                Collect Payment
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-200 hover:bg-slate-300 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
