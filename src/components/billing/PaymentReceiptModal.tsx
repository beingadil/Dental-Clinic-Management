import React, { useRef } from 'react';
import { PaymentRecord, Invoice } from '../../types';
import { useApp } from '../../context/AppContext';
import { X, Printer, CheckCircle2, Building2, Calendar, CreditCard, ShieldCheck } from 'lucide-react';

interface PaymentReceiptModalProps {
  payment: PaymentRecord;
  invoice?: Invoice;
  onClose: () => void;
}

export const PaymentReceiptModal: React.FC<PaymentReceiptModalProps> = ({
  payment,
  invoice,
  onClose
}) => {
  const { brandingSettings } = useApp();
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 md:p-6">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl lg:max-w-3xl w-full overflow-hidden flex flex-col max-h-[95vh] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Controls (Hidden in Print) */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 print:hidden">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">Official Payment Receipt</h3>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Slip</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Area */}
        <div ref={printRef} className="p-8 overflow-y-auto print:p-0 bg-white text-slate-800">
          
          {/* Header */}
          <div className="flex items-start justify-between border-b-2 border-slate-900 pb-5">
            <div>
              <h1 className="text-xl font-black text-slate-900 tracking-tight">
                {brandingSettings.appName || 'DENTAL SOLUTIONS'}
              </h1>
              <p className="text-xs text-slate-500 font-medium">{brandingSettings.tagline}</p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-xs">{brandingSettings.address}</p>
              <p className="text-[11px] text-slate-600 font-semibold">Ph: {brandingSettings.phone}</p>
            </div>
            <div className="text-right">
              <span className="inline-block px-2.5 py-1 bg-emerald-100 text-emerald-800 text-[11px] font-bold uppercase rounded-md tracking-wider">
                Payment Receipt
              </span>
              <p className="text-base font-black text-slate-900 mt-1">
                {payment.payment_number || 'RECEIPT'}
              </p>
              <p className="text-xs text-slate-500">Date: {payment.payment_date}</p>
            </div>
          </div>

          {/* Transaction Metadata Grid */}
          <div className="grid grid-cols-2 gap-4 py-5 border-b border-slate-200 text-xs">
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Received From / Dental Clinic</p>
              <p className="font-bold text-slate-900 text-sm mt-0.5">{payment.lab_name || invoice?.lab_name}</p>
              {payment.case_number && (
                <p className="text-slate-500 mt-0.5">Case Reference: <span className="font-semibold text-slate-700">{payment.case_number}</span></p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Applied To Invoice</p>
              <p className="font-bold text-slate-900 text-sm mt-0.5">{payment.invoice_number || invoice?.invoice_number}</p>
              <p className="text-slate-500 mt-0.5">
                Payment Method: <span className="font-bold text-indigo-700 uppercase">{payment.payment_method}</span>
              </p>
              {payment.reference_number && (
                <p className="text-slate-500">Ref #: <span className="font-mono text-slate-700">{payment.reference_number}</span></p>
              )}
            </div>
          </div>

          {/* Amount Box */}
          <div className="my-6 bg-slate-50 border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Amount Received</p>
                <p className="text-xs text-slate-400 mt-0.5">Pakistani Rupees (PKR)</p>
              </div>
              <p className="text-2xl font-black text-emerald-600 tracking-tight">
                PKR {payment.amount.toLocaleString()}
              </p>
            </div>

            {payment.notes && (
              <div className="mt-3 pt-3 border-t border-slate-200/80 text-xs text-slate-600">
                <span className="font-bold text-slate-700">Remarks:</span> {payment.notes}
              </div>
            )}
          </div>

          {/* Invoice Summary Context if Available */}
          {invoice && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6 text-xs">
              <p className="font-bold text-slate-800 mb-2">Invoice Settlement Status</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-slate-50 p-2 rounded-lg">
                  <p className="text-[10px] text-slate-400 font-bold uppercase">Total Invoiced</p>
                  <p className="font-bold text-slate-800 text-xs mt-0.5">PKR {invoice.final_amount.toLocaleString()}</p>
                </div>
                <div className="bg-emerald-50 p-2 rounded-lg">
                  <p className="text-[10px] text-emerald-600 font-bold uppercase">Total Paid</p>
                  <p className="font-bold text-emerald-700 text-xs mt-0.5">PKR {invoice.amount_paid.toLocaleString()}</p>
                </div>
                <div className="bg-rose-50 p-2 rounded-lg">
                  <p className="text-[10px] text-rose-600 font-bold uppercase">Remaining</p>
                  <p className="font-bold text-rose-700 text-xs mt-0.5">
                    PKR {Math.max(0, invoice.final_amount - invoice.amount_paid).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Signatures & Verification */}
          <div className="pt-8 grid grid-cols-2 gap-8 text-xs text-slate-500">
            <div className="border-t border-slate-300 pt-2">
              <p className="font-bold text-slate-800">Recorded By</p>
              <p className="text-[11px]">{payment.recorded_by || 'Staff Cashier'}</p>
            </div>
            <div className="border-t border-slate-300 pt-2 text-right">
              <p className="font-bold text-slate-800">Authorized Signature & Stamp</p>
              <p className="text-[11px] text-slate-400">Dental Solutions Laboratory</p>
            </div>
          </div>

          <div className="mt-8 text-center text-[10px] text-slate-400 border-t border-slate-100 pt-3">
            This is a computer-generated official receipt • Thank you for your business!
          </div>
        </div>

      </div>
    </div>
  );
};
