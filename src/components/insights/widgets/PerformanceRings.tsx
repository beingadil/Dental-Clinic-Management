import React, { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { CHART_COLORS } from '../chartTheme';
import type { RingMetrics } from '../../../services/insightsDomain';

interface Props { metrics: RingMetrics; }

const Ring: React.FC<{ value: number; label: string; color: string; hint: string }> = ({ value, label, color, hint }) => {
  const [hover, setHover] = useState(false);
  const data = [{ v: value }, { v: Math.max(0, 100 - value) }];
  return (
    <div
      className="flex flex-col items-center gap-2 cursor-default"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="relative h-24 w-24">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="v" innerRadius={30} outerRadius={40} startAngle={90} endAngle={-270} stroke="none" isAnimationActive>
              <Cell fill={color} />
              <Cell fill="rgba(148,163,184,0.15)" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <span
          className="absolute inset-0 flex items-center justify-center text-base font-extrabold text-ds-ink transition-transform duration-300"
          style={{ transform: hover ? 'scale(1.12)' : 'scale(1)' }}
        >
          {value}%
        </span>
      </div>
      <div className="text-center">
        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block">{label}</span>
        <span className={`text-[10px] font-semibold transition-opacity duration-200 ${hover ? 'opacity-100 text-ink-muted' : 'opacity-0'}`}>{hint}</span>
      </div>
    </div>
  );
};

export const PerformanceRings: React.FC<Props> = ({ metrics }) => (
  <div className="flex items-center justify-around py-3">
    <Ring value={metrics.collectionRate} label="Collection" color={CHART_COLORS.success} hint="collected / invoiced" />
    <Ring value={metrics.deliveryRate} label="Delivery" color={CHART_COLORS.primary} hint="delivered / total cases" />
    <Ring value={metrics.revisionRate} label="Revision" color={CHART_COLORS.warning} hint="revisions / total cases" />
  </div>
);
