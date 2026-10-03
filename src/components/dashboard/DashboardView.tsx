/**
 * Dashboard.
 *
 * This file is now deliberately thin: it reads app state, hands it to
 * `computeDashboardMetrics`, and lays the panels out on the reference grid.
 * All arithmetic lives in dashboardMetrics.ts, all markup lives in
 * dashboard-panels.tsx.
 *
 * Layout intent, top to bottom:
 *   greeting   → who you are and the one action you take most
 *   KPI row    → four numbers, each a different question
 *   workflow   → where work sits, plus what is late and what is going out today
 *   money      → collections, and what could still go wrong
 *   activity   → what just happened, and what to do next
 *   closing bar→ the promise the lab makes to its clinics
 */
import React, { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { computeDashboardMetrics } from './dashboardMetrics';
import {
  BrandBar,
  CasesAtRisk,
  GreetingHeader,
  KpiCards,
  LabPerformance,
  NeedsAttention,
  ProductionWorkflow,
  QuickActions,
  RecentActivity,
  RevenueCollections,
  TodaySchedule,
  UpcomingDeliveries,
  Workload,
  type QuickAction,
} from './dashboard-panels';
import { CaseDetailModal } from '../cases/CaseDetailModal';
import { getTodayStr } from '../../utils/dateUtils';
import {
  ClipboardList,
  CreditCard,
  Hospital,
  Package,
  Receipt,
  Send,
  ShoppingCart,
  UserPlus,
} from 'lucide-react';
import type { DentalCase } from '../../types';

interface DashboardViewProps {
  onOpenNewCaseModal: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onOpenNewCaseModal }) => {
  const { cases, invoices, allPayments, labs, user, setCurrentView, updateCase } = useApp();

  const [selectedCase, setSelectedCase] = React.useState<DentalCase | null>(null);

  const todayStr = getTodayStr();

  const metrics = useMemo(
    () => computeDashboardMetrics({ cases, invoices, payments: allPayments, labs, todayStr }),
    [cases, invoices, allPayments, labs, todayStr]
  );

  const openCase = (id: string) => {
    const match = cases.find((c) => c.id === id);
    if (match) setSelectedCase(match);
  };

  /** First case sitting in the given status — used by the quick actions that
   *  advance a case rather than navigate. Advancing the *oldest* such case is
   *  deliberate: picking arbitrarily would change whichever row happened to
   *  render first, which is not a decision the user made. */
  const advanceOldest = (status: DentalCase['status'], to: DentalCase['status'], note: string) => {
    const candidate = cases
      .filter((c) => c.status === status)
      .sort((a, b) => (a.delivery_date || '').localeCompare(b.delivery_date || ''))[0];
    if (candidate) {
      updateCase(candidate.id, { status: to }, note);
    } else {
      // Nothing in that stage — fall back to the workstation rather than
      // silently doing nothing, so the click always explains itself.
      setCurrentView('cases');
    }
  };

  const quickActions: QuickAction[] = [
    { key: 'new', label: 'New Case', hint: 'Create a new case', icon: ClipboardList, tone: 'accent', onClick: onOpenNewCaseModal },
    { key: 'invoice', label: 'Invoice', hint: 'Generate invoice', icon: Receipt, tone: 'pos', onClick: () => setCurrentView('billing') },
    { key: 'payment', label: 'Payment', hint: 'Record payment', icon: CreditCard, tone: 'warn', onClick: () => setCurrentView('billing') },
    { key: 'patient', label: 'Patient', hint: 'Add to a new case', icon: UserPlus, tone: 'qc', onClick: onOpenNewCaseModal },
    { key: 'clinic', label: 'Clinic', hint: 'Add dental clinic', icon: Hospital, tone: 'accent', onClick: () => setCurrentView('labs') },
    { key: 'purchase', label: 'Purchase', hint: 'New purchase order', icon: ShoppingCart, tone: 'warn', onClick: () => setCurrentView('catalog') },
    { key: 'receive', label: 'Receive Case', hint: 'Log a received case', icon: Package, tone: 'pos', onClick: () => advanceOldest('received', 'in_progress', 'Moved to production from the dashboard') },
    { key: 'dispatch', label: 'Dispatch', hint: 'Mark for dispatch', icon: Send, tone: 'dispatch', onClick: () => advanceOldest('qc', 'ready', 'Cleared QC from the dashboard') },
  ];

  const scheduleDate = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="space-y-4 pb-10" data-purpose="dashboard">
      <GreetingHeader userName={user?.name || 'there'} onNewCase={onOpenNewCaseModal} />

      <KpiCards kpis={metrics.kpis} onGo={setCurrentView} />

      {/* Every grid below switches to its multi-column layout at 2xl, not xl.
          The sidebar is a fixed ~300px, so an `xl:` breakpoint fires while
          there is still only ~980px of usable content — which squeezed the
          narrow panels until their labels clipped. At 2xl there is genuinely
          room for the reference proportions. */}
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-12 gap-4">
        <div className="2xl:col-span-6">
          <ProductionWorkflow stages={metrics.workflow} onViewAll={() => setCurrentView('cases')} />
        </div>
        <div className="2xl:col-span-3">
          <NeedsAttention rows={metrics.attention} onReview={() => setCurrentView('cases')} />
        </div>
        <div className="2xl:col-span-3">
          <TodaySchedule
            rows={metrics.schedule}
            dateLabel={scheduleDate}
            onOpenCase={openCase}
            onViewCalendar={() => setCurrentView('cases')}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-12 gap-4">
        <div className="2xl:col-span-5">
          <RevenueCollections revenue={metrics.revenue} onInvoices={() => setCurrentView('billing')} />
        </div>
        <div className="2xl:col-span-4">
          <CasesAtRisk rows={metrics.atRisk} onOpenCase={openCase} />
        </div>
        <div className="2xl:col-span-3">
          <RecentActivity rows={metrics.activity} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-12 gap-4">
        <div className="2xl:col-span-4">
          <QuickActions actions={quickActions} />
        </div>
        <div className="2xl:col-span-3">
          <Workload rows={metrics.workload.rows} overallPct={metrics.workload.overallPct} />
        </div>
        <div className="2xl:col-span-2">
          <LabPerformance rows={metrics.performance} />
        </div>
        <div className="2xl:col-span-3">
          <UpcomingDeliveries rows={metrics.upcoming} onOpenCase={openCase} />
        </div>
      </div>

      <BrandBar />

      {selectedCase && (
        <CaseDetailModal initialCase={selectedCase} onClose={() => setSelectedCase(null)} />
      )}
    </div>
  );
};