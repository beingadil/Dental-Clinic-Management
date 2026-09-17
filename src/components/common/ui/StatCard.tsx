import React from 'react';
import { LucideIcon } from 'lucide-react';

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: {
    value: string;
    isPositive?: boolean;
    isNeutral?: boolean;
  };
  variant?: 'default' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'cyan';
  onClick?: () => void;
  className?: string;
  id?: string;
  badge?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  variant = 'default',
  onClick,
  className = '',
  id,
  badge
}) => {
  const iconVariants = {
    default: 'bg-slate-100 text-slate-700 border-slate-200/80',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    rose: 'bg-rose-50 text-rose-600 border-rose-100',
    cyan: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  };

  const topAccents = {
    default: 'group-hover:border-slate-300',
    indigo: 'group-hover:border-indigo-300',
    emerald: 'group-hover:border-emerald-300',
    amber: 'group-hover:border-amber-300',
    rose: 'group-hover:border-rose-300',
    cyan: 'group-hover:border-cyan-300',
  };

  return (
    <div
      id={id}
      onClick={onClick}
      className={`group relative bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs transition-all duration-200 ${
        onClick ? 'cursor-pointer hover:shadow-lg hover:-translate-y-0.5' : 'hover:shadow-lg'
      } ${topAccents[variant]} ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {title}
            </span>
            {badge && (
              <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full border border-slate-200">
                {badge}
              </span>
            )}
          </div>
          <div className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900 font-mono">
            {value}
          </div>
        </div>

        <div className={`p-2.5 rounded-xl border transition-transform duration-200 group-hover:scale-105 shrink-0 ${iconVariants[variant]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>

      {(subtitle || trend) && (
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span className="truncate">{subtitle}</span>
          {trend && (
            <span
              className={`font-semibold flex items-center gap-1 shrink-0 ${
                trend.isNeutral
                  ? 'text-slate-600'
                  : trend.isPositive
                  ? 'text-emerald-600'
                  : 'text-rose-600'
              }`}
            >
              {trend.value}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
