import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { formatPKR } from '../../services/financeDomain';
import { X, Printer, Download, Calendar, Building2, FileText, CheckCircle2 } from 'lucide-react';

interface ClinicStatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  clinicId: string;
}

export const ClinicStatementModal: React.FC<ClinicStatementModalProps> = ({
  isOpen,
  onClose,
  clinicId
}) => {
  const { labs, getLabFinancialSummary, getLedgerEntries, brandingSettings } = useApp();

  const [dateRange, setDateRange] = useState<'all' | 'this_month' | 'last_month' | 'custom'>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const clinic = useMemo(() => {
    return labs.find((l) => l.id === clinicId) || labs[0];
  }, [labs, clinicId]);

  const financialSummary = useMemo(() => {
    if (!clinic) return null;
    return getLabFinancialSummary(clinic.id);
  }, [clinic, getLabFinancialSummary]);

  const rawLedger = useMemo(() => {
    if (!clinic) return [];
    return getLedgerEntries(clinic.id);
  }, [clinic, getLedgerEntries]);

  // Filter ledger by date range
  const filteredLedger = useMemo(() => {
    if (dateRange === 'all') return rawLedger;

    const today = new Date();
    let start: Date;
    let end: Date = new Date();

    if (dateRange === 'this_month') {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (dateRange === 'last_month') {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0);
    } else {
      if (!startDate) return rawLedger;
      start = new Date(startDate);
      if (endDate) end = new Date(endDate);
    }

    return rawLedger.filter((entry) => {
      const entryDate = new Date(entry.date);
      return entryDate >= start && entryDate <= end;
    });
  }, [rawLedger, dateRange, startDate, endDate]);

  const totalDebits = useMemo(() => {
    return filteredLedger.reduce((sum, e) => sum + (e.debit || 0), 0);
  }, [filteredLedger]);

  const totalCredits = useMemo(() => {
    return filteredLedger.reduce((sum, e) => sum + (e.credit || 0), 0);
  }, [filteredLedger]);

  if (!isOpen || !clinic) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    const headers = ['Date', 'Type', 'Reference', 'Description', 'Debit (PKR)', 'Credit (PKR)', 'Running Balance (PKR)'];
    const rows = filteredLedger.map((e) => [
      e.date,
      e.type,
      e.reference_number,
      `"${e.description.replace(/"/g, '""')}"`,
      e.debit || 0,
      e.credit || 0,
      e.running_balance
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Statement_${clinic.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-slate-900/60 backdrop-blur-xs overflow-y-auto print:p-0 print:bg-white">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl xl:max-w-6xl overflow-hidden animate-in fade-in zoom-in-95 my-auto print:shadow-none print:border-none print:m-0 print:max-w-none print-area">
        {/* Modal Controls (Hidden in Print) */}
        <div className="px-6 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Official Statement of Account • {clinic.name}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              Export CSV
            </button>
            <button
              onClick={handlePrint}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center gap-1.5 shadow-xs transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Statement
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filters Bar (Hidden in Print) */}
        <div className="px-6 py-3 bg-white border-b border-slate-200 flex items-center gap-3 text-xs print:hidden">
          <span className="font-semibold text-slate-600">Period:</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setDateRange('all')}
              className={`px-2.5 py-1 rounded-md font-semibold ${
                dateRange === 'all' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              All Time
            </button>
            <button
              onClick={() => setDateRange('this_month')}
              className={`px-2.5 py-1 rounded-md font-semibold ${
                dateRange === 'this_month' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              This Month
            </button>
            <button
              onClick={() => setDateRange('last_month')}
              className={`px-2.5 py-1 rounded-md font-semibold ${
                dateRange === 'last_month' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Last Month
            </button>
          </div>
        </div>

        {/* Printable Statement Document */}
        <div className="p-8 space-y-6 print:p-8" id="printable-statement">
          {/* Statement Header */}
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight uppercase">
                {brandingSettings.lab_name || 'DENTAL SOLUTIONS WORKFLOW'}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Precision Dental Prosthetics & Digital Milling Center
              </p>
              <div className="text-xs text-slate-600 mt-2 space-y-0.5">
                <div>{brandingSettings.address || 'Suite 402, Dental Plaza, Blue Area, Islamabad'}</div>
                <div>Phone: {brandingSettings.phone || '+92 (051) 289-4400'} • Email: accounts@dentalsolutions.pk</div>
              </div>
            </div>

            <div className="text-right">
              <div className="text-lg font-bold text-indigo-700 uppercase tracking-wide">
                STATEMENT OF ACCOUNT
              </div>
              <div className="text-xs text-slate-500 mt-1">Date: {new Date().toISOString().split('T')[0]}</div>
              <div className="text-xs text-slate-500">Account ID: <strong className="font-mono text-slate-900">{clinic.id}</strong></div>
            </div>
          </div>

          {/* Statement To & Summary Cards */}
          <div className="grid grid-cols-2 gap-6 text-xs">
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
              <span className="font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Statement Issued To:
              </span>
              <div className="font-bold text-slate-900 text-sm">{clinic.name}</div>
              {clinic.contact_person && <div className="text-slate-600">Attn: {clinic.contact_person}</div>}
              {clinic.address && <div className="text-slate-600">{clinic.address}</div>}
              {clinic.phone && <div className="text-slate-600">Tel: {clinic.phone}</div>}
            </div>

            <div className="p-4 rounded-lg bg-indigo-50/50 border border-indigo-200 text-right space-y-1.5 flex flex-col justify-center">
              <div className="flex justify-between text-slate-600">
                <span>Period Debits (Invoiced):</span>
                <span className="font-mono font-semibold text-slate-900">{formatPKR(totalDebits)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Period Credits (Settled):</span>
                <span className="font-mono font-semibold text-emerald-700">{formatPKR(totalCredits)}</span>
              </div>
              <div className="border-t border-indigo-200 pt-1.5 flex justify-between font-bold text-slate-900 text-sm">
                <span>Net Outstanding Balance:</span>
                <span className="font-mono text-indigo-700">
                  {formatPKR(financialSummary?.netOutstanding || 0)}
                </span>
              </div>
              {financialSummary && (financialSummary.advanceCreditBalance ?? 0) > 0 && (
                <div className="flex justify-between text-emerald-700 font-medium text-[11px]">
                  <span>Prepaid Advance Credit in Wallet:</span>
                  <span className="font-mono font-bold">+{formatPKR(financialSummary.advanceCreditBalance ?? 0)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Ledger Table */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                  <th className="px-3.5 py-2.5">Date</th>
                  <th className="px-3.5 py-2.5">Type</th>
                  <th className="px-3.5 py-2.5">Reference #</th>
                  <th className="px-3.5 py-2.5">Description</th>
                  <th className="px-3.5 py-2.5 text-right">Debit (PKR)</th>
                  <th className="px-3.5 py-2.5 text-right">Credit (PKR)</th>
                  <th className="px-3.5 py-2.5 text-right">Balance (PKR)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {filteredLedger.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500 font-sans">
                      No statement movements in selected period.
                    </td>
                  </tr>
                ) : (
                  filteredLedger.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-3.5 py-2 text-slate-600 font-sans">{entry.date}</td>
                      <td className="px-3.5 py-2 font-sans capitalize">{entry.type}</td>
                      <td className="px-3.5 py-2 font-bold text-slate-800">{entry.reference_number}</td>
                      <td className="px-3.5 py-2 font-sans text-slate-700">{entry.description}</td>
                      <td className="px-3.5 py-2 text-right font-semibold text-slate-900">
                        {entry.debit > 0 ? formatPKR(entry.debit).replace('PKR ', '') : '—'}
                      </td>
                      <td className="px-3.5 py-2 text-right font-semibold text-emerald-700">
                        {entry.credit > 0 ? formatPKR(entry.credit).replace('PKR ', '') : '—'}
                      </td>
                      <td className="px-3.5 py-2 text-right font-bold text-slate-900">
                        {formatPKR(entry.running_balance).replace('PKR ', '')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-300 font-bold font-mono">
                  <td colSpan={4} className="px-3.5 py-2.5 text-right font-sans text-slate-700">
                    Statement Totals:
                  </td>
                  <td className="px-3.5 py-2.5 text-right text-slate-900">
                    {formatPKR(totalDebits).replace('PKR ', '')}
                  </td>
                  <td className="px-3.5 py-2.5 text-right text-emerald-700">
                    {formatPKR(totalCredits).replace('PKR ', '')}
                  </td>
                  <td className="px-3.5 py-2.5 text-right text-indigo-700">
                    {formatPKR(financialSummary?.netOutstanding || 0).replace('PKR ', '')}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Payment Terms & Bank Remittance Instructions */}
          <div className="border-t border-slate-200 pt-4 grid grid-cols-2 gap-4 text-xs text-slate-600">
            <div>
              <span className="font-bold text-slate-800 block mb-1">Bank Remittance Details:</span>
              <div>Bank: Meezan Bank Limited</div>
              <div>Account Title: Dental Solutions Lab (Pvt) Ltd</div>
              <div>IBAN: PK64 MEZN 0001 2345 6789 0101</div>
              <div>Please email deposit slip to accounts@dentalsolutions.pk with your clinic name.</div>
            </div>

            <div className="text-right">
              <span className="font-bold text-slate-800 block mb-1">Remittance Instructions:</span>
              <div>Please settle outstanding balance within 15 days of statement date.</div>
              <div>For discrepancies or inquiries, call (051) 289-4400.</div>
              <div className="mt-4 text-slate-400 italic">This is an authorized computer-generated statement.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
