import React from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Tooltip, Line } from 'recharts';
import { CHART_COLORS, GRID_STROKE, AXIS_TICK } from '../chartTheme';
import type { FlowSeries } from '../../../services/insightsDomain';

interface Props { series: FlowSeries; }

const fmt = (v: number) => `PKR ${new Intl.NumberFormat('en-PK').format(Math.round(v))}`;

export const MoneyFlowChart: React.FC<Props> = ({ series }) => {
  const data = series.points.length ? series.points : [{ label: '—', invoiced: 0, collected: 0, ts: 0 }];
  // cumulative trend (running invoiced total) so the operator sees the trajectory
  let cum = 0;
  const withTrend = data.map((d) => { cum += d.invoiced; return { ...d, trend: cum }; });
  const totalInvoiced = data.reduce((s, d) => s + d.invoiced, 0);
  const totalCollected = data.reduce((s, d) => s + d.collected, 0);
  const first = data[0]?.invoiced ?? 0;
  const last = data[data.length - 1]?.invoiced ?? 0;
  const trendPct = first > 0 ? Math.round(((last - first) / first) * 100) : (last > 0 ? 100 : 0);
  const trendUp = last >= first;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-xs font-bold">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART_COLORS.primary }} /> Invoiced <span className="font-mono text-ink-muted">{fmt(totalInvoiced)}</span></span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART_COLORS.success }} /> Collected <span className="font-mono text-ink-muted">{fmt(totalCollected)}</span></span>
        <span className={`inline-flex items-center gap-1.5 ml-auto ${trendUp ? 'text-emerald-600' : 'text-rose-600'}`}>
          {trendUp ? '▲' : '▼'} {trendUp ? '+' : ''}{trendPct}% trend
        </span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={withTrend} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="gInvoiced" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.45} />
              <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gCollected" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.success} stopOpacity={0.45} />
              <stop offset="100%" stopColor={CHART_COLORS.success} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} />
          <Tooltip
            contentStyle={{ background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(12px)', border: '1px solid rgba(99,102,241,0.18)', borderRadius: 12, fontSize: 12, fontWeight: 600, color: '#0f172a', boxShadow: '0 8px 24px rgba(15,23,42,0.08)' }}
            formatter={(value: any, name: any) => [fmt(Number(value)), String(name)]}
            cursor={{ stroke: CHART_COLORS.primary, strokeDasharray: '3 3', strokeOpacity: 0.4 }}
          />
          <Area type="monotone" dataKey="invoiced" name="Invoiced" stroke={CHART_COLORS.primary} strokeWidth={2.5} fill="url(#gInvoiced)" animationDuration={900} />
          <Area type="monotone" dataKey="collected" name="Collected" stroke={CHART_COLORS.success} strokeWidth={2.5} fill="url(#gCollected)" animationDuration={900} />
          <Line type="monotone" dataKey="trend" name="Cumulative trend" stroke={CHART_COLORS.violet} strokeWidth={2} strokeDasharray="5 4" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
