/**
 * Layout bar.
 *
 * The only control surface for panels that are not currently on screen. A
 * hidden panel is unreachable from its own card by definition, so hiding needs
 * an undo that does not depend on seeing the card — this is it.
 */
import React from 'react';
import { Eye, EyeOff, RotateCcw } from 'lucide-react';

export const PanelLayoutBar: React.FC<{
  hiddenCount: number;
  onRestore: (key: string) => void;
  onReset: () => void;
  /** Canonical panel labels for the hidden ones, keyed by panel id. */
  labels: Record<string, string>;
  hidden: string[];
}> = ({ hiddenCount, onRestore, onReset, labels, hidden }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="flex items-center justify-end gap-2">
      {hiddenCount > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="ds-tap inline-flex items-center gap-1.5 rounded-full border border-ds-line bg-white px-2.5 py-1 text-[11px] font-semibold text-ds-ink-soft hover:border-ds-accent-ring hover:text-ds-accent cursor-pointer"
          >
            <EyeOff className="w-3.5 h-3.5" />
            {hiddenCount} hidden
          </button>
          {open && (
            <div className="absolute right-0 top-full mt-1.5 z-20 w-56 rounded-xl border border-ds-line bg-white p-1.5 shadow-lg">
              <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ds-muted">
                Restore panel
              </p>
              {hidden.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    onRestore(k);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11.5px] font-semibold text-ds-ink-soft hover:bg-ds-surface-sunken cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {labels[k] ?? k}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onReset}
        title="Reset the dashboard layout"
        className="ds-tap inline-flex items-center gap-1.5 rounded-full border border-ds-line bg-white px-2.5 py-1 text-[11px] font-semibold text-ds-muted hover:text-ds-ink cursor-pointer"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        Reset layout
      </button>
    </div>
  );
};