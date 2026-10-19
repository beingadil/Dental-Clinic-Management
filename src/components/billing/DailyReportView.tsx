import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DatePickerRange, todayISO } from '../common/DatePickerRange';
import { EmptyState, DataTable } from '../common/ui';
import { formatPKR } from '../../services/financeDomain';
import { downloadCSV } from '../../services/csvExport';
import { printCurrentDocument } from '../../utils/printDocument';
import { getTodayStr } from '../../utils/dateUtils';
import {
  buildDailyLabReport,
  dailyReportCsvRows,
  type ProductionRow,
} from '../../services/dailyLabReport';
import {
  CalendarDays,
  Download,
  Printer,
  PackageCheck,
  PackageOpen,
  Clock,
  TriangleAlert,
  Building2,
  FileText,
  Wallet,
} from 'lucide-react';

/**
 * DAILY LAB REPORT.
 *
 * The end-of-day answer: what came in, what is due, what went out, and what is
 * still owed. A production sheet the operator reads off the bench, and a print
 * that goes into the lab's own records.
 *
 * The print is a FIRST-CLASS deliverable here, not an afterthought: the
 * `.print-flow` container is the only thing on the page that prints, and it
 * carries the same rows the screen shows. `printCurrentDocument()` waits for
 * the browser to actually paint it before the dialog opens, so the sheet is
 * never blank.
 */
export const DailyReportView: React.FC = () => {
  const { cases, invoices, advancePayments } = useApp();

  // Today by default: the report is a daily instrument first and foremost.
  const [from, setFrom] = useState<string>(() => todayISO());
  const [to, setTo] = useState<string>(() => todayISO());
  const [includeArchived, setIncludeArchived] = useState(false);

  const report = useMemo(
    () =>
      buildDailyLabReport({
        cases,
        invoices,
        advancePayments,
        from,
        to,
        includeArchived,
      }),
    [cases, invoices, advancePayments, from, to, includeArchived]
  );

  const handleExportCSV = () => {
    downloadCSV(
      `Dental_Solutions_Daily_Report_${from}_${to}`,
      dailyReportCsvRows(report)
    );
  };

  const handlePrint = () => {
    void printCurrentDocument();
  };

  const windowLabel = `${from || 'Beginning'} → ${to || 'Present'}`;

  return (
    <div className="space-y-4 print-page">
      {/* Controls — screen only. The printed sheet carries the window in its
          own header instead. */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <DatePickerRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600 whitespace-nowrap cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            Include archived
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCSV}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Printer className="w-3.5 h-3.5" /> Print Report
          </button>
        </div>
      </div>

      {/* ============ PRINTED SHEET ============ */}
      <div className="space-y-4 print-flow">
        {/* Sheet header — the printed document's own title block. */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-base font-bold text-slate-900">Daily Lab Report</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Production summary · {windowLabel}
              </p>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Generated</div>
              <div className="text-xs font-semibold text-slate-800">{getTodayStr()}</div>
            </div>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi
            icon={PackageOpen}
            label="Cases received"
            value={report.received}
            tone="indigo"
          />
          <Kpi
            icon={PackageCheck}
            label="Due for delivery"
            value={report.due}
            tone="emerald"
          />
          <Kpi
            icon={Clock}
            label="Still open"
            value={report.open}
            tone="amber"
          />
          <Kpi
            icon={TriangleAlert}
            label="Overdue"
            value={report.overdue}
            tone={report.overdue > 0 ? 'rose' : 'slate'}
          />
        </div>

        {/* Money row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <MoneyCard
            icon={FileText}
            label="Invoices raised"
            count={report.invoicesRaised}
            amount={report.invoicedValue}
            tone="indigo"
          />
          <MoneyCard
            icon={Wallet}
            label="Payments received"
            count={report.paymentsReceived}
            amount={report.paidValue}
            tone="emerald"
          />
          <MoneyCard
            icon={Building2}
            label="Total outstanding"
            count={undefined}
            amount={report.totalOutstanding}
            tone="amber"
            note="Across the whole lab, not just this window"
          />
        </div>

        {/* Production sheet */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50 gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Production Sheet
              </h3>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                {report.production.length} cases
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              Newest first · received date, type, doctor, patient, delivery date
            </div>
          </div>

          {report.production.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No cases received in this window"
              description="Nothing entered the lab between these dates. Widen the date range to see earlier work."
            />
          ) : (
            <DataTable<ProductionRow>
              data={report.production}
              rowKey={(r) => r.id}
              columns={[
                {
                  header: 'Case #',
                  className: 'font-bold text-slate-900 font-mono whitespace-nowrap',
                  render: (r) => <>{r.caseNumber}</>,
                },
                {
                  header: 'Received',
                  className: 'whitespace-nowrap text-slate-600 tabular-nums',
                  render: (r) => <>{r.receivedDate}</>,
                },
                {
                  header: 'Type',
                  className: 'whitespace-nowrap text-slate-700',
                  render: (r) => <>{r.caseType}</>,
                },
                {
                  header: 'Patient',
                  className: 'font-semibold text-slate-900 whitespace-nowrap',
                  render: (r) => <>{r.patient}</>,
                },
                {
                  header: 'Doctor',
                  className: 'text-slate-700 whitespace-nowrap',
                  render: (r) => <>{r.doctor}</>,
                },
                {
                  header: 'Clinic',
                  className: 'text-slate-600 whitespace-nowrap',
                  render: (r) => <>{r.clinic}</>,
                },
                {
                  header: 'Delivery',
                  className: 'whitespace-nowrap tabular-nums',
                  render: (r) => (
                    <span className={r.isOverdue ? 'font-bold text-rose-700' : 'text-slate-600'}>
                      {r.deliveryDate}
                      {r.isOverdue && (
                        <span className="ml-1 text-[10px] font-bold uppercase">
                          {Math.abs(r.daysRemaining)}d late
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  header: 'Units',
                  className: 'text-right tabular-nums text-slate-600 whitespace-nowrap',
                  render: (r) => <>{r.units || '—'}</>,
                },
                {
                  header: 'Shade',
                  className: 'font-mono text-slate-600 whitespace-nowrap',
                  render: (r) => <>{r.shade}</>,
                },
                {
                  header: 'Status',
                  className: 'whitespace-nowrap',
                  render: (r) => (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold capitalize bg-slate-100 text-slate-700">
                      {String(r.status).replace('_', ' ')}
                    </span>
                  ),
                },
                {
                  header: 'Fee',
                  className: 'text-right font-mono font-bold text-slate-900 whitespace-nowrap',
                  render: (r) => <>{formatPKR(r.price)}</>,
                },
              ]}
            />
          )}
        </div>

        {/* Per-clinic breakdown */}
        {report.clinics.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                By Clinic
              </h3>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                {report.clinics.length} clinics
              </span>
            </div>
            <DataTable
              data={report.clinics}
              rowKey={(r) => r.labId}
              columns={[
                {
                  header: 'Clinic',
                  className: 'font-bold text-slate-900 whitespace-nowrap',
                  render: (r) => <>{r.labName}</>,
                },
                {
                  header: 'Doctor',
                  className: 'text-slate-600 whitespace-nowrap',
                  render: (r) => <>{r.doctor || '—'}</>,
                },
                {
                  header: 'Received',
                  className: 'text-right tabular-nums text-slate-700 whitespace-nowrap',
                  render: (r) => <>{r.casesReceived}</>,
                },
                {
                  header: 'Due',
                  className: 'text-right tabular-nums text-slate-700 whitespace-nowrap',
                  render: (r) => <>{r.casesDue}</>,
                },
                {
                  header: 'Invoiced',
                  className: 'text-right font-mono text-slate-700 whitespace-nowrap',
                  render: (r) => <>{formatPKR(r.invoicedValue)}</>,
                },
                {
                  header: 'Paid',
                  className: 'text-right font-mono text-emerald-700 whitespace-nowrap',
                  render: (r) => <>{formatPKR(r.paidValue)}</>,
                },
                {
                  header: 'Outstanding',
                  className: 'text-right font-mono font-bold text-slate-900 whitespace-nowrap',
                  render: (r) => <>{formatPKR(r.outstanding)}</>,
                },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
};

/* ── Small presentational pieces ──────────────────────────────────────────── */

const Kpi: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: 'indigo' | 'emerald' | 'amber' | 'rose' | 'slate';
}> = ({ icon: Icon, label, value, tone }) => {
  const tones = {
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    slate: 'bg-slate-50 text-slate-600 border-slate-200',
  } as const;
  return (
    <div className={`p-4 rounded-2xl border ${tones[tone]}`}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" />
        <span className="text-[11px] font-bold uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold font-mono mt-1">{value}</div>
    </div>
  );
};

const MoneyCard: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  amount: number;
  count?: number;
  tone: 'indigo' | 'emerald' | 'amber';
  note?: string;
}> = ({ icon: Icon, label, amount, count, tone, note }) => {
  const tones = {
    indigo: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
  } as const;
  return (
    <div className={`p-4 rounded-2xl border ${tones[tone]}`}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" />
        <span className="text-[11px] font-bold uppercase tracking-wider">{label}</span>
        {count !== undefined && (
          <span className="ml-auto text-[11px] font-bold tabular-nums opacity-70">{count}</span>
        )}
      </div>
      <div className="text-xl font-bold font-mono mt-1">{formatPKR(amount)}</div>
      {note && <p className="text-[10px] mt-0.5 opacity-70">{note}</p>}
    </div>
  );
};
