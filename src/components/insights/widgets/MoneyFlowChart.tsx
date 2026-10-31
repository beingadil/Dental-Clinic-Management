import React from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import { CHART_COLORS, GRID_STROKE, AXIS_TICK, GlassTooltip } from '../chartTheme';
import type { FlowSeries } from '../../../services/insightsDomain';

interface Props { series: FlowSeries; }

export const MoneyFlowChart: React.FC<Props> = ({ series }) => {
  const data = series.points.length ? series.points : [{ label: '—', invoiced: 0, collected: 0, ts: 0 }];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="gInvoiced" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.35} />
            <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gCollected" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS.success} stopOpacity={0.35} />
            <stop offset="100%" stopColor={CHART_COLORS.success} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
        <GlassTooltip formatter={(v: number) => `PKR ${new Intl.NumberFormat('en-PK').format(Math.round(v))}`} />
        <Area type="monotone" dataKey="invoiced" name="Invoiced" stroke={CHART_COLORS.primary} strokeWidth={2.5} fill="url(#gInvoiced)" />
        <Area type="monotone" dataKey="collected" name="Collected" stroke={CHART_COLORS.success} strokeWidth={2.5} fill="url(#gCollected)" />
      </AreaChart>
    </ResponsiveContainer>
  );
};

