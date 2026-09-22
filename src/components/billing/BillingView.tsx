import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Invoice, PaymentRecord } from '../../types';
import { InvoiceStatementModal } from './InvoiceStatementModal';
import { CaseJobSlipModal } from '../cases/CaseJobSlipModal';
import { PaymentProofModal } from './PaymentProofModal';
import { PaymentReceiptModal } from './PaymentReceiptModal';
import { TransactionRegister } from './TransactionRegister';
import { BillingReportsView } from './BillingReportsView';
import { AccountsFinancialHome } from './AccountsFinancialHome';
import { GeneralLedgerView } from './GeneralLedgerView';
import { AuditLogView } from './AuditLogView';
import { RecordTransactionModal } from './RecordTransactionModal';
import { JournalEntryModal } from './JournalEntryModal';
import { ReversalModal, ReversalTarget } from './ReversalModal';
import { InvoiceDetailDrawer } from './InvoiceDetailDrawer';
import { ClinicStatementModal } from './ClinicStatementModal';
import { PageHeader, StatCard, EmptyState, TabsNav, Badge } from '../common/ui';
import { 
  DollarSign, 
  Wallet, 
  FileCheck2, 
  BookOpen, 
  BarChart3, 
  Printer, 
  Search, 
  CheckSquare, 
  Square, 
  Download, 
  Trash2, 
  FileText, 
  Building2, 
  CheckCircle2, 
  AlertCircle,
  AlertTriangle,
  Clock,
  ChevronRight,
  ArrowDownLeft,
  ArrowUpRight,
  Scale,
  ShieldCheck,
  Eye,
  Activity,
  CheckCheck
} from 'lucide-react';

export const BillingView: React.FC = () => {
  const { 
    invoices, 
    cases, 
    bulkMarkPaid, 
    deleteInvoice, 
    allPayments, 
    advancePayments, 
    accountAdjustments, 
    labs,
    getLabFinancialSummary,
    journalEntries,
    auditEvents
  } = useApp();

  // Core navigation: 6 simplified tabs for complete dental laboratory ERP accounting
  const [activeTab, setActiveTab] = useState<'invoices' | 'transactions' | 'accounts' | 'general_ledger' | 'audit_log' | 'reports'>('invoices');

  // Invoices tab filter states
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [clinicFilter, setClinicFilter] = useState<string>('all');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<'all' | 'unpaid' | 'partial' | 'overdue' | 'paid'>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Finance 2.0 Unified & Inspection Modals
  const [selectedDrawerInvoice, setSelectedDrawerInvoice] = useState<Invoice | null>(null);
  const [journalModalRef, setJournalModalRef] = useState<string | null>(null);
  const [reversalTarget, setReversalTarget] = useState<ReversalTarget | null>(null);
  const [isUnifiedRecordModalOpen, setIsUnifiedRecordModalOpen] = useState<boolean>(false);
  const [unifiedModalMode, setUnifiedModalMode] = useState<'payment' | 'advance_deposit' | 'credit_note' | 'refund'>('payment');
  const [unifiedModalLabId, setUnifiedModalLabId] = useState<string | undefined>(undefined);
  const [unifiedModalInvoiceId, setUnifiedModalInvoiceId] = useState<string | undefined>(undefined);
  const [clinicStatementModalId, setClinicStatementModalId] = useState<string | null>(null);


  const [printModalInvoice, setPrintModalInvoice] = useState<Invoice | null>(null);
  const [viewSlipCase, setViewSlipCase] = useState<any>(null);
  const [selectedProofPayment, setSelectedProofPayment] = useState<PaymentRecord | null>(null);
  const [selectedReceiptPayment, setSelectedReceiptPayment] = useState<{ payment: PaymentRecord; invoice?: Invoice } | null>(null);

  // Helper to determine if an invoice is overdue
  const isInvoiceOverdue = (inv: Invoice): { isOverdue: boolean; diffDays: number } => {
    const remaining = Math.max(0, inv.final_amount - (inv.amount_paid || 0));
    if (inv.payment_status === 'paid' || remaining <= 0) {
      return { isOverdue: false, diffDays: 0 };
    }
    if (!inv.due_date) {
      return { isOverdue: false, diffDays: 0 };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dueDate = new Date(inv.due_date);
    dueDate.setHours(0, 0, 0, 0);

    if (dueDate < today) {
      const diffMs = today.getTime() - dueDate.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      return { isOverdue: true, diffDays };
    }

    return { isOverdue: false, diffDays: 0 };
  };

  // Selected clinic financial summary and info
  const selectedLabSummary = useMemo(() => {
    if (clinicFilter === 'all') return null;
    return getLabFinancialSummary(clinicFilter);
  }, [clinicFilter, getLabFinancialSummary]);

  const selectedLab = useMemo(() => {
    if (clinicFilter === 'all') return null;
    return labs.find((l) => l.id === clinicFilter);
  }, [clinicFilter, labs]);

  // Live Counts for Invoice Filter Tabs (respects selected clinic)
  const statusCounts = useMemo(() => {
    let allCount = 0;
    let unpaidCount = 0;
    let partialCount = 0;
    let overdueCount = 0;
    let paidCount = 0;

    invoices.forEach((inv) => {
      if (clinicFilter !== 'all' && inv.lab_id !== clinicFilter) return;

      allCount++;
      const { isOverdue } = isInvoiceOverdue(inv);

      if (inv.payment_status === 'paid') {
        paidCount++;
      } else if (isOverdue) {
        overdueCount++;
      } else if (inv.payment_status === 'partial') {
        partialCount++;
      } else {
        unpaidCount++;
      }
    });

    return { allCount, unpaidCount, partialCount, overdueCount, paidCount };
  }, [invoices, clinicFilter]);

  // Financial KPI Calculations (respects selected clinic)
  const metrics = useMemo(() => {
    let totalInvoiced = 0;
    let totalPaid = 0;
    let normalPendingDue = 0;
    let overdueDue = 0;
    let overdueCount = 0;
    let pendingCount = 0;
    let paidCount = 0;

    invoices.forEach((inv) => {
      if (clinicFilter !== 'all' && inv.lab_id !== clinicFilter) return;

      totalInvoiced += inv.final_amount;
      const paid = inv.amount_paid || 0;
      totalPaid += paid;
      const remaining = Math.max(0, inv.final_amount - paid);

      if (inv.payment_status === 'paid' || remaining <= 0) {
        paidCount++;
      } else {
        const { isOverdue } = isInvoiceOverdue(inv);
        if (isOverdue) {
          overdueDue += remaining;
          overdueCount++;
        } else {
          normalPendingDue += remaining;
          pendingCount++;
        }
      }
    });

    const outstandingReceivables = normalPendingDue + overdueDue;
    const totalAdvanceCredit = advancePayments
      .filter((a) => clinicFilter === 'all' || a.lab_id === clinicFilter)
      .reduce((s, a) => s + (a.remaining_amount || 0), 0);

    return {
      totalInvoiced,
      totalPaid,
      outstandingReceivables,
      normalPendingDue,
      pendingCount,
      overdueDue,
      overdueCount,
      paidCount,
      totalAdvanceCredit,
      totalInvoicesCount: invoices.filter((i) => clinicFilter === 'all' || i.lab_id === clinicFilter).length,
      allTransactionsCount: allPayments.length + advancePayments.length + accountAdjustments.length
    };
  }, [invoices, advancePayments, allPayments, accountAdjustments, clinicFilter]);

  // Filtered Invoices
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      // Clinic filter
      if (clinicFilter !== 'all' && inv.lab_id !== clinicFilter) {
        return false;
      }

      const { isOverdue } = isInvoiceOverdue(inv);

      // Status filter
      if (invoiceStatusFilter === 'unpaid') {
        if (inv.payment_status !== 'unpaid' || isOverdue) return false;
      }
      if (invoiceStatusFilter === 'partial') {
        if (inv.payment_status !== 'partial' || isOverdue) return false;
      }
      if (invoiceStatusFilter === 'overdue') {
        if (!isOverdue) return false;
      }
      if (invoiceStatusFilter === 'paid') {
        if (inv.payment_status !== 'paid') return false;
      }

      // Search term
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchInv = (inv.invoice_number || '').toLowerCase().includes(q);
        const matchCase = (inv.case_number || '').toLowerCase().includes(q);
        const matchLab = (inv.lab_name || '').toLowerCase().includes(q);
        const matchDoc = (inv.doctor_name || '').toLowerCase().includes(q);
        const matchMat = (inv.case_type_name || '').toLowerCase().includes(q);
        if (!matchInv && !matchCase && !matchLab && !matchDoc && !matchMat) {
          return false;
        }
      }

      return true;
    });
  }, [invoices, clinicFilter, invoiceStatusFilter, searchTerm]);

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredInvoices.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredInvoices.map((i) => i.id));
    }
  };

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((i) => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleBulkPay = () => {
    if (selectedIds.length === 0) return;
    if (confirm(`Bulk clear payment for ${selectedIds.length} selected invoices?`)) {
      bulkMarkPaid(selectedIds);
      setSelectedIds([]);
    }
  };

  // Export Invoices to CSV
  const handleExportInvoicesCSV = () => {
    const headers = ['Invoice #', 'Case #', 'Dental Clinic', 'Doctor', 'Material / Type', 'Final Amount (PKR)', 'Paid (PKR)', 'Remaining (PKR)', 'Status', 'Due Date'];
    const rows = filteredInvoices.map(inv => [
      `"${inv.invoice_number}"`,
      `"${inv.case_number}"`,
      `"${inv.lab_name}"`,
      `"${inv.doctor_name}"`,
      `"${inv.case_type_name}"`,
      inv.final_amount,
      inv.amount_paid || 0,
      Math.max(0, inv.final_amount - (inv.amount_paid || 0)),
      `"${inv.payment_status.toUpperCase()}"`,
      `"${inv.due_date}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Dental_Solutions_Invoices_${new Date().toISOString().substring(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (inv: Invoice) => {
    const remaining = Math.max(0, inv.final_amount - (inv.amount_paid || 0));
    if (inv.payment_status === 'paid' || remaining <= 0) {
      return (
        <div className="inline-flex flex-col items-center">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>PAID</span>
          </span>
          <span className="text-[9px] text-slate-400 mt-0.5">Paid in Full</span>
        </div>
      );
    }

    const { isOverdue, diffDays } = isInvoiceOverdue(inv);
    if (isOverdue) {
      return (
        <div className="inline-flex flex-col items-center">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300 shadow-2xs">
            <AlertTriangle className="w-3 h-3 text-rose-600" />
            <span>OVERDUE</span>
          </span>
          <span className="text-[9px] font-extrabold text-rose-600 mt-0.5 whitespace-nowrap">
            {diffDays === 1 ? '1 day late' : `${diffDays} days late`}
          </span>
        </div>
      );
    }

    if (inv.payment_status === 'partial' || (inv.amount_paid || 0) > 0) {
      return (
        <div className="inline-flex flex-col items-center">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <Clock className="w-3 h-3 text-blue-600" />
            <span>PARTIAL</span>
          </span>
          <span className="text-[9px] font-semibold text-blue-600 mt-0.5 whitespace-nowrap">
            PKR {(inv.amount_paid || 0).toLocaleString()} paid
          </span>
        </div>
      );
    }

    // Pending unpaid & within terms
    let dueSubtext = 'Pending';
    if (inv.due_date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueDate = new Date(inv.due_date);
      dueDate.setHours(0, 0, 0, 0);
      const diffMs = dueDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) dueSubtext = 'Due Today';
      else if (diffDays === 1) dueSubtext = 'Due Tomorrow';
      else if (diffDays > 1) dueSubtext = `Due in ${diffDays}d`;
    }

    return (
      <div className="inline-flex flex-col items-center">
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
          <Clock className="w-3 h-3 text-amber-600" />
          <span>PENDING</span>
        </span>
        <span className="text-[9px] font-semibold text-amber-700 mt-0.5 whitespace-nowrap">
          {dueSubtext}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-6 billing-module no-scrollbar">
      
      {/* Module Title and Unified Action Buttons Header */}
      <PageHeader
        title="Billing, Invoicing & Receivables"
        subtitle="Complete dental lab accounting • Clinic invoices, payments register, double-entry ledger & audit statements"
        breadcrumbs={[
          { label: 'Financial Hub' },
          { 
            label: activeTab === 'invoices' 
              ? 'Invoices & Receivables' 
              : activeTab === 'transactions' 
              ? 'Payments & Transactions' 
              : activeTab === 'accounts' 
              ? 'Clinic Accounts & Ledger' 
              : activeTab === 'general_ledger' 
              ? 'General Ledger' 
              : activeTab === 'audit_log' 
              ? 'Audit Trail' 
              : 'Reports & Statements' 
          }
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {selectedLabSummary && selectedLabSummary.outstanding_balance === 0 && (selectedLabSummary.advance_balance || 0) > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setUnifiedModalLabId(selectedLab?.id);
                  setUnifiedModalMode('refund');
                  setIsUnifiedRecordModalOpen(true);
                }}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-xs flex items-center gap-2 transition-all cursor-pointer"
                title="Lab holds advance credit for this clinic. Pay refund or apply debit adjustment"
              >
                <ArrowUpRight className="w-4 h-4 text-slate-300" />
                <span>Pay / Refund Clinic (PKR {(selectedLabSummary.advance_balance || 0).toLocaleString()})</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setUnifiedModalInvoiceId(undefined);
                  setUnifiedModalLabId(clinicFilter !== 'all' ? clinicFilter : undefined);
                  setUnifiedModalMode('payment');
                  setIsUnifiedRecordModalOpen(true);
                }}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-xs flex items-center gap-2 transition-all cursor-pointer"
              >
                <ArrowDownLeft className="w-4 h-4 text-slate-300" />
                <span>
                  {selectedLabSummary && (selectedLabSummary.outstanding_balance || 0) > 0
                    ? `Receive Payment (PKR ${(selectedLabSummary.outstanding_balance || 0).toLocaleString()})`
                    : '+ Receive Payment'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setUnifiedModalInvoiceId(undefined);
                setUnifiedModalLabId(clinicFilter !== 'all' ? clinicFilter : undefined);
                setUnifiedModalMode('advance_deposit');
                setIsUnifiedRecordModalOpen(true);
              }}
              className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 font-semibold text-xs rounded-xl shadow-2xs flex items-center gap-2 transition-all cursor-pointer"
            >
              <Wallet className="w-4 h-4 text-slate-600" />
              <span>+ Advance Deposit</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setUnifiedModalInvoiceId(undefined);
                setUnifiedModalLabId(clinicFilter !== 'all' ? clinicFilter : undefined);
                setUnifiedModalMode('credit_note');
                setIsUnifiedRecordModalOpen(true);
              }}
              className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 font-semibold text-xs rounded-xl shadow-2xs flex items-center gap-2 transition-all cursor-pointer"
            >
              <FileCheck2 className="w-4 h-4 text-slate-600" />
              <span>+ Credit Note / Adjustment</span>
            </button>

            {selectedIds.length > 0 && activeTab === 'invoices' && (
              <button
                type="button"
                onClick={handleBulkPay}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-md flex items-center gap-2 transition-all cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4 text-slate-300" />
                <span>Bulk Mark Paid ({selectedIds.length})</span>
              </button>
            )}
          </div>
        }
      />

      {/* Main Tab Navigation (Comprehensive ERP Finance Modules) */}
      <TabsNav
        activeTab={activeTab}
        onChange={(tabId) => {
          setActiveTab(tabId as any);
          setSelectedIds([]);
        }}
        variant="contained"
        tabs={[
          { id: 'invoices', label: 'Invoices & Receivables', badge: metrics.totalInvoicesCount, icon: FileText },
          { id: 'transactions', label: 'Payments & Transactions', badge: metrics.allTransactionsCount, icon: DollarSign },
          { id: 'accounts', label: 'Clinic Accounts & Ledger', badge: labs.length, icon: Building2 },
          { id: 'general_ledger', label: 'General Ledger', badge: labs.length, icon: BookOpen },
          { id: 'audit_log', label: 'Audit Trail', badge: auditEvents.length, icon: ShieldCheck },
          { id: 'reports', label: 'Reports & Statements', icon: BarChart3 },
        ]}
      />

      {/* TAB 1: INVOICES & RECEIVABLES */}
      {activeTab === 'invoices' && (
        <div className="space-y-5">
          
          {/* Top 4 KPI Metrics Strip: Invoiced, Collected, Pending, and Overdue */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Total Billed Revenue"
              value={`PKR ${(metrics.totalInvoiced || 0).toLocaleString()}`}
              subtitle={`Across ${metrics.totalInvoicesCount} total invoices`}
              icon={DollarSign}
              variant="indigo"
            />

            <StatCard
              title="Collected Cash (Paid)"
              value={`PKR ${(metrics.totalPaid || 0).toLocaleString()}`}
              subtitle={`${metrics.paidCount} fully paid accounts`}
              icon={CheckCircle2}
              variant="emerald"
            />

            <StatCard
              title="Pending Receivables"
              value={`PKR ${(metrics.normalPendingDue || 0).toLocaleString()}`}
              subtitle={`${metrics.pendingCount} accounts within terms`}
              icon={Clock}
              variant="amber"
              onClick={() => setInvoiceStatusFilter('unpaid')}
            />

            <StatCard
              title="Overdue Receivables"
              value={`PKR ${(metrics.overdueDue || 0).toLocaleString()}`}
              subtitle={metrics.overdueCount > 0 ? `${metrics.overdueCount} overdue invoice(s) • Action required` : 'No overdue invoices'}
              icon={AlertTriangle}
              variant="rose"
              onClick={() => setInvoiceStatusFilter('overdue')}
            />
          </div>

          {/* Search, Clinic Dropdown & Filter Controls */}
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              
              {/* Status Filter Buttons (With visual indicators for Paid, Pending, and Overdue) */}
              <div className="flex flex-wrap items-center gap-1.5 no-scrollbar pb-1 md:pb-0">
                {[
                  { id: 'all', label: 'All Invoices', count: statusCounts.allCount },
                  { id: 'unpaid', label: 'Pending (Unpaid)', count: statusCounts.unpaidCount },
                  { id: 'partial', label: 'Partially Paid', count: statusCounts.partialCount },
                  { id: 'overdue', label: 'Overdue', count: statusCounts.overdueCount, isOverdueAlert: true },
                  { id: 'paid', label: 'Paid in Full', count: statusCounts.paidCount, isSuccess: true },
                ].map((sub) => {
                  const isSubActive = invoiceStatusFilter === sub.id;
                  return (
                    <button
                      key={sub.id}
                      onClick={() => setInvoiceStatusFilter(sub.id as any)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                        isSubActive
                          ? sub.isOverdueAlert
                            ? 'bg-rose-600 text-white shadow-xs'
                            : sub.isSuccess
                            ? 'bg-emerald-700 text-white shadow-xs'
                            : 'bg-slate-900 text-white shadow-xs'
                          : sub.isOverdueAlert && (sub.count || 0) > 0
                          ? 'bg-rose-100 text-rose-800 hover:bg-rose-200 font-bold'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {sub.isOverdueAlert && (sub.count || 0) > 0 && (
                        <AlertTriangle className={`w-3.5 h-3.5 ${isSubActive ? 'text-white' : 'text-rose-600'}`} />
                      )}
                      <span>{sub.label}</span>
                      <span className={`px-1.5 py-0.2 rounded-md text-[10px] ${
                        isSubActive
                          ? 'bg-black/20 text-white'
                          : 'bg-white/80 text-slate-700'
                      }`}>
                        {sub.count ?? 0}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Action: Export CSV */}
              <button
                onClick={handleExportInvoicesCSV}
                className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Export Invoices CSV</span>
              </button>

            </div>

            {/* Inputs: Search & Clinic Dropdown */}
            <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by invoice #, case #, dental clinic, doctor, material..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
                />
              </div>

              <div className="relative">
                <Building2 className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <select
                  value={clinicFilter}
                  onChange={(e) => setClinicFilter(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all appearance-none cursor-pointer"
                >
                  <option value="all">Filter by Dental Clinic: All Clinics ({labs.length})</option>
                  {labs.map((lab) => (
                    <option key={lab.id} value={lab.id}>{lab.name}</option>
                  ))}
                </select>
              </div>
            </div>


          </div>

          {/* Invoices Table */}
          <div className="glass-panel border border-slate-200/80 rounded-2xl shadow-2xs overflow-hidden">
            {filteredInvoices.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={Search}
                  title="No invoices match the active filters"
                  description="Try adjusting your clinic selection, clearing search keywords, or selecting 'All Invoices'."
                  actionLabel="Reset Invoice Filters"
                  onAction={() => {
                    setSearchTerm('');
                    setClinicFilter('all');
                    setInvoiceStatusFilter('all');
                  }}
                />
              </div>
            ) : (
              <div className="overflow-x-auto no-scrollbar">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-200/80 font-bold uppercase text-[10px] text-slate-500 tracking-wider">
                      <th className="py-3 px-4 w-10">
                        <button onClick={toggleSelectAll} className="p-1 text-slate-500 cursor-pointer">
                          {selectedIds.length === filteredInvoices.length && filteredInvoices.length > 0 ? (
                            <CheckSquare className="w-4 h-4 text-indigo-600" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300" />
                          )}
                        </button>
                      </th>
                      <th className="py-3 px-4">Invoice #</th>
                      <th className="py-3 px-3">Case #</th>
                      <th className="py-3 px-3">Dental Clinic</th>
                      <th className="py-3 px-3">Case Material</th>
                      <th className="py-3 px-3">Doctor</th>
                      <th className="py-3 px-3 text-right">Final Amount</th>
                      <th className="py-3 px-3 text-right">Paid</th>
                      <th className="py-3 px-3 text-right">Remaining Due</th>
                      <th className="py-3 px-3 text-center">Due Date & Terms</th>
                      <th className="py-3 px-3 text-center">Payment Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {filteredInvoices.map((inv) => {
                      const isSelected = selectedIds.includes(inv.id);
                      const remaining = Math.max(0, inv.final_amount - (inv.amount_paid || 0));
                      const isPaid = inv.payment_status === 'paid' || remaining <= 0;
                      const { isOverdue, diffDays } = isInvoiceOverdue(inv);

                      // Clinic financial summary for contextual action
                      const clinicSummary = getLabFinancialSummary(inv.lab_id);

                      // Visual status border on row
                      const rowStatusClass = isPaid
                        ? 'border-l-4 border-l-emerald-500'
                        : isOverdue
                        ? 'border-l-4 border-l-rose-600 bg-rose-50/20'
                        : inv.payment_status === 'partial'
                        ? 'border-l-4 border-l-blue-500'
                        : 'border-l-4 border-l-amber-400';

                      return (
                        <tr 
                          key={inv.id} 
                          className={`hover:bg-slate-50/80 transition-colors ${rowStatusClass} ${isSelected ? 'bg-indigo-50/40' : ''}`}
                        >
                          <td className="py-3 px-4">
                            <button onClick={() => toggleSelect(inv.id)} className="p-1 cursor-pointer">
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-indigo-600" />
                              ) : (
                                <Square className="w-4 h-4 text-slate-300" />
                              )}
                            </button>
                          </td>

                          {/* Invoice # */}
                          <td className="py-3 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                            <button
                              onClick={() => setSelectedDrawerInvoice(inv)}
                              className="hover:text-indigo-600 hover:underline transition-colors text-left font-bold cursor-pointer"
                              title="Click to inspect invoice lifecycle, breakdown & payment allocations"
                            >
                              {inv.invoice_number}
                            </button>
                          </td>

                          {/* Case # */}
                          <td className="py-3 px-3 whitespace-nowrap">
                            <button
                              onClick={() => {
                                const c = cases.find(cs => cs.id === inv.case_id || cs.case_number === inv.case_number);
                                if (c) setViewSlipCase(c);
                              }}
                              className="font-mono font-semibold text-indigo-600 hover:underline"
                              title="View Workstation Job Slip"
                            >
                              {inv.case_number}
                            </button>
                          </td>

                          {/* Dental Clinic */}
                          <td className="py-3 px-3 text-slate-900 font-semibold whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span>{inv.lab_name}</span>
                              {(clinicSummary?.advance_balance || 0) > 0 && (
                                <span 
                                  className="text-[9px] bg-purple-100 text-purple-800 font-bold px-1.5 py-0.2 rounded"
                                  title={`Clinic holds PKR ${(clinicSummary.advance_balance || 0).toLocaleString()} unallocated advance deposit`}
                                >
                                  Adv Avail
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Material */}
                          <td className="py-3 px-3 text-slate-600">
                            {inv.case_type_name}
                          </td>

                          {/* Doctor */}
                          <td className="py-3 px-3 text-slate-600 whitespace-nowrap">
                            {inv.doctor_name}
                          </td>

                          {/* Total Amount */}
                          <td className="py-3 px-3 text-right font-bold text-slate-900 whitespace-nowrap">
                            PKR {(inv.final_amount || 0).toLocaleString()}
                          </td>

                          {/* Paid Amount */}
                          <td className="py-3 px-3 text-right font-semibold text-emerald-600 whitespace-nowrap">
                            PKR {(inv.amount_paid || 0).toLocaleString()}
                          </td>

                          {/* Remaining Due */}
                          <td className={`py-3 px-3 text-right font-bold whitespace-nowrap ${
                            remaining > 0 ? (isOverdue ? 'text-rose-600 font-bold' : 'text-amber-600') : 'text-slate-400'
                          }`}>
                            PKR {(remaining || 0).toLocaleString()}
                          </td>

                          {/* Due Date & Terms Column */}
                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            {isPaid ? (
                              <div className="inline-flex flex-col items-center">
                                <span className="text-slate-500 text-[11px] font-medium">{inv.due_date || 'N/A'}</span>
                                <span className="text-[9px] text-emerald-600 font-bold">Settled</span>
                              </div>
                            ) : isOverdue ? (
                              <div className="inline-flex flex-col items-center">
                                <span className="text-rose-600 font-bold text-[11px] flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                                  <span>{inv.due_date}</span>
                                </span>
                                <span className="px-1.5 py-0.2 bg-rose-100 text-rose-700 font-bold text-[9px] rounded mt-0.5 whitespace-nowrap">
                                  EXPIRED ({diffDays}d)
                                </span>
                              </div>
                            ) : (
                              <div className="inline-flex flex-col items-center">
                                <span className="text-slate-700 text-[11px] font-medium">{inv.due_date || 'N/A'}</span>
                                <span className="text-[9px] text-amber-700 font-semibold">
                                  {inv.due_date ? 'Within Terms' : 'No Terms'}
                                </span>
                              </div>
                            )}
                          </td>

                          {/* Payment Status Indicator (Paid, Pending, Overdue) */}
                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            {getStatusBadge(inv)}
                          </td>

                          {/* Context-Aware Actions: Receive vs Pay/Refund & Drawer Inspect */}
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {!isPaid ? (
                                <button
                                  onClick={() => {
                                    setUnifiedModalInvoiceId(inv.id);
                                    setUnifiedModalLabId(inv.lab_id);
                                    setUnifiedModalMode('payment');
                                    setIsUnifiedRecordModalOpen(true);
                                  }}
                                  className={`px-2.5 py-1 text-white font-bold text-xs rounded-lg shadow-2xs transition-colors flex items-center gap-1 cursor-pointer ${
                                    isOverdue
                                      ? 'bg-rose-600 hover:bg-rose-700'
                                      : 'bg-emerald-600 hover:bg-emerald-700'
                                  }`}
                                  title={isOverdue ? 'Receive overdue payment' : 'Receive payment against this invoice'}
                                >
                                  <ArrowDownLeft className="w-3.5 h-3.5" />
                                  <span>{isOverdue ? 'Receive Overdue' : 'Receive'}</span>
                                </button>
                              ) : clinicSummary.outstanding_balance === 0 && clinicSummary.advance_balance > 0 ? (
                                <button
                                  onClick={() => {
                                    setUnifiedModalInvoiceId(undefined);
                                    setUnifiedModalLabId(inv.lab_id);
                                    setUnifiedModalMode('refund');
                                    setIsUnifiedRecordModalOpen(true);
                                  }}
                                  className="px-2.5 py-1 bg-purple-100 hover:bg-purple-200 text-purple-800 font-bold text-xs rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                                  title="Clinic has credit surplus. Click to pay refund or adjust"
                                >
                                  <ArrowUpRight className="w-3.5 h-3.5 text-purple-600" />
                                  <span>Pay / Refund</span>
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded-md border border-emerald-200">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  <span>Cleared</span>
                                </span>
                              )}

                              <button
                                onClick={() => setSelectedDrawerInvoice(inv)}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                                title="Inspect Invoice Breakdown, Case Items & Settlement History"
                              >
                                <Eye className="w-4 h-4" />
                              </button>

                              <button
                                onClick={() => setPrintModalInvoice(inv)}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                                title="Print Invoice Statement"
                              >
                                <Printer className="w-4 h-4" />
                              </button>

                              <button
                                onClick={() => {
                                  if (confirm(`Are you sure you want to void invoice ${inv.invoice_number}?`)) {
                                    deleteInvoice(inv.id);
                                  }
                                }}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                title="Void Invoice"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
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
      )}

      {/* TAB 2: UNIFIED PAYMENTS & TRANSACTIONS REGISTER */}
      {activeTab === 'transactions' && (
        <TransactionRegister
          onOpenPaymentModal={(inv, labId) => {
            setUnifiedModalLabId(labId || inv?.lab_id);
            setUnifiedModalInvoiceId(inv?.id);
            setUnifiedModalMode('payment');
            setIsUnifiedRecordModalOpen(true);
          }}
          onOpenAdvanceModal={(labId) => {
            setUnifiedModalLabId(labId);
            setUnifiedModalMode('advance_deposit');
            setIsUnifiedRecordModalOpen(true);
          }}
          onOpenAdjustmentModal={(labId) => {
            setUnifiedModalLabId(labId);
            setUnifiedModalMode('credit_note');
            setIsUnifiedRecordModalOpen(true);
          }}
          onViewProof={(pay) => setSelectedProofPayment(pay)}
          onPrintReceipt={(pay, inv) => setSelectedReceiptPayment({ payment: pay, invoice: inv })}
          onReverseTransaction={(target) => setReversalTarget(target)}
          onOpenJournalModal={(refId) => setJournalModalRef(refId)}
        />
      )}

      {/* TAB 3: CLINIC FINANCIAL PROFILE & ACCOUNTING LEDGER */}
      {activeTab === 'accounts' && (
        <AccountsFinancialHome
          initialClinicId={clinicFilter !== 'all' ? clinicFilter : undefined}
          onOpenPaymentModal={(clinicId, invId) => {
            setUnifiedModalLabId(clinicId);
            setUnifiedModalInvoiceId(invId);
            setUnifiedModalMode('payment');
            setIsUnifiedRecordModalOpen(true);
          }}
          onOpenAdvanceModal={(clinicId) => {
            setUnifiedModalLabId(clinicId);
            setUnifiedModalMode('advance_deposit');
            setIsUnifiedRecordModalOpen(true);
          }}
          onOpenStatementModal={(clinicId) => {
            setClinicStatementModalId(clinicId);
          }}
          onOpenInvoiceDrawer={(inv) => setSelectedDrawerInvoice(inv)}
          onOpenJournalModal={(refId) => setJournalModalRef(refId)}
          onViewReceipt={(pay) => setSelectedReceiptPayment({ payment: pay })}
        />
      )}

      {/* TAB 4: CLINIC GENERAL LEDGER */}
      {activeTab === 'general_ledger' && (
        <GeneralLedgerView
          onOpenJournalModal={(refId) => setJournalModalRef(refId)}
        />
      )}

      {/* TAB 6: IMMUTABLE AUDIT TRAIL */}
      {activeTab === 'audit_log' && (
        <AuditLogView />
      )}

      {/* TAB 7: MONTHLY REPORTS & STATEMENTS ARCHIVES */}
      {activeTab === 'reports' && (
        <BillingReportsView
          onPrintInvoice={(inv) => setPrintModalInvoice(inv)}
          onViewCaseSlip={(caseItem) => setViewSlipCase(caseItem)}
        />
      )}

      {/* Unified Transaction Recording Modal (Finance 2.0 Engine) */}
      {isUnifiedRecordModalOpen && (
        <RecordTransactionModal
          isOpen={isUnifiedRecordModalOpen}
          onClose={() => {
            setIsUnifiedRecordModalOpen(false);
            setUnifiedModalLabId(undefined);
            setUnifiedModalInvoiceId(undefined);
          }}
          initialMode={unifiedModalMode}
          initialLabId={unifiedModalLabId}
          initialInvoiceId={unifiedModalInvoiceId}
        />
      )}

      {/* Double-Entry Journal Entry Inspector Modal */}
      <JournalEntryModal
        isOpen={!!journalModalRef}
        onClose={() => setJournalModalRef(null)}
        referenceId={journalModalRef || ''}
      />

      {/* Audit-Compliant Reversal Modal */}
      <ReversalModal
        isOpen={!!reversalTarget}
        onClose={() => setReversalTarget(null)}
        target={reversalTarget}
      />

      {/* Invoice Details & Settlement Lifecycle Drawer */}
      <InvoiceDetailDrawer
        isOpen={!!selectedDrawerInvoice}
        onClose={() => setSelectedDrawerInvoice(null)}
        invoice={selectedDrawerInvoice}
        onOpenPaymentModal={(inv) => {
          setSelectedDrawerInvoice(null);
          setUnifiedModalLabId(inv.lab_id);
          setUnifiedModalInvoiceId(inv.id);
          setUnifiedModalMode('payment');
          setIsUnifiedRecordModalOpen(true);
        }}
        onOpenCreditNoteModal={(inv) => {
          setSelectedDrawerInvoice(null);
          setUnifiedModalLabId(inv.lab_id);
          setUnifiedModalInvoiceId(inv.id);
          setUnifiedModalMode('credit_note');
          setIsUnifiedRecordModalOpen(true);
        }}
        onOpenJournalModal={(refId) => setJournalModalRef(refId)}
        onPrintInvoice={(inv) => setPrintModalInvoice(inv)}
        onViewReceipt={(pay) => setSelectedReceiptPayment({ payment: pay })}
        onReversePayment={(pay) => {
          setReversalTarget({
            referenceType: 'payment',
            referenceId: pay.id,
            referenceNumber: pay.payment_number ?? '',
            amount: pay.amount,
            labName: pay.lab_name ?? '',
            date: pay.payment_date,
            details: `Invoice Payment: ${pay.invoice_number ?? ''}`
          });
        }}
      />

      {/* Official Clinic Statement of Account Modal */}
      {clinicStatementModalId && (
        <ClinicStatementModal
          isOpen={!!clinicStatementModalId}
          onClose={() => setClinicStatementModalId(null)}
          clinicId={clinicStatementModalId}
        />
      )}

      {/* Payment Proof Viewing Modal */}
      {selectedProofPayment && (
        <PaymentProofModal
          payment={selectedProofPayment}
          onClose={() => setSelectedProofPayment(null)}
        />
      )}

      {/* Payment Receipt Printable Modal */}
      {selectedReceiptPayment && (
        <PaymentReceiptModal
          payment={selectedReceiptPayment.payment}
          invoice={selectedReceiptPayment.invoice}
          onClose={() => setSelectedReceiptPayment(null)}
        />
      )}

      {/* Invoice Statement Printable Modal */}
      {printModalInvoice && (
        <InvoiceStatementModal
          invoice={printModalInvoice}
          caseData={cases.find((c) => c.id === printModalInvoice.case_id || c.case_number === printModalInvoice.case_number)}
          onClose={() => setPrintModalInvoice(null)}
        />
      )}

      {/* Case Job Slip Modal */}
      {viewSlipCase && (
        <CaseJobSlipModal
          caseData={viewSlipCase}
          onClose={() => setViewSlipCase(null)}
        />
      )}

    </div>
  );
};
