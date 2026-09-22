import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { computeAnalytics } from '../../services/analyticsService';
import { prioritySlaLabel } from '../../services/prioritySla';
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
  Legend 
} from 'recharts';
import { 
  BarChart3, 
  DollarSign, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  Calendar, 
  Download, 
  Award 
} from 'lucide-react';

export const AnalyticsView: React.FC = () => {
  const { cases, invoices, labs, caseTypes } = useApp();

  const [dateFilter, setDateFilter] = useState<'this_month' | 'last_3_months' | 'this_year' | 'custom'>('this_month');
  const [startDate, setStartDate] = useState('2026-01-01');
  const [endDate, setEndDate] = useState('2026-12-31');

  // Computed Summary Metrics
  const totalRevenue = invoices.reduce((sum, i) => sum + i.final_amount, 0);
  const totalCollected = invoices.reduce((sum, i) => sum + i.amount_paid, 0);
  const totalUnpaid = totalRevenue - totalCollected;

  // DB-computed analytics — real figures from SQLite (recomputed when data changes)
  const analytics = useMemo(() => computeAnalytics(), [cases, invoices]);

  const deliveredCasesCount = analytics.overall.delivered;
  const onTimeDeliveryRate = analytics.overall.onTimePct;

  // Monthly Revenue & Collection — real, grouped from invoice dates
  const monthlyRevenueData = useMemo(() => {
    const byMonth = new Map<string, { month: string; revenue: number; collected: number }>();
    for (const i of invoices) {
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
  }, [invoices]);

  // Payment Status Distribution Pie Data
  const unpaidCount = invoices.filter((i) => i.payment_status === 'unpaid').length;
  const partialCount = invoices.filter((i) => i.payment_status === 'partial').length;
  const paidCount = invoices.filter((i) => i.payment_status === 'paid').length;

  const paymentStatusPieData = [
    { name: 'Paid', value: paidCount, color: '#10b981' },
    { name: 'Partial', value: partialCount, color: '#3b82f6' },
    { name: 'Unpaid', value: unpaidCount, color: '#f59e0b' },
  ];

  // Revenue By Lab Breakdown
  const revenueByLabData = labs.map((l) => {
    const labInvs = invoices.filter((i) => i.lab_id === l.id);
    const sum = labInvs.reduce((acc, i) => acc + i.final_amount, 0);
    return { name: (l?.name || 'Lab').replace(' Dental Clinic', '').replace(' Dental Center', ''), revenue: sum };
  });

  // Revenue By Case Material Type Breakdown
  const revenueByMaterialData = caseTypes.map((ct) => {
    const ctInvs = invoices.filter((i) => i.case_type_id === ct.id);
    const sum = ctInvs.reduce((acc, i) => acc + i.final_amount, 0);
    return { name: ct.name, value: sum };
  });

  const MATERIAL_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b'];

  const handleExportCSV = () => {
    const rows = [
      ['Lab Name', 'Total Billed (PKR)', 'Total Collected (PKR)', 'Unpaid Balance (PKR)'],
      ...labs.map((l) => {
        const labInvs = invoices.filter((i) => i.lab_id === l.id);
        const billed = labInvs.reduce((s, i) => s + i.final_amount, 0);
        const collected = labInvs.reduce((s, i) => s + i.amount_paid, 0);
        return [l.name, billed, collected, billed - collected];
      })
    ];

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `dental_lab_analytics_${dateFilter}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Analytics & Business Intelligence</h1>
          <p className="text-xs text-slate-500 mt-1">
            Real-time financial performance, revenue breakdown by lab & material, and quality delivery SLA metrics.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs rounded-xl shadow-md flex items-center gap-2 transition-all"
          >
            <Download className="w-4 h-4" /> Export CSV Report
          </button>
        </div>
      </div>

      {/* Date Filter Bar */}
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-bold text-slate-700">Reporting Period:</span>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
          {[
            { id: 'this_month', label: 'This Month' },
            { id: 'last_3_months', label: 'Last 3 Months' },
            { id: 'this_year', label: 'This Year' },
            { id: 'custom', label: 'Custom Date Range' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setDateFilter(f.id as any)}
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

        {dateFilter === 'custom' && (
          <div className="flex items-center gap-2 text-xs">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg"
            />
            <span>to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg"
            />
          </div>
        )}
      </div>

      {/* Top 4 KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Total Revenue</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900">PKR {(totalRevenue || 0).toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 font-medium">Across {invoices.length} invoices</div>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Outstanding Unpaid</span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-extrabold text-amber-600">PKR {(totalUnpaid || 0).toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 font-medium">From {unpaidCount + partialCount} pending invoices</div>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Delivered Cases</span>
            <CheckCircle2 className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900">{deliveredCasesCount}</div>
          <div className="text-[11px] text-slate-500 font-medium">Completed QC inspections</div>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>On-Time SLA Rate</span>
            <Award className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-extrabold text-purple-700">{onTimeDeliveryRate === null ? '—' : `${onTimeDeliveryRate}%`}</div>
          <div className="text-[11px] text-slate-500 font-medium">
            {analytics.overall.avgDays === null ? 'No delivery history yet' : `${analytics.overall.avgDays} days average turnaround`}
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Revenue Trend */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Monthly Revenue & Collection Trend (PKR)</h3>
            <p className="text-xs text-slate-500">Billed gross revenue vs cash collected</p>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyRevenueData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: any) => [`PKR ${Number(value).toLocaleString()}`, 'Amount']} />
                <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Gross Revenue" />
                <Bar dataKey="collected" fill="#10b981" radius={[4, 4, 0, 0]} name="Cash Collected" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Revenue by Dental Clinic */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Revenue Breakdown by Dental Clinic</h3>
            <p className="text-xs text-slate-500">Gross billing performance across client dental clinics</p>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueByLabData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                <Tooltip formatter={(value: any) => [`PKR ${Number(value).toLocaleString()}`, 'Revenue']} />
                <Bar dataKey="revenue" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Material Type Distribution */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Case Material Popularity & Revenue</h3>
            <p className="text-xs text-slate-500">Proportion of revenue generated by material type</p>
          </div>
          <div className="h-64 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={revenueByMaterialData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={85}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {revenueByMaterialData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={MATERIAL_COLORS[index % MATERIAL_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: any) => [`PKR ${Number(value).toLocaleString()}`, 'Revenue']} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Payment Status Breakdown Pie */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Invoice Payment Status Distribution</h3>
            <p className="text-xs text-slate-500">Proportion of paid, partial, and unpaid invoices</p>
          </div>
          <div className="h-64 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={paymentStatusPieData}
                  cx="50%"
                  cy="50%"
                  outerRadius={85}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {paymentStatusPieData.map((entry, index) => (
                    <Cell key={`cell-pay-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(val: any) => [`${val} Invoices`, 'Count']} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Turnaround by Priority — computed from case status history in SQLite */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900">Turnaround by Priority (delivered cases)</h3>
        <p className="text-xs text-slate-500 mt-0.5">Average days from case creation to delivery, and on-time rate against each priority's SLA.</p>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2">Priority</th>
                <th className="px-4 py-2 text-right">Avg Days to Deliver</th>
                <th className="px-4 py-2 text-right">On-Time (SLA)</th>
                <th className="px-4 py-2 text-right">Sample Size</th>
              </tr>
            </thead>
            <tbody>
              {analytics.turnaround.map((r) => (
                <tr key={r.priority} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-bold text-slate-800">{prioritySlaLabel(r.priority)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{r.avgDays === null ? '—' : `${r.avgDays} days`}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${r.onTimePct === null ? 'text-slate-400' : r.onTimePct >= 90 ? 'text-emerald-600' : r.onTimePct >= 70 ? 'text-amber-600' : 'text-rose-600'}`}>
                    {r.onTimePct === null ? '—' : `${r.onTimePct}%`}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{r.sample}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Behavior per Clinic — computed from invoices + payments in SQLite */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900">Payment Behavior by Dental Clinic</h3>
        <p className="text-xs text-slate-500 mt-0.5">Billed vs collected, outstanding balance, average days-to-pay, and advance credit held.</p>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2">Dental Clinic</th>
                <th className="px-4 py-2 text-right">Invoices</th>
                <th className="px-4 py-2 text-right">Billed (PKR)</th>
                <th className="px-4 py-2 text-right">Collected (PKR)</th>
                <th className="px-4 py-2 text-right">Outstanding (PKR)</th>
                <th className="px-4 py-2 text-right">Avg Days to Pay</th>
                <th className="px-4 py-2 text-right">Advance Credit</th>
              </tr>
            </thead>
            <tbody>
              {analytics.paymentBehavior.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No invoices yet — behavior appears as billing begins.</td></tr>
              )}
              {analytics.paymentBehavior.map((r) => (
                <tr key={r.labId} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-bold text-slate-800">{r.labName}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{r.invoices}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{r.billed.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-emerald-600">{r.collected.toLocaleString()}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${r.outstanding > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{r.outstanding.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{r.avgDaysToPay === null ? '—' : `${r.avgDaysToPay} days`}</td>
                  <td className="px-4 py-2.5 text-right text-indigo-600 font-semibold">{r.advances.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
