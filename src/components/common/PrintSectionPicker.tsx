import React from 'react';
import { Check } from 'lucide-react';
import { DocumentKind, PRINT_SECTIONS } from '../print/printRenderer';

interface PrintSectionPickerProps {
  kind: DocumentKind;
  /** Section ids that are currently ON, in document order. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Optional wrapper classes (the parent usually supplies the card). */
  className?: string;
  compact?: boolean;
}

/**
 * The single control for "what goes on this document". Used by the invoice
 * print dialog and by Settings → Print, both writing to the same stored list
 * (services/printSettings) so the paper output never disagrees with the setting.
 */
export const PrintSectionPicker: React.FC<PrintSectionPickerProps> = ({
  kind,
  value,
  onChange,
  className = '',
  compact = false,
}) => {
  const sections = PRINT_SECTIONS[kind];

  const toggle = (id: string) => {
    const next = value.includes(id) ? value.filter((s) => s !== id) : [...value, id];
    // Always persist in the document's natural order, never in click order.
    onChange(sections.map((s) => s.id).filter((sid) => next.includes(sid)));
  };

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-1.5 ${className}`}>
      {sections.map((s) => {
        const isOn = value.includes(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => toggle(s.id)}
            aria-pressed={isOn}
            className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer ${
              isOn ? 'bg-indigo-50/70 border-indigo-200' : 'bg-white border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                isOn ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300'
              }`}
            >
              {isOn && <Check className="h-3 w-3" />}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-bold text-slate-800">{s.label}</span>
              {!compact && <span className="block text-[10px] text-slate-500">{s.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
};
