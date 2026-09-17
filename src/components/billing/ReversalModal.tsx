import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { formatPKR } from '../../services/financeDomain';
import { AlertTriangle, X, ShieldAlert, ArrowLeftRight } from 'lucide-react';

export interface ReversalTarget {
  referenceType: 'payment' | 'advance_payment' | 'adjustment';
  referenceId: string;
  referenceNumber: string;
  amount: number;
  labName: string;
  date: string;
  details?: string;
}

export interface ReversalModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: ReversalTarget | null;
  onSuccess?: () => void;
}

export const ReversalModal: React.FC<ReversalModalProps> = ({
  isOpen,
  onClose,
  target,
  onSuccess
}) => {
  const { reverseTransactionV2 } = useApp();
  const [reason, setReason] = useState<string>('');
  const [reasonCode, setReasonCode] = useState<string>('cheque_bounce');
  const [error, setError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen || !target) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('A detailed reason is mandatory for financial audit compliance.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    const fullReason = `[${reasonCode.toUpperCase().replace('_', ' ')}] ${reason.trim()}`;
    const success = reverseTransactionV2({
      referenceType: target.referenceType,
      referenceId: target.referenceId,
      reason: fullReason
    });

    setIsSubmitting(false);
    if (success) {
      setReason('');
      onClose();
      if (onSuccess) onSuccess();
    } else {
      setError('Unable to reverse transaction. It may have already been reversed or no longer active.');
    }
  };

  const getTypeName = () => {
    switch (target.referenceType) {
      case 'payment':
        return 'Payment Receipt';
      case 'advance_payment':
        return 'Advance Deposit';
      case 'adjustment':
        return 'Credit Note / Adjustment';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-2xl border border-red-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-red-100 flex items-center justify-between bg-red-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-red-100 border border-red-200 flex items-center justify-center text-red-600">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Reverse Financial Transaction
              </h3>
              <p className="text-xs text-red-700">
                Immutable Accounting Correction & Compensating Journal Entry
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Target Summary Card */}
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Transaction Type:</span>
              <span className="font-semibold text-slate-800">{getTypeName()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Reference:</span>
              <span className="font-mono font-bold text-slate-900">{target.referenceNumber}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Clinic Account:</span>
              <span className="font-medium text-slate-800">{target.labName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Amount:</span>
              <span className="font-bold text-red-600 font-mono text-sm">{formatPKR(target.amount)}</span>
            </div>
            {target.details && (
              <div className="pt-2 border-t border-slate-200 text-slate-600">
                {target.details}
              </div>
            )}
          </div>

          {/* Audit Notice */}
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Audit Trail Notice</p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                Reversing this transaction will restore the clinic's outstanding accounts receivable balance and post a balanced double-entry reversal journal. Prior records will not be deleted.
              </p>
            </div>
          </div>

          {/* Reason Code */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Standard Reversal Reason Code *
            </label>
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 text-slate-800"
            >
              <option value="cheque_bounce">Dishonored / Bounced Cheque</option>
              <option value="bank_return">Bank Transfer Return / Disputed Slip</option>
              <option value="data_entry_error">Data Entry Error / Wrong Clinic Selected</option>
              <option value="duplicate_entry">Duplicate Transaction Entry</option>
              <option value="invoice_dispute">Clinical Dispute / Recalled Invoice</option>
              <option value="other">Other Administrative Correction</option>
            </select>
          </div>

          {/* Explanation textarea */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Detailed Justification / Narration *
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError('');
              }}
              placeholder="Provide exact details for the financial auditor (e.g., Cheque #4492 returned unpaid by Meezan Bank due to signature mismatch)..."
              className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 text-slate-800"
            />
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
              {error}
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg shadow-xs flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Confirm & Post Reversal
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
