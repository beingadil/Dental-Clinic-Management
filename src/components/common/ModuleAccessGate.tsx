import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { auditRepo } from '../../db/repos';
import {
  isModuleUnlocked,
  loadModuleLock,
  moduleDefinition,
  unlockModule,
  verifyModulePassword,
  type LockableModuleId,
} from '../../services/moduleSecurity';
import { MODULE_ICONS } from './moduleVisuals';
import { ArrowLeft, LockKeyhole, ShieldCheck } from 'lucide-react';

interface ModuleAccessGateProps {
  /** Which module the children belong to. */
  module: LockableModuleId;
  children: React.ReactNode;
}

/**
 * The password door in front of a whole module.
 *
 * The gate wraps every view of the module, so opening a second tab is never a
 * way around the first one. The shell owns the lifetime of the unlock: leaving
 * the module locks it again, while switching between views inside it keeps the
 * session unlock (see `moduleForView` in the shell). For that reason there is
 * no unmount cleanup here — a cleanup would re-lock the module on every tab
 * switch and make Billing → Print Invoices ask twice.
 *
 * The password itself is shared by everyone who needs the module: this is a
 * door on the data, not a per-user credential. Only a Super Admin can set,
 * change or remove it in Settings → Module Security, which is deliberately
 * not lockable so recovery is always possible.
 */
export const ModuleAccessGate: React.FC<ModuleAccessGateProps> = ({ module, children }) => {
  const { user, brandingSettings, setCurrentView } = useApp();
  const definition = moduleDefinition(module);
  const ModuleIcon = MODULE_ICONS[module];

  const [lock] = useState(() => loadModuleLock(module));
  const [unlocked, setUnlocked] = useState(() => !lock.enabled || isModuleUnlocked(module));
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [checking, setChecking] = useState(false);

  if (unlocked) return <>{children}</>;

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || checking) return;
    setChecking(true);
    setError(null);
    try {
      const ok = await verifyModulePassword(module, password);
      if (!ok) {
        const attempts = failedAttempts + 1;
        setFailedAttempts(attempts);
        setError('Incorrect module password.');
        try {
          auditRepo.log({
            actor: user?.name || 'Unknown',
            action: 'security.module_access.denied',
            entity_type: 'settings',
            entity_id: 'module_locks',
            entity_ref: definition.label,
            reason: 'invalid_password',
            notes: `Failed ${definition.label} unlock attempt ${attempts}`,
          });
        } catch { /* audit is best-effort */ }
        return;
      }
      try {
        auditRepo.log({
          actor: user?.name || 'Unknown',
          action: 'security.module_access.granted',
          entity_type: 'settings',
          entity_id: 'module_locks',
          entity_ref: definition.label,
          notes: `${definition.label} unlocked`,
        });
      } catch { /* audit is best-effort */ }
      unlockModule(module);
      setPassword('');
      setError(null);
      setUnlocked(true);
    } finally {
      setChecking(false);
    }
  };

  const labName = brandingSettings?.lab_name || brandingSettings?.appName || 'Dental Lab';
  const canLeave = module !== 'dashboard';

  return (
    <div className="flex min-h-[62vh] items-center justify-center py-6">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_60px_-32px_rgba(15,23,42,0.28)]">
        <div className="border-b border-slate-100 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 px-6 py-7 text-white">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
              <ModuleIcon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">
                {labName}
              </p>
              <h1 className="text-base font-bold">{definition.label}</h1>
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-white/70">
            {definition.description} This module is protected by a module password,
            separate from your sign-in password, and it is asked again each time the
            module is opened.
          </p>
        </div>

        <form onSubmit={handleUnlock} className="space-y-4 px-6 py-6">
          <div>
            <label
              htmlFor={`module-password-${module}`}
              className="mb-1 block text-xs font-bold text-slate-700"
            >
              Module password
            </label>
            <div className="relative">
              <ShieldCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id={`module-password-${module}`}
                type="password"
                autoFocus
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                placeholder={`Enter the ${definition.label} password`}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm font-medium text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            {error && (
              <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">
                {error}
                {failedAttempts >= 3 &&
                  ' Ask a Super Admin to reset it in Settings → Module Security.'}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={checking || !password}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LockKeyhole className="h-4 w-4" />
            {checking ? 'Checking…' : `Unlock ${definition.label}`}
          </button>

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
            {canLeave ? (
              <button
                type="button"
                onClick={() => setCurrentView('dashboard')}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 transition-colors hover:text-slate-800"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to dashboard
              </button>
            ) : (
              <span className="text-[11px] font-semibold text-slate-400">
                Choose another module from the sidebar.
              </span>
            )}
            <p className="text-right text-[10px] leading-snug text-slate-400">
              A Super Admin can change or remove this password in
              <br />
              Settings → Module Security.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};
