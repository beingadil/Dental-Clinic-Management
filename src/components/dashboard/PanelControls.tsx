/**
 * Per-panel controls.
 *
 * Rendered inside each panel's top-right corner on hover/focus. The trigger is
 * deliberately quiet — a technician should not see a toolbar over every card
 * they came to read — and the menu closes on Escape, outside click, or after a
 * choice, so it never traps the keyboard.
 *
 * A panel that is hidden cannot be un-hidden from here (it is not on screen),
 * so hidden panels are recovered from the "Hidden panels" menu in the layout
 * bar. Pin, widen and hide are all one click from the visible card.
 */
import React from 'react';
import { Pin, PinOff, Maximize2, Minimize2, EyeOff, ChevronDown } from 'lucide-react';

const MENU_W = 'absolute right-3 top-3 z-20 w-44 rounded-xl border border-ds-line bg-white p-1 shadow-lg';

export const PanelControls: React.FC<{
  label: string;
  pinned: boolean;
  wide: boolean;
  onPin: () => void;
  onWide: () => void;
  onHide: () => void;
}> = ({ label, pinned, wide, onPin, onWide, onHide }) => {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };

  const item =
    'w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[11.5px] font-semibold text-ds-ink-soft hover:bg-ds-surface-sunken cursor-pointer transition-colors';

  return (
    <div ref={rootRef} className="absolute right-3 top-3 z-10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${label} panel options`}
        aria-expanded={open}
        className="ds-tap flex items-center gap-1 rounded-lg border border-ds-line bg-white/90 px-1.5 py-1 text-ds-muted opacity-0 transition-opacity hover:text-ds-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-accent cursor-pointer group-hover:opacity-100 focus:opacity-100"
      >
        {pinned ? <Pin className="w-3.5 h-3.5 text-ds-accent" /> : null}
        <span className="text-[10px] font-bold tracking-wide">•••</span>
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div className={MENU_W} role="menu">
          <button type="button" role="menuitem" className={item} onClick={run(onPin)}>
            {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            {pinned ? 'Unpin from top' : 'Pin to top'}
          </button>
          <button type="button" role="menuitem" className={item} onClick={run(onWide)}>
            {wide ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            {wide ? 'Make narrow' : 'Make wide'}
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${item} text-ds-risk-ink hover:bg-ds-risk-soft`}
            onClick={run(onHide)}
          >
            <EyeOff className="w-3.5 h-3.5" />
            Hide panel
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * Wrapper that positions the controls over a panel. Panels own their own
 * padding, so the control overlays the header without reflowing it.
 */
export const PanelShell: React.FC<{
  label: string;
  pinned: boolean;
  wide: boolean;
  onPin: () => void;
  onWide: () => void;
  onHide: () => void;
  children: React.ReactNode;
}> = ({ children, ...controls }) => (
  <div className="relative group">
    <PanelControls {...controls} />
    {children}
  </div>
);