import React from 'react';

/** Which artefact the canvas is showing — drives the caption, not the layout. */
export type PreviewArtefact = 'invoice' | 'job_slip' | 'receipt' | 'statement' | 'card' | 'header';

export interface PreviewFrameProps {
  /** Always rendered — a canvas without a caption is what D8 set out to remove. */
  label: string;
  /** Optional "what am I looking at / what changes it" line, right-aligned. */
  hint?: React.ReactNode;
  artefact?: PreviewArtefact;
  /** Mat behind the artefact. `dark` keeps the workstation-card studio look. */
  surface?: 'white' | 'slate' | 'dark';
  /** Extra classes for the mat (padding, grid width…). */
  bodyClassName?: string;
  /** Right side of the caption strip — toggles, zoom, re-print… */
  actions?: React.ReactNode;
  className?: string;
  id?: string;
  children: React.ReactNode;
}

const ARTEFACT_NAME: Record<PreviewArtefact, string> = {
  invoice: 'Invoice',
  job_slip: 'Job slip',
  receipt: 'Receipt',
  statement: 'Statement of account',
  card: 'Workstation card',
  header: 'App header',
};

const SURFACE_CLASS: Record<NonNullable<PreviewFrameProps['surface']>, string> = {
  white: 'bg-white border-slate-200',
  slate: 'bg-slate-100 border-slate-200',
  dark: 'bg-slate-900 border-slate-800',
};

/**
 * D8 — one labelled preview canvas for every artefact Settings can change.
 *
 * Before this, branding and print previews were bare markup with an unlabelled
 * `slate-900` block, so a screenshot review could not tell which document a
 * preview was showing or which setting had moved it. The frame is presentation
 * only: it never wraps a `print-area`, so printed output is unchanged.
 */
export const PreviewFrame: React.FC<PreviewFrameProps> = ({
  label,
  hint,
  artefact,
  surface = 'white',
  bodyClassName = 'p-3',
  actions,
  className = '',
  id,
  children,
}) => {
  const dark = surface === 'dark';
  return (
    <div
      id={id}
      data-preview-artefact={artefact}
      className={`rounded-2xl border overflow-hidden shadow-2xs ${SURFACE_CLASS[surface]} ${className}`}
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-b ${
          dark ? 'border-slate-800 bg-slate-900/60' : 'border-slate-100 bg-slate-50'
        }`}
      >
        <div className="flex items-baseline gap-2 min-w-0">
          <span
            className={`text-[11px] font-bold uppercase tracking-widest ${dark ? 'text-slate-300' : 'text-slate-600'}`}
          >
            {label}
          </span>
          {artefact && (
            <span className={`text-[11px] font-medium ${dark ? 'text-slate-500' : 'text-ink-muted'}`}>
              {ARTEFACT_NAME[artefact]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 min-w-0">
          {hint && (
            <span className={`text-[11px] ${dark ? 'text-ink-muted' : 'text-slate-500'}`}>{hint}</span>
          )}
          {actions}
        </div>
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
};
