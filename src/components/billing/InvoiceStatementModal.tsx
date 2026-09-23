import React, { useMemo, useState } from 'react';
import { Invoice, DentalCase } from '../../types';
import { useApp } from '../../context/AppContext';
import { Printer, X, CheckCircle2, FileText } from 'lucide-react';
import {
  DocumentKind,
  PRINT_SECTIONS,
  DEFAULT_ENABLED,
  PrintDocument,
} from '../print/printRenderer';
import { loadPrintSettings } from '../../services/printSettings';
import '../print/printStyles.css';

interface InvoiceStatementModalProps {
  invoice: Invoice;
  caseData?: DentalCase | null;
  onClose: () => void;
}

const KIND: DocumentKind = 'invoice';

export const InvoiceStatementModal: React.FC<InvoiceStatementModalProps> = ({
  invoice,
  caseData,
  onClose,
}) => {
  const { brandingSettings, saveVoucherToSystem } = useApp();
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [printSettings] = useState(() => loadPrintSettings());
  const [enabled, setEnabled] = useState<string[]>(DEFAULT_ENABLED[KIND]);

  const remainingBalance = Math.max(0, invoice.final_amount - invoice.amount_paid);

  const toggleSection = (id: string) => {
    setEnabled((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const handleSaveAndPrint = () => {
    // Log voucher in system database (audit of every printed billing document)
    saveVoucherToSystem({
      voucher_number: invoice.invoice_number,
      voucher_type: 'invoice',
      case_id: invoice.case_id,
      case_number: invoice.case_number,
      lab_name: invoice.lab_name,
      doctor_name: invoice.doctor_name,
      patient_name: caseData?.patient_name || 'Clinical Patient',
      case_type_name: invoice.case_type_name,
      amount: invoice.final_amount,
      notes: `Printed invoice — Paid: PKR ${invoice.amount_paid.toLocaleString()} | Balance: PKR ${remainingBalance.toLocaleString()} | Status: ${invoice.payment_status}`
    });

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 4000);
    setTimeout(() => window.print(), 100);
  };

  const headerNote = useMemo(() => {
    if (invoice.payment_status === 'paid') return 'Settled in full — thank you.';
    if (invoice.payment_status === 'partial') return 'Partially settled — balance is due per terms.';
    return 'Payment is due per the agreed terms.';
  }, [invoice.payment_status]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 md:p-6 overflow-y-auto no-print-backdrop">
      <div className="bg-white rounded-2xl max-w-5xl w-full border border-slate-200 shadow-2xl relative my-auto overflow-hidden">
        {/* Header (screen only) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-slate-200 no-print">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-slate-100 text-slate-700 rounded-lg">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-sm">Print Invoice — {invoice.invoice_number}</h3>
                {savedSuccess && (
                  <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase rounded-full flex items-center gap-1 border border-emerald-200">
                    <CheckCircle2 className="w-3 h-3" /> Saved
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">{headerNote}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEnabled(DEFAULT_ENABLED[KIND])}
              className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-lg transition-colors cursor-pointer"
              title="Reset to all sections"
            >
              Reset sections
            </button>
            <button
              type="button"
              onClick={handleSaveAndPrint}
              className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" /> Save &amp; Print
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Section toggles (screen only) */}
        <div className="px-6 py-3 border-b border-slate-100 no-print">
          <div className="flex flex-wrap gap-1.5">
            {PRINT_SECTIONS[KIND].map((s) => {
              const isOn = enabled.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleSection(s.id)}
                  title={s.hint}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
                    isOn
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400 hover:text-slate-700'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
            <span className="ml-auto text-[10px] text-slate-400 font-semibold self-center">
              {enabled.length}/{PRINT_SECTIONS[KIND].length} sections on paper
            </span>
          </div>
        </div>

        {/* Live preview — the exact paper output */}
        <div className="print-preview-shell no-print">
          <div className={printSettings?.paper === 'letter' ? 'print-preview-page paper-letter' : 'print-preview-page'}>
            <div className="print-area">
              <PrintDocument
                kind={KIND}
                sections={enabled}
                branding={brandingSettings}
                printSettings={printSettings}
                caseData={caseData}
                invoice={invoice}
                labName={invoice.lab_name}
              />
            </div>
          </div>
        </div>

        {/* Screen footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-t border-slate-100 no-print">
          <span className="text-xs text-slate-500">
            Voucher is logged to billing history. Section toggles control what prints.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
