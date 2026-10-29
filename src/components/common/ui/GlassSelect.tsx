import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface GlassSelectOption {
  value: string;
  label: string;
  group?: string;
}

export interface GlassSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: GlassSelectOption[];
  ariaLabel?: string;
  className?: string;
  menuClassName?: string;
  /** Mirror of the native select's disabled state — the trigger renders inert. */
  disabled?: boolean;
}

/**
 * Shared glass dropdown — one open-menu material for every native `<select>`.
 *
 * The menu is PORTALed to document.body and positioned with fixed coords taken
 * from the trigger rect. Reason: the trigger lives inside toolbars/cards that
 * carry their own stacking contexts and `overflow-hidden`/`overflow-auto`, so
 * an in-flow absolutely-positioned menu was being clipped or sat beneath
 * later siblings (the Workstation board). Portaling removes the menu from
 * every ancestor's clipping and stacking, so the open list always reads on
 * top — and one fix covers every module using this component.
 */
export const GlassSelect: React.FC<GlassSelectProps> = ({
  value,
  onChange,
  options,
  ariaLabel,
  className = '',
  menuClassName = '',
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const current = useMemo(
    () => options.find((o) => o.value === value),
    [options, value]
  );

  const rows = useMemo(() => {
    const acc: (GlassSelectOption | { heading: string })[] = [];
    const seen = new Set<string>();
    for (const o of options) {
      if (o.group && !seen.has(o.group)) {
        seen.add(o.group);
        acc.push({ heading: o.group });
      }
      acc.push(o);
    }
    return acc;
  }, [options]);

  const selectable = useMemo(
    () => rows.filter((r): r is GlassSelectOption => !('heading' in r)),
    [rows]
  );

  // Measure the trigger and re-measure while open so the portaled menu tracks
  // the trigger across scroll/resize instead of freezing at open-time coords.
  const measure = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setCoords({ top: r.bottom + 6, left: r.left, width: r.width });
  };

  useEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node) && !listRef.current?.contains(e.target as Node)) {
        triggerRef.current?.focus();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const commit = (v: string) => {
    triggerRef.current?.focus();
    setOpen(false);
    if (v !== value) onChange(v);
  };

  const openMenu = () => {
    const idx = Math.max(0, selectable.findIndex((o) => o.value === value));
    setActive(idx);
    setOpen(true);
  };

  const move = (delta: number) => {
    setActive((a) => Math.min(selectable.length - 1, Math.max(0, a + delta)));
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMenu();
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'Home': e.preventDefault(); setActive(0); break;
      case 'End': e.preventDefault(); setActive(selectable.length - 1); break;
      case 'Enter': e.preventDefault(); if (selectable[active]) commit(selectable[active].value); break;
      case 'Escape': e.preventDefault(); triggerRef.current?.focus(); setOpen(false); break;
      case 'Tab': triggerRef.current?.focus(); setOpen(false); break;
    }
  };

  const menu = open && coords ? createPortal(
    <div
      id={listId}
      ref={listRef}
      role="listbox"
      onKeyDown={onMenuKeyDown}
      tabIndex={-1}
      className={`ds-popover fixed z-[10000] max-h-72 overflow-y-auto p-1.5 space-y-0.5 ${menuClassName}`}
      style={{ top: coords.top, left: coords.left, width: coords.width }}
    >
      {rows.map((row) => {
        if ('heading' in row) {
          return (
            <div
              key={`g-${row.heading}`}
              className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 select-none"
            >
              {row.heading}
            </div>
          );
        }
        const isSelected = row.value === value;
        const rowSelectableIdx = selectable.findIndex((o) => o.value === row.value);
        return (
          <button
            key={row.value}
            type="button"
            role="option"
            aria-selected={isSelected}
            data-active={rowSelectableIdx === active}
            onClick={() => commit(row.value)}
            onMouseEnter={() => setActive(rowSelectableIdx)}
            className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs font-semibold transition-colors ${
              isSelected
                ? 'bg-white shadow-xs ring-1 ring-slate-900/10 text-slate-900'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span className="truncate">{row.label}</span>
            {isSelected && <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
          </button>
        );
      })}
    </div>,
    document.body
  ) : null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        onClick={() => (open ? (triggerRef.current?.focus(), setOpen(false)) : openMenu())}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        className={`ds-glass-select flex w-full items-center justify-between gap-2 rounded-xl text-left disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {menu}
    </div>
  );
};

export default GlassSelect;
