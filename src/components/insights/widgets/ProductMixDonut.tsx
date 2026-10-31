import React, { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { CHART_COLORS, GlassTooltip } from '../chartTheme';
import type { ProductMix } from '../../../services/insightsDomain';

interface Props { mix: ProductMix; }

export const ProductMixDonut: React.FC<Props> = ({ mix }) => {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = mix.items.filter((d) => !hidden.has(d.name));
  const data = visible.length ? visible : [{ name: 'No data', value: 1, color: CHART_COLORS.muted }];
  const total = visible.reduce((s, d) => s + d.value, 0) || mix.total;
  return (
    <div className="flex flex-col md:flex-row items-center gap-5">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={74} paddingAngle={2} stroke="none">
              {data.map((d, i) => <Cell key={i} fill={d.color} className="transition-all duration-300 cursor-pointer" />)}
            </Pie>
            <GlassTooltip formatter={(v: any) => `PKR ${new Intl.NumberFormat('en-PK').format(Math.round(Number(v)))}`} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Total</span>
          <span className="text-base font-extrabold text-ds-ink tracking-tight">PKR {new Intl.NumberFormat('en-PK').format(Math.round(total))}</span>
        </div>
      </div>
      <div className="flex-1 min-w-0 space-y-1.5 w-full">
        {mix.items.map((d) => {
          const isHidden = hidden.has(d.name);
          return (
            <button
              key={d.name}
              type="button"
              onClick={() => setHidden((s) => {
                const n = new Set(s);
                if (n.has(d.name)) n.delete(d.name); else n.add(d.name);
                return n;
              })}
              className={`w-full flex items-center gap-2 text-xs rounded-lg px-2 py-1.5 transition-all ${isHidden ? 'opacity-40' : 'hover:bg-ds-surface/60'}`}
            >
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: d.color }} />
              <span className="truncate font-semibold text-ds-ink">{d.name}</span>
              <span className="ml-auto font-mono font-bold text-ink-muted">{mix.total > 0 ? Math.round((d.value / mix.total) * 100) : 0}%</span>
              <span className="font-mono text-[10px] text-ink-muted w-16 text-right">{new Intl.NumberFormat('en-PK').format(Math.round(d.value))}</span>
            </button>
          );
        })}
        {mix.items.length === 0 && <p className="text-xs font-semibold text-ink-muted">No invoices in this period.</p>}
      </div>
    </div>
  );
};
