import React, { useId } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import {
  CHART_COLORS,
  DARK_AXIS_TICK,
  GlassTooltip,
  count,
} from '../chartTheme';
import type { ThroughputSeries } from '../../../services/insightsDomain';

interface Props {
  series: ThroughputSeries;
}

export const ThroughputBars: React.FC<Props> = ({ series }) => {
  const id = useId().replace(/:/g, '');
  const data = series.points.length
    ? series.points
    : [{ label: '—', received: 0, delivered: 0 }];

  const received = series.points.reduce((total, point) => total + point.received, 0);
  const delivered = series.points.reduce((total, point) => total + point.delivered, 0);
  const deliveredRate = received > 0 ? Math.min(100, Math.round((delivered / received) * 100)) : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-ink-muted">
          <span
            aria-hidden
            className="chart-swatch h-2 w-2 rounded-full"
            style={{ '--swatch': CHART_COLORS.indigoSoft } as React.CSSProperties}
          />
          Received <span className="font-mono font-bold text-ds-ink">{count(received)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-ink-muted">
          <span
            aria-hidden
            className="chart-swatch h-2 w-2 rounded-full"
            style={{ '--swatch': CHART_COLORS.cyanSoft } as React.CSSProperties}
          />
          Delivered <span className="font-mono font-bold text-ds-ink">{count(delivered)}</span>
        </span>
        <span className="ml-auto rounded-full bg-ds-surface/60 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-ink-muted">
          {deliveredRate}% out
        </span>
      </div>

      <div className="relative mt-3 h-[250px] w-full xl:h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 0, left: -22, bottom: 0 }} barGap={4}>
            <defs>
              <linearGradient id={`tp-in-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.cyanSoft} stopOpacity={0.95} />
                <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0.35} />
              </linearGradient>
              <linearGradient id={`tp-out-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.mint} stopOpacity={0.95} />
                <stop offset="100%" stopColor={CHART_COLORS.cyan} stopOpacity={0.3} />
              </linearGradient>
            </defs>

            <CartesianGrid
              stroke="var(--insight-grid, rgba(71,85,105,0.18))"
              strokeDasharray="2 8"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ ...DARK_AXIS_TICK, fill: 'var(--insight-axis, #475569)' }}
              axisLine={false}
              tickLine={false}
              dy={6}
              interval="preserveStartEnd"
            />
            <YAxis hide />
            <GlassTooltip formatter={(value: number) => `${count(Number(value))} cases`} />
            <Bar
              dataKey="received"
              name="Received"
              fill={`url(#tp-in-${id})`}
              radius={[7, 7, 2, 2]}
              maxBarSize={9}
              animationDuration={900}
            />
            <Bar
              dataKey="delivered"
              name="Delivered"
              fill={`url(#tp-out-${id})`}
              radius={[7, 7, 2, 2]}
              maxBarSize={9}
              animationDuration={900}
            />
          </BarChart>
        </ResponsiveContainer>

        {series.points.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-[10.5px] font-semibold text-ink-muted">No throughput in this period.</p>
          </div>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-3">
        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-ink-muted">Delivered</span>
        <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-ds-line/35">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400"
            style={{ width: `${deliveredRate}%` }}
          />
        </div>
        <span className="font-mono text-[10px] font-bold text-ds-ink">{deliveredRate}%</span>
      </div>
    </div>
  );
};
