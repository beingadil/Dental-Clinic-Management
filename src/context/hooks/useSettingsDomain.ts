import { useEffect, useState } from 'react';
import { BrandingSettings, UserPreferences } from '../../types';
import { settingsRepo } from '../../db/repos';
import { isDatabaseReady } from '../../db/core';
import { DEFAULT_BRANDING_SETTINGS } from '../../db/defaults';
import { INITIAL_USER_PREFERENCES } from '../../data/initialData';
import { sqliteDb } from '../../services/sqliteDbService';

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
    return sqliteDb.settings.getBranding() || DEFAULT_BRANDING_SETTINGS;
  });

  const [userPreferences, setUserPreferences] = useState<UserPreferences>(() => {
    return sqliteDb.settings.getPreferences() || INITIAL_USER_PREFERENCES;
  });

  // Settings persist ONLY into the namespaced settings store (SQLite) —
  // the legacy dsw_* keys are no longer written (single source of truth).
  useEffect(() => {
    dbWrite(() => settingsRepo.set('branding', 'settings', brandingSettings));
  }, [brandingSettings]);
  useEffect(() => {
    dbWrite(() => settingsRepo.set('preferences', 'global', userPreferences));
  }, [userPreferences]);

  return { brandingSettings, setBrandingSettings, userPreferences, setUserPreferences };
}
