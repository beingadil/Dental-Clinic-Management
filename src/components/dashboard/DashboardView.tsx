import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  FolderKanban, 
  DollarSign, 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  Plus, 
  Calendar,
  X,
  ChevronRight,
  Activity,
  Building2,
  Receipt,
  Sparkles,
  Cpu,
  Truck,
  Download,
  FileText
} from 'lucide-react';
import { DentalCase, DentalLab } from '../../types';
import { CaseDetailModal } from '../cases/CaseDetailModal';
import { ShadeGuideModal } from './ShadeGuideModal';
import { InteractiveDeliveryCalendar } from './InteractiveDeliveryCalendar';
import { PaymentCollectionModal } from './PaymentCollectionModal';
import { ClinicStatementModal } from './ClinicStatementModal';
import { BatchBillingModal } from './BatchBillingModal';
import { ClinicNotesModal } from './ClinicNotesModal';
import { ChairsideCalendarModal } from './ChairsideCalendarModal';

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
  const [selectedCaseModal, setSelectedCaseModal] = useState<DentalCase | null>(null);

  // Modal states
  const [showShadeGuide, setShowShadeGuide] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState<{ open: boolean; clinic?: DentalLab | any }>({ open: false });
  const [showStatementModal, setShowStatementModal] = useState<{ open: boolean; clinicName?: string }>({ open: false });
  const [showBatchBilling, setShowBatchBilling] = useState(false);
  const [showClinicNotes, setShowClinicNotes] = useState(false);
  const [showChairsideModal, setShowChairsideModal] = useState(false);

  // Financial metrics
  const totalRevenue = invoices.reduce((sum, inv) => sum + (inv.amount_paid || 0), 0);
  const totalBilled = invoices.reduce((sum, inv) => sum + (inv.final_amount || 0), 0);
  const totalOutstanding = totalBilled - totalRevenue;
  const pendingBillingInvoices = invoices.filter(i => i.payment_status !== 'paid');
  const pendingBillingAmount = pendingBillingInvoices.reduce((sum, inv) => sum + ((inv.final_amount || 0) - (inv.amount_paid || 0)), 0);
  const activeCases = cases.filter(c => c.status !== 'delivered' && c.status !== 'cancelled');

  // Dynamic Material Statistics (real data only — zeros when no cases exist)
  const materialStats = useMemo(() => {
    const total = cases.length;
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
    const zirconiaCount = cases.filter(c => (c.material || '').toLowerCase().includes('zirconia') || (c.case_type_name || '').toLowerCase().includes('zirconia')).length;
    const emaxCount = cases.filter(c => (c.material || '').toLowerCase().includes('e-max') || (c.case_type_name || '').toLowerCase().includes('e-max') || (c.case_type_name || '').toLowerCase().includes('veneer')).length;
    const implantCount = cases.filter(c => (c.material || '').toLowerCase().includes('titanium') || (c.case_type_name || '').toLowerCase().includes('implant')).length;
    const alignerCount = cases.filter(c => (c.case_type_name || '').toLowerCase().includes('aligner') || (c.material || '').toLowerCase().includes('aligner')).length;

    return {
      total,
      zirconia: pct(zirconiaCount),
      emax: pct(emaxCount),
      implants: pct(implantCount),
      aligners: pct(alignerCount),
    };
  }, [cases]);

  // Real chairside queue: active cases sorted by delivery date (no fabricated times)
  const chairsideToday = useMemo(() =>
    [...activeCases]
      .filter((c) => c.delivery_date)
      .sort((a, b) => (a.delivery_date || '').localeCompare(b.delivery_date || ''))
      .slice(0, 3)
      .map((c) => ({
        id: c.id,
        dueLabel: (c.delivery_date || '').slice(5).replace('-', '/'),
        patient: c.patient_name || 'Unnamed patient',
        detail: `${c.case_type_name || 'Case'}${c.selected_teeth?.length ? ` • Tooth #${c.selected_teeth.join(', #')}` : ''}`,
        status: c.status,
      })),
  [activeCases]);

  // Clinic accounts ledger with calculated balances
  const clinicAccounts = useMemo(() => {
    return labs.map(lab => {
      const labInvoices = invoices.filter(i => (i.lab_name || '').toLowerCase() === lab.name.toLowerCase());
      const labCases = cases.filter(c => (c.lab_name || '').toLowerCase() === lab.name.toLowerCase() && c.status !== 'delivered' && c.status !== 'cancelled');
      const billed = labInvoices.reduce((sum, i) => sum + i.final_amount, 0);
      const paid = labInvoices.reduce((sum, i) => sum + i.amount_paid, 0);
      const balance = billed - paid;
      const hasOverdue = labInvoices.some(i => i.payment_status !== 'paid' && i.due_date && i.due_date < (todayStr || '2026-09-17'));

      return {
        lab,
        name: lab.name,
        doctor: lab.doctor_name || lab.contact_person || 'Lead Doctor',
        phone: lab.phone || '—',
        activeCases: labCases,
        turnaround: `${labCases.length} active case${labCases.length === 1 ? '' : 's'}`,
        balance: balance > 0 ? balance : (('balance' in lab) ? (lab as any).balance : 0),
        hasOverdue,
        status: balance === 0 ? 'Settled' : hasOverdue ? 'Overdue' : 'Partial / Active',
      };
    });
  }, [labs, invoices, cases, todayStr]);

  const currentFormattedDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  return (
    <div className="space-y-6 pb-12">
      
      {/* BEGIN: Hero Operations Banner */}
      <section 
        className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white p-6 sm:p-8 shadow-xl"
        data-purpose="hero-operations-banner"
      >
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-200 border border-blue-400/30 backdrop-blur-md">
                <Activity className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                <span>Live Lab Operations Pulse</span>
              </span>
              <span className="text-xs text-slate-300 font-medium">{currentFormattedDate}</span>
            </div>
            
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Welcome back, {user?.name || 'Dr. Adil'}!
            </h1>
          </div>

          {/* Quick Workstation Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <button 
              onClick={onOpenNewCaseModal}
              className="px-4 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-600/30 transition-all duration-200 flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New Dental Case</span>
            </button>
            <button 
              onClick={() => setCurrentView('cases')}
              className="px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs border border-white/20 backdrop-blur-md transition-all duration-200 flex items-center gap-2 cursor-pointer"
            >
              <FolderKanban className="w-4 h-4 text-blue-300" />
              <span>Case Workstation</span>
            </button>
          </div>
        </div>

        {/* Ambient background decoration */}
        <div className="absolute -right-16 -top-16 w-80 h-80 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
        <div className="absolute right-1/3 -bottom-20 w-64 h-64 rounded-full bg-indigo-500/10 blur-2xl pointer-events-none" />
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
                <h4 className="text-xs font-bold uppercase tracking-wider text-rose-800">
                  Urgent Action Required: {overdueCount} Cases Exceeding SLA
                </h4>
                <span className="text-[10px] bg-rose-200 text-rose-900 font-bold px-2 py-0.5 rounded-full">High Priority</span>
              </div>
              <p className="text-xs text-rose-700 mt-1">
                Remake cases and expedited units require sintering acceleration and shade clearance before courier dispatch.
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

      {/* BEGIN: Dental KPI Stats Matrix (5 Cards) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4" data-purpose="kpi-metric-cards">
        
        {/* KPI 1: Active Fabrication */}
        <div 
          onClick={() => setCurrentView('cases')}
          className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs hover:shadow-md hover:border-blue-400 transition-all duration-200 cursor-pointer flex flex-col justify-between group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Active Fabrication</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-105 transition-transform">
              <FolderKanban className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-900">{activeCases.length}</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">In Production</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">CAD/CAM bench units</p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
            <span>Milling & Finishing</span>
            <span className="text-blue-600 font-bold group-hover:underline">Open Workstation →</span>
          </div>
        </div>

        {/* KPI 2: Pending Billing */}
        <div 
          onClick={() => setCurrentView('billing')}
          className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs hover:shadow-md hover:border-amber-400 transition-all duration-200 cursor-pointer flex flex-col justify-between group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Pending Billing</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center group-hover:scale-105 transition-transform">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-900">PKR {pendingBillingAmount.toLocaleString()}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">{pendingBillingInvoices.length} unbilled / partial invoices</p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
            <span>Collection Rate</span>
            <span className="font-bold text-emerald-600">
              {totalBilled > 0 ? `${Math.round((totalRevenue / totalBilled) * 100)}% Collected` : '—'}
            </span>
          </div>
        </div>

        {/* KPI 3: Receivables Total */}
        <div 
          onClick={() => setCurrentView('billing')}
          className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs hover:shadow-md hover:border-emerald-400 transition-all duration-200 cursor-pointer flex flex-col justify-between group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Receivables Total</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-105 transition-transform">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-900">PKR {totalOutstanding.toLocaleString()}</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">{labs.length} Clinics</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">
              {(() => {
                const unpaid = invoices.filter(i => i.payment_status !== 'paid' && i.due_date);
                if (unpaid.length === 0) return 'No outstanding invoices';
                const avgDays = Math.round(
                  unpaid.reduce((s, i) => s + Math.max(0, Math.round((Date.now() - new Date(i.due_date!).getTime()) / 86400000)), 0) / unpaid.length
                );
                return `Avg Aging: ${avgDays} day${avgDays === 1 ? '' : 's'}`;
              })()}
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
            <span>Current Month</span>
            <span className="font-bold text-slate-700">PKR {totalRevenue.toLocaleString()} Paid</span>
          </div>
        </div>

        {/* KPI 4: Rush / Overdue */}
        <div 
          onClick={() => setCurrentView('cases')}
          className="bg-white rounded-2xl p-4 border border-rose-200 shadow-xs hover:shadow-md hover:border-rose-400 transition-all duration-200 cursor-pointer flex flex-col justify-between group bg-rose-50/20"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider">Rush / Overdue</span>
            <div className="w-8 h-8 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center group-hover:scale-105 transition-transform">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-rose-600">{overdueCount}</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Urgent</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1 font-medium">Past SLA / Remake cases</p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-rose-600 font-medium">
            <span>Requires Action</span>
            <span className="underline font-bold">Review Now →</span>
          </div>
        </div>

        {/* KPI 5: Deliveries Today */}
        <div 
          onClick={() => {
            const calendarEl = document.getElementById('delivery-calendar');
            calendarEl?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs hover:shadow-md hover:border-purple-400 transition-all duration-200 cursor-pointer flex flex-col justify-between group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Deliveries Today</span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center group-hover:scale-105 transition-transform">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-900">{dueTodayCount}</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Scheduled</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">Cases with delivery due today</p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
            <span>Delivery Calendar</span>
            <span className="font-bold text-purple-700">View Schedule →</span>
          </div>
        </div>
      </section>
      {/* END: Dental KPI Stats Matrix */}

      {/* BEGIN: Main Operations Grid (12 Cols) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6" data-purpose="mid-dashboard-details">
        
        {/* LEFT COLUMN (4 Cols): Today's Chairside Clinical Cases & Quick Modules */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Chairside Appointments Card */}
          <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Today's Chairside Clinical Cases</h3>
                <p className="text-[11px] text-slate-400">Clinic floor trials, shade checks & try-ins</p>
              </div>
              <button 
                onClick={() => setShowChairsideModal(true)}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
              >
                View all
              </button>
            </div>
            
            <div className="space-y-3">
              {chairsideToday.length === 0 && (
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 text-center">
                  <p className="text-[11px] text-slate-500 font-medium">No upcoming chairside cases</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Cases with delivery dates appear here</p>
                </div>
              )}
              {chairsideToday.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setShowChairsideModal(true)}
                  className="p-3 rounded-2xl bg-slate-50 hover:bg-blue-50/50 border border-slate-100 transition flex items-center justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="text-center w-12 py-1 bg-white rounded-xl border border-slate-200 text-slate-800">
                      <span className="block text-[11px] font-extrabold leading-none">{item.dueLabel}</span>
                      <span className="text-[9px] text-slate-400 font-semibold uppercase">Due</span>
                    </div>
                    <div>
                      <h5 className="text-xs font-bold text-slate-800">{item.patient}</h5>
                      <p className="text-[11px] text-slate-500">{item.detail}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 capitalize">
                    {String(item.status).replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>

            <button 
              onClick={() => setShowChairsideModal(true)}
              className="w-full mt-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-600 transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>View Full Chairside Calendar</span>
            </button>
          </div>

          {/* Quick Action Links Grid (6 Bento Modules) */}
          <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-3">Dental Lab Quick Modules</h3>
            <div className="grid grid-cols-3 gap-2.5">
              
              {/* Module 1: FDI Chart */}
              <button 
                onClick={onOpenNewCaseModal}
                className="p-3 rounded-2xl bg-blue-50/60 hover:bg-blue-100/60 border border-blue-100 flex flex-col items-center justify-center text-center transition group cursor-pointer"
              >
                <div className="w-8 h-8 rounded-xl bg-white text-blue-600 shadow-xs flex items-center justify-center mb-1.5 group-hover:scale-110 transition-transform">
                  <FileText className="w-4 h-4" />
                </div>
                <span className="text-[11px] font-bold text-slate-700 leading-tight">FDI Chart</span>
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
              <div>
                <h3 className="text-sm font-bold text-slate-900">Prosthetics Material Share</h3>
                <p className="text-[11px] text-slate-400">Current active fabrication breakdown</p>
              </div>
              <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full">
                {cases.length} Units Total
              </span>
            </div>

            {/* Donut Chart Visual */}
            <div className="flex items-center justify-center my-4">
              <div className="relative w-36 h-36 rounded-full donut-chart flex items-center justify-center shadow-inner">
                <div className="w-24 h-24 rounded-full bg-white flex flex-col items-center justify-center shadow-xs">
                  <span className="text-xl font-extrabold text-slate-800">{materialStats.zirconia}%</span>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Zirconia</span>
                </div>
              </div>
            </div>

            {/* Interactive Legend */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs">
              <button 
                onClick={() => setCurrentView('cases')}
                className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-50 transition cursor-pointer text-left"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-[#2563eb]" />
                <span className="text-slate-600 font-medium">Zirconia ({materialStats.zirconia}%)</span>
              </button>
              <button 
                onClick={() => setCurrentView('cases')}
                className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-50 transition cursor-pointer text-left"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-[#0284c7]" />
                <span className="text-slate-600 font-medium">E-max ({materialStats.emax}%)</span>
              </button>
              <button 
                onClick={() => setCurrentView('cases')}
                className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-50 transition cursor-pointer text-left"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
                <span className="text-slate-600 font-medium">Implants ({materialStats.implants}%)</span>
              </button>
              <button 
                onClick={() => setCurrentView('cases')}
                className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-50 transition cursor-pointer text-left"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" />
                <span className="text-slate-600 font-medium">Aligners ({materialStats.aligners}%)</span>
              </button>
            </div>

            {/* Benchmark stats */}
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <div className="text-center">
                <span className="text-[10px] text-slate-400 uppercase block">Avg Turnaround</span>
                <span className="font-bold text-slate-800">
                  {(() => {
                    const delivered = cases.filter(c => c.status === 'delivered');
                    if (delivered.length === 0) return '—';
                    const avg = delivered.reduce((s, c) => {
                      const start = c.created_at ? new Date(c.created_at).getTime() : NaN;
                      const end = c.delivery_date ? new Date(c.delivery_date).getTime() : NaN;
                      return s + (Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 86400000)) : 0);
                    }, 0) / delivered.length;
                    return `${avg.toFixed(1)} Days`;
                  })()}
                </span>
              </div>
              <div className="h-6 w-px bg-slate-200" />
              <div className="text-center">
                <span className="text-[10px] text-slate-400 uppercase block">First-Pass QC</span>
                <span className="font-bold text-emerald-600">—</span>
              </div>
              <div className="h-6 w-px bg-slate-200" />
              <div className="text-center">
                <span className="text-[10px] text-slate-400 uppercase block">In Production</span>
                <span className="font-bold text-slate-800">{activeCases.length}</span>
              </div>
            </div>
          </div>

          {/* Doctor Patient Case Notes */}
          <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900">Recent Dental Clinic Instructions</h3>
              <button 
                onClick={() => setShowClinicNotes(true)}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
              >
                All Notes →
              </button>
            </div>
            
            <div className="space-y-3 text-xs">
              {cases.slice(0, 2).map((c, idx) => (
                <div 
                  key={c.id || idx}
                  onClick={() => setSelectedCaseModal(c)}
                  className="p-3 rounded-xl bg-slate-50 hover:bg-blue-50/50 border border-slate-100 transition cursor-pointer"
                >
                  <div className="flex items-center justify-between font-bold text-slate-800 mb-1">
                    <span>{c.lab_name}</span>
                    <span className="text-[10px] text-slate-400 font-normal">#{c.case_number}</span>
                  </div>
                  <p className="text-slate-500 text-[11px] leading-relaxed line-clamp-2">
                    {c.instructions || `Patient ${c.patient_name} - Standard ${c.case_type_name} with shade ${c.shade || 'A2'}.`}
                  </p>
                </div>
              ))}
            </div>
          </div>

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

      {/* BEGIN: Dental Clinics Accounts & Invoicing Ledger Table */}
      <section className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs mb-6" data-purpose="invoicing-summary">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">Dental Clinics Accounts & Invoicing Ledger</h3>
            <p className="text-xs text-slate-500">Real-time clinic balances, pending PKR collections, and active statements</p>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setShowStatementModal({ open: true, clinicName: 'Apex Dental Care & Clinic' })}
              className="text-xs font-semibold px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 transition cursor-pointer flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Download PDF Statements</span>
            </button>
            <button 
              onClick={() => setShowBatchBilling(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>Generate Batch Billing</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4 rounded-l-xl">Clinic Name & Contact</th>
                <th className="py-3 px-3">Active Cases</th>
                <th className="py-3 px-3">Standard Turnaround</th>
                <th className="py-3 px-3">Outstanding Balance</th>
                <th className="py-3 px-3">Payment Status</th>
                <th className="py-3 px-4 text-right rounded-r-xl">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clinicAccounts.map(account => (
                <tr key={account.lab.id} className="hover:bg-slate-50/60 transition">
                  <td className="py-3.5 px-4 font-semibold text-slate-900">
                    {account.name}
                    <span className="block text-[11px] font-normal text-slate-400">{account.doctor} • {account.phone}</span>
                  </td>
                  <td className="py-3.5 px-3">
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">
                      {account.activeCases.length} Cases ({account.activeCases.map(c => `DS-${c.case_number}`).join(', ') || 'In Queue'})
                    </span>
                  </td>
                  <td className="py-3.5 px-3 font-medium">{account.turnaround}</td>
                  <td className="py-3.5 px-3 font-bold text-slate-900">PKR {account.balance.toLocaleString()}</td>
                  <td className="py-3.5 px-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      account.status === 'Settled' 
                        ? 'bg-emerald-100 text-emerald-800' 
                        : account.status === 'Overdue'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}>
                      {account.status}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => setShowPaymentModal({ open: true, clinic: account.lab })}
                        className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 cursor-pointer"
                      >
                        Collect Payment
                      </button>
                      <span className="text-slate-300">|</span>
                      <button 
                        onClick={() => setShowStatementModal({ open: true, clinicName: account.name })}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 cursor-pointer"
                      >
                        Statement
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {/* END: Dental Clinics Accounts & Invoicing Ledger Table */}

      {/* Case Detail / FDI Tooth Chart Modal */}
      {selectedCaseModal && (
        <CaseDetailModal
          initialCase={selectedCaseModal}
          onClose={() => setSelectedCaseModal(null)}
        />
      )}

      {/* VITA Shade Guide Modal */}
      {showShadeGuide && (
        <ShadeGuideModal
          onClose={() => setShowShadeGuide(false)}
          onSelectShade={(shade) => {
            setShowShadeGuide(false);
            onOpenNewCaseModal();
          }}
        />
      )}

      {/* Payment Collection Modal */}
      {showPaymentModal.open && (
        <PaymentCollectionModal
          clinic={showPaymentModal.clinic}
          invoices={invoices}
          onClose={() => setShowPaymentModal({ open: false })}
          onSubmitPayment={(clinicName, amount, method, ref, note) => {
            const matchingInvoices = invoices.filter(i => (i.lab_name || '').toLowerCase() === clinicName.toLowerCase());
            if (matchingInvoices.length > 0) {
              matchingInvoices[0].amount_paid = matchingInvoices[0].final_amount;
              matchingInvoices[0].payment_status = 'paid';
            }
          }}
        />
      )}

      {/* Clinic Statement Modal */}
      {showStatementModal.open && (
        <ClinicStatementModal
          clinicName={showStatementModal.clinicName}
          invoices={invoices}
          cases={cases}
          labs={labs}
          onClose={() => setShowStatementModal({ open: false })}
        />
      )}

      {/* Batch Billing Modal */}
      {showBatchBilling && (
        <BatchBillingModal
          cases={cases}
          invoices={invoices}
          onClose={() => setShowBatchBilling(false)}
          onGenerateInvoices={(caseIds) => {
            // Handled with visual confirmation
          }}
        />
      )}

      {/* Clinic Notes & Instructions Modal */}
      {showClinicNotes && (
        <ClinicNotesModal
          cases={cases}
          onClose={() => setShowClinicNotes(false)}
          onSelectCase={(c) => setSelectedCaseModal(c)}
        />
      )}

      {/* Chairside Appointments Schedule Modal */}
      {showChairsideModal && (
        <ChairsideCalendarModal
          cases={cases}
          onClose={() => setShowChairsideModal(false)}
          onSelectCase={(c) => setSelectedCaseModal(c)}
        />
      )}

    </div>
  );
};
