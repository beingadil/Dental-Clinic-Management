import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { verifyPassword } from '../../db/crypto';
import { usersRepo, auditRepo } from '../../db/repos';

/** Idle window before the lock screen appears. */
const IDLE_MS = 15 * 60 * 1000;

/**
 * Lock screen (RBAC v2). After 15 minutes of inactivity the app is covered
 * by an overlay that demands the signed-in user's own password. The session
 * token is left intact, so a successful re-entry resumes exactly where the
 * operator left off — this is a lock, not a logout. Failed attempts are
 * audited; the overlay cannot be dismissed without the password.
 */
export const LockScreen: React.FC = () => {
  const { user } = useApp();
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Idle detection — only while signed in and unlocked.
  useEffect(() => {
    if (!user) return;
    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (locked) return;
      timerRef.current = setTimeout(() => setLocked(true), IDLE_MS);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [user, locked]);

  // Reset the form whenever the lock engages.
  useEffect(() => {
    if (locked) {
      setPassword('');
      setError(null);
    }
  }, [locked]);

  if (!user || !locked) return null;

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setChecking(true);
    setError(null);
    try {
      const row = usersRepo.byId(user.id);
      if (!row || !(await verifyPassword(password, row.password_hash))) {
        setError('Incorrect password.');
        try {
          auditRepo.log({
            actor: user.name,
            action: 'auth.lock.failed',
            entity_type: 'user',
            entity_id: user.id,
            entity_ref: user.username,
            reason: 'invalid_password',
          });
        } catch { /* audit is best-effort */ }
        return;
      }
      try {
        auditRepo.log({
          actor: user.name,
          action: 'auth.lock.unlocked',
          entity_type: 'user',
          entity_id: user.id,
          entity_ref: user.username,
        });
      } catch { /* audit is best-effort */ }
      setLocked(false);
      setPassword('');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
      <form
        onSubmit={handleUnlock}
        className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 space-y-4"
      >
        <div className="text-center">
          <h2 className="text-base font-bold text-slate-900">Session locked</h2>
          <p className="text-xs text-slate-500 mt-1">
            Inactivity timeout reached. Enter your password to resume.
          </p>
        </div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Your password"
          className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white"
        />
        {error && <p className="text-xs text-rose-600 font-semibold">{error}</p>}
        <button
          type="submit"
          disabled={checking || !password}
          className="w-full py-2.5 ds-glass-pill disabled:opacity-50 font-bold text-xs cursor-pointer"
        >
          {checking ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
};