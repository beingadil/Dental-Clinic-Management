import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  FolderKanban, 
  DollarSign, 
  Clock, 
  AlertTriangle, 
  CheckCircle2,Plus,
  X,
  ChevronRight,
  Building2,
  Receipt,
  Sparkles,
  Cpu
} from 'lucide-react';
import { DentalCase, DentalLab, CaseStatus } from '../../types';
import { computeAnalytics } from '../../services/analyticsService';
import { getDaysOffsetStr } from '../../utils/dateUtils';
import { CaseDetailModal } from '../cases/CaseDetailModal';
import { ShadeGuideModal } from './ShadeGuideModal';
import { InteractiveDeliveryCalendar } from './InteractiveDeliveryCalendar';
import { ClinicNotesModal } from './ClinicNotesModal';
import { UpdateStatusPill } from '../common/UpdateStatusPill';

interface DashboardViewProps {
  onOpenNewCaseModal: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onOpenNewCaseModal }) => {
  const { 
    cases, 
    invoices, 
    labs,
    user,
    todayStr,
    setCurrentView, 
    updateCase,
    overdueCount, 
    dueTodayCount, 
    dueThisWeekCount
  } = useApp();

  // Banner State
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const dashboardAnalytics = useMemo(() => computeAnalytics(), [cases, invoices]);
  const [selectedCaseModal, setSelectedCaseModal] = useState<DentalCase | null>(null);
  /** Shade picked in the dashboard shade guide → pre-fills the new-case wizard. */
  const [pendingShade, setPendingShade] = useState<string | null>(null);
  const [isNewCaseOpen, setIsNewCaseOpen] = useState(false);

  /* Today's delivery workload — counted from real case rows only. */
  const totalCasesToday = cases.filter((c) => c.delivery_date === todayStr).length;

  // Modal states
  const [showShadeGuide, setShowShadeGuide] = useState(false);
  const [showClinicNotes, setShowClinicNotes] = useState(false);

  // Financial metrics
  const totalRevenue = invoices.reduce((sum, inv) => sum + (inv.amount_paid || 0), 0);
  const totalBilled = invoices.reduce((sum, inv) => sum + (inv.final_amount || 0), 0);
  const totalOutstanding = totalBilled - totalRevenue;

  /* Quality KPIs derived from the append-only QC stream (em dash while there is
     genuinely no inspection data — never a fabricated number). */
  const activeCases = cases.filter(c => c.status !== 'delivered' && c.status !== 'cancelled');

  /* Material share from the SQL analytics bundle (charted case materials ×
     revenue) — one source of truth, shared with Analytics. Percentages are
     share of BILLED REVENUE, not guessed substrings of case names. */
  const materialStats = useMemo(() => {
    const rows = dashboardAnalytics.restorationRevenue.filter((r) => r.revenue > 0);
    const totalRev = rows.reduce((s, r) => s + r.revenue, 0);
    const pick = (match: (m: string) => boolean) => {
      const hit = rows.filter((r) => match(r.material.toLowerCase()));
      const rev = hit.reduce((s, r) => s + r.revenue, 0);
      return totalRev > 0 ? Math.round((rev / totalRev) * 100) : 0;
    };
    const zirconia = pick((m) => m.includes('zirconia'));
    const emax = pick((m) => m.includes('e.max') || m.includes('e-max') || m.includes('lithium') || m.includes('veneer') || m.includes('empress'));
    const implants = pick((m) => m.includes('implant') || m.includes('titanium') || m.includes('abutment'));
    const aligners = pick((m) => m.includes('aligner') || m.includes('ortho'));
    const other = Math.max(0, 100 - zirconia - emax - implants - aligners);
    return { total: rows.length, revenue: totalRev, zirconia, emax, implants, aligners, other };
  }, [dashboardAnalytics.restorationRevenue]);

  /* Production pipeline — where the bench's work is actually sitting, counted
     from live case rows. The delivery calendar answers "when does it ship";
     this answers "what is stuck where", which the calendar cannot show. */
  const pipeline = useMemo(() => {
    const stages: { key: CaseStatus; label: string; dot: string; count: number }[] = [
      { key: 'received', label: 'Received', dot: 'bg-sky-500', count: 0 },
      { key: 'in_progress', label: 'In Production', dot: 'bg-cyan-500', count: 0 },
      { key: 'qc', label: 'Quality Check', dot: 'bg-violet-500', count: 0 },
      { key: 'ready', label: 'Ready to Dispatch', dot: 'bg-emerald-500', count: 0 },
      { key: 'delivered', label: 'Delivered (7d)', dot: 'bg-slate-400', count: 0 },
    ];
    const weekAgo = getDaysOffsetStr(-7);
    for (const c of cases) {
      const stage = stages.find((s) => s.key === c.status);
      if (stage) {
        if (c.status === 'delivered' && (c.delivery_date || '') < weekAgo) continue;
        stage.count++;
      }
    }
    const peak = Math.max(1, ...stages.map((s) => s.count));
    return { stages, peak, revisions: cases.filter((c) => c.status === 'revision').length };
  }, [cases]);

  /* Only cases that actually carry a note. The card used to re-filter the entire
     case list three times per render (map, empty check, again for the count)
     and then hold a full card slot open to say "nothing here". */
  const notedCases = useMemo(
    () => cases.filter((c) => (c.instructions || '').trim()),
    [cases]
  );

  const currentFormattedDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  return (
    <div className="space-y-6 pb-12">

      {/* Auto-update status pill (checks on mount, silent when up to date) */}
      <UpdateStatusPill />

      {/* BEGIN: Hero Operations Banner — light editorial header, not a boxed
          banner: hairline dividers, asymmetric whitespace, real data inline. */}
      <section
        className="border-b border-slate-200/80 pb-6"
        data-purpose="hero-operations-banner"
      >
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <span className="relative flex w-1.5 h-1.5" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                <span>Operations live</span>
              </span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="text-[11px] text-slate-400 font-medium">{currentFormattedDate}</span>
            </div>

            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Welcome back, {user?.name || 'there'}
            </h1>

            <p className="text-xs text-slate-500 mt-1">
              <span className="font-semibold text-slate-700 tabular-nums">{overdueCount}</span>
              {' '}{overdueCount === 1 ? 'case needs' : 'cases need'} attention
              <span className="text-slate-300 mx-1.5" aria-hidden="true">·</span>
              <span className="font-semibold text-slate-700 tabular-nums">{dueTodayCount}</span>
              {' '}due for delivery today
            </p>
          </div>

          {/* Quick Workstation Action */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={() => setCurrentView('cases')}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white font-semibold text-xs transition-all duration-200 flex items-center gap-2 cursor-pointer"
            >
              <FolderKanban className="w-4 h-4 text-slate-300" />
              <span>Case Workstation</span>
            </button>
          </div>
        </div>
      </section>
      {/* END: Hero Operations Banner */}

      {/* BEGIN: Urgent Overdue Warning Banner */}
      {!bannerDismissed && (overdueCount > 0 || cases.some(c => c.status === 'revision')) && (
        <div className="bg-rose-50 border border-rose-200/80 rounded-2xl p-4 text-rose-900 flex items-start justify-between gap-4 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-rose-100 rounded-xl text-rose-700 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-bold text-rose-800">
                  {overdueCount} {overdueCount === 1 ? 'case is' : 'cases are'} past the promised delivery date
                </h4>
              </div>
              <p className="text-xs text-rose-700 mt-1">
                These cases have passed their promised delivery date and are still in production — review and update their status or delivery schedule.
              </p>
              <div className="flex items-center gap-3 mt-2.5">
                <button 
                  onClick={() => setCurrentView('cases')}
                  className="text-xs font-bold text-rose-800 hover:text-rose-950 underline flex items-center gap-1.5 cursor-pointer"
                >
                  <FolderKanban className="w-3.5 h-3.5" />
                  <span>Review Overdue Cases in Workstation</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
          <button 
            onClick={() => setBannerDismissed(true)}
            className="p-1 rounded-lg text-rose-500 hover:bg-rose-100 transition cursor-pointer"
            title="Dismiss alert"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* END: Urgent Overdue Warning Banner */}

      {/* BEGIN: KPI strip — 3 cards.
          Was 5, and two of them rendered the SAME number: "Pending Cases Today"
          and "Deliveries Today" both read `dueTodayCount`, so the row showed
          3 / 3 / 0 / 3 with no way to tell the first and last apart. Merged
          into Today's Work, Money and Attention, each with a unique headline
          figure. Footers use min-w-0 + truncate + whitespace-nowrap so the
          "Open Workstation →" links stop breaking across three lines. */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4" data-purpose="kpi-metric-cards">

        {/* 1 — TODAY'S WORK: the day's workload, split open vs delivered. */}
        <div
          onClick={() => setCurrentView('cases')}
          className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs hover:shadow-md hover:border-blue-400 transition-all duration-200 cursor-pointer flex flex-col justify-between group"
        >
          <div className="flex items-center justify-between mb-2 gap-2">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">Today's Work</span>
            <div className="w-8 h-8 shrink-0 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-105 transition-transform">
              <FolderKanban className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-slate-900 tabular-nums">{totalCasesToday}</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 whitespace-nowrap">
                {totalCasesToday - dueTodayCount} delivered
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1 font-medium">
              {dueTodayCount} still open · {activeCases.length} on the bench
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[10px] text-slate-500">
            <span className="truncate">{cases.length} on record</span>
            <span className="text-blue-600 font-bold whitespace-nowrap group-hover:underline">Workstation →</span>
          </div>
        </div>

        {/* 2 — MONEY: receivables, with collected total as the secondary. */}
        <div
          onClick={() => setCurrentView('billing')}
          className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs hover:shadow-md hover:border-emerald-400 transition-all duration-200 cursor-pointer flex flex-col justify-between group"
        >
          <div className="flex items-center justify-between mb-2 gap-2">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">Receivables</span>
            <div className="w-8 h-8 shrink-0 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-105 transition-transform">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div>
            {/* tabular-nums so the currency stays aligned as the figure grows. */}
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-900 tabular-nums whitespace-nowrap">
                {totalOutstanding.toLocaleString()}
              </span>
              <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">PKR</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1 font-medium">
              {(() => {
                const unpaid = invoices.filter(i => i.payment_status !== 'paid' && i.due_date);
                if (unpaid.length === 0) return 'Nothing outstanding';
                const avgDays = Math.round(
                  unpaid.reduce((s, i) => s + Math.max(0, Math.round((Date.now() - new Date(i.due_date!).getTime()) / 86400000)), 0) / unpaid.length
                );
                return `Across ${labs.length} clinics · avg ${avgDays}d overdue`;
              })()}
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[10px] text-slate-500">
            <span className="truncate">Collected</span>
            <span className="font-bold text-slate-700 whitespace-nowrap tabular-nums">PKR {totalRevenue.toLocaleString()}</span>
          </div>
        </div>

        {/* 3 — ATTENTION: red ONLY when something is actually wrong. An
            always-red card at zero trains staff to ignore red, which is the
            opposite of what an alert is for. */}
        <div
          onClick={() => setCurrentView('cases')}
          className={`bg-white rounded-2xl p-4 shadow-xs hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between group ${
            overdueCount > 0
              ? 'border-rose-300 bg-rose-50/30 hover:border-rose-500'
              : 'border-slate-200/80 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between mb-2 gap-2">
            <span className={`text-[11px] font-bold uppercase tracking-wider truncate ${overdueCount > 0 ? 'text-rose-700' : 'text-slate-500'}`}>
              Needs Attention
            </span>
            <div className={`w-8 h-8 shrink-0 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform ${overdueCount > 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-extrabold tabular-nums ${overdueCount > 0 ? 'text-rose-600' : 'text-slate-300'}`}>
                {overdueCount}
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${overdueCount > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                {overdueCount > 0 ? 'Urgent' : 'All clear'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1 font-medium">Past SLA or remake cases</p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[10px] text-slate-500">
            <span className="truncate">{dueThisWeekCount} due in 7 days</span>
            <span className={`font-bold whitespace-nowrap ${overdueCount > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
              {overdueCount > 0 ? 'Review →' : 'Schedule →'}
            </span>
          </div>
        </div>
      </section>
      {/* END: KPI strip */}

      {/* BEGIN: Main Operations Grid (12 Cols) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6" data-purpose="mid-dashboard-details">
        
        {/* LEFT COLUMN (4 Cols): Production Pipeline & Quick Modules */}
        <div className="lg:col-span-4 space-y-6">

          {/* Production Pipeline — replaced "Today's Chairside Clinical Cases".
              Chairside scheduling was a duplicate of the Cases view and had no
              data of its own beyond the case rows the calendar already lists.
              This stage funnel is the operational question the dashboard was
              failing to answer: which queue is backing up. */}
          <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between mb-1 gap-2">
              <h3 className="text-sm font-bold text-slate-900 truncate">Production Pipeline</h3>
              <button
                onClick={() => setCurrentView('cases')}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-700 cursor-pointer whitespace-nowrap shrink-0"
              >
                Workstation →
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              Live case counts by bench stage
            </p>

            <div className="space-y-2">
              {pipeline.stages.map((stage) => (
                <button
                  key={stage.key}
                  onClick={() => setCurrentView('cases')}
                  className="w-full flex items-center gap-3 group cursor-pointer text-left"
                  title={`${stage.count} ${stage.label} — open in Case Workstation`}
                >
                  <span className="w-[108px] shrink-0 text-[11px] font-medium text-slate-600 truncate group-hover:text-slate-900 transition-colors">
                    {stage.label}
                  </span>
                  {/* Bar width is a share of the busiest stage, so the shape of
                      the backlog reads even when the counts are small. */}
                  <span className="flex-1 min-w-0 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <span
                      className={`block h-full rounded-full ${stage.dot} transition-all duration-500`}
                      style={{ width: `${Math.round((stage.count / pipeline.peak) * 100)}%` }}
                    />
                  </span>
                  <span className="w-7 shrink-0 text-right text-xs font-bold text-slate-800 tabular-nums">
                    {stage.count}
                  </span>
                </button>
              ))}
            </div>

            {pipeline.revisions > 0 && (
              <button
                onClick={() => setCurrentView('cases')}
                className="mt-4 w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-rose-50 border border-rose-100 hover:bg-rose-100/70 transition cursor-pointer"
              >
                <span className="text-[11px] font-bold text-rose-700 truncate">Revisions open</span>
                <span className="text-[11px] font-extrabold text-rose-700 tabular-nums shrink-0">
                  {pipeline.revisions}
                </span>
              </button>
            )}
          </div>

          {/* Quick Action Links Grid (6 Bento Modules) */}
          <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-3">Dental Lab Quick Modules</h3>
            <div className="grid grid-cols-3 gap-2.5">
              
              {/* Module 1: New Case (same single entry as the header button) */}
              <button 
                onClick={onOpenNewCaseModal}
                className="p-3 rounded-2xl bg-blue-50/60 hover:bg-blue-100/60 border border-blue-100 flex flex-col items-center justify-center text-center transition group cursor-pointer"
              >
                <div className="w-8 h-8 rounded-xl bg-white text-blue-600 shadow-xs flex items-center justify-center mb-1.5 group-hover:scale-110 transition-transform">
                  <Plus className="w-4 h-4" />
                </div>
                <span className="text-[11px] font-bold text-slate-700 leading-tight">New Case</span>
              </button>

              {/* Module 2: Shade Guide */}
              <button 
                onClick={() => setShowShadeGuide(true)}
                className="p-3 rounded-2xl bg-purple-50/60 hover:bg-purple-100/60 border border-purple-100 flex flex-col items-center justify-center text-center transition group cursor-pointer"
              >
                <div className="w-8 h-8 rounded-xl bg-white text-purple-600 shadow-xs flex items-center justify-center mb-1.5 group-hover:scale-110 transition-transform">
                  <Sparkles className="w-4 h-4" />
                </div>
                <span className="text-[11px] font-bold text-slate-700 leading-tight">Shade Guide</span>
              </button>

              {/* Module 3: Milling Queue */}
              <button 
                onClick={() => setCurrentView('cases')}
                className="p-3 rounded-2xl bg-cyan-50/60 hover:bg-cyan-100/60 border border-cyan-100 flex flex-col items-center justify-center text-center transition group cursor-pointer"
              >
                <div className="w-8 h-8 rounded-xl bg-white text-cyan-600 shadow-xs flex items-center justify-center mb-1.5 group-hover:scale-110 transition-transform">
                  <Cpu className="w-4 h-4" />
                </div>
                <span className="text-[11px] font-bold text-slate-700 leading-tight">Milling Queue</span>
              </button>

              {/* Module 4: Lab Invoices */}
              <button 
                onClick={() => setCurrentView('billing')}
                className="p-3 rounded-2xl bg-emerald-50/60 hover:bg-emerald-100/60 border border-emerald-100 flex flex-col items-center justify-center text-center transition group cursor-pointer"
              >
                <div className="w-8 h-8 rounded-xl bg-white text-emerald-600 shadow-xs flex items-center justify-center mb-1.5 group-hover:scale-110 transition-transform">
                  <Receipt className="w-4 h-4" />
                </div>
                <span className="text-[11px] font-bold text-slate-700 leading-tight">Lab Invoices</span>
              </button>

              {/* Module 5: Clinic Roster */}
              <button 
                onClick={() => setCurrentView('labs')}
                className="p-3 rounded-2xl bg-amber-50/60 hover:bg-amber-100/60 border border-amber-100 flex flex-col items-center justify-center text-center transition group cursor-pointer"
              >
                <div className="w-8 h-8 rounded-xl bg-white text-amber-600 shadow-xs flex items-center justify-center mb-1.5 group-hover:scale-110 transition-transform">
                  <Building2 className="w-4 h-4" />
                </div>
                <span className="text-[11px] font-bold text-slate-700 leading-tight">Clinic Roster</span>
              </button>

              {/* Module 6: Revisions */}
              <button 
                onClick={() => setCurrentView('cases')}
                className="p-3 rounded-2xl bg-rose-50/60 hover:bg-rose-100/60 border border-rose-100 flex flex-col items-center justify-center text-center transition group cursor-pointer"
              >
                <div className="w-8 h-8 rounded-xl bg-white text-rose-600 shadow-xs flex items-center justify-center mb-1.5 group-hover:scale-110 transition-transform">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <span className="text-[11px] font-bold text-slate-700 leading-tight">Revisions</span>
              </button>

            </div>
          </div>
        </div>

        {/* MIDDLE COLUMN (4 Cols): Material Share Donut, Turnaround Metrics, Case Notes */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Prosthetics Material Distribution Chart */}
          <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900 truncate">Material Revenue Share</h3>
                <p className="text-[11px] text-slate-400 truncate">Share of billed revenue by material</p>
              </div>
              {/* The ring is a share of REVENUE, so the badge must state the same
                  denominator. It used to read "{cases.length} Units Total", which
                  counted every case ever created and did not match the slices. */}
              <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full whitespace-nowrap shrink-0 tabular-nums">
                {materialStats.revenue > 0 ? `PKR ${Math.round(materialStats.revenue).toLocaleString()}` : 'No billed cases'}
              </span>
            </div>

            {/* Donut Chart Visual — ring is generated from the real revenue shares */}
            <div className="flex items-center justify-center my-4">
              <div
                className="relative w-36 h-36 rounded-full flex items-center justify-center shadow-inner"
                style={{
                  background:
                    materialStats.total === 0
                      ? 'conic-gradient(#e2e8f0 0% 100%)'
                      : `conic-gradient(
                          #2563eb 0% ${materialStats.zirconia}%,
                          #0284c7 ${materialStats.zirconia}% ${materialStats.zirconia + materialStats.emax}%,
                          #10b981 ${materialStats.zirconia + materialStats.emax}% ${materialStats.zirconia + materialStats.emax + materialStats.implants}%,
                          #f59e0b ${materialStats.zirconia + materialStats.emax + materialStats.implants}% ${materialStats.zirconia + materialStats.emax + materialStats.implants + materialStats.aligners}%,
                          #94a3b8 ${materialStats.zirconia + materialStats.emax + materialStats.implants + materialStats.aligners}% 100%
                        )`,
                }}
              >
                <div className="w-24 h-24 rounded-full bg-white flex flex-col items-center justify-center shadow-xs">
                  <span className="text-xl font-extrabold text-slate-800">
                    {materialStats.total === 0 ? '—' : `${materialStats.zirconia}%`}
                  </span>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Zirconia</span>
                </div>
              </div>
            </div>

            {/* Interactive Legend */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs">
              <button 
                onClick={() => setCurrentView('cases')}
                className={`flex items-center gap-2 p-1.5 rounded-lg transition cursor-pointer text-left ${materialStats.zirconia > 0 ? 'hover:bg-slate-50' : 'opacity-40'}`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-[#2563eb] shrink-0" />
                <span className="text-slate-600 font-medium truncate">Zirconia ({materialStats.zirconia}%)</span>
              </button>
              <button 
                onClick={() => setCurrentView('cases')}
                className={`flex items-center gap-2 p-1.5 rounded-lg transition cursor-pointer text-left ${materialStats.emax > 0 ? 'hover:bg-slate-50' : 'opacity-40'}`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-[#0284c7] shrink-0" />
                <span className="text-slate-600 font-medium truncate">E-max ({materialStats.emax}%)</span>
              </button>
              <button 
                onClick={() => setCurrentView('cases')}
                className={`flex items-center gap-2 p-1.5 rounded-lg transition cursor-pointer text-left ${materialStats.implants > 0 ? 'hover:bg-slate-50' : 'opacity-40'}`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-[#10b981] shrink-0" />
                <span className="text-slate-600 font-medium truncate">Implants ({materialStats.implants}%)</span>
              </button>
              <button 
                onClick={() => setCurrentView('cases')}
                className={`flex items-center gap-2 p-1.5 rounded-lg transition cursor-pointer text-left ${materialStats.aligners > 0 ? 'hover:bg-slate-50' : 'opacity-40'}`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b] shrink-0" />
                <span className="text-slate-600 font-medium truncate">Aligners ({materialStats.aligners}%)</span>
              </button>
              {materialStats.other > 0 && (
                <button 
                  onClick={() => setCurrentView('cases')}
                  className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-50 transition cursor-pointer text-left"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-[#94a3b8] shrink-0" />
                  <span className="text-slate-600 font-medium truncate">Other ({materialStats.other}%)</span>
                </button>
              )}
            </div>

            {/* Benchmark stats */}
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs gap-2">
              <div className="text-center min-w-0">
                <span className="text-[10px] text-slate-400 uppercase block whitespace-nowrap">Avg Turnaround</span>
                <span className="font-bold text-slate-800 whitespace-nowrap tabular-nums">
                  {dashboardAnalytics.overall.avgDays === null ? '—' : `${dashboardAnalytics.overall.avgDays} Days`}
                </span>
              </div>
              <div className="h-6 w-px bg-slate-200 shrink-0" />
              <div className="text-center min-w-0">
                <span className="text-[10px] text-slate-400 uppercase block whitespace-nowrap">In Production</span>
                <span className="font-bold text-slate-800 tabular-nums">{activeCases.length}</span>
              </div>
            </div>
          </div>

          {/* Doctor Patient Case Notes — hidden entirely when no case carries an
              instruction, so the column does not open with an empty card. */}
          {notedCases.length > 0 && (
          <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between mb-3 gap-2">
              <h3 className="text-sm font-bold text-slate-900 truncate">Clinic Instructions</h3>
              <button
                onClick={() => setShowClinicNotes(true)}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer whitespace-nowrap shrink-0"
              >
                All Notes →
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {notedCases.slice(0, 2).map((c) => (
                <div
                  key={c.id}
                  onClick={() => setSelectedCaseModal(c)}
                  className="p-3 rounded-xl bg-slate-50 hover:bg-blue-50/50 border border-slate-100 transition cursor-pointer"
                >
                  <div className="flex items-center justify-between font-bold text-slate-800 mb-1 gap-2">
                    <span className="truncate min-w-0">{c.lab_name}</span>
                    <span className="text-[10px] text-slate-400 font-normal shrink-0 tabular-nums">#{c.case_number}</span>
                  </div>
                  <p className="text-slate-500 text-[11px] leading-relaxed line-clamp-2">
                    {c.instructions}
                  </p>
                </div>
              ))}
            </div>
          </div>
          )}

        </div>

        {/* RIGHT COLUMN (4 Cols): Interactive Delivery Calendar & Dispatch Schedule */}
        <div className="lg:col-span-4" id="delivery-calendar">
          <InteractiveDeliveryCalendar
            cases={cases}
            todayStr={todayStr}
            onSelectCase={(c) => setSelectedCaseModal(c)}
            onOpenNewCase={onOpenNewCaseModal}
            onUpdateCaseStatus={(id, status, note) => updateCase(id, { status }, note)}
          />
        </div>

      </section>
      {/* END: Main Operations Grid */}

      {/* Case Detail / FDI Tooth Chart Modal */}
      {selectedCaseModal && (
        <CaseDetailModal
          initialCase={selectedCaseModal}
          onClose={() => setSelectedCaseModal(null)}
        />
      )}

      {/* New Case wizard — carries a shade pre-picked in the shade guide */}
      {isNewCaseOpen && (
        <CaseDetailModal
          initialShade={pendingShade}
          onClose={() => {
            setIsNewCaseOpen(false);
            setPendingShade(null);
          }}
        />
      )}

      {/* Record Transaction / Statement modals moved to the Billing tab along with
          the clinic accounts ledger they were opened from. */}

      {/* Clinic Notes & Instructions Modal */}
      {showClinicNotes && (
        <ClinicNotesModal
          cases={cases}
          onClose={() => setShowClinicNotes(false)}
          onSelectCase={(c) => setSelectedCaseModal(c)}
        />
      )}

      

    </div>
  );
};
