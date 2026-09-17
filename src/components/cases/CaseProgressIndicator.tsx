import React from 'react';
import { CaseStatus } from '../../types';
import { Check, Clock, ShieldCheck, Truck, CheckCircle, AlertCircle, XCircle } from 'lucide-react';

export interface StageDefinition {
  id: CaseStatus;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const MAIN_STAGES: StageDefinition[] = [
  { id: 'received', label: 'Received', shortLabel: 'Recv', icon: Clock },
  { id: 'in_progress', label: 'In Progress', shortLabel: 'Prog', icon: Clock },
  { id: 'qc', label: 'Quality Check', shortLabel: 'QC', icon: ShieldCheck },
  { id: 'ready', label: 'Ready / Shipped', shortLabel: 'Ready', icon: Truck },
  { id: 'delivered', label: 'Delivered', shortLabel: 'Deliv', icon: CheckCircle },
];

interface CaseProgressIndicatorProps {
  status: CaseStatus;
  onStatusChange?: (newStatus: CaseStatus) => void;
  variant?: 'compact' | 'detailed' | 'timeline';
  showLabels?: boolean;
}

export const CaseProgressIndicator: React.FC<CaseProgressIndicatorProps> = ({
  status,
  onStatusChange,
  variant = 'compact',
  showLabels = true,
}) => {
  // Special status handling
  const isDraft = status === 'draft';
  const isRevision = status === 'revision';
  const isCancelled = status === 'cancelled';

  // Determine active index in main pipeline
  const currentIndex = MAIN_STAGES.findIndex((s) => s.id === status);

  // If draft, revision or cancelled, fallback calculation
  const getStepState = (index: number) => {
    if (isDraft) return 'upcoming';
    if (isCancelled) return 'cancelled';
    if (isRevision && index <= 1) return 'completed'; // Revision happens during or after in progress
    if (isRevision && index === 2) return 'revision';
    if (currentIndex === -1) return 'upcoming';

    if (index < currentIndex) return 'completed';
    if (index === currentIndex) return 'current';
    return 'upcoming';
  };

  // Calculate percentage completion for quick bar
  const progressPercent = isDraft
    ? 0
    : isCancelled
    ? 0
    : isRevision
    ? 40
    : currentIndex >= 0
    ? Math.round(((currentIndex + 1) / MAIN_STAGES.length) * 100)
    : 0;

  if (variant === 'compact') {
    return (
      <div className="w-full space-y-1 select-none">
        {/* Progress bar container */}
        <div className="flex items-center gap-1">
          {MAIN_STAGES.map((stage, idx) => {
            const stepState = getStepState(idx);
            let barColor = 'bg-slate-200';
            if (stepState === 'completed') barColor = 'bg-emerald-500';
            else if (stepState === 'current') barColor = 'bg-indigo-600 animate-pulse';
            else if (stepState === 'revision') barColor = 'bg-amber-500';
            else if (stepState === 'cancelled') barColor = 'bg-rose-300';

            return (
              <div
                key={stage.id}
                onClick={(e) => {
                  if (onStatusChange) {
                    e.stopPropagation();
                    onStatusChange(stage.id);
                  }
                }}
                className={`h-1.5 flex-1 rounded-full transition-all ${barColor} ${
                  onStatusChange ? 'cursor-pointer hover:opacity-80' : ''
                }`}
                title={`Stage ${idx + 1}: ${stage.label}`}
              />
            );
          })}
        </div>

        {/* Labels below */}
        {showLabels && (
          <div className="flex justify-between items-center text-[10px] text-slate-500 font-medium">
            <span className="font-extrabold text-indigo-700 capitalize flex items-center gap-1">
              {isRevision ? (
                <span className="text-amber-700 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 text-amber-600" /> Revision Required
                </span>
              ) : isCancelled ? (
                <span className="text-rose-600 flex items-center gap-1">
                  <XCircle className="w-3 h-3" /> Cancelled
                </span>
              ) : (
                <span>Stage: {MAIN_STAGES[currentIndex]?.label || status}</span>
              )}
            </span>
            <span className="font-mono text-[9px] text-slate-400 font-bold">{progressPercent}%</span>
          </div>
        )}
      </div>
    );
  }

  // Detailed Variant (Steppers with dots, checkmarks, line connectors)
  return (
    <div className="w-full space-y-2 select-none">
      {/* Step Stepper Header */}
      <div className="relative flex items-center justify-between">
        {/* Background connector line */}
        <div className="absolute left-3 right-3 top-1/2 -translate-y-1/2 h-1 bg-slate-200 z-0" />

        {/* Active connector progress overlay */}
        <div
          className={`absolute left-3 top-1/2 -translate-y-1/2 h-1 transition-all duration-300 z-0 ${
            isRevision ? 'bg-amber-400' : isCancelled ? 'bg-rose-400' : 'bg-indigo-600'
          }`}
          style={{
            width: isCancelled
              ? '0%'
              : isRevision
              ? '40%'
              : currentIndex >= 0
              ? `${(currentIndex / (MAIN_STAGES.length - 1)) * 92}%`
              : '0%',
          }}
        />

        {/* Stepper Dots */}
        {MAIN_STAGES.map((stage, idx) => {
          const stepState = getStepState(idx);
          const Icon = stage.icon;

          let circleStyle = 'bg-white border-2 border-slate-300 text-slate-400';
          if (stepState === 'completed') {
            circleStyle = 'bg-emerald-600 border-emerald-600 text-white shadow-xs';
          } else if (stepState === 'current') {
            circleStyle = 'bg-indigo-600 border-indigo-600 text-white shadow-md ring-4 ring-indigo-100 animate-pulse';
          } else if (stepState === 'revision') {
            circleStyle = 'bg-amber-500 border-amber-500 text-white ring-4 ring-amber-100';
          } else if (stepState === 'cancelled') {
            circleStyle = 'bg-rose-500 border-rose-500 text-white';
          }

          return (
            <div
              key={stage.id}
              onClick={(e) => {
                if (onStatusChange) {
                  e.stopPropagation();
                  onStatusChange(stage.id);
                }
              }}
              className={`relative z-10 flex flex-col items-center group ${
                onStatusChange ? 'cursor-pointer' : ''
              }`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${circleStyle}`}
                title={`${stage.label} ${stepState === 'completed' ? '(Completed)' : stepState === 'current' ? '(Active Stage)' : ''}`}
              >
                {stepState === 'completed' ? (
                  <Check className="w-4 h-4 stroke-[3]" />
                ) : (
                  <Icon className="w-3.5 h-3.5" />
                )}
              </div>

              {showLabels && (
                <span
                  className={`mt-1.5 text-[10px] font-bold tracking-tight text-center leading-none max-w-[55px] ${
                    stepState === 'current'
                      ? 'text-indigo-900 font-black'
                      : stepState === 'completed'
                      ? 'text-emerald-700'
                      : 'text-slate-400'
                  }`}
                >
                  {stage.shortLabel}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Status Alert Badge if special */}
      {isRevision && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-xs text-amber-800 font-semibold">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Case returned for clinical revision / rework.</span>
        </div>
      )}

      {isCancelled && (
        <div className="p-2 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-800 font-semibold">
          <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>Case cancelled by lab or clinic.</span>
        </div>
      )}
    </div>
  );
};
