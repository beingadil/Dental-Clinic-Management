import React from 'react';
import { pkr, pkrCompact } from '../chartTheme';
import type { ClinicStandings as ClinicStandingsData } from '../../../services/insightsDomain';

interface Props {
  data: ClinicStandingsData;
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
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '—';

export const ClinicStandings: React.FC<Props> = ({ data }) => {
  const rows = data.rows.slice(0, 6);
  const totalRevenue = data.rows.reduce((total, row) => total + row.revenue, 0);
  const maxRevenue = Math.max(1, ...rows.map((row) => row.revenue));

  if (rows.length === 0) {
    return (
      <div className="flex h-full min-h-[190px] items-center justify-center">
        <p className="text-[10.5px] font-semibold text-ink-muted">No clinics have revenue in this period.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-1">
          <thead>
            <tr className="text-[8px] font-bold uppercase tracking-[0.14em] text-ink-muted">
              <th scope="col" className="pb-1 pl-1 text-left">Clinic</th>
              <th scope="col" className="pb-1 pr-1 text-right">Revenue</th>
              <th scope="col" className="hidden pb-1 pr-1 text-right sm:table-cell">Balance</th>
              <th scope="col" className="pb-1 pr-1 text-right">Cases</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const share = totalRevenue > 0 ? Math.round((row.revenue / totalRevenue) * 100) : 0;
              const meter = Math.round((row.revenue / maxRevenue) * 100);
              const [from, to] = MONO_TONES[index % MONO_TONES.length];

              return (
                <tr key={row.id} className="group/row">
                  <td className="rounded-l-xl py-2 pl-1 pr-2 transition-colors group-hover/row:bg-ds-surface/40">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden
                        className="insight-monogram h-8 w-8 text-[9px] font-bold text-white"
                        style={{ '--mono-a': from, '--mono-b': to } as React.CSSProperties}
                      >
                        {initialsOf(row.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-bold leading-tight text-ds-ink" title={row.name}>
                          {row.name}
                        </p>
                        <p className="mt-0.5 text-[9px] font-semibold text-ink-muted">{share}% of revenue</p>
                      </div>
                    </div>
                  </td>

                  <td className="py-2 pr-1 text-right transition-colors group-hover/row:bg-ds-surface/40">
                    <p className="font-mono text-[11px] font-bold tabular-nums text-ds-ink" title={pkr(row.revenue)}>
                      {pkrCompact(row.revenue)}
                    </p>
                    <div className="ml-auto mt-1 h-[3px] w-16 overflow-hidden rounded-full bg-ds-line/25">
                      <span
                        className="insight-share insight-share--invoiced block"
                        style={{ width: `${meter}%` }}
                      />
                    </div>
                  </td>

                  <td className="hidden py-2 pr-1 text-right transition-colors group-hover/row:bg-ds-surface/40 sm:table-cell">
                    <span
                      className={`font-mono text-[10.5px] font-bold tabular-nums ${
                        row.balance > 0 ? 'text-rose-600' : 'text-ink-muted'
                      }`}
                      title={row.balance > 0 ? pkr(row.balance) : 'Settled'}
                    >
                      {row.balance > 0 ? pkrCompact(row.balance) : '—'}
                    </span>
                  </td>

                  <td className="rounded-r-xl py-2 pr-1 text-right transition-colors group-hover/row:bg-ds-surface/40">
                    <span className="font-mono text-[10.5px] font-bold tabular-nums text-ds-ink">{row.cases}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-ds-line/35 pt-2.5">
        <span className="text-[9px] font-semibold text-ink-muted">Top {rows.length} by revenue</span>
        <span className="font-mono text-[9.5px] font-bold text-ink-muted">{pkr(totalRevenue)} total</span>
      </div>
    </div>
  );
};
