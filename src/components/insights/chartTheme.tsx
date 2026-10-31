import React from 'react';
import { Tooltip } from 'recharts';

/*
 * The analytics spectrum is data colour, not brand chrome.
 *
 * The operator can pick any brand accent, so a chart series cannot borrow it:
 * a lime brand would make "invoiced" and "collected" indistinguishable. These
 * are the reference's periwinkle / cyan / mint family, held steady across both
 * themes so a swatch always names the same series. Interactive chrome still
 * uses `brand-*`.
 */
export const CHART_COLORS = {
  primary: '#6366f1',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#f43f5e',
  violet: '#8b5cf6',
  cyan: '#06b6d4',
  muted: '#64748b',
  pink: '#ec4899',
  indigoSoft: '#a5b4fc',
  cyanSoft: '#67e8f9',
  mint: '#34d399',
  lavender: '#c4b5fd',
  sky: '#60a5fa',
};

export const CHART_PALETTE = [
  CHART_COLORS.primary,
  CHART_COLORS.cyan,
  CHART_COLORS.mint,
  CHART_COLORS.violet,
  CHART_COLORS.sky,
  CHART_COLORS.warning,
  CHART_COLORS.pink,
  CHART_COLORS.muted,
];

export const GRID_STROKE = 'var(--chart-grid)';
export const AXIS_TICK = { fontSize: 10, fill: 'var(--chart-axis-ink)', fontWeight: 600 as const };

/* The dark feature card carries its own axis ink: the theme-aware chart token
   is dark in light mode, which would vanish on the navy pane. */
export const DARK_AXIS_TICK = { fontSize: 10, fill: '#cbd5e1', fontWeight: 600 as const };
export const DARK_GRID_STROKE = 'rgba(255, 255, 255, 0.1)';

const MONEY = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });

export const pkr = (value: number): string => `PKR ${MONEY.format(Math.round(value || 0))}`;

/** Axis-safe money: 324k / 1.2m, never a wall of digits inside the plot. */
export const pkrCompact = (value: number): string => {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 10_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${Math.round(n / 1_000)}k`;
  return MONEY.format(Math.round(n));
};

export const count = (value: number): string => MONEY.format(Math.round(value || 0));

type Formatter = (value: number, name: string) => string;

/**
 * The one tooltip surface for the module.
 *
 * It reads the existing `.chart-tooltip` token rule (index.css) instead of the
 * hardcoded white `contentStyle` the old widgets used, so the tooltip is dark
 * on dark and pale on light. The swatch dot uses `--swatch`; the surface itself
 * is never written inline.
 */
export const InsightTooltip = ({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; fill?: string; dataKey?: string; payload?: { color?: string } }>;
  label?: string | number;
  formatter?: Formatter;
}) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="chart-tooltip">
      {label !== undefined && label !== null && <p className="chart-tooltip-title">{label}</p>}
      {payload.map((entry, index) => {
        const swatch = entry.color || entry.fill || entry.payload?.color || CHART_COLORS.primary;
        const raw = Number(entry.value);
        return (
          <div className="chart-tip-row" key={`${entry.dataKey ?? entry.name ?? 'row'}-${index}`}>
            <span
              aria-hidden
              className="chart-swatch h-2 w-2 shrink-0 rounded-full"
              style={{ '--swatch': swatch } as React.CSSProperties}
            />
            <span className="chart-tip-key">{entry.name}</span>
            <span className="chart-tip-value">
              {formatter ? formatter(raw, String(entry.name ?? '')) : count(raw)}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/**
 * Recharts' Tooltip wrapper for every widget in the module.
 *
 * Keeping this as a component (rather than a style object) is what makes the
 * tooltip follow the theme switch for free; the old `GLASS_TOOLTIP_STYLE` froze
 * a white pane into every chart, including the dark cards.
 */
export const GlassTooltip: React.FC<Record<string, unknown>> = (props) => (
  <Tooltip
    {...props}
    content={<InsightTooltip formatter={props.formatter as Formatter | undefined} />}
    cursor={{ stroke: CHART_COLORS.primary, strokeDasharray: '3 3', strokeOpacity: 0.4 }}
  />
);
