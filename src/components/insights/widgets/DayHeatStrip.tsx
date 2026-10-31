import React, { useState } from 'react';
import type { DayHeat } from '../../../services/insightsDomain';

interface Props {
  heat: DayHeat;
}

export const DayHeatStrip: React.FC<Props> = ({ heat }) => {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...heat.days.map((day) => day.count));
  const peak = heat.days.reduce((best, day) => (day.count > best.count ? day : best), heat.days[0]);
  const focus = active !== null ? heat.days[active] : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center rounded-full bg-ds-surface/70 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-ink-muted">
          {heat.total} case{heat.total === 1 ? '' : 's'}
        </span>
        <span className="text-[9px] font-semibold text-ink-muted">
          Peak <span className="font-bold text-ds-ink">{peak?.label ?? '—'}</span>
        </span>
      </div>

      <div
        className="mt-4 flex flex-1 items-end justify-between gap-1.5"
        role="img"
        aria-label={heat.days.map((day) => `${day.label} ${day.count}`).join(', ')}
      >
        {heat.days.map((day) => {
          const height = Math.max(6, Math.round((day.count / max) * 84));
          const isPeak = day.dow === peak?.dow && max > 0;
          const isActive = active === day.dow;
          return (
            <div
              key={day.dow}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
              title={`${day.label}: ${day.count} case${day.count === 1 ? '' : 's'}`}
              onMouseEnter={() => setActive(day.dow)}
              onMouseLeave={() => setActive(null)}
            >
              <div className="flex h-[92px] w-full items-end justify-center">
                <div className="flex h-full w-[14px] items-end overflow-hidden rounded-full bg-ds-line/15">
                  <span
                    className={`insight-day-bar w-full ${isPeak ? 'insight-day-bar--peak' : ''}`}
                    style={{
                      height,
                      opacity: isActive || active === null ? 1 : 0.45,
                    }}
                  />
                </div>
              </div>
              <span
                className={`text-[9px] font-bold uppercase tracking-[0.06em] transition-colors ${
                  isActive ? 'text-ds-ink' : 'text-ink-muted'
                }`}
              >
                {day.label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-ds-line/35 pt-2.5">
        <span className="text-[9.5px] font-semibold text-ink-muted">
          {focus ? `${focus.label} · ${focus.count} received` : 'Cases received this period'}
        </span>
        <span className="font-mono text-[10px] font-bold text-ds-ink">{heat.total}</span>
      </div>
    </div>
  );
};
