import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Lock,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  AlertCircle,
  Building2,
} from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login, brandingSettings, showToast, users, createInitialAdmin } = useApp();

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

  return (
    <div className="min-h-[100dvh] bg-white flex flex-col text-slate-900 selection:bg-indigo-600 selection:text-white">
      <main className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <section className="w-full max-w-sm animate-step-in py-10">
          {/* Brand header */}
          <div className="flex items-center gap-3 mb-10">
            {brandingSettings.logoUrl ? (
              <img
                src={brandingSettings.logoUrl}
                alt={appName}
                className="h-9 w-auto max-w-[140px] object-contain"
              />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center">
                <Building2 className="w-4.5 h-4.5 text-white" strokeWidth={1.75} />
              </div>
            )}
            <div>
              <div className="text-sm font-bold tracking-tight">{appName}</div>
              <div className="text-[11px] text-slate-500">{tagline}</div>
            </div>
          </div>

          {needsSetup ? (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-600">
                First-time setup
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight">Create the administrator</h2>
              <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">
                This terminal has no administrator yet. The first account you create receives
                the Super Admin role.
              </p>

              <form
                className="mt-8 space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (setupReady) void handleCreateAdmin();
                }}
              >
                <div className="space-y-1.5">
                  <label htmlFor="setup-name" className="block text-xs font-semibold text-slate-700">
                    Full name
                  </label>
                  <input
                    id="setup-name"
                    value={setupName}
                    onChange={(e) => setSetupName(e.target.value)}
                    placeholder="Administrator's full name"
                    autoComplete="name"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="setup-username" className="block text-xs font-semibold text-slate-700">
                    Username
                  </label>
                  <input
                    id="setup-username"
                    value={setupUsername}
                    onChange={(e) => setSetupUsername(e.target.value)}
                    placeholder="Used to sign in"
                    autoComplete="username"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="setup-password" className="block text-xs font-semibold text-slate-700">
                    Password
                  </label>
                  <input
                    id="setup-password"
                    type="password"
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    autoComplete="new-password"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent transition-all"
                  />
                  {setupPassword.length > 0 && setupPassword.length < 8 && (
                    <p className="text-[11px] text-slate-500">
                      {8 - setupPassword.length} more character{8 - setupPassword.length === 1 ? '' : 's'} needed
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={!setupReady}
                  className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] text-white text-sm font-semibold rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {setupBusy ? (
                    <>Creating account…</>
                  ) : (
                    <>
                      Create administrator
                      <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
                    </>
                  )}
                </button>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Additional staff accounts are provisioned later in Settings &rarr; User
                  Management.
                </p>
              </form>
            </>
          ) : (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-600">
                Sign in
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight">Welcome back</h2>
              <p className="mt-1.5 text-sm text-slate-500">
                Use your {appName} operator account.
              </p>

              {error && (
                <div
                  role="alert"
                  className="mt-6 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs font-medium flex items-start gap-2.5 animate-fadeIn"
                >
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" strokeWidth={1.75} />
                  <div className="flex-1">{error}</div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
                <div className="space-y-1.5">
                  <label htmlFor="login-user" className="block text-xs font-semibold text-slate-700">
                    Username or email
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <User className="w-4 h-4" strokeWidth={1.5} />
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
                      className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700">
                    Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" strokeWidth={1.5} />
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
                      className="w-full pl-10 pr-10 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" strokeWidth={1.5} />
                      ) : (
                        <Eye className="w-4 h-4" strokeWidth={1.5} />
                      )}
                    </button>
                  </div>
                </div>

                <label className="flex items-center gap-2.5 cursor-pointer select-none pt-0.5">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-slate-600 font-medium">Keep me signed in</span>
                </label>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] text-white text-sm font-semibold rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>Signing in…</>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
                    </>
                  )}
                </button>
              </form>

              <p className="mt-8 text-[11px] text-slate-400 leading-relaxed">
                Access is managed by your laboratory administrator. New staff accounts are
                provisioned in Settings &rarr; User Management.
              </p>
            </>
          )}
        </section>
      </main>

      <footer className="px-6 py-4 text-center text-[11px] text-slate-400 border-t border-slate-100">
        &copy; {new Date().getFullYear()} {appName}
      </footer>
    </div>
  );
};
