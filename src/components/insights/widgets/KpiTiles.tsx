import React from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Wallet, Banknote, AlertTriangle, Briefcase } from 'lucide-react';
import { CHART_COLORS } from '../chartTheme';
import type { KpiMetrics } from '../../../services/insightsDomain';

interface Props { metrics: KpiMetrics; }

const fmt = (n: number) => new Intl.NumberFormat('en-PK').format(Math.round(n));

const Delta: React.FC<{ now: number; prev: number }> = ({ now, prev }) => {
  if (prev === 0 && now === 0) return <span className="text-[10px] font-bold text-ink-muted">no change</span>;
  const diff = now - prev;
  const pct = prev > 0 ? Math.round((diff / prev) * 100) : (now > 0 ? 100 : 0);
  const up = diff >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
      <Icon className="w-3 h-3" />
      {up ? '+' : ''}{pct}%
    </span>
  );
};

const Tile: React.FC<{ label: string; value: string; prev: number; now: number; icon: React.ReactNode; accent: string; spark: number[] }> = ({ label, value, prev, now, icon, accent, spark }) => (
  <div className="rounded-xl border border-ds-line/50 bg-ds-surface/60 backdrop-blur p-4 flex flex-col gap-2">
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{label}</span>
      <span className="h-7 w-7 rounded-lg flex items-center justify-center" style={{ background: `${accent}1a`, color: accent }}>{icon}</span>
    </div>
    <div className="text-xl font-extrabold text-ds-ink tracking-tight">{value}</div>
    <div className="flex items-center justify-between">
      <Delta now={now} prev={prev} />
      <div className="h-8 w-20">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={spark.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`sp-${label}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.4} />
                <stop offset="100%" stopColor={accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="v" stroke={accent} strokeWidth={1.5} fill={`url(#sp-${label})`} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  </div>
);

export const KpiTiles: React.FC<Props> = ({ metrics }) => {
  const spark = (now: number, prev: number) => [prev * 0.6, prev * 0.8, prev * 0.9, now];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Tile label="Invoiced" value={`PKR ${fmt(metrics.invoiced)}`} now={metrics.invoiced} prev={metrics.invoicedPrev} icon={<Banknote className="w-4 h-4" />} accent={CHART_COLORS.primary} spark={spark(metrics.invoiced, metrics.invoicedPrev)} />
      <Tile label="Collected" value={`PKR ${fmt(metrics.collected)}`} now={metrics.collected} prev={metrics.collectedPrev} icon={<Wallet className="w-4 h-4" />} accent={CHART_COLORS.success} spark={spark(metrics.collected, metrics.collectedPrev)} />
      <Tile label="Outstanding" value={`PKR ${fmt(metrics.outstanding)}`} now={metrics.outstanding} prev={metrics.outstandingPrev} icon={<AlertTriangle className="w-4 h-4" />} accent={CHART_COLORS.danger} spark={spark(metrics.outstanding, metrics.outstandingPrev)} />
      <Tile label="Cases" value={fmt(metrics.cases)} now={metrics.cases} prev={metrics.casesPrev} icon={<Briefcase className="w-4 h-4" />} accent={CHART_COLORS.violet} spark={spark(metrics.cases, metrics.casesPrev)} />
    </div>
  );
};

