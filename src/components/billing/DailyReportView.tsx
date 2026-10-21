import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DatePickerRange, todayISO } from '../common/DatePickerRange';
import { EmptyState, DataTable } from '../common/ui';
import { formatPKR } from '../../services/financeDomain';
import { buildDailyReportPdf, downloadPdf } from '../../lib/pdf';
import { getTodayStr } from '../../utils/dateUtils';
import {
  buildDailyLabReport,
  type ProductionRow,
} from '../../services/dailyLabReport';
import {
  CalendarDays,
  FileDown,
  FileText,
  Wallet,
  Building2,
} from 'lucide-react';

/**
 * DAILY LAB REPORT.
 *
 * The end-of-day answer: what came in, what is due, what went out, and what is
 * still owed. A production sheet the operator reads off the bench, and a
 * document that goes into the lab's own records.
 *
 * "Export PDF" writes that document to a file: a real, vector PDF built from
 * the same rows, with selectable text and real page breaks — not a picture of
 * the screen. The `.print-flow` container is still the one thing on the page
 * that prints, so the browser's own print (Ctrl+P) produces the same sheet.
 */
export const DailyReportView: React.FC = () => {
  const { cases, invoices, advancePayments, brandingSettings, showToast } = useApp();

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

  /**
   * Build the report document. The PDF and the printed sheet are the same
   * report, so the figures are formatted once here and used by both.
   */
  const buildDocument = () => {
    const labName = brandingSettings?.lab_name || brandingSettings?.appName || 'Dental Lab';
    const periodLabel = `${from || 'Beginning'} → ${to || 'Present'}`;
    const result = buildDailyReportPdf(
      report.production.map((r) => ({
        caseNumber: r.caseNumber,
        receivedDate: r.receivedDate,
        caseType: r.caseType,
        patient: r.patient,
        doctor: r.doctor,
        clinic: r.clinic,
        deliveryDate: r.deliveryDate,
        daysLate: r.isOverdue ? Math.abs(r.daysRemaining) : 0,
        fee: r.price,
      })),
      report.clinics.map((c) => ({
        clinicName: c.labName,
        doctor: c.doctor,
        casesReceived: c.casesReceived,
        casesDue: c.casesDue,
        invoicedValue: c.invoicedValue,
        paidValue: c.paidValue,
        outstanding: c.outstanding,
      })),
      {
        labName,
        periodLabel,
        generatedOn: getTodayStr(),
        invoicesRaised: report.invoicesRaised,
        invoicedValue: report.invoicedValue,
        paymentsReceived: report.paymentsReceived,
        paidValue: report.paidValue,
        totalOutstanding: report.totalOutstanding,
      }
    );
    const fileName = `Daily_Report_${from || 'Beginning'}_${to || 'Present'}`.replace(
      /[^A-Za-z0-9_-]+/g,
      '_'
    );
    return { fileName: `${fileName}.pdf`, pdf: result.pdf };
  };

  const handleExportPDF = async () => {
    try {
      const { fileName, pdf } = buildDocument();
      const outcome = await downloadPdf(fileName, pdf, 'PDF document');
      /* Only the unhappy paths are announced. A successful save is confirmed
         by the chooser the operator just dismissed; a banner on top of that is
         noise. Cancelling says nothing — they chose that.

         The one success worth saying is the one where there was no chooser:
         the file went to the browser's own download folder, and the operator
         would otherwise be hunting the filesystem for a dialog that was
         never going to appear. */
      if (outcome.status === 'error') {
        showToast(`Could not save the PDF: ${outcome.message}`, 'error');
      } else if (outcome.status === 'saved' && outcome.location === 'downloads') {
        showToast(`Saved ${outcome.path} to your browser's downloads folder.`, 'info');
      }
    } catch (e) {
      showToast(
        `Could not export the report: ${e instanceof Error ? e.message : String(e)}`,
        'error'
      );
    }
  };

  const windowLabel = `${from || 'Beginning'} → ${to || 'Present'}`;

  return (
    <div className="space-y-4 print-page">
      {/* Controls — screen only. The printed sheet carries the window in its
          own header instead. */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <label className="flex items-center gap-1.5 text-[11px] text-slate-600 whitespace-nowrap cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
          />
          Include archived
        </label>
        {/* The date window sits NEXT TO the export, because it is the
            export's window: you choose the period, then take the document for
            it. They were on opposite ends of the card, so the control that
            decides what the button produces was nowhere near the button. */}
        <div className="flex items-center gap-2">
          <DatePickerRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <button
            type="button"
            onClick={handleExportPDF}
            title="Download the report as a PDF (selectable text, real pages)"
            aria-label="Download the daily lab report as a PDF"
            className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <FileDown className="w-3.5 h-3.5" /> Export PDF
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
