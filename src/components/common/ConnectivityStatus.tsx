import React, { useState, useEffect } from 'react';
import { WifiOff, Cloud, CloudOff } from 'lucide-react';
import { getLastSaveAt, getLastSaveError } from '../../db/persistence';

/**
 * Connectivity status pill for the app header.
 *
 * Two things the operator needs to know without digging into Settings:
 *
 *  1. Am I online? The app works offline (SQLite is local), but an operator
 *     who thinks they are saving to a shared server will keep working on a
 *     stale copy. The amber "Offline" pill makes the state visible.
 *
 *  2. When did the last save succeed? "Saved just now" / "Saved 3 min ago"
 *     answers the question every operator asks after a crash or a power cut:
 *     "did my last change actually land?" Without it the only way to know is
 *     to open Settings > Persistence Health.
 *
 * Both are read from the existing persistence layer — no new state, no new
 * network calls. The pill is intentionally small and quiet when everything is
 * fine (slate text, no background) and loud when something is wrong (amber/red).
 */
export const ConnectivityStatus: React.FC = () => {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [lastSave, setLastSave] = useState<string | null>(() => getLastSaveAt());
  const [saveError, setSaveError] = useState<string | null>(() => getLastSaveError());

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Poll the persistence layer every 15 s. The save happens on a 5 s debounce,
  // so 15 s is fast enough to feel live without burning CPU.
  useEffect(() => {
    const tick = () => {
      setLastSave(getLastSaveAt());
      setSaveError(getLastSaveError());
    };
    const id = window.setInterval(tick, 15000);
    return () => window.clearInterval(id);
  }, []);

  const formatAge = (iso: string | null): string => {
    if (!iso) return 'not yet';
    const ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms) || ms < 0) return 'just now';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} h ago`;
    return new Date(iso).toLocaleDateString();
  };

  // Offline takes precedence — it is the more urgent state.
  if (!online) {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold"
        role="status"
        aria-live="polite"
        title="You are offline. Changes are saved locally and will sync when connectivity returns."
      >
        <WifiOff className="w-3.5 h-3.5" />
        <span>Offline</span>
      </div>
    );
  }

  if (saveError) {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold"
        role="status"
        aria-live="polite"
        title={saveError}
      >
        <CloudOff className="w-3.5 h-3.5" />
        <span>Save failed</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-slate-500 text-xs font-medium"
      role="status"
      aria-live="polite"
      title={lastSave ? `Last successful save: ${lastSave}` : 'No save yet this session'}
    >
      <Cloud className="w-3.5 h-3.5" />
      <span>Saved {formatAge(lastSave)}</span>
    </div>
  );
};