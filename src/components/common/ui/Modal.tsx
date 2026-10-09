import React, { useRef, type RefObject } from 'react';
import { X } from 'lucide-react';
import { useDialogBehavior } from './useDialogBehavior';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name — becomes `aria-label` unless `labelledBy` is given. */
  label: string;
  labelledBy?: string;
  children: React.ReactNode;
  /** Header body; the close button is added for you unless `hideClose`. */
  header?: React.ReactNode;
  footer?: React.ReactNode;
  /** Max width utility, e.g. `max-w-2xl`. */
  maxWidth?: string;
  /** `rose` for destructive dialogs, `slate` for read-only inspectors. */
  tone?: 'indigo' | 'rose' | 'slate';
  /** Extra classes for the card. **Print contracts go here** (`print-area`). */
  cardClassName?: string;
  bodyClassName?: string;
  headerClassName?: string;
  backdropClassName?: string;
  /** `z-50` for ordinary dialogs, `z-[60]` to sit above a drawer. */
  zIndex?: string;
  /** Close on backdrop click. Off by default — print dialogs are easy to lose. */
  closeOnBackdrop?: boolean;
  /** Turn off only for nested dialogs that manage their own focus. */
  trapFocus?: boolean;
  hideClose?: boolean;
  /** Where focus lands on open. Defaults to the first control in the card. */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

const TONE_HEADER: Record<NonNullable<ModalProps['tone']>, string> = {
  indigo: 'border-slate-100 bg-slate-50/50',
  rose: 'border-rose-100 bg-rose-50/70',
  slate: 'border-slate-100 bg-slate-50',
};

/**
 * V-19 — the one dialog shell.
 *
 * Eight billing modals grew their own backdrop, header and footer, so
 * animation durations, elevation, radius, Escape handling and focus all drifted
 * apart. This owns that chrome: backdrop, `role="dialog"` + `aria-modal`,
 * Escape, focus trap, focus restore and the header/footer rhythm.
 *
 * It deliberately does **not** wrap `children` in anything that clips or hides
 * them, so a caller can still put `print-area` on the card itself and keep the
 * card as the outermost printable element (the print stylesheets depend on it).
 */
export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  label,
  labelledBy,
  children,
  header,
  footer,
  maxWidth = 'max-w-2xl',
  tone = 'indigo',
  cardClassName = '',
  bodyClassName = '',
  headerClassName = '',
  backdropClassName = '',
  zIndex = 'z-50',
  closeOnBackdrop = false,
  trapFocus = true,
  hideClose = false,
  initialFocusRef,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);

  useDialogBehavior(cardRef, open, onClose, trapFocus ? initialFocusRef : undefined);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 ${zIndex} flex items-center justify-center p-3 md:p-6 bg-slate-900/60 backdrop-blur-xs overflow-y-auto ${backdropClassName}`}
      onMouseDown={closeOnBackdrop ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        className={`bg-white rounded-2xl shadow-2xl border border-slate-200 w-full ${maxWidth} overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-auto ${cardClassName}`}
      >
        {(header || !hideClose) && (
          <div
            className={`px-6 py-4 border-b flex items-center justify-between gap-3 ${TONE_HEADER[tone]} ${headerClassName}`}
          >
            {header}
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label={`Close ${label}`}
                className="p-1.5 rounded-lg text-ink-muted hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
        {bodyClassName ? <div className={bodyClassName}>{children}</div> : children}
        {footer && (
          <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-end gap-2.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
