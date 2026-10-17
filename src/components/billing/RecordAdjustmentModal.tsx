import React, { useState } from 'react';
import { X, PlusCircle } from 'lucide-react';
import { formatPKR } from '../../services/financeDomain';
import { useApp } from '../../context/AppContext';
import { DentalLab } from '../../types';

interface RecordAdjustmentModalProps {
  lab: DentalLab;
  onClose: () => void;
}

type AdjustmentType = 'credit_note' | 'debit_adjustment' | 'refund';

const TYPE_LABELS: Record<AdjustmentType, { label: string; hint: string; tone: string }> = {
  credit_note: {
    label: 'Credit Note',
    hint: 'Reduces what the clinic owes — a discount, a waived charge, or a correction in the clinic\'s favour.',
    tone: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  },
  debit_adjustment: {
    label: 'Debit Adjustment',
    hint: 'Increases what the clinic owes — a surcharge, a re-work fee, or a price correction in your favour.',
    tone: 'bg-rose-50 border-rose-200 text-rose-700',
  },
  refund: {
    label: 'Refund',
    hint: 'Money returned to the clinic — a credit against a payment already made.',
    tone: 'bg-amber-50 border-amber-200 text-amber-700',
  },
};

/**
 * Record a clinic-level adjustment — credit note, debit adjustment or refund.
 *
 * Adjustments are clinic-level money, not invoice-level: they change what the
 * clinic as a whole owes, independent of any single invoice. The command behind
 * this (`recordAccountAdjustment`) already existed and the ledger already
 * renders every type correctly — what was missing was a way to call it.
 */
export const RecordAdjustmentModal: React.FC<RecordAdjustmentModalProps> = ({ lab, onClose }) => {
  const { recordAccountAdjustment } = useApp();

  const [type, setType] = useState<AdjustmentType>('credit_note');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = TYPE_LABELS[type];

  const validate = (): string | null => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return 'Amount must be greater than zero.';
    if (!reason.trim()) return 'A reason is required — the audit trail needs it.';
    if (!date) return 'Date is required.';
    return null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = validate();
    if (v) { setError(v); return; }
    setSubmitting(true);
    try {
      recordAccountAdjustment(
        lab.id,
        type,
        Number(amount),
        reason.trim(),
        referenceNumber.trim() || undefined,
        undefined,
        date
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the adjustment.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-5 border border-slate-200 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-base text-slate-900">Record Adjustment</h3>
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

        <p className="text-xs text-slate-500">
          For <span className="font-semibold text-slate-800">{lab.name}</span>. The entry posts to the ledger immediately.
        </p>

        {/* Type selector */}
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(TYPE_LABELS) as AdjustmentType[]).map((t) => {
            const m = TYPE_LABELS[t];
            const active = t === type;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`p-2 rounded-xl border text-xs font-semibold text-center transition-all cursor-pointer ${
                  active ? m.tone : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">{meta.hint}</p>

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
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
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
                onChange={(e) => setDate(e.target.value)}
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
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Surcharge for re-work, discount agreed, refund issued"
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
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="ADJ-0001"
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-indigo-600"
            />
          </div>

          {amount !== '' && Number(amount) > 0 && (
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs flex items-center justify-between">
              <span className="text-slate-600">
                This will {type === 'credit_note' ? 'decrease' : 'increase'} the clinic's outstanding balance by
              </span>
              <span className={`font-mono font-bold ${type === 'credit_note' ? 'text-emerald-700' : 'text-rose-700'}`}>
                {formatPKR(Number(amount))}
              </span>
            </div>
          )}

          {error && (
            <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>
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
              Record
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};