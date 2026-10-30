import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface GlassSelectOption {
  value: string;
  label: string;
  group?: string;
}

interface GlassSelectBase {
  options: GlassSelectOption[];
  ariaLabel?: string;
  className?: string;
  menuClassName?: string;
  /** Mirror of the native select's disabled state — the trigger renders inert. */
  disabled?: boolean;
}

/**
 * One list, two shapes: pick ONE value, or tick ANY NUMBER of them.
 *
 * The union is a discriminated one on `multiple`, so a multi-select cannot be
 * wired to a single-value `onChange` (or the reverse) and quietly drop half the
 * ticks the operator made. Multi mode is a checklist: the menu stays open while
 * ticking, every row carries a tick box, and the trigger names what is picked.
 *
 * In multi mode an EMPTY selection means "no filter" — the trigger then shows
 * `emptyLabel` ("All types") instead of an empty box, so the list never has to
 * carry a fake "All" row that would have to be un-ticked before a single type
 * could be chosen.
 */
export type GlassSelectProps = GlassSelectBase &
  (
    | {
        value: string;
        onChange: (value: string) => void;
        multiple?: false;
        values?: never;
        onValuesChange?: never;
        emptyLabel?: never;
      }
    | {
        multiple: true;
        values: string[];
        onValuesChange: (values: string[]) => void;
        /** Shown on the trigger when nothing is ticked. */
        emptyLabel?: string;
        value?: never;
        onChange?: never;
      }
  );

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
export const GlassSelect: React.FC<GlassSelectProps> = (props) => {
  const { options, ariaLabel, className = '', menuClassName = '', disabled = false } = props;

  /* Both modes read through these two names, so the row rendering, the
     keyboard handler and the trigger label can never disagree about which mode
     they are in. */
  const multi = props.multiple === true;
  const value = props.multiple === true ? '' : props.value;
  const values: string[] = props.multiple === true ? props.values : [];
  const emptyLabel = props.multiple === true ? (props.emptyLabel ?? 'Any') : '';
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [coords, setCoords] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    /** Set when the menu hangs BELOW the trigger. */
    top?: number;
    /** Set when it flips ABOVE it — anchored by its bottom edge so a short
     *  list still sits against the trigger instead of floating mid-air. */
    bottom?: number;
  } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const current = useMemo(
    () => options.find((o) => o.value === value),
    [options, value]
  );

  /**
   * What the closed trigger says. In multi mode it has to answer "what am I
   * looking at" without being opened: nothing ticked = the unfiltered label,
   * one tick = that type's name, several = the first plus how many more, which
   * is the only phrasing that fits a 250px button and still names the filter.
   */
  const triggerLabel = useMemo(() => {
    if (!multi) return current?.label ?? value;
    if (values.length === 0) return emptyLabel;
    const first = options.find((o) => o.value === values[0])?.label ?? values[0];
    return values.length === 1 ? first : `${first} +${values.length - 1}`;
  }, [multi, values, options, current, value, emptyLabel]);

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

  /**
   * Measure the trigger and re-measure while open so the portaled menu tracks
   * the trigger across scroll/resize instead of freezing at open-time coords.
   *
   * Also decides WHERE the menu goes and how tall it may be. Portal-ing fixed
   * the ancestors' clipping, but the menu still opened straight down from the
   * trigger and the window is a clipping edge too: a select in the lower half
   * of the New Case / Edit Case form produced a list whose lower half was
   * below the viewport, so the last entries could not be read or clicked and
   * the menu looked as if it had collapsed into the footer. It now flips above
   * the trigger when there is more room there, and always caps its height to
   * the space it actually has — the list scrolls inside that box.
   */
  const measure = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const GAP = 6;
    const EDGE = 12;
    const PREFERRED = 288; // equals the old max-h-72
    const below = window.innerHeight - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    const openUp = below < Math.min(PREFERRED, 160) && above > below;
    const maxHeight = Math.max(96, Math.min(PREFERRED, openUp ? above : below));
    setCoords({
      left: r.left,
      width: r.width,
      maxHeight,
      ...(openUp
        ? { bottom: Math.max(EDGE, window.innerHeight - r.top + GAP) }
        : { top: r.bottom + GAP }),
    });
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

  const choose = (v: string) => {
    if (props.multiple === true) {
      /* A checklist does not close on a tick — the operator is here to pick
         more than one, and a menu that vanishes after every click makes a
         three-type filter into three openings. */
      props.onValuesChange(
        props.values.includes(v)
          ? props.values.filter((x) => x !== v)
          : [...props.values, v]
      );
      return;
    }
    triggerRef.current?.focus();
    setOpen(false);
    if (v !== value) props.onChange(v);
  };

  const openMenu = () => {
    const idx = selectable.findIndex((o) =>
      props.multiple === true ? props.values.includes(o.value) : o.value === value
    );
    setActive(Math.max(0, idx));
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
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (selectable[active]) choose(selectable[active].value);
        break;
      case 'Escape': e.preventDefault(); triggerRef.current?.focus(); setOpen(false); break;
      case 'Tab': triggerRef.current?.focus(); setOpen(false); break;
    }
  };

  const menu = open && coords ? createPortal(
    <div
      id={listId}
      ref={listRef}
      role="listbox"
      aria-multiselectable={multi || undefined}
      onKeyDown={onMenuKeyDown}
      tabIndex={-1}
      className={`ds-popover fixed z-[10000] overflow-y-auto overscroll-contain p-1.5 space-y-0.5 ${menuClassName}`}
      style={{
        top: coords.top,
        bottom: coords.bottom,
        left: coords.left,
        /* minWidth, not width: a menu may never be NARROWER than its trigger,
           but it must be allowed to be wider. Fixed-width menus truncated the
           option they were opened to show — "Lower Nickle", "Other D…" — and a
           list you cannot read is not a list. Growth is capped so a single very
           long value cannot push the menu off the window. */
        minWidth: coords.width,
        maxWidth: 'min(420px, calc(100vw - 24px))',
        maxHeight: coords.maxHeight,
      }}
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
        const isSelected = multi ? values.includes(row.value) : row.value === value;
        const rowSelectableIdx = selectable.findIndex((o) => o.value === row.value);
        return (
          <button
            key={row.value}
            type="button"
            role="option"
            aria-selected={isSelected}
            data-active={rowSelectableIdx === active}
            onClick={() => choose(row.value)}
            onMouseEnter={() => setActive(rowSelectableIdx)}
            className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs font-semibold transition-colors ${
              isSelected
                ? multi
                  ? 'bg-indigo-50 text-slate-900'
                  : 'bg-white shadow-xs ring-1 ring-slate-900/10 text-slate-900'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              {/* Multi mode keeps the box on EVERY row: an empty box is the
                  affordance that says "you may tick more than one", and its
                  fixed 14px width keeps every label on one left edge, ticked
                  or not. */}
              {multi && (
                <span
                  aria-hidden="true"
                  className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[4px] border transition-colors ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-slate-300 bg-white'
                  }`}
                >
                  {isSelected && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
                </span>
              )}
              <span className="truncate">{row.label}</span>
            </span>
            {!multi && isSelected && (
              <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            )}
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
        <span className="truncate">{triggerLabel}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {multi && values.length > 0 && (
            <span
              className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold leading-4 text-white tabular-nums"
              aria-hidden="true"
            >
              {values.length}
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </span>
      </button>
      {menu}
    </div>
  );
};

export default GlassSelect;
