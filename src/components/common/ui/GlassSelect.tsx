import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface GlassSelectOption {
  value: string;
  label: string;
  /** Optional group heading row — renders once per distinct group, in order. */
  group?: string;
}

export interface GlassSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: GlassSelectOption[];
  /** Accessible name for the trigger. */
  ariaLabel?: string;
  /** Width / padding utilities for the trigger, e.g. `w-full p-2 text-xs`. */
  className?: string;
  /** Extra positioning for the menu, e.g. `left-auto right-0 w-64`. */
  menuClassName?: string;
}

/**
 * Shared glass dropdown — one open-menu material for every native `<select>`.
 *
 * WHY IT EXISTS
 * A native select's option list is OS-drawn: no CSS can glass it. Operators
 * called that mismatch out (frosted trigger, legacy paper menu). This
 * component replaces the control wholesale: the trigger wears the same
 * `.ds-glass-select` fill so swaps are visual drop-ins, and the menu is the
 * shared `ds-popover` material with fill-only rows — a popover that blurs
 * never hosts a second blur inside it (the nested-backdrop jank rule).
 *
 * SEMANTICS: role=listbox triggered by a combobox-pattern button, linear
 * keyboard nav (arrows / home / end / enter / escape), click-outside close,
 * focus restore to the trigger. Groups render as inert headings.
 */
export const GlassSelect: React.FC<GlassSelectProps> = ({
  value,
  onChange,
  options,
  ariaLabel,
  className = '',
  menuClassName = '',
}) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const current = useMemo(
    () => options.find((o) => o.value === value),
    [options, value]
  );

  // Selectable rows only (group headings are inert), with edge-bounds clamped
  // navigation shared by keyboard and scroll-into-view.
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

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        triggerRef.current?.focus();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  // Keep the active row visible while arrowing.
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

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        ref={triggerRef}
        onClick={() => (open ? (triggerRef.current?.focus(), setOpen(false)) : openMenu())}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        className={`ds-glass-select flex w-full items-center justify-between gap-2 rounded-xl text-left ${className}`}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id={listId}
          ref={listRef}
          role="listbox"
          onKeyDown={onMenuKeyDown}
          tabIndex={-1}
          className={`ds-popover absolute left-0 right-0 top-full mt-1.5 z-50 max-h-72 overflow-y-auto p-1.5 space-y-0.5 ${menuClassName}`}
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
            const rowSelectableIdx = selectable.findIndex(
              (o) => o.value === row.value
            );
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
        </div>
      )}
    </div>
  );
};

export default GlassSelect;