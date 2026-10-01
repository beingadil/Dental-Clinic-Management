import React, { useRef, type RefObject } from 'react';
import { X } from 'lucide-react';
import { useDialogBehavior } from './useDialogBehavior';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name — becomes `aria-label` unless `labelledBy` is given. */
  label: string;
  labelledBy?: string;
  children: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  /** Panel width utility, e.g. `max-w-2xl`. */
  maxWidth?: string;
  cardClassName?: string;
  bodyClassName?: string;
  backdropClassName?: string;
  zIndex?: string;
  /** Backdrop click closes: expected for a drawer, unlike a print dialog. */
  closeOnBackdrop?: boolean;
  trapFocus?: boolean;
  hideClose?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * V-19 — the side-panel variant of `Modal`, sharing its backdrop, dialog
 * semantics, Escape handling, focus trap and focus restore. Used by the invoice
 * inspector, which is a "keep the list visible while I read one record" surface
 * rather than a centered dialog.
 */
export const Drawer: React.FC<DrawerProps> = ({
  open,
  onClose,
  label,
  labelledBy,
  children,
  header,
  footer,
  maxWidth = 'max-w-2xl',
  cardClassName = '',
  bodyClassName = '',
  backdropClassName = '',
  zIndex = 'z-50',
  closeOnBackdrop = true,
  trapFocus = true,
  hideClose = false,
  initialFocusRef,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  useDialogBehavior(panelRef, open, onClose, trapFocus ? initialFocusRef : undefined);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 ${zIndex} overflow-hidden bg-slate-900/50 backdrop-blur-xs flex justify-end ${backdropClassName}`}
      onMouseDown={closeOnBackdrop ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        className={`w-full ${maxWidth} bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200 print:shadow-none ${cardClassName}`}
      >
        {(header || !hideClose) && (
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
            <div className="min-w-0">{header}</div>
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label={`Close ${label}`}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
        {bodyClassName ? <div className={bodyClassName}>{children}</div> : children}
        {footer && (
          <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-end gap-2.5 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
