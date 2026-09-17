import React, { useState } from 'react';
import { X, Receipt, CheckCircle2, AlertCircle, PlusCircle } from 'lucide-react';
import { DentalCase, Invoice } from '../../types';

interface BatchBillingModalProps {
  cases: DentalCase[];
  invoices: Invoice[];
  onClose: () => void;
  onGenerateInvoices: (selectedCaseIds: string[]) => void;
}

export const BatchBillingModal: React.FC<BatchBillingModalProps> = ({
  cases,
  invoices,
  onClose,
  onGenerateInvoices,
}) => {
  // Find cases that don't have invoices yet or are completed
  const existingInvoicedCaseIds = new Set(invoices.map(i => i.case_id));
  const unbilledCases = cases.filter(c => !existingInvoicedCaseIds.has(c.id));

  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>(
    unbilledCases.map(c => c.id)
  );
  const [isGenerated, setIsGenerated] = useState(false);

  const toggleSelectAll = () => {
    if (selectedCaseIds.length === unbilledCases.length) {
      setSelectedCaseIds([]);
    } else {
      setSelectedCaseIds(unbilledCases.map(c => c.id));
    }
  };

  const toggleCase = (id: string) => {
    setSelectedCaseIds(prev => 
      prev.includes(id) ? prev.filter(cId => cId !== id) : [...prev, id]
    );
  };

  const totalBillingAmount = unbilledCases
    .filter(c => selectedCaseIds.includes(c.id))
    .reduce((sum, c) => sum + (c.final_price || 0), 0);

  const handleGenerate = () => {
    if (selectedCaseIds.length === 0) return;
    onGenerateInvoices(selectedCaseIds);
    setIsGenerated(true);
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Generate Batch Billing & Invoices</h3>
              <p className="text-xs text-slate-500">Automatically create invoices for completed and active dental cases</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isGenerated ? (
          <div className="py-8 flex flex-col items-center justify-center text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center animate-bounce">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h4 className="text-lg font-extrabold text-slate-900">Batch Invoices Created!</h4>
            <p className="text-xs text-slate-500 max-w-xs">
              Generated {selectedCaseIds.length} new invoices totaling PKR {totalBillingAmount.toLocaleString()}.
            </p>
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            
            <div className="flex items-center justify-between bg-blue-50/70 p-3 rounded-2xl border border-blue-100">
              <div>
                <span className="font-bold text-blue-900 block">Available for Invoicing</span>
                <span className="text-blue-700">{unbilledCases.length} dental cases detected</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold text-blue-600 uppercase block">Selected Total</span>
                <span className="text-sm font-extrabold text-blue-950">PKR {totalBillingAmount.toLocaleString()}</span>
              </div>
            </div>

            {/* Selection Header */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={toggleSelectAll}
                className="text-xs font-bold text-blue-600 hover:text-blue-700 cursor-pointer"
              >
                {selectedCaseIds.length === unbilledCases.length ? 'Deselect All' : 'Select All Cases'}
              </button>
              <span className="text-[11px] text-slate-400">
                {selectedCaseIds.length} of {unbilledCases.length} selected
              </span>
            </div>

            {/* Unbilled Cases List */}
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {unbilledCases.length > 0 ? (
                unbilledCases.map(c => {
                  const isChecked = selectedCaseIds.includes(c.id);
                  const price = c.final_price || 15000;
                  return (
                    <div
                      key={c.id}
                      onClick={() => toggleCase(c.id)}
                      className={`p-3 rounded-xl border transition flex items-center justify-between cursor-pointer ${
                        isChecked 
                          ? 'bg-blue-50/40 border-blue-300' 
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-blue-700">#{c.case_number}</span>
                            <span className="font-semibold text-slate-900">{c.lab_name}</span>
                          </div>
                          <span className="text-[11px] text-slate-500">
                            {c.case_type_name} ({c.patient_name}) • Due {c.delivery_date}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="font-extrabold text-slate-900 block">PKR {price.toLocaleString()}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 capitalize">
                          {c.status.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-6 text-center text-slate-400 border border-dashed rounded-xl">
                  All active cases currently have active invoices.
                </div>
              )}
            </div>

            {/* Footer buttons */}
            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={selectedCaseIds.length === 0}
                onClick={handleGenerate}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Create {selectedCaseIds.length} Invoices</span>
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  );
};
