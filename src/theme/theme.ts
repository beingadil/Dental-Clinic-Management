/**
 * Theme ownership.
 *
 * The theme is a persisted preference (`theme_mode`: light | dark | system)
 * with a localStorage mirror. The mirror exists for one reason: the app is an
 * offline SPA that boots by loading a WASM database before it can read
 * SQLite, so a theme restored from the database alone would repaint the whole
 * UI light first and then dark — a visible flash on every launch.
 *
 * `applyStoredTheme()` runs synchronously at module load (before React
 * renders), so the first painted frame is already correct. Once SQLite
 * hydrates, the database is authoritative and overwrites the mirror.
 *
 * No component may read `document.documentElement.classList` directly; the
 * three functions here are the whole surface.
 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/**
 * Bumped when the stored shape changes. An unknown/legacy value resolves to
 * `system` rather than throwing — a corrupt preference must never be able to
 * stop the app from painting.
 */
const STORAGE_KEY = 'dental.theme.mode';

const MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

function readSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

export function readStoredTheme(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isThemeMode(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Write the class + the browser-chrome colour.
 *
 * `colorScheme` is set as well as the class: it is what makes native form
 * controls, scrollbars and the `<select>` dropdown popups render dark, none of
 * which a class alone can reach. The `theme-color` meta tag follows for the
 * WebView/OS title bar, which is otherwise stuck on the light value.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = resolved === 'dark' ? '#0b1220' : '#4f46e5';
}

/** Cache the preference and paint it. Called on every mode change. */
export function persistTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode / storage disabled — the session still themes correctly */
  }
  applyTheme(resolveTheme(mode, readSystemPrefersDark()));
}

/**
 * Paint from the localStorage mirror without writing to it. Must be called
 * before the first render.
 */
export function applyStoredTheme(): void {
  applyTheme(resolveTheme(readStoredTheme(), readSystemPrefersDark()));
}