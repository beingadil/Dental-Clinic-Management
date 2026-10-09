import React, { useRef, useState } from 'react';
import { Drawer, InvoiceStatusBadge } from '../common/ui';
import { useApp } from '../../context/AppContext';
import { Invoice, PaymentRecord, AccountAdjustment } from '../../types';
import { formatPKR, deriveInvoiceStatus } from '../../services/financeDomain';
import { formatDoctorName } from '../../utils/doctorName';
import { caseDetailLines } from '../../services/ledgerCaseDetail';
import { availableAdvanceCredit } from '../../services/transactionDomain';
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
  ArrowLeftRight,
  Wallet
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
  const { cases, accountAdjustments, journalEntries, advancePayments, applyAdvanceCreditV2 } = useApp();
  const [jvOpen, setJvOpen] = useState(false);

  /* B7: quick-apply of unallocated clinic advance credit (folded in from the
     retired AccountsFinancialHome). Inline errors + synchronous latch, same
     discipline as ReversalModal / RecordTransactionModal. */
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyAmount, setApplyAmount] = useState('');
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyDone, setApplyDone] = useState<string | null>(null);
  const applyLatchRef = useRef(false);

  // Escape, focus-in/out and Tab containment now come from the shared Drawer
  // primitive (V-19), which arbitrates against any dialog opened on top of it —
  // a local Escape listener here would also close the drawer when the user was
  // dismissing a nested modal.

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
  const availableCredit = availableAdvanceCredit(advancePayments, invoice.lab_id);

  const handleApplyAdvance = () => {
    if (applyLatchRef.current) return;
    const amount = Number(applyAmount);
    if (!amount || amount <= 0 || isNaN(amount)) {
      setApplyError('Enter an amount greater than zero.');
      return;
    }
    if (amount > availableCredit) {
      setApplyError(`Only ${formatPKR(availableCredit)} of advance credit is available for this clinic.`);
      return;
    }
    if (amount > netDue) {
      setApplyError(`Amount exceeds the ${formatPKR(netDue)} still due on this invoice.`);
      return;
    }
    applyLatchRef.current = true;
    try {
      const ok = applyAdvanceCreditV2({
        clinicId: invoice.lab_id,
        invoiceId: invoice.id,
        amount,
        notes: 'Applied from clinic credit wallet'
      });
      if (!ok) {
        setApplyError('Could not apply the advance — the wallet or invoice changed. Reopen the drawer and retry.');
        return;
      }
      setApplyError(null);
      setApplyDone(`Applied ${formatPKR(amount)} of advance credit to ${invoice.invoice_number}.`);
      setApplyOpen(false);
      setApplyAmount('');
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Could not apply the advance credit.');
    } finally {
      applyLatchRef.current = false;
    }
  };

  // Journal entries linked to this invoice or any of its payments
  const linkedJournals = journalEntries.filter(
    (j) => j.reference_number === invoice.invoice_number || j.reference_id === invoice.id ||
      (invoice.payments || []).some((p) => p.id === j.reference_id || p.payment_number === j.reference_number
        || (p.payment_number || '').replace(/-D?\d+$/, '') === j.reference_number)
  );

  return (
    <Drawer
      open
      onClose={onClose}
      label={`Invoice ${invoice.invoice_number} details`}
      hideClose
      header={
        <>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 font-mono">
                  {invoice.invoice_number}
                </h2>
                {/* V-18 — the canonical chip, so this status reads identically to
                    the invoice list and the register (overdue/voided included). */}
                <InvoiceStatusBadge status={statusV2} size="xs" />
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {invoice.patient_name || 'Walk-in Patient'} · {invoice.case_type_name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onPrintInvoice(invoice)}
              className="p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition-colors cursor-pointer"
              title="Print Official Invoice Statement"
              aria-label="Print official invoice statement"
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-ink-muted hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </>
      }
    >

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Clinic & Due Summary Card */}
          <div className="p-4 rounded-xl bg-slate-900 text-white shadow-sm flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-300 font-medium uppercase tracking-wider block mb-1">
                Outstanding Balance Due
              </span>
              <span className="text-2xl font-bold font-mono text-white">
                {formatPKR(netDue)}
              </span>
              <div className="text-xs text-slate-300 mt-1 flex items-center gap-2">
                <Building2 className="w-3.5 h-3.5 text-slate-300" />
                <span>{invoice.lab_name}</span>
              </div>
            </div>

            <div className="text-right space-y-1">
              <div className="text-xs text-slate-300">Total Billed: <strong className="text-white font-mono">{formatPKR(invoice.final_amount)}</strong></div>
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
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Billed For Patient</span>
                <span className="text-base font-bold text-slate-900 truncate block">
                  {invoice.patient_name || linkedCase?.patient_name || 'Walk-in Patient'}
                </span>
                <div className="flex items-center gap-2 mt-1 text-xs text-slate-600 flex-wrap">
                  <span className="inline-flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-ink-muted" /> {formatDoctorName(invoice.doctor_name || linkedCase?.doctor_name)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-ink-muted" /> {invoice.lab_name}
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
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Procedure</span>
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

              {/* Same rows as the ledger's case block, from the same formatter,
                  so the invoice and the statement cannot drift apart. Empty
                  values drop out rather than printing a placeholder. */}
              <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                {caseDetailLines(linkedCase).map((d) => (
                  <div key={d.label} className="min-w-0">
                    <span className="text-slate-500 block">{d.label}</span>
                    <span
                      className={
                        d.label === 'Teeth'
                          ? 'font-semibold text-slate-900 font-mono truncate block'
                          : 'font-semibold text-slate-900 truncate block'
                      }
                    >
                      {d.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Settlement / Payments Timeline */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <ArrowDownLeft className="w-4 h-4 text-ink-success" />
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

            {/* Advance wallet credit: apply to this invoice without posting cash */}
            {netDue > 0 && availableCredit > 0 && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setApplyOpen((v) => !v);
                    setApplyError(null);
                  }}
                  aria-expanded={applyOpen}
                  className="text-xs font-semibold text-indigo-800 hover:text-indigo-900 flex items-center gap-1.5"
                >
                  <Wallet className="w-3.5 h-3.5" />
                  Apply clinic advance credit ({formatPKR(availableCredit)} available)
                </button>

                {applyOpen && (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleApplyAdvance();
                    }}
                  >
                    <label className="text-[11px] font-semibold text-indigo-900 flex flex-col gap-1">
                      Amount to apply (PKR)
                      <input
                        type="number"
                        min={1}
                        step="0.01"
                        value={applyAmount}
                        onChange={(e) => {
                          setApplyAmount(e.target.value);
                          setApplyError(null);
                        }}
                        aria-invalid={!!applyError}
                        className="w-40 px-2 py-1.5 text-xs font-mono tabular-nums bg-white border border-indigo-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </label>
                    <button
                      type="submit"
                      className="px-3 py-1.5 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold transition-colors"
                    >
                      Apply Advance
                    </button>
                    <p className="text-[11px] text-indigo-900/80 basis-full">
                      Settles this invoice from the clinic wallet, oldest advance first. No cash movement is posted.
                    </p>
                  </form>
                )}

                {applyError && (
                  <p role="alert" className="text-[11px] font-semibold text-rose-700">
                    {applyError}
                  </p>
                )}
                {applyDone && !applyError && (
                  <p role="status" className="text-[11px] font-semibold text-emerald-700">
                    {applyDone}
                  </p>
                )}
              </div>
            )}

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
                      pmt.is_reversed ? 'bg-rose-50/50 border-rose-200 opacity-60' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-900">{pmt.payment_number}</span>
                        <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 uppercase">
                          {pmt.payment_method}
                        </span>
                        {pmt.is_reversed && (
                          <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-rose-100 text-rose-700 uppercase">
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
                        <div className="text-[11px] text-rose-700 italic">
                          Reason: {pmt.reversal_reason}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`font-mono font-bold text-sm ${
                        pmt.is_reversed ? 'text-ink-muted line-through' : 'text-emerald-700'
                      }`}>
                        {formatPKR(pmt.amount)}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onViewReceipt(pmt)}
                          className="p-1.5 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                          title="View Official Receipt" aria-label="View official receipt"
                        >
                          <Receipt className="w-4 h-4" />
                        </button>
                        {!pmt.is_reversed && (
                          <button
                            type="button"
                            onClick={() => onReversePayment(pmt)}
                            className="p-1.5 rounded text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                            title="Reverse Payment (Audit Correction)" aria-label="Reverse payment (audit correction)"
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
                <Scale className="w-4 h-4 text-ink-muted" />
                System Ledger Entry (Journal Voucher)
                {linkedJournals.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[11px] font-bold">{linkedJournals.length}</span>
                )}
              </span>
              <ChevronRight className={`w-4 h-4 transition-transform ${jvOpen ? 'rotate-90' : ''}`} />
            </button>
            {jvOpen && (
              <div className="px-4 pb-3.5 space-y-2">
                {linkedJournals.length === 0 ? (
                  <p className="text-[11px] text-slate-500 italic">No journal entries recorded for this invoice yet.</p>
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
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-ink-muted uppercase tracking-wider">
                            <th scope="col" className="text-left font-bold py-0.5">Account</th>
                            <th scope="col" className="text-right font-bold py-0.5">Debit</th>
                            <th scope="col" className="text-right font-bold py-0.5">Credit</th>
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
                <ShieldCheck className="w-4 h-4 text-ink-warning" />
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
                        <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800 uppercase">
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
                className="px-4 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
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
    </Drawer>
  );
};
