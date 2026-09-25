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
import {
  loadPrintSettings,
  loadDocumentSections,
  saveDocumentSections,
} from '../../services/printSettings';
import { PrintSectionPicker } from '../common/PrintSectionPicker';
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
  const [showSections, setShowSections] = useState(false);
  /* The invoice content list is a stored setting, not dialog-local state: the
     same list is used by batch printing and by Settings → Print. */
  const [enabled, setEnabled] = useState<string[]>(() =>
    loadDocumentSections(KIND, DEFAULT_ENABLED[KIND])
  );

  const remainingBalance = Math.max(0, invoice.final_amount - invoice.amount_paid);

  const applySections = (next: string[]) => {
    setEnabled(next);
    saveDocumentSections(KIND, next);
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
      {/* The CARD is the print area (same pattern as the job slip and receipt
          modals): the printable sheet must never sit inside a `.no-print` or
          `overflow-hidden` wrapper, or paper output comes out blank/clipped. */}
      <div className="print-area printable-area bg-white rounded-2xl max-w-5xl w-full border border-slate-200 shadow-2xl relative my-auto overflow-hidden">
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
              onClick={() => setShowSections((v) => !v)}
              className={`px-3 py-1.5 border font-semibold text-xs rounded-lg transition-colors cursor-pointer ${
                showSections
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
              }`}
              title="Choose what appears on the printed invoice — remembered for next time"
            >
              Invoice content ({enabled.length}/{PRINT_SECTIONS[KIND].length})
            </button>
            <button
              type="button"
              onClick={() => applySections(DEFAULT_ENABLED[KIND])}
              className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-lg transition-colors cursor-pointer"
              title="Restore every invoice section"
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

        {/* Invoice content setting (screen only) — saved to the database, so
            the next invoice, and batch printing, use the same list. */}
        {showSections && (
          <div className="border-b border-slate-100 bg-slate-50/60 px-6 py-4 no-print">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                What appears on the printed invoice
              </span>
              <span className="text-[10px] font-semibold text-slate-400">
                {enabled.length} of {PRINT_SECTIONS[KIND].length} sections · saved automatically
              </span>
            </div>
            <PrintSectionPicker kind={KIND} value={enabled} onChange={applySections} />
          </div>
        )}

        {/* Live preview — this IS the paper output (the card above carries
            print-area). Deliberately NOT `.no-print`: that class is
            `display:none` on paper and used to print a blank invoice. */}
        <div className="print-preview-shell">
          <div className={printSettings?.paper === 'letter' ? 'print-preview-page paper-letter' : 'print-preview-page'}>
            <div>
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
            Voucher is logged to billing history. The invoice content list is stored in Settings → Print.
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
