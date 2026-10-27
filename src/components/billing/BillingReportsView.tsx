import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { can } from '../../services/permissions';
import { Invoice, SavedVoucher, DentalLab } from '../../types';
import { DatePickerRange, todayISO } from '../common/DatePickerRange';
import { getTodayStr } from '../../utils/dateUtils';
import { formatDoctorName } from '../../utils/doctorName';
import { EmptyState, DataTable } from '../common/ui';
import { ClinicFilter } from '../common/ui/ClinicFilter';
import { formatPKR } from '../../services/financeDomain';
import { saveFile } from '../../lib/saveFile';
import { buildMonthlyStatementPdf, downloadPdf } from '../../lib/pdf';
import {
  buildMonthlyStatements,
  filterMonthlyStatements,
  formatMonthLabel,
  monthlyStatementWorkbook,
  statementColumns,
  type MonthlyClinicRow,
  type StatementColumnKey,
} from '../../services/monthlyStatement';
import {
  BarChart3,
  BookmarkCheck,
  BookOpen,
  FileDown,
  Sheet,
  Printer,
  Trash2,
  Search,
  Building2,
  FileText,
  FileCheck,
  CalendarDays
} from 'lucide-react';
import { DailyReportView } from './DailyReportView';

interface BillingReportsViewProps {
  onPrintInvoice: (invoice: Invoice) => void;
  onViewCaseSlip: (caseItem: any) => void;
  /** Trace a saved voucher to its double-entry journal lines. */
  onOpenJournalModal?: (refId: string) => void;
}

export const BillingReportsView: React.FC<BillingReportsViewProps> = ({
  onPrintInvoice,
  onViewCaseSlip,
  onOpenJournalModal,
}) => {
  const {
    invoices,
    cases,
    savedVouchers,
    deleteSavedVoucher,
    advancePayments,
    accountAdjustments,
    labs,
    brandingSettings,
    showToast,
    user,
  } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<'monthly' | 'vouchers' | 'daily'>('monthly');
  const [voucherSearch, setVoucherSearch] = useState<string>('');
  // Monthly statement: view one month at a time. The previous month's closing
  // balance carries forward as this month's opening balance (computed by the
  // service over the full history), so showing a single month is honest — the
  // running total is not lost, it is just not repeated on screen.
  // Saved-voucher list defaults to TODAY like the other billing tabs; rewind the
  // picker (or clear it for All Time) to audit earlier vouchers.
  const [vFromDate, setVFromDate] = useState<string>(() => todayISO());
  const [vToDate, setVToDate] = useState<string>(() => todayISO());

  /* Month-by-month statement of account. Every figure is dated to the month
     the money moved (see services/monthlyStatement), so "Collected" is what
     actually landed this month — not a lifetime per-invoice total filed under
     the invoice's creation month — and each month carries its opening balance
     forward into a closing balance, with advance credit and the closing
     balance itself (Dr/Cr side of the ledger) shown for every clinic. */
  const monthlyBlocks = useMemo(
    () => buildMonthlyStatements({ invoices, advancePayments, accountAdjustments, labs }),
    [invoices, advancePayments, accountAdjustments, labs]
  );

  /* Which clinics the operator has taken OUT of the statement.
     Excluded rather than included, so a clinic created tomorrow is in scope
     by default instead of being missing from every report until somebody
     remembers to tick it. Empty means "every clinic". */
  const [excludedLabIds, setExcludedLabIds] = useState<string[]>([]);

  /* How many columns the statement shows.
     The full set is twelve, which is more than a laptop screen shows at once.
     COMPACT shows the seven a reader needs to read the statement at all; FULL
     shows every column, for the months a reader is auditing. The choice is
     remembered, because switching it on every visit is a tax. */
  const visibleBlocks = useMemo(
    () => filterMonthlyStatements(monthlyBlocks, excludedLabIds),
    [monthlyBlocks, excludedLabIds]
  );

  // Month selector: view one month at a time. Defaults to the latest month so
  // the screen is not a wall of identical clinics repeated across months; the
  // previous month's closing balance still carries into this month's opening
  // balance because buildMonthlyStatements computes the running total over the
  // full history before we filter for display.
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  useEffect(() => {
    if (!selectedMonth && visibleBlocks.length > 0) {
      setSelectedMonth(visibleBlocks[0].month);
    }
  }, [visibleBlocks, selectedMonth]);
  const displayedBlocks = useMemo(
    () => (selectedMonth ? visibleBlocks.filter((b) => b.month === selectedMonth) : visibleBlocks),
    [visibleBlocks, selectedMonth]
  );

  /** The whole statement in one line, for the scope on screen. The Closing
      Balance figure is NOT summed across months — a closing balance repeats
      every month, so it is the NEWEST month's closing, i.e. exactly what the
      general ledger carries for the clinics in scope right now. */
  const statementTotals = useMemo(() => {
    const sum = (pick: (b: (typeof displayedBlocks)[number]) => number) =>
      displayedBlocks.reduce((acc, b) => acc + pick(b), 0);
    return {
      months: displayedBlocks.length,
      clinics: displayedBlocks.length ? displayedBlocks[0].totals.clinics : 0,
      billed: sum((b) => b.totals.billed),
      collected: sum((b) => b.totals.collected),
      closingBalance: displayedBlocks[0]?.totals.closing_balance ?? 0,
    };
  }, [displayedBlocks]);

  /* Every clinic that appears in the statement, whether or not it is still in
     the clinic list — a deleted clinic can still have months of history, and
     an operator has to be able to take it out of the report. The saved clinic
     record wins where there is one, because it carries the doctor and city
     the search looks at. */
  const statementClinics = useMemo<DentalLab[]>(() => {
    const byId = new Map<string, DentalLab>();
    monthlyBlocks.forEach((block) =>
      block.rows.forEach((r) => {
        if (!byId.has(r.lab_id)) {
          byId.set(r.lab_id, {
            id: r.lab_id,
            name: r.lab_name,
            contact_person: '',
            phone: '',
            email: '',
            address: '',
            rating: 0,
            reviews_count: 0,
            created_at: '',
            opening_balance: 0,
            opening_balance_type: 'credit',
          });
        }
      })
    );
    (labs || []).forEach((l) => byId.set(l.id, l));
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [labs, monthlyBlocks]);

  const selectedLabIds = useMemo(
    () => statementClinics.map((c) => c.id).filter((id) => !excludedLabIds.includes(id)),
    [statementClinics, excludedLabIds]
  );

  const setSelectedLabIds = (ids: string[]) => {
    const chosen = new Set(ids);
    setExcludedLabIds(statementClinics.map((c) => c.id).filter((id) => !chosen.has(id)));
  };

  /**
   * The statement's columns come from the one declaration the PDF and the
   * workbook also read, so a heading can never be spelled one way on the
   * screen and another way in the file. The renderers are per-column
   * because that is where the presentation lives — a zero is worth less
   * than a figure, and the money columns are coloured by what they mean.
   */
  const columnRenderers: Record<
    StatementColumnKey,
    { className: string; render: (r: MonthlyClinicRow) => React.ReactNode }
  > = {
    clinic: {
      className: 'py-2.5 px-3 font-bold text-slate-800 min-w-[190px]',
      render: (r) => (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <Building2 className="w-3.5 h-3.5 text-ink-muted shrink-0" />
          <span>{r.lab_name}</span>
        </span>
      ),
    },
    cases: {
      className: 'py-2.5 px-3 font-semibold text-slate-600',
      render: (r) => r.cases_billed,
    },
    billed: {
      className: 'py-2.5 px-3 font-bold text-slate-900 whitespace-nowrap',
      render: (r) => formatPKR(r.billed),
    },
    collected: {
      className: 'py-2.5 px-3 font-bold text-ink-success whitespace-nowrap',
      render: (r) => formatPKR(r.collected),
    },
    advanceUsed: {
      className: 'py-2.5 px-3 font-semibold whitespace-nowrap',
      render: (r) => (
        <span className={r.advance_applied > 0 ? 'text-sky-700' : 'text-ink-muted'}>
          {formatPKR(r.advance_applied)}
        </span>
      ),
    },
    credits: {
      className: 'py-2.5 px-3 font-semibold whitespace-nowrap',
      render: (r) => (
        <span className={r.credit_notes > 0 ? 'text-ink-danger' : 'text-ink-muted'}>
          {formatPKR(r.credit_notes)}
        </span>
      ),
    },
    debits: {
      className: 'py-2.5 px-3 font-semibold whitespace-nowrap',
      render: (r) => (
        <span className={r.debit_adjustments > 0 ? 'text-amber-700' : 'text-ink-muted'}>
          {formatPKR(r.debit_adjustments)}
        </span>
      ),
    },
    opening: {
      className: 'py-2.5 px-3 text-slate-500 whitespace-nowrap',
      render: (r) => formatPKR(r.opening_balance),
    },
    closing: {
      className: 'py-2.5 px-3 font-bold whitespace-nowrap',
      render: (r) => (
        <span
          className={
            r.closing_balance < 0
              ? 'text-ink-success'
              : r.closing_balance > 0
                ? 'text-slate-900'
                : 'text-ink-muted'
          }
          title={
            r.closing_balance < 0
              ? 'Clinic is in credit — Cr side of the ledger'
              : r.closing_balance > 0
                ? 'Clinic owes us — Dr side of the ledger'
                : 'Fully settled'
          }
        >
          {formatPKR(r.closing_balance)}
          {r.closing_balance > 0 ? ' Dr' : r.closing_balance < 0 ? ' Cr' : ''}
        </span>
      ),
    },
  };

  const visibleColumns = statementColumns(true);

  /** Dr / Cr ledger side for a closing balance figure, as the ledger tab
      prints it: a debit is money the clinic still owes us, a credit is
      money we are holding for them. */
  const drCr = (v: number) => (v > 0 ? ' Dr' : v < 0 ? ' Cr' : '');

  /** The figure a column holds for a clinic row, formatted once for print. */
  const figureFor = (c: (typeof visibleColumns)[number], r: MonthlyClinicRow): string =>
    c.key === 'cases'
      ? String(c.value(r))
      : c.key === 'closing'
        ? `${formatPKR(c.value(r))}${drCr(c.value(r))}`
        : formatPKR(c.value(r));

  /**
   * The statement as the PDF and the workbook want it: the same columns, the
   * same headings, and the figures formatted ONCE — so the document and the
   * screen can never print different numbers.
   */
  const buildPrintableMonths = () =>
    visibleBlocks.map((b) => {
      const totals = b.totals as unknown as MonthlyClinicRow;
      return {
        month: b.month,
        label: formatMonthLabel(b.month),
        rows: b.rows.map((r) => [
          r.lab_name,
          ...visibleColumns.slice(1).map((c) => figureFor(c, r)),
        ]),
        totals: [
          'MONTH TOTAL',
          ...visibleColumns.slice(1).map((c) => figureFor(c, totals)),
        ],
        headline: [
          { label: 'Billed', value: formatPKR(b.totals.billed) },
          { label: 'Collected', value: formatPKR(b.totals.collected) },
          { label: 'Closing', value: `${formatPKR(b.totals.closing_balance)}${drCr(b.totals.closing_balance)}` },
        ],
      };
    });

  /**
   * The statement as a document: the same columns, the same headings, and
   * the figures formatted ONCE — so the document and the screen can never
   * print different numbers.
   */
  const buildMonthlyDocument = () => {
    const labName = brandingSettings?.lab_name || brandingSettings?.appName || 'Dental Lab';
    const scopeLabel = excludedLabIds.length
      ? `${selectedLabIds.length} of ${statementClinics.length} clinics`
      : `All ${statementClinics.length} clinics`;
    const periodLabel = visibleBlocks.length
      ? `${formatMonthLabel(visibleBlocks[visibleBlocks.length - 1].month)} — ${formatMonthLabel(
          visibleBlocks[0].month,
        )}`
      : 'No activity';
    const result = buildMonthlyStatementPdf(
      buildPrintableMonths(),
      {
        labName,
        periodLabel,
        generatedOn: getTodayStr(),
        scopeLabel,
      },
      visibleColumns.map((c) => ({
        key: c.key,
        label: c.label,
        w: c.width,
        align: c.align,
        strong: c.strong,
      })),
    );
    const fileName = `Monthly_Statement_${visibleBlocks.length ? visibleBlocks[0].month : 'none'}.pdf`;
    return { fileName, pdf: result.pdf };
  };

  const handleExportMonthlyPDF = async () => {
    try {
      const { fileName, pdf } = buildMonthlyDocument();
      const outcome = await downloadPdf(fileName, pdf, 'PDF document');
      if (outcome.status === 'error') {
        showToast(`Could not save the PDF: ${outcome.message}`, 'error');
      } else if (outcome.status === 'saved' && outcome.location === 'downloads') {
        showToast(`Saved ${outcome.path} to your browser's downloads folder.`, 'info');
      }
    } catch (e) {
      showToast(
        `Could not export the statement: ${e instanceof Error ? e.message : String(e)}`,
        'error'
      );
    }
  };

  /**
   * The statement as an Excel workbook: a summary sheet and one sheet per
   * month, with the same columns the screen shows and the figures as real
   * numbers, so a cell can be summed, sorted and charted.
   */
  const handleExportMonthlyExcel = async () => {
    try {
      const labName = brandingSettings?.lab_name || brandingSettings?.appName || 'Dental Lab';
      const scopeLabel = excludedLabIds.length
        ? `${selectedLabIds.length} of ${statementClinics.length} clinics`
        : `All ${statementClinics.length} clinics`;
      const periodLabel = visibleBlocks.length
        ? `${formatMonthLabel(visibleBlocks[visibleBlocks.length - 1].month)} — ${formatMonthLabel(
            visibleBlocks[0].month,
          )}`
        : 'No activity';
      const bytes = monthlyStatementWorkbook(
        visibleBlocks,
        { labName, periodLabel, scopeLabel, generatedOn: getTodayStr() },
        true,
      );
      const outcome = await saveFile(`Monthly_Statement_${getTodayStr()}.xlsx`, bytes, {
        extension: '.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: 'Save the statement as an Excel workbook',
      });
      if (outcome.status === 'error') {
        showToast(`Could not save the workbook: ${outcome.message}`, 'error');
      } else if (outcome.status === 'saved' && outcome.location === 'downloads') {
        showToast(`Saved ${outcome.path} to your browser's downloads folder.`, 'info');
      }
    } catch (e) {
      showToast(
        `Could not export the statement: ${e instanceof Error ? e.message : String(e)}`,
        'error'
      );
    }
  };

  // Filter saved vouchers
  const filteredVouchers = useMemo(() => {
    const inRange = (v: (typeof savedVouchers)[number]) => {
      const day = (v.created_at || '').slice(0, 10);
      if (vFromDate && (!day || day < vFromDate)) return false;
      if (vToDate && (!day || day > vToDate)) return false;
      return true;
    };
    if (!voucherSearch.trim()) return savedVouchers.filter(inRange);
    const q = voucherSearch.toLowerCase();
    return savedVouchers.filter((v) => {
      if (!inRange(v)) return false;
      return (
        v.voucher_number.toLowerCase().includes(q) ||
        v.case_number.toLowerCase().includes(q) ||
        v.lab_name.toLowerCase().includes(q) ||
        // Matched on the DISPLAY name, so an operator who types "Dr Ahmad"
        // still finds the row now that the column stores the bare name.
        formatDoctorName(v.doctor_name).toLowerCase().includes(q) ||
        (v.saved_by || '').toLowerCase().includes(q)
      );
    });
  }, [savedVouchers, voucherSearch, vFromDate, vToDate]);

  if (!can(user, 'reports:view')) {
    return (
      <div className="p-6 text-center text-slate-500 text-sm">
        <p className="font-semibold text-slate-700 mb-1">Insufficient permission</p>
        <p className="text-xs">This report is available to Super Admin and Audit Checker roles only.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      
      {/* Sub-navigation bar. The strip and the controls share a row when there
          is room and the controls drop to their own line when there is not —
          which is what happens the moment a clinic filter and two export
          buttons are added to it. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:flex-wrap justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
        <div className="flex shrink-0 items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveSubTab('monthly')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              activeSubTab === 'monthly'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 text-indigo-600" />
            <span>Monthly Statement</span>
            <span className="px-1.5 py-0.2 rounded text-[11px] bg-slate-200 text-slate-700">
              {monthlyBlocks.length} Months
            </span>
          </button>

          <button
            onClick={() => setActiveSubTab('vouchers')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              activeSubTab === 'vouchers'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BookmarkCheck className="w-3.5 h-3.5 text-ink-success" />
            <span>Archived Slips & Vouchers</span>
            <span className="px-1.5 py-0.2 rounded text-[11px] bg-slate-200 text-slate-700">
              {savedVouchers.length}
            </span>
          </button>

          <button
            onClick={() => setActiveSubTab('daily')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              activeSubTab === 'daily'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CalendarDays className="w-3.5 h-3.5 text-indigo-600" />
            <span>Daily Lab Report</span>
          </button>
        </div>

        {activeSubTab === 'monthly' && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
            {/* How many columns the statement shows.
                Twelve is more than a laptop screen shows at once, so the
                default is the seven a reader needs; FULL is for auditing a
                month. The choice is remembered, and the exported document
                follows it — the file an operator sends is the file they were
                reading. */}
            <ClinicFilter
              clinics={statementClinics}
              selected={selectedLabIds}
              onChange={setSelectedLabIds}
              tone="indigo"
              className="sm:w-64"
            />
            <button
              onClick={handleExportMonthlyExcel}
              title="Export the statement as an Excel workbook (one sheet per month, real numbers)"
              aria-label="Export the monthly statement as an Excel workbook"
              className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap"
            >
              <Sheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Export to Excel</span>
            </button>
            <button
              onClick={handleExportMonthlyPDF}
              title="Download the statement as a PDF (selectable text, one month per page)"
              aria-label="Download the monthly statement as a PDF"
              className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>Export PDF</span>
            </button>
          </div>
        )}

        {activeSubTab === 'vouchers' && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                type="text"
                value={voucherSearch}
                onChange={(e) => setVoucherSearch(e.target.value)}
                placeholder="Search voucher #, case #, clinic..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
              />
            </div>
            <DatePickerRange
              from={vFromDate}
              to={vToDate}
              onChange={(f, t) => {
                setVFromDate(f);
                setVToDate(t);
              }}
            />
          </div>
        )}
      </div>

      {/* Sub-Tab 3: Daily Lab Report — the end-of-day production sheet. */}
      {activeSubTab === 'daily' && <DailyReportView />}

      {/* Sub-Tab 1: Monthly Breakdown */}
      {activeSubTab === 'monthly' && (
        <div className="space-y-4">
          {/* Month selector — view one month at a time. The previous month's
              closing balance carries forward as this month's opening balance
              (computed over the full history), so a single month is honest:
              the running total is not lost, it is just not repeated on screen. */}
          {visibleBlocks.length > 1 && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-700">Month:</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="p-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold"
              >
                {visibleBlocks.map((b) => (
                  <option key={b.month} value={b.month}>
                    {formatMonthLabel(b.month)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* The whole statement in one line, so the scope is visible before
              any month is read. */}
          {displayedBlocks.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs divide-x divide-y md:divide-y-0 divide-slate-200">
              <Stat label="Months" value={String(statementTotals.months)} />
              <Stat label="Clinics" value={String(statementTotals.clinics)} />
              <Stat label="Billed" value={formatPKR(statementTotals.billed)} />
              <Stat
                label="Collected"
                value={formatPKR(statementTotals.collected)}
                tone="success"
              />
              <Stat
                label="Closing Balance"
                value={`${formatPKR(statementTotals.closingBalance)}${drCr(statementTotals.closingBalance)}`}
                tone={
                  statementTotals.closingBalance < 0
                    ? 'success'
                    : statementTotals.closingBalance > 0
                      ? 'warning'
                      : 'muted'
                }
              />
            </div>
          )}
          {displayedBlocks.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title={
                monthlyBlocks.length === 0
                  ? 'No Billing Records Yet'
                  : 'No Clinics In This Selection'
              }
              description={
                monthlyBlocks.length === 0
                  ? 'Once invoices, payments or advances are recorded for this period, the monthly statement by clinic appears here.'
                  : 'Every clinic in the statement is excluded. Tick one in the clinic filter to bring it back.'
              }
            />
          ) : (
            displayedBlocks.map((block) => {
              const t = block.totals;
              return (
                <div key={block.month} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                <div className="flex items-baseline gap-2 px-5 pt-4 pb-1">
                  <h3 className="text-sm font-bold text-slate-900">
                    {formatMonthLabel(block.month)}
                  </h3>
                  <span className="text-xs text-slate-500">
                    {t.clinics} active {t.clinics === 1 ? 'clinic' : 'clinics'}
                  </span>
                </div>

                  {/* Clinics Table. The "Month Total" row used to be why this stayed hand-rolled:
                      DataTable had no <tfoot> slot, and its `footer` prop renders
                      AFTER the closing </table>, so the totals row stopped being a
                      row of the table — which is exactly what
                      billingReportsMonthly.test.tsx asserts against
                      (`within(table).getByText('Month total').closest('tr')`).
                      `tfoot` now renders inside the table, so it can.

                      The columns are the model's, not this file's: the headings,
                      which of them are core, and which are the ones a reader
                      must see are all declared once in services/monthlyStatement,
                      and the PDF and the workbook read the same declaration.
                      That is what lets the Compact view, the printed page and
                      the spreadsheet agree.

                      The totals row is a ruled line, not a second black slab:
                      the month header is already the band's job, and two of
                      them in one card is one too many. */}
                  <DataTable
                    data={block.rows}
                    rowKey={(r) => r.lab_id}
                    stickyFirstColumn
                    tfoot={
                      <tr className="border-t-2 border-slate-300 bg-white font-bold text-[11px] uppercase tracking-wider text-slate-600">
                        <td className="ds-sticky-col py-2.5 px-3">Month total</td>
                        {visibleColumns.slice(1).map((c) => (
                          <td
                            key={c.key}
                            className={`py-2.5 px-3 ${
                              c.align === 'right' ? 'text-right whitespace-nowrap' : ''
                            } ${columnRenderers[c.key].className.replace(/py-2\.5 px-3 ?/, '')}`}
                          >
                            {c.key === 'cases'
                              ? t.cases_billed
                              : figureFor(c, t as unknown as MonthlyClinicRow)}
                          </td>
                        ))}
                      </tr>
                    }
                    columns={visibleColumns.map((c) => ({
                      header: c.label,
                      align: c.align,
                      className: columnRenderers[c.key].className,
                      render: columnRenderers[c.key].render,
                    }))}
                  />
</div>
              );
            })
          )}
        </div>
      )}

      {/* Sub-Tab 2: Saved Vouchers */}
      {activeSubTab === 'vouchers' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
          {/* Shared primitive owns the header row, the row hover, the divide and
              the scroll wrapper; the card above stays here. Its cells already
              used the default padding, so no column carries any. */}
          {filteredVouchers.length === 0 ? (
            <EmptyState
              icon={BookmarkCheck}
              title="No Saved Vouchers"
              description="No vouchers were saved in this date range. Rewind the date picker to see earlier ones."
            />
          ) : (
            <DataTable<SavedVoucher>
              data={filteredVouchers}
              rowKey={(v) => v.id}
              columns={[
                {
                  header: 'Voucher #',
                  className: 'font-bold text-slate-900 font-mono whitespace-nowrap',
                  render: (v) => <>{v.voucher_number}</>,
                },
                {
                  header: 'Type',
                  className: 'whitespace-nowrap',
                  render: (v) => {
                    const isInv = v.voucher_type === 'invoice';
                    return (
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase ${
                        isInv ? 'bg-emerald-100 text-emerald-800' : 'bg-indigo-100 text-indigo-800'
                      }`}>
                        {isInv ? <FileText className="w-3 h-3" /> : <FileCheck className="w-3 h-3" />}
                        <span>{isInv ? 'Invoice Voucher' : 'Workstation Slip'}</span>
                      </span>
                    );
                  },
                },
                {
                  header: 'Case #',
                  className: 'font-bold text-indigo-600 font-mono whitespace-nowrap',
                  render: (v) => <>{v.case_number}</>,
                },
                {
                  header: 'Dental Clinic',
                  className: 'text-slate-800',
                  render: (v) => <>{v.lab_name}</>,
                },
                {
                  header: 'Doctor',
                  className: 'text-slate-600',
                  render: (v) => <>{formatDoctorName(v.doctor_name)}</>,
                },
                {
                  header: 'Saved At',
                  className: 'text-slate-500 font-mono text-[11px] whitespace-nowrap',
                  render: (v) => <>{v.created_at}</>,
                },
                {
                  header: 'Recorded By',
                  className: 'text-slate-600',
                  render: (v) => <>{v.saved_by || 'Staff'}</>,
                },
                {
                  header: 'Actions',
                  align: 'right',
                  className: 'whitespace-nowrap',
                  render: (v) => {
                    const isInv = v.voucher_type === 'invoice';
                    return (
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => {
                            if (isInv) {
                              const inv = invoices.find(i => i.invoice_number === v.voucher_number || i.case_id === v.case_id);
                              if (inv) onPrintInvoice(inv);
                            } else {
                              const c = cases.find(cs => cs.case_number === v.case_number || cs.id === v.case_id);
                              if (c) onViewCaseSlip(c);
                            }
                          }}
                          className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                          title="Re-print or View Voucher" aria-label="Re-print or view voucher"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>Re-Print</span>
                        </button>
                        {onOpenJournalModal && (
                          <button
                            onClick={() => onOpenJournalModal(v.voucher_number)}
                            className="ds-hit px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                            title="Trace to the double-entry journal"
                            aria-label={`Open journal entries for voucher ${v.voucher_number}`}
                          >
                            <BookOpen className="w-3.5 h-3.5" />
                            <span>Journal</span>
                          </button>
                        )}
                        <button
                          onClick={() => deleteSavedVoucher(v.id)}
                          className="p-1.5 text-ink-muted hover:text-ink-danger hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Delete Voucher Log" aria-label="Delete voucher log"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  },
                },
              ]}
            />
          )}
        </div>
      )}

    </div>
  );
};

/* ── Small presentational pieces ──────────────────────────────────────────── */

/**
 * One figure, in the statement's own language: a small label over a number.
 */
const Stat: React.FC<{
  label: string;
  value: string;
  tone?: 'success' | 'warning' | 'muted';
}> = ({ label, value, tone = 'default' }) => (
  <div className="px-4 py-3">
    <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">{label}</div>
    <div
      className={`mt-1 font-mono text-lg font-bold tabular-nums ${
        tone === 'success'
          ? 'text-ink-success'
          : tone === 'warning'
            ? 'text-ink-warning'
            : tone === 'muted'
              ? 'text-ink-muted'
              : 'text-slate-900'
      }`}
    >
      {value}
    </div>
  </div>
);
