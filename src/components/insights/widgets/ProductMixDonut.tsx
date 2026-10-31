import React, { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { CHART_COLORS, CHART_PALETTE, GlassTooltip, pkr, pkrCompact } from '../chartTheme';
import type { ProductMix } from '../../../services/insightsDomain';

interface Props {
  mix: ProductMix;
}

export const ProductMixDonut: React.FC<Props> = ({ mix }) => {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const items = mix.items.map((item, index) => ({
    ...item,
    displayColor: CHART_PALETTE[index % CHART_PALETTE.length],
  }));

  const visible = items.filter((item) => !hidden.has(item.name));
  const visibleTotal = visible.reduce((total, item) => total + item.value, 0);
  const data = visible.length
    ? visible
    : [{ name: 'No data', value: 1, displayColor: CHART_COLORS.muted }];

  const toggle = (name: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  if (mix.items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 py-4">
        <div className="relative flex h-[158px] w-[158px] items-center justify-center">
          <div aria-hidden className="insight-donut-bloom absolute inset-0 rounded-full opacity-70" />
          <div className="relative flex h-[124px] w-[124px] items-center justify-center rounded-full border-[18px] border-[var(--insight-ring-track)]">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-muted">No mix</span>
          </div>
        </div>
        <p className="text-[10.5px] font-semibold text-ink-muted">No revenue mix in this period.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative mx-auto h-[158px] w-[158px] shrink-0">
        <div aria-hidden className="insight-donut-bloom absolute inset-0 rounded-full" />
        <div className="relative h-full w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={54}
                outerRadius={78}
                paddingAngle={3}
                cornerRadius={6}
                stroke="none"
                animationDuration={850}
              >
                {data.map((entry) => (
                  <Cell key={entry.name} fill={entry.displayColor} />
                ))}
              </Pie>
              <GlassTooltip formatter={(value: number) => pkr(Number(value))} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[8px] font-bold uppercase tracking-[0.16em] text-ink-muted">Total</span>
            <span className="ds-figure mt-0.5 text-[15px] leading-none text-ds-ink">{pkrCompact(visibleTotal)}</span>
            <span className="mt-1 text-[8px] font-semibold text-ink-muted">PKR</span>
          </div>
        </div>
      </div>

      <div className="insight-scroll mt-2 max-h-[124px] space-y-1 overflow-y-auto pr-0.5">
        {items.map((item) => {
          const off = hidden.has(item.name);
          return (
            <button
              key={item.name}
              type="button"
              onClick={() => toggle(item.name)}
              aria-pressed={!off}
              title={`${item.name}: ${pkr(item.value)}`}
              className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors ${
                off ? 'opacity-40' : 'hover:bg-ds-surface/60'
              }`}
            >
              <span
                aria-hidden
                className="chart-swatch h-2 w-2 shrink-0 rounded-full"
                style={{ '--swatch': item.displayColor } as React.CSSProperties}
              />
              <span className="truncate text-[10px] font-semibold text-ds-ink">{item.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[9px] font-bold text-ink-muted">
                {mix.total > 0 ? Math.round((item.value / mix.total) * 100) : 0}%
              </span>
              <span className="w-10 shrink-0 text-right font-mono text-[9px] text-ink-muted">
                {pkrCompact(item.value)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
