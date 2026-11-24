import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { can } from '../../services/permissions';
import { DatePickerRange, todayISO } from '../common/DatePickerRange';
import { EmptyState, DataTable, GlassSelect, Modal } from '../common/ui';
import { formatPKR } from '../../services/financeDomain';
import {
  buildDailyLabReportPdf,
  downloadPdf,
  type DailyLabReportColumn,
  type DailyLabReportRow,
} from '../../lib/pdf';
import { getTodayStr } from '../../utils/dateUtils';
import {
  buildDailyLabReport,
  defaultDailyReportInclude,
  getDailyReportInclude,
  setDailyReportInclude,
  type DailyReportInclude,
  type ClinicWorkRow,
  type ProductionRow,
} from '../../services/dailyLabReport';
import {
  Building2,
  CalendarDays,
  ChevronRight,
  FileDown,
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
  const { cases, invoices, advancePayments, brandingSettings, showToast, user } = useApp();

  // Today by default: the report is a daily instrument first and foremost.
  const [from, setFrom] = useState<string>(() => todayISO());
  const [to, setTo] = useState<string>(() => todayISO());
  const [includeArchived, setIncludeArchived] = useState(false);
  /* No tick = every type. This is the ONLY filter the operator's question
     needs: "how much zirconia did each clinic send us this month" — and it has
     to take several answers at once ("zirconia and e.max"), because asking two
     treatments is one question, not two reports. */
  const [caseTypes, setCaseTypes] = useState<string[]>([]);
  /** The clinic whose type detail is open, if any. */
  const [detail, setDetail] = useState<ClinicWorkRow | null>(null);
  /**
   * Which reading of the same window is on screen.
   *
   * `sheet` is case by case — what arrived. `clinic` is the same work rolled
   * up per clinic — who sent it, how much of it, and what it was worth. They
   * are two views of ONE query (same window, same filters), which is why this
   * is a switch and not a second report: nothing can fall out of sync.
   */
  const [pane, setPane] = useState<'sheet' | 'clinic'>('sheet');
  /**
   * The operator's include-toggles — "which things the report shows". The
   * list is first: what's in the sheet is decided here, then read off.
   * `units` ships off: the operator never asked for a units column.
   */
  const [include, setInclude] = useState<DailyReportInclude>(() => getDailyReportInclude());
  const OPTION_ITEMS: Array<[keyof DailyReportInclude, string]> = [
    ['caseNumber', 'Case #'],
    ['receivedDate', 'Received'],
    ['deliveryDate', 'Delivery'],
    ['caseType', 'Type'],
    ['patient', 'Patient'],
    ['doctor', 'Doctor'],
    ['clinic', 'Clinic'],
    ['status', 'Status'],
    ['units', 'Units'],
    ['teeth', 'Teeth'],
    ['shade', 'Shade'],
    ['price', 'Fee'],
  ];

  /* The print columns: same keys as the dropdown, with the page widths and
     alignment the A4 sheet needs. Only the operator's ticked keys go to paper. */
  const PRINT_COLUMNS: DailyLabReportColumn[] = [
    { key: 'caseNumber', label: 'CASE', w: 58, align: 'left' },
    { key: 'receivedDate', label: 'RECEIVED', w: 58, align: 'left' },
    { key: 'deliveryDate', label: 'DELIVERY', w: 58, align: 'left' },
    { key: 'caseType', label: 'TYPE', w: 62, align: 'left' },
    { key: 'patient', label: 'PATIENT', w: 78, align: 'left' },
    { key: 'doctor', label: 'DOCTOR', w: 74, align: 'left' },
    { key: 'clinic', label: 'CLINIC', w: 112, align: 'left' },
    { key: 'status', label: 'STATUS', w: 52, align: 'left' },
    { key: 'units', label: 'UNITS', w: 34, align: 'right' },
    { key: 'teeth', label: 'TEETH', w: 48, align: 'left' },
    { key: 'shade', label: 'SHADE', w: 34, align: 'left' },
    { key: 'fee', label: 'FEE', w: 62, align: 'right' },
  ];

  /* The production sheet's columns, each tagged with the include-toggle it
     belongs to — so a toggled-off field disappears from the list and nothing
     about it lingers (header, width, order). */
  type SheetColumn = {
    key: keyof DailyReportInclude;
    header: React.ReactNode;
    className?: string;
    render: (r: ProductionRow) => React.ReactNode;
  };
  const sheetColumns: SheetColumn[] = [
    { key: 'caseNumber', header: 'Case #', className: 'font-bold text-slate-900 font-mono whitespace-nowrap', render: (r) => <>{r.caseNumber}</> },
    { key: 'receivedDate', header: 'Received', className: 'whitespace-nowrap text-slate-600 tabular-nums', render: (r) => <>{r.receivedDate}</> },
    { key: 'caseType', header: 'Type', className: 'whitespace-nowrap text-slate-700', render: (r) => <>{r.caseType}</> },
    { key: 'patient', header: 'Patient', className: 'font-semibold text-slate-900 whitespace-nowrap', render: (r) => <>{r.patient}</> },
    { key: 'doctor', header: 'Doctor', className: 'text-slate-700 whitespace-nowrap', render: (r) => <>{r.doctor}</> },
    { key: 'clinic', header: 'Clinic', className: 'text-slate-600 whitespace-nowrap', render: (r) => <>{r.clinic}</> },
    {
      key: 'deliveryDate',
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
    { key: 'units', header: 'Units', className: 'text-right tabular-nums text-slate-600 whitespace-nowrap', render: (r) => <>{r.units > 0 ? r.units : ''}</> },
    { key: 'teeth', header: 'Teeth', className: 'text-slate-600 whitespace-nowrap', render: (r) => <>{r.teeth || ''}</> },
    { key: 'shade', header: 'Shade', className: 'font-mono text-slate-600 whitespace-nowrap', render: (r) => <>{r.shade}</> },
    {
      key: 'status',
      header: 'Status',
      className: 'whitespace-nowrap',
      render: (r) => (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold capitalize bg-slate-100 text-slate-700">
          {String(r.status).replace('_', ' ')}
        </span>
      ),
    },
    { key: 'price', header: 'Fee', className: 'text-right font-mono font-bold text-slate-900 whitespace-nowrap', render: (r) => <>{formatPKR(r.price)}</> },
  ];

  const report = useMemo(
    () =>
      buildDailyLabReport({
        cases,
        invoices,
        advancePayments,
        from,
        to,
        includeArchived,
        caseTypes,
        include,
      }),
    [cases, invoices, advancePayments, from, to, includeArchived, caseTypes, include]
  );

  /* The production sheet's list, filtered by the operator's toggles. */
  const sheetColumnsOn: SheetColumn[] = sheetColumns.filter((c) => report.include[c.key]);

  /** The scope as it reads on screen — the chip, the empty state and the
   *  drill-down header all name it the same way. */
  const typeLabel = report.caseType || 'All types';

  /* ---- Case types -----------------------------------------------------
   * Every type the lab has ever booked, alphabetically. Taken from the cases
   * rather than the price list: a retired type that still has cases in the
   * window must stay selectable.
   *
   * There is no "All types" row: no ticks IS all types, and the trigger says so
   * while the box is empty. A row would have to be un-ticked before one type
   * could be chosen, which is one click of work for nothing. */
  const typeOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of cases) {
      const name = (c.case_type_name || c.case_type || '').trim();
      if (name) names.add(name);
    }
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((n) => ({ value: n, label: n }));
  }, [cases]);

  /**
   * Build the report document. The PDF and the printed sheet are the same
   * report, so the figures are formatted once here and used by both.
   */
  const buildDocument = () => {
    const labName = brandingSettings?.lab_name || brandingSettings?.appName || 'Dental Lab';
    /* The label must say what the sheet left out, so a type filter that only
       lived in screen state never produces a document that reads as the lab's
       whole month. */
    const periodLabel = `${from || 'Beginning'} → ${to || 'Present'}${
      report.caseType ? ` · ${report.caseType} only` : ''
    }`;
    /* The operator's ticked fields become the printed columns — same flags
       the on-screen Values dropdown uses. `fee` is the print name for `price`. */
    const includeKey: Record<string, keyof DailyReportInclude> = {
      fee: 'price',
    };
    const columns = PRINT_COLUMNS.filter((c) =>
      report.include[includeKey[c.key] ?? (c.key as keyof DailyReportInclude)]
    );
    const rows: DailyLabReportRow[] = report.production.map((r) => ({
      caseNumber: r.caseNumber,
      receivedDate: r.receivedDate,
      deliveryDate: r.deliveryDate,
      caseType: r.caseType,
      patient: r.patient,
      doctor: r.doctor,
      clinic: r.clinic,
      status: String(r.status).replace('_', ' '),
      units: r.units > 0 ? String(r.units) : '',
      teeth: r.teeth && r.teeth !== '—' ? r.teeth : '',
      shade: r.shade && r.shade !== '—' ? r.shade : '',
      fee: formatPKR(r.price),
    }));
    const result = buildDailyLabReportPdf(rows, {
      labName,
      operator: user?.name || '—',
      periodLabel,
      generatedOn: getTodayStr(),
      columns,
    });
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

  if (!can(user, 'reports:view')) {
    return (
      <div className="p-6 text-center text-slate-500 text-sm">
        <p className="font-semibold text-slate-700 mb-1">Insufficient permission</p>
        <p className="text-xs">Daily reports are available to Super Admin and Audit Checker roles only.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 print-page">
      {/* Controls — screen only. The printed sheet carries the window in its
          own header instead. */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* ---- What's included — the operator's on/off list, FIRST in the
              list: decide here what the sheet and the PDF carry. `units`
              ships off, because the operator never asked for a units column. */}
          <GlassSelect
            multiple
            ariaLabel="Values"
            emptyLabel="Include: everything"
            values={OPTION_ITEMS.filter(([k]) => include[k]).map(([k]) => k)}
            onValuesChange={(selected) => {
              const sel = new Set(selected);
              const next = defaultDailyReportInclude();
              OPTION_ITEMS.forEach(([k]) => { next[k] = sel.has(k); });
              setInclude(next);
              setDailyReportInclude(next);
            }}
            options={OPTION_ITEMS.map(([k, label]) => ({ value: k, label }))}
            className="w-[300px] px-3 py-1.5 text-xs font-semibold text-slate-700"
          />
          <div
            role="group"
            aria-label="Report view"
            className="flex items-center rounded-xl border border-slate-200 bg-white p-0.5 shadow-2xs"
          >
            {([
              { key: 'sheet', label: 'Cases' },
              { key: 'clinic', label: 'By clinic' },
            ] as const).map((option) => {
              const active = pane === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setPane(option.key)}
                  aria-pressed={active}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600 whitespace-nowrap cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            Include archived
          </label>
          {/* The type filter: "which clinics sent us zirconia this month, and
              how much of it?". The WINDOW comes from the date pickers alone —
              one control per decision, and the month shortcut was a third way
              to set a range the pickers already own. */}
          <GlassSelect
            multiple
            ariaLabel="Case types to include"
            values={caseTypes}
            onValuesChange={setCaseTypes}
            options={typeOptions}
            emptyLabel="All types"
            className="w-[288px] px-3 py-1.5 text-xs font-semibold text-slate-700"
          />
        </div>
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
            className="px-3 py-1.5 ds-glass-pill text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
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

        {/* Production sheet — the "Cases" reading of the window. */}
        {pane === 'sheet' && (
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
              columns={sheetColumnsOn}
            />
          )}
        </div>
        )}

        {/* ---- Work by clinic — the "By clinic" reading ---------------------
            The same window, rolled up per clinic: who sent this kind of job,
            how many, how many units, and what it came to. Rows open the
            individual cases behind the total, so a number can always be
            traced to the work that produced it.

            It works with or without a type selected; choosing one narrows
            every figure to that treatment, which is the question this reading
            exists to answer. */}
        {pane === 'clinic' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50 gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Work by clinic
              </h3>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-100">
                {typeLabel}
              </span>
              <span className="text-[11px] text-slate-500">{report.byClinic.length} clinics</span>
            </div>
            <div className="text-[11px] text-slate-500">
              {windowLabel} · click a clinic to see its cases
            </div>
          </div>

          {report.byClinic.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={
                caseTypes.length ? `No ${typeLabel} work in this window` : 'No clinic work in this window'
              }
              description={
                caseTypes.length
                  ? `No ${typeLabel} cases were received between these dates. Try another month, or untick the type filter.`
                  : 'Nothing was received between these dates. Widen the range to see earlier work.'
              }
            />
          ) : (
            <div>
              {/* Column labels. The rows below are buttons, so this is a table
                  that a keyboard can walk through one clinic at a time. */}
              <div className="hidden sm:grid grid-cols-[1fr_64px_64px_120px_24px] gap-3 px-4 py-2 border-b border-slate-100 ds-th">
                <span>Clinic</span>
                <span className="text-right">Cases</span>
                {report.include.units && <span className="text-right">Units</span>}
                <span className="text-right">Value</span>
                <span />
              </div>
              <ul className="divide-y divide-slate-100">
                {report.byClinic.map((row) => (
                  <li key={row.labId}>
                    <button
                      type="button"
                      onClick={() => setDetail(row)}
                      className="w-full text-left grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_64px_64px_120px_24px] items-center gap-3 px-4 py-2.5 hover:bg-slate-50/80 transition-colors cursor-pointer"
                      aria-label={`${row.labName}: ${row.cases} cases, ${formatPKR(row.value)}`}
                    >
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-slate-900 truncate">
                          {row.labName}
                        </span>
                        <span className="block text-[11px] text-slate-500 truncate">
                          {row.doctor && row.doctor !== '—' ? row.doctor : 'No doctor on file'}
                        </span>
                        <span className="sm:hidden block text-[11px] text-slate-600 mt-0.5 tabular-nums">
                          {row.cases} cases · {row.units} units · {formatPKR(row.value)}
                        </span>
                      </span>
                      <span className="hidden sm:block text-right text-xs font-semibold text-slate-700 tabular-nums">
                        {row.cases}
                      </span>
                      {report.include.units && (
                        <span className="hidden sm:block text-right text-xs text-slate-600 tabular-nums">
                          {row.units > 0 ? row.units : ''}
                        </span>
                      )}
                      <span className="hidden sm:block text-right text-xs font-bold text-slate-900 tabular-nums">
                        {formatPKR(row.value)}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-400 justify-self-end" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        )}

      </div>

      {/* ---- Clinic detail: the cases behind one clinic's total. */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        label="Clinic work detail"
        maxWidth="max-w-3xl"
        header={
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
              {typeLabel} · {windowLabel}
            </div>
            <h2 className="text-base font-bold text-slate-900 truncate">
              {detail?.labName || ''}
            </h2>
          </div>
        }
      >
        {detail && (
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Cases</div>
                <div className="text-lg font-bold text-slate-900 tabular-nums">{detail.cases}</div>
              </div>
              {report.include.units && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Units</div>
                  <div className="text-lg font-bold text-slate-900 tabular-nums">{detail.units}</div>
                </div>
              )}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Value</div>
                <div className="text-lg font-bold text-slate-900 tabular-nums">{formatPKR(detail.value)}</div>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Doctor on file: {detail.doctor && detail.doctor !== '—' ? detail.doctor : 'none'}
            </p>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <DataTable<ProductionRow>
                data={detail.rows}
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
                    header: 'Patient',
                    className: 'font-semibold text-slate-900 whitespace-nowrap',
                    render: (r) => <>{r.patient}</>,
                  },
                  {
                    header: 'Type',
                    className: 'whitespace-nowrap text-slate-700',
                    render: (r) => <>{r.caseType}</>,
                  },
                  ...(report.include.units
                    ? [{
                        header: 'Units' as const,
                        align: 'right' as const,
                        className: 'tabular-nums text-slate-600 whitespace-nowrap',
                        render: (r: ProductionRow) => <>{r.units > 0 ? r.units : ''}</>,
                      }]
                    : []),
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
                    align: 'right' as const,
                    className: 'font-mono font-bold text-slate-900 whitespace-nowrap',
                    render: (r) => <>{formatPKR(r.price)}</>,
                  },
                ]}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
