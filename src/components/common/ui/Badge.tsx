import React from 'react';
import { CaseStatus, PriorityLevel, PaymentStatus } from '../../../types';

export interface BadgeProps {
  children?: React.ReactNode;
  variant?: 'default' | 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'cyan';
  size?: 'xs' | 'sm' | 'md';
  dot?: boolean;
  className?: string;
  id?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'sm',
  dot = false,
  className = '',
  id
}) => {
  const variantStyles = {
    default: 'bg-slate-100 text-slate-700 border-slate-200/80',
    neutral: 'bg-slate-50 text-slate-600 border-slate-200',
    primary: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
    danger: 'bg-rose-50 text-rose-700 border-rose-200',
    info: 'bg-sky-50 text-sky-700 border-sky-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    cyan: 'bg-cyan-50 text-cyan-800 border-cyan-200',
  };

  const dotColors = {
    default: 'bg-slate-400',
    neutral: 'bg-slate-400',
    primary: 'bg-indigo-500',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-rose-500',
    info: 'bg-sky-500',
    purple: 'bg-purple-500',
    cyan: 'bg-cyan-500',
  };

  const sizeStyles = {
    xs: 'text-[11px] px-2 py-0.5 font-medium tracking-tight',
    sm: 'text-xs px-2.5 py-0.5 font-semibold tracking-tight',
    md: 'text-xs px-3 py-1 font-semibold',
  };

  return (
    <span
      id={id}
      className={`inline-flex items-center gap-1.5 rounded-full border transition-colors whitespace-nowrap ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors[variant]}`} />}
      {children}
    </span>
  );
};

export const CaseStatusBadge: React.FC<{ status: CaseStatus; size?: 'xs' | 'sm' | 'md'; className?: string }> = ({
  status,
  size = 'sm',
  className = ''
}) => {
  switch (status) {
    case 'draft':
      return <Badge variant="neutral" dot size={size} className={`bg-slate-100 text-slate-700 border-dashed border-slate-300 ${className}`}>Draft</Badge>;
    case 'received':
      return <Badge variant="neutral" dot size={size} className={className}>Received</Badge>;
    case 'in_progress':
      return <Badge variant="primary" dot size={size} className={className}>In Progress</Badge>;
    case 'qc':
      return <Badge variant="purple" dot size={size} className={className}>QC Check</Badge>;
    case 'ready':
      return <Badge variant="cyan" dot size={size} className={className}>Ready</Badge>;
    case 'delivered':
      return <Badge variant="success" dot size={size} className={className}>Delivered</Badge>;
    case 'revision':
      return <Badge variant="warning" dot size={size} className={className}>Revision</Badge>;
    case 'cancelled':
      return <Badge variant="danger" dot size={size} className={className}>Cancelled</Badge>;
    default:
      return <Badge variant="neutral" size={size} className={className}>{status}</Badge>;
  }
};

export const PriorityBadge: React.FC<{ priority: PriorityLevel; size?: 'xs' | 'sm' | 'md'; className?: string }> = ({
  priority,
  size = 'xs',
  className = ''
}) => {
  switch (priority) {
    case 'urgent':
      return (
        <span className={`inline-flex items-center gap-1 font-bold text-[11px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 uppercase tracking-wider ${className}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
          Urgent
        </span>
      );
    case 'high':
      return (
        <span className={`inline-flex items-center gap-1 font-semibold text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 ${className}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          High
        </span>
      );
    case 'normal':
      return (
        <span className={`inline-flex items-center gap-1 font-medium text-[11px] px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200 ${className}`}>
          Normal
        </span>
      );
    case 'low':
      return (
        <span className={`inline-flex items-center gap-1 font-medium text-[11px] px-2 py-0.5 rounded-full bg-slate-50 text-slate-500 border border-slate-200/60 ${className}`}>
          Low
        </span>
      );
    default:
      return <Badge variant="neutral" size={size} className={className}>{priority}</Badge>;
  }
};

export const PaymentStatusBadge: React.FC<{ status: PaymentStatus; size?: 'xs' | 'sm'; className?: string }> = ({
  status,
  size = 'xs',
  className = ''
}) => {
  switch (status) {
    case 'paid':
      return <Badge variant="success" dot size={size} className={className}>Paid</Badge>;
    case 'partial':
      return <Badge variant="warning" dot size={size} className={className}>Partial</Badge>;
    case 'unpaid':
      return <Badge variant="danger" dot size={size} className={className}>Unpaid</Badge>;
    default:
      return <Badge variant="neutral" size={size} className={className}>{status}</Badge>;
  }
};
