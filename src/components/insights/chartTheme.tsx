import React from 'react';
import { Tooltip } from 'recharts';

/* ds-aligned palette tuned for glass bento cards on both themes. */
export const CHART_COLORS = {
  primary: '#6366f1',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#f43f5e',
  violet: '#8b5cf6',
  cyan: '#06b6d4',
  muted: '#64748b',
  pink: '#ec4899',
};

export const CHART_PALETTE = [
  CHART_COLORS.primary,
  CHART_COLORS.success,
  CHART_COLORS.warning,
  CHART_COLORS.danger,
  CHART_COLORS.violet,
  CHART_COLORS.cyan,
  CHART_COLORS.pink,
  CHART_COLORS.muted,
];

export const GRID_STROKE = 'rgba(148,163,184,0.18)';
export const AXIS_TICK = { fontSize: 11, fill: '#64748b', fontWeight: 600 as const };

export const GLASS_TOOLTIP_STYLE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.85)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  border: '1px solid rgba(99,102,241,0.18)',
  borderRadius: 12,
  boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
  fontSize: 12,
  fontWeight: 600,
  color: '#0f172a',
};

export const GlassTooltip = (props: any) => (
  <Tooltip
    {...props}
    contentStyle={GLASS_TOOLTIP_STYLE}
    cursor={{ stroke: CHART_COLORS.primary, strokeDasharray: '3 3', strokeOpacity: 0.4 }}
  />
);
