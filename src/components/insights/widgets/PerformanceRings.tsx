import React, { useId } from 'react';
import type { RingMetrics } from '../../../services/insightsDomain';

interface RingProps {
  value: number;
  size: number;
  stroke: number;
  label: string;
  from: string;
  to: string;
  gradientId: string;
}

const Ring: React.FC<RingProps> = ({ value, size, stroke, label, from, to, gradientId }) => {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const safe = Math.min(100, Math.max(0, value));
  const dash = (safe / 100) * circumference;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className="-rotate-90"
      role="img"
      aria-label={`${label}: ${value}%`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2={size} y2={size} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--insight-ring-track)"
        strokeWidth={stroke}
      />
      {safe > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: 'stroke-dasharray 700ms cubic-bezier(0.32,0.72,0,1)' }}
        />
      )}
    </svg>
  );
};

interface Props {
  metrics: RingMetrics;
}

export const PerformanceRings: React.FC<Props> = ({ metrics }) => {
  const base = useId().replace(/:/g, '');

  const satellites = [
    {
      key: 'delivery',
      label: 'Delivery',
      hint: 'delivered / cases',
      value: metrics.deliveryRate,
      from: '#34d399',
      to: '#67e8f9',
    },
    {
      key: 'revision',
      label: 'Revision',
      hint: 'revisions / cases',
      value: metrics.revisionRate,
      from: '#c4b5fd',
      to: '#f0abfc',
    },
  ];

  return (
    <div className="flex h-full flex-col justify-center gap-5 sm:flex-row sm:items-center">
      <div className="relative mx-auto shrink-0">
        <div aria-hidden className="insight-donut-bloom absolute inset-0 rounded-full opacity-80" />
        <div className="relative">
          <Ring
            value={metrics.collectionRate}
            size={138}
            stroke={12}
            label="Collection"
            from="#818cf8"
            to="#22d3ee"
            gradientId={`${base}-collection`}
          />
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="ds-figure text-[28px] leading-none tracking-[-0.05em] text-ds-ink">
              {metrics.collectionRate}%
            </span>
            <span className="mt-1 text-[8px] font-bold uppercase tracking-[0.16em] text-ink-muted">Collection</span>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {satellites.map((satellite) => (
          <div key={satellite.key} className="flex items-center gap-3">
            <Ring
              value={satellite.value}
              size={48}
              stroke={6}
              label={satellite.label}
              from={satellite.from}
              to={satellite.to}
              gradientId={`${base}-${satellite.key}`}
            />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-muted">
                  {satellite.label}
                </span>
                <span className="font-mono text-[11px] font-bold tabular-nums text-ds-ink">
                  {satellite.value}%
                </span>
              </div>
              <p className="mt-0.5 truncate text-[9px] font-semibold text-ink-muted">{satellite.hint}</p>
            </div>
          </div>
        ))}

        <p className="mt-1 text-[9.5px] font-semibold text-ink-muted">
          Across {metrics.totalCases} case{metrics.totalCases === 1 ? '' : 's'} in this period.
        </p>
      </div>
    </div>
  );
};
