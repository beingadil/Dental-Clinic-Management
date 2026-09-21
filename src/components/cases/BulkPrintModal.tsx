import React, { useState } from 'react';
import { DentalCase, Invoice } from '../../types';
import { useApp } from '../../context/AppContext';
import { Printer, X, Landmark, Download, CheckCircle2 } from 'lucide-react';
import { LabCardSlip } from './LabCardSlip';

interface BulkPrintModalProps {
  selectedCases: DentalCase[];
  onClose: () => void;
  initialPrintType?: 'slips' | 'invoices';
}

export const BulkPrintModal: React.FC<BulkPrintModalProps> = ({
  selectedCases,
  onClose,
  initialPrintType = 'slips',
}) => {
  const { invoices, saveVoucherToSystem, brandingSettings } = useApp();
  const [printType, setPrintType] = useState<'slips' | 'invoices'>(initialPrintType);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handlePrint = (shouldSaveToSystem = true) => {
    if (shouldSaveToSystem) {
      if (printType === 'slips') {
        selectedCases.forEach((c) => {
          saveVoucherToSystem({
            voucher_number: `SLIP-${c.case_number}`,
            voucher_type: 'job_slip',
            case_id: c.id,
            case_number: c.case_number,
            lab_name: c.lab_name,
            doctor_name: c.doctor_name,
            patient_name: c.patient_name || 'Batch Patient',
            case_type_name: c.case_type_name,
            notes: `Batch Workstation Card - FDI Teeth: ${c.selected_teeth.join(', ')}`
          });
        });
      } else {
        matchedInvoices.forEach((m) => {
          if (m.invoice) {
            saveVoucherToSystem({
              voucher_number: m.invoice.invoice_number,
              voucher_type: 'invoice',
              case_id: m.invoice.case_id,
              case_number: m.invoice.case_number,
              lab_name: m.invoice.lab_name,
              doctor_name: m.invoice.doctor_name,
              case_type_name: m.invoice.case_type_name,
              amount: m.invoice.final_amount,
              notes: `Batch Printed Invoice - Net PKR ${(m.invoice.final_amount || 0).toLocaleString()}`
            });
          }
        });
      }
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 4000);
    }

    setTimeout(() => {
      window.print();
    }, 100);
  };

  // Map selected cases to corresponding invoices if available
  const matchedInvoices: { caseData: DentalCase; invoice: Invoice | undefined }[] = selectedCases.map((c) => {
    const inv = invoices.find((i) => i.case_id === c.id || i.case_number === c.case_number);
    return { caseData: c, invoice: inv };
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto no-print-backdrop">
      <div className="bg-white rounded-3xl max-w-4xl w-full p-6 md:p-8 border border-slate-200 shadow-2xl relative space-y-6 printable-area print-area">
        {/* Header Controls (hidden when printing) */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 no-print border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl">
              <Printer className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-base md:text-lg">
                Batch Printing Center ({selectedCases.length} Selected)
              </h3>
              <p className="text-xs text-slate-500">
                Generate clean multi-page printable PDFs for laboratory cards or invoices
              </p>
            </div>
          </div>

          {/* Type Toggle & Print Action */}
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
            <div className="bg-slate-100 p-1 rounded-xl flex gap-1">
              <button
                type="button"
                onClick={() => setPrintType('slips')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  printType === 'slips'
                    ? 'bg-white text-indigo-600 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Lab Cards ({selectedCases.length})
              </button>
              <button
                type="button"
                onClick={() => setPrintType('invoices')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  printType === 'invoices'
                    ? 'bg-white text-emerald-600 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Invoices ({matchedInvoices.filter((m) => m.invoice).length})
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handlePrint()}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-2 transition-all cursor-pointer"
              >
                <Printer className="w-4 h-4" /> Print All ({selectedCases.length})
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* PRINTABLE BATCH CONTAINER */}
        <div className="space-y-8">
          {printType === 'slips' ? (
            /* PRINTING JOB SLIPS / LAB CARDS */
            selectedCases.map((caseData, index) => (
              <div
                key={caseData.id}
                className={`flex justify-center ${
                  index < selectedCases.length - 1 ? 'page-break mb-8 print:mb-0' : ''
                }`}
              >
                <LabCardSlip caseData={caseData} />
              </div>
            ))
          ) : (
            /* PRINTING INVOICES */
            matchedInvoices.map(({ caseData, invoice }, index) => {
              if (!invoice) {
                return (
                  <div key={caseData.id} className="p-6 bg-slate-50 rounded-2xl border border-slate-200 text-center text-xs text-slate-500">
                    No generated invoice found for Case #{caseData.case_number} ({caseData.case_type_name}).
                  </div>
                );
              }

              const remainingBalance = Math.max(0, invoice.final_amount - invoice.amount_paid);

              return (
                <div
                  key={invoice.id}
                  className={`space-y-6 print:p-0 border border-slate-200 p-6 rounded-2xl bg-white ${
                    index < matchedInvoices.length - 1 ? 'page-break mb-8 print:mb-0' : ''
                  }`}
                >
                  {/* Top Header */}
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-4 border-b-2 border-slate-900 pb-6">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {brandingSettings.logoUrl ? (
                          <img src={brandingSettings.logoUrl} alt="" className="w-8 h-8 rounded-lg object-contain" />
                        ) : (
                          <div className="w-8 h-8 bg-slate-900 text-indigo-400 font-black rounded-lg flex items-center justify-center text-sm shadow-xs">
                            DS
                          </div>
                        )}
                        <span className="font-black text-xl text-slate-900 tracking-tight">{brandingSettings.appName || 'DENTAL SOLUTIONS LAB'}</span>
                      </div>
                      {brandingSettings.tagline && <p className="text-xs font-semibold text-slate-600">{brandingSettings.tagline}</p>}
                    </div>

                    <div className="text-left sm:text-right space-y-2">
                      <div className="inline-block px-3 py-1 bg-slate-900 text-white text-xs font-black uppercase tracking-widest rounded-md">
                        INVOICE STATEMENT
                      </div>
                      <div className="font-mono font-black text-xl text-indigo-600 print:text-slate-900">
                        {invoice.invoice_number}
                      </div>
                      <div className="text-xs text-slate-600 space-y-0.5 font-medium">
                        <div>Issue Date: <strong>{invoice.created_at}</strong></div>
                      </div>
                    </div>
                  </div>

                  {/* Bill To & Case Meta Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block">BILLED TO</span>
                      <div className="font-extrabold text-slate-900 text-sm">{invoice.lab_name}</div>
                      <div className="text-slate-700 font-semibold">Attn: {invoice.doctor_name}</div>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-1 sm:text-right">
                      <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block">WORKSTATION CASE REFERENCE</span>
                      <div className="font-extrabold text-indigo-700 text-sm print:text-slate-900">Case #: {invoice.case_number}</div>
                      <div className="text-slate-800 font-semibold">Doctor: {caseData.doctor_name}</div>
                    </div>
                  </div>

                  {/* Service Table */}
                  <div className="border border-slate-200 rounded-2xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-slate-900 text-white font-bold uppercase text-[10px] tracking-wider">
                          <th className="p-3.5">Service & Restoration</th>
                          <th className="p-3.5 text-center">FDI Teeth</th>
                          <th className="p-3.5 text-right">Standard Rate</th>
                          <th className="p-3.5 text-right">Discount</th>
                          <th className="p-3.5 text-right">Net Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 font-medium">
                        <tr>
                          <td className="p-3.5">
                            <div className="font-bold text-slate-900 text-sm">{invoice.case_type_name}</div>
                          </td>
                          <td className="p-3.5 text-center font-mono font-bold text-indigo-700">
                            {caseData.selected_teeth.map((t) => `#${t}`).join(', ')}
                          </td>
                          <td className="p-3.5 text-right font-mono">PKR {(invoice.amount || 0).toLocaleString()}</td>
                          <td className="p-3.5 text-right font-mono text-rose-600">- PKR {(invoice.discount || 0).toLocaleString()}</td>
                          <td className="p-3.5 text-right font-mono font-black text-slate-900">PKR {(invoice.final_amount || 0).toLocaleString()}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Financial Summary */}
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pt-2">
                    <div className="w-full sm:w-1/2 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-1">
                      <span className="font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5 text-[10px]">
                        <Landmark className="w-3.5 h-3.5 text-indigo-600" /> BANK REMITTANCE
                      </span>
                      <div className="font-mono text-[11px]">Meezan Bank Ltd • IBAN: PK88 MEZN 0002 0109 4829 1100</div>
                    </div>

                    <div className="w-full sm:w-1/2 space-y-1.5 text-xs">
                      <div className="flex justify-between py-1 border-b border-slate-200 text-slate-900 font-bold">
                        <span>Total Net Billed:</span>
                        <span className="font-mono font-black">PKR {(invoice.final_amount || 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between py-1.5 bg-indigo-50 border border-indigo-200 rounded-xl px-3 font-extrabold text-indigo-950">
                        <span>Outstanding Balance:</span>
                        <span className="font-mono font-black text-rose-700">PKR {(remainingBalance || 0).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer (Hidden on print) */}
        <div className="flex items-center justify-end gap-3 no-print pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => handlePrint()}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-2 transition-all cursor-pointer"
          >
            <Printer className="w-4 h-4" /> Print All Batch Documents
          </button>
        </div>
      </div>
    </div>
  );
};

