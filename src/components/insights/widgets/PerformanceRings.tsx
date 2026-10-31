import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { CHART_COLORS } from '../chartTheme';
import type { RingMetrics } from '../../../services/insightsDomain';

interface Props { metrics: RingMetrics; }

const Ring: React.FC<{ value: number; label: string; color: string }> = ({ value, label, color }) => {
  const data = [{ v: value }, { v: Math.max(0, 100 - value) }];
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-20 w-20">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="v" innerRadius={26} outerRadius={34} startAngle={90} endAngle={-270} stroke="none">
              <Cell fill={color} />
              <Cell fill="rgba(148,163,184,0.15)" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-extrabold text-ds-ink">{value}%</span>
      </div>
      <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">{label}</span>
    </div>
  );
};

export const PerformanceRings: React.FC<Props> = ({ metrics }) => (
  <div className="flex items-center justify-around py-2">
    <Ring value={metrics.collectionRate} label="Collection" color={CHART_COLORS.success} />
    <Ring value={metrics.deliveryRate} label="Delivery" color={CHART_COLORS.primary} />
    <Ring value={metrics.revisionRate} label="Revision" color={CHART_COLORS.warning} />
  </div>
);

