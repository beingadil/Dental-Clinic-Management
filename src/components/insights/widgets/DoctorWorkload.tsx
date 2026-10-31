import React from 'react';
import { pkr, pkrCompact } from '../chartTheme';
import type { DoctorRadar } from '../../../services/insightsDomain';

interface Props {
  data: DoctorRadar;
}

const MONO_TONES: [string, string][] = [
  ['#4338ca', '#0e7490'],
  ['#6d28d9', '#4f46e5'],
  ['#0f766e', '#0369a1'],
  ['#9d174d', '#4c1d95'],
  ['#1e3a8a', '#7c3aed'],
  ['#0f766e', '#134e4a'],
];

const initialsOf = (value: string): string =>
  value
    .replace(/^dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '—';

export const DoctorWorkload: React.FC<Props> = ({ data }) => {
  const rows = data.items.slice(0, 5);
  const maxCases = Math.max(1, ...rows.map((row) => row.cases));
  const remaining = Math.max(0, data.items.length - rows.length);

  if (rows.length === 0) {
    return (
      <div className="flex h-full min-h-[190px] items-center justify-center">
        <p className="text-[10.5px] font-semibold text-ink-muted">No doctor activity in this period.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {rows.map((row, index) => {
        const meter = Math.round((row.cases / maxCases) * 100);
        const [from, to] = MONO_TONES[index % MONO_TONES.length];

        return (
          <div key={row.doctor} className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="insight-monogram h-8 w-8 text-[9px] font-bold text-white"
              style={{ '--mono-a': from, '--mono-b': to } as React.CSSProperties}
            >
              {initialsOf(row.doctor)}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-[11px] font-bold leading-tight text-ds-ink" title={row.doctor}>
                  {row.doctor}
                </p>
                <span className="shrink-0 font-mono text-[9px] font-bold text-ink-muted">
                  {row.cases} case{row.cases === 1 ? '' : 's'}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="insight-rail-track h-[5px] flex-1">
                  <span
                    className="insight-rail-fill insight-rail-fill--doctor"
                    style={{ width: `${meter}%` }}
                  />
                </div>
                <span
                  className="w-10 shrink-0 text-right font-mono text-[9px] text-ink-muted"
                  title={pkr(row.revenue)}
                >
                  {pkrCompact(row.revenue)}
                </span>
              </div>
            </div>
          </div>
        );
      })}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-ds-line/35 pt-2.5">
        <span className="text-[9px] font-semibold text-ink-muted">
          {remaining > 0 ? `+${remaining} more in this period` : 'All doctors shown'}
        </span>
        <span className="text-[9px] font-semibold text-ink-muted">Revenue = case value</span>
      </div>
    </div>
  );
};
