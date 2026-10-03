/**
 * Dashboard panels.
 *
 * Every panel here is pure presentation: it receives computed data and renders
 * it. Nothing in this file reads the database, invents a number, or reaches for
 * a fallback literal — an empty dataset renders an em dash or a composed empty
 * state, never a plausible-looking fake.
 *
 * Shared conventions:
 *  · `.ds-panel` is the single card shell (radius, border, elevation defined
 *    once in dashboard-tokens.css so panels cannot drift apart).
 *  · Status colour is reserved meaning: amber = waiting, rose = late, violet =
 *    inspection, emerald = ready, blue = in progress, cyan = dispatched.
 *  · Figures use `.ds-figure` (tabular numerals) so columns align and totals
 *    do not shimmer as they change.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock,
  DollarSign,
  FlaskConical,
  Gauge,
  Package,
  PackageCheck,
  Plus,
  Receipt,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sun,
  TrendingUp,
  Truck,
  Wallet,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  type AttentionRow,
  type ActivityRow,
  type DashboardMetrics,
  type KpiRow,
  type PerformanceRow,
  type RevenueSummary,
  type RiskLevel,
  type RiskRow,
  type ScheduleRow,
  type UpcomingRow,
  type WorkloadRow,
  type WorkflowStage,
} from './dashboardMetrics';
import { formatTimeAgo } from '../../utils/dateUtils';

/* ── tone maps ────────────────────────────────────────────────────────── */

type Tone = 'muted' | 'accent' | 'qc' | 'pos' | 'dispatch' | 'warn' | 'risk';

const TONE_CHIP: Record<Tone, string> = {
  muted: 'bg-ds-sunken text-ds-body border-ds-line',
  accent: 'bg-ds-accent-soft text-ds-accent-strong border-ds-accent-ring',
  qc: 'bg-ds-qc-soft text-ds-qc-ink border-transparent',
  pos: 'bg-ds-pos-soft text-ds-pos-ink border-transparent',
  dispatch: 'bg-ds-dispatch-soft text-ds-dispatch border-transparent',
  warn: 'bg-ds-warn-soft text-ds-warn-ink border-transparent',
  risk: 'bg-ds-risk-soft text-ds-risk-ink border-transparent',
};

const TONE_ICON_BG: Record<Tone, string> = {
  muted: 'bg-slate-100 text-slate-500',
  accent: 'bg-ds-accent-soft text-ds-accent',
  qc: 'bg-ds-qc-soft text-ds-qc',
  pos: 'bg-ds-pos-soft text-ds-pos',
  dispatch: 'bg-ds-dispatch-soft text-ds-dispatch',
  warn: 'bg-ds-warn-soft text-ds-warn-ink',
  risk: 'bg-ds-risk-soft text-ds-risk',
};

const TONE_BAR: Record<WorkloadRow['tone'], string> = {
  accent: 'bg-ds-accent',
  qc: 'bg-ds-qc',
  pos: 'bg-ds-pos',
  warn: 'bg-ds-warn',
  dispatch: 'bg-ds-dispatch',
};

/* ── shared atoms ─────────────────────────────────────────────────────── */

const EM = '—';

/** Small uppercase label above a group of figures. */
const Eyebrow: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <span className={`ds-eyebrow ${className}`}>{children}</span>
);

const Chip: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${TONE_CHIP[tone]}`}
  >
    {children}
  </span>
);

const PanelHead: React.FC<{
  icon?: LucideIcon;
  tone?: Tone;
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}> = ({ icon: Icon, tone = 'accent', title, subtitle, action, className = '' }) => (
  <div className={`flex items-start justify-between gap-3 ${className}`}>
    <div className="flex items-center gap-2.5 min-w-0">
      {Icon && (
        <span className={`ds-icon-tile ${TONE_ICON_BG[tone]}`}>
          <Icon className="w-[18px] h-[18px]" strokeWidth={2} />
        </span>
      )}
      <div className="min-w-0">
        <h3 className="ds-panel-title truncate">{title}</h3>
        {subtitle && <p className="ds-panel-sub truncate">{subtitle}</p>}
      </div>
    </div>
    {action && (
      <button type="button" onClick={action.onClick} className="ds-link mt-1.5 shrink-0">
        {action.label}
      </button>
    )}
  </div>
);

/** Right-aligned "View …" affordance anchored to the card's bottom edge. */
const PanelFoot: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="absolute right-5 bottom-4 ds-link cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-accent"
  >
    {label} <ArrowRight className="w-3 h-3 inline -mt-0.5" />
  </button>
);

/** Composed empty state — never a bare "0" pretending to be a result. */
const Empty: React.FC<{ message: string; hint?: string }> = ({ message, hint }) => (
  <div className="flex flex-col items-center justify-center text-center py-6 px-3">
    <p className="text-[11px] font-semibold text-ds-body">{message}</p>
    {hint && <p className="text-[10px] text-ds-muted mt-0.5">{hint}</p>}
  </div>
);

/* ── 0 · Greeting ─────────────────────────────────────────────────────── */

export const GreetingHeader: React.FC<{
  userName: string;
  onNewCase: () => void;
}> = ({ userName, onNewCase }) => {
  // Time-of-day greeting from the real clock — "morning" at 06:00 is a lie
  // the reference mock cannot afford to make.
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const now = new Date();
  const dateLine = now.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeLine = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  return (
    <section
      className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-1"
      data-purpose="dashboard-greeting"
    >
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-[22px] sm:text-[26px] font-extrabold tracking-[-0.02em] text-ds-ink leading-none">
          <span className="truncate">
            {greeting}, {userName}
          </span>
          <Sun className="w-5 h-5 text-ds-warn shrink-0" strokeWidth={2.2} aria-hidden="true" />
        </h1>
        <p className="text-[12px] text-ds-body mt-1.5">Here&apos;s what&apos;s happening in your laboratory today.</p>
      </div>

      <div className="flex items-center gap-4 shrink-0">
        <div className="text-right leading-tight">
          <div className="text-[12px] font-semibold text-ds-ink-soft whitespace-nowrap">{dateLine}</div>
          <div className="text-[11px] text-ds-muted tabular-nums">{timeLine}</div>
        </div>
        <button
          type="button"
          onClick={onNewCase}
          className="ds-tap inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-ds-inverse text-white text-[12px] font-bold cursor-pointer hover:bg-ds-inverse-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-accent"
        >
          <Plus className="w-4 h-4" strokeWidth={2.4} />
          <span>New Case</span>
        </button>
      </div>
    </section>
  );
};

/* ── 1 · KPI row ──────────────────────────────────────────────────────── */

interface KpiTileSpec {
  key: string;
  label: string;
  value: string;
  icon: LucideIcon;
  tone: Tone;
  /** Second line under the figure — delta, next event, etc. */
  note: string;
  noteTone: 'pos' | 'risk' | 'muted' | 'warn';
  actionLabel: string;
  onAction: () => void;
  /** Outstanding renders as "PKR 67,500" on one line with a smaller figure. */
  currency?: boolean;
}

export const KpiCards: React.FC<{ kpis: KpiRow; onGo: (view: string) => void }> = ({ kpis, onGo }) => {
  const noteCls = {
    pos: 'text-ds-pos-ink',
    risk: 'text-ds-risk',
    muted: 'text-ds-body',
    warn: 'text-ds-warn-ink',
  };

  const tiles: KpiTileSpec[] = [
    {
      key: 'active',
      label: 'Active Cases',
      value: String(kpis.activeCases),
      icon: ClipboardList,
      tone: 'accent',
      note:
        kpis.activeDelta === 0
          ? 'No change this week'
          : `${kpis.activeDelta > 0 ? '↑' : '↓'} ${Math.abs(kpis.activeDelta)} this week`,
      noteTone: kpis.activeDelta > 0 ? 'pos' : kpis.activeDelta < 0 ? 'risk' : 'muted',
      actionLabel: 'View all',
      onAction: () => onGo('cases'),
    },
    {
      key: 'production',
      label: 'In Production',
      value: String(kpis.inProduction),
      icon: FlaskConical,
      tone: 'qc',
      note:
        kpis.inProductionDueToday > 0
          ? `${kpis.inProductionDueToday} due today`
          : 'Nothing due today',
      noteTone: kpis.inProductionDueToday > 0 ? 'risk' : 'muted',
      actionLabel: 'View all',
      onAction: () => onGo('cases'),
    },
    {
      key: 'deliveries',
      label: 'Deliveries Today',
      value: String(kpis.deliveriesToday),
      icon: Truck,
      tone: 'pos',
      note: kpis.nextDeliveryRef ? `Next · ${kpis.nextDeliveryRef}` : 'Nothing scheduled',
      noteTone: 'muted',
      actionLabel: 'View schedule',
      onAction: () => onGo('cases'),
    },
    {
      key: 'outstanding',
      label: 'Outstanding',
      value: kpis.outstanding > 0 ? Math.round(kpis.outstanding).toLocaleString() : EM,
      icon: Receipt,
      tone: 'warn',
      note:
        kpis.overdueAmount > 0
          ? `↑ PKR ${Math.round(kpis.overdueAmount).toLocaleString()} overdue`
          : 'Nothing overdue',
      noteTone: kpis.overdueAmount > 0 ? 'risk' : 'pos',
      actionLabel: 'View invoices',
      onAction: () => onGo('billing'),
      currency: true,
    },
  ];

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-4" data-purpose="kpi-row">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        return (
          <article
            key={tile.key}
            className="ds-panel relative p-4 pb-9 ds-enter hover:shadow-ds-lift transition-shadow cursor-pointer group"
            style={{ ['--ds-i' as string]: tiles.indexOf(tile) }}
            onClick={tile.onAction}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                tile.onAction();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={`${tile.label}: ${tile.value}`}
          >
            <div className="flex items-center gap-2.5">
              <span className={`ds-icon-tile ${TONE_ICON_BG[tile.tone]}`}>
                <Icon className="w-[18px] h-[18px]" strokeWidth={2} />
              </span>
              <Eyebrow className="truncate">{tile.label}</Eyebrow>
            </div>

            <div className="mt-3 flex items-baseline gap-1.5 min-w-0">
              {tile.currency && <span className="ds-figure text-[15px] text-ds-ink-soft">PKR</span>}
              <span
                className={`ds-figure ${tile.currency ? 'text-[20px]' : 'text-[28px] leading-none'}`}
              >
                {tile.value}
              </span>
            </div>

            <p className={`text-[11px] font-semibold mt-1.5 truncate ${noteCls[tile.noteTone]}`}>
              {tile.note}
            </p>

            <PanelFoot label={tile.actionLabel} onClick={tile.onAction} />
          </article>
        );
      })}
    </section>
  );
};

/* ── 2 · Production workflow ──────────────────────────────────────────── */

export const ProductionWorkflow: React.FC<{
  stages: WorkflowStage[];
  onViewAll: () => void;
}> = ({ stages, onViewAll }) => (
  <section className="ds-panel p-5 ds-enter" data-purpose="production-workflow">
    <PanelHead
      title="Production Workflow"
      subtitle="Live status of cases in production"
      action={{ label: 'View all cases', onClick: onViewAll }}
    />

    {/* Tiles wrap instead of truncating: on a half-width card five tiles plus
        four connectors no longer fit, and a stage label that reads "In Pro…
        uction" is worse than a second row. */}
        <div className="mt-4 flex flex-wrap items-stretch gap-1">
          {stages.map((stage, i) => (
            <React.Fragment key={stage.key}>
              {i > 0 && (
                <span className="flex items-center text-ds-muted shrink-0" aria-hidden="true">
                  <ArrowRight className="w-3 h-3" />
                </span>
              )}
              <div className={`flex-1 basis-[86px] min-w-0 rounded-xl ${TONE_ICON_BG[stage.tone]} px-1.5 py-3 text-center`}>
            <span className="block text-[11px] font-bold text-ds-ink-soft truncate">{stage.label}</span>
            <span className="ds-figure block text-[24px] leading-tight mt-1.5">{stage.count}</span>
            <span className="block text-[10px] text-ds-body">{stage.unit}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  </section>
);

/* ── 3 · Needs attention ──────────────────────────────────────────────── */

const ATTENTION_ICON: Record<AttentionRow['tone'], LucideIcon> = {
  risk: Bell,
  warn: Clock,
  qc: AlertTriangle,
  pos: ShieldCheck,
};

export const NeedsAttention: React.FC<{ rows: AttentionRow[]; onReview: () => void }> = ({
  rows,
  onReview,
}) => (
  <section className="ds-panel p-5 ds-enter" data-purpose="needs-attention">
    <PanelHead
      icon={ShieldAlert}
      tone="risk"
      title="Needs Attention"
      action={{ label: 'Review', onClick: onReview }}
    />

    <ul className="mt-3.5 space-y-2.5">
      {rows.map((row) => {
        const Icon = ATTENTION_ICON[row.tone];
        const dim = row.count === 0;
        return (
          <li key={row.key} className={`flex items-start gap-2.5 ${dim ? 'opacity-50' : ''}`}>
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                TONE_ICON_BG[row.tone]
              }`}
            >
              <Icon className="w-3.5 h-3.5" strokeWidth={2.2} />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11.5px] font-bold text-ds-ink truncate">
                  {row.count} {row.title}
                </span>
                {!dim && (
                  <button type="button" onClick={onReview} className="ds-link shrink-0">
                    View
                  </button>
                )}
              </div>
              {row.detail && (
                <p className="text-[10.5px] text-ds-body mt-0.5 truncate">
                  {row.detail}
                  {row.qualifier ? <span className="text-ds-muted"> · {row.qualifier}</span> : null}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  </section>
);

/* ── 4 · Today's schedule ─────────────────────────────────────────────── */

/** Second line under each schedule row. A phrase, not a repeat of the chip —
 *  "Zirconia Crown · Ready for Delivery" reads as a sentence, whereas
 *  "Zirconia Crown · Ready" beside a chip that already says Ready is noise. */
const STAGE_DETAIL: Record<ScheduleRow['status'], string> = {
  Ready: 'For delivery',
  'QC Complete': 'QC passed',
  'In Production': 'On the bench',
  Received: 'Queued',
  Revision: 'Sent back',
};

export const TodaySchedule: React.FC<{
  rows: ScheduleRow[];
  dateLabel: string;
  onOpenCase: (id: string) => void;
  onViewCalendar: () => void;
}> = ({ rows, dateLabel, onOpenCase, onViewCalendar }) => (
  <section className="ds-panel p-5 ds-enter" data-purpose="today-schedule">
    <PanelHead
      icon={CalendarDays}
      title="Today's Schedule"
      subtitle={dateLabel}
      action={{ label: 'View calendar', onClick: onViewCalendar }}
    />

    {rows.length === 0 ? (
      <Empty message="No deliveries scheduled today" hint="Pick a future date to stage a run." />
    ) : (
      <ol className="mt-3.5 space-y-3">
        {rows.map((row, i) => (
          <li key={row.id} className="relative pl-5">
            {/* Vertical rail: the connector stops at the last dot. */}
            {i < rows.length - 1 && (
              <span
                className="absolute left-[3px] top-3 bottom-[-14px] w-px bg-ds-line"
                aria-hidden="true"
              />
            )}
            <span
              className={`absolute left-0 top-[5px] w-[7px] h-[7px] rounded-full ring-2 ring-white ${
                TONE_ICON_BG[row.tone].split(' ')[1]
              }`}
              aria-hidden="true"
            />

            <button
              type="button"
              onClick={() => onOpenCase(row.id)}
              className="w-full text-left cursor-pointer group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-accent rounded"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-baseline gap-1.5 min-w-0">
                  {/* Real clock: when the case entered its current stage. */}
                  <span className="text-[11px] font-bold text-ds-ink-soft tabular-nums shrink-0">
                    {row.clock || EM}
                  </span>
                  <span className="text-[11.5px] font-bold text-ds-accent shrink-0 group-hover:underline">
                    {row.caseNumber}
                  </span>
                  <span className="text-[11.5px] font-bold text-ds-ink truncate">{row.patient}</span>
                </div>
                <Chip tone={row.tone}>{row.status}</Chip>
              </div>
              <p className="text-[10.5px] text-ds-body mt-0.5 truncate" title={`${row.caseType} · ${STAGE_DETAIL[row.status]}`}>
                {row.caseType} · {STAGE_DETAIL[row.status]}
              </p>
            </button>
          </li>
        ))}
      </ol>
    )}
  </section>
);

/* ── 5 · Revenue & collections ────────────────────────────────────────── */

/** Cumulative area chart with a crosshair, hover tooltip and click-to-inspect.
 *
 *  Hand-drawn SVG rather than a chart runtime: the dashboard bundle does not
 *  need to carry one for a six-point series, and the curve, gridline spacing
 *  and dot styling then match the design exactly.
 *
 *  Interaction model, deliberately three-layer:
 *    hover  → crosshair + tooltip follow the pointer (transient)
 *    click  → pins that day, so the readout survives the pointer leaving
 *    keys   → ← → move the cursor, Home/End jump to the ends
 */
const RevenueChart: React.FC<{ series: { label: string; value: number }[] }> = ({ series }) => {
  const W = 300;
  const H = 118;
  const PAD = { t: 10, r: 6, b: 20, l: 0 };

  const [hovered, setHovered] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // A pinned day outranks a hovered one, so clicking really does "hold".
  const active = pinned ?? hovered;

  const geometry = useMemo(() => {
    if (series.length < 2) return null;
    const max = Math.max(...series.map((p) => p.value), 1);
    const plotW = W - PAD.l - PAD.r;
    const plotH = H - PAD.t - PAD.b;
    const pts = series.map((p, i) => [
      PAD.l + (i / (series.length - 1)) * plotW,
      PAD.t + plotH - (p.value / max) * plotH,
    ]);

    // Catmull-Rom → cubic Bézier, tension 0.5 — smooth without overshoot
    // dipping below the axis the way a plain spline can.
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
    }

    const last = pts[pts.length - 1];
    const area = `${d} L ${last[0]} ${PAD.t + plotH} L ${PAD.l} ${PAD.t + plotH} Z`;
    return { pts, d, area, max, plotH, baseY: PAD.t + plotH };
  }, [series]);

  /** Nearest sample to a pointer position, in viewBox units. Using the SVG's
   *  own CTM means the answer is correct at any rendered size, which a
   *  hand-rolled rect-width ratio is not once the chart is responsive. */
  const nearest = (clientX: number): number | null => {
    const svg = svgRef.current;
    if (!svg || !geometry) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const loc = svg.createSVGPoint();
    loc.x = clientX;
    loc.y = 0;
    const x = loc.matrixTransform(ctm.inverse()).x;
    let best = 0;
    let bestDist = Infinity;
    geometry.pts.forEach(([px], i) => {
      const d = Math.abs(px - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  };

  if (!geometry) {
    return (
      <div className="flex items-center justify-center h-[118px] text-[10px] text-ds-muted">
        No collections recorded this month
      </div>
    );
  }

  const ticks = [geometry.max, geometry.max / 2, 0];
  const activePoint = active === null ? null : geometry.pts[active];
  const activeSeries = active === null ? null : series[active];

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = series.length - 1;
    let next = active;
    if (e.key === 'ArrowRight') next = Math.min(last, (active ?? -1) + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, (active ?? last) - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else if (e.key === 'Escape') {
      setPinned(null);
      setHovered(null);
      return;
    } else return;
    e.preventDefault();
    setPinned(next);
  };

  return (
    <div className="min-w-0">
      <div className="flex gap-2">
        <div
          className="flex flex-col justify-between text-[9px] text-ds-muted tabular-nums shrink-0"
          style={{ height: H - PAD.t - PAD.b }}
          aria-hidden="true"
        >
          {ticks.map((t) => (
            <span key={t}>{t >= 1000 ? `${Math.round(t / 1000)}K` : Math.round(t)}</span>
          ))}
        </div>

        <div className="relative flex-1 min-w-0">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full block outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ring rounded"
            role="img"
            tabIndex={0}
            aria-label={`Cumulative collections. ${
              activeSeries
                ? `${activeSeries.label}: PKR ${Math.round(activeSeries.value).toLocaleString()}`
                : `${series.length} samples. Use arrow keys to inspect.`
            }`}
            onPointerMove={(e) => setHovered(nearest(e.clientX))}
            onPointerLeave={() => setHovered(null)}
            onPointerDown={(e) => {
              const i = nearest(e.clientX);
              setPinned((prev) => (i !== null && i === prev ? null : i));
            }}
            onKeyDown={onKeyDown}
            onBlur={() => setHovered(null)}
          >
            <defs>
              <linearGradient id="ds-rev-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--ds-pos)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--ds-pos)" stopOpacity="0.01" />
              </linearGradient>
            </defs>

            {[0, 0.5, 1].map((f) => (
              <line
                key={f}
                x1={PAD.l}
                x2={W - PAD.r}
                y1={geometry.baseY - f * geometry.plotH}
                y2={geometry.baseY - f * geometry.plotH}
                stroke="var(--ds-line)"
                strokeWidth="1"
                strokeDasharray={f === 1 ? undefined : '3 4'}
              />
            ))}

            <path d={geometry.area} fill="url(#ds-rev-fill)" />
            <path d={geometry.d} fill="none" stroke="var(--ds-pos)" strokeWidth="2" strokeLinecap="round" />

            {/* Crosshair sits under the markers so the active dot reads on top. */}
            {activePoint && (
              <line
                x1={activePoint[0]}
                x2={activePoint[0]}
                y1={PAD.t}
                y2={geometry.baseY}
                stroke="var(--ds-accent)"
                strokeWidth="1"
                strokeDasharray="2 3"
                opacity="0.7"
              />
            )}

            {geometry.pts.map(([x, y], i) => (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={i === active ? 4 : 2.6}
                fill="white"
                stroke={i === active ? 'var(--ds-accent)' : 'var(--ds-pos)'}
                strokeWidth={i === active ? 2.2 : 1.8}
              />
            ))}
          </svg>

          {/* Tooltip is HTML, not SVG, so text is selectable and never
              squashed by the viewBox scaling. */}
          {activePoint && activeSeries && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-ds-inverse text-white px-2 py-1.5 shadow-ds-lift whitespace-nowrap"
              style={{ left: `${(activePoint[0] / W) * 100}%`, top: `${(activePoint[1] / H) * 100}%` }}
            >
              <div className="text-[9px] text-white/60">{activeSeries.label}</div>
              <div className="text-[11px] font-bold tabular-nums">
                PKR {Math.round(activeSeries.value).toLocaleString()}
              </div>
              {pinned === active && (
                <div className="text-[8px] text-white/50 mt-0.5">pinned · click to release</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between mt-1 text-[9px] text-ds-muted" aria-hidden="true">
        {series.map((p, i) => (
          <span key={p.label + i} className={i === active ? 'text-ds-accent font-bold' : undefined}>
            {i === 0 || i === series.length - 1 || i === Math.floor(series.length / 2) ? p.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
};

export const RevenueCollections: React.FC<{
  revenue: RevenueSummary;
  onInvoices: () => void;
}> = ({ revenue, onInvoices }) => {
  const periodLabel = revenue.isFallbackPeriod
    ? `Last billed month (${revenue.monthLabel})`
    : `This month (${revenue.monthLabel})`;

  const empty = revenue.billed === 0;

  // Shares are computed from the three parts, so they always sum to 100% even
  // when one of them is zero — the reference bar reads as one whole.
  const collectedShare = revenue.billed > 0 ? revenue.collected / revenue.billed : 0;
  const outstandingShare = revenue.billed > 0 ? revenue.outstanding / revenue.billed : 0;
  const overdueShare = revenue.billed > 0 ? revenue.overdue / revenue.billed : 0;

  const legend = [
    { key: 'collected', label: 'Collected', value: revenue.collected, pct: revenue.collectedPct, dot: 'bg-ds-pos' },
    { key: 'outstanding', label: 'Outstanding', value: revenue.outstanding, pct: revenue.outstandingPct, dot: 'bg-ds-warn' },
    { key: 'overdue', label: 'Overdue', value: revenue.overdue, pct: revenue.overduePct, dot: 'bg-ds-risk' },
  ];

  return (
    <section className="ds-panel p-5 ds-enter" data-purpose="revenue-collections">
      <PanelHead icon={DollarSign} tone="pos" title="Revenue & Collections" />

      <div className="flex items-center justify-between gap-2 mt-3">
        <p className="text-[11px] text-ds-body truncate">{periodLabel}</p>
        <span className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-ds-line bg-white text-[11px] font-semibold text-ds-ink-soft">
          This Month
          <ChevronDown className="w-3 h-3 text-ds-muted" />
        </span>
      </div>

      {empty ? (
        <Empty
          message="Nothing billed in this period"
          hint="Invoices appear here the day a case is registered."
        />
      ) : (
        <>

      <div className="mt-3 grid grid-cols-1 2xl:grid-cols-2 gap-4">
        <div className="min-w-0">
          <div className="ds-figure text-[24px] leading-none">
            {revenue.billed > 0 ? `PKR ${Math.round(revenue.billed).toLocaleString()}` : EM}
          </div>
          <p className="text-[11px] mt-1.5 font-semibold text-ds-pos-ink flex items-center gap-1">
            {revenue.momPct === null ? (
              <span className="text-ds-muted font-medium">No prior month to compare</span>
            ) : (
              <>
                <TrendingUp className="w-3 h-3" strokeWidth={2.4} />
                {revenue.momPct >= 0 ? '↑' : '↓'} {Math.abs(revenue.momPct)}% vs previous month
              </>
            )}
          </p>

          <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100 mt-3" role="img" aria-label="Collection split">
            <span className="bg-ds-pos" style={{ width: `${collectedShare * 100}%` }} />
            <span className="bg-ds-warn" style={{ width: `${outstandingShare * 100}%` }} />
            <span className="bg-ds-risk" style={{ width: `${overdueShare * 100}%` }} />
          </div>

          <dl className="mt-3 space-y-1.5">
            {legend.map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-2 text-[11px]">
                <dt className="flex items-center gap-1.5 text-ds-body min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${row.dot}`} />
                  <span className="truncate">{row.label}</span>
                </dt>
                <dd className="ds-figure text-[11px] font-bold whitespace-nowrap">
                  PKR {Math.round(row.value).toLocaleString()}
                  {row.pct !== null && <span className="text-ds-muted font-medium"> ({row.pct}%)</span>}
                </dd>
              </div>
            ))}
          </dl>

          <button type="button" onClick={onInvoices} className="ds-link mt-3">
            Open receivables <ArrowRight className="w-3 h-3 inline -mt-0.5" />
          </button>
        </div>

        <div className="min-w-0 2xl:border-l 2xl:border-ds-line 2xl:pl-4">
          <RevenueChart series={revenue.series} />
        </div>
      </div>
      </>
      )}
    </section>
  );
};

/* ── 6 · Cases at risk ────────────────────────────────────────────────── */

const RISK_TONE: Record<RiskLevel, Tone> = {
  Behind: 'risk',
  'At Risk': 'warn',
  'On Track': 'pos',
};

/** "Due today" / "Due in 3d" / "2d overdue" — one clause, never two. The chip
 *  beside it already says the level, so this line carries only the timing. */
const dueClause = (level: RiskLevel, daysOut: number) => {
  if (level === 'Behind') return `${Math.abs(daysOut)}d overdue`;
  return daysOut === 0 ? 'Due today' : `Due in ${daysOut}d`;
};

const RISK_ICON: Record<RiskLevel, LucideIcon> = {
  Behind: Clock,
  'At Risk': AlertTriangle,
  'On Track': CheckCircle2,
};

export const CasesAtRisk: React.FC<{ rows: RiskRow[]; onOpenCase: (id: string) => void }> = ({
  rows,
  onOpenCase,
}) => (
  <section className="ds-panel p-5 ds-enter" data-purpose="cases-at-risk">
    <PanelHead icon={ShieldAlert} tone="risk" title="Cases At Risk" />

    {rows.length === 0 ? (
      <Empty message="Nothing at risk" hint="Every open case is tracking to its promised date." />
    ) : (
      <ul className="mt-3.5 space-y-3">
        {rows.map((row) => {
          const Icon = RISK_ICON[row.level];
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onOpenCase(row.id)}
                className="w-full flex items-center gap-2.5 text-left cursor-pointer group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-accent rounded"
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${TONE_ICON_BG[RISK_TONE[row.level]]}`}>
                  <Icon className="w-3.5 h-3.5" strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5 min-w-0">
                    <span className="text-[11.5px] font-bold text-ds-ink group-hover:underline shrink-0">
                      {row.caseNumber}
                    </span>
                    <span className="text-[11px] text-ds-body truncate">{row.caseType}</span>
                  </span>
                  <span className="block text-[10.5px] text-ds-muted truncate">
                    {row.doctor} · {dueClause(row.level, row.daysOut)}
                  </span>
                </span>
                <Chip tone={RISK_TONE[row.level]}>{row.level}</Chip>
              </button>
            </li>
          );
        })}
      </ul>
    )}
  </section>
);

/* ── 7 · Recent activity ──────────────────────────────────────────────── */

const ACTIVITY_ICON: Record<ActivityRow['tone'], LucideIcon> = {
  accent: Package,
  qc: FlaskConical,
  pos: Wallet,
  warn: PackageCheck,
  risk: AlertTriangle,
};

export const RecentActivity: React.FC<{ rows: ActivityRow[] }> = ({ rows }) => (
  <section className="ds-panel p-5 ds-enter" data-purpose="recent-activity">
    <PanelHead icon={Zap} tone="warn" title="Recent Activity" />

    {rows.length === 0 ? (
      <Empty message="No activity yet" hint="Case movements appear here as work happens." />
    ) : (
      <ul className="mt-3.5 space-y-3">
        {rows.map((row) => {
          const Icon = ACTIVITY_ICON[row.tone];
          return (
            <li key={row.id} className="flex items-start gap-2.5">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${TONE_ICON_BG[row.tone]}`}>
                <Icon className="w-3.5 h-3.5" strokeWidth={2.2} />
              </span>
              <span className="min-w-0">
                <span className="block text-[11.5px] font-semibold text-ds-ink truncate">{row.text}</span>
                <span className="block text-[10.5px] text-ds-muted">{formatTimeAgo(row.stamp)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    )}
  </section>
);

/* ── 8 · Quick actions ────────────────────────────────────────────────── */

export interface QuickAction {
  key: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  tone: Tone;
  onClick: () => void;
}

export const QuickActions: React.FC<{ actions: QuickAction[] }> = ({ actions }) => (
  <section className="ds-panel p-5 ds-enter" data-purpose="quick-actions">
    <PanelHead icon={Zap} tone="warn" title="Quick Actions" subtitle="Get things done, faster" />

    <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.key}
            type="button"
            onClick={action.onClick}
            className="ds-tap group flex items-center gap-2.5 rounded-xl border border-ds-line bg-white px-2.5 py-2 text-left cursor-pointer hover:border-ds-accent-ring hover:bg-ds-accent-soft/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-accent"
          >
            <span className={`ds-icon-tile !w-8 !h-8 rounded-lg ${TONE_ICON_BG[action.tone]}`}>
              <Icon className="w-4 h-4" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11.5px] font-bold text-ds-ink truncate">{action.label}</span>
              <span className="block text-[10px] text-ds-muted truncate">{action.hint}</span>
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-ds-muted shrink-0 group-hover:text-ds-accent transition-colors" />
          </button>
        );
      })}
    </div>
  </section>
);

/* ── 9 · Workload ─────────────────────────────────────────────────────── */

export const Workload: React.FC<{
  rows: WorkloadRow[];
  overallPct: number | null;
}> = ({ rows, overallPct }) => (
  <section className="ds-panel p-5 ds-enter" data-purpose="workload">
    <PanelHead icon={Gauge} title="Workload by Material" subtitle="Share of cases on the bench" />

    {rows.length === 0 ? (
      <Empty message="No active cases" hint="Start a case to see bench utilisation." />
    ) : (
      <>
        <ul className="mt-3.5 space-y-2.5">
          {rows.map((row) => (
            <li key={row.label}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] text-ds-body truncate" title={row.label}>
                {row.label}
              </span>
                <span className="ds-figure text-[11px] shrink-0">{row.pct}%</span>
              </div>
              <div className="ds-meter-track">
                <span
                  className={`ds-meter-fill ${TONE_BAR[row.tone]}`}
                  style={{ width: `${Math.max(row.pct, 2)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4 pt-3 border-t border-ds-line">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[11px] font-bold text-ds-ink-soft">Due within 7 days</span>
            <span className="ds-figure text-[11px] shrink-0">{overallPct === null ? EM : `${overallPct}%`}</span>
          </div>
          <div className="ds-meter-track">
            <span
              className="ds-meter-fill bg-ds-accent"
              style={{ width: `${Math.max(overallPct ?? 0, 2)}%` }}
            />
          </div>
        </div>
      </>
    )}
  </section>
);

/* ── 10 · Lab performance ─────────────────────────────────────────────── */

export const LabPerformance: React.FC<{ rows: PerformanceRow[] }> = ({ rows }) => {
  /* Only metrics with a basis. The mock showed seven filled rows; a new
     install can fill two or three, and padding the rest with em dashes made
     the panel look broken rather than sparse. The count in the subtitle tells
     the reader a short list is the whole truth, not a failed load. */
  const supported = rows.filter((r) => r.supported);

  return (
    <section className="ds-panel p-5 ds-enter" data-purpose="lab-performance">
      <PanelHead
        icon={Activity}
        title="Lab Performance"
        subtitle={
          supported.length === rows.length
            ? 'This month'
            : `${supported.length} of ${rows.length} · this month`
        }
      />

      {supported.length === 0 ? (
        <Empty message="Nothing completed yet" hint="Metrics appear once cases are delivered." />
      ) : (
        <dl className="mt-3.5 space-y-2">
          {supported.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 text-[11.5px]">
              <dt className="text-ds-body truncate">{row.label}</dt>
              <dd className="ds-figure text-[11.5px] font-bold truncate max-w-[52%]" title={row.value}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
};

/* ── 11 · Upcoming deliveries ─────────────────────────────────────────── */

export const UpcomingDeliveries: React.FC<{
  rows: UpcomingRow[];
  onOpenCase: (id: string) => void;
}> = ({ rows, onOpenCase }) => (
  <section className="ds-panel p-5 ds-enter" data-purpose="upcoming-deliveries">
    <PanelHead icon={Send} tone="dispatch" title="Upcoming Deliveries" />

    {rows.length === 0 ? (
      <Empty message="No open deliveries" hint="Schedule a delivery date on an active case." />
    ) : (
      <ul className="mt-3.5 space-y-3">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onOpenCase(row.id)}
              className="w-full flex items-center gap-2.5 text-left cursor-pointer group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-accent rounded"
            >
              <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-ds-dispatch-soft text-ds-dispatch">
                <Clock className="w-3.5 h-3.5" strokeWidth={2.2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5 min-w-0">
                  <span className="text-[11.5px] font-bold text-ds-ink group-hover:underline shrink-0">
                    {row.caseNumber}
                  </span>
                  <span className="text-[11px] text-ds-body truncate">{row.patient}</span>
                </span>
                {/* Date, not clock: Today's Schedule already owns the time-of-day rail,
                    and repeating it here crowds out the case name. */}
                <span className="block text-[10.5px] text-ds-muted truncate" title={`${row.caseType} • ${row.dateLabel}`}>
                  {row.caseType} • {row.dateLabel}
                </span>
              </span>
              <Chip tone={row.tone}>{row.status}</Chip>
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
);

/* ── 12 · Closing brand bar ───────────────────────────────────────────── */

/** Tooth mark. Drawn rather than imported because no icon set ships a molar,
 *  and an emoji is not an acceptable substitute for brand artwork. */
const ToothMark: React.FC = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12 shrink-0" aria-hidden="true">
    <path
      d="M24 6c-4.2 0-6.1-2-9.6-2C9 4 5 8.2 5 14.4c0 6.1 2.2 9.5 3.6 15.3C9.8 35.4 11 42 14.4 42c2.9 0 3.6-3.4 4.4-7.6.8-4 1.7-7.4 5.2-7.4s4.4 3.4 5.2 7.4C30 38.6 30.7 42 33.6 42 37 42 38.2 35.4 39.4 29.7 40.8 23.9 43 20.5 43 14.4 43 8.2 39 4 33.6 4 30.1 4 28.2 6 24 6Z"
      fill="currentColor"
    />
  </svg>
);

export const BrandBar: React.FC = () => (
  <footer
    className="rounded-2xl bg-ds-inverse text-white px-5 py-4 flex flex-wrap items-center gap-4 justify-between"
    data-purpose="brand-bar"
  >
    <div className="flex items-center gap-4 min-w-0">
      <span className="text-white/90">
        <ToothMark />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-bold tracking-[-0.01em]">
          Better Smiles <span className="text-white/40">•</span> Better Together
        </p>
        <p className="text-[10.5px] text-white/50 truncate">
          Precision. Quality. Your Trusted Dental Lab Partner.
        </p>
      </div>
    </div>
    <p className="text-[10.5px] text-white/45 flex items-center gap-2 whitespace-nowrap">
      <span>Quality Restorations</span>
      <span className="text-white/25">|</span>
      <span>On Time</span>
      <span className="text-white/25">|</span>
      <span>Every Time</span>
    </p>
  </footer>
);

export type { DashboardMetrics };