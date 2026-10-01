import { useEffect, useRef, type RefObject } from 'react';

/** Everything a dialog should be able to reach with Tab. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Open dialogs, in mount order. Only the last entry owns Escape and Tab, so a
 * dialog opened on top of the invoice drawer (reversal, journal inspector)
 * closes cleanly instead of both layers reacting to the same keystroke.
 */
const dialogStack: symbol[] = [];

export function topDialogToken(): symbol | undefined {
  return dialogStack[dialogStack.length - 1];
}

/**
 * V-19 — the behaviour every dialog needs and every dialog used to re-invent:
 * focus moves in on open, Tab cycles inside, Escape closes, focus returns to
 * the control that opened it.
 *
 * `active` is explicit (not derived from the DOM) so the same hook serves the
 * always-mounted modals that return `null` while closed.
 */
export function useDialogBehavior(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const token = Symbol('dialog');
    dialogStack.push(token);

    const previouslyFocused = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const isTop = () => dialogStack[dialogStack.length - 1] === token;

    // Prefer an explicit target (a destructive action's Cancel button), then the
    // first control in the panel, then the panel itself.
    const initialTarget = initialFocus?.current || focusables()[0] || node;
    initialTarget.focus?.();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return;

      if (event.key === 'Escape') {
        escapeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      const inside = !!current && node.contains(current);

      if (event.shiftKey && (!inside || current === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || current === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      const index = dialogStack.indexOf(token);
      if (index >= 0) dialogStack.splice(index, 1);
      previouslyFocused?.focus?.();
    };
  }, [active, ref, initialFocus]);
}
