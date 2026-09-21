import React, { useState } from 'react';
import { Invoice, DentalCase } from '../../types';
import { useApp } from '../../context/AppContext';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, X, ShieldCheck, CheckCircle2, Clock, DollarSign, Building2, Phone, Mail, FileText, Landmark, Download, BookmarkCheck } from 'lucide-react';

interface InvoiceStatementModalProps {
  invoice: Invoice;
  caseData?: DentalCase | null;
  onClose: () => void;
}

export const InvoiceStatementModal: React.FC<InvoiceStatementModalProps> = ({
  invoice,
  caseData,
  onClose,
}) => {
  const { brandingSettings, saveVoucherToSystem } = useApp();
  const [savedSuccess, setSavedSuccess] = useState(false);

  const remainingBalance = Math.max(0, invoice.final_amount - invoice.amount_paid);

  const handleSaveAndPrint = (shouldDownloadFile = false) => {
    // 1. Log voucher in system database
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
      notes: `Paid: PKR ${invoice.amount_paid.toLocaleString()} | Balance: PKR ${remainingBalance.toLocaleString()} | Status: ${invoice.payment_status}`
    });

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 4000);

    if (shouldDownloadFile) {
      // Direct File Download of official HTML/PDF Statement Voucher
      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice Voucher ${invoice.invoice_number}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; color: #0f172a; max-width: 800px; margin: 0 auto; border: 2px solid #0f172a; border-radius: 16px; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 16px; }
    .brand { font-size: 22px; font-weight: 900; text-transform: uppercase; }
    .tagline { color: #4f46e5; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .inv-title { text-align: right; }
    .inv-num { font-size: 20px; font-weight: 900; font-family: monospace; color: #059669; }
    .meta-table { width: 100%; border-collapse: collapse; margin-top: 24px; }
    .meta-table th, .meta-table td { border: 1px solid #cbd5e1; padding: 10px; font-size: 12px; }
    .meta-table th { bg-color: #f8fafc; text-align: left; font-weight: bold; background: #f1f5f9; }
    .total-box { margin-top: 24px; padding: 16px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; display: flex; justify-content: space-between; font-weight: 800; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${brandingSettings.appName || 'DENTAL SOLUTIONS LAB'}</div>
      <div class="tagline">${brandingSettings.tagline || 'Advanced Digital Dental Laboratory'}</div>
      <p style="font-size: 11px; margin-top: 6px; color: #475569;">${brandingSettings.address}<br>Tel: ${brandingSettings.phone} | ${brandingSettings.email}</p>
    </div>
    <div class="inv-title">
      <div style="font-[10px]; font-weight: 900; background: #059669; color: white; padding: 4px 10px; border-radius: 6px; display: inline-block;">OFFICIAL INVOICE VOUCHER</div>
      <div class="inv-num" style="margin-top: 6px;">#${invoice.invoice_number}</div>
      <div style="font-size: 11px; color: #64748b;">Case Ref: #${invoice.case_number}</div>
    </div>
  </div>

  <table class="meta-table">
    <tr>
      <th>Dental Clinic / Practice</th>
      <td><strong>${invoice.lab_name}</strong></td>
      <th>Attending Doctor</th>
      <td><strong>Dr. ${invoice.doctor_name}</strong></td>
    </tr>
    <tr>
      <th>Restoration Material</th>
      <td>${invoice.case_type_name}</td>
      <th>Billing Date</th>
      <td>${invoice.created_at}</td>
    </tr>
  </table>

  <div class="total-box">
    <div>
      <div>Total Net Price: PKR ${invoice.final_amount.toLocaleString()}</div>
      <div style="color: #059669; margin-top: 4px;">Amount Received: PKR ${invoice.amount_paid.toLocaleString()}</div>
    </div>
    <div style="font-size: 18px; color: ${remainingBalance > 0 ? '#dc2626' : '#059669'};">
      Outstanding Balance: PKR ${remainingBalance.toLocaleString()}
    </div>
  </div>

  <div style="margin-top: 30px; font-size: 11px; text-align: center; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 12px;">
    Bank Accounts: ${brandingSettings.bankName} - A/C: ${brandingSettings.bankAccountNumber} | IBAN: ${brandingSettings.bankIban}
  </div>
</body>
</html>`;

      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Invoice_Voucher_${invoice.invoice_number}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    setTimeout(() => {
      window.print();
    }, 100);
  };

  // QR Payload for Invoice scanning
  const qrInvoicePayload = JSON.stringify({
    invoice_number: invoice.invoice_number,
    case_number: invoice.case_number,
    lab: invoice.lab_name,
    doctor: invoice.doctor_name,
    net_amount: invoice.final_amount,
    paid_amount: invoice.amount_paid,
    balance: remainingBalance,
    status: invoice.payment_status,
    issuer: brandingSettings.appName || 'Dental Solutions'
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 md:p-6 overflow-y-auto no-print-backdrop">
      <div className="bg-white rounded-3xl max-w-4xl xl:max-w-5xl w-full p-6 md:p-10 border border-slate-200 shadow-2xl relative space-y-8 printable-area print-area my-auto">
        {/* Screen Header Controls (Hidden during print) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-2xl">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-base">Print PDF Invoice Statement</h3>
                {savedSuccess && (
                  <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase rounded-full flex items-center gap-1 animate-in fade-in">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Saved in System!
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">Official dental laboratory billing document</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleSaveAndPrint(true)}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
              title="Save invoice voucher in system database and download file"
            >
              <Download className="w-4 h-4" /> Save & Download Voucher
            </button>
            <button
              type="button"
              onClick={() => handleSaveAndPrint(false)}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4" /> Print PDF
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

        {/* PRINTABLE PDF STATEMENT CONTAINER */}
        <div className="space-y-6 print:p-0">
          
          {/* Top Header: Laboratory Letterhead & Brand */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 border-b-2 border-slate-900 pb-6">
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                {brandingSettings.logoUrl ? (
                  <img 
                    src={brandingSettings.logoUrl} 
                    alt="Logo" 
                    className="w-10 h-10 rounded-xl object-contain bg-slate-50 border border-slate-200 p-0.5 shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 bg-slate-900 text-indigo-400 font-bold rounded-xl flex items-center justify-center text-sm shadow-xs shrink-0">
                    {brandingSettings.appName ? brandingSettings.appName.substring(0, 2).toUpperCase() : 'DS'}
                  </div>
                )}
                <div>
                  <span className="font-bold text-xl text-slate-900 tracking-tight uppercase block leading-none">
                    {brandingSettings.appName || 'DENTAL SOLUTIONS LAB'}
                  </span>
                  <span className="text-[10px] font-bold text-indigo-600 tracking-wider uppercase block mt-1">
                    {brandingSettings.tagline || 'Advanced Digital Laboratory'}
                  </span>
                </div>
              </div>

              <div className="text-[11px] text-slate-600 space-y-0.5 pt-1">
                <p className="flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  {brandingSettings.address || 'Batala Street Near Railway Park, Gill Road, Gujranwala.'}
                </p>
                <p className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  {brandingSettings.phone || '0333-0473797'} | Support: {brandingSettings.email || 'info@dentalsolutions.pk'}
                </p>
              </div>
            </div>

            <div className="text-left sm:text-right space-y-2 flex flex-col items-start sm:items-end">
              <div className="flex items-center gap-3">
                <div className="p-1 bg-white border border-slate-300 rounded-lg shadow-2xs">
                  <QRCodeSVG value={qrInvoicePayload} size={54} level="M" />
                </div>
                <div>
                  <div className="inline-block px-3 py-1 bg-slate-900 text-white text-xs font-bold uppercase tracking-widest rounded-md">
                    INVOICE VOUCHER
                  </div>
                  <div className="font-mono font-bold text-lg text-indigo-600 print:text-slate-900 mt-1">
                    {invoice.invoice_number}
                  </div>
                </div>
              </div>

              <div className="text-xs text-slate-600 space-y-0.5 font-medium">
                <div>Issue Date: <strong>{invoice.created_at}</strong></div>
                <div>Payment Terms: <strong>Net 30 Days</strong></div>
              </div>

              {/* Status Badge Stamp */}
              <div className="pt-1">
                {invoice.payment_status === 'paid' && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-800 border border-emerald-300 font-extrabold text-xs uppercase tracking-wider rounded-md">
                    <CheckCircle2 className="w-3.5 h-3.5" /> FULLY PAID
                  </span>
                )}
                {invoice.payment_status === 'partial' && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 border border-blue-300 font-extrabold text-xs uppercase tracking-wider rounded-md">
                    <Clock className="w-3.5 h-3.5" /> PARTIALLY PAID
                  </span>
                )}
                {invoice.payment_status === 'unpaid' && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-amber-100 text-amber-900 border border-amber-300 font-extrabold text-xs uppercase tracking-wider rounded-md">
                    <Clock className="w-3.5 h-3.5" /> OUTSTANDING UNPAID
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Bill To & Case Meta Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-1">
              <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block">BILLED TO (DENTAL CLINIC / PRACTICE)</span>
              <div className="font-extrabold text-slate-900 text-sm">{invoice.lab_name}</div>
              <div className="text-slate-700 font-semibold">Attn: {invoice.doctor_name}</div>
              <div className="text-slate-500">Department: Restorative & Implant Prosthetics</div>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-1 sm:text-right">
              <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block">WORKSTATION CASE REFERENCE</span>
              <div className="font-extrabold text-indigo-700 text-sm print:text-slate-900">Case #: {invoice.case_number}</div>
              <div className="text-slate-800 font-semibold">Patient: {caseData?.patient_name || 'Clinical Patient'}</div>
              <div className="text-slate-500">Shade: <strong>{caseData?.shade || 'A1.5'}</strong></div>
            </div>
          </div>

          {/* Itemized Services Breakdown Table */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-900 text-white font-bold uppercase text-[10px] tracking-wider">
                  <th className="p-3.5">Service & Restoration Fabrication</th>
                  <th className="p-3.5 text-center">FDI Teeth</th>
                  <th className="p-3.5 text-right">Standard Rate</th>
                  <th className="p-3.5 text-right">Discount</th>
                  <th className="p-3.5 text-right">Net Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-medium">
                <tr>
                  <td className="p-3.5 space-y-0.5">
                    <div className="font-bold text-slate-900 text-sm">{invoice.case_type_name} Fabrication</div>
                    <div className="text-[11px] text-slate-500">High-translucency CAD/CAM restoration with clinical margin verification.</div>
                  </td>
                  <td className="p-3.5 text-center font-mono font-bold text-indigo-700 print:text-slate-900">
                    {caseData?.selected_teeth ? caseData.selected_teeth.map(t => `#${t}`).join(', ') : '11, 21'}
                  </td>
                  <td className="p-3.5 text-right font-mono text-slate-700">PKR {invoice.amount.toLocaleString()}</td>
                  <td className="p-3.5 text-right font-mono text-rose-600 font-semibold">- PKR {invoice.discount.toLocaleString()}</td>
                  <td className="p-3.5 text-right font-mono font-bold text-slate-900">PKR {invoice.final_amount.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Financial Calculation & Ledger Summary */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pt-2">
            
            {/* Bank Payment Remittance Instructions */}
            <div className="w-full sm:w-1/2 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-2">
              <span className="font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5 text-[10px]">
                <Landmark className="w-3.5 h-3.5 text-indigo-600" /> BANK REMITTANCE DETAILS
              </span>
              <div className="space-y-1 font-mono text-[11px] text-slate-800">
                <div>Bank: <strong>{brandingSettings.bankName || 'Meezan Bank Ltd'}</strong></div>
                <div>Account Title: <strong>{brandingSettings.bankAccountTitle || brandingSettings.appName || 'Dental Solutions Lab'}</strong></div>
                <div>Account Number: <strong>{brandingSettings.bankAccountNumber || '01020304050607'}</strong></div>
                {brandingSettings.bankIban && <div>IBAN: <strong>{brandingSettings.bankIban}</strong></div>}
              </div>
              <p className="text-[10px] text-slate-500 italic">Please quote Invoice {invoice.invoice_number} on bank deposit slip or online transfer reference.</p>
            </div>

            {/* Total Ledger Box */}
            <div className="w-full sm:w-1/2 space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-200 text-slate-600">
                <span>Gross Service Charge:</span>
                <span className="font-mono font-bold">PKR {invoice.amount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200 text-rose-600">
                <span>Lab Discount Applied:</span>
                <span className="font-mono font-bold">- PKR {invoice.discount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b-2 border-slate-900 text-slate-900 font-bold text-sm">
                <span>Total Net Billed Amount:</span>
                <span className="font-mono font-bold">PKR {invoice.final_amount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200 text-emerald-700 font-semibold">
                <span>Total Received Payments:</span>
                <span className="font-mono font-bold">- PKR {invoice.amount_paid.toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-2 bg-indigo-50 border border-indigo-200 rounded-xl px-3 font-extrabold text-sm text-indigo-950 print:bg-slate-100">
                <span>Outstanding Balance Due:</span>
                <span className="font-mono font-bold text-rose-700 print:text-slate-900">PKR {remainingBalance.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Payment Receipts History (if payments exist) */}
          {invoice.payments.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">ITEMIZED PAYMENT CLEARANCE HISTORY</span>
              <div className="space-y-1 text-xs">
                {invoice.payments.map((p) => (
                  <div key={p.id} className="p-2.5 bg-emerald-50/60 border border-emerald-200 rounded-xl flex justify-between items-center text-emerald-950 font-medium">
                    <div>
                      <span className="font-bold text-slate-900">{p.payment_date}</span> • <span className="uppercase font-mono text-[10px] font-bold bg-emerald-200 text-emerald-900 px-1.5 py-0.5 rounded">{p.payment_method}</span> {p.notes && <span className="text-slate-600 italic">({p.notes})</span>}
                    </div>
                    <span className="font-mono font-bold text-emerald-800">PKR {p.amount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Guarantee & Terms Note */}
          <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4 text-[10px] text-slate-500">
            <div>
              <span className="font-bold text-slate-700 uppercase block mb-0.5">GUARANTEE & RETURNS POLICY</span>
              All restorations carry a laboratory warranty against material fracture. Remakes require original impression & returned prosthesis.
            </div>
            <div className="sm:text-right space-y-4">
              <div>
                <span className="font-bold text-slate-700 uppercase block mb-0.5">AUTHORIZED SIGNATURE & STAMP</span>
                <div className="h-10 border-b border-slate-400 w-48 sm:ml-auto mt-2" />
                <p className="mt-1 font-bold text-slate-800 text-[11px]">Lab Director / Accounts Manager</p>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer (Hidden on print) */}
        <div className="flex flex-wrap items-center justify-between gap-3 no-print pt-2 border-t border-slate-100">
          <div className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
            <BookmarkCheck className="w-4 h-4 text-emerald-600" />
            <span>Invoice voucher is logged in system billing history.</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => handleSaveAndPrint(true)}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4" /> Save & Download Voucher
            </button>
            <button
              type="button"
              onClick={() => handleSaveAndPrint(false)}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4" /> Print / Save PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
