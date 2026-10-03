import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Invoice, PaymentRecord } from '../../types';
import { downloadCSV } from '../../services/csvExport';
import { canPost } from '../../services/permissions';
import { ConfirmDialog } from '../common/ui';
import { InvoiceStatementModal } from './InvoiceStatementModal';
import { CaseJobSlipModal } from '../cases/CaseJobSlipModal';
import { PaymentProofModal } from './PaymentProofModal';
import { PaymentReceiptModal } from './PaymentReceiptModal';
import { TransactionRegister } from './TransactionRegister';
import { BillingReportsView } from './BillingReportsView';
import { GeneralLedgerView } from './GeneralLedgerView';
import { BatchInvoicePrintModal } from './BatchInvoicePrintModal';
import { AuditLogView } from './AuditLogView';
import { RecordTransactionModal } from './RecordTransactionModal';
import { JournalEntryModal } from './JournalEntryModal';
import { ReversalModal, ReversalTarget } from './ReversalModal';
import { InvoiceDetailDrawer } from './InvoiceDetailDrawer';
import { ClinicStatementModal } from './ClinicStatementModal';
import { ClinicAccountsTable } from './ClinicAccountsTable';
import { PageHeader, EmptyState, TabsNav, Badge, DataTable, FilterBar } from '../common/ui';
import { todayISO } from '../common/DatePickerRange';
import { getTodayStr } from '../../utils/dateUtils';
import { 
  DollarSign, 
  Wallet, 
  FileCheck2, 
  BookOpen, 
  BarChart3, 
  Printer, 
  Search, 
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
  CheckCheck,
  FileSpreadsheet
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
    auditEvents,
    user,
    setCurrentView
  } = useApp();

  // Core navigation: 5 tabs for complete dental laboratory ERP accounting
  const [activeTab, setActiveTab] = useState<'invoices' | 'transactions' | 'clinic_accounts' | 'general_ledger' | 'audit_log' | 'reports'>('invoices');

  // Invoices tab filter states
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [clinicFilter, setClinicFilter] = useState<string>('all');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<'all' | 'unpaid' | 'partial' | 'overdue' | 'paid'>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Business date for bulk settlements — user-picked, defaults to today.
  const [bulkPayDate, setBulkPayDate] = useState<string>(getTodayStr());
  // Invoice history window: defaults to TODAY, like every other billing tab —
  // yesterday's and older invoices are reached by rewinding the date picker
  // (clearing it = All Time). Dates compare on the billing day.
  const [invFromDate, setInvFromDate] = useState<string>(() => todayISO());
  const [invToDate, setInvToDate] = useState<string>(() => todayISO());

  // Finance 2.0 Unified & Inspection Modals
  const [selectedDrawerInvoice, setSelectedDrawerInvoice] = useState<Invoice | null>(null);
  const [journalModalRef, setJournalModalRef] = useState<string | null>(null);
  const [reversalTarget, setReversalTarget] = useState<ReversalTarget | null>(null);
  const [isUnifiedRecordModalOpen, setIsUnifiedRecordModalOpen] = useState<boolean>(false);
  const [unifiedModalMode, setUnifiedModalMode] = useState<'payment' | 'advance_deposit' | 'credit_note' | 'refund'>('payment');
  const [unifiedModalLabId, setUnifiedModalLabId] = useState<string | undefined>(undefined);
  const [unifiedModalInvoiceId, setUnifiedModalInvoiceId] = useState<string | undefined>(undefined);
  const [clinicStatementModalId, setClinicStatementModalId] = useState<string | null>(null);
  const [batchPrintOpen, setBatchPrintOpen] = useState<boolean>(false);


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

  // Filtered Invoices
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      // Date range on the billing day (created_at is 'YYYY-MM-DD HH:mm')
      const day = (inv.created_at || '').slice(0, 10);
      if (invFromDate && (!day || day < invFromDate)) return false;
      if (invToDate && (!day || day > invToDate)) return false;

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
  }, [invoices, clinicFilter, invoiceStatusFilter, searchTerm, invFromDate, invToDate]);

  /* Render cap (same pattern as CaseListView): mount 300 rows, expand on demand.
     Mounting 1000+ heavy rows froze scroll and search on volume datasets. */
  const RENDER_CAP_STEP = 300;
  const [renderLimit, setRenderLimit] = useState(RENDER_CAP_STEP);
  const visibleInvoices = useMemo(() => filteredInvoices.slice(0, renderLimit), [filteredInvoices, renderLimit]);

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

  // B4/B10: both native confirm()s replaced by ConfirmDialog — a
  // ledger-reversing action needs room to explain consequences, and void
  // requires a typed phrase + the invoice:void permission (B3).
  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null);
  const [bulkPayConfirm, setBulkPayConfirm] = useState(false);

  const handleBulkPay = () => {
    if (selectedIds.length === 0) return;
    if (!canPost(user, 'payment:bulk')) return;
    setBulkPayConfirm(true);
  };

  // Export Invoices to CSV (B9: RFC-4180 quoting — clinics with commas/quotes
  // used to break rows under the old hand-rolled joiner)
  const handleExportInvoicesCSV = () => {
    const headers = ['Invoice #', 'Case #', 'Dental Clinic', 'Doctor', 'Material / Type', 'Final Amount (PKR)', 'Paid (PKR)', 'Remaining (PKR)', 'Status', 'Due Date'];
    const rows = filteredInvoices.map(inv => [
      inv.invoice_number,
      inv.case_number,
      inv.lab_name,
      inv.doctor_name,
      inv.case_type_name,
      inv.final_amount,
      inv.amount_paid || 0,
      Math.max(0, inv.final_amount - (inv.amount_paid || 0)),
      inv.payment_status.toUpperCase(),
      inv.due_date
    ]);
    downloadCSV(`Dental_Solutions_Invoices_${getTodayStr()}`, [headers, ...rows]);
  };

  const getStatusBadge = (inv: Invoice) => {
    const remaining = Math.max(0, inv.final_amount - (inv.amount_paid || 0));
    if (inv.payment_status === 'paid' || remaining <= 0) {
      return (
        <div className="inline-flex flex-col items-center">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>Paid</span>
          </span>
          <span className="text-[11px] text-slate-500 mt-0.5">Paid in Full</span>
        </div>
      );
    }

    const { isOverdue, diffDays } = isInvoiceOverdue(inv);
    if (isOverdue) {
      return (
        <div className="inline-flex flex-col items-center">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <AlertTriangle className="w-3 h-3 text-rose-600" />
            <span>Overdue</span>
          </span>
          <span className="text-[11px] font-bold text-rose-600 mt-0.5 whitespace-nowrap">
            {diffDays === 1 ? '1 day late' : `${diffDays} days late`}
          </span>
        </div>
      );
    }

    if (inv.payment_status === 'partial' || (inv.amount_paid || 0) > 0) {
      return (
        <div className="inline-flex flex-col items-center">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <Clock className="w-3 h-3 text-blue-600" />
            <span>Partial</span>
          </span>
          <span className="text-[11px] font-semibold text-blue-600 mt-0.5 whitespace-nowrap">
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
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
          <Clock className="w-3 h-3 text-amber-600" />
          <span>Pending</span>
        </span>
        <span className="text-[11px] font-semibold text-amber-700 mt-0.5 whitespace-nowrap">
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
                className="px-4 py-2 bg-brand-600 hover:bg-brand-700 active:scale-[0.98] text-white font-semibold text-xs rounded-xl shadow-xs flex items-center gap-2 transition-all cursor-pointer"
                title="Lab holds advance credit for this clinic. Pay refund or apply debit adjustment"
              >
                <ArrowUpRight className="w-4 h-4 shrink-0" />
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
                className="px-4 py-2 bg-brand-600 hover:bg-brand-700 active:scale-[0.98] text-white font-semibold text-xs rounded-xl shadow-xs flex items-center gap-2 transition-all cursor-pointer"
              >
                <ArrowDownLeft className="w-4 h-4 shrink-0" />
                <span>
                  {selectedLabSummary && (selectedLabSummary.outstanding_balance || 0) > 0
                    ? `Receive Payment (PKR ${(selectedLabSummary.outstanding_balance || 0).toLocaleString()})`
                    : 'Receive Payment'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setBatchPrintOpen(true)}
              className="px-3.5 py-2 bg-white hover:bg-slate-50 active:scale-[0.98] text-slate-800 border border-slate-300 font-semibold text-xs rounded-xl shadow-2xs flex items-center gap-2 transition-all cursor-pointer"
              title="Print every unpaid invoice for one clinic over a month or date range"
            >
              <Printer className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>Batch Print Unpaid</span>
            </button>

            {clinicFilter !== 'all' && (
              <button
                type="button"
                onClick={() => setClinicStatementModalId(clinicFilter)}
                className="px-3.5 py-2 bg-white hover:bg-slate-50 active:scale-[0.98] text-slate-800 border border-slate-300 font-semibold text-xs rounded-xl shadow-2xs flex items-center gap-2 transition-all cursor-pointer"
                title="Open the official statement of account for the selected clinic"
              >
                <FileSpreadsheet className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>Clinic Statement</span>
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
              className="px-3.5 py-2 bg-white hover:bg-slate-50 active:scale-[0.98] text-slate-800 border border-slate-300 font-semibold text-xs rounded-xl shadow-2xs flex items-center gap-2 transition-all cursor-pointer"
            >
              <Wallet className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>Advance Deposit</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setUnifiedModalInvoiceId(undefined);
                setUnifiedModalLabId(clinicFilter !== 'all' ? clinicFilter : undefined);
                setUnifiedModalMode('credit_note');
                setIsUnifiedRecordModalOpen(true);
              }}
              className="px-3.5 py-2 bg-white hover:bg-slate-50 active:scale-[0.98] text-slate-800 border border-slate-300 font-semibold text-xs rounded-xl shadow-2xs flex items-center gap-2 transition-all cursor-pointer"
            >
              <FileCheck2 className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>Credit Note / Adjustment</span>
            </button>

            {selectedIds.length > 0 && activeTab === 'invoices' && (
              <>
                <label className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 rounded-xl shadow-2xs">
                  <span className="text-xs font-semibold text-slate-600 shrink-0">Payment date</span>
                  <input
                    type="date"
                    value={bulkPayDate}
                    onChange={(e) => setBulkPayDate(e.target.value)}
                    className="text-xs px-2 py-1 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleBulkPay}
                  className="px-3.5 py-2 bg-brand-600 hover:bg-brand-700 active:scale-[0.98] text-white font-semibold text-xs rounded-xl shadow-xs flex items-center gap-2 transition-all cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Bulk Mark Paid ({selectedIds.length})</span>
                </button>
              </>
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
        fit="fill"
        variant="pills"
        tabs={[
          { id: 'invoices', label: 'Invoices & Receivables', icon: FileText },
          { id: 'transactions', label: 'Payments & Transactions', icon: DollarSign },
          { id: 'clinic_accounts', label: 'Clinic Accounts', icon: Building2 },
          { id: 'general_ledger', label: 'General Ledger', icon: BookOpen },
          { id: 'audit_log', label: 'Audit Trail', icon: ShieldCheck },
          { id: 'reports', label: 'Reports & Statements', icon: BarChart3 },
        ]}
      />

      {/* TAB 1: INVOICES & RECEIVABLES */}
      {activeTab === 'invoices' && (
        <div className="space-y-5">

          {/* Search, Clinic Dropdown & Filter Controls */}
          <FilterBar
            search={{
              value: searchTerm,
              onChange: setSearchTerm,
              placeholder: 'Search by invoice #, case #, dental clinic, doctor, material...',
            }}
            dateRange={{
              from: invFromDate,
              to: invToDate,
              onChange: (f, t) => {
                setInvFromDate(f);
                setInvToDate(t);
              },
            }}
            clinics={{ labs, value: clinicFilter, onChange: setClinicFilter }}
            actions={
              <button
                onClick={handleExportInvoicesCSV}
                className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Export Invoices CSV</span>
              </button>
            }
            pills={[
              { id: 'all', label: 'All Invoices', count: statusCounts.allCount },
              { id: 'unpaid', label: 'Pending (Unpaid)', count: statusCounts.unpaidCount },
              { id: 'partial', label: 'Partially Paid', count: statusCounts.partialCount },
              { id: 'overdue', label: 'Overdue', count: statusCounts.overdueCount, tone: 'danger' },
              { id: 'paid', label: 'Paid in Full', count: statusCounts.paidCount, tone: 'success' },
            ]}
            activePill={invoiceStatusFilter}
            onPillChange={(id) => setInvoiceStatusFilter(id as any)}
          />

          {/* Invoices Table */}
          <DataTable<Invoice>
            data={visibleInvoices}
            rowKey={(inv) => inv.id}
            rowClassName={(inv) => {
              const remaining = Math.max(0, inv.final_amount - (inv.amount_paid || 0));
              const isPaid = inv.payment_status === 'paid' || remaining <= 0;
              const { isOverdue } = isInvoiceOverdue(inv);
              // Visual status border on row
              return isPaid
                ? 'border-l-4 border-l-emerald-500'
                : isOverdue
                ? 'border-l-4 border-l-rose-600 bg-rose-50/20'
                : inv.payment_status === 'partial'
                ? 'border-l-4 border-l-blue-500'
                : 'border-l-4 border-l-amber-400';
            }}
            selection={{
              selectedIds,
              allSelected: selectedIds.length === filteredInvoices.length,
              onToggle: toggleSelect,
              onToggleAll: toggleSelectAll,
            }}
            emptyState={
              <div className="p-6">
                <EmptyState
                  icon={Search}
                  title="No invoices match the active filters"
                  description="This tab lists today's invoices by default — rewind the date picker to see earlier days, or reset to show every date."
                  actionLabel="Reset Filters & Show All Dates"
                  onAction={() => {
                    setSearchTerm('');
                    setClinicFilter('all');
                    setInvoiceStatusFilter('all');
                    setInvFromDate('');
                    setInvToDate('');
                  }}
                />
              </div>
            }
            footer={
              filteredInvoices.length > visibleInvoices.length ? (
                <div className="flex items-center justify-center gap-3 py-4 border-t border-slate-100 bg-slate-50/60">
                  <span className="text-xs text-slate-500">
                    Showing {visibleInvoices.length} of {filteredInvoices.length} invoices
                  </span>
                  <button
                    type="button"
                    onClick={() => setRenderLimit((n) => n + RENDER_CAP_STEP)}
                    className="px-4 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    Show {Math.min(RENDER_CAP_STEP, filteredInvoices.length - visibleInvoices.length)} More
                  </button>
                </div>
              ) : undefined
            }
            columns={[
              {
                header: 'Invoice #',
                className: 'font-mono font-bold text-slate-900 whitespace-nowrap',
                render: (inv: Invoice) => (
                  <button
                    onClick={() => setSelectedDrawerInvoice(inv)}
                    className="hover:text-indigo-600 hover:underline transition-colors text-left font-bold cursor-pointer"
                    title="Click to inspect invoice lifecycle, breakdown & payment allocations"
                  >
                    {inv.invoice_number}
                  </button>
                ),
              },
              {
                header: 'Case #',
                className: 'whitespace-nowrap',
                render: (inv: Invoice) => (
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
                ),
              },
              {
                header: 'Dental Clinic',
                className: 'text-slate-900 font-semibold whitespace-nowrap',
                render: (inv: Invoice) => {
                  const clinicSummary = getLabFinancialSummary(inv.lab_id);
                  return (
                    <div className="flex items-center gap-1.5">
                      <span>{inv.lab_name}</span>
                      {(clinicSummary?.advance_balance || 0) > 0 && (
                        <span
                          className="text-[11px] bg-purple-100 text-purple-800 font-bold px-1.5 py-0.2 rounded"
                          title={`Clinic holds PKR ${(clinicSummary.advance_balance || 0).toLocaleString()} unallocated advance deposit`}
                        >
                          Adv Avail
                        </span>
                      )}
                    </div>
                  );
                },
              },
              {
                header: 'Case Material',
                className: 'text-slate-600',
                render: (inv: Invoice) => inv.case_type_name,
              },
              {
                header: 'Doctor',
                className: 'text-slate-600 whitespace-nowrap',
                render: (inv: Invoice) => inv.doctor_name,
              },
              {
                header: 'Final Amount',
                align: 'right',
                className: 'font-mono font-bold text-slate-900 whitespace-nowrap tabular-nums',
                render: (inv: Invoice) => `PKR ${(inv.final_amount || 0).toLocaleString()}`,
              },
              {
                header: 'Paid',
                align: 'right',
                className: 'font-mono font-semibold text-emerald-600 whitespace-nowrap tabular-nums',
                render: (inv: Invoice) => `PKR ${(inv.amount_paid || 0).toLocaleString()}`,
              },
              {
                header: 'Remaining Due',
                align: 'right',
                className: 'whitespace-nowrap',
                render: (inv: Invoice) => {
                  const remaining = Math.max(0, inv.final_amount - (inv.amount_paid || 0));
                  const { isOverdue } = isInvoiceOverdue(inv);
                  return (
                    <span className={`font-mono font-bold tabular-nums ${
                      remaining > 0 ? (isOverdue ? 'text-rose-600 font-bold' : 'text-amber-600') : 'text-slate-400'
                    }`}>
                      PKR {(remaining || 0).toLocaleString()}
                    </span>
                  );
                },
              },
              {
                header: 'Due Date & Terms',
                align: 'center',
                className: 'whitespace-nowrap',
                render: (inv: Invoice) => {
                  const remaining = Math.max(0, inv.final_amount - (inv.amount_paid || 0));
                  const isPaid = inv.payment_status === 'paid' || remaining <= 0;
                  const { isOverdue, diffDays } = isInvoiceOverdue(inv);
                  if (isPaid) {
                    return (
                      <div className="inline-flex flex-col items-center">
                        <span className="text-slate-500 text-[11px] font-medium">{inv.due_date || 'N/A'}</span>
                        <span className="text-[11px] text-emerald-600 font-bold">Settled</span>
                      </div>
                    );
                  }
                  if (isOverdue) {
                    return (
                      <div className="inline-flex flex-col items-center">
                        <span className="text-rose-600 font-bold text-[11px] flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                          <span>{inv.due_date}</span>
                        </span>
                        <span className="px-1.5 py-0.2 bg-rose-100 text-rose-700 font-bold text-[11px] rounded mt-0.5 whitespace-nowrap">
                          EXPIRED ({diffDays}d)
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div className="inline-flex flex-col items-center">
                      <span className="text-slate-700 text-[11px] font-medium">{inv.due_date || 'N/A'}</span>
                      <span className="text-[11px] text-amber-700 font-semibold">
                        {inv.due_date ? 'Within Terms' : 'No Terms'}
                      </span>
                    </div>
                  );
                },
              },
              {
                header: 'Payment Status',
                align: 'center',
                className: 'whitespace-nowrap',
                render: (inv: Invoice) => getStatusBadge(inv),
              },
              {
                header: 'Actions',
                align: 'right',
                className: 'whitespace-nowrap',
                render: (inv: Invoice) => {
                  const remaining = Math.max(0, inv.final_amount - (inv.amount_paid || 0));
                  const isPaid = inv.payment_status === 'paid' || remaining <= 0;
                  const { isOverdue } = isInvoiceOverdue(inv);
                  const clinicSummary = getLabFinancialSummary(inv.lab_id);
                  return (
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
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[11px] font-bold rounded-md border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Cleared</span>
                        </span>
                      )}

                      <button
                        onClick={() => setSelectedDrawerInvoice(inv)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                        title="Inspect Invoice Breakdown, Case Items & Settlement History" aria-label="Inspect invoice breakdown, case items and settlement history"
                      >
                        <Eye className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => setPrintModalInvoice(inv)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                        title="Print Invoice Statement" aria-label="Print invoice statement"
                      >
                        <Printer className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => { if (canPost(user, 'invoice:void')) setVoidTarget(inv); }}
                        className={`p-1.5 rounded-lg transition-colors ${
                          canPost(user, 'invoice:void')
                            ? 'text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer'
                            : 'text-slate-200 cursor-not-allowed'
                        }`}
                        title={canPost(user, 'invoice:void') ? 'Void Invoice' : 'Void Invoice (admin only)'}
                        aria-label={canPost(user, 'invoice:void') ? `Void invoice ${inv.invoice_number}` : `Void invoice ${inv.invoice_number} (admin only)`}
                        aria-disabled={!canPost(user, 'invoice:void')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                },
              },
            ]}
          />

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

      {/* TAB 3: CLINIC ACCOUNTS LEDGER — moved here from the dashboard, where
          it was the widest element on screen and had to be capped at 12 rows.
          Money lives in the finance workspace; this gives it full width. */}
      {activeTab === 'clinic_accounts' && (
        <ClinicAccountsTable
          labs={labs}
          invoices={invoices}
          cases={cases}
          todayStr={getTodayStr()}
          onCollect={(clinicId) => {
            setUnifiedModalLabId(clinicId);
            setUnifiedModalInvoiceId(undefined);
            setUnifiedModalMode('payment');
            setIsUnifiedRecordModalOpen(true);
          }}
          onStatement={(clinicId) => setClinicStatementModalId(clinicId)}
          onOpenClinics={() => setCurrentView('labs')}
        />
      )}

      {/* TAB 4: CLINIC GENERAL LEDGER */}
      {activeTab === 'general_ledger' && (
        <GeneralLedgerView
          onOpenJournalModal={(refId) => setJournalModalRef(refId)}
        />
      )}

      {/* TAB 5: IMMUTABLE AUDIT TRAIL */}
      {activeTab === 'audit_log' && (
        <AuditLogView />
      )}

      {/* TAB 6: MONTHLY REPORTS & STATEMENTS ARCHIVES */}
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

      {/* Batch print — every unpaid invoice for a clinic over a period */}
      {batchPrintOpen && (
        <BatchInvoicePrintModal
          initialLabId={clinicFilter !== 'all' ? clinicFilter : undefined}
          onClose={() => setBatchPrintOpen(false)}
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

      {/* B4: void = typed-phrase confirmation (ledger reversal + retired number) */}
      <ConfirmDialog
        open={!!voidTarget}
        title={`Void invoice ${voidTarget?.invoice_number || ''}`}
        consequences={[
          `${voidTarget?.lab_name || 'The clinic'} will owe ${voidTarget ? voidTarget.final_amount - (voidTarget.amount_paid || 0) : 0} PKR again once the issuance journal is reversed.`,
          `Invoice ${voidTarget?.invoice_number || ''} leaves the register; its number is retired and never re-issued.`,
          'An INVOICE_VOIDED audit entry records who voided it and why.',
        ]}
        confirmLabel="Void Invoice"
        typedPhrase="VOID"
        onCancel={() => setVoidTarget(null)}
        onConfirm={() => {
          if (voidTarget) deleteInvoice(voidTarget.id);
          setVoidTarget(null);
        }}
      />

      {/* B10: bulk settlement confirmation with the exact business facts */}
      <ConfirmDialog
        open={bulkPayConfirm}
        tone="indigo"
        title="Bulk settle invoices"
        consequences={[
          `${selectedIds.length} invoice(s) will be marked fully paid, dated ${bulkPayDate}.`,
          'One payment row per invoice is posted with a distinct number and a balanced journal.',
        ]}
        confirmLabel="Mark Paid"
        onCancel={() => setBulkPayConfirm(false)}
        onConfirm={() => {
          bulkMarkPaid(selectedIds, bulkPayDate);
          setSelectedIds([]);
          setBulkPayConfirm(false);
        }}
      />

    </div>
  );
};
