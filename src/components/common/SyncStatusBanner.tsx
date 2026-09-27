import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { getLastSyncError } from '../../db/syncCore';

/**
 * Persistent banner when the SQLite collection sync has failed.
 *
 * The sync engine (DELETE+re-INSERT of every table in one transaction) used to
 * fail silently — a console.error was the only trace, while the app kept
 * running on unsaved state. This banner makes any sync failure impossible to
 * miss until the next successful sync clears it.
 */
export function SyncStatusBanner() {
  const [error, setError] = useState<string | null>(() => getLastSyncError());

  useEffect(() => {
    // Fires on both success and failure — success must clear the banner too.
    const onSyncStatus = () => setError(getLastSyncError());
    window.addEventListener('sync:status', onSyncStatus);
    return () => window.removeEventListener('sync:status', onSyncStatus);
  }, []);

  if (!error) return null;

  return (
    <div className="flex items-start gap-3 bg-rose-600 text-white px-4 py-2.5 text-xs font-bold shadow-lg">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p>Database sync failed — your changes are at risk and may not be saved. Do not close the app before this warning disappears.</p>
        <p className="font-mono font-normal opacity-90 truncate" title={error}>{error}</p>
      </div>
    </div>
  );
}
