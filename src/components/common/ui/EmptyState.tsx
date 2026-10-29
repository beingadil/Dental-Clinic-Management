import React from 'react';
import { LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className = '',
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 md:p-12 text-center rounded-2xl border border-dashed border-ds-line bg-ds-surface/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] ${className}`}
    >
      <div className="w-14 h-14 rounded-2xl bg-ds-surface/60 border border-ds-line flex items-center justify-center text-ds-ink-soft mb-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
        <Icon className="w-7 h-7" />
      </div>
      <h3 className="text-base md:text-lg font-bold text-slate-900 tracking-tight">
        {title}
      </h3>
      <p className="mt-1.5 text-sm text-slate-500 max-w-md leading-relaxed">
        {description}
      </p>

      {actionLabel && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="ds-glass-pill text-xs md:text-sm cursor-pointer"
            >
              {actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
