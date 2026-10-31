import React from 'react';
import type { DayHeat } from '../../../services/insightsDomain';
import { CHART_COLORS } from '../chartTheme';

interface Props { heat: DayHeat; }

export const DayHeatStrip: React.FC<Props> = ({ heat }) => {
  const max = Math.max(1, ...heat.days.map((d) => d.count));
  return (
    <div className="flex items-end justify-between gap-2 pt-2">
      {heat.days.map((d) => {
        const h = Math.round((d.count / max) * 48) + 6;
        const intense = d.count / max > 0.6;
        return (
          <div key={d.dow} className="flex flex-col items-center gap-1.5 flex-1">
            <span className="text-[10px] font-bold text-ds-ink">{d.count}</span>
            <div
              className="w-full rounded-md transition-all"
              style={{ height: h, background: intense ? CHART_COLORS.primary : `${CHART_COLORS.primary}55` }}
            />
            <span className="text-[10px] font-bold text-ink-muted">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
};

