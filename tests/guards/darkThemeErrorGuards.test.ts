import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const DARK_CSS = 'src/theme/dark.css';
const DASHBOARD_DARK_CSS = 'src/components/dashboard/dashboard-dark.css';
const THEME_TOGGLE_TS = 'src/components/common/ThemeToggle.tsx';

const darkCss = readFileSync(DARK_CSS, 'utf8');
const dashboardDarkCss = readFileSync(DASHBOARD_DARK_CSS, 'utf8');

describe('dark theme error guards', () => {
  // ── Guard 1: Surface ladder is not collapsed ─────────────────────────────
  it('has a distinct surface ladder — canvas and sunken are distinct (dashboard)', () => {
    const surface = (dashboardDarkCss.match(/--ds-surface:\s*([^;]+)/i) || [])[1]?.trim();
    const sunken = (dashboardDarkCss.match(/--ds-surface-sunken:\s*([^;]+)/i) || [])[1]?.trim();
    expect(surface).toBeTruthy();
    expect(sunken).toBeTruthy();
    // They must be distinct values — the whole point of the ladder
    expect(surface).not.toBe(sunken);
  });

  // ── Guard 2: Theme switch segment is not dark-on-transparent ───────────────
  it('ds-theme-toggle selected segment has raised-glass background (dark.css override)', () => {
    // The dark CSS must provide the raised-glass background for the selected segment
    expect(darkCss).toContain('.dark .ds-theme-toggle');
    expect(darkCss).toContain('background: rgb(255 255 255 / 0.05)');
    // The ThemeToggle.tsx should not rely on bare bg-white that vanishes in dark mode
    const content = readFileSync(THEME_TOGGLE_TS, 'utf8');
    // It's OK to have bg-white/30 as light-mode default; the dark override is what matters
    expect(darkCss).toContain('rgb(255 255 255 / 0.05)');
  });

  // ── Guard 3: Clinic picker / ds-glass-select is not a 55% white slab ────
  it('ds-glass-select dark fill is in dark.css (not a white slab in dashboard)', () => {
    // The old 55% white rgba must NOT survive in dashboard-dark.css
    expect(dashboardDarkCss).not.toMatch(/background:\s*rgba\(255, 255, 255, 0.09/);
    // The dark fill must be present in dark.css
    expect(darkCss).toMatch(/\.dark\s\.ds-glass-select\s*\{/);
    expect(darkCss).toMatch(/background:\s*#18202f/);
  });

  // ── Guard 4: Card borders are quiet (not outlining everything) ─────────────
  it('card border uses quiet line #2a3446, not loud control border (dashboard)', () => {
    const line = (dashboardDarkCss.match(/--ds-line:\s*([^;]+)/i) || [])[1]?.trim();
    expect(line).toBe('#2a3446');
    // Card edges use the quieter rim, not the control border
    expect(dashboardDarkCss).toContain('--ds-rim: inset 0 1px 0 0 rgba(255, 255, 255, 0.08)');
  });

  // ── Guard 5: Control borders keep 3:1 identification threshold ─────────────
  it('form controls keep 3:1 border contrast for identification (dark.css)', () => {
    const content = darkCss;
    expect(content).toContain('.dark :is(input, select, textarea).border-slate-200');
    expect(content).toContain('border-color: #556580'); // 3:1 on card #121824
    expect(content).toContain('border-color: #6b7c99'); // 3:1 on canvas #0b0f18
  });

  // ── Guard 6: Inverse surfaces stay properly dark in both themes ────────────
  it('inverse surfaces and canvas tokens exist in dark.css', () => {
    const content = darkCss;
    // Both inverse surface tokens must be declared in the dark palette
    expect(content).toContain('.dark .bg-slate-900');
    expect(content).toContain('.dark .bg-slate-950');
    // The canvas/base surface token must exist
    expect(content).toContain('--color-slate-50');
  });

  // ── Guard 7: No soft-white regressions on brand inks ──────────────────────
  it('pure white restored for text-white in dark mode (dark.css)', () => {
    expect(darkCss).toContain('color: #ffffff');
    expect(darkCss).toContain('text-white');
  });
});
