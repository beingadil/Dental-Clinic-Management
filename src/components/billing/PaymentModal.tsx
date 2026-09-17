import React, { useState, useMemo, useEffect } from 'react';
import { Invoice, PaymentMethod, PaymentAttachment, PaymentRecord } from '../../types';
import { useApp } from '../../context/AppContext';
import { PaymentProofUploader } from './PaymentProofUploader';
import { X, DollarSign, CreditCard, Landmark, FileCheck, Calendar, Hash, User, CheckCircle2, AlertCircle, Wallet, Building2, Receipt, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

interface PaymentModalProps {
  invoice?: Invoice | null;
  initialLabId?: string;
  onClose: () => void;
  onPaymentRecorded?: (payment: PaymentRecord) => void;
  onOpenAdvanceModal?: (labId?: string) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  invoice: initialInvoice,
  initialLabId,
  onClose,
  onPaymentRecorded,
  onOpenAdvanceModal
}) => {
  const { invoices, labs, recordPayment, applyAdvanceCredit, getLabFinancialSummary, user } = useApp();

  // Invoices that have remaining unpaid balance
  const openInvoices = useMemo(() => {
    return invoices.filter((i) => i.payment_status !== 'paid' && (i.final_amount - (i.amount_paid || 0)) > 0);
  }, [invoices]);

  // Selected clinic (if no invoice was directly passed)
  const [selectedLabId, setSelectedLabId] = useState<string>(() => {
    if (initialInvoice) return initialInvoice.lab_id;
    if (initialLabId) return initialLabId;
    if (openInvoices.length > 0) return openInvoices[0].lab_id;
    return labs.length > 0 ? labs[0].id : '';
  });

  // Open invoices for currently selected clinic
  const clinicOpenInvoices = useMemo(() => {
    return openInvoices.filter((i) => i.lab_id === selectedLabId);
  }, [openInvoices, selectedLabId]);

  // Selected invoice
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>(() => {
    if (initialInvoice) return initialInvoice.id;
    if (clinicOpenInvoices.length > 0) return clinicOpenInvoices[0].id;
    return '';
  });

  // Active invoice object
  const activeInvoice = useMemo(() => {
    if (initialInvoice) return initialInvoice;
    return invoices.find((i) => i.id === selectedInvoiceId) || null;
  }, [initialInvoice, invoices, selectedInvoiceId]);

  const remainingBalance = activeInvoice 
    ? Math.max(0, activeInvoice.final_amount - (activeInvoice.amount_paid || 0)) 
    : 0;

  const clinicSummary = selectedLabId ? getLabFinancialSummary(selectedLabId) : null;
  const availableAdvance = clinicSummary?.advance_balance || 0;

  const [amount, setAmount] = useState<number>(remainingBalance);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [attachments, setAttachments] = useState<PaymentAttachment[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // When active invoice changes, update default amount
  useEffect(() => {
    if (activeInvoice) {
      const rem = Math.max(0, activeInvoice.final_amount - (activeInvoice.amount_paid || 0));
      setAmount(rem);
    } else {
      setAmount(0);
    }
  }, [activeInvoice]);

  // When clinic changes, select its first open invoice if any
  const handleClinicChange = (labId: string) => {
    setSelectedLabId(labId);
    const labInvs = openInvoices.filter((i) => i.lab_id === labId);
    if (labInvs.length > 0) {
      setSelectedInvoiceId(labInvs[0].id);
    } else {
      setSelectedInvoiceId('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!activeInvoice) {
      setErrorMsg('Please select an invoice to apply payment to.');
      return;
    }

    if (amount <= 0 || isNaN(amount)) {
      setErrorMsg('Payment amount must be greater than zero.');
      return;
    }

    if (amount > remainingBalance) {
      setErrorMsg(`Payment amount cannot exceed the remaining balance of PKR ${remainingBalance.toLocaleString()}.`);
      return;
    }

    if (method === 'advance') {
      if (amount > availableAdvance) {
        setErrorMsg(`Payment amount cannot exceed available clinic advance of PKR ${availableAdvance.toLocaleString()}.`);
        return;
      }

      const success = applyAdvanceCredit(
        activeInvoice.lab_id,
        activeInvoice.id,
        amount,
        notes.trim() || undefined
      );

      if (success) {
        onClose();
      } else {
        setErrorMsg('Failed to apply advance credit.');
      }
      return;
    }

    const recorded = recordPayment(
      activeInvoice.id,
      amount,
      method,
      notes.trim() || undefined,
      referenceNumber.trim() || undefined,
      attachments
    );

    if (recorded) {
      if (onPaymentRecorded) {
        onPaymentRecorded(recorded);
      }
      onClose();
    } else {
      setErrorMsg('Failed to record payment. Please check inputs.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 md:p-6">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl lg:max-w-4xl w-full overflow-hidden flex flex-col max-h-[95vh] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Record Payment & Cash Entry</h3>
              <p className="text-xs text-slate-500">
                {activeInvoice 
                  ? `Invoice ${activeInvoice.invoice_number} • ${activeInvoice.lab_name} (Dental Clinic)`
                  : 'Settle outstanding clinic receivables'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">

          {/* Auto-Tell Clinic Payment Status Card */}
          {clinicSummary && (
            <div className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs ${
              clinicSummary.outstanding_balance > 0
                ? 'bg-amber-50/80 border-amber-200 text-amber-900'
                : clinicSummary.advance_balance > 0
                ? 'bg-indigo-50/80 border-indigo-200 text-indigo-900'
                : 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
            }`}>
              <div className="flex items-center gap-2.5">
                {clinicSummary.outstanding_balance > 0 ? (
                  <div className="w-7 h-7 rounded-lg bg-amber-200/80 flex items-center justify-center text-amber-800 shrink-0 font-bold text-xs">
                    <ArrowDownLeft className="w-4 h-4" />
                  </div>
                ) : clinicSummary.advance_balance > 0 ? (
                  <div className="w-7 h-7 rounded-lg bg-indigo-200/80 flex items-center justify-center text-indigo-800 shrink-0 font-bold text-xs">
                    <Wallet className="w-4 h-4" />
                  </div>
                ) : (
                  <div className="w-7 h-7 rounded-lg bg-emerald-200/80 flex items-center justify-center text-emerald-800 shrink-0 font-bold text-xs">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                )}
                <div>
                  <div className="font-bold flex items-center gap-1.5">
                    <span>Payment Status:</span>
                    {clinicSummary.outstanding_balance > 0 ? (
                      <span className="text-amber-800 font-extrabold uppercase tracking-wide">Receivables Due from Clinic</span>
                    ) : clinicSummary.advance_balance > 0 ? (
                      <span className="text-indigo-800 font-extrabold uppercase tracking-wide">Credit Surplus / Advance Available</span>
                    ) : (
                      <span className="text-emerald-800 font-extrabold uppercase tracking-wide">Fully Cleared / Zero Balance</span>
                    )}
                  </div>
                  <p className="text-[11px] opacity-80 mt-0.5">
                    {clinicSummary.outstanding_balance > 0
                      ? `Clinic owes total PKR ${clinicSummary.outstanding_balance.toLocaleString()} across ${clinicSummary.unpaid_invoices_count + clinicSummary.partial_invoices_count} pending invoice(s).`
                      : clinicSummary.advance_balance > 0
                      ? `Clinic holds PKR ${clinicSummary.advance_balance.toLocaleString()} unallocated advance credit balance.`
                      : 'All historical invoices for this dental clinic are settled.'}
                  </p>
                </div>
              </div>

              {availableAdvance > 0 && method !== 'advance' && (
                <button
                  type="button"
                  onClick={() => setMethod('advance')}
                  className="px-2.5 py-1 bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-700 font-bold text-[10px] rounded-lg shadow-2xs transition-colors shrink-0 cursor-pointer"
                >
                  Use Advance Credit (PKR {availableAdvance.toLocaleString()})
                </button>
              )}
            </div>
          )}
          
          {/* Clinic & Invoice Selectors (when not opened for a pre-locked invoice) */}
          {!initialInvoice && (
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Select Dental Clinic</span>
                </label>
                <select
                  value={selectedLabId}
                  onChange={(e) => handleClinicChange(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:border-indigo-500"
                >
                  {labs.map((lab) => {
                    const labOpenCount = openInvoices.filter(i => i.lab_id === lab.id).length;
                    return (
                      <option key={lab.id} value={lab.id}>
                        {lab.name} ({labOpenCount} open {labOpenCount === 1 ? 'invoice' : 'invoices'})
                      </option>
                    );
                  })}
                </select>
              </div>

              {clinicOpenInvoices.length === 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>This clinic has no unpaid invoices pending settlement.</span>
                  </div>
                  {onOpenAdvanceModal && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenAdvanceModal(selectedLabId);
                      }}
                      className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] rounded-md shrink-0 transition-colors"
                    >
                      + Deposit Advance
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                    <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Select Open Invoice to Pay</span>
                  </label>
                  <select
                    value={selectedInvoiceId}
                    onChange={(e) => setSelectedInvoiceId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:border-indigo-500"
                  >
                    {clinicOpenInvoices.map((inv) => {
                      const rem = inv.final_amount - (inv.amount_paid || 0);
                      return (
                        <option key={inv.id} value={inv.id}>
                          {inv.invoice_number} (Case #{inv.case_number} • Dr. {inv.doctor_name}) — Due: PKR {rem.toLocaleString()}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Invoice Balance Snapshot Card */}
          {activeInvoice && (
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-xl p-4 shadow-sm">
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="border-r border-slate-700/60 pr-2">
                  <p className="text-[10px] uppercase font-bold text-slate-400">Total Invoiced</p>
                  <p className="text-sm font-bold text-slate-100 mt-0.5">PKR {activeInvoice.final_amount.toLocaleString()}</p>
                </div>
                <div className="border-r border-slate-700/60 pr-2">
                  <p className="text-[10px] uppercase font-bold text-emerald-400">Already Paid</p>
                  <p className="text-sm font-bold text-emerald-300 mt-0.5">PKR {(activeInvoice.amount_paid || 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-amber-400">Remaining Balance</p>
                  <p className="text-base font-black text-amber-300 mt-0.5">PKR {remainingBalance.toLocaleString()}</p>
                </div>
              </div>
            </div>
          )}

          {/* Payment Method Selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Payment Method <span className="text-rose-500">*</span>
              </label>
              {availableAdvance > 0 && (
                <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md flex items-center gap-1">
                  <Wallet className="w-3 h-3" />
                  Clinic Advance: PKR {availableAdvance.toLocaleString()}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'cash', label: 'Cash', icon: DollarSign, desc: 'Clinic counter / rider' },
                { id: 'bank', label: 'Bank', icon: Landmark, desc: 'IBFT / Meezan' },
                { id: 'cheque', label: 'Cheque', icon: FileCheck, desc: 'Bank cheque' },
                { 
                  id: 'advance', 
                  label: 'Advance Credit', 
                  icon: Wallet, 
                  desc: availableAdvance > 0 ? `Avail: PKR ${availableAdvance.toLocaleString()}` : 'No credit available',
                  disabled: availableAdvance <= 0
                },
              ].map((item) => {
                const Icon = item.icon;
                const isSelected = method === item.id;
                const isDisabled = item.disabled;
                return (
                  <button
                    type="button"
                    key={item.id}
                    disabled={isDisabled}
                    onClick={() => {
                      setMethod(item.id as PaymentMethod);
                      if (item.id === 'advance') {
                        setAmount(Math.min(remainingBalance, availableAdvance));
                      }
                    }}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      isDisabled 
                        ? 'opacity-40 cursor-not-allowed bg-slate-50 border-slate-200'
                        : isSelected
                          ? 'bg-emerald-50/70 border-emerald-600 text-emerald-950 shadow-xs ring-1 ring-emerald-500/20'
                          : 'bg-slate-50/60 border-slate-200 text-slate-700 hover:bg-slate-100/80 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon className={`w-3.5 h-3.5 ${isSelected ? 'text-emerald-600' : 'text-slate-500'}`} />
                      <span className="text-xs font-bold">{item.label}</span>
                    </div>
                    <p className="text-[9px] text-slate-400 mt-1 leading-tight truncate">{item.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Amount & Quick Fill */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Payment Amount (PKR) <span className="text-rose-500">*</span>
              </label>
              {remainingBalance > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(remainingBalance)}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
                >
                  Pay Full Balance (PKR {remainingBalance.toLocaleString()})
                </button>
              )}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">PKR</span>
              <input
                type="number"
                min="1"
                max={method === 'advance' ? Math.min(remainingBalance, availableAdvance) : remainingBalance}
                value={amount || ''}
                onChange={(e) => setAmount(Number(e.target.value))}
                placeholder="Enter amount in PKR"
                className="w-full pl-12 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
                required
              />
            </div>
          </div>

          {/* Reference # and Date Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Hash className="w-3.5 h-3.5 text-slate-400" />
                <span>Reference / Slip / Cheque #</span>
              </label>
              <input
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder={method === 'cash' ? 'e.g. Cash Receipt #204' : method === 'cheque' ? 'e.g. Cheque #884102' : 'e.g. Meezan Txn #994012'}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Payment Date</span>
              </label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
                required
              />
            </div>
          </div>

          {/* Remarks / Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Remarks & Cashier Notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Cash received by rider Hamza at clinic front desk"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
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
                disabled={!activeInvoice}
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer"
              >
                {method === 'advance' ? (
                  <>
                    <Wallet className="w-4 h-4 text-emerald-100" />
                    <span>Apply Advance Credit (PKR {amount > 0 ? amount.toLocaleString() : '0'})</span>
                  </>
                ) : (
                  <>
                    <ArrowDownLeft className="w-4 h-4 text-emerald-100" />
                    <span>Receive Payment of PKR {amount > 0 ? amount.toLocaleString() : '0'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );
};
