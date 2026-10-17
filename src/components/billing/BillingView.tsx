import { formatPKR } from '../../services/financeDomain';
import { invoiceBalanceDue, hasLivePayment } from '../../services/financeDomain';
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
import { invoiceMatchesSearch } from '../../services/invoiceSearch';
import {
  buildUnifiedTransactions,
  filterUnifiedTransactions,
  transactionCsvRows,
  type UnifiedTransaction,
} from '../../services/transactionRegister';
import { BatchInvoicePrintModal } from './BatchInvoicePrintModal';
import { RecordTransactionModal } from './RecordTransactionModal';
import { JournalEntryModal } from './JournalEntryModal';
import { InvoiceDetailDrawer } from './InvoiceDetailDrawer';
import EditPaymentModal from './EditPaymentModal';
import { ClinicStatementModal } from './ClinicStatementModal';
import { PageHeader, EmptyState, DataTable, FilterBar, usePagination } from '../common/ui';
import { BILLING_TABS, labelOf } from '../common/financeTabs';
import { todayISO } from '../common/DatePickerRange';
import { getTodayStr } from '../../utils/dateUtils';
import { formatDoctorName } from '../../utils/doctorName';
import { findCaseForInvoice } from '../../services/ledgerCaseDetail';
import { invoiceBadge } from '../../services/invoiceBadge';
import { 
  Wallet,
  Printer,
  Search, 
  Download, 
  Trash2,
  Pencil,
  CheckCircle2, 
  AlertTriangle,
  Clock,
  ArrowDownLeft,
  Eye,
  FileSpreadsheet
} from 'lucide-react';

export const BillingView: React.FC = () => {
  const { 
    invoices, 
    cases, 
    allPayments,
    advancePayments,
    accountAdjustments,
    bulkMarkPaid, 
    deleteInvoice,
    getLabFinancialSummary,
    deletePaymentV2,
    updatePaymentV2,
    user
  } = useApp();

  // Core navigation. Clinic accounts, the double-entry ledger, the audit
  // trail and the monthly report/statement archives are the read-only side of
  // the money — they live in Analytics & Reports. This module is money in.


  // Invoices tab filter states
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [clinicFilter, setClinicFilter] = useState<string>('all');
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
  /* A payment entry queued for deletion. Deleting money needs the same room to
     explain itself that voiding an invoice gets — the invoice balance and the
     ledger both move. */
  const [paymentToDelete, setPaymentToDelete] = useState<PaymentRecord | null>(null);
  /* The voucher being corrected. Reading one opens the receipt modal, which is a
     different intent from changing it. */
  const [voucherToEdit, setVoucherToEdit] = useState<PaymentRecord | null>(null);
  const [isUnifiedRecordModalOpen, setIsUnifiedRecordModalOpen] = useState<boolean>(false);
  /* Two things only: money against an invoice, or money held on account.
     Credit notes and refunds were removed from the recorder — see
     RecordTransactionModal.tsx for why — so the union narrows with them. */
  const [unifiedModalMode, setUnifiedModalMode] = useState<'payment' | 'advance_deposit'>('payment');
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
    const remaining = invoiceBalanceDue(inv);
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

  // Filtered Invoices
  //
  // ONLY invoices that have been paid against appear here. An invoice becomes a
  // Billing row the moment a payment lands on it, which is what makes this
  // screen a record of vouchers rather than a wall of bills. Nothing is lost by
  // it: an invoice with no payment is something the operator goes to look for
  // while taking money, in Receive Payment → Invoice Allocations, which is
  // where a payment can actually be applied to it.
  //
  // A reversed payment does not count. It was undone, so the invoice is unpaid
  // again and belongs back in the allocation list, not on a screen of records.
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (!hasLivePayment(inv)) return false;

      // Date range on the billing day (created_at is 'YYYY-MM-DD HH:mm')
      const day = (inv.created_at || '').slice(0, 10);
      if (invFromDate && (!day || day < invFromDate)) return false;
      if (invToDate && (!day || day > invToDate)) return false;

      // Clinic filter
      if (clinicFilter !== 'all' && inv.lab_id !== clinicFilter) {
        return false;
      }

      // Search — every field of the invoice, not just its numbers and names.
      if (!invoiceMatchesSearch(inv, searchTerm)) return false;

      return true;
    });
  }, [invoices, clinicFilter, searchTerm, invFromDate, invToDate]);

  /* Whether the clinic has ANY paid invoice at all, ignoring every filter. The
     empty state needs it to tell "nothing paid yet" apart from "your filters
     hid everything" — two problems with opposite fixes. */
  const hasAnyPaidInvoice = useMemo(
    () => invoices.some((inv) => hasLivePayment(inv)),
    [invoices],
  );

  /* Paged, not incrementally grown. Mounting 1000+ heavy rows froze scroll and
     search on volume datasets; the old render cap bounded the first paint but
     then kept stacking already-mounted rows into the same DOM. Paging swaps a
     page at a time, so the node count stays flat no matter the dataset size. */
  const {
    pageItems: visibleInvoices,
    pagination: invoicesPagination,
  } = usePagination(filteredInvoices, {
    initialPageSize: 50,
    resetKey: `${clinicFilter}|${searchTerm}|${invFromDate}|${invToDate}`,
  });

  /*
   * The payments register underneath the invoice table, built from every stored
   * money document and filtered by the SAME controls the table above it uses.
   *
   * Two filter bands once sat on this page — one per table — and they disagreed
   * the moment either changed: filtering to one clinic left the register listing
   * every other clinic's receipts. One band, one query, both lists.
   */
  const registerTransactions = useMemo<UnifiedTransaction[]>(() => {
    return filterUnifiedTransactions(
      buildUnifiedTransactions({ allPayments, advancePayments, accountAdjustments, invoices }),
      { search: searchTerm, fromDate: invFromDate, toDate: invToDate, clinicId: clinicFilter },
    );
  }, [allPayments, advancePayments, accountAdjustments, invoices, searchTerm, invFromDate, invToDate, clinicFilter]);

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
    const headers = ['Invoice #', 'Case #', 'Dental Clinic', 'Doctor', 'Material / Type', 'Final Amount (PKR)', 'Amount Paid (PKR)', 'Remaining (PKR)', 'Status', 'Due Date'];
    const rows = filteredInvoices.map(inv => [
      inv.invoice_number,
      inv.case_number,
      inv.lab_name,
      formatDoctorName(inv.doctor_name, ''),
      inv.case_type_name,
      inv.final_amount,
      inv.amount_paid || 0,
      invoiceBalanceDue(inv),
      inv.payment_status.toUpperCase(),
      inv.due_date
    ]);
    downloadCSV(`Dental_Solutions_Invoices_${getTodayStr()}`, [headers, ...rows]);
  };

  /* Exports exactly what the register is showing — the same rows the operator
     can see, under the same filters. */
  const handleExportTransactionsCSV = () => {
    downloadCSV(
      `Dental_Solutions_Transactions_${getTodayStr()}`,
      transactionCsvRows(registerTransactions),
    );
  };

/* Pill + subtext for one invoice. The DECISION lives in services/invoiceBadge
   (derived from the balance, never from the stored payment_status, and never
   sharing the overdue danger treatment); this only paints it. */
  const getStatusBadge = (inv: Invoice) => {
    const badge = invoiceBadge(inv);
    const PAINT = {
      paid: {
        pill: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        sub: 'text-slate-500',
        Icon: CheckCircle2,
        ink: 'text-ink-success',
      },
      overdue: {
        pill: 'bg-rose-100 text-rose-800 border-rose-200',
        sub: 'text-ink-danger font-bold',
        Icon: AlertTriangle,
        ink: 'text-ink-danger',
      },
      /* Partial and Pending are both 'fine for now' - amber, deliberately not
         rose, so only Overdue reads as chase-me. */
      partial: {
        pill: 'bg-amber-50 text-amber-800 border-amber-200',
        sub: 'text-amber-700 font-semibold',
        Icon: Clock,
        ink: 'text-ink-warning',
      },
      pending: {
        pill: 'bg-amber-50 text-amber-800 border-amber-200',
        sub: 'text-amber-700 font-semibold',
        Icon: Clock,
        ink: 'text-ink-warning',
      },
    }[badge.tone];

    return (
      <div className="inline-flex flex-col items-center">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${PAINT.pill}`}>
          <PAINT.Icon className={`w-3 h-3 ${PAINT.ink}`} />
          <span>{badge.label}</span>
        </span>
        {/* An empty detail renders nothing — an invoice inside its terms has
            no second fact worth the width. */}
        {badge.detail && (
          <span className={`text-[11px] mt-0.5 whitespace-nowrap ${PAINT.sub}`}>{badge.detail}</span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 billing-module no-scrollbar">
      
      {/* Module Title and Unified Action Buttons Header */}
      <PageHeader
        title="Billing, Invoicing & Receivables"subtitle="Clinic invoices & payments register • Clinic accounts, ledger, audit trail and statement archives live under Analytics & Reports"
        breadcrumbs={[
          { label: 'Financial Hub' },
          {
            label: labelOf(BILLING_TABS, 'invoices')
          }
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* The "Pay / Refund Clinic" button that used to open the recorder in
                refund mode is gone. Refund was money OUT and the operator removed
                it; a clinic holding advance credit now has it drawn down by later
                invoices (Clinic Credit Wallet) rather than paid back. */}
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
                    ? `Receive Payment (${formatPKR(selectedLabSummary.outstanding_balance || 0)})`
                    : 'Receive Payment'}
                </span>
              </button>

            <button
              type="button"
              onClick={() => setBatchPrintOpen(true)}
              className="px-3.5 py-2 bg-white hover:bg-slate-50 active:scale-[0.98] text-slate-800 border border-slate-300 font-semibold text-xs rounded-xl shadow-2xs flex items-center gap-2 transition-all cursor-pointer"
              title="Print every invoice for one clinic over a month or date range - paid, partly paid and unpaid"
            >
              <Printer className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>Batch Print Invoices</span>
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

            {/* The "Credit Note / Adjustment" button is gone. Issuing a credit note
                is a write-off decision, not a collection, and the operator removed
                it from the recorder. Credit notes already issued still show on the
                invoice drawer and still net off the balance. */}

            {selectedIds.length > 0 && (
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

      {/* TAB 1: INVOICES & RECEIVABLES */}
      <div className="space-y-5">

          {/* Search, Clinic Dropdown & Filter Controls */}
          <FilterBar
            search={{
              value: searchTerm,
              onChange: setSearchTerm,
              placeholder: 'Search patient, invoice #, case #, doctor, clinic, amount, receipt ref...',
            }}
            dateRange={{
              from: invFromDate,
              to: invToDate,
              onChange: (f, t) => {
                setInvFromDate(f);
                setInvToDate(t);
              },
            }}
            actions={
              <>
                <button
                  onClick={handleExportInvoicesCSV}
                  className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Export Invoices CSV</span>
                </button>
                <button
                  onClick={handleExportTransactionsCSV}
                  className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  {/* Named for what it now exports. It was "Transactions" because
                      the register below listed every money document; with the
                      register gone, the file is the vouchers. */}
                  <span>Export Vouchers CSV</span>
                </button>
              </>
            }
          />

          {/* Invoices Table */}
          {/* DataTable renders a BARE table — it no longer draws its own card,
              because every other table in the app already sits inside a card its
              view owns and adopting it card-in-card doubled the hairline, the shadow
              and fought the radius. The card stays here, where it always was. */}
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-2xs overflow-hidden">
          <DataTable<Invoice>
            data={visibleInvoices}
            rowKey={(inv) => inv.id}
            rowClassName={(inv) => {
              const remaining = invoiceBalanceDue(inv);
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
                {/* Two different reasons produce an empty table, and they need
                    different words. Telling an operator whose database has no
                    payments yet to "rewind the date picker" sends them hunting
                    through dates for a problem that has nothing to do with
                    dates. */}
                {hasAnyPaidInvoice ? (
                  <EmptyState
                    icon={Search}
                    title="No paid invoices match the active filters"
                    description="This list shows invoices that have money against them. Widen the date range or clear the search to see more of them."
                    actionLabel="Reset Filters & Show All Dates"
                    onAction={() => {
                      setSearchTerm('');
                      setClinicFilter('all');
                      setInvFromDate('');
                      setInvToDate('');
                    }}
                  />
                ) : (
                  <EmptyState
                    icon={Wallet}
                    title="No payments recorded yet"
                    description="An invoice appears here the moment a payment is received against it — this list is your record of vouchers. Nothing has been paid yet, so there is nothing to show."
                    actionLabel="Receive Payment"
                    onAction={() => {
                      setUnifiedModalInvoiceId(undefined);
                      setUnifiedModalLabId(undefined);
                      setUnifiedModalMode('payment');
                      setIsUnifiedRecordModalOpen(true);
                    }}
                  />
                )}
              </div>
            }
            footer={invoicesPagination ?? undefined}
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
                /* Patient, so a search by name lands on a row that says whose it
                   is. The search haystack already matched patient_name, but the
                   result came back as an invoice number with the name nowhere on
                   the screen - the operator had to open the drawer to learn they
                   had found the right row. Payment Status sits three columns to
                   the right, so one glance now answers both "whose" and "paid?".

                   Truncated rather than wrapped: the value is frequently a short
                   numeric patient id ("3178") but is sometimes a full name, and a
                   long one must not make the row three lines tall. */
                header: 'Patient',
                className: 'whitespace-nowrap',
                render: (inv: Invoice) => {
                  const name = (inv.patient_name || '').trim();
                  if (!name) return <span className="text-slate-300">-</span>;
                  const short = name.length > 18 ? `${name.slice(0, 17)}…` : name;
                  return (
                    <span className="text-slate-700" title={name}>
                      {short}
                    </span>
                  );
                },
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
                          title={`Clinic holds ${formatPKR(clinicSummary.advance_balance || 0)} unallocated advance deposit`}
                        >
                          Adv Avail
                        </span>
                      )}
                    </div>
                  );
                },
              },
              {
                header: 'Doctor',
                className: 'text-slate-600 whitespace-nowrap',
                render: (inv: Invoice) => formatDoctorName(inv.doctor_name),
              },
              {
                header: 'Final Amount',
                align: 'right',
                className: 'font-mono font-bold text-slate-900 whitespace-nowrap tabular-nums',
                render: (inv: Invoice) => formatPKR(inv.final_amount || 0),
              },
              {
                header: 'Amount Paid',
                align: 'right',
                className: 'font-mono font-semibold text-ink-success whitespace-nowrap tabular-nums',
                render: (inv: Invoice) => formatPKR(inv.amount_paid || 0),
              },
              {
                header: 'Remaining Due',
                align: 'right',
                className: 'whitespace-nowrap',
                render: (inv: Invoice) => {
                  const remaining = invoiceBalanceDue(inv);
                  const { isOverdue } = isInvoiceOverdue(inv);
                  return (
                    <span className={`font-mono font-bold tabular-nums ${
                      remaining > 0 ? (isOverdue ? 'text-ink-danger font-bold' : 'text-ink-warning') : 'text-ink-muted'
                    }`}>
                      {formatPKR(remaining)}
                    </span>
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
                header: 'Vouchers',
                className: 'whitespace-nowrap',
                /* The voucher IS the record on this screen, so each payment is
                   shown here with the three things an operator needs to do to it:
                   read it, correct it, delete it. Deleting removes the payment
                   and restores the invoice's balance — the invoice itself is
                   never touched. */
                render: (inv: Invoice) => {
                  const vouchers = inv.payments || [];
                  if (vouchers.length === 0) return <span className="text-slate-400">—</span>;
                  return (
                    <div className="space-y-1">
                      {vouchers.map((pay) => (
                        <div
                          key={pay.id}
                          className="flex items-center gap-1.5 text-[11px] bg-emerald-50/70 border border-emerald-200 rounded-md px-2 py-1"
                        >
                          <span className="font-mono font-bold text-emerald-800">
                            {pay.payment_number || 'PAY'}
                          </span>
                          <span className="font-mono tabular-nums text-slate-700">
                            {formatPKR(pay.amount || 0)}
                          </span>
                          <span className="text-slate-500">{pay.payment_date}</span>
                          <button
                            type="button"
                            onClick={() => setSelectedReceiptPayment({ payment: pay, invoice: inv })}
                            className="p-0.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded cursor-pointer"
                            title={`View voucher ${pay.payment_number || ''}`}
                            aria-label={`View voucher ${pay.payment_number || ''}`}
                          >
                            <Eye className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setVoucherToEdit(pay)}
                            className="p-0.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded cursor-pointer"
                            title={`Edit voucher ${pay.payment_number || ''}`}
                            aria-label={`Edit voucher ${pay.payment_number || ''}`}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPaymentToDelete(pay)}
                            className="p-0.5 text-slate-400 hover:text-ink-danger hover:bg-rose-50 rounded cursor-pointer"
                            title={`Delete voucher ${pay.payment_number || ''}`}
                            aria-label={`Delete voucher ${pay.payment_number || ''}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                },
              },
              {
                header: 'Actions',
                align: 'right',
                className: 'whitespace-nowrap',
                render: (inv: Invoice) => {
                  const remaining = invoiceBalanceDue(inv);
                  const isPaid = inv.payment_status === 'paid' || remaining <= 0;
                  const clinicSummary = getLabFinancialSummary(inv.lab_id);
                  return (
                    <div className="flex items-center justify-end gap-1.5">
                      {/* No per-row Receive button. A payment is recorded from
                          the payments register below the table, or from the
                          invoice breakdown drawer — one place to look, and two
                          fewer controls in a row that has to fit a small
                          screen. The settled/credit state still reads here so a
                          scan of the column tells you where each invoice stands. */}
                      {isPaid ? (
                        clinicSummary.outstanding_balance === 0 && clinicSummary.advance_balance > 0 ? (
                          /* A clinic holding advance credit has it drawn down by later
                             invoices (Clinic Credit Wallet) rather than refunded. */
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[11px] font-bold rounded-md border border-indigo-200"
                            title="Clinic holds advance credit. It is drawn down by later invoices."
                          >
                            <Wallet className="w-3 h-3 text-indigo-500" />
                            <span>Credit PKR {clinicSummary.advance_balance.toLocaleString()}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[11px] font-bold rounded-md border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-ink-success" />
                            <span>Cleared</span>
                          </span>
                        )
                      ) : null}

                      <button
                        onClick={() => setSelectedDrawerInvoice(inv)}
                        className="p-1.5 text-ink-muted hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                        title="Inspect Invoice Breakdown, Case Items & Settlement History" aria-label="Inspect invoice breakdown, case items and settlement history"
                      >
                        <Eye className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => setPrintModalInvoice(inv)}
                        className="p-1.5 text-ink-muted hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                        title="Print Invoice Statement" aria-label="Print invoice statement"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  );
                },
              },
            ]}
          />
          </div>

        </div>

      {/* No payments register. It used to sit directly under the invoice table,
          repeating every payment the Vouchers column already showed — two
          surfaces for one fact, and the operator had to learn which one to edit
          a mistyped amount in. The vouchers on the invoice row are now the only
          place a payment lives: read it, correct it, delete it, all from the row
          it belongs to. `registerTransactions` survives below solely as the data
          behind the vouchers CSV export. */}

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
        onOpenJournalModal={(refId) => setJournalModalRef(refId)}
        onPrintInvoice={(inv) => setPrintModalInvoice(inv)}
        onViewReceipt={(pay) => setSelectedReceiptPayment({ payment: pay })}
        onDeletePayment={(pay) => setPaymentToDelete(pay)}
        onVoidInvoice={(inv) => setVoidTarget(inv)}
        canVoid={canPost(user, 'invoice:void')}
      />

      {/* Correcting a voucher: amount, method, date and reference. Saving
          rebuilds the receipt's journal, so the register, the general ledger
          and the printed invoice all move together. */}
      <EditPaymentModal
        isOpen={!!voucherToEdit}
        payment={voucherToEdit}
        onSave={(id, patch) => updatePaymentV2(id, patch)}
        onDelete={(pay) => setPaymentToDelete(pay)}
        onClose={() => setVoucherToEdit(null)}
      />

      {/* Official Clinic Statement of Account Modal */}
      {clinicStatementModalId && (
        <ClinicStatementModal
          isOpen={!!clinicStatementModalId}
          onClose={() => setClinicStatementModalId(null)}
          clinicId={clinicStatementModalId}
        />
      )}

      {/* Batch print — every invoice for a clinic over a period, paid ones included */}
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
          caseData={findCaseForInvoice(printModalInvoice, cases)}
          cases={cases}
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

      {/* void = typed-phrase confirmation (invoice retired for good, number kept) */}
      <ConfirmDialog
        open={!!voidTarget}
        title={`Void invoice ${voidTarget?.invoice_number || ''}`}
        consequences={[
          `${voidTarget?.lab_name || 'The clinic'} will owe ${voidTarget ? invoiceBalanceDue(voidTarget) : 0} PKR again once the issuance journal is reversed.`,
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

      {/* Delete a payment entry. Never the invoice: voiding one stays on the
          invoice table, where its issuance journal and retired number are the
          things being explained. */}
      <ConfirmDialog
        open={!!paymentToDelete}
        title={`Delete payment ${paymentToDelete?.payment_number || ''}`}
        consequences={[
          `${paymentToDelete?.lab_name || 'The clinic'}'s balance goes back up by ${(paymentToDelete?.amount || 0).toLocaleString()} PKR on the invoice it paid.`,
          'The receipt, its journal entry and any bank reconciliation item raised for it are removed.',
          'A PAYMENT_DELETED audit entry records who deleted it.',
        ]}
        confirmLabel="Delete Payment"
        onCancel={() => setPaymentToDelete(null)}
        onConfirm={() => {
          if (paymentToDelete) deletePaymentV2(paymentToDelete.id);
          setPaymentToDelete(null);
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
