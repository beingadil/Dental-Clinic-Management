import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { isThemeMode, resolveTheme, type ThemeMode } from '../../theme/theme';
import {
  Lock,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  AlertCircle,
  Building2,
  Sun,
  Moon,
} from 'lucide-react';

export const LoginPage: React.FC = () => {
  const {
    login,
    brandingSettings,
    showToast,
    users,
    createInitialAdmin,
    userPreferences,
    updateUserPreferences,
  } = useApp();

  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupName, setSetupName] = useState('');
  const [setupUsername, setSetupUsername] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupBusy, setSetupBusy] = useState(false);

  /* Password strength — scored 0-4 from length, case mix, digits, symbols. */
  const passwordStrength = (pw: string): number => {
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^a-zA-Z\d]/.test(pw)) score++;
    return score;
  };

  const appName = brandingSettings.appName || 'Dental Solutions';
  const tagline = brandingSettings.tagline || 'Dental Laboratory Information System';

  // First-run setup ONLY when the local database has no admin account yet.
  useEffect(() => {
    setNeedsSetup(!users.some((u) => u.role === 'Super Admin' || u.isSuperAdmin));
  }, [users]);

  // Load remembered user
  useEffect(() => {
    const remembered = localStorage.getItem('dsw_remember_user');
    if (remembered) {
      setUsernameOrEmail(remembered);
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!usernameOrEmail.trim()) {
      setError('Enter your username or email address.');
      return;
    }

    if (!password) {
      setError('Enter your password.');
      return;
    }

    setIsSubmitting(true);
    // `rememberMe` is honoured inside useAuthDomain.login, which owns the
    // dsw_remember_user key — do not write it from here as well.
    login(usernameOrEmail, password, rememberMe)
      .then((success) => {
        setIsSubmitting(false);
        if (!success) {
          setError('Incorrect username or password.');
        }
      })
      .catch(() => {
        setIsSubmitting(false);
        setError('Sign-in failed. Please try again.');
      });
  };

  const handleCreateAdmin = async () => {
    setSetupBusy(true);
    try {
      await createInitialAdmin(setupName.trim(), setupUsername.trim(), setupPassword);
      showToast('Administrator account created. Please sign in.', 'success');
      setNeedsSetup(false);
    } finally {
      setSetupBusy(false);
    }
  };

  const setupReady =
    !!setupName.trim() && !!setupUsername.trim() && setupPassword.length >= 8 && !setupBusy;

  /* ── The theme switch ────────────────────────────────────────────────
     The preference is the same one Settings > Application Defaults writes,
     so the switch here and the three-way control there can never disagree:
     both go through `theme_mode`, and the database owns it.
     This screen offers the two explicit modes only. "System" is still one
     click away in Settings, but a button on a first-run screen should say
     what it does, and a sun-and-moon pair says it in a glance. */
  const themeMode: ThemeMode = isThemeMode(userPreferences?.theme_mode)
    ? userPreferences.theme_mode
    : 'system';

  /* 'system' is a live subscription, not a one-shot read: the OS flipping at
     dusk has to move the switch with it. */
  const [prefersDark, setPrefersDark] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    // Safari < 14 / older WebView2 only has the deprecated API.
    const legacy = mq as MediaQueryList & {
      addListener?: (cb: (e: MediaQueryListEvent) => void) => void;
      removeListener?: (cb: (e: MediaQueryListEvent) => void) => void;
    };
    legacy.addListener?.(onChange);
    return () => legacy.removeListener?.(onChange);
  }, []);

  const isDark = resolveTheme(themeMode, prefersDark) === 'dark';
  const switchTheme = () =>
    updateUserPreferences({ theme_mode: isDark ? 'light' : 'dark' });

  return (
    <div className="app-atmos auth-stage relative flex min-h-[100dvh] flex-col bg-slate-50 text-slate-900 selection:bg-brand-600 selection:text-white">
      {/*
        The lighting rig: one key light from above and to the right, the pool
        it lands in, and a vignette that lets the corners fall away. Painted
        BEHIND everything, so no word ever sits on a gradient and the
        contrast audit keeps grading the ink against a real surface.
      */}
      <div className="auth-stage-lighting" aria-hidden="true" />

      {/* ── Top matte ───────────────────────────────────────────────────
          The slate header: what state this terminal is in, and what build it
          is running. No brand name — the title card carries that, and saying
          it twice on one screen is noise. */}
      <header className="auth-rail flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 sm:px-10">
        <span className="auth-rail-label flex items-center gap-2.5 text-slate-500">
          <span className="auth-tally" aria-hidden="true" />
          {needsSetup ? 'First run' : 'Operator sign in'}
        </span>
        <span className="flex items-center gap-4">
          <span className="auth-rail-version text-slate-500">v{__APP_VERSION__}</span>
          <button
            type="button"
            onClick={switchTheme}
            aria-label={isDark ? 'Switch to the light theme' : 'Switch to the dark theme'}
            title={isDark ? 'Switch to the light theme' : 'Switch to the dark theme'}
            className="auth-chip flex h-7 w-7 items-center justify-center rounded-full text-slate-600 transition-colors hover:text-slate-900"
          >
            {isDark ? (
              <Sun className="h-3.5 w-3.5" strokeWidth={1.75} />
            ) : (
              <Moon className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
          </button>
        </span>
      </header>

      <main className="mx-auto grid w-full max-w-[1240px] flex-1 items-center gap-10 px-6 py-8 sm:px-10 lg:grid-cols-[1.04fr_0.96fr] lg:gap-16 lg:py-10">
        {/* ── Title card ───────────────────────────────────────────────
            The product's first impression, and its first flavour: a lit
            bench, a name set the way a title card sets a name, and one line
            that says what the thing actually is. */}
        {/* The title card and the console share one measure when they stack,
            so their left edges line up instead of the title hugging the
            margin and the pane floating in the middle. */}
        <section className="auth-title-card mx-auto w-full max-w-[27rem] lg:mx-0 lg:max-w-xl">
          {brandingSettings.logoUrl ? (
            <img
              src={brandingSettings.logoUrl}
              alt=""
              aria-hidden="true"
              className="mb-7 h-9 w-auto max-w-[150px] object-contain"
            />
          ) : (
            <div className="mb-7 flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600">
              <Building2 className="h-4.5 w-4.5 text-white" strokeWidth={1.75} />
            </div>
          )}

          <p className="auth-eyebrow text-slate-500">{tagline}</p>

          <h1 className="auth-title mt-4 text-slate-900">{appName}</h1>

          <p className="auth-logline mt-6 max-w-[46ch] text-slate-600">
            Cases, clinics, invoices and the ledger, running on this terminal with no server to
            depend on.
          </p>

          <p className="auth-spec mt-9 text-slate-500">
            Local SQLite &middot; Offline-first &middot; Single terminal
          </p>
        </section>

        {/* ── The console ─────────────────────────────────────────────
            A pane of frosted glass, standing in the pool of light. The words
            sit on the pane, not on the room behind it, so what is refracted
            through the glass is never what a word is read against. */}
        <section className="auth-console auth-glass w-full max-w-[27rem] justify-self-center rounded-[28px] px-7 py-7 sm:px-8 sm:py-8 lg:justify-self-end">
          {needsSetup ? (
            <>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                Create the administrator
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                This terminal has no administrator yet. The first account you create receives the
                Super Admin role.
              </p>

              <form
                className="mt-8 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (setupReady) void handleCreateAdmin();
                }}
              >
                <div className="space-y-2">
                  <label htmlFor="setup-name" className="auth-field-label text-slate-600">
                    Full name
                  </label>
                  <input
                    id="setup-name"
                    value={setupName}
                    onChange={(e) => setSetupName(e.target.value)}
                    placeholder="Administrator's full name"
                    autoComplete="name"
                    autoFocus
                    className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-600 transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="setup-username" className="auth-field-label text-slate-600">
                    Username
                  </label>
                  <input
                    id="setup-username"
                    value={setupUsername}
                    onChange={(e) => setSetupUsername(e.target.value)}
                    placeholder="Used to sign in"
                    autoComplete="username"
                    className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-600 transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="setup-password" className="auth-field-label text-slate-600">
                    Password
                  </label>
                  <input
                    id="setup-password"
                    type="password"
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    autoComplete="new-password"
                    className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-600 transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                  {setupPassword.length > 0 && setupPassword.length < 8 && (
                    <p className="text-[11px] text-slate-500">
                      {8 - setupPassword.length} more character
                      {8 - setupPassword.length === 1 ? '' : 's'} needed
                    </p>
                  )}
                  {setupPassword.length > 0 && (() => {
                    /* Derived once: the bar fill, its colour and the word are
                       three views of one verdict, so they cannot drift into
                       saying different things. */
                    const strength = passwordStrength(setupPassword);
                    const longEnough = setupPassword.length >= 8;
                    const verdict = !longEnough
                      ? { bar: 'bg-rose-500', text: 'text-rose-700', word: strength >= 2 ? 'Fair' : 'Weak' }
                      : strength >= 3
                        ? { bar: 'bg-emerald-600', text: 'text-emerald-700', word: 'Strong' }
                        : { bar: 'bg-amber-500', text: 'text-amber-700', word: 'Good' };
                    return (
                      <div className="mt-1.5">
                        <div className="flex items-center gap-2.5">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${verdict.bar}`}
                              style={{ width: `${(strength / 4) * 100}%` }}
                            />
                          </div>
                          <span
                            className={`text-[10px] font-bold uppercase tracking-[0.12em] ${verdict.text}`}
                          >
                            {verdict.word}
                          </span>
                        </div>
                        {longEnough && strength < 3 && (
                          <p className="mt-1 text-[11px] text-slate-500">
                            Mix in upper case, a number and a symbol to harden it.
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <button
                  type="submit"
                  disabled={!setupReady}
                  className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-lg bg-brand-600 px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] text-white transition-all hover:bg-brand-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
                >
                  {setupBusy ? (
                    <>Creating account&hellip;</>
                  ) : (
                    <>
                      Create administrator
                      <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                    </>
                  )}
                </button>

                <p className="text-[11px] leading-relaxed text-slate-500">
                  Additional staff accounts are provisioned in Settings &rarr; My Account &amp;
                  Security.
                </p>
              </form>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h2>
              <p className="mt-2 text-sm text-slate-600">
                Use your {appName} operator account.
              </p>

              {error && (
                <div
                  role="alert"
                  className="mt-6 flex animate-fadeIn items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-danger" strokeWidth={1.75} />
                  <div className="flex-1">{error}</div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
                <div className="space-y-2">
                  <label htmlFor="login-user" className="auth-field-label text-slate-600">
                    Username or email
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-ink-muted">
                      <User className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <input
                      id="login-user"
                      type="text"
                      value={usernameOrEmail}
                      onChange={(e) => {
                        setUsernameOrEmail(e.target.value);
                        setError(null);
                      }}
                      autoComplete="username"
                      autoFocus
                      className="w-full rounded-lg border border-slate-300 bg-slate-100 py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-600 transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="login-password" className="auth-field-label text-slate-600">
                    Password
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-ink-muted">
                      <Lock className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError(null);
                      }}
                      autoComplete="current-password"
                      className="w-full rounded-lg border border-slate-300 bg-slate-100 py-2.5 pl-10 pr-10 text-sm text-slate-900 placeholder-slate-600 transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-ink-muted transition-colors hover:text-slate-600"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" strokeWidth={1.5} />
                      ) : (
                        <Eye className="h-4 w-4" strokeWidth={1.5} />
                      )}
                    </button>
                  </div>
                </div>

                <label className="flex cursor-pointer select-none items-center gap-2.5 pt-0.5">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                  />
                  <span className="text-xs font-medium text-slate-600">Keep me signed in</span>
                </label>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-lg bg-brand-600 px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] text-white transition-all hover:bg-brand-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
                >
                  {isSubmitting ? (
                    <>Signing in&hellip;</>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                    </>
                  )}
                </button>
              </form>

              <p className="mt-8 text-[11px] leading-relaxed text-slate-500">
                Access is managed by your laboratory administrator. New staff accounts are
                provisioned in Settings &rarr; My Account &amp; Security.
              </p>
            </>
          )}
        </section>
      </main>

      {/* ── Bottom matte ─────────────────────────────────────────────── */}
      <footer className="auth-rail flex shrink-0 items-center justify-between gap-4 border-t border-slate-200 px-6 py-4 text-[11px] text-slate-500 sm:px-10">
        <span>
          &copy; {new Date().getFullYear()} {appName}
        </span>
        <span className="hidden sm:inline">All data stays on this device.</span>
      </footer>
    </div>
  );
};
