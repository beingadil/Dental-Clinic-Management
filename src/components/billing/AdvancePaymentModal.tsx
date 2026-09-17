import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { PaymentMethod, PaymentAttachment, AdvancePayment } from '../../types';
import { PaymentProofUploader } from './PaymentProofUploader';
import { 
  X, 
  DollarSign, 
  CreditCard, 
  Landmark, 
  FileCheck, 
  Calendar, 
  Hash, 
  User, 
  CheckCircle2, 
  AlertCircle,
  Building2,
  Wallet,
  Sparkles
} from 'lucide-react';

interface AdvancePaymentModalProps {
  initialLabId?: string;
  onClose: () => void;
  onAdvanceRecorded?: (advance: AdvancePayment) => void;
}

export const AdvancePaymentModal: React.FC<AdvancePaymentModalProps> = ({
  initialLabId,
  onClose,
  onAdvanceRecorded
}) => {
  const { labs, recordAdvancePayment, getLabFinancialSummary, user } = useApp();

  const [selectedLabId, setSelectedLabId] = useState<string>(
    initialLabId || (labs.length > 0 ? labs[0].id : '')
  );
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<'cash' | 'bank' | 'cheque'>('bank');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);
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
      setErrorMsg('Advance deposit amount must be greater than zero.');
      return;
    }

    const advance = recordAdvancePayment(
      selectedLabId,
      numAmount,
      method,
      notes.trim() || undefined,
      referenceNumber.trim() || undefined,
      attachments
    );

    if (advance) {
      if (onAdvanceRecorded) {
        onAdvanceRecorded(advance);
      }
      onClose();
    } else {
      setErrorMsg('Failed to record advance payment. Please verify inputs.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 md:p-6">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl lg:max-w-4xl w-full overflow-hidden flex flex-col max-h-[95vh] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-blue-50/80 to-indigo-50/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Record Clinic Advance Deposit</h3>
              <p className="text-xs text-slate-500">
                Deposit advance funds into clinic account for future invoice settlements
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
              <Building2 className="w-3.5 h-3.5 text-indigo-600" />
              <span>Dental Clinic <span className="text-rose-500">*</span></span>
            </label>
            <select
              value={selectedLabId}
              onChange={(e) => setSelectedLabId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
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

          {/* Current Clinic Financial Snapshot */}
          {currentSummary && selectedLab && (
            <div className="bg-slate-900 text-white rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
                <span className="text-xs font-bold text-slate-300">{selectedLab.name} Account Status</span>
                <span className="text-[11px] text-indigo-400 font-medium">{currentSummary.invoices_count} Total Invoices</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="border-r border-slate-800 pr-2">
                  <p className="text-[10px] uppercase font-bold text-slate-400">Total Invoiced</p>
                  <p className="text-xs font-bold text-slate-100 mt-0.5">PKR {currentSummary.total_invoiced.toLocaleString()}</p>
                </div>
                <div className="border-r border-slate-800 pr-2">
                  <p className="text-[10px] uppercase font-bold text-emerald-400">Advance Credit Balance</p>
                  <p className="text-sm font-black text-emerald-300 mt-0.5">PKR {(currentSummary.advance_balance || 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-amber-400">Net Receivable Due</p>
                  <p className="text-xs font-bold text-amber-300 mt-0.5">PKR {currentSummary.outstanding_balance.toLocaleString()}</p>
                </div>
              </div>
            </div>
          )}

          {/* Payment Method Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Deposit Method <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { id: 'bank', label: 'Bank Transfer', icon: Landmark, desc: 'Online / Meezan / HBL' },
                { id: 'cash', label: 'Cash Deposit', icon: DollarSign, desc: 'Cash at counter / rider' },
                { id: 'cheque', label: 'Cheque', icon: FileCheck, desc: 'Cheque deposit' },
              ].map((item) => {
                const Icon = item.icon;
                const isSelected = method === item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => setMethod(item.id as any)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-50/70 border-indigo-600 text-indigo-950 shadow-xs ring-1 ring-indigo-500/20'
                        : 'bg-slate-50/60 border-slate-200 text-slate-700 hover:bg-slate-100/80'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={`w-4 h-4 ${isSelected ? 'text-indigo-600' : 'text-slate-500'}`} />
                      <span className="text-xs font-bold">{item.label}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 leading-tight">{item.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Advance Deposit Amount */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Advance Deposit Amount (PKR) <span className="text-rose-500">*</span>
              </label>
              {currentSummary && currentSummary.outstanding_balance > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(currentSummary.outstanding_balance)}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
                >
                  Match Due (PKR {currentSummary.outstanding_balance.toLocaleString()})
                </button>
              )}
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">PKR</span>
              <input
                type="number"
                min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="e.g. 50000"
                className="w-full pl-13 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
                required
              />
            </div>
          </div>

          {/* Reference # and Date Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Hash className="w-3.5 h-3.5 text-slate-400" />
                <span>Reference / Slip / Bank Txn #</span>
              </label>
              <input
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder={method === 'cash' ? 'e.g. Receipt #409' : method === 'cheque' ? 'e.g. Cheque #772910' : 'e.g. IBFT-889210'}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Deposit Date</span>
              </label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
                required
              />
            </div>
          </div>

          {/* Remarks / Purpose */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Advance Purpose & Cashier Remarks
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Monthly bulk advance payment for upcoming implant & crown cases"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
            />
          </div>

          {/* Payment Proof Attachments Uploader */}
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
              <span>Cashier: {user ? user.name : 'Staff'}</span>
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
                className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Record Advance Deposit</span>
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );
};
