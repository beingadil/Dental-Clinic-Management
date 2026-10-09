import { useEffect, useState } from 'react';
import { BrandingSettings, UserPreferences } from '../../types';
import { settingsRepo } from '../../db/repos';
import { userPreferencesRepo } from '../../db/userPreferencesRepo';
import { roundMoney } from '../../services/financeDomain';
import { isDatabaseReady } from '../../db/core';
import { DEFAULT_BRANDING_SETTINGS } from '../../db/defaults';
import { INITIAL_USER_PREFERENCES } from '../../data/initialData';
import type { UserProfile } from '../../types';
import { isThemeMode, persistTheme, applyTheme } from '../../theme/theme';

/**
 * Settings domain state (branding + global user preferences), hydrated from
 * SQLite and persisted back on change. Extracted from AppContext with an
 * identical surface: callers receive the same state values and raw setters,
 * so restore/wipe flows keep setting them directly.
 *
 * DB writes no-op when the engine is not booted (tests) — same contract as
 * AppContext's dbWrite helper.
 */
function dbWrite(fn: () => void): void {
  if (!isDatabaseReady()) return;
  try {
    fn();
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[cutover] DB write failed:', e?.message || e);
  }
}

/**
 * The dashboard keys this module must not clobber. They live in the same JSON
 * row as UserPreferences but belong to `useDashboardLayout`.
 *
 * The drag lock is deliberately absent: it is the `dashboard_layout_id` FIELD
 * ON the preferences object, not a dotted key, so it rides along in the
 * preferences half of the merge.
 */
export const DASHBOARD_ROW_KEYS = ['dashboard.panels', 'dashboard.layouts', 'dashboard.order'];

/**
 * The preference half of the row, with the namespaced dashboard keys removed.
 *
 * Hydration loads a whole row into UserPreferences state, and that row also
 * carries `dashboard.layouts`. A stale copy riding along in state then wins
 * the merge below and silently discards the layout the user saved a moment
 * ago — the toggle appeared to work, then the layout vanished on the next
 * settings write. Dotted keys belong to the layout half; they never belong in
 * a preferences object, so they are dropped on the way in and on the way out.
 */
function preferenceFields(source: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!source || typeof source !== 'object') return out;
  for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
    if (!k.includes('.')) out[k] = v;
  }
  return out;
}

/**
 * Merge a UserPreferences object into the per-user row WITHOUT dropping the
 * dashboard keys stored beside it.
 *
 * The row is shared, and whoever writes last wins unless it reads first. Only
 * the dashboard keys actually present are carried over, so an absent key is
 * not resurrected as `undefined`.
 */
export function mergePreferencesIntoRow(existing: unknown, prefs: UserPreferences): Record<string, unknown> {
  const savedLayouts: Record<string, unknown> = {};
  if (existing && typeof existing === 'object') {
    const row = existing as Record<string, unknown>;
    for (const k of DASHBOARD_ROW_KEYS) {
      if (k in row) savedLayouts[k] = row[k];
    }
  }
  return { ...savedLayouts, ...preferenceFields(prefs) };
}

export function useSettingsDomain(user?: UserProfile | null): {
  brandingSettings: BrandingSettings;
  setBrandingSettings: React.Dispatch<React.SetStateAction<BrandingSettings>>;
  userPreferences: UserPreferences;
  setUserPreferences: React.Dispatch<React.SetStateAction<UserPreferences>>;
} {
  const [brandingSettings, setBrandingSettings] = useState<BrandingSettings>(() => {
    if (isDatabaseReady()) {
      try { return settingsRepo.get('branding', 'settings') as BrandingSettings || DEFAULT_BRANDING_SETTINGS; } catch { /* fall through */ }
    }
    return DEFAULT_BRANDING_SETTINGS;
  });

  const [userPreferences, setUserPreferences] = useState<UserPreferences>(() => {
    // SQLite is the single source of truth (same as branding). D4: prefer
    // the signed-in user's own row; fall back to the legacy global blob for
    // users who have never saved, then shipped defaults.
    if (isDatabaseReady()) {
      try {
        if (user?.id) {
          const own = userPreferencesRepo.get(user.id) as Partial<UserPreferences> | undefined;
          // Layered over the defaults, never replacing them. This row is
          // SHARED with the dashboard layout keys, so a row that only the
          // layout hook ever wrote holds no preference fields at all —
          // returning it verbatim would load "no preferences" as real state,
          // and the next persist would then write that hole back to disk.
          if (own && typeof own === 'object') return { ...INITIAL_USER_PREFERENCES, ...preferenceFields(own) } as UserPreferences;
        }
        return (settingsRepo.get('preferences', 'global') as UserPreferences) || INITIAL_USER_PREFERENCES;
      } catch { /* fall through */ }
    }
    return INITIAL_USER_PREFERENCES;
  });

  // D4: a login switch rehydrates that user's saved preferences.
  useEffect(() => {
    if (!user?.id || !isDatabaseReady()) return;
    try {
      const own = userPreferencesRepo.get(user.id) as Partial<UserPreferences> | undefined;
      if (own && typeof own === 'object') setUserPreferences({ ...INITIAL_USER_PREFERENCES, ...preferenceFields(own) } as UserPreferences);
      // No row yet: keep the current (legacy global / default) values — the
      // next save writes this user's own row.
    } catch { /* best-effort hydration */ }
  }, [user?.id]);

  // Global interface zoom — applied once on <html> from the single owner of
  // this setting. CSS `zoom` is already the app's print font-scale mechanism
  // and is honored by WebView2; @media print resets it so paper keeps true
  // sizes (see index.css).
  useEffect(() => {
    const z = userPreferences.ui_zoom;
    (document.documentElement.style as CSSStyleDeclaration & { zoom?: string }).zoom =
      z && z !== 1 ? String(z) : '';
  }, [userPreferences.ui_zoom]);

  // Global theme. The database is the source of truth for the PREFERENCE; the
  // localStorage mirror (theme.ts) only carries it across the WASM boot window,
  // so it is written on every change rather than once. Paint happens here and
  // not inside the setter so a raw setUserPreferences from a restore/wipe flow
  // themes too. An absent or corrupt value means 'system', never a crash.
  useEffect(() => {
    const raw = userPreferences.theme_mode;
    const mode = isThemeMode(raw) ? raw : 'system';
    persistTheme(mode);

    // 'system' is a live subscription, not a one-shot read: the OS flipping at
    // dusk has to repaint an already-open app.
    if (mode !== 'system') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light');
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    // Safari < 14 / older WebView2 only has the deprecated API.
    const legacy = mq as MediaQueryList & { addListener?: (cb: (e: MediaQueryListEvent) => void) => void; removeListener?: (cb: (e: MediaQueryListEvent) => void) => void };
    legacy.addListener?.(onChange);
    return () => legacy.removeListener?.(onChange);
  }, [userPreferences.theme_mode]);

  // Settings persist ONLY into the namespaced settings store (SQLite) —
  // the legacy dsw_* keys are no longer written (single source of truth).
  // Money-adjacent settings are rounded through the shared policy on write.
  useEffect(() => {
    const safeBranding = brandingSettings?.warningThresholdHours !== undefined
      ? { ...brandingSettings, warningThresholdHours: roundMoney(brandingSettings.warningThresholdHours) }
      : brandingSettings;
    dbWrite(() => settingsRepo.set('branding', 'settings', safeBranding));
  }, [brandingSettings]);
  useEffect(() => {
    dbWrite(() => {
      // D4: signed-in users get their own row; the legacy global blob stays
      // as the fallback for pre-login surfaces.
      //
      // The row is SHARED with the dashboard layout keys (owned by
      // useDashboardLayout), so this write MERGES rather than replaces — see
      // mergePreferencesIntoRow. A best-effort read failure degrades to a
      // plain write of the preferences, never to a thrown persist.
      let merged: Record<string, unknown> | null = null;
      if (user?.id) {
        try {
          merged = mergePreferencesIntoRow(userPreferencesRepo.get(user.id), userPreferences);
        } catch { merged = null; /* best-effort; worst case the user re-arranges */ }
      }
      if (user?.id && merged) userPreferencesRepo.set(user.id, merged);
      settingsRepo.set('preferences', 'global', userPreferences);
    });
  }, [userPreferences, user?.id]);

  return { brandingSettings, setBrandingSettings, userPreferences, setUserPreferences };
}
