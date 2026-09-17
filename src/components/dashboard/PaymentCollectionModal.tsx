import React, { useState } from 'react';
import { X, DollarSign, CheckCircle2, Building2, CreditCard, Receipt, Calendar, FileText } from 'lucide-react';
import { DentalLab, Invoice } from '../../types';

interface PaymentCollectionModalProps {
  clinic?: DentalLab | { id: string; name: string; doctor_name?: string; balance?: number };
  invoices: Invoice[];
  onClose: () => void;
  onSubmitPayment: (clinicName: string, amount: number, method: string, ref: string, note: string) => void;
}

export const PaymentCollectionModal: React.FC<PaymentCollectionModalProps> = ({
  clinic,
  invoices,
  onClose,
  onSubmitPayment,
}) => {
  const clinicName = clinic?.name || 'General Clinic Account';
  
  // Calculate clinic outstanding balance from invoices or prop
  const clinicInvoices = invoices.filter(i => (i.lab_name || '').toLowerCase() === clinicName.toLowerCase());
  const calculatedBalance = clinicInvoices.reduce((sum, i) => sum + (i.final_amount - i.amount_paid), 0);
  const defaultAmount = calculatedBalance > 0 ? calculatedBalance : (('balance' in (clinic || {})) ? Number((clinic as any).balance || 0) : 0);

  const [amount, setAmount] = useState<number>(defaultAmount || 0);
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'cash' | 'cheque' | 'online'>('bank_transfer');
  const [referenceNumber, setReferenceNumber] = useState(`MZN-${Math.floor(100000 + Math.random() * 900000)}`);
  const [notes, setNotes] = useState(`Payment received for laboratory prosthetic orders.`);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) return;
    
    onSubmitPayment(clinicName, amount, paymentMethod, referenceNumber, notes);
    setIsSuccess(true);
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Record Clinic Payment Receipt</h3>
              <p className="text-xs text-slate-500">Collect payment and settle outstanding lab invoice ledger</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isSuccess ? (
          <div className="py-8 flex flex-col items-center justify-center text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center animate-bounce">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h4 className="text-lg font-extrabold text-slate-900">Payment Recorded Successfully!</h4>
            <p className="text-xs text-slate-500 max-w-xs">
              PKR {amount.toLocaleString()} credited to {clinicName}. Clinic balance updated.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            
            {/* Clinic Info Box */}
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Clinic Account</span>
                <span className="text-sm font-extrabold text-slate-900">{clinicName}</span>
                <span className="text-[11px] text-slate-500 block">{clinic?.doctor_name || 'Clinic Account'}</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Current Balance</span>
                <span className={`text-sm font-extrabold ${defaultAmount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  PKR {defaultAmount.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Amount Field */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">Payment Amount (PKR) *</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">PKR</span>
                <input
                  type="number"
                  required
                  min="1"
                  max="10000000"
                  value={amount || ''}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  placeholder="Enter amount..."
                  className="w-full pl-12 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* Method & Ref */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Payment Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cash">Cash in Hand</option>
                  <option value="cheque">Bank Cheque</option>
                  <option value="online">Online / Easypaisa / JazzCash</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Transaction / Ref #</label>
                <input
                  type="text"
                  required
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">Remarks / Note</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Cleared 3 zirconia cases..."
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {/* Submit */}
            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-md transition cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirm & Post Receipt</span>
              </button>
            </div>

          </form>
        )}

      </div>
    </div>
  );
};
