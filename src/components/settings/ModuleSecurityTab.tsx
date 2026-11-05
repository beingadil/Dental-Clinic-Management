import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useTransientMessage, TransientBanner } from '../common/useTransient';
import { canManageSystem } from '../../services/permissions';
import {
  LOCKABLE_MODULES,
  MIN_MODULE_PASSWORD_LENGTH,
  changeModulePassword,
  clearModulePassword,
  isModuleUnlocked,
  loadModuleLocks,
  lockAllModules,
  lockModule,
  moduleDefinition,
  setModuleLockViews,
  setModulePassword,
  type LockableModuleId,
  type ModuleLockMap,
} from '../../services/moduleSecurity';
import { MODULE_ICONS, VIEW_LABELS } from '../common/moduleVisuals';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Eye,
  KeyRound,
  Layers,
  LockKeyhole,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from 'lucide-react';

type FormMode = 'idle' | 'change';

/**
 * TAB: MODULE SECURITY — choose which whole modules ask for their own password.
 *
 * This is deliberately separate from My Account: that tab owns the credential
 * an operator signs in with, while this one owns the shared door in front of a
 * module. Every lockable module has its OWN password, because the books and
 * the clinic list do not have the same audience; a cashier may need Billing but
 * not the ledger.
 *
 * System Settings is not in the list on purpose. It is the recovery surface:
 * a Super Admin must always be able to reach this tab to change or remove a
 * forgotten password.
 *
 * Only a user who may manage the system sees the tab (`users:manage`), and the
 * same permission is checked again at every action below.
 */
export const ModuleSecurityTab: React.FC = () => {
  const { user } = useApp();
  const actor = user?.name || 'System';
  const mayConfigure = canManageSystem(user, 'users:manage');

  const [locks, setLocks] = useState<ModuleLockMap>(() => loadModuleLocks());
  const [selectedId, setSelectedId] = useState<LockableModuleId>(() => {
    const map = loadModuleLocks();
    return LOCKABLE_MODULES.find((m) => map[m.id].enabled)?.id ?? 'reports';
  });
  /** Coverage chosen before a password exists. Existing locks read their saved
   *  list directly, so a chip click is persisted as soon as it happens. */
  const [draftViews, setDraftViews] = useState<string[]>(() => [...locks[selectedId].views]);
  const [mode, setMode] = useState<FormMode>('idle');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [message, flashMessage, clearMessage] = useTransientMessage(6000);

  const selected = moduleDefinition(selectedId);
  const selectedLock = locks[selectedId];
  const SelectedIcon = MODULE_ICONS[selectedId];
  const activeViews = selectedLock.enabled ? selectedLock.views : draftViews;
  const coverageCount = selected.views.filter((view) => activeViews.includes(view)).length;
  const coversAllViews = coverageCount === selected.views.length;
  const coverageLabel = coversAllViews
    ? selected.views.length === 1
      ? 'This view'
      : 'All views'
    : `${coverageCount} of ${selected.views.length} views`;

  const protectedCount = useMemo(
    () => LOCKABLE_MODULES.filter((m) => locks[m.id].enabled).length,
    [locks],
  );
  const openCount = LOCKABLE_MODULES.length - protectedCount;
  const openThisVisit = selectedLock.enabled && isModuleUnlocked(selectedId);

  const lastChanged = useMemo(() => {
    if (!selectedLock.updatedAt) return '';
    const d = new Date(selectedLock.updatedAt);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  }, [selectedLock.updatedAt]);

  const resetForm = () => setForm({ current: '', next: '', confirm: '' });
  const refresh = () => setLocks(loadModuleLocks());

  const selectModule = (id: LockableModuleId) => {
    setSelectedId(id);
    setDraftViews([...locks[id].views]);
    setMode('idle');
    setConfirmRemove(false);
    resetForm();
    clearMessage();
  };

  /**
   * Persist a coverage change. A draft (no password yet) is local until the
   * form is submitted; an existing lock is written and re-locked immediately.
   * Refusing an empty selection keeps a protected module from becoming open
   * by accident while the password itself is still configured.
   */
  const applyViews = (next: readonly string[]) => {
    const picked = selected.views.filter((view) => next.includes(view));
    if (picked.length === 0) {
      setMessage(
        'error',
        'Keep at least one view covered, or remove the module password entirely.',
      );
      return;
    }
    if (!selectedLock.enabled) {
      setDraftViews(picked);
      return;
    }
    try {
      setModuleLockViews(selectedId, picked, actor);
      refresh();
      setMessage(
        'success',
        picked.length === selected.views.length
          ? `Complete module lock on: every ${selected.label} view asks for the password.`
          : `${selected.label} now asks for its password on ${picked.length} of ${selected.views.length} views.`,
      );
    } catch (err: any) {
      setMessage('error', err?.message || 'Could not update the covered views.');
    }
  };

  const toggleView = (view: string) => {
    const next = activeViews.includes(view)
      ? activeViews.filter((candidate) => candidate !== view)
      : [...activeViews, view];
    applyViews(next);
  };

  if (!mayConfigure) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <ShieldCheck className="mx-auto mb-2 h-6 w-6 text-slate-400" />
        <p className="text-sm font-bold text-slate-700">Module security is restricted</p>
        <p className="mt-1 text-xs text-slate-500">
          Only a Super Admin can set or remove module passwords.
        </p>
      </div>
    );
  }

  const setMessage = (type: 'success' | 'error', text: string) => {
    flashMessage(type, text);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (form.next.length < MIN_MODULE_PASSWORD_LENGTH) {
      setMessage('error', `Use at least ${MIN_MODULE_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (form.next !== form.confirm) {
      setMessage('error', 'The new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      if (selectedLock.enabled) {
        const result = await changeModulePassword(selectedId, form.current, form.next, actor);
        if (!result.success) {
          setMessage('error', result.message);
          return;
        }
        setMessage(
          'success',
          `${selected.label} password changed. It will ask for the new password next time.`,
        );
      } else {
        await setModulePassword(selectedId, form.next, actor, activeViews);
        setMessage(
          'success',
          activeViews.length === selected.views.length
            ? `${selected.label} is now fully protected. Every view asks for this password next time it is opened.`
            : `${selected.label} is now protected on ${activeViews.length} of ${selected.views.length} views.`,
        );
        setDraftViews([...activeViews]);
      }
      refresh();
      resetForm();
      setMode('idle');
    } catch (err: any) {
      setMessage('error', err?.message || 'Could not save the module password.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = () => {
    try {
      clearModulePassword(selectedId, actor);
      setDraftViews([...selected.views]);
      refresh();
      setConfirmRemove(false);
      setMode('idle');
      resetForm();
      setMessage(
        'success',
        `${selected.label} is no longer protected. Anyone signed in can open it.`,
      );
    } catch (err: any) {
      setMessage('error', err?.message || 'Could not remove the module password.');
    }
  };

  const handleLockNow = () => {
    lockModule(selectedId);
    flashMessage(
      'success',
      `${selected.label} is locked. It will ask for the password the next time it is opened.`,
    );
  };

  const handleLockAll = () => {
    lockAllModules();
    flashMessage(
      'success',
      protectedCount === 0
        ? 'No module passwords are configured yet.'
        : `All ${protectedCount} protected ${protectedCount === 1 ? 'module is' : 'modules are'} locked again.`,
    );
  };

  const showForm = !selectedLock.enabled || mode === 'change';

  return (
    <div className="space-y-5">
      {/* Overview ------------------------------------------------------- */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-indigo-50 p-2.5 text-indigo-700">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Module Security</h2>
              <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-slate-500">
                Put a second door in front of a whole module, or only the views that need
                it. Each module has its own password, shared by everyone who needs those
                views, and separate from each user&apos;s sign-in password. Pick a module on
                the left to set, change or remove its password.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              {protectedCount} of {LOCKABLE_MODULES.length} protected
            </span>
            {protectedCount > 0 && (
              <button
                type="button"
                onClick={handleLockAll}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                <LockKeyhole className="h-3.5 w-3.5" /> Lock all now
              </button>
            )}
          </div>
        </div>

        <TransientBanner message={message} className="mt-4 rounded-2xl font-semibold" />

        <div className="mt-4 grid gap-2 text-[11px] leading-relaxed text-slate-500 sm:grid-cols-3">
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <strong className="block text-slate-700">{protectedCount} protected</strong>
            {protectedCount === 0
              ? 'No module asks for a password yet.'
              : `${openCount === 0 ? 'Every module' : `${openCount} other ${openCount === 1 ? 'module' : 'modules'}`} still open${openCount === 1 ? 's' : ''} without one.`}
          </p>
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <strong className="block text-slate-700">Separate from login</strong>
            A module password only opens the views it covers, and it is asked again after
            you leave the module.
          </p>
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <strong className="block text-slate-700">Recovery stays open</strong>
            System Settings is never lockable. A Super Admin can always reach this tab to
            reset a forgotten module password — only a PBKDF2 hash is stored.
          </p>
        </div>
      </div>

      {/* Module picker + detail ---------------------------------------- */}
      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-xs">
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <Layers className="h-3.5 w-3.5" /> Modules
            </h3>
            <span className="text-[10px] font-semibold text-slate-400">
              Select one to configure
            </span>
          </div>
          <ul className="space-y-1">
            {LOCKABLE_MODULES.map((module) => {
              const Icon = MODULE_ICONS[module.id];
              const lock = locks[module.id];
              const active = module.id === selectedId;
              return (
                <li key={module.id}>
                  <button
                    type="button"
                    onClick={() => selectModule(module.id)}
                    aria-pressed={active}
                    className={`flex w-full items-center gap-2.5 rounded-2xl border px-2.5 py-2.5 text-left transition-colors ${
                      active
                        ? 'border-indigo-200 bg-indigo-50/70'
                        : 'border-transparent hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                        lock.enabled
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-xs font-bold ${
                          active ? 'text-indigo-900' : 'text-slate-800'
                        }`}
                      >
                        {module.label}
                      </span>
                      <span className="block truncate text-[10px] text-slate-400">
                        {lock.enabled
                          ? `${lock.views.length} of ${module.views.length} view${module.views.length === 1 ? '' : 's'} locked`
                          : `${module.views.length} view${module.views.length === 1 ? '' : 's'}`}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                        lock.enabled
                          ? lock.views.length === module.views.length
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-indigo-200 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 bg-slate-50 text-slate-500'
                      }`}
                    >
                      {lock.enabled
                        ? lock.views.length === module.views.length
                          ? 'Protected'
                          : 'Partial'
                        : 'Open'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] leading-relaxed text-slate-500">
            <strong className="text-slate-700">System Settings</strong> is deliberately not
            lockable, so a Super Admin can always recover the others.
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-slate-900 p-2.5 text-white">
                <SelectedIcon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">{selected.label}</h3>
                <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-slate-500">
                  {selected.description}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedLock.enabled ? (
                <>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                      coversAllViews
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    }`}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {coversAllViews ? 'Protected' : 'Partial protection'}
                    <span className="font-semibold opacity-70">
                      ·{' '}
                      {coversAllViews
                        ? 'all views'
                        : `${coverageCount} of ${selected.views.length} views`}
                    </span>
                  </span>
                  {openThisVisit && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700">
                      <Eye className="h-3.5 w-3.5" /> Open this visit
                    </span>
                  )}
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                  <ShieldOff className="h-3.5 w-3.5" /> Not protected
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Covers these views
                </p>
                <p className="mt-0.5 text-[11px] font-semibold text-slate-700">
                  {coverageLabel}
                </p>
              </div>
              {selected.views.length > 1 && (
                <button
                  type="button"
                  onClick={() => applyViews(selected.views)}
                  disabled={coversAllViews || busy}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition-colors ${
                    selectedLock.enabled && coversAllViews
                      ? 'cursor-default border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800'
                  } disabled:cursor-default`}
                >
                  {selectedLock.enabled && coversAllViews ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <Layers className="h-3.5 w-3.5" />
                  )}
                  {selectedLock.enabled
                    ? coversAllViews
                      ? 'Complete module locked'
                      : 'Lock complete module'
                    : coversAllViews
                      ? 'All views selected'
                      : 'Select all views'}
                </button>
              )}
            </div>

            <div
              role="group"
              aria-label={`Views covered by the ${selected.label} password`}
              className="mt-2.5 flex flex-wrap gap-1.5"
            >
              {selected.views.map((view) => {
                const included = activeViews.includes(view);
                return (
                  <button
                    key={view}
                    type="button"
                    aria-pressed={included}
                    disabled={busy}
                    onClick={() => toggleView(view)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors disabled:opacity-60 ${
                      included
                        ? 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`flex h-3 w-3 items-center justify-center rounded-full border ${
                        included
                          ? 'border-indigo-500 bg-indigo-500 text-white'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {included && <Check className="h-2 w-2" strokeWidth={3.5} />}
                    </span>
                    {VIEW_LABELS[view] ?? view}
                  </button>
                );
              })}
            </div>

            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              {selectedLock.enabled
                ? 'Changes apply immediately. A view you uncheck opens without this password; the rest keep the same door.'
                : 'Choose the views that should ask for a password once you set one below. You can change this later without changing the password.'}
            </p>
          </div>

          {selectedLock.enabled && mode === 'idle' && (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div>
                  <p className="text-xs font-bold text-slate-800">Password is configured</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {lastChanged ? `Last changed ${lastChanged}` : 'Last change date not recorded'}
                    {selectedLock.updatedBy ? ` by ${selectedLock.updatedBy}` : ''}.
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    Leaving {selected.label} closes this door again.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('change');
                      setConfirmRemove(false);
                      resetForm();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <KeyRound className="h-3.5 w-3.5" /> Change password
                  </button>
                  <button
                    type="button"
                    onClick={handleLockNow}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <LockKeyhole className="h-3.5 w-3.5" /> Lock now
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              </div>

              {confirmRemove && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                  <p className="flex items-start gap-2 text-xs font-semibold text-rose-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    {selectedLock.views.length === selected.views.length
                      ? `Remove the ${selected.label} password? The whole module will open for anyone signed in to this workstation, with no second prompt.`
                      : `Remove the ${selected.label} password? The ${selectedLock.views.length} protected ${selectedLock.views.length === 1 ? 'view' : 'views'} will open for anyone signed in, with no second prompt.`}
                  </p>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(false)}
                      className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700"
                    >
                      Keep protection
                    </button>
                    <button
                      type="button"
                      onClick={handleRemove}
                      className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700"
                    >
                      Remove protection
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!selectedLock.enabled && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
              <ShieldOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This module is open to anyone already signed in. Set a password and choose the
              views that should ask for it.
            </p>
          )}

          {showForm && (
            <form onSubmit={handleSubmit} className="mt-5 space-y-4 rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-indigo-600" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  {selectedLock.enabled
                    ? `Change the ${selected.label} password`
                    : `Set a password for ${selected.label}`}
                </h4>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {selectedLock.enabled && (
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-slate-700">
                      Current module password
                    </span>
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      value={form.current}
                      onChange={(e) => setForm((p) => ({ ...p, current: e.target.value }))}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none"
                    />
                  </label>
                )}
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-700">New password</span>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={form.next}
                    onChange={(e) => setForm((p) => ({ ...p, next: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none"
                  />
                  <span className="mt-1 block text-[10px] text-slate-400">
                    At least {MIN_MODULE_PASSWORD_LENGTH} characters.
                  </span>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-700">
                    Confirm new password
                  </span>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={form.confirm}
                    onChange={(e) => setForm((p) => ({ ...p, confirm: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none"
                  />
                </label>
              </div>

              <p className="text-[10px] leading-relaxed text-slate-500">
                This is a shared door for {coverageLabel.toLowerCase()} of {selected.label},
                not a personal credential. Do not reuse any operator&apos;s sign-in password.
              </p>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
                {selectedLock.enabled && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('idle');
                      resetForm();
                    }}
                    className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {busy
                    ? 'Saving…'
                    : selectedLock.enabled
                      ? 'Save new password'
                      : coverageCount === selected.views.length
                        ? 'Set module password'
                        : `Set password for ${coverageCount} of ${selected.views.length} views`}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
