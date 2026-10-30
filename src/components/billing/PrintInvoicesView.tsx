import { buildStatementAccountPosition } from '../../services/invoiceAccount';
import { buildLabFinancialSummary } from '../../services/ledgerDomain';
import { printCurrentDocument } from '../../utils/printDocument';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Invoice } from '../../types';
import { DatePickerRange, describeQuickRange, todayISO } from '../common/DatePickerRange';
import { getTodayStr } from '../../utils/dateUtils';
import { formatDoctorName } from '../../utils/doctorName';
import { findCaseForInvoice } from '../../services/ledgerCaseDetail';
import { compareInvoiceNumbers } from '../../services/invoiceOrder';
import { paginateStatementInvoices } from '../../services/statementPagination';
import { PrintDocument, DEFAULT_ENABLED } from '../print/printRenderer';
import { SavePdfButton } from '../print/SavePdfButton';
import { loadPrintSettings, loadDocumentSections } from '../../services/printSettings';
import '../print/printStyles.css';
import { ChevronDown, FileSpreadsheet, Printer, Search } from 'lucide-react';
import { ClinicPicker } from '../common/ui/ClinicPicker';
import { PageHeader } from '../common/ui';
import { formatPKR, invoiceBalanceDue } from '../../services/financeDomain';

type InvoiceStatus = 'paid' | 'partial' | 'unpaid';

/**
 * Paper geometry at 96dpi, matching what `statementPagination` budgets rows
 * against and what `.print-invoices-stack` paints. Kept here so "Fit" can do
 * arithmetic on the same numbers the stylesheet uses.
 */
const SHEET_PX = {
  a4: { w: 794, h: 1123 },
  letter: { w: 816, h: 1056 },
} as const;

/** Zoom stops for the preview. `fit` is the default: whole page, one glance. */
const ZOOM_STOPS = [
  { id: 'fit' as const, label: 'Fit' },
  { id: 0.75 as const, label: '75%' },
  { id: 1 as const, label: '100%' },
];

type ZoomMode = (typeof ZOOM_STOPS)[number]['id'];

const STATUS_META: Record<InvoiceStatus, { label: string; chip: string }> = {
  paid: { label: 'Paid', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  partial: { label: 'Part paid', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  unpaid: { label: 'Unpaid', chip: 'bg-rose-50 text-rose-700 border-rose-200' },
};

/** Same derivation as the ledger's settlement badge: the money, never the
 *  stored `payment_status` (which drifts after a credit note or write-off). */
const invoiceStatus = (inv: Invoice): InvoiceStatus => {
  if (invoiceBalanceDue(inv) <= 0) return 'paid';
  return (inv.amount_paid || 0) > 0 ? 'partial' : 'unpaid';
};

const dateOf = (inv: Invoice) => String(inv.issue_date || inv.created_at || '').slice(0, 10);

/**
 * Print Invoices — batch statement printing for one clinic and one period.
 *
 * A module page, not a dialog: it lives in the main content area with the same
 * `PageHeader` every other view uses, and the sidebar stays put. The screen has
 * exactly two jobs, so it is built as exactly two cards — the invoices you are
 * choosing (screen only) and the paper they will become.
 */
export const PrintInvoicesView: React.FC = () => {
  const {
    labs,
    invoices,
    cases,
    brandingSettings,
    saveVoucherToSystem,
    getLabFinancialSummary,
    advancePayments,
    accountAdjustments,
    setCurrentView,
  } = useApp();

  const [labId, setLabId] = useState<string>(labs[0]?.id || '');
  // Default the period to today, matching every other billing tab; the range
  // picker is the way out to a month or a custom window.
  const [from, setFrom] = useState<string>(() => todayISO());
  const [to, setTo] = useState<string>(() => todayISO());
  const [excluded, setExcluded] = useState<string[]>([]);
  const [listSearch, setListSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  /* The paper preview is reassurance, not the task — closed by default so the
     choose-and-print path fits one screen. */
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewRef = useRef<HTMLElement>(null);
  /* The mat is measured, not guessed: "Fit" has to know how much room the
     preview pane actually got before it can size a page into it. */
  const matRef = useRef<HTMLDivElement>(null);
  const [matBox, setMatBox] = useState({ w: 0, h: 0 });
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit');

  const [printSettings] = useState(() => loadPrintSettings());
  const [statementSections] = useState<string[]>(() =>
    loadDocumentSections('statement', DEFAULT_ENABLED.statement)
  );

  /* Clinics load with the database, so the first one is not there on mount in a
     real session. Adopt it as soon as it arrives rather than leaving the page
     with nothing chosen and a dead Print button. */
  useEffect(() => {
    if (!labId && labs.length > 0) setLabId(labs[0].id);
  }, [labId, labs]);

  /* Every invoice for the chosen clinic inside the chosen period — NOT only the
     unpaid ones. The statement already carries Paid / Balance / Status columns,
     so a settled invoice reads as evidence, not noise; the date range alone
     decides what prints. Oldest first so the stack matches the ledger. */
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
      .sort(
        (a, b) => dateOf(a).localeCompare(dateOf(b)) || compareInvoiceNumbers(a.invoice_number, b.invoice_number)
      );
  }, [invoices, labId, from, to]);

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
  const selectedTotal = selected.reduce((sum, inv) => sum + invoiceBalanceDue(inv), 0);

  const visibleIds = visibleInvoices.map((inv) => inv.id);
  const selectedVisible = visibleInvoices.filter((inv) => !excluded.includes(inv.id)).length;
  const allVisibleSelected = visibleInvoices.length > 0 && selectedVisible === visibleInvoices.length;

  const selectedClinic = labs.find((l) => l.id === labId);

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

  /* Paginated AFTER the account position, because the totals block the final
     sheet carries is sized from it — an advance deposit or a credit note is a
     line of that block, and the sheet has to reserve exactly what prints. */
  const pages = useMemo(
    () => paginateStatementInvoices(selected, cases, printSettings, statementAccountPosition),
    [selected, cases, printSettings, statementAccountPosition]
  );
  const pageCount = pages.length;

  const toggle = (id: string) =>
    setExcluded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleVisible = () => {
    setExcluded((prev) => {
      if (allVisibleSelected) return Array.from(new Set([...prev, ...visibleIds]));
      return prev.filter((id) => !visibleIds.includes(id));
    });
  };

  /* Opening the preview should show the preview: it sits below the list, so a
     toggle that changes something off-screen reads as a dead control. */
  useEffect(() => {
    if (!previewOpen) return;
    previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [previewOpen]);

  /* Measure the preview pane's content box (its 24px vertical and 16px
     horizontal padding taken off). Re-run on open — a hidden node measures 0 —
     and on any resize, since the pane's height follows `100vh`. */
  useEffect(() => {
    const el = matRef.current;
    if (!el) return;
    const measure = () =>
      setMatBox({ w: Math.max(0, el.clientWidth - 32), h: Math.max(0, el.clientHeight - 48) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [previewOpen]);

  const handlePrint = () => {
    if (selected.length === 0) return;
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
        notes: `Batch print (${selected.length} invoices) ${from || 'start'} — ${to || 'today'} · Paid: PKR ${(inv.amount_paid || 0).toLocaleString()} | Balance: PKR ${due.toLocaleString()}`,
      });
    });
    void printCurrentDocument();
  };

  const statusOptions: ('all' | InvoiceStatus)[] = ['all', 'unpaid', 'partial', 'paid'];
  const paperLabel = printSettings.paper === 'letter' ? 'Letter' : 'A4';

  const sheetPx = printSettings.paper === 'letter' ? SHEET_PX.letter : SHEET_PX.a4;
  /* Fit asks for BOTH dimensions: the page has to fit the pane's height, and a
     narrow window must not leave the sheet running off the side. Clamped at
     35% — below that the statement stops being legible and "the whole page is
     visible" stops being useful. */
  const fitScale =
    matBox.w > 0 && matBox.h > 0
      ? Math.max(0.35, Math.min(1, matBox.h / sheetPx.h, matBox.w / sheetPx.w))
      : 0.75;
  const zoomScale = zoomMode === 'fit' ? fitScale : zoomMode;

  return (
    <div className="billing-module print-page space-y-5" data-purpose="print-invoices">
      <PageHeader
        title="Print Invoices"
        subtitle={
          selectedClinic
            ? `${selectedClinic.name} · ${describeQuickRange(from, to)}`
            : 'One statement per clinic for any period — paid, part paid and unpaid.'
        }
        breadcrumbs={[
          { label: 'Financial Hub' },
          { label: 'Billing & Invoices', onClick: () => setCurrentView('billing') },
          { label: 'Print Invoices' },
        ]}
        actions={
          <>
            <SavePdfButton
              suggestedName={`Invoices-${getTodayStr()}.pdf`}
              disabled={selected.length === 0}
              className="px-4 py-1.5 ds-glass-pill font-bold text-xs flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handlePrint}
              disabled={selected.length === 0}
              title={
                selected.length === 0
                  ? 'Select at least one invoice to print'
                  : `Print ${selected.length} invoice${selected.length === 1 ? '' : 's'} on ${pageCount} sheet${pageCount === 1 ? '' : 's'}`
              }
              className="px-4 py-1.5 ds-glass-pill font-bold text-xs flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Printer className="w-4 h-4 text-indigo-600" />
              <span>
                Print {selected.length > 0 ? `${selected.length} ` : ''}invoice{selected.length === 1 ? '' : 's'}
              </span>
            </button>
          </>
        }
      />

      {/* ── What prints ───────────────────────────────────────────────────── */}
      <div className="no-print ds-glass-card rounded-2xl overflow-hidden">
        {/* Clinic and period decide the batch; both sit on one line. */}
        {/* `items-start`, not `items-end`: the picker is taller than the date
            range, so aligning bottoms pushed the CLINIC label eight pixels
            above PERIOD — two labels on one row that did not sit on one line. */}
        <div className="grid gap-3 border-b border-ds-line p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-start">
          <div>
            <label
              htmlFor="batch-clinic-picker"
              className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-ds-muted"
            >
              Clinic
            </label>
            <ClinicPicker
              id="batch-clinic-picker"
              clinics={labs}
              value={labId || null}
              onChange={(id) => {
                setLabId(id);
                setExcluded([]);
              }}
              tone="indigo"
              emptyLabel={(q) => (labs.length === 0 ? 'No clinics registered' : `No clinic matches "${q}"`)}
            />
          </div>
          <div>
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-ds-muted">
              Period
            </span>
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

        {/* Narrow the rows, not the selection: search and status are reading
            aids for a long month, so they live in one quiet band. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-ds-line px-4 py-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-muted" />
            <input
              type="text"
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              placeholder="Find patient, invoice #, case # or doctor"
              aria-label="Search invoices in this batch"
              className="w-full rounded-lg border border-ds-line bg-ds-sunken py-1.5 pl-8 pr-3 text-xs text-ds-ink placeholder:text-ds-muted focus:border-ds-accent focus:bg-ds-surface focus:outline-none"
            />
          </div>
          <div
            className="inline-flex items-center gap-0.5 rounded-lg border border-ds-line bg-ds-sunken p-0.5"
            role="group"
            aria-label="Filter by payment status"
          >
            {statusOptions.map((s) => {
              const active = statusFilter === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  aria-pressed={active}
                  className={`cursor-pointer rounded-[6px] px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-ds-surface text-ds-ink shadow-2xs'
                      : 'text-ds-muted hover:text-ds-ink'
                  }`}
                >
                  {s === 'all' ? 'All' : STATUS_META[s].label}
                </button>
              );
            })}
          </div>
        </div>

        {/* The rows */}
        <div className="max-h-[min(50vh,520px)] overflow-y-auto">
          {periodInvoices.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <FileSpreadsheet className="mx-auto mb-2 h-5 w-5 text-ds-muted" />
              <p className="text-xs font-bold text-ds-ink">
                {selectedClinic ? 'No invoices in this period' : 'Choose a clinic to begin'}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-ds-body">
                {selectedClinic
                  ? `${selectedClinic.name} has nothing billed between ${from || 'the first record'} and ${to || 'today'}.`
                  : 'Invoices are printed per clinic and period. Pick the clinic above, then set the dates.'}
              </p>
              {selectedClinic && (from || to) && (
                <button
                  type="button"
                  onClick={() => {
                    setFrom('');
                    setTo('');
                  }}
                  className="mt-3 cursor-pointer rounded-lg border border-ds-line bg-ds-surface px-3 py-1.5 text-[11px] font-semibold text-ds-ink transition-colors hover:bg-ds-sunken"
                >
                  Show all dates
                </button>
              )}
            </div>
          ) : visibleInvoices.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-xs font-bold text-ds-ink">No invoice matches this filter</p>
              <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-ds-body">
                {periodInvoices.length} invoice{periodInvoices.length === 1 ? '' : 's'} are in this period; the
                search or status filter is hiding them.
              </p>
              <button
                type="button"
                onClick={() => {
                  setListSearch('');
                  setStatusFilter('all');
                }}
                className="mt-3 cursor-pointer rounded-lg border border-ds-line bg-ds-surface px-3 py-1.5 text-[11px] font-semibold text-ds-ink transition-colors hover:bg-ds-sunken"
              >
                Clear filter
              </button>
            </div>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="ds-th sticky top-0 z-10">
                  <th scope="col" className="w-10 py-2.5 pl-4">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedVisible > 0 && !allVisibleSelected;
                      }}
                      onChange={toggleVisible}
                      aria-label={allVisibleSelected ? 'Deselect all invoices shown' : 'Select all invoices shown'}
                      className="h-4 w-4 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-bold">Date</th>
                  <th scope="col" className="py-2.5 px-3 font-bold">Invoice</th>
                  <th scope="col" className="py-2.5 px-3 font-bold">Case</th>
                  <th scope="col" className="py-2.5 px-3 font-bold">Doctor</th>
                  <th scope="col" className="py-2.5 pr-4 text-right font-bold">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ds-line text-xs">
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
                        isOn ? 'bg-indigo-50' : 'bg-transparent hover:bg-ds-sunken'
                      }`}
                    >
                      <td className="py-2.5 pl-4 align-top">
                        <input
                          type="checkbox"
                          checked={isOn}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggle(inv.id)}
                          aria-label={`Include ${inv.invoice_number} in the batch`}
                          className="h-4 w-4 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="py-2.5 px-3 align-top font-mono tabular-nums text-ds-muted">
                        {dateOf(inv) || '—'}
                      </td>
                      <td className="py-2.5 px-3 align-top font-mono font-bold text-ds-ink">
                        {inv.invoice_number}
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <span className="font-semibold text-ds-ink">{inv.case_number || '—'}</span>
                        {linkedCase && (
                          <span className="mt-0.5 block text-[11px] leading-tight text-ds-muted">
                            {[linkedCase.patient_name, linkedCase.case_type_name || linkedCase.case_type]
                              .filter(Boolean)
                              .join(' · ') || null}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 align-top text-ds-body">
                        {formatDoctorName(inv.doctor_name)}
                      </td>
                      <td className="py-2.5 pr-4 text-right align-top">
                        <div className="font-mono font-bold tabular-nums text-ds-ink">{formatPKR(due)}</div>
                        <span
                          className={`mt-0.5 inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-bold ${status.chip}`}
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

        {/* Selection read-out + the way into the paper */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ds-line bg-ds-sunken/60 px-4 py-2">
          <p className="text-[11px] font-semibold text-ds-body" aria-live="polite">
            <span className="font-mono font-bold text-ds-ink">{selected.length}</span> of{' '}
            {periodInvoices.length} invoice{periodInvoices.length === 1 ? '' : 's'} ·{' '}
            <span className="font-mono font-bold text-ds-ink">{formatPKR(selectedTotal)}</span> balance due
          </p>
          <button
            type="button"
            onClick={() => setPreviewOpen((o) => !o)}
            aria-expanded={previewOpen}
            aria-controls="batch-print-preview"
            className="ds-glass-pill ds-glass-pill-sm"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${previewOpen ? 'rotate-180' : ''}`} />
            {previewOpen ? 'Hide statement' : 'Preview statement'}
          </button>
        </div>
      </div>

      {/* ── What prints on paper ──────────────────────────────────────────── */}
      <section
        id="batch-print-preview"
        ref={previewRef}
        className={previewOpen ? 'print-flow' : 'print-flow hidden print:block'}
      >
        {/* overflow-visible on paper: a rounded, clipped wrapper can cut the
            sheet at a page break once the stack runs past one page. */}
        <div className="ds-glass-card rounded-2xl overflow-hidden print:overflow-visible">
          <div className="no-print flex items-center justify-between gap-3 border-b border-ds-line px-4 py-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-ds-muted">
              Statement preview
            </span>
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[11px] font-semibold tabular-nums text-ds-muted">
                {pageCount} sheet{pageCount === 1 ? '' : 's'} · {paperLabel}
              </span>
              <div
                role="group"
                aria-label="Preview zoom"
                className="inline-flex items-center gap-0.5 rounded-lg border border-ds-line bg-ds-sunken p-0.5"
              >
                {ZOOM_STOPS.map((stop) => {
                  const active = zoomMode === stop.id;
                  return (
                    <button
                      key={stop.label}
                      type="button"
                      onClick={() => setZoomMode(stop.id)}
                      aria-pressed={active}
                      title={
                        stop.id === 'fit'
                          ? `Fit the whole page in the preview (${Math.round(fitScale * 100)}%)`
                          : `Show the page at ${stop.label}`
                      }
                      className={`cursor-pointer rounded-[6px] px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                        active ? 'bg-ds-surface text-ds-ink shadow-2xs' : 'text-ds-muted hover:text-ds-ink'
                      }`}
                    >
                      {stop.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="print-invoices-mat" ref={matRef}>
            <div
              className={`print-invoices-stack${
                printSettings.paper === 'letter' ? ' print-invoices-stack--letter' : ''
              }`}
              style={{ ['--sheet-zoom' as string]: zoomScale } as React.CSSProperties}
            >
              {selected.length === 0 ? (
                <div className="print-preview-page">
                  <div className="py-20 text-center">
                    <FileSpreadsheet className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                    <p className="text-xs font-semibold text-slate-500">
                      Nothing selected — tick at least one invoice to see the statement.
                    </p>
                  </div>
                </div>
              ) : (
                pages.map((page) => (
                  <div
                    key={page.pageNumber}
                    className={`print-preview-page print-doc-page${
                      printSettings.paper === 'letter' ? ' paper-letter' : ''
                    }`}
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
                      balanceInvoices={selected}
                      showBalance={page.pageNumber === pageCount}
                      advanceBalance={clinicSummary?.advance_balance ?? 0}
                      accountPosition={statementAccountPosition}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default PrintInvoicesView;
