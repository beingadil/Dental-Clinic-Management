import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { CHART_COLORS, GRID_STROKE, AXIS_TICK, GlassTooltip } from '../chartTheme';
import type { ThroughputSeries } from '../../../services/insightsDomain';

interface Props { series: ThroughputSeries; }

export const ThroughputBars: React.FC<Props> = ({ series }) => {
  const data = series.points.length ? series.points : [{ label: '—', received: 0, delivered: 0 }];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barGap={4}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={32} />
        <GlassTooltip />
        <Bar dataKey="received" name="Received" fill={CHART_COLORS.primary} radius={[6, 6, 0, 0]} />
        <Bar dataKey="delivered" name="Delivered" fill={CHART_COLORS.success} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
};

