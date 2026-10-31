import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { CHART_COLORS, GlassTooltip } from '../chartTheme';
import type { ProductMix } from '../../../services/insightsDomain';

interface Props { mix: ProductMix; }

export const ProductMixDonut: React.FC<Props> = ({ mix }) => {
  const data = mix.items.length ? mix.items : [{ name: 'No data', value: 1, color: CHART_COLORS.muted }];
  return (
    <div className="flex items-center gap-4">
      <div className="h-40 w-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={46} outerRadius={68} paddingAngle={2} stroke="none">
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <GlassTooltip formatter={(v: number) => `PKR ${new Intl.NumberFormat('en-PK').format(Math.round(v))}`} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: d.color }} />
            <span className="truncate font-semibold text-ds-ink">{d.name}</span>
            <span className="ml-auto font-mono font-bold text-ink-muted">{mix.total > 0 ? Math.round((d.value / mix.total) * 100) : 0}%</span>
          </div>
        ))}
        {mix.items.length === 0 && <p className="text-xs font-semibold text-ink-muted">No invoices in this period.</p>}
      </div>
    </div>
  );
};

