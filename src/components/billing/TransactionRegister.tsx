import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { PaymentRecord, AdvancePayment, AccountAdjustment, Invoice, PaymentMethod } from '../../types';
import { DatePickerRange, todayISO } from '../common/DatePickerRange';
import { 
  DollarSign, 
  Wallet, 
  FileCheck2, 
  Search, 
  Filter, 
  Printer, 
  Image as ImageIcon, 
  Building2, 
  Calendar, 
  ArrowUpRight, 
  ArrowDownLeft, 
  PlusCircle, 
  RotateCcw,
  Receipt,
  Download,
  Scale,
  ArrowLeftRight
} from 'lucide-react';

export type UnifiedTransactionType = 'payment' | 'advance' | 'adjustment';

export interface UnifiedTransaction {
  id: string;
  sourceType: UnifiedTransactionType;
  txnNumber: string;
  date: string;
  labId: string;
  labName: string;
  category: string;
  detail: string;
  referenceNumber?: string;
  method?: string;
  amount: number;
  direction: 'inflow' | 'credit' | 'debit' | 'refund';
  recordedBy: string;
  hasAttachments: boolean;
  attachmentsCount: number;
  rawPayment?: PaymentRecord;
  rawAdvance?: AdvancePayment;
  rawAdjustment?: AccountAdjustment;
  invoiceId?: string;
  invoiceNumber?: string;
  caseNumber?: string;
  isReversed?: boolean;
  reversalReason?: string;
}

interface TransactionRegisterProps {
  onOpenPaymentModal: (invoice?: Invoice | null, labId?: string) => void;
  onOpenAdvanceModal: (labId?: string) => void;
  onOpenAdjustmentModal: (labId?: string) => void;
  onViewProof: (payment: PaymentRecord) => void;
  onPrintReceipt: (payment: PaymentRecord, invoice?: Invoice) => void;
  onReverseTransaction?: (target: {
    referenceType: 'payment' | 'advance_payment' | 'adjustment';
    referenceId: string;
    referenceNumber: string;
    amount: number;
    labName: string;
    date: string;
    details?: string;
  }) => void;
  onOpenJournalModal?: (referenceId: string) => void;
}

export const TransactionRegister: React.FC<TransactionRegisterProps> = ({
  onOpenPaymentModal,
  onOpenAdvanceModal,
  onOpenAdjustmentModal,
  onViewProof,
  onPrintReceipt,
  onReverseTransaction,
  onOpenJournalModal
}) => {
  const { 
    allPayments, 
    advancePayments, 
    accountAdjustments, 
    invoices, 
    labs 
  } = useApp();

  const [categoryFilter, setCategoryFilter] = useState<'all' | 'payment' | 'advance' | 'adjustment'>('all');
  const [selectedLabId, setSelectedLabId] = useState<string>('all');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  // This tab is the daily working surface: entries made TODAY by default;
  // the enhanced date-range picker rewinds to any previous day/range.
  const today = todayISO();
  const [fromDate, setFromDate] = useState<string>(today);
  const [toDate, setToDate] = useState<string>(today);

  // Map and unify all financial transactions into a single feed
  const unifiedTransactions = useMemo<UnifiedTransaction[]>(() => {
    const list: UnifiedTransaction[] = [];

    // 1. Invoice Payments
    allPayments.forEach((pay) => {
      const matchedInv = invoices.find((i) => i.id === pay.invoice_id || i.invoice_number === pay.invoice_number);
      const isAdvanceAlloc = pay.payment_method === 'advance';
      list.push({
        id: pay.id,
        sourceType: 'payment',
        txnNumber: pay.payment_number || 'PAY-RCPT',
        date: pay.payment_date,
        labId: pay.lab_id || matchedInv?.lab_id || '',
        labName: pay.lab_name || matchedInv?.lab_name || 'Dental Clinic',
        category: isAdvanceAlloc ? 'Advance Credit Settlement' : 'Invoice Payment',
        detail: `Invoice ${pay.invoice_number || matchedInv?.invoice_number || ''} ${matchedInv?.case_number ? `(Case #${matchedInv.case_number})` : ''}`,
        referenceNumber: pay.reference_number,
        method: pay.payment_method,
        amount: pay.amount,
        direction: 'inflow',
        recordedBy: pay.recorded_by || 'Staff',
        hasAttachments: !!pay.attachments && pay.attachments.length > 0,
        attachmentsCount: pay.attachments?.length || 0,
        rawPayment: pay,
        invoiceId: pay.invoice_id,
        invoiceNumber: pay.invoice_number || matchedInv?.invoice_number,
        caseNumber: matchedInv?.case_number,
        isReversed: pay.is_reversed,
        reversalReason: pay.reversal_reason
      });
    });

    // 2. Advance Deposits
    advancePayments.forEach((adv) => {
      list.push({
        id: adv.id,
        sourceType: 'advance',
        txnNumber: adv.payment_number,
        date: adv.payment_date,
        labId: adv.lab_id,
        labName: adv.lab_name,
        category: 'Advance Deposit',
        detail: `Remaining Credit: PKR ${(adv.remaining_amount || 0).toLocaleString()}`,
        referenceNumber: adv.reference_number,
        method: adv.payment_method,
        amount: adv.amount,
        direction: 'inflow',
        recordedBy: adv.recorded_by || 'Staff',
        hasAttachments: !!adv.attachments && adv.attachments.length > 0,
        attachmentsCount: adv.attachments?.length || 0,
        rawAdvance: adv,
        isReversed: adv.is_reversed,
        reversalReason: adv.reversal_reason
      });
    });

    // 3. Account Adjustments
    accountAdjustments.forEach((adj) => {
      let catLabel = 'Credit Note';
      let dir: 'credit' | 'debit' | 'refund' = 'credit';
      if (adj.type === 'debit_adjustment') {
        catLabel = 'Debit Surcharge';
        dir = 'debit';
      } else if (adj.type === 'refund') {
        catLabel = 'Customer Refund';
        dir = 'refund';
      }

      list.push({
        id: adj.id,
        sourceType: 'adjustment',
        txnNumber: adj.adjustment_number,
        date: adj.date,
        labId: adj.lab_id,
        labName: adj.lab_name,
        category: catLabel,
        detail: adj.reason,
        referenceNumber: adj.reference_number,
        method: 'Adjustment',
        amount: adj.amount,
        direction: dir,
        recordedBy: adj.recorded_by || 'Staff',
        hasAttachments: !!adj.attachments && adj.attachments.length > 0,
        attachmentsCount: adj.attachments?.length || 0,
        rawAdjustment: adj,
        isReversed: adj.is_reversed,
        reversalReason: adj.reversal_reason
      });
    });

    // Sort descending by date
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [allPayments, advancePayments, accountAdjustments, invoices]);

  // Filtered transactions
  const filteredTransactions = useMemo(() => {
    return unifiedTransactions.filter((txn) => {
      // Date range (YYYY-MM-DD compare works even on 'YYYY-MM-DD HH:mm' values)
      const day = txn.date.slice(0, 10);
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;

      // Category filter
      if (categoryFilter !== 'all' && txn.sourceType !== categoryFilter) {
        return false;
      }

      // Clinic filter
      if (selectedLabId !== 'all' && txn.labId !== selectedLabId) {
        return false;
      }

      // Method filter
      if (methodFilter !== 'all') {
        if (!txn.method || txn.method.toLowerCase() !== methodFilter.toLowerCase()) {
          return false;
        }
      }

      // Search term
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchTxn = txn.txnNumber.toLowerCase().includes(q);
        const matchLab = txn.labName.toLowerCase().includes(q);
        const matchRef = (txn.referenceNumber || '').toLowerCase().includes(q);
        const matchDetail = txn.detail.toLowerCase().includes(q);
        const matchStaff = txn.recordedBy.toLowerCase().includes(q);
        if (!matchTxn && !matchLab && !matchRef && !matchDetail && !matchStaff) {
          return false;
        }
      }

      return true;
    });
  }, [unifiedTransactions, categoryFilter, selectedLabId, methodFilter, searchTerm, fromDate, toDate]);

  // Handle Export CSV
  const handleExportCSV = () => {
    const headers = ['Transaction #', 'Date', 'Dental Clinic', 'Type / Category', 'Detail / Notes', 'Method', 'Reference #', 'Amount (PKR)', 'Staff'];
    const rows = filteredTransactions.map(t => [
      `"${t.txnNumber}"`,
      `"${t.date}"`,
      `"${t.labName}"`,
      `"${t.category}"`,
      `"${t.detail.replace(/"/g, '""')}"`,
      `"${t.method || ''}"`,
      `"${t.referenceNumber || ''}"`,
      t.amount,
      `"${t.recordedBy}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Dental_Solutions_Transactions_${new Date().toISOString().substring(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">

      {/* Control Strip & Sub-Filters */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs space-y-3">
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          
          {/* Sub-Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 no-scrollbar pb-1 md:pb-0">
            {[
              { id: 'all', label: 'All Transactions', count: unifiedTransactions.length },
              { id: 'payment', label: 'Invoice Payments', count: allPayments.length },
              { id: 'advance', label: 'Advance Deposits', count: advancePayments.length },
              { id: 'adjustment', label: 'Adjustments & Notes', count: accountAdjustments.length },
            ].map((sub) => {
              const isActive = categoryFilter === sub.id;
              return (
                <button
                  key={sub.id}
                  onClick={() => setCategoryFilter(sub.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                    isActive
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <span>{sub.label}</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    isActive ? 'bg-slate-800 text-slate-200' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {sub.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Date Range (defaults to today — rewind to view previous entries) */}
          <div className="flex items-center gap-2 shrink-0">
            <DatePickerRange
              from={fromDate}
              to={toDate}
              onChange={(f, t) => {
                setFromDate(f);
                setToDate(t);
              }}
            />

            <button
              onClick={handleExportCSV}
              className="p-1.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-lg shadow-2xs transition-colors cursor-pointer"
              title="Export Transactions CSV"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>

        </div>

        {/* Filter inputs row */}
        <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search receipt #, clinic, ref #, remarks..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
            />
          </div>

          {/* Dental Clinic Filter */}
          <div className="relative">
            <Building2 className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={selectedLabId}
              onChange={(e) => setSelectedLabId(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all appearance-none"
            >
              <option value="all">All Dental Clinics ({labs.length})</option>
              {labs.map((lab) => (
                <option key={lab.id} value={lab.id}>{lab.name}</option>
              ))}
            </select>
          </div>

          {/* Method Filter */}
          <div className="relative">
            <Filter className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all appearance-none"
            >
              <option value="all">All Payment Methods</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank Transfer (IBFT)</option>
              <option value="cheque">Cheque</option>
              <option value="advance">Clinic Advance Credit</option>
            </select>
          </div>
        </div>

      </div>

      {/* Unified Transactions Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
        {filteredTransactions.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">
            No transactions found matching the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-bold uppercase text-[10px] text-slate-500 tracking-wider">
                  <th className="py-3 px-4">Txn / Receipt #</th>
                  <th className="py-3 px-3">Date</th>
                  <th className="py-3 px-3">Dental Clinic</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3">Detail & Notes</th>
                  <th className="py-3 px-3">Method & Ref #</th>
                  <th className="py-3 px-3 text-right">Amount (PKR)</th>
                  <th className="py-3 px-3 text-center">Proof Slip</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredTransactions.map((txn) => {
                  const isPayment = txn.sourceType === 'payment';
                  const isAdvance = txn.sourceType === 'advance';
                  const isAdjustment = txn.sourceType === 'adjustment';

                  return (
                    <tr key={`${txn.sourceType}-${txn.id}`} className={`hover:bg-slate-50/80 transition-colors ${txn.isReversed ? 'bg-red-50/40 opacity-75' : ''}`}>
                      
                      {/* Transaction # */}
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{txn.txnNumber}</span>
                          {txn.isReversed && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-100 text-rose-700 uppercase tracking-tight">
                              REVERSED
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Date */}
                      <td className="py-3 px-3 text-slate-600 whitespace-nowrap">
                        {txn.date}
                      </td>

                      {/* Clinic Name */}
                      <td className="py-3 px-3 font-semibold text-slate-900">
                        {txn.labName}
                      </td>

                      {/* Category Badge */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {isPayment && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <DollarSign className="w-3 h-3" />
                            <span>{txn.category}</span>
                          </span>
                        )}
                        {isAdvance && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            <Wallet className="w-3 h-3" />
                            <span>Advance Deposit</span>
                          </span>
                        )}
                        {isAdjustment && (
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            txn.direction === 'credit'
                              ? 'bg-purple-50 text-purple-700 border border-purple-200'
                              : txn.direction === 'debit'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}>
                            <FileCheck2 className="w-3 h-3" />
                            <span>{txn.category}</span>
                          </span>
                        )}
                      </td>

                      {/* Detail & Staff */}
                      <td className="py-3 px-3 text-slate-600 max-w-xs">
                        <p className="font-medium text-slate-800 line-clamp-1">{txn.detail}</p>
                        <p className="text-[10px] text-slate-400">By {txn.recordedBy}</p>
                      </td>

                      {/* Method & Ref */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            txn.method === 'cash'
                              ? 'bg-emerald-100 text-emerald-800'
                              : txn.method === 'bank'
                              ? 'bg-blue-100 text-blue-800'
                              : txn.method === 'cheque'
                              ? 'bg-slate-100 text-slate-800'
                              : txn.method === 'advance'
                              ? 'bg-indigo-100 text-indigo-800'
                              : 'bg-purple-100 text-purple-800'
                          }`}>
                            {txn.method || '—'}
                          </span>
                          {txn.referenceNumber && (
                            <span className="font-mono text-[10px] text-slate-500">
                              #{txn.referenceNumber}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Amount */}
                      <td className="py-3 px-3 text-right font-bold whitespace-nowrap">
                        <span className={
                          txn.direction === 'inflow'
                            ? 'text-emerald-600'
                            : txn.direction === 'credit'
                            ? 'text-purple-700'
                            : txn.direction === 'debit'
                            ? 'text-amber-700'
                            : 'text-rose-600'
                        }>
                          PKR {(txn.amount || 0).toLocaleString()}
                        </span>
                      </td>

                      {/* Proof Slip Attachment */}
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        {txn.hasAttachments ? (
                          <button
                            onClick={() => {
                              if (txn.rawPayment) {
                                onViewProof(txn.rawPayment);
                              } else if (txn.rawAdvance) {
                                onViewProof({
                                  id: txn.rawAdvance.id,
                                  payment_number: txn.rawAdvance.payment_number,
                                  invoice_id: '',
                                  lab_id: txn.rawAdvance.lab_id,
                                  lab_name: txn.rawAdvance.lab_name,
                                  amount: txn.rawAdvance.amount,
                                  payment_method: txn.rawAdvance.payment_method,
                                  payment_date: txn.rawAdvance.payment_date,
                                  reference_number: txn.rawAdvance.reference_number,
                                  notes: txn.rawAdvance.notes,
                                  attachments: txn.rawAdvance.attachments,
                                  recorded_by: txn.rawAdvance.recorded_by
                                });
                              } else if (txn.rawAdjustment) {
                                onViewProof({
                                  id: txn.rawAdjustment.id,
                                  payment_number: txn.rawAdjustment.adjustment_number,
                                  invoice_id: '',
                                  lab_id: txn.rawAdjustment.lab_id,
                                  lab_name: txn.rawAdjustment.lab_name,
                                  amount: txn.rawAdjustment.amount,
                                  payment_method: 'cash',
                                  payment_date: txn.rawAdjustment.date,
                                  reference_number: txn.rawAdjustment.reference_number,
                                  notes: txn.rawAdjustment.reason,
                                  attachments: txn.rawAdjustment.attachments,
                                  recorded_by: txn.rawAdjustment.recorded_by
                                });
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded text-[10px] transition-colors cursor-pointer"
                          >
                            <ImageIcon className="w-3.5 h-3.5" />
                            <span>{txn.attachmentsCount} Slip{txn.attachmentsCount > 1 ? 's' : ''}</span>
                          </button>
                        ) : (
                          <span className="text-slate-300 text-[11px]">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {isPayment && txn.rawPayment && (
                            <button
                              onClick={() => {
                                const matchedInv = invoices.find(i => i.id === txn.invoiceId || i.invoice_number === txn.invoiceNumber);
                                onPrintReceipt(txn.rawPayment!, matchedInv);
                              }}
                              className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-2xs flex items-center gap-1 transition-all cursor-pointer"
                              title="Print Official Payment Slip"
                            >
                              <Printer className="w-3 h-3 text-slate-500" />
                              <span>Receipt</span>
                            </button>
                          )}

                          {/* Inspect Double-Entry Journal */}
                          {onOpenJournalModal && (
                            <button
                              type="button"
                              onClick={() => onOpenJournalModal(txn.txnNumber || txn.referenceNumber || '')}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                              title="Inspect Double-Entry Journal Records"
                            >
                              <Scale className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Audit-Compliant Reversal (the only removal path — no silent deletes) */}
                          {!txn.isReversed && onReverseTransaction ? (
                            <button
                              type="button"
                              onClick={() => {
                                onReverseTransaction({
                                  referenceType: txn.sourceType === 'payment' ? 'payment' : txn.sourceType === 'advance' ? 'advance_payment' : 'adjustment',
                                  referenceId: txn.id,
                                  referenceNumber: txn.txnNumber,
                                  amount: txn.amount,
                                  labName: txn.labName,
                                  date: txn.date,
                                  details: txn.detail
                                });
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              title="Reverse Transaction (Compensating Journal)"
                            >
                              <ArrowLeftRight className="w-3.5 h-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};
