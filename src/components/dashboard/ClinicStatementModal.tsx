import React, { useState } from 'react';
import { X, Printer, Download, Building2, Calendar, FileText, CheckCircle2, ChevronDown } from 'lucide-react';
import { Invoice, DentalLab, DentalCase } from '../../types';
import { useApp } from '../../context/AppContext';

interface ClinicStatementModalProps {
  clinicName?: string;
  invoices: Invoice[];
  cases: DentalCase[];
  labs: DentalLab[];
  onClose: () => void;
}

export const ClinicStatementModal: React.FC<ClinicStatementModalProps> = ({
  clinicName: initialClinicName,
  invoices,
  cases,
  labs,
  onClose,
}) => {
  const { brandingSettings } = useApp();
  const [selectedClinic, setSelectedClinic] = useState<string>(() => {
    if (initialClinicName && initialClinicName !== 'Apex Dental Care & Clinic') {
      return initialClinicName;
    }
    return labs[0]?.name || initialClinicName || 'General Clinic Account';
  });

  const clinicLab = labs.find(l => l.name.toLowerCase() === selectedClinic.toLowerCase());
  const clinicInvoices = invoices.filter(i => (i.lab_name || '').toLowerCase() === selectedClinic.toLowerCase());
  const clinicCases = cases.filter(c => (c.lab_name || '').toLowerCase() === selectedClinic.toLowerCase());

  const totalBilled = clinicInvoices.reduce((sum, i) => sum + (i.final_amount || 0), 0);
  const totalPaid = clinicInvoices.reduce((sum, i) => sum + (i.amount_paid || 0), 0);
  const totalOutstanding = Math.max(0, totalBilled - totalPaid);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 print:p-0 print:bg-white">
      <div className="bg-white w-full max-w-3xl rounded-3xl p-6 md:p-8 shadow-2xl border border-slate-200 space-y-6 max-h-[92vh] overflow-y-auto print:max-h-none print:overflow-visible print:shadow-none print:border-none print-area">
        
        {/* Header with Print Controls & Clinic Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3 print:hidden">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Clinic Account Statement</h3>
              <p className="text-xs text-slate-500">Official statement of laboratory invoices and payment transactions</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {labs.length > 1 && (
              <select
                value={selectedClinic}
                onChange={(e) => setSelectedClinic(e.target.value)}
                className="px-3 py-1.5 text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
              >
                {labs.map((l) => (
                  <option key={l.id} value={l.name}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={handlePrint}
              className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / Save PDF</span>
            </button>
            <button 
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Statement Layout */}
        <div className="space-y-6 text-xs text-slate-700">
          
          {/* Lab & Clinic Banner */}
          <div className="flex justify-between items-start pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-xl font-black text-blue-900 tracking-tight">{brandingSettings.appName || 'DENTAL SOLUTIONS LAB'}</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">{brandingSettings.tagline || 'Digital Dental CAD/CAM Laboratory & Milling Center'}</p>
              <p className="text-[11px] text-slate-500">{[brandingSettings.address, brandingSettings.phone && `Tel: ${brandingSettings.phone}`, brandingSettings.email].filter(Boolean).join(' • ')}</p>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 uppercase">
                Statement of Account
              </span>
              <p className="text-[11px] font-bold text-slate-800 mt-1">Date: {new Date().toLocaleDateString('en-GB')}</p>
              <p className="text-[10px] text-slate-400">Currency: PKR (Pakistani Rupee)</p>
            </div>
          </div>

          {/* Account Details Box */}
          <div className="grid grid-cols-2 gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Statement For</span>
              <h4 className="text-sm font-extrabold text-slate-900 mt-0.5">{selectedClinic}</h4>
              <p className="text-[11px] text-slate-600">Attn: {clinicLab?.doctor_name || clinicLab?.contact_person || 'Lead Doctor / Clinic Admin'}</p>
              <p className="text-[11px] text-slate-500">{clinicLab?.phone || '0300-0000000'}</p>
            </div>
            <div className="text-right space-y-1">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Billed:</span>{' '}
                <span className="font-bold text-slate-800">PKR {totalBilled.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Paid:</span>{' '}
                <span className="font-bold text-emerald-600">PKR {totalPaid.toLocaleString()}</span>
              </div>
              <div className="pt-1 border-t border-slate-200">
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Balance Due:</span>{' '}
                <span className="text-sm font-extrabold text-rose-600">PKR {totalOutstanding.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Invoice Transactions Table */}
          <div>
            <h5 className="font-bold text-slate-800 mb-2 uppercase text-[10px] tracking-wider">Invoices & Case Ledger</h5>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100/80 text-[10px] font-bold text-slate-600 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Invoice #</th>
                    <th className="py-2.5 px-3">Case Ref / Patient</th>
                    <th className="py-2.5 px-3">Issue Date</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Amount (PKR)</th>
                    <th className="py-2.5 px-3 text-right">Paid (PKR)</th>
                    <th className="py-2.5 px-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {clinicInvoices.length > 0 ? (
                    clinicInvoices.map((inv) => {
                      const balance = inv.final_amount - inv.amount_paid;
                      return (
                        <tr key={inv.id} className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-3 font-mono font-bold text-blue-700">{inv.invoice_number}</td>
                          <td className="py-2.5 px-3 font-medium text-slate-800">{inv.case_number || 'General Case'}</td>
                          <td className="py-2.5 px-3 text-slate-500">{inv.issue_date || inv.created_at?.split('T')[0] || new Date().toISOString().split('T')[0]}</td>
                          <td className="py-2.5 px-3">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              inv.payment_status === 'paid' 
                                ? 'bg-emerald-100 text-emerald-800'
                                : inv.payment_status === 'partial'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}>
                              {inv.payment_status.toUpperCase()}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-medium">PKR {inv.final_amount.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-right font-medium text-emerald-600">PKR {inv.amount_paid.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-right font-extrabold text-slate-900">PKR {balance.toLocaleString()}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-400 font-medium">
                        No recorded invoices for {selectedClinic}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payment Terms & Bank Info */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 grid grid-cols-2 gap-3 text-[11px]">
            <div>
              <span className="font-bold text-slate-800 block">Bank Transfer Information</span>
              {brandingSettings.bankName ? (
                <>
                  <p className="text-slate-600">Bank: {brandingSettings.bankName}</p>
                  {brandingSettings.bankAccountTitle && <p className="text-slate-600">Account Title: {brandingSettings.bankAccountTitle}</p>}
                  {brandingSettings.bankIban && <p className="font-mono text-slate-800">IBAN: {brandingSettings.bankIban}</p>}
                </>
              ) : (
                <p className="text-slate-500">Add bank remittance details in Settings → Branding & Identity.</p>
              )}
            </div>
            <div>
              <span className="font-bold text-slate-800 block">Terms & Remittance</span>
              <p className="text-slate-500">Invoices are payable within standard turnaround agreement.</p>
              {brandingSettings.phone && <p className="text-slate-500">Please send payment confirmation screenshot to {brandingSettings.phone}.</p>}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
