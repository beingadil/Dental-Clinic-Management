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

  const idx = OPTIONS.findIndex((o) => o.mode === current);

  return (
    <div
      role="radiogroup"
      aria-label="Interface theme"
      title={`Theme: ${currentLabel}`}
      className="ds-theme-toggle relative shrink-0 flex items-center gap-0.5 p-0.5 rounded-full bg-white/30 border border-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
    >
      {/* One thumb sliding beneath three peers, not three buttons swapping
          fills — the switch itself is the motion you feel. */}
      <span className="ds-toggle-thumb" aria-hidden="true" style={{ transform: `translateX(${Math.max(0, idx) * 100}%)` }} />
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
              'relative z-10 w-8 h-8 flex items-center justify-center rounded-full cursor-pointer',
              'transition-[color,transform] duration-[220ms] [transition-timing-function:cubic-bezier(.32,.72,0,1)] active:scale-95',
              active
                ? 'text-indigo-600'
                : 'text-slate-500 hover:text-slate-900',
            ].join(' ')}
          >
            <Icon className={`w-4 h-4 transition-transform duration-[260ms] [transition-timing-function:cubic-bezier(.32,.72,0,1)] ${active ? 'scale-110' : 'scale-100'}`} />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}