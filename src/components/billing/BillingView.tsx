import { formatPKR } from '../../services/financeDomain';
import { invoiceBalanceDue, hasLivePayment } from '../../services/financeDomain';
import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Invoice, PaymentRecord, AccountAdjustment } from '../../types';
import { downloadCSV } from '../../services/csvExport';
import { canPost } from '../../services/permissions';
import { ConfirmDialog } from '../common/ui';
import { InvoiceStatementModal } from './InvoiceStatementModal';
import { CaseJobSlipModal } from '../cases/CaseJobSlipModal';
import { PaymentProofModal } from './PaymentProofModal';
import { PaymentReceiptModal } from './PaymentReceiptModal';
import { invoiceMatchesSearch } from '../../services/invoiceSearch';
import { attributeAdjustmentsToInvoices } from '../../services/adjustmentAttribution';
import {
  buildUnifiedTransactions,
  filterUnifiedTransactions,
  transactionCsvRows,
  type UnifiedTransaction,
} from '../../services/transactionRegister';
import { RecordTransactionModal } from './RecordTransactionModal';
import { JournalEntryModal } from './JournalEntryModal';
import { InvoiceDetailDrawer } from './InvoiceDetailDrawer';
import EditPaymentModal from './EditPaymentModal';
import { EditAdjustmentModal } from './EditAdjustmentModal';
import { ClinicStatementModal } from './ClinicStatementModal';
import { PageHeader, EmptyState, DataTable, FilterBar, usePagination } from '../common/ui';
import { BILLING_TABS, labelOf } from '../common/financeTabs';
import { getTodayStr } from '../../utils/dateUtils';
import { formatDoctorName } from '../../utils/doctorName';
import { findCaseForInvoice } from '../../services/ledgerCaseDetail';
import { Wallet, Download, Trash2, Pencil, FileSpreadsheet, ArrowDownLeft } from 'lucide-react';


/** One payment voucher = one receipt, even when it adjusted several invoices. */
interface BillingVoucher {
  id: string;
  number: string;
  date: string;
  clinic: string;
  labId: string;
  method: string;
  amount: number;
  invoices: { number: string; amount: number }[];
  slices: PaymentRecord[];
}

export const BillingView: React.FC = () => {
  const { 
    invoices, 
    cases, 
    allPayments,
    advancePayments,
    accountAdjustments,

    deleteInvoice,
    getLabFinancialSummary,
    deletePaymentV2,
    updatePaymentV2,
    deleteAccountAdjustment,
    updateAccountAdjustment,
    user,
  } = useApp();

  // Core navigation. Clinic accounts, the double-entry ledger, the audit
  // trail and the monthly report/statement archives are the read-only side of
  // the money — they live in Analytics & Reports. This module is money in.


  // Invoices tab filter states
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [clinicFilter, setClinicFilter] = useState<string>('all');
  // Invoice history window: the date picker sits on TODAY by default (it is the
  // range every cashier means when they open this screen). Yesterday's and older
  // invoices are reached by rewinding the picker; selecting All Time lists them
  // oldest first, like a ledger page.
  const [invFromDate, setInvFromDate] = useState<string>(getTodayStr());
  const [invToDate, setInvToDate] = useState<string>(getTodayStr());

  // Finance 2.0 Unified & Inspection Modals
  const [selectedDrawerInvoice, setSelectedDrawerInvoice] = useState<Invoice | null>(null);
  const [journalModalRef, setJournalModalRef] = useState<string | null>(null);
  /* A payment entry queued for deletion. Deleting money needs the same room to
     explain itself that voiding an invoice gets — the invoice balance and the
     ledger both move. */
  const [paymentToDelete, setPaymentToDelete] = useState<PaymentRecord | null>(null);
  const [paymentGroupToDelete, setPaymentGroupToDelete] = useState<PaymentRecord[] | null>(null);
  /* The voucher being corrected. Reading one opens the receipt modal, which is a
     different intent from changing it. */
  const [voucherToEdit, setVoucherToEdit] = useState<PaymentRecord | null>(null);
  /* Adjustments live in the register below the invoice table: credit notes are
     clinic-level (FIFO across invoices), so a single row cannot own them. */
  const [adjustmentToEdit, setAdjustmentToEdit] = useState<AccountAdjustment | null>(null);
  const [adjustmentToDelete, setAdjustmentToDelete] = useState<AccountAdjustment | null>(null);
  const [isUnifiedRecordModalOpen, setIsUnifiedRecordModalOpen] = useState<boolean>(false);
  /* Two things only: money against an invoice, or money held on account.
     Credit notes and refunds were removed from the recorder — see
     RecordTransactionModal.tsx for why — so the union narrows with them. */
  const [unifiedModalMode, setUnifiedModalMode] = useState<'payment' | 'advance_deposit'>('payment');
  const [unifiedModalLabId, setUnifiedModalLabId] = useState<string | undefined>(undefined);
  const [unifiedModalInvoiceId, setUnifiedModalInvoiceId] = useState<string | undefined>(undefined);
  const [clinicStatementModalId, setClinicStatementModalId] = useState<string | null>(null);



  const [printModalInvoice, setPrintModalInvoice] = useState<Invoice | null>(null);
  const [viewSlipCase, setViewSlipCase] = useState<any>(null);
  const [selectedProofPayment, setSelectedProofPayment] = useState<PaymentRecord | null>(null);
  const [selectedReceiptPayment, setSelectedReceiptPayment] = useState<{ payment: PaymentRecord; invoice?: Invoice } | null>(null);

  // Helper to determine if an invoice is overdue


  // Selected clinic financial summary and info
  const selectedLabSummary = useMemo(() => {
    if (clinicFilter === 'all') return null;
    return getLabFinancialSummary(clinicFilter);
  }, [clinicFilter, getLabFinancialSummary]);

  /* Which adjustments belong on each invoice row.
   *
   * Credit notes are clinic-level documents applied FIFO across open invoices,
   * so they are replayed here against the same clinic invoices to give each one
   * a home row. Debit adjustments and refunds carry no invoice effect; they are
   * parked on the clinic's oldest invoice so they can still be read, corrected
   * and deleted from the invoice module. Old rows need no migration — they are
   * attributed the moment they load. */
  const adjustmentsByInvoice = useMemo(
    () => attributeAdjustmentsToInvoices(invoices, accountAdjustments || []),
    [invoices, accountAdjustments],
  );

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
      // A credit note is money against the invoice too, so an invoice settled
      // only by credit stays visible on the one screen that can correct it.
      // The same goes for an invoice whose only money document is a
      // clinic-level adjustment landed on it.
      if (
        !hasLivePayment(inv) &&
        !(inv.credit_notes_total || 0) &&
        !adjustmentsByInvoice.has(inv.id)
      ) {
        return false;
      }

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
  }, [invoices, clinicFilter, searchTerm, invFromDate, invToDate, adjustmentsByInvoice]);

  /* All Time is read like a ledger page: oldest first, newest last. Any picked
     window (today, this month…) keeps the store's natural order. The sort runs
     on the fresh filter array, never on the store itself. */
  const sortedFilteredInvoices = useMemo(() => {
    if (invFromDate || invToDate) return filteredInvoices;
    return [...filteredInvoices].sort((a, b) =>
      String(a.created_at || '').localeCompare(String(b.created_at || '')),
    );
  }, [filteredInvoices, invFromDate, invToDate]);

  /* One row per payment voucher, not per invoice. A 150,000 payment that
     adjusted two invoices is ONE voucher of 150,000; clicking it opens the
     receipt listing the invoices it adjusted. The invoice slices are grouped
     back by their shared payment number (PAY-YYYY-NNNN-1, -2, …). */
  const allVouchers = useMemo<BillingVoucher[]>(() => {
    const groups = new Map<string, PaymentRecord[]>();
    for (const inv of invoices) {
      for (const p of inv.payments || []) {
        const base = (p.payment_number || p.id).replace(/-\d+$/, '');
        if (!groups.has(base)) groups.set(base, []);
        groups.get(base)!.push(p);
      }
    }
    return Array.from(groups.entries()).map(([base, slices]) => {
      const primary = slices[0];
      return {
        id: base,
        number: base,
        date: primary.payment_date || '',
        clinic: primary.lab_name || '',
        labId: primary.lab_id || '',
        method: primary.payment_method,
        amount: slices.reduce((s, p) => s + (p.amount || 0), 0),
        invoices: slices.map((p) => ({ number: p.invoice_number || '', amount: p.amount || 0 })),
        slices,
      };
    });
  }, [invoices]);

  const filteredVouchers = useMemo(() => {
    return allVouchers.filter((v) => {
      const day = (v.date || '').slice(0, 10);
      if (invFromDate && (!day || day < invFromDate)) return false;
      if (invToDate && (!day || day > invToDate)) return false;
      if (clinicFilter !== 'all' && v.labId !== clinicFilter) return false;
      if (searchTerm.trim()) {
        const hay = [v.number, v.clinic, ...v.invoices.map((i) => i.number)].join(' ').toLowerCase();
        if (!hay.includes(searchTerm.trim().toLowerCase())) return false;
      }
      return true;
    }).sort((a, b) =>
      invFromDate || invToDate
        ? String(b.date).localeCompare(String(a.date))
        : String(a.date).localeCompare(String(b.date)),
    );
  }, [allVouchers, invFromDate, invToDate, clinicFilter, searchTerm]);

  /* Paged, not incrementally grown. Mounting 1000+ heavy rows froze scroll and
     search on volume datasets; the old render cap bounded the first paint but
     then kept stacking already-mounted rows into the same DOM. Paging swaps a
     page at a time, so the node count stays flat no matter the dataset size. */
  /* Vouchers are paged the same way — one row per receipt, not per invoice. */
  const {
    pageItems: visibleVouchers,
    pagination: vouchersPagination,
  } = usePagination(filteredVouchers, {
    initialPageSize: 50,
    resetKey: `${clinicFilter}|${searchTerm}|${invFromDate}|${invToDate}`,
  });

  /*
   * The voucher export's rows, built from every stored money document and
   * filtered by the SAME controls the invoice table uses.
   *
   * Two filter bands once sat on this page — one per table — and they disagreed
   * the moment either changed: filtering to one clinic left the register listing
   * every other clinic's receipts. One band, one query, one export.
   */
  const registerTransactions = useMemo<UnifiedTransaction[]>(() => {
    return filterUnifiedTransactions(
      buildUnifiedTransactions({ allPayments, advancePayments, accountAdjustments, invoices }),
      { search: searchTerm, fromDate: invFromDate, toDate: invToDate, clinicId: clinicFilter },
    );
  }, [allPayments, advancePayments, accountAdjustments, invoices, searchTerm, invFromDate, invToDate, clinicFilter]);

  // B4/B10: both native confirm()s replaced by ConfirmDialog — a
  // ledger-reversing action needs room to explain consequences, and void
  // requires a typed phrase + the invoice:void permission (B3).
  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null);
  // Export Invoices to CSV (B9: RFC-4180 quoting — clinics with commas/quotes
  // used to break rows under the old hand-rolled joiner)
  const handleExportInvoicesCSV = () => {
    const headers = ['Invoice #', 'Case #', 'Dental Clinic', 'Doctor', 'Material / Type', 'Final Amount (PKR)', 'Amount Paid (PKR)', 'Remaining (PKR)', 'Status', 'Due Date'];
    const rows = sortedFilteredInvoices.map(inv => [
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
                className="px-4 py-2 ds-glass-pill active:scale-[0.98] font-semibold text-xs flex items-center gap-2 transition-all cursor-pointer"
              >
                <ArrowDownLeft className="w-4 h-4 shrink-0" />
                <span>
                  {selectedLabSummary && (selectedLabSummary.outstanding_balance || 0) > 0
                    ? `Receive Payment (${formatPKR(selectedLabSummary.outstanding_balance || 0)})`
                    : 'Receive Payment'}
                </span>
              </button>

            {/* Batch printing has its own module page under Billing & Invoices
                (sidebar → Print Invoices), so the duplicate entry point that
                used to sit in this header is gone. */}

            {clinicFilter !== 'all' && (
              <button
                type="button"
                onClick={() => setClinicStatementModalId(clinicFilter)}
                className="ds-glass-pill active:scale-[0.98] font-semibold text-xs flex items-center gap-2 transition-all cursor-pointer"
                title="Open the official statement of account for the selected clinic"
              >
                <FileSpreadsheet className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>Clinic Statement</span>
              </button>
            )}

            {/* The "Credit Note / Adjustment" button is gone. Issuing a credit note
                is a write-off decision, not a collection, and the operator removed
                it from the recorder. Credit notes already issued still show on the
                invoice drawer and still net off the balance. */}

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
                  className="px-3 py-1.5 ds-glass-pill text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Export Invoices CSV</span>
                </button>
                <button
                  onClick={handleExportTransactionsCSV}
                  className="px-3 py-1.5 ds-glass-pill text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
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
          <div className="ds-glass-card rounded-2xl overflow-hidden">
          <DataTable<BillingVoucher>
            data={visibleVouchers}
            rowKey={(v) => v.id}
            onRowClick={(v) => {
              const primary = v.slices[0];
              setSelectedReceiptPayment({
                payment: { ...primary, payment_number: v.number, amount: v.amount } as PaymentRecord,
              });
            }}
            emptyState={
              <div className="p-6">
                <EmptyState
                  icon={Wallet}
                  title="No payment vouchers match the active filters"
                  description="Each row is one payment receipt. Widen the date range or clear the search to see more vouchers."
                  actionLabel="Reset Filters & Show All Dates"
                  onAction={() => {
                    setSearchTerm('');
                    setClinicFilter('all');
                    setInvFromDate('');
                    setInvToDate('');
                  }}
                />
              </div>
            }
            footer={vouchersPagination ?? undefined}
            columns={[
              {
                header: 'Voucher #',
                className: 'font-mono font-bold text-slate-900 whitespace-nowrap',
                render: (v: BillingVoucher) => (
                  <span className="text-indigo-700" title="Click the row to see the invoices this voucher adjusted">
                    {v.number}
                  </span>
                ),
              },
              {
                header: 'Dental Clinic',
                className: 'font-semibold text-slate-900 whitespace-nowrap',
                render: (v: BillingVoucher) => v.clinic || '-',
              },
              {
                header: 'Date',
                className: 'whitespace-nowrap tabular-nums',
                render: (v: BillingVoucher) => v.date || '-',
              },
              {
                header: 'Method',
                className: 'uppercase text-[11px] text-slate-600 whitespace-nowrap',
                render: (v: BillingVoucher) => v.method || '-',
              },
              {
                header: 'Adjusted Invoices',
                render: (v: BillingVoucher) => (
                  <div className="flex flex-wrap gap-1">
                    {v.invoices.map((i) => (
                      <span key={i.number} className="text-[11px] font-mono bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                        {i.number} · {formatPKR(i.amount)}
                      </span>
                    ))}
                  </div>
                ),
              },
              {
                header: 'Amount',
                align: 'right',
                className: 'font-mono font-bold text-emerald-700 whitespace-nowrap tabular-nums',
                render: (v: BillingVoucher) => formatPKR(v.amount),
              },
              {
                header: 'Actions',
                align: 'right',
                className: 'whitespace-nowrap',
                render: (v: BillingVoucher) => (
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setVoucherToEdit(v.slices[0]); }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-slate-100 active:scale-[0.96] transition-colors cursor-pointer"
                      title={`Edit voucher ${v.number}`}
                      aria-label={`Edit voucher ${v.number}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setPaymentGroupToDelete(v.slices); }}
                      className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 active:scale-[0.96] transition-colors cursor-pointer"
                      title={`Delete voucher ${v.number}`}
                      aria-label={`Delete voucher ${v.number}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ),
              },
            ]}
          />
          </div>

          {/* Adjustments no longer get their own register. They show on the
              invoice rows they affect — with their invoice number — exactly
              like every other money document on this screen. */}

        </div>

      {/* No payments register and no adjustments register. They used to sit
          under the invoice table, repeating facts the rows already carry — two
          surfaces for one fact, and the operator had to learn which one to edit
          a mistyped amount in. Payments live on the row's Actions (read via the
          receipt, correct, delete); adjustments live in the Adjustments column
          with their serial and invoice number. `registerTransactions` still
          feeds the vouchers CSV. */}

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
          /* The user adds money and wants to SEE the complete payment: open
             the official receipt immediately, which names every invoice the
             payment was adjusted against and its amount. */
          onSuccess={(result) => {
            if (result.payment) setSelectedReceiptPayment({ payment: result.payment });
          }}
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
        attributedAdjustments={
          selectedDrawerInvoice
            ? adjustmentsByInvoice.get(selectedDrawerInvoice.id)
            : undefined
        }
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
        onDeletePaymentGroup={(pays) => setPaymentGroupToDelete(pays)}
        onEditAdjustment={(adj) => setAdjustmentToEdit(adj)}
        onDeleteAdjustment={(adj) => setAdjustmentToDelete(adj)}
        onVoidInvoice={(inv) => setVoidTarget(inv)}
        canVoid={canPost(user, 'invoice:void')}
        canEditAdjustments={canPost(user, 'credit:issue') || canPost(user, 'debit:issue') || canPost(user, 'refund:issue')}
        canDeleteAdjustments={canPost(user, 'payment:edit')}
      />

      {/* Correcting a voucher: amount, method, date and reference. Saving
          rebuilds the receipt's journal, so the register, the general ledger
          and the printed invoice all move together. */}
      <EditPaymentModal
        isOpen={!!voucherToEdit}
        payment={voucherToEdit}
        invoices={invoices}
        labId={voucherToEdit?.lab_id}
        onSave={(id, patch) => updatePaymentV2(id, patch)}
        onDelete={(pay) => setPaymentToDelete(pay)}
        onClose={() => setVoucherToEdit(null)}
      />

      {/* Correcting an adjustment: amount, date, reason and reference. Credit
          notes reverse their old invoice credit and re-apply the corrected one
          before the register, invoice rows and ledger refresh. */}
      {adjustmentToEdit && (
        <EditAdjustmentModal
          adjustment={adjustmentToEdit}
          onSave={(id, patch) => updateAccountAdjustment(id, patch)}
          onClose={() => setAdjustmentToEdit(null)}
        />
      )}

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

      {/* Deleting a grouped (multi-invoice) payment removes every slice of it. */}
      <ConfirmDialog
        open={!!paymentGroupToDelete}
        title={`Delete payment ${paymentGroupToDelete?.[0]?.payment_number?.replace(/-\d+$/, '') || ''}`}
        consequences={[
          `The receipt, its journal entry and all bank-reconciliation items raised for it are removed; ${(paymentGroupToDelete?.length || 1)} invoice slice(s) revert.`,
          'A PAYMENT_DELETED audit entry records who deleted it.',
        ]}
        confirmLabel="Delete Payment"
        onCancel={() => setPaymentGroupToDelete(null)}
        onConfirm={() => {
          if (paymentGroupToDelete) {
            for (const p of paymentGroupToDelete) deletePaymentV2(p.id);
          }
          setPaymentGroupToDelete(null);
        }}
      />

      {/* Deleting an adjustment moves money. The ledger row is the whole
          effect — adjustments never settle invoices — so the consequences name
          the direction the clinic's balance moves. */}
      <ConfirmDialog
        open={!!adjustmentToDelete}
        title={`Delete adjustment ${adjustmentToDelete?.adjustment_number || ''}`}
        consequences={[
          adjustmentToDelete?.type === 'credit_note'
            ? `The credit leaves ${adjustmentToDelete?.lab_name || 'the clinic'}'s ledger, so the clinic's balance rises by ${(adjustmentToDelete?.amount || 0).toLocaleString()} PKR.`
            : adjustmentToDelete?.type === 'debit_adjustment'
            ? `${adjustmentToDelete?.lab_name || 'The clinic'}'s balance falls by ${(adjustmentToDelete?.amount || 0).toLocaleString()} PKR.`
            : `The ${adjustmentToDelete?.type?.replace('_', ' ') || 'adjustment'} leaves the invoice list and the ledger.`,
          'The entry disappears from the invoice list, the ledger and the reports.',
          'Any journal posting and attachments recorded with it are removed as well.',
        ]}
        confirmLabel="Delete Adjustment"
        onCancel={() => setAdjustmentToDelete(null)}
        onConfirm={() => {
          if (adjustmentToDelete) deleteAccountAdjustment(adjustmentToDelete.id);
          setAdjustmentToDelete(null);
        }}
      />


    </div>
  );
};
