import React, { useState } from 'react';
import { X, Pencil } from 'lucide-react';
import { AccountAdjustment } from '../../types';

interface EditAdjustmentModalProps {
  adjustment: AccountAdjustment;
  onSave: (
    id: string,
    patch: { amount: number; reason: string; date: string; reference_number?: string }
  ) => boolean;
  onClose: () => void;
}

const TYPE_LABELS: Record<AccountAdjustment['type'], { label: string; tone: string }> = {
  credit_note: { label: 'Credit Note', tone: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  debit_adjustment: { label: 'Debit Adjustment', tone: 'bg-rose-50 border-rose-200 text-rose-700' },
  refund: { label: 'Refund', tone: 'bg-amber-50 border-amber-200 text-amber-700' },
  write_off: { label: 'Write-Off', tone: 'bg-slate-100 border-slate-200 text-slate-700' },
};

/**
 * Correct an adjustment that was entered wrong — the amount, business date,
 * reason or reference. The document type stays fixed: the number prefix and
 * the posted journal both derive from it, so changing it would silently
 * renumber a money document.
 *
 * A credit note's amount is not just a label: saving reverses the old credit
 * from the clinic's invoices and re-applies the corrected amount, oldest open
 * invoice first, before the register and ledger are refreshed.
 */
export const EditAdjustmentModal: React.FC<EditAdjustmentModalProps> = ({
  adjustment,
  onSave,
  onClose,
}) => {
  const [amount, setAmount] = useState(() => String(adjustment.amount ?? ''));
  const [reason, setReason] = useState(adjustment.reason || '');
  const [date, setDate] = useState(
    () => (adjustment.date || adjustment.created_at || '').slice(0, 10)
  );
  const [referenceNumber, setReferenceNumber] = useState(adjustment.reference_number || '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const meta = TYPE_LABELS[adjustment.type] || {
    label: adjustment.type,
    tone: 'bg-slate-100 border-slate-200 text-slate-700',
  };
  const isCredit = adjustment.type === 'credit_note' || adjustment.type === 'write_off';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Amount must be greater than zero.');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required — the audit trail needs it.');
      return;
    }
    if (!date) {
      setError('Date is required.');
      return;
    }

    setSubmitting(true);
    const ok = onSave(adjustment.id, {
      amount: amt,
      reason: reason.trim(),
      date,
      reference_number: referenceNumber.trim() || undefined,
    });
    if (!ok) {
      setSubmitting(false);
      setError('Could not save the correction. The entry may have changed — reopen and retry.');
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-5 border border-slate-200 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-base text-slate-900">Edit Adjustment</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono font-bold text-slate-900">{adjustment.adjustment_number}</span>
          <span className={`px-1.5 py-0.5 rounded border text-[11px] font-bold uppercase ${meta.tone}`}>
            {meta.label}
          </span>
          <span className="text-slate-500">For {adjustment.lab_name}</span>
        </div>

        {isCredit && (
          <p className="text-[11px] leading-relaxed text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Changing the amount reverses the old credit and re-applies the corrected one across this
            clinic&apos;s open invoices, oldest first.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Amount (PKR) <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setError(null);
                }}
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-indigo-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Date <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setError(null);
                }}
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-indigo-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Reason <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-indigo-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Reference Number <span className="text-ink-muted">(optional)</span>
            </label>
            <input
              type="text"
              value={referenceNumber}
              onChange={(e) => {
                setReferenceNumber(e.target.value);
                setError(null);
              }}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-indigo-600"
            />
          </div>

          {error && (
            <p role="alert" className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer transition-colors"
            >
              Save Correction
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
