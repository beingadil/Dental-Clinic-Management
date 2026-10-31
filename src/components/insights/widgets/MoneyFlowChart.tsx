import React, { useId } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { AXIS_TICK, CHART_COLORS, GRID_STROKE, GlassTooltip, pkr, pkrCompact } from '../chartTheme';
import type { FlowSeries, KpiMetrics } from '../../../services/insightsDomain';

interface Props {
  series: FlowSeries;
  metrics: KpiMetrics;
  compare: boolean;
}

const POINT_LABEL = (index: number, total: number) => {
  if (total <= 1) return 'This period';
  return index === total - 1 ? 'Now' : `T-${total - index - 1}`;
};

const shareOf = (value: number, total: number) => (total > 0 ? Math.round((value / total) * 100) : 0);

const deltaOf = (now: number, prev: number) => {
  if (prev === 0 && now === 0) return 'no change';
  if (prev <= 0) return now > 0 ? '+100%' : '0%';
  const pct = Math.round(((now - prev) / prev) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
};

export const MoneyFlowChart: React.FC<Props> = ({ series, metrics, compare }) => {
  const id = useId().replace(/:/g, '');
  const source = series.points.length
    ? series.points
    : [{ label: '—', invoiced: 0, collected: 0, ts: 0 }];

  let running = 0;
  const data = source.map((point, index) => {
    running += point.invoiced;
    return {
      label: series.points.length ? point.label : POINT_LABEL(index, source.length),
      invoiced: point.invoiced,
      collected: point.collected,
      outstanding: Math.max(0, point.invoiced - point.collected),
      cumulative: running,
    };
  });

  const collectionRate = metrics.invoiced > 0 ? Math.round((metrics.collected / metrics.invoiced) * 100) : 0;

  const rows = [
    {
      key: 'invoiced',
      label: 'Invoiced',
      amount: metrics.invoiced,
      prev: metrics.invoicedPrev,
      share: 100,
      swatch: CHART_COLORS.primary,
      invert: false,
    },
    {
      key: 'collected',
      label: 'Collected',
      amount: metrics.collected,
      prev: metrics.collectedPrev,
      share: shareOf(metrics.collected, metrics.invoiced),
      swatch: CHART_COLORS.mint,
      invert: false,
    },
    {
      key: 'outstanding',
      label: 'Open balance',
      amount: metrics.outstanding,
      prev: metrics.outstandingPrev,
      share: shareOf(metrics.outstanding, metrics.invoiced),
      swatch: CHART_COLORS.lavender,
      invert: true,
    },
  ] as const;

  return (
    <div className="flex h-full flex-col gap-4 md:flex-row">
      <div className="relative min-w-0 flex-1">
        <div aria-hidden className="insight-hero-bloom pointer-events-none absolute inset-x-2 bottom-2 top-4" />
        <div className="relative h-[272px] w-full xl:h-[312px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 6, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id={`flow-in-${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.55} />
                  <stop offset="58%" stopColor={CHART_COLORS.primary} stopOpacity={0.16} />
                  <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`flow-col-${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.mint} stopOpacity={0.38} />
                  <stop offset="100%" stopColor={CHART_COLORS.cyan} stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid stroke={GRID_STROKE} strokeDasharray="2 8" vertical={false} />
              <XAxis
                dataKey="label"
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                dy={6}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={48}
                tickFormatter={(value: number) => pkrCompact(value)}
              />
              <GlassTooltip formatter={(value: number) => pkr(Number(value))} />

              <Area
                type="monotone"
                dataKey="invoiced"
                name="Invoiced"
                stroke={CHART_COLORS.primary}
                strokeWidth={2.4}
                fill={`url(#flow-in-${id})`}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: CHART_COLORS.primary }}
                animationDuration={1000}
              />
              <Area
                type="monotone"
                dataKey="collected"
                name="Collected"
                stroke={CHART_COLORS.mint}
                strokeWidth={2.1}
                fill={`url(#flow-col-${id})`}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: CHART_COLORS.mint }}
                animationDuration={1000}
              />
              <Line
                type="monotone"
                dataKey="cumulative"
                name="Cumulative"
                stroke={CHART_COLORS.primary}
                strokeOpacity={0.22}
                strokeWidth={7}
                dot={false}
                activeDot={false}
              />
              <Line
                type="monotone"
                dataKey="cumulative"
                name="Cumulative"
                stroke="#eef2ff"
                strokeWidth={2.2}
                strokeLinecap="round"
                dot={false}
                activeDot={false}
              />
            </AreaChart>
          </ResponsiveContainer>

          {series.points.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="rounded-full bg-ds-surface/70 px-3 py-1.5 text-[10px] font-semibold text-ink-muted">
                No money movement in this period.
              </p>
            </div>
          )}
        </div>
      </div>

      <aside className="w-full shrink-0 md:w-[196px] xl:w-[214px]">
        <div className="rounded-2xl border border-white/55 bg-ds-surface/45 p-3 dark:border-white/10">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-ink-muted">This period</p>
            <span className="font-mono text-[9px] font-semibold text-ink-muted">{data.length} pts</span>
          </div>

          <div className="mt-3 space-y-3">
            {rows.map((row) => {
              const up = row.amount >= row.prev;
              const good = row.invert ? !up : up;
              return (
                <div key={row.key}>
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="chart-swatch h-2 w-2 shrink-0 rounded-full"
                      style={{ '--swatch': row.swatch } as React.CSSProperties}
                    />
                    <span className="truncate text-[10px] font-semibold text-ink-muted">{row.label}</span>
                    <span className="ml-auto font-mono text-[10px] font-bold tabular-nums text-ds-ink">
                      {pkrCompact(row.amount)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-ds-line/25">
                      <span
                        className={`insight-share insight-share--${row.key} block`}
                        style={{ width: `${row.share}%` }}
                      />
                    </div>
                    <span className="w-7 shrink-0 text-right font-mono text-[9px] font-bold text-ink-muted">
                      {row.share}%
                    </span>
                  </div>
                  {compare && (
                    <p
                      className={`mt-1 text-[9px] font-semibold ${
                        good ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {deltaOf(row.amount, row.prev)} vs previous
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-ds-line/40 pt-2.5">
            <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-ink-muted">Collection</span>
            <span className="font-mono text-[13px] font-bold tabular-nums text-ds-ink">{collectionRate}%</span>
          </div>
        </div>
      </aside>
    </div>
  );
};
