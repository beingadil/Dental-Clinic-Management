import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { PaymentAttachment, AccountAdjustment } from '../../types';
import { PaymentProofUploader } from './PaymentProofUploader';
import { 
  X, 
  DollarSign, 
  Calendar, 
  Hash, 
  User, 
  CheckCircle2, 
  AlertCircle,
  Building2,
  FileCheck2,
  Receipt,
  RotateCcw,
  PlusCircle,
  Percent
} from 'lucide-react';

interface AccountAdjustmentModalProps {
  initialLabId?: string;
  initialType?: 'credit_note' | 'debit_adjustment' | 'refund';
  onClose: () => void;
  onAdjustmentRecorded?: (adjustment: AccountAdjustment) => void;
}

export const AccountAdjustmentModal: React.FC<AccountAdjustmentModalProps> = ({
  initialLabId,
  initialType,
  onClose,
  onAdjustmentRecorded
}) => {
  const { labs, recordAccountAdjustment, getLabFinancialSummary, user } = useApp();

  const [selectedLabId, setSelectedLabId] = useState<string>(
    initialLabId || (labs.length > 0 ? labs[0].id : '')
  );
  const [type, setType] = useState<'credit_note' | 'debit_adjustment' | 'refund'>(initialType || 'credit_note');
  const [amount, setAmount] = useState<number | ''>('');
  const [reason, setReason] = useState<string>('');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [attachments, setAttachments] = useState<PaymentAttachment[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const currentSummary = selectedLabId ? getLabFinancialSummary(selectedLabId) : null;
  const selectedLab = labs.find((l) => l.id === selectedLabId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!selectedLabId) {
      setErrorMsg('Please select a dental clinic.');
      return;
    }

    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0 || isNaN(numAmount)) {
      setErrorMsg('Adjustment amount must be greater than zero.');
      return;
    }

    if (!reason.trim()) {
      setErrorMsg('Please specify the reason/justification for this adjustment.');
      return;
    }

    const adj = recordAccountAdjustment(
      selectedLabId,
      type,
      numAmount,
      reason.trim(),
      referenceNumber.trim() || undefined,
      attachments
    );

    if (adj) {
      if (onAdjustmentRecorded) {
        onAdjustmentRecorded(adj);
      }
      onClose();
    } else {
      setErrorMsg('Failed to record account adjustment.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 md:p-6">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl lg:max-w-4xl w-full overflow-hidden flex flex-col max-h-[95vh] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-purple-50/80 to-indigo-50/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-600 flex items-center justify-center text-white shadow-sm">
              <FileCheck2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Clinic Account Adjustment</h3>
              <p className="text-xs text-slate-500">
                Issue credit notes, concession rebates, or apply debit surcharges
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-white/80 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">
          
          {/* Clinic Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-purple-600" />
              <span>Dental Clinic <span className="text-rose-500">*</span></span>
            </label>
            <select
              value={selectedLabId}
              onChange={(e) => setSelectedLabId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-purple-500 focus:bg-white transition-all"
              required
            >
              <option value="" disabled>Select a clinic...</option>
              {labs.map((lab) => (
                <option key={lab.id} value={lab.id}>
                  {lab.name} ({lab.city})
                </option>
              ))}
            </select>
          </div>

          {/* Adjustment Type Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Adjustment Type <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { 
                  id: 'credit_note', 
                  label: 'Credit Note', 
                  icon: Percent, 
                  desc: 'Rebate / concession / waiver',
                  badge: 'Reduces Debt'
                },
                { 
                  id: 'debit_adjustment', 
                  label: 'Debit Surcharge', 
                  icon: PlusCircle, 
                  desc: 'Extra fee / rush surcharge',
                  badge: 'Adds Charge'
                },
                { 
                  id: 'refund', 
                  label: 'Refund Cash/Bank', 
                  icon: RotateCcw, 
                  desc: 'Cash returned to clinic',
                  badge: 'Clinic Refund'
                },
              ].map((item) => {
                const Icon = item.icon;
                const isSelected = type === item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => setType(item.id as any)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-purple-50/70 border-purple-600 text-purple-950 shadow-xs ring-1 ring-purple-500/20'
                        : 'bg-slate-50/60 border-slate-200 text-slate-700 hover:bg-slate-100/80'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <Icon className={`w-4 h-4 ${isSelected ? 'text-purple-600' : 'text-slate-500'}`} />
                        <span className="text-xs font-bold">{item.label}</span>
                      </div>
                    </div>
                    <span className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200/70 text-slate-700">
                      {item.badge}
                    </span>
                    <p className="text-[10px] text-slate-400 mt-1 leading-tight">{item.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Adjustment Amount (PKR) <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">PKR</span>
              <input
                type="number"
                min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="e.g. 5000"
                className="w-full pl-13 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-purple-500 focus:bg-white transition-all"
                required
              />
            </div>
          </div>

          {/* Reason / Justification */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Reason & Authorization Justification <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Special anniversary clinic volume discount authorized by Lab Director"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-purple-500 focus:bg-white transition-all"
              required
            />
          </div>

          {/* Reference # and Date Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Hash className="w-3.5 h-3.5 text-slate-400" />
                <span>Reference / Authorization #</span>
              </label>
              <input
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="e.g. AUTH-2026-09"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-purple-500 focus:bg-white transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Effective Date</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-purple-500 focus:bg-white transition-all"
                required
              />
            </div>
          </div>

          {/* Proof Attachments Uploader */}
          <div className="pt-1">
            <PaymentProofUploader
              attachments={attachments}
              onChange={setAttachments}
              maxFiles={5}
            />
          </div>

          {errorMsg && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Modal Footer Controls */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
            <div className="text-[11px] text-slate-400 flex items-center gap-1">
              <User className="w-3.5 h-3.5" />
              <span>Authorized By: {user ? user.name : 'Staff'}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Record Adjustment</span>
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );
};
