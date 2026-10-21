// @vitest-environment jsdom
/**
 * The first-run screen: the two states it can be in, and the theme switch
 * that sits in its header.
 *
 * The setup form is the first thing a new terminal ever shows, and it is
 * the only place the operator can create the account everything else hangs
 * off. The rail's switch is the other new thing: it writes the SAME
 * `theme_mode` preference Settings > Application Defaults writes, so the
 * two controls can never disagree about which theme is on.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const { STATE } = vi.hoisted(() => ({
  STATE: {
    users: [] as Array<{ role: string; isSuperAdmin?: boolean }>,
    themeMode: 'light' as 'light' | 'dark' | 'system',
    createInitialAdmin: vi.fn(async () => {}),
    updateUserPreferences: vi.fn(),
    login: vi.fn(async () => true),
    showToast: vi.fn(),
  },
}));

vi.mock('../../src/context/AppContext', () => ({
  useApp: () => ({
    users: STATE.users,
    login: STATE.login,
    showToast: STATE.showToast,
    createInitialAdmin: STATE.createInitialAdmin,
    userPreferences: { theme_mode: STATE.themeMode },
    updateUserPreferences: STATE.updateUserPreferences,
    brandingSettings: {
      appName: 'Dental Solutions',
      tagline: 'Dental Laboratory Information System',
      logoUrl: '',
    },
  }),
}));

import { LoginPage } from '../../src/components/auth/LoginPage';

afterEach(() => {
  cleanup();
  STATE.users = [];
  STATE.themeMode = 'light';
  STATE.createInitialAdmin.mockClear();
  STATE.updateUserPreferences.mockClear();
  STATE.login.mockClear();
  STATE.showToast.mockClear();
});

describe('LoginPage — first run', () => {
  it('asks for an administrator and says which state the terminal is in', () => {
    render(<LoginPage />);
    expect(screen.getByText('Create the administrator')).toBeTruthy();
    expect(screen.getByText('First run')).toBeTruthy();
  });

  it('keeps the submit button shut until the form is actually valid', () => {
    render(<LoginPage />);
    const submit = screen.getByRole('button', { name: /create administrator/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ada' } });
    // Still shut: the password is under the minimum.
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough1' } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it('creates the administrator with the values the operator typed', async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: '  Ada Lovelace ' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: ' ada ' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: /create administrator/i }));

    await waitFor(() => expect(STATE.createInitialAdmin).toHaveBeenCalledTimes(1));
    // The names are trimmed — a username with a trailing space is a different
    // username, and the operator would have to discover that at sign-in.
    expect(STATE.createInitialAdmin).toHaveBeenCalledWith('Ada Lovelace', 'ada', 'longenough1');
  });
});

describe('LoginPage — signing back in', () => {
  it('offers the sign-in form once an administrator exists', () => {
    STATE.users = [{ role: 'Super Admin', isSuperAdmin: true }];
    render(<LoginPage />);
    expect(screen.getByText('Welcome back')).toBeTruthy();
    expect(screen.getByText('Operator sign in')).toBeTruthy();
    expect(screen.queryByText('Create the administrator')).toBeNull();
  });
});

describe('LoginPage — the theme switch', () => {
  it('writes the same preference Settings writes, and only the two explicit modes', () => {
    STATE.themeMode = 'light';
    render(<LoginPage />);
    const sw = screen.getByRole('button', { name: /switch to the dark theme/i });

    fireEvent.click(sw);
    expect(STATE.updateUserPreferences).toHaveBeenCalledWith({ theme_mode: 'dark' });
  });

  it('offers the other theme when the terminal is in dark', () => {
    STATE.themeMode = 'dark';
    render(<LoginPage />);
    const sw = screen.getByRole('button', { name: /switch to the light theme/i });

    fireEvent.click(sw);
    expect(STATE.updateUserPreferences).toHaveBeenCalledWith({ theme_mode: 'light' });
  });

  it('turns a system theme into an explicit one on first use', () => {
    STATE.themeMode = 'system';
    // The device says dark, so the switch offers light.
    (window as any).matchMedia = () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    render(<LoginPage />);
    const sw = screen.getByRole('button', { name: /switch to the light theme/i });

    fireEvent.click(sw);
    expect(STATE.updateUserPreferences).toHaveBeenCalledWith({ theme_mode: 'light' });
  });
});
