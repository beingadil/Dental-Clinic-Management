import React from 'react';
import { Eye, EyeOff } from 'lucide-react';

/** The section id that owns the account-summary block in both print modes. */
export const ACCOUNT_SUMMARY_SECTION = 'balanceSummary';

interface BalanceSummaryToggleProps {
  /** The document section list being printed (invoice or statement). */
  sections: string[];
  /** Receives the updated list; callers persist it through saveDocumentSections. */
  onChange: (next: string[]) => void;
  /** Extra wrapper classes, for the toolbar the control sits in. */
  className?: string;
}

/**
 * The one-click show/hide control for the account-summary table on a printout.
 *
 * It edits the SAME section list the print renderer and Settings → Print read,
 * so switching it here is not a per-preview override: the next invoice or
 * statement prints the way this one does. That is what makes it a print
 * setting rather than a temporary hiding trick.
 */
export const BalanceSummaryToggle: React.FC<BalanceSummaryToggleProps> = ({
  sections,
  onChange,
  className = '',
}) => {
  const shown = sections.includes(ACCOUNT_SUMMARY_SECTION);
  const toggle = () => {
    onChange(
      shown
        ? sections.filter((id) => id !== ACCOUNT_SUMMARY_SECTION)
        : [...sections, ACCOUNT_SUMMARY_SECTION],
    );
  };

  return (
    <label
      title="Show or hide the opening / period / closing account summary on this document. The choice is remembered for the next printout."
      className={`inline-flex cursor-pointer select-none items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
        shown
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      } ${className}`}
    >
      <input
        type="checkbox"
        checked={shown}
        onChange={toggle}
        aria-label="Show account summary on the printed document"
        className="h-3.5 w-3.5 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
      />
      {shown ? (
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      <span>Account summary</span>
      <span
        className={`rounded-full px-1.5 py-px text-[10px] font-bold uppercase tracking-wide ${
          shown ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
        }`}
      >
        {shown ? 'Shown' : 'Hidden'}
      </span>
    </label>
  );
};
