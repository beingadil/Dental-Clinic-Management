import React from 'react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import { CHART_COLORS, GRID_STROKE } from '../chartTheme';
import type { DoctorRadar as DoctorRadarData } from '../../../services/insightsDomain';

interface Props { data: DoctorRadarData; }

export const DoctorRadar: React.FC<Props> = ({ data }) => {
  const rows = data.items.length ? data.items : [{ doctor: 'No data', cases: 0, revenue: 0 }];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <RadarChart data={rows} outerRadius="75%">
        <PolarGrid stroke={GRID_STROKE} />
        <PolarAngleAxis dataKey="doctor" tick={{ fontSize: 10, fill: '#64748b', fontWeight: 600 }} />
        <PolarRadiusAxis tick={false} axisLine={false} />
        <Radar name="Cases" dataKey="cases" stroke={CHART_COLORS.primary} fill={CHART_COLORS.primary} fillOpacity={0.25} />
        <Radar name="Revenue" dataKey="revenue" stroke={CHART_COLORS.success} fill={CHART_COLORS.success} fillOpacity={0.18} />
      </RadarChart>
    </ResponsiveContainer>
  );
};

