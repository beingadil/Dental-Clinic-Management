/**
 * Per-user dashboard layout.
 *
 * Which panels a person pins, hides, widens, drags into a manual order, or
 * saves as a named layout is a personal view of the same data, not a change to
 * the data — so it belongs in `user_preferences` beside the other UI choices
 * that follow the person rather than the machine.
 *
 * Reads are defensive on purpose: this file is written by an older build than
 * the one reading it, and a partial object (or a corrupted JSON blob that
 * `userPreferencesRepo.get` already swallows) must never blank the dashboard.
 * Every field falls back to its default, and an unknown panel key is ignored
 * rather than rendered as an empty card.
 *
 * Writes merge. The per-user row is one JSON blob shared by UserPreferences
 * (currency, channels, …) and these dashboard keys, so every writer here does
 * read-modify-write. The pre-fix version replaced the whole row with
 * `{ "dashboard.panels": … }`, silently wiping every other preference — and
 * the settings domain's full-object write wiped saved layouts in turn.
 */
import React from 'react';
import { userPreferencesRepo } from '../../db/userPreferencesRepo';
import { getNowStamp } from '../../utils/dateUtils';

export type PanelWidth = 'full' | 'half';

/** Panel density: how much breathing room panels get. */
export type DashboardDensity = 'compact' | 'default' | 'roomy';

export interface PanelPrefs {
  /** Panel keys pinned to the top, in the order the user pinned them. */
  pinned: string[];
  /** Panel keys the user has switched off. */
  hidden: string[];
  /** Panels widened to span two masonry columns. */
  wide: string[];
}

/**
 * A named layout is a snapshot of the full arrangement. The built-in
 * 'default' always exists and means the canonical order with no pinning;
 * users save any number of their own from Settings → Application Preferences.
 */
export interface NamedLayout {
  name: string;
  panels: PanelPrefs;
  /** Manual panel order captured when the layout was saved. */
  order: string[];
  density: DashboardDensity;
  savedAt: string;
}

const PANELS_KEY = 'dashboard.panels';
const LAYOUTS_KEY = 'dashboard.layouts';
const ORDER_KEY = 'dashboard.order';
/** Legacy export name kept so existing imports/tests keep working. */
const PREF_KEY = PANELS_KEY;

const EMPTY_PANELS: PanelPrefs = { pinned: [], hidden: [], wide: [] };

/** Panel keys we know about. Anything else in storage is dropped on read. */
export function knownKeys(all: string[], prefs: PanelPrefs): PanelPrefs {
  const ok = new Set(all);
  const keep = (xs: string[]) => xs.filter((k) => ok.has(k));
  return { pinned: keep(prefs.pinned), hidden: keep(prefs.hidden), wide: keep(prefs.wide) };
}

export function parsePrefs(raw: unknown, allKeys: string[]): PanelPrefs {
  const asList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const inner = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[PANELS_KEY] : undefined;
  const r = (inner ?? {}) as Partial<PanelPrefs>;
  return knownKeys(allKeys, {
    pinned: asList(r.pinned),
    hidden: asList(r.hidden),
    wide: asList(r.wide),
  });
}

/** Manual order stored under `dashboard.order` (empty = canonical order). */
export function parseOrder(raw: unknown, allKeys: string[]): string[] {
  const inner = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[ORDER_KEY] : undefined;
  if (!Array.isArray(inner)) return [];
  const ok = new Set(allKeys);
  return inner.filter((k): k is string => typeof k === 'string' && ok.has(k));
}

/** Named-layout registry stored under `dashboard.layouts`. */
export function parseLayouts(raw: unknown): Record<string, NamedLayout> {
  const inner = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[LAYOUTS_KEY] : undefined;
  if (!inner || typeof inner !== 'object') return {};
  const out: Record<string, NamedLayout> = {};
  for (const [k, v] of Object.entries(inner as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const l = v as Partial<NamedLayout>;
    if (typeof l.name !== 'string' || !l.name) continue;
    out[k] = {
      name: l.name,
      panels: {
        pinned: Array.isArray(l.panels?.pinned) ? l.panels.pinned.filter((x): x is string => typeof x === 'string') : [],
        hidden: Array.isArray(l.panels?.hidden) ? l.panels.hidden.filter((x): x is string => typeof x === 'string') : [],
        wide: Array.isArray(l.panels?.wide) ? l.panels.wide.filter((x): x is string => typeof x === 'string') : [],
      },
      order: Array.isArray(l.order) ? l.order.filter((x): x is string => typeof x === 'string') : [],
      density: l.density === 'compact' || l.density === 'roomy' ? l.density : 'default',
      savedAt: typeof l.savedAt === 'string' ? l.savedAt : '',
    };
  }
  return out;
}

/**
 * Where a panel sits in the layout.
 *
 * Pinned panels come first, in the user's order. The rest follow the manual
 * drag order where one exists, then the canonical dashboard order — so two
 * people looking at the same day see the same reading order unless they have
 * deliberately rearranged it.
 */
export function orderPanels(keys: string[], prefs: PanelPrefs, order: string[] = []): string[] {
  const pinned = prefs.pinned.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !prefs.pinned.includes(k));
  const manual = order.filter((k) => rest.includes(k));
  const leftovers = rest.filter((k) => !order.includes(k));
  return [...pinned, ...manual, ...leftovers];
}

/** The panels to actually render, and how wide each is. */
export function visiblePanels(
  keys: string[],
  prefs: PanelPrefs,
  order: string[] = [],
): { keys: string[]; spans: Record<string, number> } {
  const visible = orderPanels(keys, prefs, order).filter((k) => !prefs.hidden.includes(k));
  const spans: Record<string, number> = {};
  for (const k of visible) spans[k] = prefs.wide.includes(k) ? 2 : 1;
  return { keys: visible, spans };
}

/**
 * The single write seam. Every dashboard preference change goes through here:
 * it merges the keys this module owns into the EXISTING per-user blob instead
 * of replacing the row, so currency / channels / quiet hours survive every
 * dashboard change — and dashboard layouts survive every settings change
 * (the settings domain merges on its side too).
 */
function mergeIntoUserRow(userId: string, patch: Record<string, unknown>): void {
  const raw = userPreferencesRepo.get(userId);
  const base = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  userPreferencesRepo.set(userId, { ...base, ...patch });
}

export const useDashboardLayout = (userId: string | undefined, allKeys: string[]) => {
  const key = allKeys.join('|');
  const [prefs, setPrefs] = React.useState<PanelPrefs>(EMPTY_PANELS);
  const [order, setOrder] = React.useState<string[]>([]);
  const [layouts, setLayouts] = React.useState<Record<string, NamedLayout>>({});

  const reload = React.useCallback(
    (uid: string) => {
      const raw = userPreferencesRepo.get(uid);
      setPrefs(parsePrefs(raw, allKeys));
      setOrder(parseOrder(raw, allKeys));
      setLayouts(parseLayouts(raw));
    },
    // `key` stands in for allKeys' contents; the array identity changes every
    // render and would reload preferences on every keystroke elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  // Load on mount and whenever the signed-in user changes.
  React.useEffect(() => {
    if (!userId) {
      setPrefs(EMPTY_PANELS);
      setOrder([]);
      setLayouts({});
      return;
    }
    reload(userId);
  }, [userId, reload]);

  const persistPanels = React.useCallback(
    (next: PanelPrefs) => {
      setPrefs(next);
      // Not signed in (or signed out mid-session): keep the change in memory
      // for this render rather than throwing it away; it saves on next login.
      if (userId) mergeIntoUserRow(userId, { [PANELS_KEY]: next });
    },
    [userId],
  );

  const togglePin = React.useCallback(
    (panelKey: string) => {
      const pinned = prefs.pinned.includes(panelKey)
        ? prefs.pinned.filter((k) => k !== panelKey)
        : [...prefs.pinned, panelKey];
      persistPanels({ ...prefs, pinned });
    },
    [prefs, persistPanels],
  );

  const toggleHidden = React.useCallback(
    (panelKey: string) => {
      const hidden = prefs.hidden.includes(panelKey)
        ? prefs.hidden.filter((k) => k !== panelKey)
        : [...prefs.hidden, panelKey];
      // Hiding a pinned panel would leave a pin for something nobody can see.
      const pinned = prefs.pinned.filter((k) => k !== panelKey);
      persistPanels({ ...prefs, hidden, pinned });
    },
    [prefs, persistPanels],
  );

  const toggleWide = React.useCallback(
    (panelKey: string) => {
      const wide = prefs.wide.includes(panelKey)
        ? prefs.wide.filter((k) => k !== panelKey)
        : [...prefs.wide, panelKey];
      persistPanels({ ...prefs, wide });
    },
    [prefs, persistPanels],
  );

  /** Drag-and-drop result: `dragged` moved to sit before `before` (null = end). */
  const movePanel = React.useCallback(
    (dragged: string, before: string | null) => {
      if (dragged === before) return;
      const current = orderPanels(allKeys, prefs, order).filter((k) => !prefs.hidden.includes(k));
      const without = current.filter((k) => k !== dragged);
      const at = before === null ? without.length : without.indexOf(before);
      const next = [...without.slice(0, at < 0 ? without.length : at), dragged, ...without.slice(at < 0 ? without.length : at)];
      setOrder(next);
      if (userId) mergeIntoUserRow(userId, { [ORDER_KEY]: next });
    },
    [allKeys, prefs, order, userId],
  );

  /** Snapshot the current arrangement as a named layout. Returns true on save. */
  const saveNamed = React.useCallback(
    (name: string, density: DashboardDensity): boolean => {
      const trimmed = name.trim();
      if (!trimmed || !userId) return false;
      const layout: NamedLayout = {
        name: trimmed,
        panels: { pinned: [...prefs.pinned], hidden: [...prefs.hidden], wide: [...prefs.wide] },
        order: [...order],
        density,
        savedAt: getNowStamp(),
      };
      const next = { ...layouts, [trimmed]: layout };
      setLayouts(next);
      mergeIntoUserRow(userId, { [LAYOUTS_KEY]: next });
      return true;
    },
    [userId, prefs, order, layouts],
  );

  /**
   * Apply a named layout (or 'default'). Returns the layout's density so the
   * caller can sync it into UserPreferences — density's live home is there,
   * owned by the Settings tab, and this hook deliberately does not write it.
   */
  const applyNamed = React.useCallback(
    (name: string): DashboardDensity | null => {
      if (!userId) return null;
      if (name === 'default') {
        persistPanels(EMPTY_PANELS);
        setOrder([]);
        mergeIntoUserRow(userId, { [ORDER_KEY]: [] });
        return 'default';
      }
      const layout = layouts[name];
      if (!layout) return null;
      persistPanels(knownKeys(allKeys, layout.panels));
      setOrder(layout.order.filter((k) => allKeys.includes(k)));
      mergeIntoUserRow(userId, { [ORDER_KEY]: layout.order });
      return layout.density;
    },
    [userId, layouts, allKeys, persistPanels],
  );

  /** Delete a named layout. Returns true when something was deleted. */
  const deleteNamed = React.useCallback(
    (name: string): boolean => {
      if (!userId || !layouts[name]) return false;
      const next = { ...layouts };
      delete next[name];
      setLayouts(next);
      mergeIntoUserRow(userId, { [LAYOUTS_KEY]: next });
      return true;
    },
    [userId, layouts],
  );

  const reset = React.useCallback(() => {
    persistPanels(EMPTY_PANELS);
    setOrder([]);
    if (userId) mergeIntoUserRow(userId, { [ORDER_KEY]: [] });
  }, [persistPanels, userId]);

  return {
    prefs,
    order,
    layouts,
    togglePin,
    toggleHidden,
    toggleWide,
    movePanel,
    saveNamed,
    applyNamed,
    deleteNamed,
    reset,
    stamp: getNowStamp,
  };
};

export const PANEL_PREF_KEY = PREF_KEY;
