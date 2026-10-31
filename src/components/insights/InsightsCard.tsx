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
  <div className={`group relative ${span} ${className}`}>
    {/* Outer shell — machined tray */}
    <div
      className="relative h-full overflow-hidden rounded-[1.75rem] p-1.5 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5"
      style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))' }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full opacity-40 blur-3xl transition-opacity duration-500 group-hover:opacity-60"
        style={{ background: accent }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[1.75rem] ring-1 ring-white/10 dark:ring-white/5"
      />
      {/* Inner core */}
      <section className="relative h-full overflow-hidden rounded-[calc(1.75rem-0.375rem)] border border-ds-line/40 bg-ds-surface/80 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_8px_32px_-12px_rgba(15,23,42,0.12)] transition-shadow duration-500 group-hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.18),0_16px_48px_-12px_rgba(99,102,241,0.22)] flex flex-col">
        <header className="relative flex items-start justify-between gap-3 px-5 pt-4 pb-2">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-ds-ink tracking-tight">{title}</h3>
            {subtitle && <p className="text-[11px] font-semibold text-ink-muted mt-0.5">{subtitle}</p>}
          </div>
          {action ?? (onDrill ? (
            <button type="button" onClick={onDrill} className="text-[10px] font-bold uppercase tracking-wider text-ds-accent hover:underline transition-colors">
              {drillLabel} ↗
            </button>
          ) : (
            <button type="button" className="text-ink-muted hover:text-ds-ink transition-colors" aria-label="Card options">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          ))}
        </header>
        <div className="relative px-5 pb-5 flex-1 flex flex-col justify-center">{children}</div>
      </section>
    </div>
  </div>
);
