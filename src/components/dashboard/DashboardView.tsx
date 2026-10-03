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
  CasesAtRisk,
  GreetingHeader,
  KpiCards,
  LabPerformance,
  NeedsAttention,
  ProductionWorkflow,
  QuickActions,
  RecentActivity,
  RevenueCollections,
  StatusFooter,
  TodaySchedule,
  UpcomingDeliveries,
  Workload,
  type QuickAction,
} from './dashboard-panels';
import { CaseDetailModal } from '../cases/CaseDetailModal';
import { CaseJobSlipModal } from '../cases/CaseJobSlipModal';
import { RecordTransactionModal } from '../billing/RecordTransactionModal';
import { ShadeGuideModal } from './ShadeGuideModal';
import { DeliveryCalendarModal } from './DeliveryCalendarModal';
import { CaseQueueModal, type QueueId } from './CaseQueueModal';
import { getTodayStr } from '../../utils/dateUtils';
import { APP_VERSION } from '../../services/backupService';
import {
  ClipboardList,
  CreditCard,
  FlaskConical,
  Hospital,
  Package,
  Receipt,
  Send,
  ShoppingCart,
} from 'lucide-react';
import type { DentalCase } from '../../types';

interface DashboardViewProps {
  onOpenNewCaseModal: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onOpenNewCaseModal }) => {
  const { cases, invoices, allPayments, labs, user, setCurrentView, updateCase } = useApp();

  /* Dashboard rows open the same Job Slip the Case Workstation opens, so a
   case behaves identically wherever it is clicked. The full CaseDetailModal
   is reserved for editing. */
  const [slipCase, setSlipCase] = React.useState<DentalCase | null>(null);
const [paymentModalClinicId, setPaymentModalClinicId] = React.useState<string | undefined>(undefined);
const [showPaymentModal, setShowPaymentModal] = React.useState(false);
const [showShadeGuide, setShowShadeGuide] = React.useState(false);
const [showCalendar, setShowCalendar] = React.useState(false);
const [queue, setQueue] = React.useState<QueueId | null>(null);
const [pendingShade, setPendingShade] = React.useState<string | null>(null);
  /** The shell's new-case modal takes no shade, so the shade-guide path opens
   *  its own wizard instance carrying the pick through. */
  const [shadeWizardOpen, setShadeWizardOpen] = React.useState(false);

  const todayStr = getTodayStr();

  const metrics = useMemo(
    () => computeDashboardMetrics({ cases, invoices, payments: allPayments, labs, todayStr }),
    [cases, invoices, allPayments, labs, todayStr]
  );

  const openCase = (id: string) => {
    const match = cases.find((c) => c.id === id);
    if (match) setSlipCase(match);
  };

  /** First case sitting in the given status — used by the quick actions that
   *  advance a case rather than navigate. Advancing the *oldest* such case is
   *  deliberate: picking arbitrarily would change whichever row happened to
   *  render first, which is not a decision the user made. */
  /* These two tiles used to call `advanceOldest`, which picked whichever case
   * happened to be earliest in a stage and wrote a status change the user
   * never saw, to a case they were not looking at. A tile that mutates an
   * invisible record is worse than no tile: the click appears to do nothing
   * and the workflow changes underneath. They now open the relevant queue and
   * let the technician move the case they actually mean, in the open. */
  const nextStageTile = (
    queue: QueueId,
    label: string,
    hint: string,
    icon: typeof Package,
    tone: QuickAction['tone'],
  ): QuickAction => ({
    key: queue,
    label,
    hint,
    icon,
    tone,
    onClick: () => setQueue(queue),
  });

  /* Every tile below now opens something genuinely distinct.
 *
 * Three of the original eight were category errors rather than duplicates:
 * there is no Patient entity at all (a patient is a field on a case), there
 * is no purchase-order entity (the "Catalog" view is the materials and
 * services price list), and invoices are created automatically the moment a
 * case is registered, so there is no invoice composer to open. Rather than
 * leave two tiles pointing at the same view and one pointing at a screen that
 * cannot exist, those became the actions this build can actually perform. */
  const quickActions: QuickAction[] = [
    {
      key: 'new_case',
      label: 'New Case',
      hint: 'Case + invoice',
      icon: ClipboardList,
      tone: 'accent',
      onClick: onOpenNewCaseModal,
    },
    {
      key: 'payment',
      label: 'Record Payment',
      hint: 'Allocate to invoices',
      icon: CreditCard,
      tone: 'pos',
      onClick: () => {
        setPaymentModalClinicId(undefined);
        setShowPaymentModal(true);
      },
    },
    {
      key: 'invoices',
      label: 'Receivables',
      hint: 'Invoices & balances',
      icon: Receipt,
      tone: 'warn',
      onClick: () => setCurrentView('billing'),
    },
    {
      key: 'shade',
      label: 'Shade Guide',
      hint: 'Pre-fill a shade',
      icon: FlaskConical,
      tone: 'qc',
      onClick: () => setShowShadeGuide(true),
    },
    {
      key: 'clinic',
      label: 'Add Clinic',
      hint: 'New dental clinic',
      icon: Hospital,
      tone: 'accent',
      onClick: () => setCurrentView('labs'),
    },
    {
      key: 'catalog',
      label: 'Materials',
      hint: 'Pricing catalog',
      icon: ShoppingCart,
      tone: 'warn',
      onClick: () => setCurrentView('catalog'),
    },
    nextStageTile('due_today', 'Due Today', 'Promised for today', Package, 'pos'),
    nextStageTile('ready', 'Ready to Dispatch', 'Cleared and waiting', Send, 'dispatch'),
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
          <NeedsAttention
            rows={metrics.attention}
            onReview={(key) => setQueue(key as QueueId)}
          />
        </div>
        <div className="2xl:col-span-3">
          <TodaySchedule
            rows={metrics.schedule}
            dateLabel={scheduleDate}
            onOpenCase={openCase}
            onViewCalendar={() => setShowCalendar(true)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-12 gap-4">
        <div className="2xl:col-span-5">
          <RevenueCollections revenue={metrics.revenue} onInvoices={() => setCurrentView('billing')} />
        </div>
        <div className="2xl:col-span-4">
          <CasesAtRisk
            rows={metrics.atRisk}
            onOpenCase={openCase}
            onViewAll={() => setQueue('open')}
          />
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
          <Workload
            rows={metrics.workload.rows}
            overallPct={metrics.workload.overallPct}
            unassigned={metrics.workload.unassigned}
          />
        </div>
        <div className="2xl:col-span-2">
          <LabPerformance rows={metrics.performance} />
        </div>
        <div className="2xl:col-span-3">
          <UpcomingDeliveries rows={metrics.upcoming} onOpenCase={openCase} />
        </div>
      </div>

      <StatusFooter
        version={APP_VERSION}
        clinicCount={metrics.clinicCount}
        openCases={metrics.kpis.activeCases}
        atRiskCases={metrics.atRisk.length}
      />

      {slipCase && (
        <CaseJobSlipModal caseData={slipCase} onClose={() => setSlipCase(null)} />
      )}

      <DeliveryCalendarModal
        isOpen={showCalendar}
        cases={cases}
        todayStr={todayStr}
        onSelectCase={(c) => setSlipCase(c)}
        onOpenNewCase={() => {
          setShowCalendar(false);
          onOpenNewCaseModal();
        }}
        onUpdateCaseStatus={updateCase}
        onClose={() => setShowCalendar(false)}
      />

      <CaseQueueModal
        queue={queue}
        cases={cases}
        onSelectCase={setSlipCase}
        onOpenWorkstation={() => {
          setQueue(null);
          setCurrentView('cases');
        }}
        onClose={() => setQueue(null)}
      />

      {/* Payment and Shade Guide are the two tiles that needed a real modal
          rather than a navigation hop. */}
      {showPaymentModal && (
        <RecordTransactionModal
          isOpen
          initialMode="payment"
          initialClinicId={paymentModalClinicId}
          onClose={() => setShowPaymentModal(false)}
        />
      )}

      {showShadeGuide && (
        <ShadeGuideModal
          onClose={() => setShowShadeGuide(false)}
          onSelectShade={(shade) => {
            // Carry the picked shade straight into a new case, which is what
            // the shade guide is for — otherwise the pick goes nowhere.
            setShowShadeGuide(false);
            setPendingShade(shade);
            setShadeWizardOpen(true);
          }}
        />
      )}

      {shadeWizardOpen && (
        <CaseDetailModal
          initialShade={pendingShade ?? undefined}
          onClose={() => {
            setShadeWizardOpen(false);
            setPendingShade(null);
          }}
        />
      )}
    </div>
  );
};