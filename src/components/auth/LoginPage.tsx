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
  ShieldCheck,
  Activity,
  Award,
  Cpu,
  ReceiptText,
  HelpCircle,
  X
} from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login, brandingSettings, showToast, users, createInitialAdmin } = useApp();

  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupName, setSetupName] = useState('');
  const [setupUsername, setSetupUsername] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupBusy, setSetupBusy] = useState(false);

  // Show first-run setup ONLY when the local database has no admin account yet
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
      setError('Please enter your authorized username or email address.');
      return;
    }

    if (!password) {
      setError('Please enter your account password.');
      return;
    }

    setIsSubmitting(true);
    login(usernameOrEmail, password, rememberMe)
      .then((success) => {
        setIsSubmitting(false);
        if (!success) {
          setError('Invalid username/email or password. Please verify your credentials.');
        }
      })
      .catch(() => {
        setIsSubmitting(false);
        setError('Sign-in failed. Please try again.');
      });
  };

  const handleQuickFill = (userStr: string, passStr: string) => {
    setUsernameOrEmail(userStr);
    setPassword(passStr);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between font-sans text-slate-900 selection:bg-indigo-600 selection:text-white">
      {/* Top Header */}
      <header className="px-6 py-4 md:px-12 bg-white border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {brandingSettings.logoUrl ? (
            <img 
              src={brandingSettings.logoUrl} 
              alt={brandingSettings.appName} 
              className="h-9 max-w-[160px] object-contain"
            />
          ) : (
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm">
              <Building2 className="w-5 h-5 text-white" />
            </div>
          )}
          <div>
            <h1 className="text-sm font-bold text-slate-900 tracking-tight">
              {brandingSettings.appName || 'Dental Solutions'}
            </h1>
            <p className="text-[11px] text-slate-500 font-medium hidden sm:block">
              {brandingSettings.tagline || 'Dental Laboratory Information System'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-medium text-slate-700 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>ISO 13485 Compliant Workstation</span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 md:p-10">
        <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-[520px]">
          
          {/* Left Side Info Panel (Desktop) */}
          <div className="md:col-span-5 bg-slate-900 text-white p-8 md:p-10 flex flex-col justify-between relative overflow-hidden">
            <div className="space-y-6 relative z-10">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md">
                <Building2 className="w-5 h-5" />
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl font-bold tracking-tight text-white leading-snug">
                  Precision Dental Lab Operations
                </h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Streamline production cycles, manage clinic accounts, enforce quality control standards, and reconcile multi-tier billing.
                </p>
              </div>
            </div>

            <div className="space-y-4 pt-6 border-t border-slate-800 relative z-10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-800 text-indigo-400 flex items-center justify-center shrink-0">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-200">Real-Time Case Production</h4>
                  <p className="text-[11px] text-slate-400">Track CAD, wax-up, casting, and final glaze</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-800 text-indigo-400 flex items-center justify-center shrink-0">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-200">Digital Clinic Integration</h4>
                  <p className="text-[11px] text-slate-400">Custom pricing matrices and shade records</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-800 text-indigo-400 flex items-center justify-center shrink-0">
                  <ReceiptText className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-200">Automated Financial Ledger</h4>
                  <p className="text-[11px] text-slate-400">Multi-tier aging, advance deposits & receipts</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-800 text-indigo-400 flex items-center justify-center shrink-0">
                  <Award className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-200">Audit & Quality Assurance</h4>
                  <p className="text-[11px] text-slate-400">Certified technician logs & remake prevention</p>
                </div>
              </div>
            </div>

            <div className="pt-6 text-[11px] text-slate-400 font-medium">
              Enterprise Workstation • Release 2026.4
            </div>
          </div>

          {/* Right Side Login Form */}
          <div className="md:col-span-7 p-8 md:p-12 flex flex-col justify-center space-y-6 bg-white">
            
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                Sign in to your account
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Enter your authorized username or email address below.
              </p>
            </div>

            {/* Error Notification */}
            {error && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-medium flex items-start gap-2.5 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="flex-1">{error}</div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Username / Email */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">
                  Username or Email
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={usernameOrEmail}
                    onChange={(e) => {
                      setUsernameOrEmail(e.target.value);
                      setError(null);
                    }}
                    placeholder="e.g. adil or adil@dentalsolutions.pk"
                    autoFocus
                    required
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent focus:bg-white transition-all font-medium"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-700">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(true)}
                    className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError(null);
                    }}
                    placeholder="Enter account password"
                    required
                    className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent focus:bg-white transition-all font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Remember Me & Access Request */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-slate-600 font-medium">Keep me signed in</span>
                </label>

                <button
                  type="button"
                  onClick={() => setShowRegisterModal(true)}
                  className="text-[11px] text-slate-500 hover:text-slate-800 font-medium"
                >
                  Request new account
                </button>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 mt-2"
              >
                {isSubmitting ? (
                  <span>Authenticating...</span>
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* First-run admin setup (only shows when no super admin exists yet) */}
            {needsSetup && (
              <div className="pt-4 border-t border-slate-100">
                <div className="text-[11px] font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                  First-time setup: create the administrator account
                </div>
                <div className="space-y-2">
                  <input
                    value={setupName}
                    onChange={(e) => setSetupName(e.target.value)}
                    placeholder="Administrator full name"
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white transition-all font-medium"
                  />
                  <input
                    value={setupUsername}
                    onChange={(e) => setSetupUsername(e.target.value)}
                    placeholder="Username (e.g. admin)"
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white transition-all font-medium"
                  />
                  <input
                    type="password"
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    placeholder="Choose a strong password (min 8 characters)"
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white transition-all font-medium"
                  />
                  <button
                    type="button"
                    disabled={setupBusy || !setupName.trim() || !setupUsername.trim() || setupPassword.length < 8}
                    onClick={async () => {
                      setSetupBusy(true);
                      try {
                        await createInitialAdmin(setupName.trim(), setupUsername.trim(), setupPassword);
                        showToast('Administrator account created. Please sign in.', 'success');
                        setNeedsSetup(false);
                      } finally {
                        setSetupBusy(false);
                      }
                    }}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors"
                  >
                    {setupBusy ? 'Creating…' : 'Create Administrator Account'}
                  </button>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    This account receives the Super Admin role. Passwords are stored hashed (PBKDF2) in the local database.
                  </p>
                </div>
              </div>
            )}

          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-4 text-center text-xs text-slate-500 bg-white border-t border-slate-200">
        <p>
          © 2026 {brandingSettings.appName || 'Dental Solutions'}. All rights reserved. • Support Hotline: {brandingSettings.phone || '0333-0473797'}
        </p>
      </footer>

      {/* Reset Password Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white max-w-md w-full rounded-2xl p-6 border border-slate-200 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <HelpCircle className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900">Reset Account Access</h3>
              </div>
              <button
                onClick={() => setShowForgotModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              For security compliance, user credentials must be reset by the authorized Lab Administrator or IT Department.
            </p>
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs text-slate-700">
              <div className="font-semibold text-slate-900">Lab Administration Helpdesk:</div>
              <div>Hotline: <span className="font-mono font-medium">{brandingSettings.phone || '0333-0473797'}</span></div>
              <div>Email: <span className="font-mono font-medium">{brandingSettings.email || 'support@dentalsolutions.pk'}</span></div>
            </div>
            <button
              onClick={() => {
                setShowForgotModal(false);
                showToast('Administrator contact details copied.', 'info');
              }}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition-colors"
            >
              Understood
            </button>
          </div>
        </div>
      )}

      {/* Request Account Modal */}
      {showRegisterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white max-w-md w-full rounded-2xl p-6 border border-slate-200 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900">Staff Account Registration</h3>
              </div>
              <button
                onClick={() => setShowRegisterModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              To provision an operator or technician account on this terminal, please request provisioning from the System Administrator in the Settings &gt; User Management module.
            </p>
            <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl text-xs text-indigo-950">
              Role permissions include Super Admin, Lab Technician, Billing Manager, and Front Desk Reception.
            </div>
            <button
              onClick={() => setShowRegisterModal(false)}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

