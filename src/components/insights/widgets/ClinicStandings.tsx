import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell } from 'recharts';
import { GRID_STROKE, AXIS_TICK, CHART_PALETTE } from '../chartTheme';
import type { ClinicStandings as ClinicStandingsData } from '../../../services/insightsDomain';

interface Props { data: ClinicStandingsData; }

export const ClinicStandings: React.FC<Props> = ({ data }) => {
  const rows = data.rows.slice(0, 6);
  const chart = rows.map((r) => ({ name: r.name.length > 14 ? r.name.slice(0, 14) + '…' : r.name, value: r.revenue, full: r.name }));
  if (chart.length === 0) return <p className="text-xs font-semibold text-ink-muted py-6 text-center">No clinic data.</p>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 26)}>
      <BarChart data={chart} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} width={96} />
        <Bar dataKey="value" radius={[0, 8, 8, 0]}>
          {chart.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

