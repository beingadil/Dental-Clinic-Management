import { useEffect, useState } from 'react';
import { BrandingSettings, UserPreferences } from '../../types';
import { settingsRepo } from '../../db/repos';
import { roundMoney } from '../../services/financeDomain';
import { isDatabaseReady } from '../../db/core';
import { DEFAULT_BRANDING_SETTINGS } from '../../db/defaults';
import { INITIAL_USER_PREFERENCES } from '../../data/initialData';

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

export function useSettingsDomain(): {
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
    // SQLite is the single source of truth (same as branding). Reading the
    // legacy localStorage mirror here instead silently RESET preferences to
    // defaults on every post-cutover boot — the persist effect below then
    // clobbered the user's saved choice in the settings table.
    if (isDatabaseReady()) {
      try {
        return (settingsRepo.get('preferences', 'global') as UserPreferences) || INITIAL_USER_PREFERENCES;
      } catch { /* fall through */ }
    }
    return INITIAL_USER_PREFERENCES;
  });

  // Global interface zoom — applied once on <html> from the single owner of
  // this setting. CSS `zoom` is already the app's print font-scale mechanism
  // and is honored by WebView2; @media print resets it so paper keeps true
  // sizes (see index.css).
  useEffect(() => {
    const z = userPreferences.ui_zoom;
    (document.documentElement.style as CSSStyleDeclaration & { zoom?: string }).zoom =
      z && z !== 1 ? String(z) : '';
  }, [userPreferences.ui_zoom]);

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
    dbWrite(() => settingsRepo.set('preferences', 'global', userPreferences));
  }, [userPreferences]);

  return { brandingSettings, setBrandingSettings, userPreferences, setUserPreferences };
}
