import React, { useId } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { CHART_COLORS, pkr } from '../chartTheme';
import type { ClinicStandings, FlowSeries, KpiMetrics } from '../../../services/insightsDomain';

const MONEY = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });

interface DeltaProps {
  now: number;
  prev: number;
  compare: boolean;
  invert?: boolean;
}

const Delta: React.FC<DeltaProps> = ({ now, prev, compare, invert = false }) => {
  if (!compare) {
    return <span className="text-[10px] font-semibold text-ink-muted">current period</span>;
  }

  if (prev === 0 && now === 0) {
    return <span className="text-[10px] font-semibold text-ink-muted">no change</span>;
  }

  const pct = prev > 0 ? Math.round(((now - prev) / prev) * 100) : now > 0 ? 100 : 0;
  const up = now >= prev;
  const good = invert ? !up : up;
  const Icon = up ? TrendingUp : TrendingDown;
  const tone = good ? 'text-emerald-600' : 'text-rose-600';

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-ds-surface/60 px-2 py-1 text-[10px] font-bold ${tone}`}
    >
      <Icon className="h-3 w-3" strokeWidth={1.8} aria-hidden />
      <span className="font-mono">
        {up ? '+' : ''}
        {pct}%
      </span>
    </span>
  );
};

const initialsOf = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '—';

const BALANCE_TONES = [
  CHART_COLORS.indigoSoft,
  CHART_COLORS.cyanSoft,
  CHART_COLORS.mint,
  CHART_COLORS.lavender,
  CHART_COLORS.sky,
];

interface InvoicedProps {
  metrics: KpiMetrics;
  collectionRate: number;
  compare: boolean;
}

/**
 * The top-left readout: the invoiced figure and three rails answering
 * "of that money, how much landed, how much is open, how much do we collect".
 */
export const InvoicedMetric: React.FC<InvoicedProps> = ({ metrics, collectionRate, compare }) => {
  const collectedPct = metrics.invoiced > 0 ? Math.round((metrics.collected / metrics.invoiced) * 100) : 0;
  const outstandingPct = metrics.invoiced > 0 ? Math.round((metrics.outstanding / metrics.invoiced) * 100) : 0;
  const average = metrics.cases > 0 ? metrics.invoiced / metrics.cases : 0;

  const rails: { label: string; pct: number; tone: string }[] = [
    { label: 'Collected', pct: collectedPct, tone: 'insight-rail-fill--c' },
    { label: 'Outstanding', pct: outstandingPct, tone: 'insight-rail-fill--b' },
    { label: 'Collection rate', pct: Math.min(100, Math.max(0, collectionRate)), tone: 'insight-rail-fill--a' },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="ds-figure text-[clamp(1.7rem,2.5vw,2.35rem)] leading-none tracking-[-0.045em] text-ds-ink">
            <span className="mr-1.5 align-[0.2em] text-[9px] font-bold uppercase tracking-[0.16em] text-ink-muted">PKR</span>
            {MONEY.format(Math.round(metrics.invoiced))}
          </p>
          <p className="mt-1.5 text-[10.5px] font-semibold text-ink-muted">
            {metrics.cases} cases · avg {pkr(average)}
          </p>
        </div>
        <Delta now={metrics.invoiced} prev={metrics.invoicedPrev} compare={compare} />
      </div>

      <div className="mt-auto space-y-2.5 pt-4">
        {rails.map((rail) => (
          <div key={rail.label}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold text-ink-muted">{rail.label}</span>
              <span className="font-mono text-[10px] font-bold tabular-nums text-ds-ink">{rail.pct}%</span>
            </div>
            <div className="insight-rail-track mt-1.5">
              <span
                className={`insight-rail-fill ${rail.tone}`}
                style={{ width: `${Math.min(100, Math.max(0, rail.pct))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

interface CollectedProps {
  metrics: KpiMetrics;
  flow: FlowSeries;
  compare: boolean;
}

/** The top-middle readout: cash landed, with the period's shape beneath it. */
export const CollectedMetric: React.FC<CollectedProps> = ({ metrics, flow, compare }) => {
  const gradientId = `collected-${useId().replace(/:/g, '')}`;
  const collectedPct = metrics.invoiced > 0 ? Math.round((metrics.collected / metrics.invoiced) * 100) : 0;
  const raw = flow.points.map((point, index) => ({ i: index, value: point.collected }));
  const data = raw.length > 1 ? raw : [{ i: 0, value: 0 }, { i: 1, value: metrics.collected }];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="ds-figure text-[clamp(1.7rem,2.5vw,2.35rem)] leading-none tracking-[-0.045em] text-ds-ink">
            <span className="mr-1.5 align-[0.2em] text-[9px] font-bold uppercase tracking-[0.16em] text-ink-muted">PKR</span>
            {MONEY.format(Math.round(metrics.collected))}
          </p>
          <p className="mt-1.5 text-[10.5px] font-semibold text-ink-muted">against {pkr(metrics.invoiced)} invoiced</p>
        </div>
        <Delta now={metrics.collected} prev={metrics.collectedPrev} compare={compare} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-ds-surface/70 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-ink-muted">
          {collectedPct}% collected
        </span>
      </div>

      {metrics.collected > 0 ? (
        <div className="mt-auto h-[74px] w-full pt-2" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.mint} stopOpacity={0.42} />
                  <stop offset="100%" stopColor={CHART_COLORS.cyan} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={CHART_COLORS.mint}
                strokeWidth={2.2}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={false}
                isAnimationActive
                animationDuration={900}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-auto flex h-[74px] items-center justify-center rounded-xl border border-dashed border-ds-line/45">
          <p className="text-[10px] font-semibold text-ink-muted">No collections recorded yet.</p>
        </div>
      )}
    </div>
  );
};

interface OutstandingProps {
  metrics: KpiMetrics;
  standings: ClinicStandings;
  compare: boolean;
}

/** The reference's navy spotlight: an oversized open balance and thin clinic bars. */
export const OutstandingMetric: React.FC<OutstandingProps> = ({ metrics, standings, compare }) => {
  const pct = metrics.invoiced > 0 ? Math.round((metrics.outstanding / metrics.invoiced) * 100) : 0;
  const rows = standings.rows
    .filter((row) => row.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 5);
  const max = Math.max(1, ...rows.map((row) => row.balance));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="ds-figure text-[clamp(1.7rem,2.5vw,2.35rem)] leading-none tracking-[-0.045em] text-ds-ink">
            <span className="mr-1.5 align-[0.2em] text-[9px] font-bold uppercase tracking-[0.16em] text-ink-muted">PKR</span>
            {MONEY.format(Math.round(metrics.outstanding))}
          </p>
          <p className="mt-1.5 text-[10.5px] font-semibold text-ink-muted">
            {pct}% of invoiced is still open
          </p>
        </div>
        <Delta now={metrics.outstanding} prev={metrics.outstandingPrev} compare={compare} invert />
      </div>

      {rows.length > 0 ? (
        <div className="mt-auto flex h-[98px] items-end gap-2 pt-4">
          {rows.map((row, index) => (
            <div
              key={row.id}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
              title={`${row.name}: ${pkr(row.balance)}`}
            >
              <div className="flex w-full flex-1 items-end justify-center">
                <span
                  className="insight-mini-bar"
                  style={{
                    height: `${Math.max(10, Math.round((row.balance / max) * 100))}%`,
                    '--bar': BALANCE_TONES[index % BALANCE_TONES.length],
                  } as React.CSSProperties}
                />
              </div>
              <span className="w-full truncate text-center text-[8px] font-bold uppercase tracking-[0.08em] text-ink-muted">
                {initialsOf(row.name)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-auto flex h-[98px] items-end pb-2">
          <p className="w-full border-t border-ds-line/40 pt-3 text-center text-[10.5px] font-semibold text-ink-muted">
            No open balances in this period.
          </p>
        </div>
      )}
    </div>
  );
};
