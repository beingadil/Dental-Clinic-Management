import { formatPKR, invoiceBalanceDue } from '../../services/financeDomain';
import { buildStatementAccountPosition } from '../../services/invoiceAccount';
import { buildLabFinancialSummary } from '../../services/ledgerDomain';
import { printCurrentDocument } from '../../utils/printDocument';
import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Invoice } from '../../types';
import {
  DatePickerRange,
  describeQuickRange,
  standardQuickRanges,
  todayISO,
} from '../common/DatePickerRange';
import { getTodayStr } from '../../utils/dateUtils';
import { formatDoctorName } from '../../utils/doctorName';
import { findCaseForInvoice } from '../../services/ledgerCaseDetail';
import { compareInvoiceNumbers } from '../../services/invoiceOrder';
import { paginateStatementInvoices } from '../../services/statementPagination';
import { PrintDocument, DEFAULT_ENABLED } from '../print/printRenderer';
import { SavePdfButton } from '../print/SavePdfButton';
import { loadPrintSettings, loadDocumentSections } from '../../services/printSettings';
import '../print/printStyles.css';
import { Printer, X, FileSpreadsheet, Building2, ChevronDown, Search } from 'lucide-react';
import { Modal } from '../common/ui';
import { ClinicPicker } from '../common/ui/ClinicPicker';

interface BatchInvoicePrintModalProps {
  /** Clinic pre-selected from the billing filter, if any. */
  initialLabId?: string;
  onClose: () => void;
  /** When true, the printer fills the viewport (used by the Billing → Printing
   *  sub-tab) instead of floating as a dialog over the app shell. */
  fullScreen?: boolean;
}

type InvoiceStatus = 'paid' | 'partial' | 'unpaid';

const STATUS_META: Record<InvoiceStatus, { label: string; chip: string }> = {
  paid: { label: 'Paid', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  partial: { label: 'Partial', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  unpaid: { label: 'Unpaid', chip: 'bg-rose-50 text-rose-700 border-rose-200' },
};

/**
 * Same derivation as the ledger's settlement badge: the money, never the
 * stored `payment_status` (which drifts after a credit note or write-off).
 */
const invoiceStatus = (inv: Invoice): InvoiceStatus => {
  if (invoiceBalanceDue(inv) <= 0) return 'paid';
  return (inv.amount_paid || 0) > 0 ? 'partial' : 'unpaid';
};

export const BatchInvoicePrintModal: React.FC<BatchInvoicePrintModalProps> = ({
  initialLabId,
  onClose,
  fullScreen = false,
}) => {
  const { labs, invoices, cases, brandingSettings, saveVoucherToSystem, getLabFinancialSummary, advancePayments, accountAdjustments } = useApp();

  const [labId, setLabId] = useState<string>(initialLabId || labs[0]?.id || '');
  // Default the period to today, matching every other billing tab; the quick
  // ranges below are the way out to a wider window.
  const [from, setFrom] = useState<string>(() => todayISO());
  const [to, setTo] = useState<string>(() => todayISO());
  const [excluded, setExcluded] = useState<string[]>([]);
  /* The list is a selection surface: a month can hold dozens of invoices and
     the operator usually needs to find one or two to exclude. */
  const [listSearch, setListSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  /* The paper preview is reassurance, not the task — collapsed by default so
     the list and the Print action fit one screen. */
  const [previewOpen, setPreviewOpen] = useState(false);
  const presets = useMemo(() => standardQuickRanges(), []);
  const thisMonth = presets.find((p) => p.label === 'This Month');
  const [printSettings] = useState(() => loadPrintSettings());
  /* Statement section list for the one-sheet batch summary. */
  const [statementSections] = useState<string[]>(() =>
    loadDocumentSections('statement', DEFAULT_ENABLED.statement)
  );

/* The clinic chooser is the shared <ClinicPicker>: a plain <select> listed every
     clinic as an <option>, which is fine at five clinics and useless at fifty —
     the operator had to scroll a list to find a name they already knew. The
     General Ledger needed the same thing and had grown its own copy; one
     component now serves both, so they cannot drift apart again. */

  const dateOf = (inv: Invoice) => String(inv.issue_date || inv.created_at || '').slice(0, 10);

  /* Every invoice for the chosen clinic inside the chosen period — NOT only the
     unpaid ones.

     This was filtered on `due > 0`, which hid exactly the invoices an operator
     running a month-end or fortnightly statement needs to see: the ones fully
     paid and the ones partly paid. The printed statement already carries Paid,
     Balance and Status columns, so a settled invoice is a row that reads
     "Paid 20,000 / Balance 0 / Full" — it is evidence the clinic paid, not
     noise. Dropping the filter means the date range alone decides what prints,
     which is what "pick 1 to 30 and see them all" means.

     Oldest first so the printed stack matches the ledger sequence. */
  const periodInvoices = useMemo(() => {
    return invoices
      .filter((inv) => {
        if (inv.lab_id !== labId) return false;
        const d = dateOf(inv);
        if (!d) return true;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      })
      /* Date order, then the number minted at booking time. The old comparator
         stopped at the date, so same-day invoices kept the store's newest-first
         order and a statement ran INV-0048 → INV-0022 instead of entry order. */
      .sort(
        (a, b) =>
          dateOf(a).localeCompare(dateOf(b)) ||
          compareInvoiceNumbers(a.invoice_number, b.invoice_number)
      );
  }, [invoices, labId, from, to]);

  /* What the operator can see right now. Search and status narrow the picker;
     they never change what is selected (the footer always reports the true
     selection, including rows the filter is hiding). */
  const visibleInvoices = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return periodInvoices.filter((inv) => {
      if (statusFilter !== 'all' && invoiceStatus(inv) !== statusFilter) return false;
      if (!q) return true;
      return [inv.invoice_number, inv.case_number, inv.patient_name, inv.doctor_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [periodInvoices, listSearch, statusFilter]);

  const selected = periodInvoices.filter((inv) => !excluded.includes(inv.id));
  const selectedTotal = selected.reduce(
    (sum, inv) => sum + invoiceBalanceDue(inv),
    0
  );

  const visibleIds = visibleInvoices.map((inv) => inv.id);
  const selectedVisible = visibleInvoices.filter((inv) => !excluded.includes(inv.id)).length;
  const allVisibleSelected = visibleInvoices.length > 0 && selectedVisible === visibleInvoices.length;
  const someVisibleSelected = selectedVisible > 0 && !allVisibleSelected;

  /* Header checkbox: acts on the rows the filter is showing. Clicking an
     indeterminate box selects all of them, the standard table behaviour. */
  const toggleVisible = () => {
    setExcluded((prev) => {
      if (allVisibleSelected) {
        return Array.from(new Set([...prev, ...visibleIds]));
      }
      return prev.filter((id) => !visibleIds.includes(id));
    });
  };

  /* A selection longer than one sheet is split into sheets that each fit the
     paper, so nothing is sliced mid-row. The sheet count follows the live
     print settings — switch to Letter or Large text and it re-paginates. */
  const pages = useMemo(
    () => paginateStatementInvoices(selected, cases, printSettings),
    [selected, cases, printSettings]
  );
  const pageCount = pages.length;

  const toggle = (id: string) =>
    setExcluded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectedClinic = labs.find((l) => l.id === labId);

  /* The printed statement has to reconcile with the clinic's account, not just
     the selected invoices: an advance deposit already held (or earlier unpaid
     invoices) belongs in the opening balance. Built from the same summary the
     ledger uses so the two cannot drift. */
  const clinicSummary = useMemo(() => {
    if (!selectedClinic) return null;
    if (typeof getLabFinancialSummary === 'function') {
      return getLabFinancialSummary(selectedClinic.id);
    }
    return buildLabFinancialSummary({
      labId: selectedClinic.id,
      invoices,
      advancePayments: advancePayments || [],
      accountAdjustments: accountAdjustments || [],
      labs,
    });
  }, [selectedClinic, getLabFinancialSummary, invoices, labs, advancePayments, accountAdjustments]);

  const statementAccountPosition = useMemo(() => {
    if (!clinicSummary || selected.length === 0) return null;
    return buildStatementAccountPosition({
      invoices: selected,
      netBalance: clinicSummary.net_balance,
      advanceBalance: clinicSummary.advance_balance,
    });
  }, [clinicSummary, selected]);

  const handlePrint = () => {
    if (selected.length === 0) return;
    // Every printed billing document is logged, one voucher per invoice.
    selected.forEach((inv) => {
      const due = invoiceBalanceDue(inv);
      saveVoucherToSystem({
        voucher_number: inv.invoice_number,
        voucher_type: 'invoice',
        case_id: inv.case_id,
        case_number: inv.case_number,
        lab_name: inv.lab_name,
        doctor_name: inv.doctor_name,
        patient_name: inv.patient_name || 'Clinical Patient',
        case_type_name: inv.case_type_name,
        amount: inv.final_amount,
        notes: `Batch print (${selected.length} invoices) ${from || 'start'} → ${to || 'today'} — Paid: PKR ${(inv.amount_paid || 0).toLocaleString()} | Balance: PKR ${due.toLocaleString()}`,
      });
    });
    void printCurrentDocument();
  };

  return (
    // Card = print area, exactly like the single-invoice dialog: one sheet per
    // selected invoice, nothing wrapping the sheets in `.no-print`. The shared
    // Modal adds no wrapper of its own, so that contract is preserved.
    <Modal
      open
      onClose={onClose}
      label="Batch invoice printing"
      hideClose
      maxWidth={fullScreen ? 'max-w-full' : 'max-w-5xl'}
      backdropClassName={fullScreen ? 'bg-ds-sunken no-print-backdrop' : 'bg-slate-900/70 no-print-backdrop'}
      cardClassName={`print-area printable-area relative ${fullScreen ? 'h-[calc(100dvh-2rem)] rounded-2xl' : ''}`}
      headerClassName="no-print flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
      header={
        <>
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-slate-100 p-2 text-slate-700">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold tracking-tight text-slate-900">Batch Print Invoices</h3>
              <p className="text-xs text-slate-500">
                One statement for the period — paid, partly paid and unpaid.
              </p>
              {/* The confirmation the operator actually needs before pressing
                  Print: which clinic, which period, how many, how much. */}
              {selectedClinic && (
                <p className="mt-1 text-[11px] font-semibold text-indigo-700">
                  {selectedClinic.name} · {describeQuickRange(from, to)} ·{' '}
                  {selected.length} invoice{selected.length === 1 ? '' : 's'} ·{' '}
                  {formatPKR(selectedTotal)}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SavePdfButton
              suggestedName={`Invoices-${getTodayStr()}.pdf`}
              disabled={selected.length === 0}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-white border border-slate-300 px-4 py-1.5 text-xs font-bold text-slate-700 shadow-xs transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handlePrint}
              disabled={selected.length === 0}
              className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap ds-glass-pill px-4 py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-ink-muted"
            >
              <Printer className="h-4 w-4" /> Print {selected.length || ''} Invoice{selected.length === 1 ? '' : 's'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </>
      }
    >

        {/* Controls */}
        <div className="no-print grid grid-cols-1 gap-4 border-b border-slate-200 bg-slate-50/60 px-6 py-4 lg:grid-cols-12">
<div className="lg:col-span-5">
            <label htmlFor="batch-clinic-picker" className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600">
              <Building2 className="h-3.5 w-3.5 text-indigo-600" /> Clinic
            </label>

            {/* The shared searchable picker. It replaced a local copy of the same
                dropdown that had already drifted from the General Ledger's. */}
            <ClinicPicker
              id="batch-clinic-picker"
              clinics={labs}
              value={labId || null}
              onChange={(id) => {
                setLabId(id);
                // A new clinic invalidates every excluded row from the old one.
                setExcluded([]);
              }}
              tone="indigo"
              emptyLabel={(q) =>
                labs.length === 0 ? 'No clinics registered' : `No clinic matches "${q}"`
              }
            />
          </div>

          <div className="lg:col-span-7">
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600">
              Period
            </label>
            <DatePickerRange
              from={from}
              to={to}
              fullWidth
              onChange={(f, t) => {
                setFrom(f);
                setTo(t);
              }}
            />
          </div>
        </div>

        {/* Find / exclude toolbar. The list is a picker, not a report: a
            month can hold dozens of invoices and the usual job is "print all
            except this one", or "only the unpaid ones". */}
        <div className="no-print flex flex-wrap items-center gap-2 border-b border-slate-100 bg-white px-6 py-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
            <input
              type="text"
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              placeholder="Find patient, invoice #, case # or doctor…"
              aria-label="Search invoices in this batch"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="Filter by payment status">
            {(['all', 'unpaid', 'partial', 'paid'] as const).map((s) => {
              const active = statusFilter === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  aria-pressed={active}
                  className={`cursor-pointer rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {s === 'all' ? 'All' : STATUS_META[s].label}
                </button>
              );
            })}
          </div>
          {visibleInvoices.length !== periodInvoices.length && (
            <span className="text-[11px] tabular-nums text-slate-500">
              {visibleInvoices.length} of {periodInvoices.length} shown
            </span>
          )}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => setExcluded(periodInvoices.map((inv) => inv.id))}
              className="cursor-pointer text-[11px] font-semibold text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-800"
            >
              Clear selection
            </button>
          )}
        </div>

        {/* Selection list */}
        <div className="no-print max-h-72 overflow-y-auto border-b border-slate-100">
          {periodInvoices.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-bold text-slate-800">No invoices in this period</p>
              <p className="mt-1 text-xs text-slate-500">
                {selectedClinic
                  ? `${selectedClinic.name} has no invoices between ${from || 'the earliest record'} and ${to || 'today'}.`
                  : 'Select a clinic to continue.'}
              </p>
              {/* A dead end is a bug: give the two periods that usually hold
                  the invoices the operator came for. */}
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {thisMonth && (
                  <button
                    type="button"
                    onClick={() => {
                      setFrom(thisMonth.from);
                      setTo(thisMonth.to);
                    }}
                    className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50"
                  >
                    Show this month
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setFrom('');
                    setTo('');
                  }}
                  className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50"
                >
                  All time
                </button>
              </div>
            </div>
          ) : visibleInvoices.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-bold text-slate-800">No invoices match this filter</p>
              <p className="mt-1 text-xs text-slate-500">
                Clear the search or status filter to see all {periodInvoices.length} invoices in this period.
              </p>
              <button
                type="button"
                onClick={() => {
                  setListSearch('');
                  setStatusFilter('all');
                }}
                className="mt-3 cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50"
              >
                Clear filter
              </button>
            </div>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="ds-th">
                  <th scope="col" className="w-10 py-2.5 pl-6">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someVisibleSelected;
                      }}
                      onChange={toggleVisible}
                      aria-label={
                        allVisibleSelected
                          ? 'Deselect all invoices shown'
                          : 'Select all invoices shown'
                      }
                      className="h-4 w-4 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </th>
                  <th scope="col" className="py-2.5 px-3">Date</th>
                  <th scope="col" className="py-2.5 px-3">Invoice</th>
                  <th scope="col" className="py-2.5 px-3">Case</th>
                  <th scope="col" className="py-2.5 px-3">Doctor</th>
                  <th scope="col" className="py-2.5 px-6 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {visibleInvoices.map((inv) => {
                  const due = invoiceBalanceDue(inv);
                  const isOn = !excluded.includes(inv.id);
                  const linkedCase = findCaseForInvoice(inv, cases);
                  const status = STATUS_META[invoiceStatus(inv)];
                  return (
                    <tr
                      key={inv.id}
                      onClick={() => toggle(inv.id)}
                      className={`cursor-pointer transition-colors ${
                        isOn ? 'bg-indigo-50/40' : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2.5 pl-6 align-top">
                        <input
                          type="checkbox"
                          checked={isOn}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggle(inv.id)}
                          aria-label={`Include ${inv.invoice_number} in the batch`}
                          className="h-4 w-4 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="py-2.5 px-3 align-top text-slate-500">
                        {String(inv.issue_date || inv.created_at || '').slice(0, 10) || '—'}
                      </td>
                      <td className="py-2.5 px-3 align-top font-mono font-bold text-slate-900">{inv.invoice_number}</td>
                      {/* The job behind the invoice, so the operator can see
                          what they are about to print without opening each
                          case. Falls back to the bare case number. */}
                      <td className="py-2.5 px-3 align-top text-slate-600">
                        <span className="font-semibold text-slate-800">{inv.case_number || '—'}</span>
                        {linkedCase && (
                          <span className="mt-0.5 block text-[11px] leading-tight">
                            {[linkedCase.patient_name, linkedCase.case_type_name || linkedCase.case_type]
                              .filter(Boolean)
                              .join(' · ') || null}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 align-top text-slate-600">
                        {formatDoctorName(inv.doctor_name)}
                      </td>
                      <td className="py-2.5 px-6 text-right align-top">
                        <div className="font-mono font-bold text-slate-900">{formatPKR(due)}</div>
                        {/* Why the invoice is in the batch: a settled invoice
                            shows PKR 0 and would otherwise look like a mistake. */}
                        <span
                          className={`mt-1 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${status.chip}`}
                        >
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Selection total pinned BELOW the scroller: it is the confirmation
            before Print, so it must not scroll away with a long list. */}
        {periodInvoices.length > 0 && (
          <div className="no-print flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-100 px-6 py-2.5 text-xs font-bold text-slate-900">
            <span className="uppercase tracking-wider" aria-live="polite">
              {selected.length} of {periodInvoices.length} invoice
              {periodInvoices.length === 1 ? '' : 's'} selected
            </span>
            <span className="font-mono">{formatPKR(selectedTotal)}</span>
          </div>
        )}

        {/* Preview is reassurance, not the task. It stays in the DOM so the
            print stylesheet has its sheets, but `hidden print:block` keeps it
            off the screen until asked for — the list and Print fit one screen. */}
        <div className="no-print flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-2">
          <button
            type="button"
            onClick={() => setPreviewOpen((o) => !o)}
            aria-expanded={previewOpen}
            aria-controls="batch-print-preview"
            className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-700 transition-colors hover:text-indigo-700"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${previewOpen ? 'rotate-180' : ''}`}
            />
            {previewOpen ? 'Hide preview' : 'Preview statement'}
            <span className="font-normal text-slate-500">
              · {pageCount} sheet{pageCount === 1 ? '' : 's'}
            </span>
          </button>
          <span className="text-[11px] text-slate-500">
            Each printed invoice is logged to billing history.
          </span>
        </div>

        {/* Paper preview - one sheet per page of the selected invoices.
            A long batch becomes several `.print-doc-page` sheets; the shared
            print CSS turns each into a real page break on paper (and a dashed
            divider on screen). NOT `.no-print`: the preview shell must stay
            printable, otherwise the whole batch comes out blank (the card
            above carries print-area). */}
        <div
          id="batch-print-preview"
          className={previewOpen ? '' : 'hidden print:block'}
        >
          <div className="print-preview-shell">
          <div className="w-full">
            {selected.length === 0 ? (
              <div className={printSettings.paper === 'letter' ? 'print-preview-page paper-letter' : 'print-preview-page'}>
                <div className="py-16 text-center text-xs text-ink-muted">
                  <FileSpreadsheet className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                  Nothing selected to print.
                </div>
              </div>
            ) : (
              pages.map((page) => (
                <div
                  key={page.pageNumber}
                  className={printSettings.paper === 'letter' ? 'print-preview-page paper-letter print-doc-page' : 'print-preview-page print-doc-page'}
                >
                  <PrintDocument
                    kind="statement"
                    sections={statementSections}
                    branding={brandingSettings}
                    printSettings={printSettings}
                    invoices={page.rows}
                    cases={cases}
                    labName={selectedClinic?.name}
                    period={{ from, to }}
                    page={{ page: page.pageNumber, pageCount }}
                    /* Totals cover the whole run and land on the final sheet
                       only, so adding up the printed pages never double-counts. */
                    balanceInvoices={selected}
                    showBalance={page.pageNumber === pageCount}
                    advanceBalance={selectedClinic ? (getLabFinancialSummary?.(selectedClinic.id)?.advance_balance ?? 0) : 0}
                    accountPosition={statementAccountPosition}
                  />
                </div>
              ))
            )}
            </div>
          </div>
        </div>
    </Modal>
  );
};
