import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Invoice, SavedVoucher } from '../../types';
import { DatePickerRange, todayISO } from '../common/DatePickerRange';
import { getTodayStr } from '../../utils/dateUtils';
import { formatDoctorName } from '../../utils/doctorName';
import { EmptyState, DataTable } from '../common/ui';
import { formatPKR } from '../../services/financeDomain';
import { downloadCSV } from '../../services/csvExport';
import {
  buildMonthlyStatements,
  formatMonthLabel,
  monthlyStatementCsvRows,
} from '../../services/monthlyStatement';
import {
  BarChart3,
  BookmarkCheck,
  BookOpen,
  Download,
  Printer,
  Trash2,
  Search,
  Calendar,
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
  const { invoices, cases, savedVouchers, deleteSavedVoucher, advancePayments, accountAdjustments } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<'monthly' | 'vouchers' | 'daily'>('monthly');
  const [voucherSearch, setVoucherSearch] = useState<string>('');
  // Saved-voucher list defaults to TODAY like the other billing tabs; rewind the
  // picker (or clear it for All Time) to audit earlier vouchers.
  const [vFromDate, setVFromDate] = useState<string>(() => todayISO());
  const [vToDate, setVToDate] = useState<string>(() => todayISO());

  /* Month-by-month statement of account. Every figure is dated to the month
     the money moved (see services/monthlyStatement), so "Collected" is what
     actually landed this month — not a lifetime per-invoice total filed under
     the invoice's creation month — and each month carries its opening balance
     forward into a closing balance, with advance credit and the amount still
     remaining shown separately. */
  const monthlyBlocks = useMemo(
    () => buildMonthlyStatements({ invoices, advancePayments, accountAdjustments }),
    [invoices, advancePayments, accountAdjustments]
  );

  // Export CSV of the Monthly Statement (app exporter: correct RFC-4180
  // quoting, and it actually writes a file inside the Tauri shell).
  const handleExportMonthlyCSV = () => {
    downloadCSV(
      `Dental_Solutions_Monthly_Statement_${getTodayStr()}`,
      monthlyStatementCsvRows(monthlyBlocks)
    );
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

  return (
    <div className="space-y-5">
      
      {/* Sub-navigation bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveSubTab('monthly')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
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
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
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
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
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
          <button
            onClick={handleExportMonthlyCSV}
            className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export Monthly Statement CSV</span>
          </button>
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
          {monthlyBlocks.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No Billing Records Yet"
              description="Once invoices, payments or advances are recorded for this period, the monthly statement by clinic appears here."
            />
          ) : (
            monthlyBlocks.map((block) => {
              const t = block.totals;
              return (
                <div key={block.month} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                  {/* Month header */}
                  <div className="bg-slate-900 text-white px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-indigo-400" />
                      <span className="font-bold text-sm">{formatMonthLabel(block.month)}</span>
                      <span className="text-xs text-slate-300 font-normal">
                        ({t.clinics} Active Clinics)
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <span>Billed: <strong>{formatPKR(t.billed)}</strong></span>
                      <span className="text-emerald-400">Collected: <strong>{formatPKR(t.collected)}</strong></span>
                      {t.advance_received > 0 && (
                        <span className="text-sky-400">Advance In: <strong>{formatPKR(t.advance_received)}</strong></span>
                      )}
                      {t.advance_credit > 0 && (
                        <span className="text-sky-300">Advance Held: <strong>{formatPKR(t.advance_credit)}</strong></span>
                      )}
                      <span className={t.closing_balance < 0 ? 'text-emerald-400' : 'text-white'}>
                        Closing: <strong>{formatPKR(t.closing_balance)}</strong>
                      </span>
                      <span className={t.remaining > 0 ? 'text-amber-400 font-bold' : 'text-slate-300'}>
                        Remaining: <strong>{formatPKR(t.remaining)}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Clinics Table. The "Month Total" row used to be why this stayed hand-rolled:
                      DataTable had no <tfoot> slot, and its `footer` prop renders
                      AFTER the closing </table>, so the totals row stopped being a
                      row of the table — which is exactly what
                      billingReportsMonthly.test.tsx asserts against
                      (`within(table).getByText('Month Total').closest('tr')`).
                      `tfoot` now renders inside the table, so it can. */}
                  <DataTable
                    data={block.rows}
                    rowKey={(r) => r.lab_id}
                    tfoot={
                      <tr className="bg-slate-900/95 text-white font-bold text-[11px] uppercase tracking-wider">
                        <td className="py-2.5 px-4">Month Total</td>
                        <td className="py-2.5 px-4 text-center">{t.cases_billed}</td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">{formatPKR(t.billed)}</td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap text-emerald-300">{formatPKR(t.collected)}</td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap text-sky-300">{formatPKR(t.advance_received)}</td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap text-sky-300">{formatPKR(t.advance_applied)}</td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap text-rose-300">{formatPKR(t.credit_notes)}</td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap text-amber-300">{formatPKR(t.debit_adjustments)}</td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap text-slate-300">{formatPKR(t.opening_balance)}</td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">{formatPKR(t.closing_balance)}</td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap text-sky-300">{formatPKR(t.advance_credit)}</td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap text-amber-300">{formatPKR(t.remaining)}</td>
                      </tr>
                    }
                    columns={[
                      {
                        header: 'Dental Clinic',
                        className: 'py-2.5 px-4 font-bold text-slate-800',
                        render: (r) => (
                          <span className="flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-ink-muted shrink-0" />
                            <span>{r.lab_name}</span>
                          </span>
                        ),
                      },
                      {
                        header: 'Cases Billed',
                        align: 'center',
                        className: 'py-2.5 px-4 font-semibold text-slate-600',
                        render: (r) => r.cases_billed,
                      },
                      {
                        header: 'Billed (Dr)',
                        align: 'right',
                        className: 'py-2.5 px-4 font-bold text-slate-900 whitespace-nowrap',
                        render: (r) => formatPKR(r.billed),
                      },
                      {
                        header: 'Collected (Cr)',
                        align: 'right',
                        className: 'py-2.5 px-4 font-bold text-ink-success whitespace-nowrap',
                        render: (r) => formatPKR(r.collected),
                      },
                      {
                        header: <span title="Advance deposits banked this month">Advance In</span>,
                        align: 'right',
                        className: 'py-2.5 px-4 font-semibold whitespace-nowrap',
                        /* Zero-emphasis on a money figure is decided per row,
                           so it rides on the cell content, not the column. */
                        render: (r) => (
                          <span className={r.advance_received > 0 ? 'text-sky-600' : 'text-ink-muted'}>
                            {formatPKR(r.advance_received)}
                          </span>
                        ),
                      },
                      {
                        header: <span title="Advance credit spent against invoices this month">Advance Used</span>,
                        align: 'right',
                        className: 'py-2.5 px-4 font-semibold whitespace-nowrap',
                        render: (r) => (
                          <span className={r.advance_applied > 0 ? 'text-sky-700' : 'text-ink-muted'}>
                            {formatPKR(r.advance_applied)}
                          </span>
                        ),
                      },
                      {
                        header: 'Credit Notes',
                        align: 'right',
                        className: 'py-2.5 px-4 font-semibold whitespace-nowrap',
                        render: (r) => (
                          <span className={r.credit_notes > 0 ? 'text-ink-danger' : 'text-ink-muted'}>
                            {formatPKR(r.credit_notes)}
                          </span>
                        ),
                      },
                      {
                        header: 'Debit Adj.',
                        align: 'right',
                        className: 'py-2.5 px-4 font-semibold whitespace-nowrap',
                        render: (r) => (
                          <span className={r.debit_adjustments > 0 ? 'text-amber-700' : 'text-ink-muted'}>
                            {formatPKR(r.debit_adjustments)}
                          </span>
                        ),
                      },
                      {
                        header: <span title="Balance brought forward from the previous month">Opening (B/F)</span>,
                        align: 'right',
                        className: 'py-2.5 px-4 text-slate-500 whitespace-nowrap',
                        render: (r) => formatPKR(r.opening_balance),
                      },
                      {
                        header: <span title="Closing balance carried into the next month">Closing (C/F)</span>,
                        align: 'right',
                        className: 'py-2.5 px-4 font-bold whitespace-nowrap',
                        render: (r) => (
                          <span className={r.closing_balance < 0 ? 'text-ink-success' : 'text-slate-900'}>
                            {formatPKR(r.closing_balance)}
                          </span>
                        ),
                      },
                      {
                        header: <span title="Unallocated advance wallet at month end">Advance Credit</span>,
                        align: 'right',
                        className: 'py-2.5 px-4 font-semibold whitespace-nowrap',
                        render: (r) => (
                          <span className={r.advance_credit > 0 ? 'text-sky-700' : 'text-ink-muted'}>
                            {formatPKR(r.advance_credit)}
                          </span>
                        ),
                      },
                      {
                        header: <span title="Still owed by the clinic at month end">Remaining Due</span>,
                        align: 'right',
                        className: 'py-2.5 px-4 font-bold whitespace-nowrap',
                        render: (r) => (
                          <span className={r.remaining > 0 ? 'text-ink-warning' : 'text-ink-muted'}>
                            {formatPKR(r.remaining)}
                          </span>
                        ),
                      },
                    ]}
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
