import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { LedgerEntry, PaymentRecord, Invoice, PaymentMethod } from '../../types';
import { PaymentProofModal } from './PaymentProofModal';
import { PaymentReceiptModal } from './PaymentReceiptModal';
import { InvoiceStatementModal } from './InvoiceStatementModal';
import { 
  BookOpen, 
  Search, 
  Download, 
  Printer, 
  Filter, 
  DollarSign, 
  Landmark, 
  FileCheck, 
  Receipt, 
  Image as ImageIcon, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Eye, 
  Building2,
  Calendar,
  CheckCircle2,
  Layers,
  FileText
} from 'lucide-react';

export const LedgerView: React.FC = () => {
  const { labs, invoices, cases, getLedgerEntries, allPayments, brandingSettings, getLabFinancialSummary } = useApp();

  const [selectedLabId, setSelectedLabId] = useState<string>('all');
  const [entryTypeFilter, setEntryTypeFilter] = useState<'all' | 'invoice' | 'payment' | 'advance_payment' | 'advance_allocation' | 'credit_note' | 'debit_adjustment' | 'refund'>('all');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals state
  const [selectedProofPayment, setSelectedProofPayment] = useState<PaymentRecord | null>(null);
  const [selectedReceiptPayment, setSelectedReceiptPayment] = useState<{ payment: PaymentRecord; invoice?: Invoice } | null>(null);
  const [selectedInvoiceModal, setSelectedInvoiceModal] = useState<Invoice | null>(null);

  // Derive ledger entries based on lab selection
  const rawLedger = useMemo(() => {
    return getLedgerEntries(selectedLabId === 'all' ? undefined : selectedLabId);
  }, [getLedgerEntries, selectedLabId]);

  // Filter ledger entries
  const filteredLedger = useMemo(() => {
    return rawLedger.filter((entry) => {
      // Entry Type Filter
      if (entryTypeFilter !== 'all' && entry.entry_type !== entryTypeFilter) {
        return false;
      }

      // Method Filter for payments/advance
      if (methodFilter !== 'all') {
        if ((entry.entry_type === 'payment' || entry.entry_type === 'advance_payment') && entry.payment_method !== methodFilter) {
          return false;
        }
        if (entry.entry_type !== 'payment' && entry.entry_type !== 'advance_payment') {
          return false;
        }
      }

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchRef = (entry.reference_number || '').toLowerCase().includes(q);
        const matchCase = (entry.case_number || '').toLowerCase().includes(q);
        const matchLab = (entry.lab_name || '').toLowerCase().includes(q);
        const matchDoc = (entry.doctor_name || '').toLowerCase().includes(q);
        const matchDesc = (entry.description || '').toLowerCase().includes(q);
        const matchNotes = (entry.notes || '').toLowerCase().includes(q);
        if (!matchRef && !matchCase && !matchLab && !matchDoc && !matchDesc && !matchNotes) {
          return false;
        }
      }

      return true;
    });
  }, [rawLedger, entryTypeFilter, methodFilter, searchQuery]);

  // Aggregate Metrics for currently filtered lab or all labs
  const summaryMetrics = useMemo(() => {
    let totalInvoiced = 0;
    let totalPaid = 0;
    let cashPaid = 0;
    let bankPaid = 0;
    let chequePaid = 0;
    let totalAdvance = 0;
    let totalCreditNotes = 0;

    rawLedger.forEach((entry) => {
      if (entry.entry_type === 'invoice') {
        totalInvoiced += entry.debit;
      } else if (entry.entry_type === 'payment') {
        totalPaid += entry.credit;
        if (entry.payment_method === 'cash') cashPaid += entry.credit;
        else if (entry.payment_method === 'bank') bankPaid += entry.credit;
        else if (entry.payment_method === 'cheque') chequePaid += entry.credit;
      } else if (entry.entry_type === 'advance_payment') {
        totalAdvance += entry.credit;
      } else if (entry.entry_type === 'credit_note') {
        totalCreditNotes += entry.credit;
      }
    });

    const labFin = selectedLabId !== 'all' ? getLabFinancialSummary(selectedLabId) : null;
    const availableAdvance = labFin ? labFin.available_advance : 0;
    const netReceivables = rawLedger.length > 0 ? rawLedger[rawLedger.length - 1].running_balance : 0;

    return {
      totalInvoiced,
      totalPaid,
      totalAdvance,
      totalCreditNotes,
      availableAdvance,
      netReceivables,
      cashPaid,
      bankPaid,
      chequePaid,
      totalEntries: rawLedger.length
    };
  }, [rawLedger, selectedLabId, getLabFinancialSummary]);

  // Export CSV
  const handleExportCSV = () => {
    const headers = [
      'Date',
      'Dental Clinic',
      'Type',
      'Reference #',
      'Case #',
      'Doctor',
      'Description',
      'Debit (PKR)',
      'Credit (PKR)',
      'Running Balance (PKR)',
      'Payment Method',
      'Notes'
    ];

    const rows = filteredLedger.map((entry) => [
      `"${entry.date}"`,
      `"${entry.lab_name}"`,
      `"${entry.entry_type.toUpperCase()}"`,
      `"${entry.reference_number}"`,
      `"${entry.case_number || ''}"`,
      `"${entry.doctor_name || ''}"`,
      `"${(entry.description || '').replace(/"/g, '""')}"`,
      entry.debit,
      entry.credit,
      entry.running_balance,
      `"${entry.payment_method || ''}"`,
      `"${(entry.notes || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const labNameStr = selectedLabId === 'all' ? 'All_Labs' : labs.find((l) => l.id === selectedLabId)?.name.replace(/[^a-zA-Z0-9]/g, '_') || 'Lab';
    link.href = url;
    link.download = `Dental_Solutions_Ledger_${labNameStr}_${new Date().toISOString().substring(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrintStatement = () => {
    window.print();
  };

  return (
    <div className="space-y-6 print-page">
      
      {/* Top Header & Export Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">Clinic Accounts & Cash Flow Ledger</h2>
              <p className="text-xs text-slate-500">
                Double-entry transaction book • Invoices, payments, advance deposits, and credit notes with verified proof attachments
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 print:hidden">
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer"
            title="Export full ledger statement to CSV"
          >
            <Download className="w-4 h-4 text-slate-500" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={handlePrintStatement}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
            title="Print printable statement report"
          >
            <Printer className="w-4 h-4" />
            <span>Print Ledger</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Invoiced (Debits) */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span className="font-bold uppercase tracking-wider text-[10px]">Total Billed (Debits)</span>
            <span className="p-1 bg-indigo-50 text-indigo-600 rounded-md">
              <ArrowUpRight className="w-3.5 h-3.5" />
            </span>
          </div>
          <p className="text-xl font-bold text-slate-900">
            PKR {summaryMetrics.totalInvoiced.toLocaleString()}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            {selectedLabId === 'all' ? 'Across all dental clinics' : 'Lifetime clinic case charges'}
          </p>
        </div>

        {/* Total Collected (Credits) */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span className="font-bold uppercase tracking-wider text-[10px]">Total Collections & Advance</span>
            <span className="p-1 bg-emerald-50 text-emerald-600 rounded-md">
              <ArrowDownLeft className="w-3.5 h-3.5" />
            </span>
          </div>
          <p className="text-xl font-bold text-emerald-600">
            PKR {(summaryMetrics.totalPaid + summaryMetrics.totalAdvance).toLocaleString()}
          </p>
          <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1">
            <span>Direct: <strong className="text-slate-700">PKR {summaryMetrics.totalPaid.toLocaleString()}</strong></span>
            <span>•</span>
            <span>Advance: <strong className="text-slate-700">PKR {summaryMetrics.totalAdvance.toLocaleString()}</strong></span>
          </div>
        </div>

        {/* Available Advance Credit or Net Balance */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span className="font-bold uppercase tracking-wider text-[10px]">
              {selectedLabId !== 'all' ? 'Available Advance Credit' : 'Total Advance Deposits'}
            </span>
            <span className="p-1 bg-blue-50 text-blue-600 rounded-md">
              <DollarSign className="w-3.5 h-3.5" />
            </span>
          </div>
          <p className="text-xl font-bold text-blue-600">
            PKR {(selectedLabId !== 'all' ? (summaryMetrics.availableAdvance ?? 0) : (summaryMetrics.totalAdvance ?? 0)).toLocaleString()}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            {selectedLabId !== 'all' ? 'Unallocated credit balance' : 'Total advance logged'}
          </p>
        </div>

        {/* Net Outstanding Receivables */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span className="font-bold uppercase tracking-wider text-[10px]">Net Ledger Balance</span>
            <span className={`p-1 rounded-md ${summaryMetrics.netReceivables > 0 ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
              <Receipt className="w-3.5 h-3.5" />
            </span>
          </div>
          <p className={`text-xl font-bold ${summaryMetrics.netReceivables > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
            PKR {summaryMetrics.netReceivables.toLocaleString()}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            {summaryMetrics.netReceivables > 0 ? 'Receivable from clinic(s)' : 'All accounts settled clean'}
          </p>
        </div>

      </div>

      {/* Filter Control Bar */}
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-2xs space-y-3 print:hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          {/* Clinic Selector */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
              <Building2 className="w-3 h-3 text-slate-400" />
              <span>Dental Clinic Account</span>
            </label>
            <select
              value={selectedLabId}
              onChange={(e) => setSelectedLabId(e.target.value)}
              className="w-full px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 focus:bg-white transition-all text-slate-800"
            >
              <option value="all">All Clinics (Consolidated Ledger)</option>
              {labs.map((lab) => (
                <option key={lab.id} value={lab.id}>
                  {lab.name}
                </option>
              ))}
            </select>
          </div>

          {/* Entry Type Filter */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
              <Filter className="w-3 h-3 text-slate-400" />
              <span>Transaction Type</span>
            </label>
            <select
              value={entryTypeFilter}
              onChange={(e) => setEntryTypeFilter(e.target.value as any)}
              className="w-full px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 focus:bg-white transition-all text-slate-800"
            >
              <option value="all">All Transactions (Debits & Credits)</option>
              <option value="invoice">Invoices (Debits +)</option>
              <option value="payment">Payments Collected (Credits -)</option>
              <option value="advance_payment">Advance Deposits (Credits -)</option>
              <option value="advance_allocation">Advance Allocated (Credits -)</option>
              <option value="credit_note">Credit Notes (Credits -)</option>
              <option value="debit_adjustment">Debit Surcharges (Debits +)</option>
              <option value="refund">Refunds Disbursed (Debits +)</option>
            </select>
          </div>

          {/* Payment Method Filter */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
              <DollarSign className="w-3 h-3 text-slate-400" />
              <span>Payment Mode</span>
            </label>
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 focus:bg-white transition-all text-slate-800"
            >
              <option value="all">All Payment Methods</option>
              <option value="cash">Cash Received</option>
              <option value="bank">Bank Transfer (Online / Meezan / HBL)</option>
              <option value="cheque">Cheque Clearing</option>
            </select>
          </div>

          {/* Search Query */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
              <Search className="w-3 h-3 text-slate-400" />
              <span>Search Entries</span>
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search ref #, case #, doctor, note..."
                className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 focus:bg-white transition-all text-slate-800"
              />
            </div>
          </div>

        </div>
      </div>

      {/* Printable Statement Header (Visible only when printing) */}
      <div className="hidden print:block p-4 border-b-2 border-slate-900 mb-4 text-slate-900 print-flow">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-bold">{brandingSettings.appName || 'DENTAL SOLUTIONS'}</h1>
            <p className="text-xs text-slate-600">{brandingSettings.tagline}</p>
            <p className="text-[11px] text-slate-500">{brandingSettings.address} • Ph: {brandingSettings.phone}</p>
          </div>
          <div className="text-right">
            <h2 className="text-base font-bold">STATEMENT OF ACCOUNT / LEDGER</h2>
            <p className="text-xs text-slate-600">
              Clinic: {selectedLabId === 'all' ? 'All Dental Clinics' : labs.find((l) => l.id === selectedLabId)?.name}
            </p>
            <p className="text-xs text-slate-500">Generated: {new Date().toISOString().replace('T', ' ').substring(0, 16)}</p>
          </div>
        </div>
      </div>

      {/* Double-Entry Ledger Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs print-flow">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-500 uppercase text-[10px] tracking-wider">
                <th className="py-3 px-3.5">Date</th>
                <th className="py-3 px-3">Dental Clinic</th>
                <th className="py-3 px-3">Type</th>
                <th className="py-3 px-3">Ref #</th>
                <th className="py-3 px-3">Case / Doctor</th>
                <th className="py-3 px-3 min-w-[200px]">Particulars / Remarks</th>
                <th className="py-3 px-3 text-right">Debit (PKR)</th>
                <th className="py-3 px-3 text-right">Credit (PKR)</th>
                <th className="py-3 px-3.5 text-right font-bold">Balance (PKR)</th>
                <th className="py-3 px-3 text-center print:hidden">Proof</th>
                <th className="py-3 px-3 text-center print:hidden">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLedger.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-400 text-xs">
                    No ledger transactions matching the selected filters.
                  </td>
                </tr>
              ) : (
                filteredLedger.map((entry) => {
                  const isDebit = entry.debit > 0;
                  const isCredit = entry.credit > 0;

                  // Match payment object if available
                  const matchedPayment = entry.entry_type === 'payment' ? allPayments.find((p) => p.id === entry.reference_id || p.payment_number === entry.reference_number) : undefined;
                  const matchedInvoice = entry.entry_type === 'invoice' ? invoices.find((i) => i.id === entry.reference_id || i.invoice_number === entry.reference_number) : invoices.find((i) => (matchedPayment?.invoice_id && i.id === matchedPayment.invoice_id) || (matchedPayment?.invoice_number && i.invoice_number === matchedPayment.invoice_number));

                  // Render badge for entry type
                  const renderTypeBadge = () => {
                    switch (entry.entry_type) {
                      case 'invoice':
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            <ArrowUpRight className="w-3 h-3" />
                            <span>Invoice</span>
                          </span>
                        );
                      case 'payment':
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <ArrowDownLeft className="w-3 h-3" />
                            <span className="capitalize">{entry.payment_method || 'Payment'}</span>
                          </span>
                        );
                      case 'advance_payment':
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                            <ArrowDownLeft className="w-3 h-3" />
                            <span>Advance Deposit</span>
                          </span>
                        );
                      case 'advance_allocation':
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-50 text-cyan-700 border border-cyan-200">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Advance Applied</span>
                          </span>
                        );
                      case 'credit_note':
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                            <ArrowDownLeft className="w-3 h-3" />
                            <span>Credit Note</span>
                          </span>
                        );
                      case 'debit_adjustment':
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            <ArrowUpRight className="w-3 h-3" />
                            <span>Debit Surcharge</span>
                          </span>
                        );
                      case 'refund':
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            <ArrowUpRight className="w-3 h-3" />
                            <span>Refund</span>
                          </span>
                        );
                      default:
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-50 text-slate-700 border border-slate-200">
                            <span>{entry.entry_type}</span>
                          </span>
                        );
                    }
                  };

                  return (
                    <tr key={entry.id} className="hover:bg-slate-50/70 transition-colors">
                      
                      {/* Date */}
                      <td className="py-3 px-3.5 text-slate-600 whitespace-nowrap font-medium">
                        {entry.date}
                      </td>

                      {/* Lab Name */}
                      <td className="py-3 px-3 font-semibold text-slate-900 whitespace-nowrap">
                        {entry.lab_name}
                      </td>

                      {/* Type Badge */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {renderTypeBadge()}
                      </td>

                      {/* Reference # */}
                      <td className="py-3 px-3 font-mono font-bold text-slate-800 whitespace-nowrap">
                        {entry.reference_number}
                      </td>

                      {/* Case & Doctor */}
                      <td className="py-3 px-3 text-slate-600 whitespace-nowrap">
                        {entry.case_number ? (
                          <div>
                            <span className="font-semibold text-slate-800">{entry.case_number}</span>
                            {entry.doctor_name && <span className="text-slate-400 text-[11px] block">{entry.doctor_name}</span>}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Description & Remarks */}
                      <td className="py-3 px-3 text-slate-700">
                        <p className="line-clamp-1">{entry.description}</p>
                        {entry.notes && (
                          <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{entry.notes}</p>
                        )}
                      </td>

                      {/* Debit Column */}
                      <td className="py-3 px-3 text-right font-bold text-indigo-600 whitespace-nowrap">
                        {entry.debit > 0 ? `PKR ${(entry.debit || 0).toLocaleString()}` : '—'}
                      </td>

                      {/* Credit Column */}
                      <td className="py-3 px-3 text-right font-bold text-emerald-600 whitespace-nowrap">
                        {entry.credit > 0 ? `PKR ${(entry.credit || 0).toLocaleString()}` : '—'}
                      </td>

                      {/* Running Balance */}
                      <td className={`py-3 px-3.5 text-right font-bold whitespace-nowrap ${entry.running_balance > 0 ? 'text-slate-900' : 'text-emerald-600'}`}>
                        PKR {(entry.running_balance || 0).toLocaleString()}
                      </td>

                      {/* Proof Attachments Indicator */}
                      <td className="py-3 px-3 text-center whitespace-nowrap print:hidden">
                        {(entry.attachments && entry.attachments.length > 0) || (matchedPayment?.attachments && matchedPayment.attachments.length > 0) ? (
                          <button
                            onClick={() => {
                              const payObj = matchedPayment || {
                                id: entry.reference_id,
                                payment_number: entry.reference_number,
                                invoice_id: '',
                                invoice_number: '',
                                amount: entry.credit,
                                payment_method: entry.payment_method || 'bank',
                                payment_date: entry.date,
                                recorded_by: entry.recorded_by || 'Staff',
                                attachments: entry.attachments || []
                              };
                              setSelectedProofPayment(payObj);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
                            title="View attached payment receipts"
                          >
                            <ImageIcon className="w-3 h-3" />
                            <span>{(entry.attachments || matchedPayment?.attachments || []).length} Proof</span>
                          </button>
                        ) : (
                          <span className="text-slate-300 text-[11px]">—</span>
                        )}
                      </td>

                      {/* Action Menu */}
                      <td className="py-3 px-3 text-center whitespace-nowrap print:hidden">
                        <div className="flex items-center justify-center gap-1.5">
                          {isDebit && matchedInvoice && (
                            <button
                              onClick={() => setSelectedInvoiceModal(matchedInvoice)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                              title="View Invoice Statement"
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {isCredit && (
                            <button
                              onClick={() => {
                                const payObj = matchedPayment || {
                                  id: entry.reference_id,
                                  payment_number: entry.reference_number,
                                  invoice_id: matchedInvoice?.id || '',
                                  invoice_number: matchedInvoice?.invoice_number || '',
                                  case_id: matchedInvoice?.case_id || '',
                                  case_number: entry.case_number || matchedInvoice?.case_number,
                                  lab_id: entry.lab_id,
                                  lab_name: entry.lab_name,
                                  amount: entry.credit,
                                  payment_method: entry.payment_method || 'cash',
                                  payment_date: entry.date,
                                  notes: entry.notes,
                                  recorded_by: entry.recorded_by || 'Staff',
                                  attachments: entry.attachments || []
                                };
                                setSelectedReceiptPayment({ payment: payObj, invoice: matchedInvoice });
                              }}
                              className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                              title="Print Official Payment Receipt"
                            >
                              <Receipt className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
            {/* Table Footer Totals */}
            {filteredLedger.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50/90 border-t-2 border-slate-200 font-bold text-xs">
                  <td colSpan={6} className="py-3 px-3.5 text-slate-700">
                    Total Filtered Period Summary:
                  </td>
                  <td className="py-3 px-3 text-right text-indigo-700 font-bold">
                    PKR {filteredLedger.reduce((sum, e) => sum + e.debit, 0).toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right text-emerald-700 font-bold">
                    PKR {filteredLedger.reduce((sum, e) => sum + e.credit, 0).toLocaleString()}
                  </td>
                  <td className="py-3 px-3.5 text-right text-slate-900 font-bold">
                    {filteredLedger[0] ? `PKR ${filteredLedger[0].running_balance.toLocaleString()}` : '—'}
                  </td>
                  <td colSpan={2} className="print:hidden"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Payment Proof Modal */}
      {selectedProofPayment && (
        <PaymentProofModal
          payment={selectedProofPayment}
          onClose={() => setSelectedProofPayment(null)}
        />
      )}

      {/* Payment Receipt Voucher Modal */}
      {selectedReceiptPayment && (
        <PaymentReceiptModal
          payment={selectedReceiptPayment.payment}
          invoice={selectedReceiptPayment.invoice}
          onClose={() => setSelectedReceiptPayment(null)}
        />
      )}

      {/* Invoice Statement Modal */}
      {selectedInvoiceModal && (
        <InvoiceStatementModal
          invoice={selectedInvoiceModal}
          caseData={cases.find((c) => c.id === selectedInvoiceModal.case_id || c.case_number === selectedInvoiceModal.case_number)}
          onClose={() => setSelectedInvoiceModal(null)}
        />
      )}

    </div>
  );
};
