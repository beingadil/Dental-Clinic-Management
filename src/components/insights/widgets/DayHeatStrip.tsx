import React, { useState } from 'react';
import type { DayHeat } from '../../../services/insightsDomain';
import { CHART_COLORS } from '../chartTheme';

interface Props { heat: DayHeat; }

export const DayHeatStrip: React.FC<Props> = ({ heat }) => {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...heat.days.map((d) => d.count));
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-2 h-24">
        {heat.days.map((d) => {
          const h = Math.max(8, Math.round((d.count / max) * 72));
          const intense = d.count / max > 0.6;
          const isHover = hover === d.dow;
          return (
            <div
              key={d.dow}
              className="flex flex-col items-center gap-1 flex-1 cursor-default"
              onMouseEnter={() => setHover(d.dow)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className="w-full rounded-lg transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
                style={{
                  height: h,
                  background: intense
                    ? `linear-gradient(180deg, ${CHART_COLORS.primary}, ${CHART_COLORS.violet})`
                    : `${CHART_COLORS.primary}40`,
                  transform: isHover ? 'scaleY(1.08)' : 'scaleY(1)',
                  transformOrigin: 'bottom',
                  boxShadow: isHover ? '0 4px 12px rgba(99,102,241,0.35)' : 'none',
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2">
        {heat.days.map((d) => (
          <div key={d.dow} className="flex-1 text-center">
            <span className={`text-[10px] font-bold transition-colors ${hover === d.dow ? 'text-ds-ink' : 'text-ink-muted'}`}>{d.label}</span>
            <div className={`text-[10px] font-mono font-bold transition-all ${hover === d.dow ? 'text-ds-accent scale-110' : 'text-ink-muted'}`}>{d.count}</div>
          </div>
        ))}
      </div>
      {hover !== null && (
        <p className="text-[11px] font-semibold text-ink-muted text-center">
          {heat.days[hover].label}: {heat.days[hover].count} case{heat.days[hover].count === 1 ? '' : 's'} received
        </p>
      )}
    </div>
  );
};
