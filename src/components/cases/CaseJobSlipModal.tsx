import React, { useState } from 'react';
import { DentalCase } from '../../types';
import { useApp } from '../../context/AppContext';
import { Printer, X, Download, CheckCircle2, BookmarkCheck } from 'lucide-react';
import { LabCardSlip } from './LabCardSlip';

interface CaseJobSlipModalProps {
  caseData: DentalCase;
  onClose: () => void;
}

export const CaseJobSlipModal: React.FC<CaseJobSlipModalProps> = ({ caseData, onClose }) => {
  const { saveVoucherToSystem, brandingSettings } = useApp();
  const [savedSuccess, setSavedSuccess] = useState(false);

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
      // Direct File Download (classic voucher style)
      const teethStr = caseData.selected_teeth.map(t => `#${t}`).join(', ');
      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Job Slip Voucher ${caseData.case_number}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; padding: 30px; color: #0f172a; max-width: 700px; margin: 0 auto; border: 2px solid #0f172a; border-radius: 16px; }
    h1 { margin: 0; font-size: 24px; text-transform: uppercase; }
    .badge { background: #4f46e5; color: white; padding: 4px 12px; border-radius: 8px; font-weight: bold; font-size: 12px; display: inline-block; }
    .row { display: flex; justify-content: space-between; margin-top: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
    .label { font-weight: bold; color: #475569; }
    .val { font-weight: 800; font-family: monospace; }
  </style>
</head>
<body>
  <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px;">
    <div>
      <h1>${brandingSettings.appName || 'Dental Lab'}</h1>
      <p style="margin: 4px 0 0 0; color: #4f46e5; font-weight: bold; font-size: 12px;">WORKSTATION JOB SLIP VOUCHER</p>
    </div>
    <div style="text-align: right;">
      <span class="badge">DS VOUCHER</span>
      <div style="font-size: 18px; font-weight: 900; font-family: monospace; color: #4f46e5; margin-top: 4px;">#${caseData.case_number}</div>
    </div>
  </div>
  <div class="row"><span class="label">Dental Clinic / Pt:</span><span class="val">${caseData.lab_name}</span></div>
  <div class="row"><span class="label">Attending Doctor:</span><span class="val">Dr. ${caseData.doctor_name}</span></div>
  <div class="row"><span class="label">Material & Restoration:</span><span class="val">${caseData.case_type_name}</span></div>
  <div class="row"><span class="label">FDI Selected Teeth:</span><span class="val">${teethStr || 'Full Arch'}</span></div>
  <div class="row"><span class="label">Shade:</span><span class="val">${caseData.shade || 'A2'}</span></div>
  <div class="row"><span class="label">Priority:</span><span class="val" style="text-transform: uppercase;">${caseData.priority}</span></div>
  <div class="row"><span class="label">Expected Delivery:</span><span class="val">${caseData.delivery_date} (05:00 PM)</span></div>
  <div style="margin-top: 20px; padding: 12px; background: #f8fafc; border-radius: 8px; font-size: 13px;">
    <strong>Instructions:</strong> ${caseData.instructions || 'Standard anatomical contours & high-gloss polish.'}
  </div>
  <div style="margin-top: 30px; font-size: 11px; text-align: center; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 8px;">
    ${brandingSettings.appName || 'Dental Solutions'} Laboratory • Contact: ${brandingSettings.phone || '—'} • ${brandingSettings.email || '—'}
  </div>
</body>
</html>`;

      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Job_Slip_Voucher_${caseData.case_number}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return; // Download only — printing is the separate "Print Card" action.
    }

    // Trigger Print
    setTimeout(() => {
      window.print();
    }, 100);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 md:p-6 overflow-y-auto no-print-backdrop">
      <div className="bg-white rounded-3xl max-w-3xl lg:max-w-4xl w-full p-6 md:p-8 border border-slate-200 shadow-2xl relative space-y-6 printable-area print-area my-auto">
        {/* Header Actions (hidden on print) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-base">Dental Solutions Laboratory Card</h3>
                {savedSuccess && (
                  <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase rounded-full flex items-center gap-1 animate-in fade-in">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Saved in System!
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">Official Physical Lab Case Routing Voucher</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleSaveAndPrint(true)}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
              title="Save voucher in database and download HTML/PDF voucher file"
            >
              <Download className="w-4 h-4" /> Save & Download File
            </button>
            <button
              type="button"
              onClick={() => handleSaveAndPrint(false)}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
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

        <div className="flex justify-center">
          <LabCardSlip caseData={caseData} />
        </div>

        {/* Modal Footer Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 no-print pt-2 border-t border-slate-100">
          <div className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
            <BookmarkCheck className="w-4 h-4 text-indigo-600" />
            <span>Vouchers are automatically saved in system database logs.</span>
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


