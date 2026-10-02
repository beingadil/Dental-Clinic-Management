import React, { useState } from 'react';
import { DentalCase } from '../../types';
import { useApp } from '../../context/AppContext';
import { Printer, X, Download, CheckCircle2, BookmarkCheck } from 'lucide-react';
import { JobSlipCard } from '../print/JobSlipCard';
import { LabCardSlip } from './LabCardSlip';
import { SavePdfButton } from '../print/SavePdfButton';
import {
  SLIP_PRINT_BODY_CLASS,
  SLIP_PRINT_ROOT_CLASS,
  buildStandaloneHtml,
  downloadStandaloneHtml,
} from '../print/printPipeline';
import '../print/jobSlipPrint.css';
import { loadPrintSettings, PrintSettings } from '../../services/printSettings';

interface CaseJobSlipModalProps {
  caseData: DentalCase;
  onClose: () => void;
}

/**
 * Single Job Slip — MODE A (compact physical tag, 100 × 95 mm).
 *
 * The preview shows the slip at its true physical proportions (100:95),
 * not a full A4 canvas. "Print Card" prints exactly one slip on a 100 × 95 mm
 * page (printers without custom media fall back to A4 with the slip still at
 * 100 × 95 mm, top-left — never scaled). "Save & Download" serializes the
 * same slip DOM + app styles so the downloaded file matches the paper.
 */
export const CaseJobSlipModal: React.FC<CaseJobSlipModalProps> = ({ caseData, onClose }) => {
  const { saveVoucherToSystem, brandingSettings } = useApp();
  const [savedSuccess, setSavedSuccess] = useState(false);
  const slipRef = React.useRef<HTMLDivElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [slipStyle] = useState<PrintSettings['jobSlipStyle']>(() => loadPrintSettings().jobSlipStyle);

  /**
   * "Print Card" — run the SAME isolation pipeline the batch modal uses.
   *
   * The card carried `.printable-area.print-area`, so index.css made it
   * static/100%-wide while the compact slip stayed inside a `transform:
   * scale(0.9)` preview wrapper that nothing stripped: the tag printed at
   * 90% of 100 × 95 mm on the generic 12 mm-margin @page, i.e. not the
   * preview. Scoped body class + `.job-slip-print-root` on the slip restores
   * the true physical size and reveals only the tag.
   */
  const handleDirectPrint = () => {
    if (slipStyle !== 'compact') {
      setTimeout(() => window.print(), 100);
      return;
    }
    const body = document.body;
    const card = cardRef.current;
    if (!card) {
      setTimeout(() => window.print(), 100);
      return;
    }
    body.classList.add(SLIP_PRINT_BODY_CLASS);
    card.classList.add(SLIP_PRINT_ROOT_CLASS);
    card.classList.remove('print-area', 'printable-area');
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        body.classList.remove(SLIP_PRINT_BODY_CLASS);
        card.classList.remove(SLIP_PRINT_ROOT_CLASS);
        card.classList.add('print-area', 'printable-area');
      }, 500);
    }, 60);
  };

  const handleSaveAndPrint = (shouldDownloadFile = false) => {
    // Save to system database
    saveVoucherToSystem({
      voucher_number: `SLIP-${caseData.case_number}`,
      voucher_type: 'job_slip',
      case_id: caseData.id,
      case_number: caseData.case_number,
      lab_name: caseData.lab_name,
      doctor_name: caseData.doctor_name,
      patient_name: caseData.patient_name || 'Clinical Patient',
      case_type_name: caseData.case_type_name,
      notes: `Teeth: ${caseData.selected_teeth.join(', ')} | Shade: ${caseData.shade || 'N/A'}`
    });

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 4000);

    if (shouldDownloadFile) {
      // Serialize the exact on-screen slip. Styles are INLINED from
      // document.styleSheets (not <link> tags): in the packaged app styles
      // live at /assets/*.css and a serialized relative link 404s in the
      // standalone file — the old bug that saved an unstyled/blank slip.
      const slipHtml = slipRef.current ? slipRef.current.outerHTML : '';
      // The compact slip wrapper already carries .job-slip-print-root /
      // .job-slip-page (that is what the in-app print path reveals), so the
      // standalone shell must NOT wrap it in a second copy — nesting two
      // fixed-size page boxes duplicated the slip's own dimensions.
      const pageShell = slipStyle === 'compact'
        ? slipHtml
        : `<div class="print-area printable-area">${slipHtml}</div>`;
      const pageCss = slipStyle === 'compact'
        ? `@page { size: 100mm 95mm; margin: 0; }
      body * { visibility: hidden !important; }
      .job-slip-print-root, .job-slip-print-root * { visibility: visible !important; }
      .job-slip-print-root { position: absolute; left: 0; top: 0; transform: none !important; }`
        : `body * { visibility: hidden !important; }
      .print-area, .print-area * { visibility: visible !important; }
      .print-area { position: absolute; left: 0; top: 0; width: 100%; }`;
      const htmlContent = buildStandaloneHtml(pageShell, {
        title: `Job Slip ${caseData.case_number}`,
        extraCss: `
    body { margin: 0; padding: 24px; background: #f1f5f9; display: flex; justify-content: center; }
    @media print {
      body { padding: 0; background: #ffffff; }
      ${pageCss}
    }`,
      });

      downloadStandaloneHtml(htmlContent, `Job_Slip_${caseData.case_number}.html`);
      return; // Download only — printing is the separate "Print Card" action.
    }

    // Trigger Print — MODE A: one compact 100 × 95 mm slip
    handleDirectPrint();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 md:p-6 overflow-y-auto no-print-backdrop">
      <div ref={cardRef} className="bg-white rounded-3xl max-w-md w-full p-5 md:p-6 border border-slate-200 shadow-2xl relative space-y-5 printable-area print-area my-auto">
        {/* Header Actions (hidden on print) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-base">Job Slip — Compact Tag</h3>
                {savedSuccess && (
                  <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase rounded-full flex items-center gap-1 animate-in fade-in">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Saved!
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {slipStyle === 'compact' ? '100 × 95 mm cut-out tag · 6 fit on one A4' : 'Full-page laboratory card (A4)'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleSaveAndPrint(true)}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
              title="Save voucher in database and download the exact slip file"
            >
              <Download className="w-4 h-4" /> Save &amp; Download
            </button>
            <SavePdfButton
              suggestedName={`Job-Slip_${caseData.case_number || 'tag'}.pdf`}
              className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl shadow-sm flex items-center gap-1.5 transition-all cursor-pointer"
            />
            <button
              type="button"
              onClick={() => handleSaveAndPrint(false)}
              className="px-3.5 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4" /> Print Card
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

        {/* Slip preview — compact tag at true proportions, or full lab card.
            The 0.9 screen scale is visual only; print output is never scaled. */}
        <div className="flex justify-center py-2">
          {slipStyle === 'compact' ? (
            <div
              className="job-slip-mode-single job-slip-preview job-slip-preview-zoom job-slip-print-root job-slip-page"
              ref={slipRef}
            >
              <JobSlipCard caseData={caseData} labName={brandingSettings.appName || 'DENTAL SOLUTIONS'} logoUrl={brandingSettings.logoUrl} />
            </div>
          ) : (
            <div
              className="max-h-[55vh] overflow-y-auto no-scrollbar rounded-xl"
              ref={slipRef}
            >
              <LabCardSlip caseData={caseData} />
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 no-print pt-2 border-t border-slate-100">
          <div className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
            <BookmarkCheck className="w-4 h-4 text-indigo-600" />
            <span>Cut along the border · fits inside the job bag.</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
