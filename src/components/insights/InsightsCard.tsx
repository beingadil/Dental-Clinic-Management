import React from 'react';
import { MoreHorizontal } from 'lucide-react';

interface Props {
  title: string;
  subtitle?: string;
  accent?: string;
  className?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  span?: string;
  onDrill?: () => void;
  drillLabel?: string;
}

export const InsightsCard: React.FC<Props> = ({ title, subtitle, accent = '#6366f1', className = '', children, action, span = '', onDrill, drillLabel = 'Drill in' }) => (
  <section
    className={`relative overflow-hidden rounded-2xl border border-ds-line/60 bg-ds-surface/70 backdrop-blur-xl shadow-[0_8px_32px_-12px_rgba(15,23,42,0.12)] transition-all hover:shadow-[0_12px_40px_-12px_rgba(99,102,241,0.18)] ${span} ${className}`}
  >
    <div
      aria-hidden
      className="pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full opacity-30 blur-3xl"
      style={{ background: accent }}
    />
    <header className="relative flex items-start justify-between gap-3 px-5 pt-4 pb-2">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-ds-ink tracking-tight">{title}</h3>
        {subtitle && <p className="text-[11px] font-semibold text-ink-muted mt-0.5">{subtitle}</p>}
      </div>
      {action ?? (onDrill ? (
        <button type="button" onClick={onDrill} className="text-[10px] font-bold uppercase tracking-wider text-ds-accent hover:underline">
          {drillLabel}
        </button>
      ) : (
        <button type="button" className="text-ink-muted hover:text-ds-ink transition-colors" aria-label="Card options">
          <MoreHorizontal className="w-4 h-4" />
        </button>
      ))}
    </header>
    <div className="relative px-5 pb-5">{children}</div>
  </section>
);
