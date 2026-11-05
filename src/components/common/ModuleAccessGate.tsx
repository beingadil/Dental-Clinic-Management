import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { auditRepo } from '../../db/repos';
import {
  isViewProtected,
  isModuleUnlocked,
  moduleDefinition,
  unlockModule,
  verifyModulePassword,
  type LockableModuleId,
} from '../../services/moduleSecurity';
import { MODULE_ICONS, VIEW_LABELS } from './moduleVisuals';
import { ArrowLeft, LockKeyhole, ShieldCheck } from 'lucide-react';

interface ModuleAccessGateProps {
  /** Which module the children belong to. */
  module: LockableModuleId;
  /** The shell view being rendered; only views the password covers are gated. */
  view: string;
  children: React.ReactNode;
}

/**
 * The password door in front of a protected view.
 *
 * A module password may cover the whole module or only some of its views, so
 * the gate is mounted per view and asks for the lock on that view. Once the
 * shared password is accepted, the session unlock is module-wide: switching to
 * another covered view of the same module (Billing ↔ Print Invoices, Ledger ↔
 * Statements) does not ask twice. Leaving the module locks it again in the
 * shell. For that reason there is no unmount cleanup here — a cleanup would
 * re-lock the module on every tab switch.
 *
 * The password itself is shared by everyone who needs the covered views: this
 * is a door on the data, not a per-user credential. Only a Super Admin can set,
 * change or remove it in Settings → Module Security, which is deliberately not
 * lockable so recovery is always possible.
 */
export const ModuleAccessGate: React.FC<ModuleAccessGateProps> = ({
  module,
  view,
  children,
}) => {
  const { user, brandingSettings, setCurrentView } = useApp();
  const definition = moduleDefinition(module);
  const viewLabel = VIEW_LABELS[view] ?? definition.label;
  const ModuleIcon = MODULE_ICONS[module];

  const protectedHere = isViewProtected(module, view);
  // Read the live session set instead of copying it into component state: the
  // Reports group reuses this component as its tabs change, and a copied
  // `true` from an unprotected tab must not open a protected one.
  const [, forceRender] = useState(0);
  const unlocked = !protectedHere || isModuleUnlocked(module);
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
            entity_ref: `${definition.label} · ${viewLabel}`,
            reason: 'invalid_password',
            notes: `Failed ${viewLabel} unlock attempt ${attempts}`,
          });
        } catch { /* audit is best-effort */ }
        return;
      }
      try {
        auditRepo.log({
          actor: user?.name || 'Unknown',
          action: 'security.module_access.granted',
          entity_type: 'settings',
          entity_id: 'module_locks',            entity_ref: `${definition.label} · ${viewLabel}`,
            notes: `${viewLabel} unlocked`,
          });
      } catch { /* audit is best-effort */ }
      unlockModule(module);
      setPassword('');
      setError(null);
      forceRender((tick) => tick + 1);
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
              <h1 className="text-base font-bold">{viewLabel}</h1>
              <p className="text-[10px] font-semibold text-white/50">{definition.label}</p>
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-white/70">
            This view is protected by the shared {definition.label} password. It is
            separate from your sign-in password and is asked again each time the module
            is opened.
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
            {checking ? 'Checking…' : 'Unlock this view'}
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
