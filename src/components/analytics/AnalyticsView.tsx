import { formatPKR } from '../../services/financeDomain';
import React, { useState, useMemo } from 'react';
import { getDateStr, getTodayStr, getNowStamp } from '../../utils/dateUtils';
import { useApp } from '../../context/AppContext';
import { computeAnalyticsForPeriod } from '../../services/analyticsService';
import { DatePickerRange } from '../common/DatePickerRange';
import { prioritySlaLabel } from '../../services/prioritySla';
import { DataTable } from '../common/ui';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  LabelList 
} from 'recharts';
import { 
  BarChart3, 
  DollarSign, 
  CheckCircle2, 
  AlertTriangle, 
  Download, 
  Award 
} from 'lucide-react';

type PeriodId = 'this_month' | 'last_3_months' | 'this_year' | 'all_time' | 'custom';

const todayParts = () => {
  const now = new Date();
  return {
    today: getTodayStr(),
    monthStart: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
    threeMonthsAgo: getDateStr(new Date(now.getFullYear(), now.getMonth() - 2, 1)),
    yearStart: `${now.getFullYear()}-01-01`,
  };
};

/**
 * Axis ticks only. The axis has no room for the thousands separators the
 * tooltips and KPI cards carry, so `85,000` reads `85k` and `1,250,000` reads
 * `1.25M`. Never used for a figure an operator reads as an exact amount.
 */
const axisPKR = (n: number): string => {
  const abs = Math.abs(n || 0);
  if (abs >= 1_000_000) return `${parseFloat((n / 1_000_000).toFixed(2))}M`;
  if (abs >= 1_000) return `${parseFloat((n / 1_000).toFixed(1))}k`;
  return String(n || 0);
};

/** Recharts spreads this onto its tick text, so it wins in both themes. */
const AXIS_TICK = { fontSize: 10, fill: 'var(--chart-axis-ink)' };

/**
 * Hand React the one custom property `.chart-swatch` consumes.
 *
 * `CSSProperties` has no index signature for `--x`, so the cast is
 * unavoidable — and it is what lets the paint stay in the stylesheet instead
 * of becoming an inline literal the dark token remap cannot reach.
 */
const swatchVars = (color: string) =>
  ({ '--swatch': color }) as unknown as React.CSSProperties;

/** A series-colour dot, painted by `.chart-swatch` from the custom property. */
const Swatch: React.FC<{ color: string; className: string }> = ({ color, className }) => (
  <span className={`chart-swatch ${className}`} style={swatchVars(color)} />
);

interface TipRow {
  label: string;
  value: string;
  color: string;
}

/** The one tooltip shell (`.chart-tooltip`), so the four panels cannot drift. */
const ChartTip: React.FC<{ heading?: string; rows: TipRow[]; note?: string }> = ({
  heading,
  rows,
  note,
}) => (
  <div className="chart-tooltip">
    {heading && <div className="mb-1 font-bold">{heading}</div>}
    {rows.map((r) => (
      <div key={r.label} className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5">
          <Swatch color={r.color} className="inline-block h-2 w-2 shrink-0 rounded-full" />
          {r.label}
        </span>
        <span className="font-bold tabular-nums">{r.value}</span>
      </div>
    ))}
    {note && (
      <div className="chart-tip-divider mt-1 pt-1 text-[10px] font-semibold opacity-80">
        {note}
      </div>
    )}
  </div>
);

/** Billed-vs-collected, plus the collection rate the two bars imply. */
const TrendTip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const pick = (key: string) => Number(payload.find((p: any) => p.dataKey === key)?.value ?? 0);
  const billed = pick('revenue');
  const collected = pick('collected');
  return (
    <ChartTip
      heading={String(label ?? '')}
      rows={[
        { label: 'Billed', value: formatPKR(billed), color: 'var(--chart-1)' },
        { label: 'Collected', value: formatPKR(collected), color: 'var(--chart-4)' },
      ]}
      note={billed > 0 ? `${Math.round((collected / billed) * 100)}% collected` : undefined}
    />
  );
};

/** One clinic bar, with its share of the period's clinic revenue. */
const ClinicTip: React.FC<any> = ({ active, payload, total }) => {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0]?.value ?? 0);
  return (
    <ChartTip
      heading={String(payload[0]?.payload?.name ?? '')}
      rows={[
        { label: 'Gross billing', value: formatPKR(value), color: 'var(--chart-2)' },
      ]}
      note={total > 0 ? `${Math.round((value / total) * 100)}% of clinic revenue` : undefined}
    />
  );
};

/** One pie slice: the value in its own unit, plus its share of the whole. */
const SliceTip: React.FC<any> = ({ active, payload, total, label, unit, format }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0];
  const value = Number(row?.value ?? 0);
  const shown = format === 'count' ? `${value.toLocaleString()} invoices` : formatPKR(value);
  return (
    <ChartTip
      heading={String(row?.name ?? '')}
      rows={[
        {
          label: label ?? 'Value',
          value: shown,
          color: String(row?.payload?.color ?? row?.color ?? 'var(--chart-1)'),
        },
      ]}
      note={total > 0 ? `${Math.round((value / total) * 100)}% ${unit}` : undefined}
    />
  );
};

/** A shared swatch + label, so all four legends read identically. */
const LegendItem: React.FC<{ color: string; label: string; value?: string }> = ({
  color,
  label,
  value,
}) => (
  <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
    <Swatch color={color} className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" />
    <span>{label}</span>
    {value && <span className="font-bold tabular-nums text-slate-800">{value}</span>}
  </span>
);

/**
 * One card shell for every panel. The four used to repeat this markup, which
 * is how their axis, legend and empty-state treatments drifted apart.
 */
const ChartPanel: React.FC<{
  title: string;
  hint: string;
  legend?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, hint, legend, children }) => (
  <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
    <div className="min-w-0">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <p className="text-xs text-slate-500">{hint}</p>
    </div>
    {legend && <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{legend}</div>}
    <div className="relative h-52">{children}</div>
  </div>
);

/** The shared "there is nothing to plot" body. */
const EmptyChart: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <div className="flex h-full flex-col items-center justify-center text-center">
    <BarChart3 className="mb-2 h-7 w-7 text-slate-200" />
    <p className="text-xs font-bold text-slate-600">{title}</p>
    {hint && <p className="text-[11px] text-ink-muted">{hint}</p>}
  </div>
);

export const AnalyticsView: React.FC = () => {
  const { cases, invoices, labs } = useApp();

  const t = todayParts();
  const [dateFilter, setDateFilter] = useState<PeriodId>('this_month');
  const [startDate, setStartDate] = useState(t.monthStart);
  const [endDate, setEndDate] = useState(t.today);

  // The chosen period as inclusive event-date bounds (null = all time).
  const period = useMemo<{ from: string | null; to: string | null; label: string }>(() => {
    switch (dateFilter) {
      case 'this_month': return { from: t.monthStart, to: t.today, label: 'This Month' };
      case 'last_3_months': return { from: t.threeMonthsAgo, to: t.today, label: 'Last 3 Months' };
      case 'this_year': return { from: t.yearStart, to: t.today, label: 'This Year' };
      case 'all_time': return { from: null, to: null, label: 'All Time' };
      case 'custom': return { from: startDate, to: endDate, label: 'Custom' };
    }
  }, [dateFilter, startDate, endDate, t.monthStart, t.today, t.threeMonthsAgo, t.yearStart]);

  // Invoices within the reporting period (event date = invoice creation).
  const periodInvoices = useMemo(
    () =>
      invoices.filter((i) => {
        const day = (i.created_at || '').slice(0, 10);
        if (period.from && day < period.from) return false;
        if (period.to && day > period.to) return false;
        return true;
      }),
    [invoices, period]
  );

  // Computed Summary Metrics (period-scoped)
  const totalRevenue = periodInvoices.reduce((sum, i) => sum + i.final_amount, 0);
  const totalCollected = periodInvoices.reduce((sum, i) => sum + i.amount_paid, 0);
  const totalUnpaid = totalRevenue - totalCollected;

  // DB-computed analytics — real figures from SQLite, bounded to the period.
  // caseTypes kept in the dependency list to satisfy the hook lint parity with
  // the sibling memos; the SQL service reads its own snapshot.
  const analytics = useMemo(() => computeAnalyticsForPeriod(period.from, period.to), [period.from, period.to, cases, invoices]);

  const deliveredCasesCount = analytics.overall.delivered;
  const onTimeDeliveryRate = analytics.overall.onTimePct;

  // Monthly Revenue & Collection — real, grouped from invoice dates within the period
  const monthlyRevenueData = useMemo(() => {
    const byMonth = new Map<string, { month: string; revenue: number; collected: number }>();
    for (const i of periodInvoices) {
      const key = (i.created_at || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(key)) continue;
      const bucket = byMonth.get(key) ?? {
        month: new Date(key + '-01').toLocaleString('en', { month: 'short' }),
        revenue: 0,
        collected: 0,
      };
      bucket.revenue += i.final_amount;
      bucket.collected += i.amount_paid;
      byMonth.set(key, bucket);
    }
    return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [periodInvoices]);

  // Payment Status Distribution Pie Data
  const unpaidCount = periodInvoices.filter((i) => i.payment_status === 'unpaid').length;
  const partialCount = periodInvoices.filter((i) => i.payment_status === 'partial').length;
  const paidCount = periodInvoices.filter((i) => i.payment_status === 'paid').length;

  const paymentStatusPieData = [
    { name: 'Paid', value: paidCount, color: 'var(--chart-pos)' },
    { name: 'Partial', value: partialCount, color: 'var(--chart-info)' },
    { name: 'Unpaid', value: unpaidCount, color: 'var(--chart-warn)' },
  ].filter((d) => d.value > 0);

  // Revenue By Lab Breakdown (period-scoped)
  const revenueByLabData = labs.map((l) => {
    const labInvs = periodInvoices.filter((i) => i.lab_id === l.id);
    const sum = labInvs.reduce((acc, i) => acc + i.final_amount, 0);
    return { name: (l?.name || 'Lab').replace(' Dental Clinic', '').replace(' Dental Center', ''), revenue: sum };
  }).filter((d) => d.revenue > 0);

  const MATERIAL_COLORS = [
    'var(--chart-1)',
    'var(--chart-2)',
    'var(--chart-3)',
    'var(--chart-4)',
    'var(--chart-5)',
  ];

  // Material revenue straight from the SQL analytics bundle (case teeth × invoices).
  const revenueByMaterialData = useMemo(
    () => analytics.restorationRevenue.filter((r) => r.revenue > 0 || r.cases > 0).map((r) => ({ name: r.material, value: r.revenue })),
    [analytics.restorationRevenue]
  );

  // Clinic bars read top-down, so the biggest biller has to be first. Six of
  // them keep every bar tall enough to compare; the rest were unreadable
  // slivers. The share in each tooltip is still taken against ALL clinics, so
  // "40% of clinic revenue" never overstates a capped ranking.
  const rankedClinics = [...revenueByLabData].sort((a, b) => b.revenue - a.revenue);
  const topClinics = rankedClinics.slice(0, 6);
  const clinicRevenueTotal = rankedClinics.reduce((sum, d) => sum + d.revenue, 0);

  const materialRevenueTotal = revenueByMaterialData.reduce((sum, d) => sum + d.value, 0);

  const materialLegend = revenueByMaterialData.map((d, i) => (
    <LegendItem
      key={d.name}
      color={MATERIAL_COLORS[i % MATERIAL_COLORS.length]}
      label={d.name}
      value={
        materialRevenueTotal > 0 ? `${Math.round((d.value / materialRevenueTotal) * 100)}%` : undefined
      }
    />
  ));

  const paymentLegend = paymentStatusPieData.map((d) => (
    <LegendItem key={d.name} color={d.color} label={d.name} value={String(d.value)} />
  ));

  const handleExportCSV = () => {
    const rows = [
      [`Analytics Report — ${period.label}`, '', '', ''],
      [`Generated`, getNowStamp(), '', ''],
      ['', '', '', ''],
      ['Lab Name', 'Invoices', 'Total Billed (PKR)', 'Total Collected (PKR)', 'Outstanding (PKR)', 'Avg Days to Pay', 'Advance Credit (PKR)'],
      ...analytics.paymentBehavior.map((r) => [
        r.labName, r.invoices, r.billed, r.collected, r.outstanding,
        r.avgDaysToPay ?? '—', r.advances,
      ]),
      ['', '', '', '', '', '', ''],
      ['Material', 'Cases', 'Revenue (PKR)', '', '', '', ''],
      ...analytics.restorationRevenue.map((r) => [r.material, r.cases, r.revenue, '', '', '', '']),
      ['', '', '', '', '', '', ''],
      ['Priority', 'Avg Days to Deliver', 'On-Time % (SLA)', 'Sample', '', '', ''],
      ...analytics.turnaround.map((r) => [
        prioritySlaLabel(r.priority), r.avgDays ?? '—', r.onTimePct ?? '—', r.sample, '', '', '',
      ]),
    ];

    // Quote fields so commas inside names can't break the CSV.
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      rows.map((r) => r.map((f) => `"${String(f)}"`).join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `dental_lab_analytics_${period.label.toLowerCase().replace(/\s+/g, '_')}_${t.today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      {/* Header — the page title lives on the Reports page header, so this row
          only carries the overview's own export action. */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <p className="text-xs text-slate-500 sm:max-w-2xl">
          Real-time financial performance, revenue breakdown by lab &amp; material, and quality delivery SLA metrics.
        </p>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs rounded-xl shadow-md flex items-center gap-2 transition-all"
          >
            <Download className="w-4 h-4" /> Export CSV Report
          </button>
        </div>
      </div>

      {/* Date Filter Bar — actually bounds every figure on this page. Same
          search-first order as the Archive tab: date picker first, preset pills next. */}
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center gap-3">
        <DatePickerRange
          from={startDate}
          to={endDate}
          className="shrink-0"
          quickRanges={[
            { label: 'This Month', from: t.monthStart, to: t.today },
            { label: 'Last 3 Months', from: t.threeMonthsAgo, to: t.today },
            { label: 'This Year', from: t.yearStart, to: t.today },
            { label: 'All Time', from: '', to: '' },
          ]}
          onChange={(f, to) => {
            setStartDate(f);
            setEndDate(to);
            setDateFilter(f || to ? 'custom' : 'all_time');
          }}
        />

        {/* Period preset pills */}
        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto scrollbar-thin">
          {[
            { id: 'this_month', label: 'This Month' },
            { id: 'last_3_months', label: 'Last 3 Months' },
            { id: 'this_year', label: 'This Year' },
            { id: 'all_time', label: 'All Time' },
            { id: 'custom', label: 'Custom' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setDateFilter(f.id as PeriodId)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                dateFilter === f.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200/80'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Top 4 KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Total Revenue</span>
            <DollarSign className="w-4 h-4 text-ink-success" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900">{formatPKR(totalRevenue)}</div>
          <div className="text-[11px] text-slate-500 font-medium">Across {periodInvoices.length} invoices</div>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Outstanding Unpaid</span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-extrabold text-ink-warning">{formatPKR(totalUnpaid)}</div>
          <div className="text-[11px] text-slate-500 font-medium">From {unpaidCount + partialCount} pending invoices</div>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Delivered Cases</span>
            <CheckCircle2 className="w-4 h-4 text-ink-info" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900">{deliveredCasesCount}</div>
          <div className="text-[11px] text-slate-500 font-medium">Delivered in the selected period</div>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>On-Time SLA Rate</span>
            <Award className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-extrabold text-purple-700">{onTimeDeliveryRate === null ? '—' : `${onTimeDeliveryRate}%`}</div>
          <div className="text-[11px] text-slate-500 font-medium">
            {analytics.overall.avgDays === null ? 'No delivery history in this period' : `${analytics.overall.avgDays} days average turnaround`}
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Monthly Revenue Trend */}
        <ChartPanel
          title="Monthly Revenue & Collection Trend (PKR)"
          hint="Billed gross revenue vs cash collected"
          legend={
            <>
              <LegendItem color="var(--chart-1)" label="Billed" />
              <LegendItem color="var(--chart-4)" label="Collected" />
            </>
          }
        >
          {monthlyRevenueData.length === 0 ? (
            <EmptyChart
              title="No invoices in this period"
              hint="Pick a wider reporting period to see the trend."
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyRevenueData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barGap={2}>
                <defs>
                  <linearGradient id="gradBilled" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.5} />
                  </linearGradient>
                  <linearGradient id="gradCollected" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0.45} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="month"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--chart-grid)' }}
                />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={axisPKR}
                />
                <Tooltip cursor={{ fill: 'var(--chart-grid)', fillOpacity: 0.6 }} content={<TrendTip />} />
                <Bar dataKey="revenue" fill="url(#gradBilled)" radius={[4, 4, 0, 0]} maxBarSize={34} />
                <Bar dataKey="collected" fill="url(#gradCollected)" radius={[4, 4, 0, 0]} maxBarSize={34} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        {/* Revenue by Dental Clinic */}
        <ChartPanel
          title="Revenue Breakdown by Dental Clinic"
          hint="Top billing clinics this period, largest first"
          legend={<LegendItem color="var(--chart-2)" label="Gross billing" />}
        >
          {topClinics.length === 0 ? (
            <EmptyChart title="No clinic billing in this period" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topClinics} layout="vertical" margin={{ top: 4, right: 36, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradClinic" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.95} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--chart-grid)" />
                <XAxis
                  type="number"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={axisPKR}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={94}
                  interval={0}
                />
                <Tooltip
                  cursor={{ fill: 'var(--chart-grid)', fillOpacity: 0.6 }}
                  content={<ClinicTip total={clinicRevenueTotal} />}
                />
                <Bar dataKey="revenue" fill="url(#gradClinic)" radius={[0, 4, 4, 0]} maxBarSize={22}>
                  <LabelList
                    dataKey="revenue"
                    position="right"
                    className="chart-bar-value"
                    formatter={(v: any) => axisPKR(Number(v))}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        {/* Material Type Distribution — SQL restoration revenue */}
        <ChartPanel
          title="Case Material Popularity & Revenue"
          hint="Share of revenue by restoration material"
          legend={materialLegend}
        >
          {revenueByMaterialData.length === 0 ? (
            <EmptyChart title="No charted case materials yet" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={revenueByMaterialData}
                  cx="50%"
                  cy="50%"
                  innerRadius={56}
                  outerRadius={80}
                  paddingAngle={3}
                  stroke="none"
                  dataKey="value"
                >
                  {revenueByMaterialData.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={MATERIAL_COLORS[index % MATERIAL_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  content={
                    <SliceTip
                      label="Revenue"
                      unit="of material revenue"
                      total={materialRevenueTotal}
                    />
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        {/* Payment Status Breakdown Pie */}
        <ChartPanel
          title="Invoice Payment Status Distribution"
          hint="Paid, partial and unpaid invoices"
          legend={paymentLegend}
        >
          {paymentStatusPieData.length === 0 ? (
            <EmptyChart title="No invoices in this period" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={paymentStatusPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={56}
                  outerRadius={80}
                  paddingAngle={3}
                  stroke="none"
                  dataKey="value"
                >
                  {paymentStatusPieData.map((entry, index) => (
                    <Cell key={`cell-pay-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={
                    <SliceTip
                      label="Invoices"
                      unit="of invoices in this period"
                      format="count"
                      total={periodInvoices.length}
                    />
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>
      </div>

      {/* Turnaround by Priority — computed from case status history in SQLite */}
      {/* Analytics Tables — side-by-side on wide screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900">Turnaround by Priority (delivered in period)</h3>
        <p className="text-xs text-slate-500 mt-0.5">Average days from case creation to delivery, and on-time rate against each priority's SLA.</p>
        <DataTable
          data={analytics.turnaround}
          rowKey={(r) => r.priority}
          rowClassName={() => 'border-t border-slate-100'}
          /* `analytics.turnaround` is one row per priority and never empty, so
             this line is not DataTable's `emptyState` (that only replaces the
             table when `data` is empty). `tfoot` is the one slot that keeps it
             a row OF this table; before it existed there was nowhere to put it.
             It used to sit above the rows as a `<tbody>` row — it now sits
             below them. */
          tfoot={
            analytics.turnaround.every((r) => r.sample === 0) ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink-muted">
                  No deliveries in this period yet.
                </td>
              </tr>
            ) : undefined
          }
          columns={[
            {
              header: 'Priority',
              className: 'px-4 py-2.5 font-bold text-slate-800',
              render: (r) => prioritySlaLabel(r.priority),
            },
            {
              header: 'Avg Days to Deliver',
              align: 'right',
              className: 'px-4 py-2.5 font-semibold text-slate-900',
              render: (r) => (r.avgDays === null ? '—' : `${r.avgDays} days`),
            },
            {
              header: 'On-Time (SLA)',
              align: 'right',
              /* The colour is decided per row, so it cannot live on the column
                 and has to ride on the cell's own content. */
              className: 'px-4 py-2.5 font-semibold',
              render: (r) => (
                <span
                  className={`font-semibold ${r.onTimePct === null ? 'text-ink-muted' : r.onTimePct >= 90 ? 'text-ink-success' : r.onTimePct >= 70 ? 'text-ink-warning' : 'text-ink-danger'}`}
                >
                  {r.onTimePct === null ? '—' : `${r.onTimePct}%`}
                </span>
              ),
            },
            {
              header: 'Sample Size',
              align: 'right',
              className: 'px-4 py-2.5 text-slate-500',
              /* `font-normal` is not decoration: DataTable's `<tbody>` is
                 `font-medium` and this is the one cell in the table that never
                 set a weight of its own. It rides on the content because the
                 column class would also strip the bold off the `<th>`. */
              render: (r) => <span className="font-normal">{r.sample}</span>,
            },
          ]}
        />
        </div>

        {/* Payment Behavior per Clinic — computed from invoices + payments in SQLite */}
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900">Payment Behavior by Dental Clinic</h3>
        <p className="text-xs text-slate-500 mt-0.5">Billed vs collected (by invoice date), outstanding balance, average days-to-pay, and advance credit held.</p>
        <DataTable
          data={analytics.paymentBehavior}
          rowKey={(r) => r.labId}
          emptyState={
            <div className="px-4 py-6 text-center text-ink-muted">
              No invoices in this period — behavior appears as billing begins.
            </div>
          }
          columns={[
            {
              header: 'Dental Clinic',
              className: 'px-4 py-2.5 font-bold text-slate-800',
              render: (r) => r.labName,
            },
            {
              header: 'Invoices',
              align: 'right',
              className: 'px-4 py-2.5 text-slate-600',
              render: (r) => r.invoices,
            },
            {
              header: 'Billed (PKR)',
              align: 'right',
              className: 'px-4 py-2.5 font-semibold text-slate-900',
              render: (r) => r.billed.toLocaleString(),
            },
            {
              header: 'Collected (PKR)',
              align: 'right',
              className: 'px-4 py-2.5 font-semibold text-ink-success',
              render: (r) => r.collected.toLocaleString(),
            },
            {
              header: 'Outstanding (PKR)',
              align: 'right',
              /* The tone depends on the row, so it cannot live in `className`
                 (which is applied to the <th> too, where it would bold the
                 header). It rides on a span instead. */
              render: (r) => (
                <span
                  className={`font-semibold ${r.outstanding > 0 ? 'text-ink-warning' : 'text-ink-muted'}`}
                >
                  {r.outstanding.toLocaleString()}
                </span>
              ),
            },
            {
              header: 'Avg Days to Pay',
              align: 'right',
              className: 'px-4 py-2.5 text-slate-600',
              render: (r) => (r.avgDaysToPay === null ? '—' : `${r.avgDaysToPay} days`),
            },
            {
              header: 'Advance Credit',
              align: 'right',
              className: 'px-4 py-2.5 text-indigo-600 font-semibold',
              render: (r) => r.advances.toLocaleString(),
            },
          ]}
        />
        </div>
      </div>
    </div>
  );
};
