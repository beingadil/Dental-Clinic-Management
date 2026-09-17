import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
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
  TrendingUp, 
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

  const deliveredCasesCount = cases.filter((c) => c.status === 'delivered').length;
  const overdueCasesCount = cases.filter(
    (c) => c.delivery_date < '2026-08-02' && c.status !== 'delivered' && c.status !== 'cancelled'
  ).length;

  const onTimeDeliveryRate = cases.length > 0
    ? Math.round(((cases.length - overdueCasesCount) / cases.length) * 100)
    : 100;

  // Monthly Revenue Data
  const monthlyRevenueData = [
    { month: 'Jan', revenue: 145000, collected: 145000 },
    { month: 'Feb', revenue: 180000, collected: 175000 },
    { month: 'Mar', revenue: 210000, collected: 195000 },
    { month: 'Apr', revenue: 195000, collected: 190000 },
    { month: 'May', revenue: 260000, collected: 240000 },
    { month: 'Jun', revenue: 230000, collected: 220000 },
    { month: 'Jul', revenue: 290000, collected: 270000 },
    { month: 'Aug', revenue: 310000, collected: 280000 },
  ];

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
          <div className="text-[11px] text-emerald-600 font-bold flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" /> +14.2% vs last period
          </div>
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
          <div className="text-2xl font-extrabold text-purple-700">{onTimeDeliveryRate}%</div>
          <div className="text-[11px] text-purple-600 font-bold">Average 3.2 days turnaround</div>
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
    </div>
  );
};
