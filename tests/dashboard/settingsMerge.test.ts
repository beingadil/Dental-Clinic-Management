/**
 * The shared user_preferences row.
 *
 * One JSON blob per user holds BOTH `UserPreferences` (currency, channels,
 * quiet hours, the dashboard drag lock) AND the dashboard layout keys. That
 * sharing is the root of three separate data-loss bugs: two writers replaced
 * the whole row and each wiped the other's half. The merge is now a pure
 * function so that contract is testable without booting SQLite.
 */
import { describe, it, expect } from 'vitest';
import { mergePreferencesIntoRow, DASHBOARD_ROW_KEYS } from '../../src/context/hooks/useSettingsDomain';
import { INITIAL_USER_PREFERENCES } from '../../src/data/initialData';
import type { UserPreferences } from '../../src/types';

const prefs = (over: Partial<UserPreferences> = {}): UserPreferences =>
  ({ ...INITIAL_USER_PREFERENCES, ...over }) as UserPreferences;

describe('mergePreferencesIntoRow', () => {
  it('keeps saved dashboard layouts when an unrelated preference changes', () => {
    const row = {
      currency: 'USD',
      'dashboard.layouts': { Morning: { name: 'Morning' } },
      'dashboard.order': ['revenue', 'workflow'],
    };
    const merged = mergePreferencesIntoRow(row, prefs({ currency: 'EUR' }));
    expect(merged['dashboard.layouts']).toEqual({ Morning: { name: 'Morning' } });
    expect(merged['dashboard.order']).toEqual(['revenue', 'workflow']);
    expect(merged.currency).toBe('EUR');
  });

  it('keeps panel pin/hide state when density changes', () => {
    const row = { 'dashboard.panels': { pinned: ['revenue'], hidden: [], wide: [] } };
    const merged = mergePreferencesIntoRow(row, prefs({ dashboard_density: 'compact' }));
    expect(merged['dashboard.panels']).toEqual({ pinned: ['revenue'], hidden: [], wide: [] });
    expect(merged.dashboard_density).toBe('compact');
  });

  it('persists the drag lock as a field on the preferences object', () => {
    // The bug this whole file guards: the toggle read a dotted
    // `dashboard.layoutId` that nothing ever wrote, so unlocking moved the
    // state without ever showing it.
    const merged = mergePreferencesIntoRow({}, prefs({ dashboard_layout_id: 'custom' }));
    expect(merged.dashboard_layout_id).toBe('custom');
    expect(merged['dashboard.layoutId']).toBeUndefined();
  });

  it('does not invent a dashboard key that was never saved', () => {
    const merged = mergePreferencesIntoRow({ currency: 'USD' }, prefs());
    for (const k of DASHBOARD_ROW_KEYS) expect(k in merged).toBe(false);
  });

  it('survives a missing or corrupted row', () => {
    expect(mergePreferencesIntoRow(undefined, prefs({ ui_zoom: 1.1 })).ui_zoom).toBe(1.1);
    expect(mergePreferencesIntoRow('garbage', prefs({ ui_zoom: 1.1 })).ui_zoom).toBe(1.1);
    expect(mergePreferencesIntoRow(null, prefs({ ui_zoom: 1.1 })).ui_zoom).toBe(1.1);
  });

  it('round-trips a full row through two independent writes', () => {
    // Layout half written by the dashboard hook...
    let row: Record<string, unknown> = mergePreferencesIntoRow({}, prefs());
    row = { ...row, 'dashboard.layouts': { Morning: { name: 'Morning' } } };
    // ...then the preferences half written by the settings domain.
    row = mergePreferencesIntoRow(row, prefs({ dashboard_layout_id: 'custom' }));
    expect(row['dashboard.layouts']).toEqual({ Morning: { name: 'Morning' } });
    expect(row.dashboard_layout_id).toBe('custom');
  });

  it('does not let a stale dotted key in preferences state clobber a fresh layout', () => {
    // The real failure: hydration loads the whole row — dotted keys included —
    // into UserPreferences state, so the NEXT settings write spread that stale
    // `dashboard.layouts` over the one the user had just saved. Traced live as
    // two consecutive repo writes, the second one dropping the new layout.
    const freshRow = { 'dashboard.layouts': { Morning: { name: 'Morning' }, Evening: { name: 'Evening' } } };
    const prefsWithStaleCopy = { ...(INITIAL_USER_PREFERENCES as object), 'dashboard.layouts': { Morning: { name: 'Morning' } } } as unknown as UserPreferences;
    const merged = mergePreferencesIntoRow(freshRow, prefsWithStaleCopy);
    expect(Object.keys(merged['dashboard.layouts'] as object)).toEqual(['Morning', 'Evening']);
  });

  it('hydrates over the defaults, so a layout-only row is not read as "no preferences"', () => {
    // A row the dashboard hook created before the settings domain ever wrote
    // holds only dashboard keys. Loading it verbatim loads "no preferences" as
    // real state, and the next persist writes that hole back to disk.
    const layoutOnlyRow = { 'dashboard.panels': {}, 'dashboard.order': [] };
    const hydrated = { ...INITIAL_USER_PREFERENCES, ...layoutOnlyRow } as UserPreferences;
    expect(hydrated.channels).toEqual(INITIAL_USER_PREFERENCES.channels);
    expect(hydrated.quiet_hours_start).toBe(INITIAL_USER_PREFERENCES.quiet_hours_start);

    // And a saved value still wins over the default.
    const saved = { ...INITIAL_USER_PREFERENCES, ...layoutOnlyRow, channels: ['in_app'] } as UserPreferences;
    expect(saved.channels).toEqual(['in_app']);
  });
});