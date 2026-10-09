import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { isThemeMode, type ThemeMode } from '../../theme/theme';

interface Option {
  mode: ThemeMode;
  label: string;
  hint: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const OPTIONS: readonly Option[] = [
  { mode: 'light', label: 'Light', hint: 'Always light', Icon: Sun },
  { mode: 'dark', label: 'Dark', hint: 'Always dark', Icon: Moon },
  { mode: 'system', label: 'System', hint: 'Follow this device', Icon: Monitor },
];

/**
 * Three-state theme switch.
 *
 * A segmented control rather than a single toggle, because 'system' is a real
 * third choice and a two-state toggle can only hide it: users who pick Dark and
 * later want their laptop's dusk behaviour back would have no way back to
 * automatic. Each segment is a real radio so the current mode is announced, and
 * the whole group carries one label — three icon buttons with individual
 * tooltips read as three unrelated actions.
 *
 * Writes through the preferences hook, which persists to SQLite and mirrors to
 * localStorage; the paint itself belongs to useSettingsDomain, not here.
 */
export function ThemeToggle() {
  const { userPreferences, updateUserPreferences } = useApp();

  const current = isThemeMode(userPreferences.theme_mode) ? userPreferences.theme_mode : 'system';
  const currentLabel = OPTIONS.find((o) => o.mode === current)?.label ?? 'System';

  return (
    <div
      role="radiogroup"
      aria-label="Interface theme"
      title={`Theme: ${currentLabel}`}
      className="shrink-0 flex items-center gap-0.5 p-0.5 rounded-xl bg-slate-100/80 border border-slate-200/80"
    >
      {OPTIONS.map(({ mode, label, hint, Icon }) => {
        const active = mode === current;
        return (
          <button
            key={mode}
            role="radio"
            aria-checked={active}
            aria-label={hint}
            title={hint}
            onClick={() => updateUserPreferences({ theme_mode: mode })}
            className={[
              'w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer',
              active
                ? 'bg-white text-indigo-600 shadow-2xs ring-1 ring-slate-200/70'
                : 'text-slate-500 hover:text-slate-900 hover:bg-white/70',
            ].join(' ')}
          >
            <Icon className="w-4 h-4" />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}