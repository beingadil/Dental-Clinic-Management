import React, { useState, useEffect } from 'react';
import { PaymentRecord } from '../../types';
import type { UnifiedTransaction } from '../../services/transactionRegister';
import {
  DollarSign,
  Wallet,
  FileCheck2,
  Printer,
  Image as ImageIcon,
  Scale,
  Trash2
} from 'lucide-react';

interface TransactionRegisterProps {
  /**
   * The rows to render, already filtered. The page owns the filters — search,
   * date range and clinic — so one query drives this register and the invoice
   * table above it instead of the two disagreeing (see BillingView).
   */
  transactions: UnifiedTransaction[];
  onViewProof: (payment: PaymentRecord) => void;
  /** Printing a receipt resolves the invoice from the row the operator clicked. */
  onPrintReceipt: (txn: UnifiedTransaction) => void;
  /**
   * Delete a payment entry — its whole receipt. Never the invoice: voiding one
   * is an action on the invoice table, with its own confirmation. Omitted, the
   * Delete action simply does not render.
   */
  onDeletePayment?: (payment: PaymentRecord) => void;
  /**
   * Change a payment entry's amount. Returns false when the command refused the
   * change (not a positive number, or it would overpay the invoice), and the
   * row then snaps back to the stored amount.
   */
  onEditPaymentAmount?: (payment: PaymentRecord, amount: number) => boolean;
  onOpenJournalModal?: (referenceId: string) => void;
}

/**
 * The amount on a payment entry, editable in place.
 *
 * The draft is local, so a half-typed number never reaches the ledger: it
 * commits once, on blur or Enter, and snaps back to the stored value whenever
 * the command refuses the change. The row — not this input — is the source of
 * truth, which is why there is no error text here to fall out of date.
 */
const EditableAmount: React.FC<{
  value: number;
  label: string;
  onCommit: (next: number) => boolean;
}> = ({ value, label, onCommit }) => {
  const [draft, setDraft] = useState<string>(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const next = Number(draft);
    if (!Number.isFinite(next) || next <= 0 || Math.round(next * 100) === Math.round(value * 100)) {
      setDraft(String(value));
      return;
    }
    if (!onCommit(next)) setDraft(String(value));
  };

  return (
    <input
      type="number"
      min="1"
      step="1"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          // Committed here rather than by blurring: Enter is the commit, and a
          // keystroke must not depend on the browser moving focus for it.
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          setDraft(String(value));
        }
      }}
      aria-label={label}
      title="Edit this amount. The invoice balance and the receipt's journal follow the new figure."
      className="w-24 px-1 py-0.5 text-right font-mono font-bold tabular-nums text-ink-success bg-transparent border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white rounded focus:outline-none"
    />
  );
};

export const TransactionRegister: React.FC<TransactionRegisterProps> = ({
  transactions,
  onViewProof,
  onPrintReceipt,
  onDeletePayment,
  onEditPaymentAmount,
  onOpenJournalModal
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
      {transactions.length === 0 ? (
        <div className="p-12 text-center text-xs text-ink-muted">
          No payments, advances or adjustments match the filters above — widen the
          date range to reach older entries.
        </div>
      ) : (
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 font-bold uppercase text-[11px] text-slate-500 tracking-wider">
                <th scope="col" className="py-2 px-3">Txn / Receipt #</th>
                <th scope="col" className="py-2 px-3">Date</th>
                <th scope="col" className="py-2 px-3">Dental Clinic</th>
                <th scope="col" className="py-2 px-3">Category</th>
                <th scope="col" className="py-2 px-3">Detail & Notes</th>
                <th scope="col" className="py-2 px-3">Method & Ref #</th>
                <th scope="col" className="py-2 px-3 text-right">Amount (PKR)</th>
                <th scope="col" className="py-2 px-3 text-center">Proof Slip</th>
                <th scope="col" className="py-2 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {transactions.map((txn) => {
                const isPayment = txn.sourceType === 'payment';
                const isAdvance = txn.sourceType === 'advance';
                const isAdjustment = txn.sourceType === 'adjustment';

                return (
                  <tr key={`${txn.sourceType}-${txn.id}`} className={`hover:bg-slate-50/80 transition-colors ${txn.isReversed ? 'bg-rose-50/40 opacity-75' : ''}`}>

                    {/* Transaction # */}
                    <td className="py-2 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span>{txn.txnNumber}</span>
                        {txn.isReversed && (
                          <span className="px-1.5 py-0.2 rounded text-[11px] font-bold bg-rose-100 text-rose-700 uppercase tracking-tight">
                            REVERSED
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Date */}
                    <td className="py-2 px-3 text-slate-600 whitespace-nowrap">
                      {txn.date}
                    </td>

                    {/* Clinic Name */}
                    <td className="py-2 px-3 font-semibold text-slate-900">
                      {txn.labName}
                    </td>

                    {/* Category Badge */}
                    <td className="py-2 px-3 whitespace-nowrap">
                      {isPayment && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <DollarSign className="w-3 h-3" />
                          <span>{txn.category}</span>
                        </span>
                      )}
                      {isAdvance && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          <Wallet className="w-3 h-3" />
                          <span>Advance Deposit</span>
                        </span>
                      )}
                      {isAdjustment && (
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                          txn.direction === 'credit'
                            ? 'bg-purple-50 text-purple-700 border border-purple-200'
                            : txn.direction === 'debit'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}>
                          <FileCheck2 className="w-3 h-3" />
                          <span>{txn.category}</span>
                        </span>
                      )}
                    </td>

                    {/* Detail & Staff */}
                    <td className="py-2 px-3 text-slate-600 max-w-xs">
                      <p className="font-medium text-slate-800 line-clamp-1">{txn.detail}</p>
                      <p className="text-[11px] text-slate-500">By {txn.recordedBy}</p>
                    </td>

                    {/* Method & Ref */}
                    <td className="py-2 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase ${
                          txn.method === 'cash'
                            ? 'bg-emerald-100 text-emerald-800'
                            : txn.method === 'bank'
                            ? 'bg-blue-100 text-blue-800'
                            : txn.method === 'cheque'
                            ? 'bg-slate-100 text-slate-800'
                            : txn.method === 'advance'
                            ? 'bg-indigo-100 text-indigo-800'
                            : 'bg-purple-100 text-purple-800'
                        }`}>
                          {txn.method || 'ΓÇö'}
                        </span>
                        {txn.referenceNumber && (
                          <span className="font-mono text-[11px] text-slate-500">
                            #{txn.referenceNumber}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Amount ΓÇö editable in place on a payment entry, because
                        a mistyped figure is corrected here or nowhere: the
                        invoice and the receipt journal both follow it. */}
                    <td className="py-2 px-3 text-right font-bold whitespace-nowrap">
                      {isPayment && txn.rawPayment && !txn.isReversed && onEditPaymentAmount ? (
                        <span className="inline-flex items-center justify-end gap-1 text-ink-success">
                          <span className="text-[11px]">PKR</span>
                          <EditableAmount
                            value={txn.amount}
                            label={`Amount of payment ${txn.txnNumber}`}
                            onCommit={(next) => onEditPaymentAmount(txn.rawPayment!, next)}
                          />
                        </span>
                      ) : (
                        <span className={
                          txn.direction === 'inflow'
                            ? 'text-ink-success'
                            : txn.direction === 'credit'
                            ? 'text-purple-700'
                            : txn.direction === 'debit'
                            ? 'text-amber-700'
                            : 'text-ink-danger'
                        }>
                          PKR <span className="tabular-nums">{(txn.amount || 0).toLocaleString()}</span>
                        </span>
                      )}
                    </td>

                    {/* Proof Slip Attachment */}
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      {txn.hasAttachments ? (
                        <button
                          onClick={() => {
                            if (txn.rawPayment) {
                              onViewProof(txn.rawPayment);
                            } else if (txn.rawAdvance) {
                              onViewProof({
                                id: txn.rawAdvance.id,
                                payment_number: txn.rawAdvance.payment_number,
                                invoice_id: '',
                                lab_id: txn.rawAdvance.lab_id,
                                lab_name: txn.rawAdvance.lab_name,
                                amount: txn.rawAdvance.amount,
                                payment_method: txn.rawAdvance.payment_method,
                                payment_date: txn.rawAdvance.payment_date,
                                reference_number: txn.rawAdvance.reference_number,
                                notes: txn.rawAdvance.notes,
                                attachments: txn.rawAdvance.attachments,
                                recorded_by: txn.rawAdvance.recorded_by
                              });
                            } else if (txn.rawAdjustment) {
                              onViewProof({
                                id: txn.rawAdjustment.id,
                                payment_number: txn.rawAdjustment.adjustment_number,
                                invoice_id: '',
                                lab_id: txn.rawAdjustment.lab_id,
                                lab_name: txn.rawAdjustment.lab_name,
                                amount: txn.rawAdjustment.amount,
                                payment_method: 'cash',
                                payment_date: txn.rawAdjustment.date,
                                reference_number: txn.rawAdjustment.reference_number,
                                notes: txn.rawAdjustment.reason,
                                attachments: txn.rawAdjustment.attachments,
                                recorded_by: txn.rawAdjustment.recorded_by
                              });
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded text-[11px] transition-colors cursor-pointer"
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                          <span>{txn.attachmentsCount} Slip{txn.attachmentsCount > 1 ? 's' : ''}</span>
                        </button>
                      ) : (
                        <span className="text-slate-300 text-[11px]">ΓÇö</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {isPayment && txn.rawPayment && (
                          <button
                            onClick={() => onPrintReceipt(txn)}
                            className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-2xs flex items-center gap-1 transition-all cursor-pointer"
                            title="Print Official Payment Slip" aria-label="Print official payment slip"
                          >
                            <Printer className="w-3 h-3 text-slate-500" />
                            <span>Receipt</span>
                          </button>
                        )}

                        {/* Inspect Double-Entry Journal */}
                        {onOpenJournalModal && (
                          <button
                            type="button"
                            onClick={() => onOpenJournalModal(txn.txnNumber || txn.referenceNumber || '')}
                            className="p-1.5 text-ink-muted hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                            title="Inspect Double-Entry Journal Records" aria-label="Inspect double-entry journal records"
                          >
                            <Scale className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Delete this payment entry ΓÇö never the invoice. */}
                        {isPayment && txn.rawPayment && !txn.isReversed && onDeletePayment ? (
                          <button
                            type="button"
                            onClick={() => onDeletePayment(txn.rawPayment!)}
                            className="p-1.5 text-ink-muted hover:text-ink-danger hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="Delete Payment Entry" aria-label={`Delete payment ${txn.txnNumber}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </td>


                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
