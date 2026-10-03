/**
 * Per-user dashboard layout.
 *
 * Which panels a person pins, hides, or widens is a personal view of the same
 * data, not a change to the data — so it belongs in `user_preferences` beside
 * the other UI choices that follow the person rather than the machine.
 *
 * Reads are defensive on purpose: this file is written by an older build than
 * the one reading it, and a partial object (or a corrupted JSON blob that
 * `userPreferencesRepo.get` already swallows) must never blank the dashboard.
 * Every field falls back to its default, and an unknown panel key is ignored
 * rather than rendered as an empty card.
 */
import React from 'react';
import { userPreferencesRepo } from '../../db/userPreferencesRepo';
import { getNowStamp } from '../../utils/dateUtils';

export type PanelWidth = 'full' | 'half';

export interface PanelPrefs {
  /** Panel keys pinned to the top, in the order the user pinned them. */
  pinned: string[];
  /** Panel keys the user has switched off. */
  hidden: string[];
  /** Panels widened to span two masonry columns. */
  wide: string[];
}

const PREF_KEY = 'dashboard.panels';

const EMPTY: PanelPrefs = { pinned: [], hidden: [], wide: [] };

/**
 * Reads this key out of a user's preference blob.
 *
 * The blob is namespaced (`{ "dashboard.panels": {...} }`) so dashboard
 * preferences can share the row with other per-user settings without either
 * clobbering the other. Unwrapping belongs here, in one place, so the read and
 * the write can never disagree about the shape — which is exactly how an
 * earlier version of this file silently lost every saved layout.
 */
function readStored(raw: unknown): PanelPrefs {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const inner = (raw as Record<string, unknown>)[PREF_KEY];
  return (inner ?? EMPTY) as PanelPrefs;
}

/** Panel keys we know about. Anything else in storage is dropped on read. */
export function knownKeys(all: string[], prefs: PanelPrefs): PanelPrefs {
  const ok = new Set(all);
  const keep = (xs: string[]) => xs.filter((k) => ok.has(k));
  return { pinned: keep(prefs.pinned), hidden: keep(prefs.hidden), wide: keep(prefs.wide) };
}

export function parsePrefs(raw: unknown, allKeys: string[]): PanelPrefs {
  const asList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const r = (raw ?? {}) as Partial<PanelPrefs>;
  return knownKeys(allKeys, {
    pinned: asList(r.pinned),
    hidden: asList(r.hidden),
    wide: asList(r.wide),
  });
}

/**
 * Where a panel sits in the layout.
 *
 * Pinned panels come first, in the user's order. The rest keep the canonical
 * dashboard order so two people looking at the same day see the same reading
 * order unless they have deliberately rearranged it.
 */
export function orderPanels(keys: string[], prefs: PanelPrefs): string[] {
  const pinned = prefs.pinned.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !prefs.pinned.includes(k));
  return [...pinned, ...rest];
}

/** The panels to actually render, and how wide each is. */
export function visiblePanels(
  keys: string[],
  prefs: PanelPrefs,
): { keys: string[]; spans: Record<string, number> } {
  const visible = orderPanels(keys, prefs).filter((k) => !prefs.hidden.includes(k));
  const spans: Record<string, number> = {};
  for (const k of visible) spans[k] = prefs.wide.includes(k) ? 2 : 1;
  return { keys: visible, spans };
}

export const useDashboardLayout = (userId: string | undefined, allKeys: string[]) => {
  const key = allKeys.join('|');
  const [prefs, setPrefs] = React.useState<PanelPrefs>(EMPTY);

  // Load on mount and whenever the signed-in user changes.
  React.useEffect(() => {
    if (!userId) {
      setPrefs(EMPTY);
      return;
    }
    setPrefs(parsePrefs(readStored(userPreferencesRepo.get(userId)), allKeys));
    // `key` stands in for allKeys' contents; the array identity changes every
    // render and would reload preferences on every keystroke elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, key]);

  const persist = React.useCallback(
    (next: PanelPrefs) => {
      setPrefs(next);
      // Not signed in (or signed out mid-session): keep the change in memory for
      // this render rather than throwing it away, and let it save on next login.
      if (userId) userPreferencesRepo.set(userId, { [PREF_KEY]: next });
    },
    [userId],
  );

  const togglePin = React.useCallback(
    (panelKey: string) => {
      const pinned = prefs.pinned.includes(panelKey)
        ? prefs.pinned.filter((k) => k !== panelKey)
        : [...prefs.pinned, panelKey];
      persist({ ...prefs, pinned });
    },
    [prefs, persist],
  );

  const toggleHidden = React.useCallback(
    (panelKey: string) => {
      const hidden = prefs.hidden.includes(panelKey)
        ? prefs.hidden.filter((k) => k !== panelKey)
        : [...prefs.hidden, panelKey];
      // Hiding a pinned panel would leave a pin for something nobody can see.
      const pinned = prefs.pinned.filter((k) => k !== panelKey);
      persist({ ...prefs, hidden, pinned });
    },
    [prefs, persist],
  );

  const toggleWide = React.useCallback(
    (panelKey: string) => {
      const wide = prefs.wide.includes(panelKey)
        ? prefs.wide.filter((k) => k !== panelKey)
        : [...prefs.wide, panelKey];
      persist({ ...prefs, wide });
    },
    [prefs, persist],
  );

  const reset = React.useCallback(() => {
    persist(EMPTY);
    if (userId) {
      const raw = userPreferencesRepo.get(userId) as Record<string, unknown> | undefined;
      if (raw && PREF_KEY in raw) {
        const next = { ...raw };
        delete next[PREF_KEY];
        userPreferencesRepo.set(userId, next);
      }
    }
  }, [persist, userId]);

  return { prefs, togglePin, toggleHidden, toggleWide, reset, stamp: getNowStamp };
};

export const PANEL_PREF_KEY = PREF_KEY;